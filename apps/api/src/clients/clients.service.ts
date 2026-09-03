import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import type { CreateClientInput } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import type { CreateContactInput, UpdateClientInput, UpdateContactInput } from "./clients.dto";

/**
 * Müvekkil yanıtlarında okunan alanlar.
 *
 * `tckn` buradan OKUNUR ama YANITA KONMAZ: `maskClient` ham değeri çıkarır ve
 * yerine `tcknMasked` koyar. Ham değer yalnızca `GET /clients/:id/tckn`
 * ucundan, rol kontrolü ve denetim kaydıyla verilir (bkz. `revealTckn`).
 */
const CLIENT_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  type: true,
  name: true,
  tckn: true,
  taxNumber: true,
  taxOffice: true,
  email: true,
  phone: true,
  address: true,
  iban: true,
  notes: true,
  category: true,
  referenceCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

/** KVKK: sunucu tarafında maskelenmiş TCKN — 12345678901 → 123******01 */
export function maskTckn(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length < 6) return "•".repeat(v.length);
  return `${v.slice(0, 3)}${"*".repeat(Math.max(0, v.length - 5))}${v.slice(-2)}`;
}

/**
 * Ham TCKN'yi yanıttan ÇIKARIR ve yerine maskelenmiş değeri koyar.
 *
 * Maskeleme sunucuda yapılır: istemcide maskelemek yalnızca kozmetiktir,
 * `curl` ile ham değer zaten alınabiliyordu (denetim bulgusu 6).
 */
function maskClient<T extends { tckn?: string | null }>(
  client: T
): Omit<T, "tckn"> & { tcknMasked: string | null } {
  const { tckn, ...rest } = client;
  return { ...rest, tcknMasked: maskTckn(tckn) };
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(
    tenantId: string,
    params: { q?: string; page?: string; limit?: string; category?: string; isActive?: string }
  ) {
    // Entegrasyon notu (C ajani): bu uc kendi tavanini (100) elle hesapliyordu;
    // diger tum liste uclari `resolvePage` kullaniyor. Istemci `MAX_PAGE_SIZE`
    // (200) varsayarken sunucu sessizce 100'e kirpiyordu.
    const pageParams = resolvePage(params, 20);

    const where: Prisma.ClientWhereInput = { tenantId };
    const q = normalizeQuery(params.q);
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { referenceCode: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ];
    }
    if (params.category) {
      where.category = params.category;
    }
    if (params.isActive === "true" || params.isActive === "false") {
      where.isActive = params.isActive === "true";
    }

    const [items, total] = await Promise.all([
      this.prisma.client.client.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pageParams.skip,
        take: pageParams.take,
        select: { ...CLIENT_PUBLIC_SELECT, _count: { select: { cases: true, contacts: true } } },
      }),
      this.prisma.client.client.count({ where }),
    ]);

    return paged(items.map(maskClient), total, pageParams);
  }

  async create(user: AuthUser, input: CreateClientInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkil kaydı oluşturma");

    // F2-Ö-19 (Modül 01, kural 2): mükerrer TCKN/VKN — aynı kimlik numarasıyla
    // ikinci kayıt AÇILAMAZ (409). Mevcut kart görüntülenir; veri ikiye
    // bölünmesinin önü alınır.
    if (input.tckn || input.taxNumber) {
      const dupeField = input.tckn ? "tckn" : "taxNumber";
      const dupeValue = (input.tckn ?? input.taxNumber) as string;
      const existing = await this.prisma.client.client.findFirst({
        where: { tenantId: user.tenantId, [dupeField]: dupeValue },
        select: { id: true, name: true, isActive: true },
      });
      if (existing) {
        throw new ConflictException({
          message:
            `Bu ${dupeField === "tckn" ? "TCKN" : "vergi kimlik numarası"} ile bir müvekkil ` +
            `kaydı zaten var: ${existing.name}${existing.isActive ? "" : " (pasif)"}. ` +
            "Mevcut kaydı güncelleyin; aynı kimlikle ikinci kart açılamaz.",
          existingClientId: existing.id,
        });
      }
    }

    const client = await this.prisma.client.client.create({
      data: { tenantId: user.tenantId, ...input },
      select: CLIENT_PUBLIC_SELECT,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CREATE",
      entity: "Client",
      entityId: client.id,
      detail: client.name,
    });
    return maskClient(client);
  }

  /* ================================================================== *
   * A1 (rakip analizi) — CSV İÇE AKTARMA
   *
   * Pazar taramasında "toplu veri taşıma sihirbazı" pazar genelinde açık
   * bulundu. Büronun mevcut müşteri listesi (Excel/CSV) tek istekte girilir.
   * Mükerrer TCKN/VKN kontrolü create() ile AYNI hattan geçer.
   * ================================================================== */

  /** POST /clients/import — CSV metninden toplu müvekkil aktarımı. */
  async importCsv(user: AuthUser, csv: string) {
    assertRole(user, ROLE_SETS.ONAY, "müvekkil içe aktarma");

    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException("CSV en az bir başlık ve bir veri satırı içermelidir.");
    }
    if (lines.length > 1001) {
      throw new BadRequestException("Tek istekte en fazla 1000 satır içe aktarılabilir.");
    }

    // Başlık: ad;e-posta;telefon;tckn;vkn;adres (Türkçe veya İngilizce kabul)
    const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
    const col = (name: string) => headers.indexOf(name);
    const cName = col("ad") >= 0 ? col("ad") : col("name");
    const cEmail = col("e-posta") >= 0 ? col("e-posta") : col("email");
    const cPhone = col("telefon") >= 0 ? col("telefon") : col("phone");
    const cTckn = col("tckn") >= 0 ? col("tckn") : col("tckn");
    const cVkn = col("vkn") >= 0 ? col("vkn") : col("taxnumber");
    const cAddr = col("adres") >= 0 ? col("adres") : col("address");

    if (cName < 0) {
      throw new BadRequestException(
        "CSV başlığında 'ad' (veya 'name') kolonu bulunamadı. Beklenen biçim: ad;e-posta;telefon;tckn;vkn;adres",
      );
    }

    const results: { row: number; status: "eklendi" | "hata"; message?: string }[] = [];
    let added = 0;
    let failed = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(";").map((c) => c.trim());
      const name = cName >= 0 ? cols[cName] ?? "" : "";
      if (!name) {
        failed++;
        results.push({ row: i + 1, status: "hata", message: "ad boş" });
        continue;
      }

      try {
        const hasTckn = cTckn >= 0 && cols[cTckn];
        const hasVkn = cVkn >= 0 && cols[cVkn];
        const input = {
          name,
          type: (hasTckn || hasVkn ? "TUZEL_KISI" : "GERCEK_KISI") as "TUZEL_KISI" | "GERCEK_KISI",
          ...(cEmail >= 0 && cols[cEmail] ? { email: cols[cEmail] } : {}),
          ...(cPhone >= 0 && cols[cPhone] ? { phone: cols[cPhone] } : {}),
          ...(hasTckn ? { tckn: cols[cTckn] } : {}),
          ...(hasVkn ? { taxNumber: cols[cVkn] } : {}),
          ...(cAddr >= 0 && cols[cAddr] ? { address: cols[cAddr] } : {}),
        };
        // create() mükerrer TCKN/VKN kontrolü yapar (F2-Ö-19).
        await this.create(user, input);
        added++;
        results.push({ row: i + 1, status: "eklendi" });
      } catch (err) {
        failed++;
        results.push({
          row: i + 1,
          status: "hata",
          message: err instanceof Error ? err.message : "bilinmeyen hata",
        });
      }
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_IMPORT",
      entity: "Client",
      detail: `${lines.length - 1} satır işlendi · ${added} eklendi · ${failed} hata`,
    });

    return { total: lines.length - 1, added, failed, results };
  }

  async detail(tenantId: string, id: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId },
      select: {
        ...CLIENT_PUBLIC_SELECT,
        contacts: { orderBy: { fullName: "asc" } },
        cases: {
          orderBy: { openedAt: "desc" },
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            courtName: true,
            fileNumber: true,
            openedAt: true,
            nextHearingAt: true,
            lastActivityAt: true,
            _count: { select: { hearings: true, deadlines: true, tasks: true, documents: true } },
          },
        },
        financialEntries: { orderBy: { date: "desc" }, take: 10 },
      },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }
    return maskClient(client);
  }

  /**
   * GET /clients/:id/tckn — HAM TCKN.
   *
   * KVKK: TCKN özel nitelikli olmayan ancak kimliği doğrudan belirleyen bir
   * kişisel veridir. Ham değer yalnızca bu uçtan, HUKUKİ rollere, ve HER
   * ÇAĞRIDA DENETİM KAYDI düşülerek verilir.
   *
   * Önceden `tckn` her liste/detay yanıtında açık dönüyor, maskeleme yalnızca
   * tarayıcıda yapılıyordu; "Göster" düğmesi hiçbir rol kontrolüne bağlı
   * değildi ve API'ye gitmediği için denetim izi bırakmıyordu — maskeleme
   * fiilen kozmetikti (denetim bulgusu 6).
   */
  async revealTckn(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "müvekkil TCKN bilgisini görüntüleme");
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, name: true, tckn: true },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_TCKN_REVEAL",
      entity: "Client",
      entityId: client.id,
      detail: `${client.name} — TCKN görüntülendi`,
    });
    return { id: client.id, tckn: client.tckn };
  }

  /** PATCH /clients/:id */
  async update(user: AuthUser, id: string, input: UpdateClientInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkil bilgisi güncelleme");
    const existing = await this.requireClient(user.tenantId, id);

    // MÜVEKKİL PASİFLEŞTİRİLİRSE PORTAL ERİŞİMİ DE KESİLİR (denetim bulgusu K-12).
    //
    // `Client.isActive=false` "bu müvekkille çalışmıyoruz" demektir; portal
    // hesabı `PortalPublication` allow-list'indeki dosya, belge ve faturayı
    // görmeye devam ederse bayrak anlamsız kalır. Aynı kanca `poa.revoke()`
    // içinde de vardır — iki yol da erişim kesmelidir.
    const deactivating = input.isActive === false && existing.isActive;

    const { updated, suspendedPortalUsers } = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.client.update({
        where: { id: existing.id },
        data: input as Prisma.ClientUncheckedUpdateInput,
        select: CLIENT_PUBLIC_SELECT,
      });
      if (!deactivating) return { updated: row, suspendedPortalUsers: 0 };
      const portal = await tx.portalUser.updateMany({
        where: { tenantId: user.tenantId, clientId: existing.id, isActive: true },
        data: { isActive: false, sessionsValidFrom: new Date() },
      });
      return { updated: row, suspendedPortalUsers: portal.count };
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_UPDATE",
      entity: "Client",
      entityId: id,
      detail:
        `${updated.name} — güncellenen alanlar: ${Object.keys(input).join(", ")}` +
        (suspendedPortalUsers > 0 ? ` · portal_askiya_alinan=${suspendedPortalUsers}` : ""),
    });
    return { ...maskClient(updated), suspendedPortalUsers };
  }

  async listContacts(tenantId: string, clientId: string) {
    await this.requireClient(tenantId, clientId);
    // İ-28: çıplak dizi yerine SAYFALAMA ZARFI — tüketici (web/mobile) toplam
    // sayıyı bilemeden "hepsi bu kadar" varsayımı yapıyordu. Bir müvekkilin
    // ilgili kişi listesi pratikte kısadır; tavan 500 ile sınırlıdır.
    const contacts = await this.prisma.client.clientContact.findMany({
      where: { clientId },
      orderBy: { fullName: "asc" },
      take: 500,
    });
    return { items: contacts, total: contacts.length, page: 1, limit: 500 };
  }

  /** POST /clients/:id/contacts */
  async createContact(user: AuthUser, clientId: string, input: CreateContactInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "ilgili kişi ekleme");
    await this.requireClient(user.tenantId, clientId);

    const contact = await this.prisma.client.clientContact.create({
      data: { clientId, ...input } as Prisma.ClientContactUncheckedCreateInput,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_CREATE",
      entity: "ClientContact",
      entityId: contact.id,
      detail: contact.fullName,
    });
    return contact;
  }

  /** PATCH /clients/:id/contacts/:contactId */
  async updateContact(user: AuthUser, clientId: string, contactId: string, input: UpdateContactInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "ilgili kişi güncelleme");
    await this.requireContact(user.tenantId, clientId, contactId);

    const contact = await this.prisma.client.clientContact.update({
      where: { id: contactId },
      data: input as Prisma.ClientContactUncheckedUpdateInput,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_UPDATE",
      entity: "ClientContact",
      entityId: contactId,
      detail: contact.fullName,
    });
    return contact;
  }

  /** DELETE /clients/:id/contacts/:contactId */
  async removeContact(user: AuthUser, clientId: string, contactId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "ilgili kişi silme");
    const contact = await this.requireContact(user.tenantId, clientId, contactId);

    await this.prisma.client.clientContact.delete({ where: { id: contactId } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_DELETE",
      entity: "ClientContact",
      entityId: contactId,
      detail: contact.fullName,
    });
    return { ok: true, id: contactId };
  }

  private async requireClient(tenantId: string, id: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }
    return client;
  }

  /* ================================================================== *
   * D6 — MÜKERRER KAYIT BİRLEŞTİRME (Modül 01 kural 10)
   *
   * Birleştirme GERİ ALINAMAZ: tüm bağlı kayıtlar KALAN karta taşınır,
   * birleştirilen kart PASSIVE olur (SİLİNMEZ — KVKK saklama). Yalnız
   * ADMIN/PARTNER yapabilir (ROLE_SETS.ONAY — kural 10). Onay diyaloğunda
   * taşınacak kayıt sayıları GÖSTERİLİR (kural 10): merge-preview ucu
   * bunların verisidir.
   * ================================================================== */

  /** Taşınacak kayıt sayıları — onay diyaloğunun verisi. */
  async mergePreview(user: AuthUser, targetId: string, sourceId: string) {
    assertRole(user, ROLE_SETS.ONAY, "müvekkil birleştirme");
    if (targetId === sourceId) {
      throw new BadRequestException("Bir müvekkil kendisiyle birleştirilemez.");
    }
    const [target, source] = await Promise.all([
      this.requireClient(user.tenantId, targetId),
      this.requireClient(user.tenantId, sourceId),
    ]);
    const counts = await this.mergeCounts(sourceId);
    return {
      target: { id: target.id, name: target.name },
      source: { id: source.id, name: source.name },
      counts,
      totalCount: Object.values(counts).reduce((a, b) => a + b, 0),
      warning:
        "Bu işlem geri alınamaz. Kaynak kartın tüm kayıtları kalıcı olarak hedef karta taşınır ve kaynak kart pasifleşir (silinmez).",
    };
  }

  /** Birleştirme — TEK İŞLEMDE taşır, pasifleştirir, günlükler. */
  async merge(user: AuthUser, targetId: string, sourceId: string) {
    assertRole(user, ROLE_SETS.ONAY, "müvekkil birleştirme");
    if (targetId === sourceId) {
      throw new BadRequestException("Bir müvekkil kendisiyle birleştirilemez.");
    }
    const [target, source] = await Promise.all([
      this.requireClient(user.tenantId, targetId),
      this.requireClient(user.tenantId, sourceId),
    ]);

    // PortalUser e-postası GLOBALLY tekil: iki kartta da aynı e-postalı portal
    // hesabı varsa taşıma tekil kısıtı ihlal eder. İşlemi ÖNCE yakala —
    // yarı taşınmış bir birleştirme (transaction zaten geri alır) yerine
    // anlaşılır hata ver.
    const [targetPortalEmails, sourcePortalEmails] = await Promise.all([
      this.prisma.client.portalUser.findMany({ where: { tenantId: user.tenantId, clientId: targetId }, select: { email: true } }),
      this.prisma.client.portalUser.findMany({ where: { tenantId: user.tenantId, clientId: sourceId }, select: { email: true } }),
    ]);
    const targetEmails = new Set(targetPortalEmails.map((p) => p.email.toLowerCase()));
    const clash = sourcePortalEmails.find((p) => targetEmails.has(p.email.toLowerCase()));
    if (clash) {
      throw new ConflictException(
        `İki kartta da aynı e-postalı portal hesabı var (${clash.email}); birleştirme tekil kısıtı ihlal eder. ` +
          "Önce çakışan portal hesabını temizleyin."
      );
    }

    const counts = await this.mergeCounts(sourceId);

    const merged = await this.prisma.client.$transaction(async (tx) => {
      // 16 ilişki — hepsi clientId üzerinden karta bağlı (şemada kanıtlandı).
      await tx.case.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.clientContact.updateMany({ where: { clientId: sourceId }, data: { clientId: targetId } });
      await tx.powerOfAttorney.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.financialEntry.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.feeAgreement.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.randevu.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.timeEntry.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.invoice.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.payment.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.portalUser.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.portalInvite.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.portalPublication.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.communicationLog.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.outboundMessage.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.inboundMessage.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });
      await tx.contract.updateMany({ where: { tenantId: user.tenantId, clientId: sourceId }, data: { clientId: targetId } });

      // Kaynak kart PASSIVE olur — SİLİNMEZ (KVKK saklama; kural 10).
      await tx.client.update({
        where: { id: sourceId },
        data: {
          isActive: false,
          notes: `D6 birleştirme: "${source.name}" → "${target.name}" kartına birleştirildi (${new Date().toISOString()}); bu kart artık kullanılmamaktadır.`,
        },
      });

      const log = await tx.clientMergeLog.create({
        data: {
          tenantId: user.tenantId,
          survivingClientId: targetId,
          mergedClientId: sourceId,
          countsJson: JSON.stringify(counts),
          mergedById: user.userId,
        },
      });
      return log;
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_MERGE",
      entity: "Client",
      entityId: targetId,
      detail:
        `"${source.name}" kartı "${target.name}" kartına birleştirildi (geri alınamaz). ` +
        `Taşınan kayıtlar: ${JSON.stringify(counts)}. Kaynak kart pasifleştirildi; ClientMergeLog ${merged.id.slice(0, 8)}.`,
    });

    return { ok: true, survivingClientId: targetId, mergedClientId: sourceId, counts };
  }

  /** Kaynak kartın taşınacak kayıt sayıları. */
  private async mergeCounts(sourceId: string): Promise<Record<string, number>> {
    const [cases, contacts, poas, financialEntries, feeAgreements, randevular, timeEntries, invoices, payments, portalUsers, portalInvites, portalPublications, communicationLogs, outboundMessages, inboundMessages, contracts] =
      await Promise.all([
        this.prisma.client.case.count({ where: { clientId: sourceId } }),
        this.prisma.client.clientContact.count({ where: { clientId: sourceId } }),
        this.prisma.client.powerOfAttorney.count({ where: { clientId: sourceId } }),
        this.prisma.client.financialEntry.count({ where: { clientId: sourceId } }),
        this.prisma.client.feeAgreement.count({ where: { clientId: sourceId } }),
        this.prisma.client.randevu.count({ where: { clientId: sourceId } }),
        this.prisma.client.timeEntry.count({ where: { clientId: sourceId } }),
        this.prisma.client.invoice.count({ where: { clientId: sourceId } }),
        this.prisma.client.payment.count({ where: { clientId: sourceId } }),
        this.prisma.client.portalUser.count({ where: { clientId: sourceId } }),
        this.prisma.client.portalInvite.count({ where: { clientId: sourceId } }),
        this.prisma.client.portalPublication.count({ where: { clientId: sourceId } }),
        this.prisma.client.communicationLog.count({ where: { clientId: sourceId } }),
        this.prisma.client.outboundMessage.count({ where: { clientId: sourceId } }),
        this.prisma.client.inboundMessage.count({ where: { clientId: sourceId } }),
        this.prisma.client.contract.count({ where: { clientId: sourceId } }),
      ]);
    return {
      dosya: cases,
      yetkili: contacts,
      vekaletname: poas,
      finansKaydi: financialEntries,
      ucretSozlesmesi: feeAgreements,
      randevu: randevular,
      zamanKaydi: timeEntries,
      fatura: invoices,
      odeme: payments,
      portalHesabi: portalUsers,
      portalDaveti: portalInvites,
      portalYayini: portalPublications,
      iletisimKaydi: communicationLogs,
      gidenMesaj: outboundMessages,
      gelenMesaj: inboundMessages,
      sozlesme: contracts,
    };
  }

  /* ================================================================== *
   * KVKK m.11 — VERİ ÖZNE ERİŞİM HAKKI: TAM DIŞA AKTARMA (F2 · A1)
   *
   * Politika matrisi (docs/kvkk-politika-matrisi.md) K1-K7 satırları:
   * müvekkil talebi gelince bu büronun MÜVEKKİL HAKKINDA tuttuğu TÜM
   * veriler TEK yanıtla, makine-okunur JSON olarak verilir. Veri özne
   * talebe yanıt olarak kullanılır; başlatan AVUKATTIR (veri özne kendisi
   * portal hesabıyla gelmez — portal evreni yalnız yayınlanmış içerikleri
   * görür).
   *
   * NELER GİRER: kimlik (ham TCKN DAHİL — erişim hakkı kapsamında), ilgili
   * kişiler, dosyalar ve durumları, süreler, duruşmalar, görevler, notlar,
   * kararlar, belge LİSTESİ (yalnızca üstveri — belge içerikleri ayrıca
   * indirilebilir), faturalar, ödemeler, vekaletler, iletişim kayıtları.
   * NELER GİRMEZ: RAG öbekleri (yeniden üretilebilir), denetim izleri
   * (başkasının eylem kaydı, ayrı kategori K8), başka müvekkillerin verisi.
   * ================================================================== */

  /** GET /clients/:id/export — müvekkil bazlı KVKK dışa aktarma. */
  async exportClientData(user: AuthUser, clientId: string) {
    // Rol kapısı: talep fiilen avukatça yönetilir; veri özne yanıtı avukat
    // üzerinden döner (TBB üsul ilkesi — vekil, müvekkilin verisini alır).
    assertRole(user, ROLE_SETS.ONAY, "müvekkil veri dışa aktarma");

    const client = await this.prisma.client.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      include: { contacts: true },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }

    const tenantId = user.tenantId;
    const [cases, invoices, payments, poas, messages] = await Promise.all([
      this.prisma.client.case.findMany({
        where: { tenantId, clientId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileNumber: true,
          title: true,
          type: true,
          status: true,
          courtName: true,
          subject: true,
          openedAt: true,
          closedAt: true,
          createdAt: true,
          deadlines: {
            select: { title: true, dueDate: true, status: true, source: true },
          },
          hearings: { select: { date: true, status: true, note: true } },
          tasks: { select: { title: true, status: true, dueDate: true } },
          notes: { select: { content: true, createdAt: true } },
          decisions: { select: { type: true, outcome: true, date: true, summary: true } },
          documents: {
            select: { id: true, name: true, class: true, mimeType: true, sizeBytes: true, createdAt: true },
          },
        },
      }),
      this.prisma.client.invoice.findMany({
        where: { tenantId, clientId },
        orderBy: { issueDate: "asc" },
        select: { invoiceNo: true, status: true, issueDate: true, dueDate: true, total: true, currency: true },
      }),
      this.prisma.client.payment.findMany({
        where: { tenantId, clientId },
        orderBy: { date: "asc" },
        select: { amount: true, currency: true, date: true, method: true, reference: true, note: true },
      }),
      this.prisma.client.powerOfAttorney.findMany({
        where: { tenantId, clientId },
        orderBy: { issuedAt: "asc" },
        select: { number: true, scope: true, issuedAt: true, expiresAt: true, revokedAt: true, type: true },
      }),
      this.prisma.client.outboundMessage.findMany({
        where: { tenantId, clientId },
        orderBy: { createdAt: "asc" },
        select: { channel: true, subject: true, finalBody: true, status: true, createdAt: true },
      }),
    ]);

    const caseIds = cases.map((c) => c.id);
    const [inbound, financialEntries, portalUsers] = await Promise.all([
      caseIds.length > 0
        ? this.prisma.client.inboundMessage.findMany({
            where: { tenantId, caseId: { in: caseIds } },
            orderBy: { receivedAt: "asc" },
            select: { channel: true, fromRef: true, subject: true, body: true, receivedAt: true },
          })
        : Promise.resolve([]),
      // F2-Ö-15: manifest K6 (finans) beyan ediyor ama FinancialEntry eksikti.
      this.prisma.client.financialEntry.findMany({
        where: { tenantId, clientId },
        orderBy: { date: "asc" },
        select: { type: true, amount: true, currency: true, date: true, description: true },
      }),
      // F2-Ö-15: manifest K1 beyan ediyor ama PortalUser kaydı eksikti.
      this.prisma.client.portalUser.findMany({
        where: { tenantId, clientId },
        select: { email: true, fullName: true, isActive: true, createdAt: true },
      }),
    ]);

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: "CLIENT_DATA_EXPORT",
      entity: "Client",
      entityId: client.id,
      detail: `KVKK m.11 erişim hakkı yanıtı — ${cases.length} dosya, ${invoices.length} fatura`,
    });

    return {
      // KVKK manifesto: veri özne yanıtı makine-okunur ve eksizsizdir.
      manifest: {
        amac: "KVKK m.11 — veri sahibinin erişim hakkı kapsamında tam dışa aktarma",
        uretimZamani: new Date().toISOString(),
        buroVeriKategorileri: ["K1", "K2", "K3", "K4", "K5-ustveri", "K6", "K7"],
        kapsamDisi: [
          "RAG öbekleri (yeniden üretilebilir)",
          "denetim izleri (K8 — eylem kaydı)",
        ],
        politikaMatrisi: "docs/kvkk-politika-matrisi.md",
      },
      musteri: client,
      dosyalar: cases,
      faturalar: invoices,
      odemeler: payments,
      vekaletler: poas,
      gidenMesajlar: messages,
      gelenMesajlar: inbound,
      // F2-Ö-15: manifestin beyan ettiği K1 (PortalUser) ve K6 (FinancialEntry)
      // artık yanıtta GERÇEKTEN var.
      portalKullanicilari: portalUsers,
      finansKayitlari: financialEntries,
    };
  }

  private async requireContact(tenantId: string, clientId: string, contactId: string) {
    await this.requireClient(tenantId, clientId);
    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, clientId },
      select: { id: true, fullName: true },
    });
    if (!contact) {
      throw new NotFoundException("İlgili kişi kaydı bulunamadı.");
    }
    return contact;
  }
}
