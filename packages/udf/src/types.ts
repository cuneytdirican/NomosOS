/**
 * UDF (UYAP Doküman Formatı) veri modeli.
 *
 * UDF, UYAP'a dilekçe/evrak göndermek için kullanılan Türkiye'ye özgü bir belge
 * formatıdır. Teknik olarak içinde `content.xml` bulunan bir ZIP arşividir.
 * content.xml, Java Swing `StyledDocument` yapısının serileştirilmiş hâlidir:
 *   - `<content>` → CDATA içinde belgenin TAMAMININ düz metni
 *   - `<elements>` → offset + length tabanlı paragraf ve biçim aralıkları
 *
 * ÖNEMLİ (offset birimi): UDF, Java kökenli bir formattır ve offsetler Java
 * `String` indeksleridir; yani UTF-16 kod birimi (code unit) sayılır.
 * JavaScript'te `String.prototype.length` de UTF-16 kod birimi sayar; bu
 * nedenle bu paket offset/length hesaplarında doğrudan `str.length` kullanır.
 * UTF-8 BAYT uzunluğu KULLANILMAZ. Türkçe karakterler (ç, ğ, ı, ö, ş, ü, İ, Ğ)
 * BMP içinde ve tek UTF-16 birimidir; UTF-8'de 2 bayt tutmalarına rağmen offset
 * hesabını etkilemezler. BMP dışı karakterler (emoji vb.) hem Java'da hem
 * JavaScript'te 2 kod birimi sayıldığı için yine tutarlıdır.
 */

/** Paragraf hizalaması (Java Swing `StyleConstants` karşılıkları için bkz. spec.ts). */
export type UdfAlignment = "left" | "center" | "right" | "justify";

/** Karakter düzeyi biçim bilgisi. Tanımsız alanlar "miras al" anlamına gelir. */
export interface UdfTextStyle {
  /** Yazı tipi ailesi, ör. "Times New Roman". */
  fontFamily?: string;
  /** Punto cinsinden yazı tipi boyutu, ör. 12. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** `#RRGGBB` biçiminde metin rengi. */
  color?: string;
}

/**
 * Paragraf içinde biçimi farklılaşan bir metin aralığı.
 * `startOffset` PARAGRAF BAŞINA GÖRE görecelidir (belge başına göre değil).
 */
export interface UdfStyleRun {
  /** Paragraf metni içindeki başlangıç indeksi (UTF-16 kod birimi). */
  startOffset: number;
  /** Aralığın uzunluğu (UTF-16 kod birimi). */
  length: number;
  style: UdfTextStyle;
}

/** Bir paragrafın tamamına uygulanan yerleşim bilgisi. */
export interface UdfParagraphLayout {
  alignment?: UdfAlignment;
  /** Soldan girinti (punto/pixel — UDF birimi TEYİT GEREKİR). */
  leftIndent?: number;
  rightIndent?: number;
  /** İlk satır girintisi. */
  firstLineIndent?: number;
  spaceAbove?: number;
  spaceBelow?: number;
  /** Satır aralığı çarpanı (1 = tek, 1.5 = bir buçuk). */
  lineSpacing?: number;
}

/** UDF belgesindeki tek bir paragraf. */
export interface UdfParagraph {
  /**
   * Paragrafın düz metni. Satır sonu karakteri İÇERMEZ; paragraflar arası "\n"
   * ayırıcıyı builder ekler.
   */
  text: string;
  /** Paragrafın tamamı için varsayılan karakter biçimi. */
  style?: UdfTextStyle;
  /** Paragraf içindeki biçim farklılıkları (kalın/italik parçalar). */
  runs?: UdfStyleRun[];
  layout?: UdfParagraphLayout;
}

/** Sayfa düzeni. TEYİT GEREKİR: birimler ve öznitelik adları doğrulanmalıdır. */
export interface UdfPageFormat {
  /** Java `MediaSizeName` sıra numarası; UYAP dosyalarında genelde "1" (A4). */
  mediaSizeName?: number;
  leftMargin?: number;
  rightMargin?: number;
  topMargin?: number;
  bottomMargin?: number;
  /** 1 = dikey (portrait), 2 = yatay (landscape) varsayılır. */
  paperOrientation?: number;
  headerFOffset?: number;
  footerFOffset?: number;
}

/** Belge düzeyi üstveri. */
export interface UdfMetadata {
  /** content.xml kökündeki `format_id`. Varsayılan "1.8". */
  formatId?: string;
  /** UDF içinde taşınmaz; NomosOS tarafında dosya adı/başlık için kullanılır. */
  title?: string;
  /** UDF içinde taşınmaz; NomosOS üstverisidir. */
  author?: string;
  /** ZIP girdisinin zaman damgası olarak kullanılır (belirleyici çıktı için sabitlenebilir). */
  createdAt?: Date;
  pageFormat?: UdfPageFormat;
  /** `<elements resolution="...">` değeri. UYAP dosyalarında genelde 102. */
  resolution?: number;
}

/** Bellek içi UDF belgesi. */
export interface UdfDocument {
  metadata: UdfMetadata;
  /** Belgenin tüm paragrafları, görünüm sırasına göre. */
  paragraphs: UdfParagraph[];
  /** Hiçbir yerde ezilmediğinde geçerli olan karakter biçimi. */
  defaultStyle: UdfTextStyle;
  /**
   * `<content>` CDATA'sındaki HAM düz metin — ayrıştırma sırasında doldurulur.
   *
   * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 6): düz metin, paragraflardan YENİDEN
   * KURULUYORDU; `<elements>` bloğu metnin tamamını kapsamayan (yabancı üretici) bir
   * dosyada kapsanmayan kısım sessizce düşüyordu. README bu metni açıkça "KVKK PII
   * taraması" için gösterdiğinden, taranmamış TCKN/IBAN dış LLM'e gidebilirdi.
   * PII taraması ve indeksleme DAİMA bu alan üzerinden yapılmalıdır (`udfToPlainText`
   * varsa bunu döndürür).
   *
   * Builder ile bellekte kurulan belgelerde tanımsızdır (ham metin yoktur; kaynak
   * paragraflardır).
   */
  rawText?: string;
  /**
   * Ayrıştırma sırasında üretilen uyarılar (ör. paragraf kapsamı ham metnin tamamını
   * kapsamıyor). Boş dizi = uyarı yok. Çağıran bunu kullanıcıya/denetim kaydına yansıtmalıdır.
   */
  parseWarnings?: string[];
}

/** `createUdf` seçenekleri. */
export interface CreateUdfOptions {
  /** ZIP içindeki dosyaların sabit zaman damgası (belirleyici/deterministik çıktı). */
  entryDate?: Date;
  /** DEFLATE sıkıştırması uygulansın mı (varsayılan: true). */
  compress?: boolean;
  /** content.xml dışında arşive eklenecek ek dosyalar (ör. gömülü görseller). */
  extraFiles?: UdfExtraFile[];
}

/** UDF arşivine eklenecek ek dosya. */
export interface UdfExtraFile {
  /** Arşiv içindeki yol, ör. "images/imza.png". */
  path: string;
  content: Uint8Array | string;
}

/** ZIP'ten okunabilen ham girdi biçimleri. */
export type UdfInput = Uint8Array | ArrayBuffer | Buffer;
