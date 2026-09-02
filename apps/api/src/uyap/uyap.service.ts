/**
 * UYAP Köprüsü servisi — eklentinin çağırdığı uçların iş mantığı.
 *
 * AKIÅ: eşleştirme (pair) â†’ dosya senkronu (esas no eşleşmesi) â†’ safahat ve
 * duruşma kayıtları â†’ evrak aktarımı (presign â†’ yükle â†’ commit).
 *
 * EÅLEÅTİRME: UYAP dosya numarası, NomosOS Case.fileNumber alanıyla
 * karşılaştırılır (biçim "2026/145"). Eşleşme yoksa UyapMatchQueue'ya düşer;
 * avukat web arayüzünden bağlar (UyapCaseLink).
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AuditService } from "../audit/audit.service";
import { DiskQuotaService } from "../disk-quota/disk-quota.service";
import {
  UYAP_ACCESS_TOKEN_TTL_MS,
  UYAP_REFRESH_TOKEN_TTL_MS,
  generateExtensionToken,
  generatePairingCode,
  hashToken,
} from "./uyap.tokens";
import type { CommitInput, PresignInput, SyncEventsInput, SyncFilesInput } from "./uyap.dto";

/** Erişim jetonunun bitiş anı — ISO 8601. */
function accessExpiry(): string {
  return new Date(Date.now() + UYAP_ACCESS_TOKEN_TTL_MS).toISOString();
}

@Injectable()
export class UyapService {
  private readonly logger = new Logger(UyapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly diskQuota: DiskQuotaService,
  ) {}

  /* ------------------------- Web tarafı: eşleştirme ------------------------- */

  /** POST /uyap/pairing-code — web arayüzünde avukat kod üretir (10 dk ömür). */
  async createPairingCode(user: AuthUser) {
    const code = generatePairingCode();
    await this.prisma.client.uyapPairing.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        code,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return { code, expiresInSeconds: 600 };
  }

  /** Eşleştirilmiş cihazları listeler (iptal için). */
  async listDevices(user: AuthUser) {
    return this.prisma.client.uyapExtensionToken.findMany({
      where: { tenantId: user.tenantId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceName: true,
        extensionVersion: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Uygulama içi UYAP sayfası için durum özeti: izlenen dosya sayısı, son
   * senkron, bekleyen eşleşme, eşleştirilmiş cihazlar.
   */
  async webSummary(user: AuthUser) {
    const [watchedFileCount, lastEvent, pendingMatchCount, devices] = await Promise.all([
      this.prisma.client.uyapCaseLink.count({ where: { tenantId: user.tenantId } }),
      this.prisma.client.uyapEventRecord.findFirst({
        where: { tenantId: user.tenantId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.client.uyapMatchQueue.count({
        where: { tenantId: user.tenantId, resolvedAt: null },
      }),
      this.prisma.client.uyapExtensionToken.findMany({
        where: { tenantId: user.tenantId, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          deviceName: true,
          extensionVersion: true,
          lastUsedAt: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      watchedFileCount,
      lastSyncAt: lastEvent?.createdAt ?? null,
      pendingMatchCount,
      devices,
    };
  }

  /** Cihazın jetonunu iptal eder — o tarayıcı bir daha senkron yapamaz. */
  async revokeDevice(user: AuthUser, tokenId: string) {
    const device = await this.prisma.client.uyapExtensionToken.findFirst({
      where: { id: tokenId, tenantId: user.tenantId },
    });
    if (!device) throw new NotFoundException("Cihaz bulunamadı.");
    await this.prisma.client.uyapExtensionToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Eşleştirme kuyruğu — UYAP'ta görünen ama NomosOS'a bağlanmamış dosyalar. */
  async matchQueue(user: AuthUser) {
    const rows = await this.prisma.client.uyapMatchQueue.findMany({
      where: { tenantId: user.tenantId, resolvedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return rows.map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(r.payloadJson) as Record<string, unknown>;
      } catch {
        /* bozuk yük boş kalır */
      }
      return {
        id: r.id,
        uyapDosyaNo: r.uyapDosyaNo,
        birim: payload.birim ?? null,
        dosyaTuru: payload.dosyaTuru ?? null,
        durum: payload.durum ?? null,
        updatedAt: r.updatedAt,
      };
    });
  }

  /** Kuyruktaki UYAP dosyasını bir NomosOS dosyasına bağlar. */
  async resolveMatch(user: AuthUser, id: string, caseId: string) {
    const queued = await this.prisma.client.uyapMatchQueue.findFirst({
      where: { id, tenantId: user.tenantId, resolvedAt: null },
    });
    if (!queued) throw new NotFoundException("Kuyrukta böyle bir kayıt yok.");
    const targetCase = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!targetCase) throw new NotFoundException("Hedef dosya bulunamadı.");

    /** D5 / M6 — eşleşme anında sahnelenmiş olaylardan işlenen kayıt sayısı. */
    let replayed = 0;
    await this.prisma.client.$transaction(async (tx) => {
      await tx.uyapCaseLink.upsert({
        where: {
          tenantId_uyapDosyaNo: { tenantId: user.tenantId, uyapDosyaNo: queued.uyapDosyaNo },
        },
        create: {
          tenantId: user.tenantId,
          uyapDosyaNo: queued.uyapDosyaNo,
          caseId,
          matchedBy: user.userId,
        },
        update: { caseId, matchedBy: user.userId },
      });
      await tx.uyapMatchQueue.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedCaseId: caseId },
      });

      // D5 / M6 — EŞLEŞME ÇÖZÜLÜNCE OTOMATİK YENİDEN SENKRON.
      // Eşleşme YOKKEN sahnelenen olaylar `caseId: null` olarak duruyordu ve
      // dosyaya hiçbir şey işlenmiyordu; avukat eşleşmeyi çözünce SADECE link
      // kuruluyordu — olaylar bir sonraki eklenti senkronuna kadar askıda
      // kalıyordu. Artık bağlanan an TÜM sahnelenmiş olay dosyaya işlenir:
      // safahat → zaman çizelgesi, duruşma → ajanda (PLANLANDI).
      const staged = await tx.uyapEventRecord.findMany({
        where: { tenantId: user.tenantId, uyapDosyaNo: queued.uyapDosyaNo, caseId: null },
        orderBy: { tarih: "asc" },
      });
      for (const ev of staged) {
        await tx.uyapEventRecord.update({ where: { id: ev.id }, data: { caseId } });
        if (ev.kind === "DURUSMA") {
          await tx.hearing.create({
            data: {
              tenantId: user.tenantId,
              caseId,
              type: "DURUSMA",
              status: "PLANLANDI",
              date: ev.tarih,
              courtroom: ev.salon ?? ev.birim ?? null,
              note:
                `UYAP Köprüsü'nden eşleşme sonrası işlendi${ev.islem ? ` (${ev.islem})` : ""}.`,
            },
          });
        } else {
          await tx.timelineEvent.create({
            data: {
              tenantId: user.tenantId,
              caseId,
              userId: null,
              date: ev.tarih,
              title: `UYAP: ${ev.islem}`,
              detail: ev.aciklama ?? null,
              source: "UYAP",
            },
          });
        }
      }
      replayed = staged.length;
    });
    return { ok: true, replayed };
  }

  /* ----------------------- Eklenti tarafı: kimlik ----------------------- */

  /** POST /uyap/pair — eşleştirme kodu â†’ extension token çifti. */
  async pair(input: { pairingCode: string; deviceName: string; extensionVersion: string }) {
    const pairing = await this.prisma.client.uyapPairing.findUnique({
      where: { code: input.pairingCode.trim().toUpperCase() },
    });
    if (!pairing) throw new UnauthorizedException("Eşleştirme kodu geçersiz.");
    if (pairing.usedAt) throw new UnauthorizedException("Eşleştirme kodu zaten kullanılmış.");
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: pairing.tenantId },
      select: { name: true },
    });
    if (pairing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Eşleştirme kodunun süresi doldu. Yeni kod üretin.");
    }

    const user = await this.prisma.client.user.findFirst({
      where: { id: pairing.userId, tenantId: pairing.tenantId, isActive: true },
      select: { id: true, fullName: true, email: true },
    });
    if (!user) throw new UnauthorizedException("Kodun sahibi kullanıcı pasif.");

    const accessToken = generateExtensionToken();
    const refreshToken = generateExtensionToken();
    await this.prisma.client.uyapExtensionToken.create({
      data: {
        tenantId: pairing.tenantId,
        userId: pairing.userId,
        deviceName: input.deviceName,
        extensionVersion: input.extensionVersion,
        accessTokenHash: hashToken(accessToken),
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + UYAP_ACCESS_TOKEN_TTL_MS),
      },
    });
    await this.prisma.client.uyapPairing.update({
      where: { id: pairing.id },
      data: { usedAt: new Date() },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: accessExpiry(),
      identity: {
        tenantId: pairing.tenantId,
        tenantName: tenant?.name ?? "",
        userId: user.id,
        userName: user.fullName,
        userEmail: user.email,
      },
    };
  }

  /** POST /uyap/pair/refresh — rotasyonlu yenileme (eski refresh iptal edilir). */
  async refresh(refreshToken: string) {
    const record = await this.prisma.client.uyapExtensionToken.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
    });
    if (!record || record.revokedAt !== null) {
      throw new UnauthorizedException("Yenileme jetonu geçersiz.");
    }
    // 30 günden eski jetonla sonsuz yenileme zinciri kurulamaz.
    if (Date.now() - record.createdAt.getTime() > UYAP_REFRESH_TOKEN_TTL_MS) {
      throw new UnauthorizedException("Yenileme jetonunun süresi doldu; yeniden eşleştirin.");
    }
    const user = await this.prisma.client.user.findFirst({
      where: { id: record.userId, tenantId: record.tenantId },
      select: { id: true, fullName: true, email: true },
    });
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: record.tenantId },
      select: { id: true, name: true },
    });

    const newAccess = generateExtensionToken();
    const newRefresh = generateExtensionToken();
    await this.prisma.client.uyapExtensionToken.update({
      where: { id: record.id },
      data: {
        accessTokenHash: hashToken(newAccess),
        refreshTokenHash: hashToken(newRefresh),
        expiresAt: new Date(Date.now() + UYAP_ACCESS_TOKEN_TTL_MS),
      },
    });

    return {
      accessToken: newAccess,
      refreshToken: newRefresh,
      accessTokenExpiresAt: accessExpiry(),
      identity: {
        tenantId: record.tenantId,
        tenantName: tenant?.name ?? "",
        userId: record.userId,
        userName: user?.fullName ?? "",
        userEmail: user?.email ?? "",
      },
    };
  }

  /* ------------------- Eklenti tarafı: dosya senkronu ------------------- */

  /** UYAP dosya numarası için bağlantı — önce link, sonra esas no eşleşmesi. */
  private async resolveCaseId(tenantId: string, uyapDosyaNo: string): Promise<string | null> {
    const link = await this.prisma.client.uyapCaseLink.findUnique({
      where: { tenantId_uyapDosyaNo: { tenantId, uyapDosyaNo } },
      select: { caseId: true },
    });
    if (link) return link.caseId;
    // Otomatik eşleşme: esas no birebir tutuyorsa bağla.
    const matchingCase = await this.prisma.client.case.findFirst({
      where: { tenantId, fileNumber: uyapDosyaNo },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!matchingCase) return null;
    await this.prisma.client.uyapCaseLink.create({
      data: {
        tenantId,
        uyapDosyaNo,
        caseId: matchingCase.id,
        matchedBy: null, // otomatik
      },
    });
    return matchingCase.id;
  }

  /** POST /uyap/sync/files — dosya listesi senkronu. */
  async syncFiles(identity: { tenantId: string; userId: string }, input: SyncFilesInput) {
    const matched: { uyapDosyaNo: string; caseId: string }[] = [];
    const unmatched: string[] = [];

    for (const file of input.files) {
      const caseId = await this.resolveCaseId(identity.tenantId, file.uyapDosyaNo);
      if (caseId) {
        matched.push({ uyapDosyaNo: file.uyapDosyaNo, caseId });
      } else {
        unmatched.push(file.uyapDosyaNo);
        // Eşleşmeyen dosya kuyruğa düşer — avukat bağlayana dek orada kalır.
        await this.prisma.client.uyapMatchQueue.upsert({
          where: {
            tenantId_uyapDosyaNo: {
              tenantId: identity.tenantId,
              uyapDosyaNo: file.uyapDosyaNo,
            },
          },
          create: {
            tenantId: identity.tenantId,
            uyapDosyaNo: file.uyapDosyaNo,
            payloadJson: JSON.stringify(file),
          },
          update: { payloadJson: JSON.stringify(file) },
        });
      }
    }

    return { accepted: input.files.length, matched, unmatched };
  }

  /** POST /uyap/sync/events — safahat + duruşma kayıtları (idempotent). */
  async syncEvents(identity: { tenantId: string; userId: string }, input: SyncEventsInput) {
    let accepted = 0;
    let duplicates = 0;
    const caseId = await this.resolveCaseId(identity.tenantId, input.uyapDosyaNo);

    for (const event of input.events) {
      const existing = await this.prisma.client.uyapEventRecord.findUnique({
        where: {
          tenantId_externalHash: {
            tenantId: identity.tenantId,
            externalHash: event.externalHash,
          },
        },
        select: { id: true },
      });
      if (existing) {
        duplicates++;
        continue;
      }
      await this.prisma.client.$transaction(async (tx) => {
        await tx.uyapEventRecord.create({
          data: {
            tenantId: identity.tenantId,
            caseId,
            uyapDosyaNo: input.uyapDosyaNo,
            kind: "SAFAHAT",
            externalHash: event.externalHash,
            tarih: new Date(event.tarih),
            islem: event.islem,
            aciklama: event.aciklama ?? null,
            birim: event.birim ?? null,
            sira: event.sira ?? null,
          },
        });
        // Eşleşmiş dosyada safahat, dosya zaman çizelgesine de işlenir.
        if (caseId) {
          await tx.timelineEvent.create({
            data: {
              tenantId: identity.tenantId,
              caseId,
              userId: null,
              date: new Date(event.tarih),
              title: `UYAP: ${event.islem}`,
              detail: event.aciklama ?? null,
              source: "UYAP",
            },
          });
        }
      });
      accepted++;
    }

    // Duruşma kayıtları — çapraz doğrulama: her kaydın kendi dosya numarası
    // gövdedeki ana numarayla UYUÅMALI (docs/05 Â§ 7; ajanda yanlışlığı riski).
    for (const hearing of input.hearings ?? []) {
      if (hearing.uyapDosyaNo !== input.uyapDosyaNo) {
        this.logger.warn(
          `Duruşma kaydının dosya numarası (${hearing.uyapDosyaNo}) gövde numarasıyla ` +
            `uyuşmuyor (${input.uyapDosyaNo}); kayıt REDDEDİLDİ.`,
        );
        continue;
      }
      const existing = await this.prisma.client.uyapEventRecord.findUnique({
        where: {
          tenantId_externalHash: {
            tenantId: identity.tenantId,
            externalHash: hearing.externalHash,
          },
        },
        select: { id: true },
      });
      if (existing) {
        duplicates++;
        continue;
      }
      await this.prisma.client.$transaction(async (tx) => {
        await tx.uyapEventRecord.create({
          data: {
            tenantId: identity.tenantId,
            caseId,
            uyapDosyaNo: hearing.uyapDosyaNo,
            kind: "DURUSMA",
            externalHash: hearing.externalHash,
            tarih: new Date(hearing.tarih),
            islem: hearing.tur ?? "Duruşma",
            aciklama: hearing.aciklama ?? null,
            birim: hearing.salon ?? null,
            sira: null,
            salon: hearing.salon ?? null,
          },
        });
        // Eşleşmiş dosyada duruşma, büro ajandasına girer (PLANLANDI).
        if (caseId) {
          await tx.hearing.create({
            data: {
              tenantId: identity.tenantId,
              caseId,
              type: "DURUSMA",
              status: "PLANLANDI",
              date: new Date(hearing.tarih),
              courtroom: hearing.salon ?? null,
              note: `UYAP Köprüsü'nden senkronlandı${hearing.tur ? ` (${hearing.tur})` : ""}.`,
            },
          });
        }
      });
      accepted++;
    }

    return { accepted, duplicates };
  }

  /* ------------------- Eklenti tarafı: evrak aktarımı ------------------- */

  /** POST /uyap/documents/presign — ek hash kontrolü + ön-imzalı yükleme. */
  async presignDocument(identity: { tenantId: string; userId: string }, input: PresignInput) {
    // Aynı içerik zaten var mı? (yinelenen aktarım)
    const existing = await this.prisma.client.document.findFirst({
      where: { tenantId: identity.tenantId, hash: input.contentHash },
      select: { id: true },
    });
    if (existing) {
      return {
        duplicate: true,
        uploadUrl: null,
        method: "PUT" as const,
        headers: {},
        storageKey: `uyap/${identity.tenantId}/${input.contentHash}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
    const storageKey = `uyap/${identity.tenantId}/${input.contentHash}`;
    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, 300, input.mimeType);
    return {
      duplicate: false,
      uploadUrl,
      method: "PUT" as const,
      headers: { "Content-Type": input.mimeType },
      storageKey,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  /** POST /uyap/documents/commit — Document kaydı + kota + zaman çizelgesi. */
  async commitDocument(identity: { tenantId: string; userId: string }, input: CommitInput) {
    // Yük anahtarı bu kiracıya ait olmalı — başka büronun deposuna yazım yok.
    if (!input.storageKey.startsWith(`uyap/${identity.tenantId}/`)) {
      throw new ForbiddenException("Depo anahtarı bu büroya ait değil.");
    }
    const existing = await this.prisma.client.document.findFirst({
      where: { tenantId: identity.tenantId, hash: input.contentHash },
      select: { id: true },
    });
    if (existing) {
      return { documentId: existing.id, duplicate: true, pipelineRunId: null };
    }

    const caseId = await this.resolveCaseId(identity.tenantId, input.uyapDosyaNo);
    // DİSK KAPISI — UYAP evrağı da kotasına işler.
    await this.diskQuota.assertCanStore(identity.tenantId, input.sizeBytes);
    const document = await this.prisma.client.document.create({
      data: {
        tenantId: identity.tenantId,
        caseId,
        name: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        hash: input.contentHash,
        source: "UYAP",
        uploadedBy: identity.userId,
      },
      select: { id: true },
    });
    await this.diskQuota.recordUsage(identity.tenantId, input.sizeBytes);

    await this.audit.log({
      tenantId: identity.tenantId,
      userId: identity.userId,
      action: "UYAP_BELGE_AKTARIMI",
      entity: "Document",
      entityId: document.id,
      detail: `${input.fileName} Â· ${input.evrakTuru ?? "türü yok"} Â· ${input.uyapDosyaNo}`,
    });

    return { documentId: document.id, duplicate: false, pipelineRunId: null };
  }

  /** GET /uyap/status — izlenen dosyalar, son senkron, kuyruk durumu. */
  async status(identity: { tenantId: string; userId: string }) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: identity.userId },
      select: { id: true, fullName: true, email: true },
    });
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: identity.tenantId },
      select: { name: true },
    });
    const [watchedFileCount, lastEvent, pendingMatchCount, pendingApprovalCount] = await Promise.all([
      this.prisma.client.uyapCaseLink.count({ where: { tenantId: identity.tenantId } }),
      this.prisma.client.uyapEventRecord.findFirst({
        where: { tenantId: identity.tenantId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      this.prisma.client.uyapMatchQueue.count({
        where: { tenantId: identity.tenantId, resolvedAt: null },
      }),
      this.prisma.client.documentActionProposal.count({
        where: { tenantId: identity.tenantId, status: "BEKLIYOR" },
      }),
    ]);
    return {
      identity: {
        tenantId: identity.tenantId,
        tenantName: tenant?.name ?? "",
        userId: identity.userId,
        userName: user?.fullName ?? "",
        userEmail: user?.email ?? "",
      },
      watchedFileCount,
      lastSyncAt: lastEvent?.createdAt ?? null,
      pendingMatchCount,
      pendingApprovalCount,
    };
  }
}
