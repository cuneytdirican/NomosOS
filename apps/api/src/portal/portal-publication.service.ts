import { Injectable, NotFoundException } from "@nestjs/common";
import type { PortalResourceType } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import type { PortalAuthUser } from "./portal.types";

/** Aktif bir yayın kaydının portala taşıdığı bilgi. */
export interface ActivePublication {
  /** Yayınlanan kaydın id'si (Case.id / Document.id / ...). */
  resourceId: string;
  /** Avukatın yayın notu — SAFAHAT_KAYDI'nda müvekkile gösterilen DONDURULMUŞ metin. */
  note: string | null;
  publishedAt: Date;
}

/**
 * Bir kaynağın gerçek sahibi — ALLOW-LIST'İN İKİNCİ AYAĞI.
 * `clientId` null ise kaynak bir müvekkile bağlanamıyordur (ör. dosyasız belge).
 */
interface ResourceOwner {
  clientId: string | null;
  /** Kaynağın bağlı olduğu dosya — üst yayın (cascade) kontrolü için. */
  caseId: string | null;
}

/**
 * Üst dosya yayını ARANAN kaynak türleri (spec §İş Kuralları 3).
 *
 * "Bir dosyanın portalda görünmesi için önce DOSYA tipinde yayın kaydı
 * gerekir; dosya yayından kaldırılırsa altındaki TÜM kaynaklar da görünmez
 * olur." Bu küme, o kuralın makine tarafından okunabilir hâlidir.
 *
 * FATURA / ODEME dışarıdadır: fatura dosyaya değil MÜVEKKİLE bağlıdır
 * (Invoice.caseId yoktur). MESAJ da dosyasız olabilir.
 */
const CASE_SCOPED_TYPES: ReadonlySet<PortalResourceType> = new Set<PortalResourceType>([
  "BELGE",
  "DURUSMA",
  "SAFAHAT_KAYDI",
]);

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PORTAL GÖRÜNÜRLÜĞÜNÜN TEK KAYNAĞI — AÇIK YAYIN LİSTESİ (allow-list)      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Portal, büro verisinin aynası DEĞİLDİR. Varsayılan: HİÇBİR ŞEY GÖRÜNMEZ.
 * Bir kayıt portalda ancak ÜÇ koşul birden sağlanırsa görünür:
 *
 *   (a) **Açık yayın kararı** — `PortalPublication` satırı vardır ve
 *       `unpublishedAt = null`'dır (yayından kaldırılan satır SİLİNMEZ,
 *       damgalanır; `@@unique([tenantId,resourceType,resourceId,clientId])`
 *       yüzünden yeniden yayında aynı satır güncellenir).
 *   (b) **Sahiplik** — kaydın gerçek sahibi, oturumu açan müvekkildir.
 *       Yayın kaydına GÜVENİLMEZ: avukat yanlışlıkla başka müvekkilin
 *       belgesini yayınlarsa yayın satırı var olur ama sahiplik tutmaz ve
 *       kayıt YİNE DE görünmez. İki bağımsız koşulun aynı anda yanlış olması
 *       gerekir.
 *   (c) **Üst dosya yayını** — belge/duruşma/safahat için bağlı dosyanın da
 *       yayında olması şarttır (spec §İş Kuralları 3).
 *
 * ═══ KARA LİSTE DEĞİL, BEYAZ LİSTE ═══
 * Yeni bir alan (`Case.riskNotes` gibi) eklendiğinde portal onu KENDİLİĞİNDEN
 * göstermez; hiçbir uç `include` ile geniş nesne döndürmez, hepsi `select` ile
 * alan alan yazılır. "Gizlenmesi unutulan alan" hatası bu tasarımda oluşamaz —
 * en fazla "gösterilmesi unutulan alan" olur ki bu zararsızdır.
 *
 * ═══ 404, 403 DEĞİL ═══
 * Yayınlanmamış ya da başkasına ait kayıt istendiğinde **404** döner. 403
 * "böyle bir kayıt var ama göremezsin" demektir; id tahmin ederek başka
 * müvekkillerin dosya numaralarını sayması için yeterli bir sızıntıdır.
 */
@Injectable()
export class PortalPublicationService {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ *
   * 1) LİSTE UÇLARININ GİRDİSİ — "bu müvekkile ne yayınlanmış?"
   * ------------------------------------------------------------------ */

  /**
   * Bu müvekkile YAYINDA olan kayıtlar (tür bazında).
   *
   * `unpublishedAt: null` süzgeci burada TEK YERDE yazılır; hiçbir uç kendi
   * `portalPublication.findMany` sorgusunu kurmaz. Süzgeci unutmak, yayından
   * kaldırılmış her şeyin geri görünmesi demek olurdu.
   */
  async activePublications(
    user: PortalAuthUser,
    resourceType: PortalResourceType
  ): Promise<ActivePublication[]> {
    const rows = await this.prisma.client.portalPublication.findMany({
      where: {
        tenantId: user.tenantId,
        clientId: user.clientId,
        resourceType,
        unpublishedAt: null,
      },
      select: { resourceId: true, note: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
    });
    return rows;
  }

  /** Aynı sorgu, `resourceId → yayın` haritası olarak (notu birleştirmek için). */
  async activePublicationMap(
    user: PortalAuthUser,
    resourceType: PortalResourceType
  ): Promise<Map<string, ActivePublication>> {
    const rows = await this.activePublications(user, resourceType);
    return new Map(rows.map((row) => [row.resourceId, row]));
  }

  /**
   * Bu müvekkilin GÖREBİLDİĞİ dosya id'leri.
   *
   * İki süzgecin KESİŞİMİ: (a) DOSYA tipinde aktif yayın kaydı olanlar,
   * (b) gerçekten bu müvekkile ait olanlar. Yayın kaydı yanlış müvekkile
   * açılmışsa (avukat hatası) dosya yine görünmez.
   *
   * Diğer tüm uçların temel taşıdır: belge, duruşma ve safahat sorguları bu
   * kümeyle sınırlanır, böylece cascade kuralı SORGU KATMANINDA uygulanır.
   */
  async visibleCaseIds(user: PortalAuthUser): Promise<string[]> {
    const published = await this.activePublications(user, "DOSYA");
    if (published.length === 0) return [];

    const owned = await this.prisma.client.case.findMany({
      where: {
        id: { in: published.map((p) => p.resourceId) },
        tenantId: user.tenantId,
        clientId: user.clientId,
      },
      select: { id: true },
    });
    return owned.map((row) => row.id);
  }

  /* ------------------------------------------------------------------ *
   * 2) TEKİL UÇLARIN KAPISI — "bu kaydı görebilir mi?"
   * ------------------------------------------------------------------ */

  /**
   * HER TEKİL PORTAL UCUNUN ÇAĞIRDIĞI KAPI.
   *
   * Üç koşulu da uygular ve sağlanmazsa 404 fırlatır. Dönüş değeri, yayın
   * notunu (SAFAHAT_KAYDI'nda dondurulmuş özet metnini) taşır.
   *
   * @throws NotFoundException — yayın yoksa, sahiplik tutmuyorsa ya da üst
   *         dosya yayından kaldırılmışsa. Üç durum da AYNI mesajı döndürür:
   *         hangi koşulun tuttuğu bilgisi de bir sızıntıdır.
   */
  async assertPublished(
    user: PortalAuthUser,
    resourceType: PortalResourceType,
    resourceId: string
  ): Promise<ActivePublication> {
    // (a) Açık yayın kararı var mı?
    const publication = await this.prisma.client.portalPublication.findFirst({
      where: {
        tenantId: user.tenantId,
        clientId: user.clientId,
        resourceType,
        resourceId,
        unpublishedAt: null,
      },
      select: { resourceId: true, note: true, publishedAt: true },
    });
    if (!publication) throw notVisible();

    // (b) Kaydın gerçek sahibi bu müvekkil mi?
    const owner = await this.resolveOwner(user.tenantId, resourceType, resourceId);
    if (!owner) throw notVisible();
    if (owner.clientId !== null && owner.clientId !== user.clientId) throw notVisible();

    // (c) Üst dosya da yayında mı? (spec §İş Kuralları 3 — cascade)
    if (CASE_SCOPED_TYPES.has(resourceType) && owner.caseId) {
      const visible = await this.visibleCaseIds(user);
      if (!visible.includes(owner.caseId)) throw notVisible();
    }

    return publication;
  }

  /* ------------------------------------------------------------------ *
   * 3) SAHİPLİK ÇÖZÜMLEMESİ
   * ------------------------------------------------------------------ */

  /**
   * Kaynağın gerçek sahibini (müvekkil) ve bağlı dosyasını bulur.
   *
   * KİRACI SÜZGECİ HER SORGUDA VARDIR: başka bir büronun kaydının id'si
   * bilinse bile sorgu onu bulamaz ve `null` döner → 404.
   *
   * `clientId: null` dönüşü "sahiplik belirlenemedi" demektir (ör. hiçbir
   * dosyaya bağlanmamış belge). Bu durumda karar YALNIZCA avukatın açık yayın
   * kararına kalır; sistem ikinci bir doğrulama yapamaz. Bu bilinçli bir
   * tavizdir: dosyasız bir vekalet ücreti sözleşmesini yayınlayabilmek için
   * gereklidir ve yalnızca yayın kararının kendisi yanlışsa risk doğurur.
   */
  private async resolveOwner(
    tenantId: string,
    resourceType: PortalResourceType,
    resourceId: string
  ): Promise<ResourceOwner | null> {
    switch (resourceType) {
      case "DOSYA": {
        const row = await this.prisma.client.case.findFirst({
          where: { id: resourceId, tenantId },
          select: { id: true, clientId: true },
        });
        return row ? { clientId: row.clientId, caseId: row.id } : null;
      }
      case "BELGE": {
        const row = await this.prisma.client.document.findFirst({
          where: { id: resourceId, tenantId },
          select: { caseId: true, case: { select: { clientId: true } } },
        });
        if (!row) return null;
        return { clientId: row.case?.clientId ?? null, caseId: row.caseId };
      }
      case "DURUSMA": {
        const row = await this.prisma.client.hearing.findFirst({
          where: { id: resourceId, tenantId },
          select: { caseId: true, case: { select: { clientId: true } } },
        });
        if (!row) return null;
        return { clientId: row.case.clientId, caseId: row.caseId };
      }
      case "SAFAHAT_KAYDI": {
        const row = await this.prisma.client.timelineEvent.findFirst({
          where: { id: resourceId, tenantId },
          select: { caseId: true, case: { select: { clientId: true } } },
        });
        if (!row) return null;
        return { clientId: row.case.clientId, caseId: row.caseId };
      }
      case "FATURA": {
        const row = await this.prisma.client.invoice.findFirst({
          where: { id: resourceId, tenantId },
          select: { clientId: true },
        });
        return row ? { clientId: row.clientId, caseId: null } : null;
      }
      case "ODEME": {
        const row = await this.prisma.client.payment.findFirst({
          where: { id: resourceId, tenantId },
          select: { clientId: true },
        });
        return row ? { clientId: row.clientId, caseId: null } : null;
      }
      case "MESAJ": {
        const row = await this.prisma.client.outboundMessage.findFirst({
          where: { id: resourceId, tenantId },
          select: { clientId: true, caseId: true },
        });
        return row ? { clientId: row.clientId, caseId: row.caseId } : null;
      }
      default: {
        // Şemaya yeni bir PortalResourceType eklenirse burası derleme
        // hatası verir (`never` ataması). Sahipliği çözülemeyen bir tür
        // sessizce "görünür" sayılmaz — varsayılan REDDETMEKTİR.
        const exhaustive: never = resourceType;
        void exhaustive;
        return null;
      }
    }
  }

  /**
   * Büro tarafı için sahiplik doğrulaması (yayın oluşturulurken kullanılır).
   *
   * Avukatın "yayınla" isteği, kaynağın SEÇİLEN MÜVEKKİLE ait olduğunu
   * doğrulamadan kabul edilmez: yanlış müvekkile yayın, portalın en pahalı
   * hatasıdır. Sahipliği çözülemeyen kaynak (dosyasız belge) için karar
   * avukata bırakılır ama kiracı süzgeci yine uygulanır.
   */
  async assertOwnedByClient(
    tenantId: string,
    clientId: string,
    resourceType: PortalResourceType,
    resourceId: string
  ): Promise<OwnershipCheck> {
    const owner = await this.resolveOwner(tenantId, resourceType, resourceId);
    if (!owner) {
      throw new NotFoundException("Yayınlanmak istenen kayıt bulunamadı.");
    }
    if (owner.clientId !== null && owner.clientId !== clientId) {
      throw new NotFoundException(
        "Bu kayıt seçilen müvekkile ait değil; başka bir müvekkilin portalında yayınlanamaz."
      );
    }
    // SAHİPLİK ÇÖZÜLEBİLDİ Mİ? Çözülemediyse yayın kararı TEK KAPILIDIR ve bu,
    // yayın satırına yazılıp arayüzde ayrıca uyarılır (denetim bulgusu 4).
    return {
      verified: owner.clientId !== null,
      warning:
        owner.clientId === null
          ? "Bu kaydın hangi müvekkile ait olduğu sistemce DOĞRULANAMADI (bir dosyaya " +
            "bağlı değil). Görünürlük yalnızca bu yayın kararına dayanıyor; ikinci bir " +
            "kontrol yapılamadı. Kaydı bir dosyaya bağlarsanız sahiplik denetimi de devreye girer."
          : null,
    };
  }

  /* ------------------------------------------------------------------ *
   * 4) GİDEN MESAJIN PORTALDA GÖRÜNÜRLÜĞÜ
   * ------------------------------------------------------------------ */

  /**
   * PORTAL kanalından gönderilen bir mesajı allow-list'e yazar.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ NEDEN VAR (denetim bulgusu 1)                                        ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   *
   * `listMessages` eskiden `OR: [{ channel: "PORTAL" }, { id: in yayınlar }]`
   * diyordu. İlk dal HİÇBİR yayın kaydı aramıyordu; yani "portal görünürlüğünün
   * TEK kaynağı allow-list'tir" kuralının tek istisnasıydı ve İletişim
   * Merkezi'nin kendi sözleşmesiyle çelişiyordu ("sağlayıcı kayıt üretir,
   * GÖRÜNÜRLÜĞE KARAR VERMEZ").
   *
   * Asıl sonucu şuydu: yayınlanmış bir portal mesajını GERİ ÇEKMENİN hiçbir
   * yolu yoktu. Yanlış bilgi içeren bir mesaj için avukat "yayından kaldır"
   * dediğinde kaldırılacak satır bulunamıyordu; elle bir MESAJ yayını açıp
   * kaldırsa bile `OR`'un ilk şıkkı eşleşmeye devam ediyordu.
   *
   * Artık gönderim anında GERÇEK bir yayın satırı açılır: tek doğru, tek yer,
   * geri çekilebilir. Yayın kararının sorumlusu mesajı ONAYLAYAN avukattır.
   */
  async publishOutboundMessage(input: {
    tenantId: string;
    clientId: string;
    outboundMessageId: string;
    /** Yayın kararının sorumlusu — mesajı onaylayan kullanıcı. */
    publishedBy: string;
    note?: string | null;
  }): Promise<void> {
    await this.prisma.client.portalPublication.upsert({
      where: {
        tenantId_resourceType_resourceId_clientId: {
          tenantId: input.tenantId,
          resourceType: "MESAJ",
          resourceId: input.outboundMessageId,
          clientId: input.clientId,
        },
      },
      create: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        resourceType: "MESAJ",
        resourceId: input.outboundMessageId,
        publishedBy: input.publishedBy,
        note: input.note ?? null,
        // `OutboundMessage.clientId` şemada ZORUNLUDUR; sahiplik daima çözülür.
        ownershipVerified: true,
      },
      update: {
        unpublishedAt: null,
        publishedBy: input.publishedBy,
        publishedAt: new Date(),
        ownershipVerified: true,
      },
    });
  }
}

/** `assertOwnedByClient` sonucu — sahiplik ikinci ayağının durumu. */
export interface OwnershipCheck {
  /** `false` ise sahiplik çözülemedi ve ikinci kapı ATLANDI (kapanmadı). */
  verified: boolean;
  /** Avukata gösterilecek uyarı; sahiplik doğrulandıysa null. */
  warning: string | null;
}

/**
 * Görünmeyen kaynak için tek biçimli 404.
 *
 * "Yayınlanmamış", "başkasına ait" ve "üst dosyası yayından kaldırılmış"
 * durumları AYNI yanıtı verir. Farklı mesajlar, id tahmin eden bir tarayıcıya
 * "bu id gerçek ama yayınlanmamış" bilgisini verirdi.
 */
function notVisible(): NotFoundException {
  return new NotFoundException("Kayıt bulunamadı.");
}
