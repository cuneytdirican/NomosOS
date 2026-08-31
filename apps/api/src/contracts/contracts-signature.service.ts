/**
 * SÖZLEŞME ↔ E-İMZA KÖPRÜSÜ.
 *
 * Bu servis @nomosos/e-signature'ın `ISignatureProvider` sözleşmesinden
 * BAŞKA HİÇBİR ŞEY bilmez. Yeni bir NES/mobil imza sağlayıcısı eklendiğinde
 * burada tek satır değişmez.
 *
 * ── SAHTE İMZA ÜRETİLMEZ ────────────────────────────────────────────────────
 * Gerçek sağlayıcı kimlik bilgisi YOKTUR. `createSignatureProvider` bugün her
 * çağrıda `NoopSignatureProvider` döndürür ve o da "yapılandırılmamış" hatası
 * fırlatır. Bu durumda:
 *   • `SignatureRequest` kaydı AÇILMAZ (providerRef'i olmayan hayalet kayıt
 *     bırakmayız; girişim `AuditLog`da durur),
 *   • sözleşme IMZAYA_HAZIR durumunda KALIR,
 *   • istemciye 503 + "Ayarlar → E-imza" yönlendirmesi döner.
 *
 * ── SAĞLAYICI SEÇİMİ ────────────────────────────────────────────────────────
 * Şemada e-imza yapılandırma tablosu YOKTUR (Faz 5 şeması onu içermiyor).
 * Sağlayıcı anahtarı `ESIGNATURE_PROVIDER` ortam değişkeninden okunur;
 * tanımsızsa "noop"tur. Kiracı bazlı yapılandırma eklendiğinde tek değişecek
 * yer `resolveProviderKey`dir.
 *
 * SAĞLAYICI DEĞİŞİMİ AÇIK SÜREÇLERİ ETKİLEMEZ: mevcut bir talebin durumu
 * sorulurken KAYDIN KENDİ `provider` alanı kullanılır, güncel ayar değil
 * (docs/moduller/20, iş kuralı 9).
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SignatureStatus } from "@nomosos/db";
import {
  NOOP_PROVIDER_KEY,
  assertSignatureTransition,
  createSignatureProvider,
  isSignatureProviderError,
  validateSigners,
  type ISignatureProvider,
  type SignatureRequestStatus,
  type Signer,
} from "@nomosos/e-signature";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import type {
  CancelSignatureRequestInput,
  CreateSignatureRequestInput,
} from "./contracts.dto";

@Injectable()
export class ContractsSignatureService {
  private readonly logger = new Logger(ContractsSignatureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Ayarlar → E-imza ekranının veri kaynağı. GET /signature-providers/health */
  async health() {
    const key = this.resolveProviderKey();
    const provider = createSignatureProvider({ provider: key });
    const report = await provider.healthCheck();
    return {
      ...report,
      configuredVia: "ESIGNATURE_PROVIDER ortam değişkeni",
      note: report.configured
        ? null
        : "Bu kurulumda gerçek bir e-imza sağlayıcısı tanımlı değildir. Sistem SAHTE İMZA " +
          "ÜRETMEZ: imza talebi oluşturma denemeleri anlaşılır bir hatayla sonuçlanır ve " +
          "sözleşme imza öncesi durumunda kalır.",
    };
  }

  /**
   * POST /contracts/:id/signature-request
   *
   * Sözleşme IMZAYA_HAZIR olmalıdır ve imzalanacak sürüm ZORUNLUDUR
   * (docs/moduller/20, iş kuralı 3).
   */
  async createRequest(
    user: AuthUser,
    contractId: string,
    input: CreateSignatureRequestInput,
  ) {
    // İmza süreci başlatma AVUKAT ve üstüne aittir (iş kuralı 10).
    assertRole(user, ROLE_SETS.HUKUKI, "e-imza süreci başlatma");

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: {
        id: true,
        title: true,
        status: true,
        currentVersionId: true,
        client: { select: { name: true } },
      },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");

    if (contract.status !== "IMZAYA_HAZIR") {
      throw new ConflictException(
        `İmza süreci yalnızca "İmzaya hazır" durumundaki sözleşmeler için başlatılabilir. ` +
          `Sözleşme şu anda "${contract.status}" durumunda.`,
      );
    }

    const versionId = input.versionId ?? contract.currentVersionId;
    if (!versionId) {
      throw new BadRequestException(
        "İmzalanacak sürüm belirlenemedi. Sözleşmenin nihai metnini bir sürüm olarak ekleyin.",
      );
    }
    const version = await this.prisma.client.contractVersion.findFirst({
      where: { id: versionId, contract: { id: contractId, tenantId: user.tenantId } },
      select: { id: true, versionNo: true, contentText: true, documentId: true },
    });
    if (!version) throw new NotFoundException("Sözleşme sürümü bulunamadı.");

    // Aynı sürüm için AÇIK bir süreç varsa ikincisi başlatılamaz.
    const open = await this.prisma.client.signatureRequest.findFirst({
      where: {
        tenantId: user.tenantId,
        contractId,
        status: { in: ["OLUSTURULDU", "GONDERILDI"] },
      },
      select: { id: true, status: true },
    });
    if (open) {
      throw new ConflictException(
        `Bu sözleşme için hâlâ açık bir imza süreci var (${open.id}, durum: ${open.status}). ` +
          "Yeni süreç başlatmadan önce mevcut süreci iptal edin.",
      );
    }

    const providerKey = this.resolveProviderKey();
    const provider = createSignatureProvider({ provider: providerKey });

    // İMZACI DOĞRULAMASI ÇEKİRDEKTE: sağlayıcı yapılandırılmamış olsa da
    // hatalı liste burada, Türkçe ve toplu olarak reddedilir.
    const signers: Signer[] = input.signers.map((s) => ({
      fullName: s.fullName,
      email: s.email,
      ...(s.phone ? { phone: s.phone } : {}),
      role: s.role,
      ...(s.order !== undefined ? { order: s.order } : {}),
      ...(s.method ? { method: s.method } : {}),
    }));
    const validated = this.runValidation(() =>
      validateSigners(signers, {
        method: input.method,
        sequential: input.sequential,
        supportedMethods: provider.supportedMethods.length ? provider.supportedMethods : undefined,
        providerKey,
      }),
    );
    // HER İMZACIYA YÖNTEM AÇIKÇA YAZILIR. `SignatureRequest` şemasında süreç
    // yöntemi için ayrı bir kolon YOKTUR; yöntem imzacı kaydında taşınır ve
    // `present()` sürecin yöntemini buradan türetir. Böylece migration
    // gerektirmeden "hangi yöntemle imzalandı" sorusu cevaplanabilir kalır.
    const normalized = validated.map((s) => ({ ...s, method: s.method ?? input.method }));

    // ── SAĞLAYICI ÇAĞRISI ──────────────────────────────────────────────────
    let result;
    try {
      result = await provider.createRequest(
        {
          fileName: `${slug(contract.title)}-v${version.versionNo}.pdf`,
          mimeType: "application/pdf",
          title: contract.title,
          // Nihai metin sürümde durur; belge deposu anahtarı varsa o kullanılır.
          content: new TextEncoder().encode(version.contentText),
          ...(version.documentId ? { storageKey: version.documentId } : {}),
        },
        normalized,
        {
          method: input.method,
          ...(input.sequential !== undefined ? { sequential: input.sequential } : {}),
          ...(input.expiresInDays !== undefined ? { expiresInDays: input.expiresInDays } : {}),
          subject: input.subject ?? `İmzanız bekleniyor: ${contract.title}`,
          ...(input.message ? { message: input.message } : {}),
          language: "tr",
        },
      );
    } catch (err) {
      // KAYIT AÇILMAZ: sözleşme IMZAYA_HAZIR'da kalır, hayalet süreç oluşmaz.
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "CONTRACT_SIGNATURE_REQUEST_FAILED",
        entity: "Contract",
        entityId: contract.id,
        detail: `sağlayıcı=${providerKey} hata=${describe(err)}`,
      });
      throw this.toHttpError(err, providerKey);
    }

    const created = await this.prisma.client.signatureRequest.create({
      data: {
        tenantId: user.tenantId,
        contractId: contract.id,
        versionId: version.id,
        provider: providerKey,
        providerRef: result.providerRef,
        status: result.status as SignatureStatus,
        signersJson: JSON.stringify(result.signers),
        sentAt: result.status === "GONDERILDI" ? new Date() : null,
        createdBy: user.userId,
      },
    });

    // Süreç gerçekten başladıysa sözleşme IMZADA'ya geçer.
    await this.prisma.client.contract.update({
      where: { id: contract.id },
      data: { status: "IMZADA" },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_SIGNATURE_REQUEST_CREATE",
      entity: "SignatureRequest",
      entityId: created.id,
      detail:
        `sözleşme=${contract.id} sürüm=v${version.versionNo} sağlayıcı=${providerKey} ` +
        `yöntem=${input.method} imzacı=${normalized.length}`,
    });

    return this.present(created, result.signers);
  }

  /**
   * GET /signature-requests/:id/status
   *
   * ROL KAPISI (denetim bulgusu 14a): bu uç SALT OKUR görünür ama değildir —
   * uzak durumu senkronlar, yerel kaydı `IMZALANDI`'ya geçirir, imzalı nüshayı
   * indirip belge deposuna yazar. Yani sözleşmenin yürürlüğe alınabilir hâle
   * gelmesindeki adımı bu uç atar. İmza sürecini BAŞLATMAK ve İPTAL ETMEK
   * `HUKUKI`ye aitken, onu tamamlamanın herkese açık olması tutarsızdı.
   * Kapı `OPERASYON`'dur: sekreter süreci takip edebilmeli, stajyer edememeli.
   */
  async status(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.OPERASYON, "e-imza süreci durumunu sorgulama");
    const record = await this.findOrThrow(user, id);

    // Süreç sağlayıcıya HİÇ gitmemişse (providerRef yok) yerel durum döner;
    // olmayan bir uzak süreci sormak anlamsızdır.
    if (!record.providerRef) {
      return {
        ...this.present(record, parseSigners(record.signersJson)),
        remoteChecked: false,
        note: "Bu talep sağlayıcıya iletilmemiştir; durum yerel kayıttan okunmuştur.",
      };
    }

    // Kaydın KENDİ sağlayıcısı kullanılır — ayar değişse bile.
    const provider = createSignatureProvider({ provider: record.provider });
    let remote;
    try {
      remote = await provider.getStatus(record.providerRef);
    } catch (err) {
      throw this.toHttpError(err, record.provider);
    }

    const updated = await this.applyRemoteStatus(user, record, provider, remote.status, {
      signers: remote.signers,
      failureReason: remote.failureReason,
      completedAt: remote.completedAt,
    });

    return { ...this.present(updated, remote.signers), remoteChecked: true, note: null };
  }

  /**
   * POST /signature-requests/:id/cancel
   *
   * Sağlayıcıya iletilmemiş bir talep YERELDE iptal edilir (uzak çağrı yok).
   * İletilmişse önce sağlayıcı iptal edilir; sağlayıcı hata verirse yerel
   * kayıt DEĞİŞTİRİLMEZ — "iptal ettik" demek, sağlayıcıda süreç açıkken
   * yalan olurdu.
   */
  async cancel(user: AuthUser, id: string, input: CancelSignatureRequestInput) {
    assertRole(user, ROLE_SETS.HUKUKI, "e-imza sürecini iptal etme");
    const record = await this.findOrThrow(user, id);

    // Paket NestJS bilmez: `SignatureStateError` HTTP karşılığına ÇEVRİLMELİDİR,
    // aksi hâlde geçersiz iptal denemesi 400 yerine 500 olarak dönerdi.
    this.runValidation(() =>
      assertSignatureTransition(record.status as SignatureRequestStatus, "IPTAL", record.provider),
    );

    if (record.providerRef) {
      const provider = createSignatureProvider({ provider: record.provider });
      try {
        await provider.cancel(record.providerRef, input.reason ?? undefined);
      } catch (err) {
        throw this.toHttpError(err, record.provider);
      }
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.signatureRequest.update({
        where: { id: record.id },
        data: {
          status: "IPTAL",
          failureReason: input.reason ?? "Kullanıcı tarafından iptal edildi.",
        },
      });
      // İmza süreci iptal edilince sözleşme imza öncesine döner (iş kuralı 1:
      // geriye geçiş yalnız IMZADA → IMZAYA_HAZIR).
      const contract = await tx.contract.findUnique({
        where: { id: record.contractId },
        select: { id: true, status: true },
      });
      if (contract?.status === "IMZADA") {
        await tx.contract.update({
          where: { id: contract.id },
          data: { status: "IMZAYA_HAZIR" },
        });
      }
      return row;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_SIGNATURE_REQUEST_CANCEL",
      entity: "SignatureRequest",
      entityId: record.id,
      detail: `sağlayıcı=${record.provider} gerekçe=${input.reason ?? "-"}`,
    });

    return this.present(updated, parseSigners(updated.signersJson));
  }

  /** GET /contracts/:id/signature-requests */
  async listForContract(user: AuthUser, contractId: string) {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundException("Sözleşme bulunamadı.");

    const rows = await this.prisma.client.signatureRequest.findMany({
      where: { tenantId: user.tenantId, contractId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { items: rows.map((r) => this.present(r, parseSigners(r.signersJson))) };
  }

  // ================================================================== //
  // İç yardımcılar
  // ================================================================== //

  /**
   * Sağlayıcıdan gelen durumu DURUM MAKİNESİNDEN geçirerek kaydeder.
   * Tabloya uymayan bir geçiş sessizce yazılmaz: hata fırlar, uyumsuzluk görünür olur.
   */
  private async applyRemoteStatus(
    user: AuthUser,
    record: {
      id: string;
      contractId: string;
      versionId: string;
      status: string;
      provider: string;
      providerRef: string | null;
      signedDocumentId: string | null;
    },
    provider: ISignatureProvider,
    remoteStatus: SignatureRequestStatus,
    extra: { signers?: unknown; failureReason?: string; completedAt?: Date },
  ) {
    const from = record.status as SignatureRequestStatus;
    if (from === remoteStatus) {
      // Durum değişmemiş olsa da imzalı nüsha hâlâ eksik olabilir (önceki
      // senkronda indirme başarısız olmuş olabilir); eksikse yeniden denenir.
      if (remoteStatus === "IMZALANDI" && !record.signedDocumentId) {
        await this.captureSignedDocument(user, record, provider);
      }
      return this.prisma.client.signatureRequest.findUniqueOrThrow({ where: { id: record.id } });
    }
    // Sağlayıcı tabloya uymayan bir durum bildirdiyse kayıt SESSİZCE EZİLMEZ;
    // hata HTTP karşılığına çevrilerek yüzeye çıkar (uyumsuzluk görünür olur).
    this.runValidation(() => assertSignatureTransition(from, remoteStatus, record.provider));

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.signatureRequest.update({
        where: { id: record.id },
        data: {
          status: remoteStatus as SignatureStatus,
          ...(extra.signers ? { signersJson: JSON.stringify(extra.signers) } : {}),
          ...(extra.failureReason ? { failureReason: extra.failureReason } : {}),
          ...(remoteStatus === "GONDERILDI" ? { sentAt: new Date() } : {}),
          ...(remoteStatus === "IMZALANDI"
            ? { completedAt: extra.completedAt ?? new Date() }
            : {}),
        },
      });

      // İmza tamamlandıysa sözleşme YÜRÜRLÜĞE GİRMEZ — yalnız durum aktarılır.
      // Yürürlük tarihi ve nihai onay avukatın işidir (durum geçişi ucundan).
      return row;
    });

    // ── İMZALI NÜSHA VE KANIT PAKETİ (denetim bulgusu 1) ───────────────────
    //
    // `downloadSignedDocument` kod tabanının HİÇBİR YERİNDEN çağrılmıyordu;
    // `applyRemoteStatus` IMZALANDI'ya geçerken yalnız `completedAt` yazıyordu.
    // Yani `signedDocumentId` YAPISAL OLARAK DAİMA NULL kalıyordu ve Modül 20
    // iş kuralı 7'nin "imza kanıt paketi" hiç oluşmuyordu. Gerçek bir sağlayıcı
    // takıldığında sözleşme, imzalı nüsha hiç alınmadan yürürlüğe girecekti.
    if (remoteStatus === "IMZALANDI") {
      await this.captureSignedDocument(user, { ...record, ...updated }, provider);
      return this.prisma.client.signatureRequest.findUniqueOrThrow({ where: { id: record.id } });
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_SIGNATURE_STATUS_SYNC",
      entity: "SignatureRequest",
      entityId: record.id,
      detail: `${from} → ${remoteStatus} (sağlayıcı=${record.provider})`,
    });

    return updated;
  }

  /**
   * İMZALI NÜSHAYI SAĞLAYICIDAN ÇEKER, BELGE DEPOSUNA YAZAR, KAYDA BAĞLAR.
   *
   * Bu adım olmadan `SignatureRequest.signedDocumentId` hiç dolmuyordu ve
   * "imzalandı" iddiasının arkasında hiçbir nesne durmuyordu — durum sütununa
   * yazılmış bir kelimeden ibaretti.
   *
   * HATA YUTULMAZ AMA DURUMU DA DÜŞÜRMEZ: sağlayıcı "imzalandı" diyorsa bu bir
   * olgudur ve kayıt edilmelidir; nüshanın indirilememesi ayrı bir sorundur.
   * `failureReason`'a yazılır, denetime düşer ve `signedDocumentId` boş kalır —
   * bu da sözleşmenin YÜRÜRLÜĞE ALINMASINI engeller (bkz. contracts.service.ts
   * `transition`), yani eksiklik sessizce geçilmez.
   */
  private async captureSignedDocument(
    user: AuthUser,
    record: {
      id: string;
      contractId: string;
      versionId: string;
      provider: string;
      providerRef: string | null;
    },
    provider: ISignatureProvider,
  ): Promise<void> {
    if (!record.providerRef) return;

    let signed;
    try {
      signed = await provider.downloadSignedDocument(record.providerRef);
    } catch (err) {
      const reason = `İmzalı nüsha sağlayıcıdan alınamadı: ${describe(err)}`;
      this.logger.error(`${reason} (talep ${record.id})`);
      await this.prisma.client.signatureRequest.update({
        where: { id: record.id },
        data: { failureReason: reason.slice(0, 1000) },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "CONTRACT_SIGNED_DOCUMENT_FETCH_FAILED",
        entity: "SignatureRequest",
        entityId: record.id,
        detail: reason.slice(0, 500),
      });
      return;
    }

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: record.contractId, tenantId: user.tenantId },
      select: { id: true, title: true, caseId: true },
    });
    if (!contract) return;

    const buffer = Buffer.from(signed.content);
    // BÜTÜNLÜK KANITI: sağlayıcı bir özet verdiyse doğrulanır, vermediyse
    // kendi özetimizi hesaplayıp saklarız. İmzalı nüshanın sonradan değişip
    // değişmediği ancak böyle gösterilebilir.
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (signed.sha256 && signed.sha256.toLowerCase() !== sha256) {
      const reason =
        "İmzalı nüshanın özeti sağlayıcının bildirdiği özetle UYUŞMUYOR; nüsha " +
        "kaydedilmedi. Bu bir bütünlük uyarısıdır.";
      this.logger.error(`${reason} (talep ${record.id})`);
      await this.prisma.client.signatureRequest.update({
        where: { id: record.id },
        data: { failureReason: reason },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "CONTRACT_SIGNED_DOCUMENT_HASH_MISMATCH",
        entity: "SignatureRequest",
        entityId: record.id,
        detail: reason,
      });
      return;
    }

    const document = await this.prisma.client.document.create({
      data: {
        tenantId: user.tenantId,
        caseId: contract.caseId,
        name: signed.fileName || `${contract.title} — imzalı nüsha.pdf`,
        class: "SOZLESME",
        classSource: "SISTEM",
        mimeType: signed.mimeType || "application/pdf",
        sizeBytes: buffer.byteLength,
        storageKey: "",
        hash: sha256,
        source: "SISTEM",
        uploadedBy: user.userId,
      },
      select: { id: true, name: true },
    });

    const storageKey = this.storage.buildObjectKey({
      tenantId: user.tenantId,
      caseId: contract.caseId,
      documentId: document.id,
      fileName: document.name,
    });
    try {
      await this.storage.putObject(storageKey, buffer, signed.mimeType || "application/pdf");
    } catch (err) {
      // Depoya yazılamadıysa YETİM BELGE KAYDI BIRAKILMAZ.
      await this.prisma.client.document.delete({ where: { id: document.id } });
      this.logger.error(`İmzalı nüsha depoya yazılamadı (talep ${record.id}): ${describe(err)}`);
      await this.prisma.client.signatureRequest.update({
        where: { id: record.id },
        data: { failureReason: `İmzalı nüsha depoya yazılamadı: ${describe(err)}`.slice(0, 1000) },
      });
      return;
    }

    await this.prisma.client.$transaction([
      this.prisma.client.document.update({ where: { id: document.id }, data: { storageKey } }),
      this.prisma.client.signatureRequest.update({
        where: { id: record.id },
        data: { signedDocumentId: document.id, failureReason: null },
      }),
    ]);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CONTRACT_SIGNED_DOCUMENT_STORED",
      entity: "SignatureRequest",
      entityId: record.id,
      detail:
        `sözleşme=${record.contractId} sürüm=${record.versionId} belge=${document.id} ` +
        `sha256=${sha256} sağlayıcı=${record.provider}` +
        (signed.evidence ? " · kanıt paketi alındı" : " · sağlayıcı kanıt paketi göndermedi"),
    });
  }

  private async findOrThrow(user: AuthUser, id: string) {
    const row = await this.prisma.client.signatureRequest.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!row) throw new NotFoundException("İmza talebi bulunamadı.");
    return row;
  }

  /** Yanıt biçimi — `signersJson` ham metin olarak DIŞARI ÇIKMAZ. */
  private present(
    row: {
      id: string;
      contractId: string;
      versionId: string;
      provider: string;
      providerRef: string | null;
      status: string;
      signersJson: string;
      sentAt: Date | null;
      completedAt: Date | null;
      signedDocumentId: string | null;
      failureReason: string | null;
      createdBy: string;
      createdAt: Date;
    },
    signers: unknown,
  ) {
    return {
      id: row.id,
      contractId: row.contractId,
      versionId: row.versionId,
      provider: row.provider,
      providerConfigured: row.provider !== NOOP_PROVIDER_KEY,
      providerRef: row.providerRef,
      status: row.status,
      /** Sürecin yöntemi — imzacı kayıtlarından türetilir (şemada kolon yok). */
      method: firstSignerMethod(signers),
      signers,
      sentAt: row.sentAt,
      completedAt: row.completedAt,
      signedDocumentId: row.signedDocumentId,
      failureReason: row.failureReason,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  /** `ESIGNATURE_PROVIDER` ortam değişkeni; tanımsızsa yapılandırılmamış. */
  private resolveProviderKey(): string {
    const key = process.env.ESIGNATURE_PROVIDER?.trim();
    return key && key.length > 0 ? key.toLowerCase() : NOOP_PROVIDER_KEY;
  }

  /** Doğrulama hatasını 400'e çevirir (paket NestJS bilmez). */
  private runValidation<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw this.toHttpError(err, "-");
    }
  }

  /**
   * @nomosos/e-signature hatalarını HTTP karşılıklarına çevirir.
   * Ham sağlayıcı gövdesi (anahtar ipucu taşıyabilir) istemciye GİTMEZ.
   */
  private toHttpError(err: unknown, providerKey: string): Error {
    if (!isSignatureProviderError(err)) {
      this.logger.error(
        `E-imza sağlayıcısı beklenmeyen hata verdi (${providerKey}): ${describe(err)}`,
      );
      return new ServiceUnavailableException(
        "E-imza sağlayıcısına ulaşılamadı. Lütfen daha sonra tekrar deneyin.",
      );
    }
    switch (err.code) {
      case "IMZACI_DOGRULAMA":
        return new BadRequestException(err.message);
      case "GECERSIZ_DURUM_GECISI":
        return new BadRequestException(err.message);
      case "SAGLAYICI_YAPILANDIRILMAMIS":
        // 503: geçici değil ama İSTEMCİ HATASI da değil — kurulum eksiği.
        return new ServiceUnavailableException(err.message);
      case "SUREC_BULUNAMADI":
        return new NotFoundException(err.message);
      case "BELGE_HAZIR_DEGIL":
        return new ConflictException(err.message);
      default:
        this.logger.warn(`E-imza sağlayıcı hatası (${providerKey}): ${err.message}`);
        return new ServiceUnavailableException(err.message);
    }
  }
}

/** İmzacı listesindeki ilk `method` değeri — sürecin yöntemi. */
function firstSignerMethod(signers: unknown): string | null {
  if (!Array.isArray(signers)) return null;
  for (const s of signers) {
    if (s && typeof s === "object") {
      const m = (s as Record<string, unknown>).method;
      if (typeof m === "string" && m.length > 0) return m;
    }
  }
  return null;
}

function parseSigners(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return [];
  }
}

function slug(text: string): string {
  return (
    text
      .toLocaleLowerCase("tr-TR")
      .replace(/[ğ]/g, "g")
      .replace(/[ü]/g, "u")
      .replace(/[ş]/g, "s")
      .replace(/[ı]/g, "i")
      .replace(/[ö]/g, "o")
      .replace(/[ç]/g, "c")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sozlesme"
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
