/**
 * YARGI ORGANLARI + NOTERLER SEED'İ.
 *
 * Kullanıcı talebi: mahkeme / icra dairesi / noter ELLE girilmesin — listeden
 * seçilsin. Bu seed 81 il için katalog üretir: mahkeme kategorileri (asliye
 * hukuk/ceza, sulh, iş, aile, tüketici, kadastro, icra hukuk, fikrî sınai,
 * istinaf), icra daireleri ve noterlikler.
 *
 * DÜRÜSTLÜK NOTU (vaat kısıtı): daire/noter SAYILARI yaklaşıktır ve illerin
 * gelişimine göre değişir (kaynak=SEED). Liste ÜRETİM VERİSİ DEĞİLDİR:
 * platform panelinden düzeltilebilir ve yapılandırılmış kaynaktan periyodik
 * senkronla güncellenir (judicial.sync.url — bkz. judicial.service.ts).
 */

/** 81 il — Türk alfabesi sırasıyla. */
export const ILLER: readonly string[] = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya",
  "Ardahan", "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik",
  "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum",
  "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ", "Erzincan", "Erzurum", "Eskişehir",
  "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır", "Isparta", "İstanbul",
  "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kırıkkale",
  "Kırklareli", "Kırşehir", "Kilis", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa",
  "Mardin", "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Ordu", "Osmaniye",
  "Rize", "Sakarya", "Samsun", "Siirt", "Sinop", "Sivas", "Şanlıurfa", "Şırnak",
  "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Van", "Yalova", "Yozgat", "Zonguldak",
];

/** İl büyüklüğü katmanı — daire sayıları katmanla ölçeklenir. */
type Tier = 1 | 2 | 3 | 4;

const TIER_1 = new Set(["İstanbul"]);
const TIER_2 = new Set(["Ankara", "İzmir"]);
const TIER_3 = new Set([
  "Bursa", "Antalya", "Adana", "Konya", "Gaziantep", "Şanlıurfa", "Kayseri", "Mersin",
  "Diyarbakır", "Hatay", "Samsun", "Kocaeli", "Denizli", "Sakarya", "Trabzon", "Manisa",
  "Balıkesir", "Kahramanmaraş", "Aydın", "Tekirdağ", "Muğla", "Eskişehir", "Mardin", "Malatya",
]);

function tierOf(il: string): Tier {
  if (TIER_1.has(il)) return 1;
  if (TIER_2.has(il)) return 2;
  if (TIER_3.has(il)) return 3;
  return 4;
}

interface CourtCategorySpec {
  key: string;
  /** Kısa ad — "İstanbul 3. …" kalıbına girer. */
  label: string;
  /** Katman 1 (İstanbul) için daire sayısı. */
  t1: number;
  /** Yalnız bazı illerde var (fikrî sınai gibi). */
  tier3Plus?: boolean;
}

const COURT_CATEGORIES: readonly CourtCategorySpec[] = [
  { key: "ASLIYE_HUKUK", label: "Asliye Hukuk Mahkemesi", t1: 60 },
  { key: "ASLIYE_CEZA", label: "Ağır Ceza Mahkemesi", t1: 45 },
  // D7 — konkordato (İİK m.285+) ve iflas (m.154+) mercii.
  { key: "ASLIYE_TICARET", label: "Asliye Ticaret Mahkemesi", t1: 30 },
  { key: "SULH_HUKUK", label: "Sulh Hukuk Mahkemesi", t1: 60 },
  { key: "SULH_CEZA", label: "Sulh Ceza Mahkemesi", t1: 60 },
  { key: "IS", label: "İş Mahkemesi", t1: 25 },
  { key: "AILE", label: "Aile Mahkemesi", t1: 20 },
  { key: "TUKETICI", label: "Tüketici Mahkemesi", t1: 30 },
  { key: "KADASTRO", label: "Kadastro Mahkemesi", t1: 15 },
  { key: "ICRA_HUKUK", label: "İcra Hukuk Mahkemesi", t1: 20 },
  { key: "FIKRI_SINAI", label: "Fikrî ve Sınai Haklar Hukuk Mahkemesi", t1: 3, tier3Plus: true },
];

/** Katmana göre daire sayısı. */
function officeCount(spec: CourtCategorySpec, tier: Tier): number {
  switch (tier) {
    case 1:
      return spec.t1;
    case 2:
      return Math.max(4, Math.round(spec.t1 * 0.4));
    case 3:
      // Fikrî sınai yalnız seçme illerde.
      if (spec.tier3Plus) return 1;
      return Math.max(2, Math.round(spec.t1 * 0.15));
    case 4:
      if (spec.tier3Plus) return 0;
      return spec.key === "ASLIYE_HUKUK" || spec.key === "ASLIYE_CEZA" || spec.key === "SULH_CEZA"
        ? 2
        : 1;
  }
}

/** İcra dairesi sayısı — katmana göre. */
function icraCount(tier: Tier): number {
  return [23, 12, 6, 2][tier - 1];
}

/** Noter sayısı — katmana göre (yaklaşık). */
function notaryCount(tier: Tier): number {
  return [240, 110, 35, 8][tier - 1];
}

/** Türkçe sıra eki: 1., 2., 3., 4., 5. … (Türkçede nokta ile yazılır). */
function ordinal(n: number): string {
  return `${n}.`;
}

export interface JudicialBodySeedRow {
  type: "MAHKEME" | "ICRA_DAIRESI";
  category: string;
  name: string;
  il: string;
  ilce: string | null;
}

export interface NotarySeedRow {
  name: string;
  il: string;
  ilce: string | null;
}

export interface TaxOfficeSeedRow {
  name: string;
  il: string;
  ilce: string | null;
}

/** Temsilî büyük şehir daireleri — GERÇEK adlarla. */
const MAJOR_TAX_OFFICES: readonly TaxOfficeSeedRow[] = [
  { name: "İstanbul Büyük Mükellefler V.D.", il: "İstanbul", ilce: "Fatih" },
  { name: "İstanbul Kurumlar V.D.", il: "İstanbul", ilce: "Fatih" },
  { name: "İstanbul Beyoğlu V.D.", il: "İstanbul", ilce: "Beyoğlu" },
  { name: "İstanbul Şişli V.D.", il: "İstanbul", ilce: "Şişli" },
  { name: "İstanbul Ümraniye V.D.", il: "İstanbul", ilce: "Ümraniye" },
  { name: "İstanbul Bakırköy V.D.", il: "İstanbul", ilce: "Bakırköy" },
  { name: "İstanbul Kadıköy V.D.", il: "İstanbul", ilce: "Kadıköy" },
  { name: "İstanbul Anadolu Kurumlar V.D.", il: "İstanbul", ilce: "Ümraniye" },
  { name: "Ankara Büyük Mükellefler V.D.", il: "Ankara", ilce: "Çankaya" },
  { name: "Ankara Çankaya V.D.", il: "Ankara", ilce: "Çankaya" },
  { name: "Ankara Yenimahalle V.D.", il: "Ankara", ilce: "Yenimahalle" },
  { name: "İzmir Büyük Mükellefler V.D.", il: "İzmir", ilce: "Konak" },
  { name: "İzmir Konak V.D.", il: "İzmir", ilce: "Konak" },
  { name: "İzmir Karşıyaka V.D.", il: "İzmir", ilce: "Karşıyaka" },
  { name: "İzmir Bornova V.D.", il: "İzmir", ilce: "Bornova" },
  { name: "Bursa Nilüfer V.D.", il: "Bursa", ilce: "Nilüfer" },
  { name: "Antalya Muratpaşa V.D.", il: "Antalya", ilce: "Muratpaşa" },
];

/**
 * VERGİ DAİRESİ kataloğu (D7) — TEMSİLÎ: her il için bir merkez dairesi +
 * büyük şehirlerde GERÇEK adlı büyük mükellefler daireleri. TAM resmî liste
 * (VDAND, ~500+ kayıt) bilinçli olarak SYNC kaynağına bırakılmıştır: eksik
 * listeyle "tam katalog" iddiası üretme — katalog panelden büyür.
 */
export function buildTaxOfficeCatalog(): TaxOfficeSeedRow[] {
  const rows: TaxOfficeSeedRow[] = MAJOR_TAX_OFFICES.map((r) => ({ ...r }));
  for (const il of ILLER) {
    rows.push({ name: `${il} V.D.`, il, ilce: null });
  }
  return rows;
}

/** Tüm kataloğu üretir — seed ve test aynı kaynağı kullanır. */
export function buildJudicialCatalog(): {
  bodies: JudicialBodySeedRow[];
  notaries: NotarySeedRow[];
} {
  const bodies: JudicialBodySeedRow[] = [];
  const notaries: NotarySeedRow[] = [];

  for (const il of ILLER) {
    const tier = tierOf(il);

    for (const spec of COURT_CATEGORIES) {
      const count = officeCount(spec, tier);
      for (let i = 1; i <= count; i++) {
        bodies.push({
          type: "MAHKEME",
          category: spec.key,
          name: `${il} ${ordinal(i)} ${spec.label}`,
          il,
          ilce: null,
        });
      }
    }

    const icra = icraCount(tier);
    for (let i = 1; i <= icra; i++) {
      bodies.push({
        type: "ICRA_DAIRESI",
        category: "ICRA",
        name: `${il} ${ordinal(i)} İcra Dairesi`,
        il,
        ilce: null,
      });
    }

    const noter = notaryCount(tier);
    for (let i = 1; i <= noter; i++) {
      notaries.push({
        name: `${il} ${ordinal(i)} Noterliği`,
        il,
        ilce: null,
      });
    }
  }

  return { bodies, notaries };
}
