/**
 * RAPOR KATALOĞU — tek doğruluk kaynağı.
 *
 * `GET /reports/catalog` bu listeyi rol süzgecinden geçirerek döndürür;
 * `GET /reports/:key` çalıştırırken aynı tanımdan rol kapısını ve parametre
 * sözleşmesini okur. Arayüz form alanlarını `params` üzerinden üretir — yani
 * bir raporun filtresi TEK yerde tarif edilir, ekranda ve API'de ayrışmaz.
 *
 * ANAHTAR TAKMA ADLARI (`aliases`): `packages/db` seed'i kayıtlı raporları
 * `buro-aylik-ozet` anahtarıyla tohumluyor; katalogdaki kanonik anahtar ise
 * `buro-ozet`. Tohumlanan kayıtlar SİLİNMEDEN çalışabilsin diye takma ad
 * çözümü eklendi (`resolveReportKey`). Yanıt daima KANONİK anahtarı taşır.
 */

import type { UserRole } from "@nomosos/shared";
import { REPORT_ACCESS } from "./report-access";
import { PERIOD_PRESETS } from "./report-types";

export type ReportParamType = "period" | "date" | "boolean" | "uuid" | "enum" | "number" | "list";

export interface ReportParamDef {
  name: string;
  label: string;
  type: ReportParamType;
  required?: boolean;
  default?: string | number | boolean;
  options?: readonly string[];
  description?: string;
}

/* ─────────────── Ortak parametreler (her rapor kullanır) ─────────────── */

const PARAM_DONEM: ReportParamDef = {
  name: "donem",
  label: "Dönem",
  type: "period",
  default: "BU_AY",
  options: PERIOD_PRESETS,
  description: "Ön tanımlı dönem. `from`/`to` verilirse yok sayılır.",
};

const PARAM_FROM: ReportParamDef = {
  name: "from",
  label: "Başlangıç (dâhil)",
  type: "date",
  description: "ISO tarih (2026-08-01). Dönem ilk günü DAHİLDİR.",
};

const PARAM_TO: ReportParamDef = {
  name: "to",
  label: "Bitiş",
  type: "date",
  description: "ISO tarih (2026-08-31). Dâhil olup olmadığını `donemBitisDahil` belirler.",
};

const PARAM_BITIS_DAHIL: ReportParamDef = {
  name: "donemBitisDahil",
  label: "Bitiş günü dâhil",
  type: "boolean",
  default: true,
  description: "false verilirse `to` günü rapora GİRMEZ. Yalnız özel dönemde geçerlidir.",
};

const PARAM_KARSILASTIR: ReportParamDef = {
  name: "karsilastir",
  label: "Önceki dönemle karşılaştır",
  type: "boolean",
  default: true,
  description: "Bitişik ve eşit uzunlukta önceki dönem ölçüleri de hesaplanır.",
};

const PARAM_LIMIT: ReportParamDef = {
  name: "limit",
  label: "Satır sınırı",
  type: "number",
  default: 500,
  description: "Ayrıntı tablolarında en fazla kaç satır döneceği (en çok 5000).",
};

/**
 * DOSYA TÜRÜ SÜZGECİ — SUNUCUDA VARDI, KATALOGDA YOKTU (denetim bulgusu 25).
 *
 * `report-params.ts` bu değeri çözüyor ve iki rapor onu WHERE'e koyuyordu, ama
 * hiçbir raporun `params` listesinde tanımlı değildi. Arayüz filtre alanlarını
 * KATALOGDAN üretir; dolayısıyla süzgece ekrandan erişilemiyordu ve kayıtlı
 * bir raporda saklandığında kullanıcı süzülmüş raporu TAM sanıyordu.
 *
 * Kabul edilen değerler `resolveReportParams` içindeki liste ile aynı olmak
 * zorundadır; ayrışırlarsa katalog kullanıcıya 400 alacağı bir seçenek sunar.
 */
export const REPORT_CASE_TYPES = [
  "DAVA",
  "ICRA",
  "ARABULUCULUK",
  "CEZA",
  "DANISMANLIK",
] as const;

const PARAM_DOSYA_TURU: ReportParamDef = {
  name: "dosyaTuru",
  label: "Dosya türü",
  type: "enum",
  options: REPORT_CASE_TYPES,
  description: "Yalnız seçilen türdeki dosyalar rapora girer. Boş bırakılırsa tüm türler.",
};

const COMMON_PERIOD_PARAMS: ReportParamDef[] = [
  PARAM_DONEM,
  PARAM_FROM,
  PARAM_TO,
  PARAM_BITIS_DAHIL,
];

/* ══════════════════════════════════════════════════════════════════════ */

export interface ReportDefinition {
  key: string;
  /** Seed/eski kayıtların kullandığı anahtarlar. */
  aliases?: readonly string[];
  name: string;
  description: string;
  /** Erişim BEYAZ LİSTESİ — sunucuda uygulanır. */
  requiredRoles: readonly UserRole[];
  params: readonly ReportParamDef[];
  /** Önceki dönem karşılaştırması anlamlı mı (anlık fotoğraf raporlarında değil). */
  supportsComparison: boolean;
  /**
   * Raporun okunma biçimine dair KALICI not. Yanıtın `notes` alanına girer;
   * arayüz bunu rapor başlığının altında gösterir.
   */
  notes?: readonly string[];
  /** Rapor para içeriyor mu — arayüz rozeti ve KVKK/rol izahı için. */
  containsMoney: boolean;
  /** Varsayılan CSV tablosu (rapor çok tablolu ise). */
  defaultTable: string;
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    key: "buro-ozet",
    aliases: ["buro-aylik-ozet"],
    name: "Büro Özeti",
    description:
      "Dönem içi yeni/kapanan dosya, duruşma, üretilen dilekçe, tamamlanan görev, " +
      "tahakkuk/tahsilat ve hareket gören müvekkil sayısı — önceki dönemle karşılaştırmalı.",
    requiredRoles: REPORT_ACCESS.OPERASYON,
    params: [...COMMON_PERIOD_PARAMS, PARAM_KARSILASTIR],
    supportsComparison: true,
    containsMoney: true,
    notes: [
      "Finans ölçüleri (tahakkuk, tahsilat) yalnız finans verisi görebilen rollere döner; " +
        "Stajyer rolünde bu kartlar rapordan ÇIKARILIR ve `hiddenSections` alanında bildirilir.",
    ],
    defaultTable: "kirilim",
  },
  {
    key: "avukat-is-yuku",
    name: "Avukat İş Yükü",
    description:
      "Avukat başına sorumlu dosya, açık ve gecikmiş görev, dönem içi duruşma, " +
      "kayıtlı çalışma süresi ve faturalanabilir oran.",
    requiredRoles: REPORT_ACCESS.IS_YUKU,
    params: [...COMMON_PERIOD_PARAMS, PARAM_LIMIT],
    supportsComparison: false,
    containsMoney: false,
    notes: [
      "BU RAPOR BİR PERFORMANS DEĞERLENDİRME ARACI DEĞİLDİR. Amacı iş yükü dengelemesidir: " +
        "sayılar dosyaların ağırlığını, karmaşıklığını, devredilme geçmişini ve avukatın " +
        "izin/duruşma takvimini içermez. Kişi hakkında ölçüt olarak kullanılamaz.",
      "Faturalanabilir oran, kayıtlı zaman girişlerinin (`TimeEntry`) oranıdır; girilmemiş " +
        "çalışma süresi rapora yansımaz.",
    ],
    defaultTable: "is-yuku",
  },
  {
    key: "dosya-durum-dagilimi",
    name: "Dosya Durum Dağılımı",
    description:
      "Dosya türü × durum kırılımı, açık dosyaların yaş dağılımı (0-6 ay, 6-12 ay, 1-2 yıl, 2+ yıl) " +
      "ve en uzun süredir hareket görmeyen dosyalar.",
    requiredRoles: REPORT_ACCESS.OPERASYON,
    params: [...COMMON_PERIOD_PARAMS, PARAM_DOSYA_TURU, PARAM_LIMIT],
    supportsComparison: false,
    containsMoney: false,
    notes: [
      "Durum ve yaş dağılımı DÖNEM SONU FOTOĞRAFIDIR (dönem içi değişim değil); " +
        "yaş, dosyanın açılış tarihinden dönem son gününe kadar geçen süredir.",
      "Sayılan evren, referans güne kadar AÇILMIŞ dosyalardır; matris, yaş kovaları ve " +
        "sayaçlar aynı evreni kullanır. Durum sütunu dosyanın BUGÜNKÜ durumudur — şemada " +
        "durum geçmişi tutulmadığı için 'o tarihteki durum' üretilemez.",
    ],
    defaultTable: "tur-durum",
  },
  {
    key: "sure-performansi",
    name: "Süre Performansı",
    description:
      "Dönem içi vadesi gelen süreler: toplam, zamanında tamamlanan, kaçırılan ve " +
      "ortalama tamamlama payı (gün).",
    requiredRoles: REPORT_ACCESS.OPERASYON,
    params: [...COMMON_PERIOD_PARAMS, PARAM_KARSILASTIR, PARAM_LIMIT],
    supportsComparison: true,
    containsMoney: false,
    notes: [
      "KAÇIRILAN SÜRE BÜRONUN EN KRİTİK METRİĞİDİR: telafisi çoğu zaman imkânsızdır ve " +
        "meslekî sorumluluk doğurur. Rapor bu ölçüyü ayrıca vurgular ve kaçırılan her " +
        "süreyi dosya/sorumlu ile listeler.",
      "Tamamlanma anı ayrı bir alanda tutulmadığı için `Deadline.updatedAt` esas alınır; " +
        "süre tamamlandıktan sonra kayıt üzerinde düzenleme yapıldıysa pay kayabilir.",
    ],
    defaultTable: "kacirilan",
  },
  {
    key: "tahsilat-yaslandirma",
    name: "Tahsilat Yaşlandırma",
    description:
      "Açık faturaların müvekkil × yaş dilimi (0-30 / 31-60 / 61-90 / 90+ gün) dağılımı, " +
      "toplam alacak ve dönem tahsil oranı.",
    requiredRoles: REPORT_ACCESS.FINANS,
    params: [
      ...COMMON_PERIOD_PARAMS,
      PARAM_LIMIT,
      {
        name: "kovalarGun",
        label: "Yaşlandırma eşikleri (gün)",
        type: "list",
        default: "30,60,90",
        description: "Artan sırada, en fazla 6 eşik. Kovalar İKİ UCU DA DAHİL gün aralıklarıdır.",
      },
      {
        name: "muvekkilId",
        label: "Müvekkil",
        type: "uuid",
        description: "Tek müvekkile daraltma.",
      },
    ],
    supportsComparison: false,
    containsMoney: true,
    notes: [
      "Yaşlandırma REFERANS GÜNÜ dönemin son günüdür; gecikme, faturanın vade tarihinden " +
        "(vade yoksa düzenleme tarihinden) o güne kadar geçen TAM GÜN sayısıdır.",
      "Para birimleri toplanmaz; her satır kendi para biriminde raporlanır (kur çevrimi yapılmaz).",
    ],
    defaultTable: "yaslandirma",
  },
  {
    key: "karlilik",
    name: "Kârlılık",
    description:
      "Dosya/müvekkil bazında tahakkuk − masraf brüt katkısı ve bunun kayıtlı çalışma " +
      "süresinin saatlik ücretle değeriyle karşılaştırması.",
    requiredRoles: REPORT_ACCESS.YONETIM,
    params: [
      ...COMMON_PERIOD_PARAMS,
      PARAM_LIMIT,
      {
        name: "kirilim",
        label: "Kırılım",
        type: "enum",
        default: "DOSYA",
        options: ["DOSYA", "MUVEKKIL"],
        description: "Satırların dosya bazında mı müvekkil bazında mı toplanacağı.",
      },
    ],
    supportsComparison: false,
    containsMoney: true,
    notes: [
      "Brüt katkı = tahakkuk − (masraf + harç). Genel gider, personel maliyeti ve vergi " +
        "HESABA KATILMAZ; bu rapor bir maliyet muhasebesi çıktısı değildir.",
      "Süre değeri, zaman kaydındaki saatlik ücretten (yoksa dosyanın aktif ücret " +
        "sözleşmesindeki saatlik ücretten) hesaplanır. Hiçbiri yoksa satır süre değeri " +
        "olmadan raporlanır ve uyarı döner — varsayılan bir ücret UYDURULMAZ.",
    ],
    defaultTable: "karlilik",
  },
  {
    key: "icra-tahsilat",
    name: "İcra Tahsilat",
    description:
      "İcra dosyalarının aşama dağılımı, tahsil edilen ve kalan tutar, ilk tahsilata " +
      "kadar geçen ortalama süre.",
    requiredRoles: REPORT_ACCESS.FINANS,
    params: [...COMMON_PERIOD_PARAMS, PARAM_LIMIT],
    supportsComparison: false,
    containsMoney: true,
    notes: [
      "Kalan = asıl alacak − tahsilat. FAİZ, harç ve masraf DÂHİL DEĞİLDİR; güncel " +
        "borç bakiyesi için icra modülünün faiz hesabı kullanılmalıdır.",
      "Aşama dağılımı dönem sonu fotoğrafıdır; tahsilat rakamları dönem içidir.",
    ],
    defaultTable: "asama",
  },
  {
    key: "ai-kullanim",
    name: "AI Kullanımı ve Kredi Tüketimi",
    description:
      "Görev tipi × kullanıcı kırılımında AI çağrı sayısı ve tüketilen kredi " +
      "(AiUsageLog + CreditTransaction mutabakatı).",
    requiredRoles: REPORT_ACCESS.FINANS,
    params: [...COMMON_PERIOD_PARAMS, PARAM_KARSILASTIR, PARAM_LIMIT],
    supportsComparison: true,
    containsMoney: false,
    notes: [
      "Yönetim (Yönetici/Ortak) büro genelini görür; Avukat ve Sekreter YALNIZ KENDİ " +
        "kullanımını görür — daraltma sunucuda yapılır.",
      "Sağlayıcı maliyeti (`estimatedCost`) iç muhasebe verisidir ve bu rapora GİRMEZ.",
      "Kredi rakamı iki kaynaktan da okunur; fark varsa mutabakat uyarısı döner " +
        "(BYO-LLM kiracısında kredi tüketimi zaten sıfırdır).",
    ],
    defaultTable: "gorev-kullanici",
  },
  {
    key: "durusma-takvimi",
    name: "Duruşma Takvimi",
    description: "Dönem içi duruşmaların listesi ile avukat ve mahkeme kırılımı.",
    requiredRoles: REPORT_ACCESS.OPERASYON,
    params: [
      ...COMMON_PERIOD_PARAMS,
      PARAM_DOSYA_TURU,
      PARAM_LIMIT,
      {
        name: "kullaniciId",
        label: "Sorumlu avukat",
        type: "uuid",
        description: "Tek avukatın duruşmalarına daraltma.",
      },
    ],
    supportsComparison: false,
    containsMoney: false,
    notes: [
      "Duruşmalar dosyanın SORUMLU AVUKATINA göre gruplanır; duruşmaya fiilen kimin " +
        "girdiği ayrı bir alan olarak tutulmadığı için bu bir katılım kaydı değildir.",
    ],
    defaultTable: "durusmalar",
  },
] as const;

const BY_KEY = new Map<string, ReportDefinition>();
for (const def of REPORT_DEFINITIONS) {
  BY_KEY.set(def.key, def);
  for (const alias of def.aliases ?? []) BY_KEY.set(alias, def);
}

/** Kanonik anahtar ya da takma addan tanımı bulur. */
export function findReportDefinition(key: string): ReportDefinition | undefined {
  return BY_KEY.get(key.trim());
}

/** Takma adı kanonik anahtara çevirir; bilinmeyen anahtarı olduğu gibi döndürür. */
export function resolveReportKey(key: string): string {
  return BY_KEY.get(key.trim())?.key ?? key.trim();
}
