/**
 * TÜRK VEKALETNAMELERİNDE ÖZEL YETKİ KATALOĞU — SABİT LİSTE.
 *
 * NEDEN SABİT: "kapsam" serbest metin olarak tutulursa ne aranabilir ne
 * karşılaştırılabilir. Bu katalog, `PowerOfAttorney.scopeItemsJson` alanına
 * yazılan maddelerin TEK DOĞRU ANAHTAR KÜMESİDİR; arayüz onay kutularını
 * buradan üretir, AI kapsam analizi de eksik yetkileri BU kodlarla anar.
 *
 * ── HUKUKİ DAYANAK ──────────────────────────────────────────────────────────
 * İki kaynak vardır ve karıştırılmaz:
 *
 *  • HMK m.74 — YARGILAMA HUKUKUNDA özel yetki gerektiren işler. Maddede
 *    sayılanlar açıkça yetki verilmedikçe vekil tarafından YAPILAMAZ:
 *    sulh, hâkimi ret, davanın tamamen ıslahı, yemin teklifi/kabulü/iadesi,
 *    başkasını tevkil, haczin kaldırılması, müvekkilin iflasını isteme, tahkim
 *    ve hakem sözleşmesi, konkordato/yeniden yapılandırma teklifi ve muvafakat,
 *    alternatif uyuşmazlık çözüm yollarına başvuru, davadan ve kanun
 *    yollarından feragat, karşı tarafı ibra, davayı kabul, yargılamanın iadesi,
 *    hâkimlerin fiilleri sebebiyle Devlet aleyhine tazminat davası ve KİŞİYE
 *    SIKI SIKIYA BAĞLI HAKLARLA ilgili davalar (boşanma, soybağı vb.).
 *
 *  • TBK m.504/3 — MADDİ HUKUKTA özel yetki gerektiren işler: dava açma, sulh,
 *    hakeme başvurma, iflas/konkordato talebi, kambiyo taahhüdü, bağışlama,
 *    kefil olma, taşınmazı devretme veya bir hakla sınırlandırma.
 *
 * KATALOG BİR HUKUKİ MÜTALAA DEĞİLDİR: `legalBasis` alanı yalnızca maddenin
 * NEREDE düzenlendiğini gösterir. Hangi işlem için hangi yetkinin gerektiği
 * somut olayda avukatın kararıdır — bu yüzden AI analizi de daima "avukat
 * teyidi gerekir" şeridiyle sunulur.
 *
 * KOD KÜMESİ, packages/db şemasındaki `scopeItemsJson` açıklamasıyla uyumludur;
 * oradaki kısa liste bu kataloğun alt kümesidir.
 */

import type { CaseType } from "@nomosos/db";

export const POA_SCOPE_CODES = [
  // ── Dava açma ve genel takip ──
  "DAVA_ACMA",
  "DAVAYI_TAKIP",
  "TEVKIL",
  // ── HMK m.74 · yargılamayı sona erdiren/etkileyen tasarruflar ──
  "SULH",
  "IBRA",
  "FERAGAT",
  "KABUL",
  "ISLAH",
  "YEMIN_TEKLIF",
  "HAKIM_RET",
  "KANUN_YOLU_FERAGAT",
  "YARGILAMANIN_IADESI",
  // ── Kanun yolları ──
  "TEMYIZ_ISTINAF",
  // ── Alternatif çözüm ──
  "TAHKIM",
  "ARABULUCULUK",
  // ── İcra ve tahsilat ──
  "ICRA_TAKIBI",
  "AHZU_KABZ",
  "TAHSIL",
  "HACIZ_FEK",
  "SATIS_TALEBI",
  "IFLAS_TALEP",
  "KONKORDATO",
  // ── Aile hukuku (kişiye sıkı sıkıya bağlı haklar) ──
  "BOSANMA",
  "NAFAKA",
  // ── Ceza ──
  "CEZA_MUDAFAA",
  "SIKAYETTEN_VAZGECME",
  "UZLASMA",
  "KAMU_DAVASINA_KATILMA",
  // ── Ticari / tasarruf ──
  "SIRKET_TEMSIL",
  "TASINMAZ_TASARRUF",
  "KAMBIYO_TAAHHUT",
  "DIGER",
] as const;

export type PoaScopeCode = (typeof POA_SCOPE_CODES)[number];

export interface PoaScopeDefinition {
  code: PoaScopeCode;
  /** Vekaletnamelerde geçen Türkçe karşılık — onay kutusu etiketi. */
  label: string;
  /** Ne anlama geldiği (arayüz ipucu). */
  description: string;
  /**
   * Açık yetki verilmedikçe kullanılamayan bir yetki mi.
   * `false` olanlar genel vekalet kapsamında sayılır.
   */
  requiresSpecialAuthority: boolean;
  /** Yetkinin düzenlendiği madde. Uydurma atıf YOKTUR; belirsizse `null`. */
  legalBasis: string | null;
  /**
   * Vekaletname metninde bu yetkiyi işaret eden ifadeler. DETERMİNİSTİK ön
   * tarama için kullanılır (AI'ın işi değildir); küçük harfe indirgenmiş,
   * Türkçe yerel karşılaştırmayla aranır.
   */
  keywords: readonly string[];
}

export const POA_SCOPE_CATALOG: readonly PoaScopeDefinition[] = [
  {
    code: "DAVA_ACMA",
    label: "Dava açma",
    description: "Müvekkil adına dava açma yetkisi.",
    requiresSpecialAuthority: true,
    legalBasis: "TBK m.504/3",
    keywords: ["dava açmaya", "dava ikame", "dava açma"],
  },
  {
    code: "DAVAYI_TAKIP",
    label: "Davayı takip",
    description: "Açılmış davayı duruşmalarda takip ve usul işlemlerini yapma.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["takip etmeye", "davayı takip", "duruşmalara katılmaya"],
  },
  {
    code: "TEVKIL",
    label: "Başkasını tevkil (yetki devri)",
    description: "Vekaletin başka bir avukata devredilmesi veya birlikte vekalet.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["tevkil", "teşrik", "azil ve tevkil"],
  },
  {
    code: "SULH",
    label: "Sulh olma",
    description: "Uyuşmazlığı sulh yoluyla sona erdirme; karşılıklı ödün içerir.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74 · TBK m.504/3",
    keywords: ["sulh", "sulh olmaya", "sulh ve ibra"],
  },
  {
    code: "IBRA",
    label: "İbra",
    description: "Karşı tarafı borcundan/sorumluluğundan aklama.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["ibra", "ibraya", "sulh ve ibra"],
  },
  {
    code: "FERAGAT",
    label: "Davadan feragat",
    description: "Talep sonucundan vazgeçme; davayı kesin hükümle sona erdirir.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["davadan feragat", "feragat etmeye", "feragate"],
  },
  {
    code: "KABUL",
    label: "Davayı kabul",
    description: "Karşı tarafın talep sonucunu kabul etme.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["davayı kabul", "kabule", "kabul etmeye"],
  },
  {
    code: "ISLAH",
    label: "Davanın tamamen ıslahı",
    description: "İddia veya talebin tamamen değiştirilmesi.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["ıslah", "islah", "tamamen ıslah"],
  },
  {
    code: "YEMIN_TEKLIF",
    label: "Yemin teklifi, kabulü ve iadesi",
    description: "Yemin deliline ilişkin tasarruflar.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["yemin teklif", "yemini kabul", "yemin iade", "yemin"],
  },
  {
    code: "HAKIM_RET",
    label: "Hâkimi reddetme",
    description: "Hâkimin reddi talebinde bulunma.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["hakimi ret", "hâkimi ret", "hakim reddi"],
  },
  {
    code: "KANUN_YOLU_FERAGAT",
    label: "Kanun yollarından feragat",
    description: "İstinaf/temyiz hakkından vazgeçme; kararı kesinleştirir.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["kanun yollarından feragat", "temyizden feragat", "istinaftan feragat"],
  },
  {
    code: "YARGILAMANIN_IADESI",
    label: "Yargılamanın iadesi",
    description: "Kesinleşmiş karara karşı yargılamanın yenilenmesi yoluna başvurma.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["yargılamanın iadesi", "yargilamanin iadesi", "muhakemenin iadesi"],
  },
  {
    code: "TEMYIZ_ISTINAF",
    label: "İstinaf ve temyiz",
    description: "Kanun yollarına başvurma (feragat DEĞİLDİR).",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["istinaf", "temyiz", "kanun yollarına başvurmaya"],
  },
  {
    code: "TAHKIM",
    label: "Tahkim / hakem sözleşmesi",
    description: "Uyuşmazlığı hakeme götürme veya hakem sözleşmesi yapma.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74 · TBK m.504/3",
    keywords: ["tahkim", "hakem", "hakem sözleşmesi"],
  },
  {
    code: "ARABULUCULUK",
    label: "Arabuluculuk / alternatif çözüm",
    description:
      "Arabuluculuk görüşmelerine katılma ve anlaşma belgesi imzalama dâhil " +
      "alternatif uyuşmazlık çözüm yollarına başvurma.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["arabulucu", "arabuluculuk", "alternatif uyuşmazlık"],
  },
  {
    code: "ICRA_TAKIBI",
    label: "İcra takibi yapma",
    description: "İcra ve iflas dairelerinde takip başlatma ve yürütme.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["icra takibi", "icra dairelerinde", "takip yapmaya"],
  },
  {
    code: "AHZU_KABZ",
    label: "Ahzu kabz (para ve mal teslim alma)",
    description: "Müvekkil adına para, kıymetli evrak ve malları teslim alma.",
    requiresSpecialAuthority: true,
    legalBasis: "TBK m.504/3",
    keywords: ["ahzu kabz", "ahzukabz", "ahz u kabz", "tahsil ve ahzu"],
  },
  {
    code: "TAHSIL",
    label: "Tahsil",
    description: "Alacağı tahsil etme ve makbuz düzenleme.",
    requiresSpecialAuthority: true,
    legalBasis: "TBK m.504/3",
    keywords: ["tahsil", "tahsile", "makbuz"],
  },
  {
    code: "HACIZ_FEK",
    label: "Haczin kaldırılması (fek)",
    description: "Konulmuş haczin kaldırılmasını talep etme.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["haczi fek", "haciz fek", "haczin kaldırılması"],
  },
  {
    code: "SATIS_TALEBI",
    label: "Satış talebi",
    description: "Hacizli malın satışını isteme.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["satış talep", "satışını istemeye", "satış talebinde"],
  },
  {
    code: "IFLAS_TALEP",
    label: "İflas talebi",
    description: "Müvekkilin veya borçlunun iflasını isteme.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74 · TBK m.504/3",
    keywords: ["iflas", "iflasını istemeye", "iflas talebinde"],
  },
  {
    code: "KONKORDATO",
    label: "Konkordato / yeniden yapılandırma",
    description: "Konkordato teklifi ve muvafakat, yeniden yapılandırma teklifi.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74",
    keywords: ["konkordato", "yeniden yapılandırma"],
  },
  {
    code: "BOSANMA",
    label: "Boşanma davası",
    description:
      "Boşanma ve ayrılık davası açma/takip. Kişiye sıkı sıkıya bağlı hak " +
      "olduğundan açık yetki aranır.",
    requiresSpecialAuthority: true,
    legalBasis: "HMK m.74 (kişiye sıkı sıkıya bağlı haklar)",
    keywords: ["boşanma", "bosanma", "ayrılık davası"],
  },
  {
    code: "NAFAKA",
    label: "Nafaka",
    description: "Nafaka talebi, artırım ve kaldırma davaları.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["nafaka"],
  },
  {
    code: "CEZA_MUDAFAA",
    label: "Ceza soruşturma/kovuşturmasında müdafilik",
    description: "Şüpheli veya sanık müdafiliği, ifade ve sorguda hazır bulunma.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["müdafi", "mudafi", "sanık müdafiliği", "soruşturma"],
  },
  {
    code: "SIKAYETTEN_VAZGECME",
    label: "Şikâyetten vazgeçme",
    description: "Takibi şikâyete bağlı suçlarda şikâyetten vazgeçme.",
    requiresSpecialAuthority: true,
    legalBasis: null,
    keywords: ["şikayetten vazgeç", "şikâyetten vazgeç", "sikayetten vazgec"],
  },
  {
    code: "UZLASMA",
    label: "Uzlaşma (ceza)",
    description: "CMK uzlaştırma sürecinde uzlaşma teklifini kabul veya ret.",
    requiresSpecialAuthority: true,
    legalBasis: null,
    keywords: ["uzlaşma", "uzlastirma", "uzlaştırma"],
  },
  {
    code: "KAMU_DAVASINA_KATILMA",
    label: "Kamu davasına katılma (müdahale)",
    description: "Mağdur/katılan sıfatıyla kamu davasına katılma.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["katılma", "müdahil", "mudahil"],
  },
  {
    code: "SIRKET_TEMSIL",
    label: "Şirket temsili",
    description: "Genel kurul, ticaret sicili ve resmî dairelerde şirketi temsil.",
    requiresSpecialAuthority: false,
    legalBasis: null,
    keywords: ["şirketi temsil", "genel kurul", "ticaret sicil"],
  },
  {
    code: "TASINMAZ_TASARRUF",
    label: "Taşınmaz devri / sınırlandırılması",
    description: "Taşınmazı devretme veya üzerinde sınırlı ayni hak kurma.",
    requiresSpecialAuthority: true,
    legalBasis: "TBK m.504/3",
    keywords: ["taşınmaz", "tapu", "ferağ", "devretmeye"],
  },
  {
    code: "KAMBIYO_TAAHHUT",
    label: "Kambiyo taahhüdü / kefalet / bağışlama",
    description: "Kambiyo senedi düzenleme, kefil olma veya bağışlamada bulunma.",
    requiresSpecialAuthority: true,
    legalBasis: "TBK m.504/3",
    keywords: ["kambiyo", "kefil", "bağışlama", "bagislama"],
  },
  {
    code: "DIGER",
    label: "Diğer (serbest metin)",
    description: "Katalogda karşılığı olmayan özel yetki. Açıklaması zorunludur.",
    requiresSpecialAuthority: true,
    legalBasis: null,
    keywords: [],
  },
];

const BY_CODE = new Map<PoaScopeCode, PoaScopeDefinition>(
  POA_SCOPE_CATALOG.map((d) => [d.code, d]),
);

export function scopeDefinition(code: string): PoaScopeDefinition | undefined {
  return BY_CODE.get(code as PoaScopeCode);
}

export function scopeLabel(code: string): string {
  return BY_CODE.get(code as PoaScopeCode)?.label ?? code;
}

export function isKnownScopeCode(code: string): code is PoaScopeCode {
  return BY_CODE.has(code as PoaScopeCode);
}

/* ================================================================== *
 * DOSYA TÜRÜNE GÖRE BEKLENEN YETKİLER — DETERMİNİSTİK ÖN TARAMA
 * ================================================================== *
 *
 * Bu eşleme AI'ya SORULMAZ, koda gömülüdür ve AI tarafından
 * DEĞİŞTİRİLEMEZ. Amaç, "bu dosya türünde şu yetkiler tipik olarak aranır"
 * bilgisini modele hazır vermek; model yalnızca yorumlar.
 *
 * `baseline` = bu tür bir dosyayı yürütmek için pratikte olmazsa olmaz.
 * `commonlyNeeded` = süreç içinde ihtiyaç doğması KUVVETLE MUHTEMEL yetkiler
 * (eksikliği tek başına "yetersiz" demek DEĞİLDİR; uyarı üretir).
 *
 * Liste kasıtlı olarak DARDIR: uydurulmuş bir "gereklilik" listesi, gerçek
 * eksiği gölgeler.
 */
export interface CaseTypeScopeExpectation {
  baseline: readonly PoaScopeCode[];
  commonlyNeeded: readonly PoaScopeCode[];
}

export const CASE_TYPE_SCOPE_EXPECTATIONS: Record<CaseType, CaseTypeScopeExpectation> = {
  DAVA: {
    baseline: ["DAVA_ACMA", "DAVAYI_TAKIP"],
    commonlyNeeded: ["SULH", "FERAGAT", "KABUL", "TEMYIZ_ISTINAF", "AHZU_KABZ"],
  },
  ICRA: {
    baseline: ["ICRA_TAKIBI"],
    commonlyNeeded: ["AHZU_KABZ", "TAHSIL", "HACIZ_FEK", "SATIS_TALEBI", "SULH"],
  },
  ARABULUCULUK: {
    baseline: ["ARABULUCULUK"],
    commonlyNeeded: ["SULH", "IBRA", "AHZU_KABZ"],
  },
  CEZA: {
    baseline: ["CEZA_MUDAFAA"],
    commonlyNeeded: ["SIKAYETTEN_VAZGECME", "UZLASMA", "KAMU_DAVASINA_KATILMA", "TEMYIZ_ISTINAF"],
  },
  DANISMANLIK: {
    // Danışmanlıkta dava/takip yetkisi ARANMAZ; boş bırakmak doğru cevaptır.
    baseline: [],
    commonlyNeeded: [],
  },
};

/* ================================================================== *
 * KAPSAM MADDELERİ (scopeItemsJson) OKUMA/YAZMA
 * ================================================================== */

/** `scopeItemsJson` içindeki tek madde. */
export interface PoaScopeItem {
  code: PoaScopeCode | string;
  label: string;
  present: boolean;
  /** DIGER kodunda zorunlu serbest açıklama. */
  note?: string;
}

/**
 * `scopeItemsJson` metnini güvenle çözer.
 *
 * BOZUK JSON SESSİZCE YUTULMAZ ama akış da durdurulmaz: boş liste döner ve
 * çağıran taraf `parsed: false` bilgisiyle kullanıcıyı uyarır. Kapsam bilgisi
 * okunamayan bir vekaletname için "yetki yok" demek YANLIŞ olurdu.
 */
export function parseScopeItems(json: string | null | undefined): {
  items: PoaScopeItem[];
  parsed: boolean;
} {
  if (!json || !json.trim()) return { items: [], parsed: true };
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return { items: [], parsed: false };
    const items: PoaScopeItem[] = [];
    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      const code = typeof rec.code === "string" ? rec.code : null;
      if (!code) continue;
      items.push({
        code,
        label: typeof rec.label === "string" ? rec.label : scopeLabel(code),
        present: rec.present !== false,
        ...(typeof rec.note === "string" && rec.note.trim() ? { note: rec.note } : {}),
      });
    }
    return { items, parsed: true };
  } catch {
    return { items: [], parsed: false };
  }
}

/** Vekaletnamede VAR olan yetki kodları. */
export function presentScopeCodes(json: string | null | undefined): Set<string> {
  return new Set(
    parseScopeItems(json)
      .items.filter((i) => i.present)
      .map((i) => i.code),
  );
}

/**
 * DETERMİNİSTİK EKSİK YETKİ TESPİTİ.
 *
 * Dosya türünün beklenen yetkileriyle vekaletnamenin kapsam maddelerini
 * karşılaştırır. AI ÇALIŞMADAN ÖNCE hesaplanır ve modele HAZIR verilir;
 * model bu listeyi yeniden hesaplayamaz.
 *
 * ── İKİ TÜR "YOK" AYRIMI (kritik) ───────────────────────────────────────────
 * Bir yetkinin kapsam maddelerinde görünmemesinin iki ayrı anlamı vardır ve
 * bunları karıştırmak yanlış alarm üretir:
 *
 *   • `explicitlyAbsent` — madde LİSTEDE VAR ama `present: false`. Avukat o
 *     yetkinin BULUNMADIĞINI bilerek kaydetmiştir. GÜVENİLİR bir "yok"tur.
 *   • `notRecorded`      — madde listede HİÇ YOK. Türk uygulamasında kapsam
 *     listeleri çoğu zaman yalnızca ÖZEL yetkileri sayar; "dava açma" gibi
 *     olağan yetkiler yazılmadan geçilir. Buradan "yetki yok" sonucu
 *     ÇIKARILAMAZ — yalnızca "kayıt yok" denir.
 *
 * Bu ayrım, kapsam analizinin fail-closed kuralında kullanılır: model
 * "yeterli" derken AÇIKÇA YOK işaretli bir yetki varsa karar BELİRSİZ'e
 * düşürülür; sadece "kayıt yok" durumunda düşürülmez.
 */
export interface MissingScopeEntry {
  definition: PoaScopeDefinition;
  /** Yetki `present: false` olarak KAYDEDİLMİŞ mi (güvenilir "yok"). */
  explicitlyAbsent: boolean;
  /** Bu dosya türü için çekirdek beklenti mi, yoksa olası ihtiyaç mı. */
  tier: "CEKIRDEK" | "OLASI";
}

export function computeMissingScopes(
  caseType: CaseType,
  scopeItemsJson: string | null | undefined,
): {
  present: string[];
  /** `present: false` olarak KAYDEDİLMİŞ tüm yetkiler (beklenti dışı olanlar dâhil). */
  explicitlyAbsent: string[];
  missingBaseline: PoaScopeDefinition[];
  missingCommonlyNeeded: PoaScopeDefinition[];
  /** Beklenen ama bulunmayan yetkiler — "açıkça yok" / "kayıt yok" ayrımıyla. */
  missingExpected: MissingScopeEntry[];
  scopeParsed: boolean;
} {
  const { items, parsed } = parseScopeItems(scopeItemsJson);
  const present = new Set(items.filter((i) => i.present).map((i) => i.code));
  const absent = new Set(items.filter((i) => !i.present).map((i) => i.code));
  const expectation = CASE_TYPE_SCOPE_EXPECTATIONS[caseType];

  const resolve = (codes: readonly PoaScopeCode[]): PoaScopeDefinition[] =>
    codes
      .filter((c) => !present.has(c))
      .map((c) => BY_CODE.get(c))
      .filter((d): d is PoaScopeDefinition => d !== undefined);

  const missingBaseline = resolve(expectation.baseline);
  const missingCommonlyNeeded = resolve(expectation.commonlyNeeded);

  const missingExpected: MissingScopeEntry[] = [
    ...missingBaseline.map((definition) => ({
      definition,
      explicitlyAbsent: absent.has(definition.code),
      tier: "CEKIRDEK" as const,
    })),
    ...missingCommonlyNeeded.map((definition) => ({
      definition,
      explicitlyAbsent: absent.has(definition.code),
      tier: "OLASI" as const,
    })),
  ];

  return {
    present: [...present],
    explicitlyAbsent: [...absent],
    missingBaseline,
    missingCommonlyNeeded,
    missingExpected,
    scopeParsed: parsed,
  };
}

/**
 * Serbest kapsam METNİNDE geçen yetkileri anahtar kelimeyle tarar.
 *
 * BU BİR ÖNERİDİR, KAYIT DEĞİLDİR: `scopeItemsJson` boş olan eski kayıtlarda
 * avukata "metinde şunlar geçiyor, işaretlemek ister misiniz?" demek için
 * kullanılır. Kelime eşleşmesi hukuki yorum yerine GEÇMEZ — ör. "sulh olmaya
 * yetkili DEĞİLDİR" cümlesi de "sulh" kelimesini içerir. Bu yüzden sonuç
 * hiçbir yere otomatik yazılmaz.
 */
export function scanScopeTextForCodes(text: string | null | undefined): PoaScopeCode[] {
  if (!text || !text.trim()) return [];
  const haystack = text.toLocaleLowerCase("tr-TR");
  const hits: PoaScopeCode[] = [];
  for (const def of POA_SCOPE_CATALOG) {
    if (def.keywords.some((k) => haystack.includes(k))) hits.push(def.code);
  }
  return hits;
}
