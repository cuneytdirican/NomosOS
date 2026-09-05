/**
 * MEVZUAT KAYNAĞI KONEKTÖR SÖZLEŞMESİ (hukuki veri kaynağı besleme planı).
 *
 * İçtihat tarafındaki CaseLawSourceAdapter ile aynı felsefe: Türkiye'de
 * mevzuat için resmî bir kamu API'si YOKTUR; mevzuat.gov.tr ve Resmî Gazete
 * web yüzeyleridir. Her kaynak bu arayüzü uygulayan bir KONEKTÖR olarak
 * takılır; yeni kaynak = yeni konektör, mimari değişikliği değil.
 *
 * !!! UYDURMA ENTEGRASYON YASAĞI: bu depodaki her konektör, kodu yazılmadan
 * ÖNCE gerçek uç noktayla (tarayıcı ağı) doğrulanır. Doğrulanamayan uç için
 * istemci YAZILMAZ.
 *
 * Kaynak güven düzeyi (AuthorityLevel) — retrieval sıralama metadata'sıdır,
 * hukuki geçerlilik hiyerarşisi DEĞİLDİR:
 *   10 = Resmî Gazete / yetkili resmî kaynak (mevzuat.gov.tr beslemesi)
 */

/** mevzuat.gov.tr MevzuatTür kodları (tarayıcıdan doğrulanmış seçim listesi). */
export const MEVZUAT_GOV_TURLER = {
  TUMU: 0,
  KANUN: 1,
  TUZUK: 2,
  KHK: 4,
  KURUM_YONETMELIK: 7,
  UNIVERSITE_YONETMELIK: 8,
  TEBLIG: 9,
  BAKANLAR_KURULU_YONETMELIK: 10,
  CB_KARARNAME: 19,
  CB_KARAR: 20,
  CB_YONETMELIK: 21,
  CB_GENELGE: 22,
} as const;
export type MevzuatGovTur = (typeof MEVZUAT_GOV_TURLER)[keyof typeof MEVZUAT_GOV_TURLER];

/** Arama kapsamı (tarayıcıdan doğrulanmış değerler: Baslik | Icerik | Tumu). */
export type MevzuatAramaYer = "Baslik" | "Icerik" | "Tumu";

/** MevzuatTur kodu → NomosOS belge türü. */
export function govTurToDocType(mevzuatTur: number): string {
  switch (mevzuatTur) {
    case MEVZUAT_GOV_TURLER.KANUN:
      return "KANUN";
    case MEVZUAT_GOV_TURLER.KHK:
    case MEVZUAT_GOV_TURLER.CB_KARARNAME:
      return "KHK";
    case MEVZUAT_GOV_TURLER.TUZUK:
    case MEVZUAT_GOV_TURLER.KURUM_YONETMELIK:
    case MEVZUAT_GOV_TURLER.UNIVERSITE_YONETMELIK:
    case MEVZUAT_GOV_TURLER.BAKANLAR_KURULU_YONETMELIK:
    case MEVZUAT_GOV_TURLER.CB_YONETMELIK:
      return "YONETMELIK";
    case MEVZUAT_GOV_TURLER.TEBLIG:
      return "TEBLIG";
    case MEVZUAT_GOV_TURLER.CB_GENELGE:
      return "GENELGE";
    default:
      return "DIGER";
  }
}

/** Tek mevzuat arama sonucu satırı (künye). */
export interface MevzuatSearchHit {
  /** mevzuat.gov.tr kayıt kimliği: "MevZUATNO.TUR.TERTIP". */
  externalKey: string;
  mevzuatNo: string;
  mevzuatTur: number;
  tertip: number;
  title: string;
  /** dd.mm.yyyy ya da null. */
  kabulTarihi?: string | null;
  rgTarihi?: string | null;
  rgSayisi?: string | null;
  /** "mevzuat?MevzuatNo=..&MevzuatTur=..&MevzuatTertip=.." (göreli). */
  url: string;
  sourceUrl: string;
}

export interface MevzuatSearchFilters {
  query: string;
  mevzuatTur?: number;
  aramaYer?: MevzuatAramaYer;
  page?: number;
  pageSize?: number;
}

/** Konsolide metin dokümanı. */
export interface MevzuatDocument {
  externalKey: string;
  mevzuatNo: string;
  mevzuatTur: number;
  tertip: number;
  /** Etiketlerden temizlenmiş tam metin. */
  text: string;
  sourceUrl: string;
}

export interface MevzuatConnectorHealth {
  key: string;
  name: string;
  healthy: boolean;
  message: string;
  checkedAt: Date;
}

/**
 * Mevzuat kaynağı sözleşmesi. Uygulayan sınıf:
 *  - dış kaynağı yormaz (hız limiti + zaman aşımı zorunlu),
 *  - HAVUZA YAZMAZ (yazım onaylı legislation-ingest hattındadır),
 *  - hata durumunda dürüst hata fırlatır; boş/uydurma veri döndürmez.
 */
export interface LegislationSourceConnector {
  readonly key: string;
  readonly name: string;
  readonly authorityLevel: number;

  search(filters: MevzuatSearchFilters): Promise<{ hits: MevzuatSearchHit[]; total: number }>;
  /** Konsolide tam metni çeker (kanunlar için madde ayrıştırma girdisi). */
  fetchDocument(externalKey: string): Promise<MevzuatDocument>;
  healthCheck(): Promise<MevzuatConnectorHealth>;
}

/** "22.05.2003" → "2003-05-22" (ISO; ISO'ya çevrilemeyen değer undefined). */
export function parseTrDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value.trim());
  if (!m) return undefined;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
