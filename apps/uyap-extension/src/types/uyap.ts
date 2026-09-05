/**
 * UYAP Avukat Portalı DOM modelleri.
 *
 * Bu tipler parser katmanının çıktısıdır: sayfadan OKUNAN ham veriyi temsil eder.
 * NomosOS'a gönderilen aktarım gövdeleri için `types/dto.ts` kullanılır.
 *
 * Kural: bir alan sayfada yoksa `null` olur — asla tahmin/uydurma değer üretilmez.
 */

/** Parser'ların tanıdığı UYAP sayfa türleri. */
export type UyapPageKind =
  | "DOSYA_LISTESI"
  | "DOSYA_DETAY"
  | "ICRA_DOSYA"
  | "SAFAHAT"
  | "EVRAK_LISTESI"
  | "DURUSMA";

/** Dosya tarafı (davacı/davalı/alacaklı/borçlu…) ve varsa vekili. */
export interface UyapTaraf {
  /** UYAP'taki taraf sıfatı metni, olduğu gibi (ör. "Davacı", "Borçlu"). */
  readonly rol: string;
  /** Ad soyad veya ünvan. */
  readonly ad: string;
  /** Vekil metni; yoksa null. */
  readonly vekil: string | null;
  /** Satır sırası (varsa). */
  readonly sira: number | null;
}

/** Dosya listesi satırından çıkan özet. */
export interface UyapDosyaOzeti {
  /** UYAP iç kimliği (dosyaId query parametresi / data-dosyaid); yoksa null. */
  readonly uyapDosyaId: string | null;
  /** "2026/145" biçiminde esas/dosya numarası. */
  readonly dosyaNo: string;
  /** Dosya numarasının yıl bileşeni. */
  readonly yil: number | null;
  /** Dosya numarasının sıra bileşeni. */
  readonly sira: number | null;
  /** Yargı birimi / mahkeme adı (ör. "İstanbul 12. İş Mahkemesi"). */
  readonly birim: string;
  /** Dosya türü metni; yoksa null. */
  readonly dosyaTuru: string | null;
  /** Dosya durumu metni (ör. "Derdest"); yoksa null. */
  readonly durum: string | null;
  /** Açılış tarihi — ISO 8601 (yalnızca tarih: YYYY-MM-DD); yoksa null. */
  readonly acilisTarihi: string | null;
  /** Dosya detay sayfasının mutlak adresi; yoksa null. */
  readonly detayUrl: string | null;
}

/** Dosya detay sayfasının çıktısı. */
export interface UyapDosyaDetay extends UyapDosyaOzeti {
  /** Dava konusu / takip türü metni. */
  readonly konu: string | null;
  /** Varsa hâkim/icra müdürü bilgisi. */
  readonly gorevli: string | null;
  /** Dosyadaki taraflar. */
  readonly taraflar: readonly UyapTaraf[];
  /** Faz 6: icra dosyası ekranından okunan takip alanları; icra değilse yok/null. */
  readonly icra?: UyapIcraDosya | null;
}

/** Faz 6: UYAP icra dosyası ekranındaki takip bilgileri. Okunamayan alan null (tahmin yok). */
export interface UyapIcraDosya {
  /** Takip türü metni, olduğu gibi (ör. "İlamsız Takip (Genel Haciz Yolu)"). */
  readonly takipTuru: string | null;
  /** Takip tarihi — ISO 8601 tarih; yoksa açılış tarihi. */
  readonly takipTarihi: string | null;
  /** Alacak tutarı — "12500.00" biçiminde ondalık metin; yoksa null. */
  readonly alacakTutari: string | null;
  /** Dosya aşaması metni (ör. "Haciz"). */
  readonly asama: string | null;
  /** Borçlu adı — künyeden ya da taraflar tablosundan. */
  readonly borclu: string | null;
  /** Alacaklı adı — künyeden ya da taraflar tablosundan. */
  readonly alacakli: string | null;
}

/** Safahat (kronolojik işlem) kaydı. */
export interface UyapSafahatKaydi {
  readonly sira: number | null;
  /** İşlem tarihi — ISO 8601 (tarih veya +03:00 ofsetli tarih-saat). */
  readonly tarih: string;
  /** İşlem türü metni (ör. "Tensip Zaptı Düzenlendi"). */
  readonly islem: string;
  readonly aciklama: string | null;
  readonly birim: string | null;
}

/** Evrak listesi satırı. */
export interface UyapEvrakKaydi {
  /** UYAP evrak kimliği (evrakId); yoksa null. */
  readonly evrakId: string | null;
  /** Evrak adı; yoksa null (bu durumda `tur` dolu olmak zorundadır). */
  readonly ad: string | null;
  /** Evrak türü metni; yoksa null. */
  readonly tur: string | null;
  /** Evrak tarihi — ISO 8601. */
  readonly tarih: string | null;
  readonly gonderen: string | null;
  /** Boyut (byte); "1,2 MB" gibi metinden çözülür, çözülemezse null. */
  readonly boyutBytes: number | null;
  /** İndirme bağlantısının mutlak adresi; yoksa null (indirilemez evrak). */
  readonly indirmeUrl: string | null;
  /** Dosya uzantısı ipucu (udf/pdf/tif…); yoksa null. */
  readonly uzanti: string | null;
}

/** Duruşma/keşif kaydı. */
export interface UyapDurusmaKaydi {
  /** İlgili dosya numarası (duruşma listesi sayfasında satır bazlı gelir). */
  readonly dosyaNo: string | null;
  readonly birim: string | null;
  /** Duruşma zamanı — ISO 8601 (+03:00 ofsetli, saat varsa). */
  readonly tarih: string;
  readonly salon: string | null;
  /** Duruşma türü metni (ör. "Ön İnceleme", "Duruşma", "e-Duruşma"). */
  readonly tur: string | null;
  readonly aciklama: string | null;
}

/** Dosya listesi sayfası parse çıktısı. */
export interface UyapDosyaListesi {
  readonly dosyalar: readonly UyapDosyaOzeti[];
  /** Sayfada gösterilen toplam kayıt sayısı (bulunabilirse). */
  readonly toplamKayit: number | null;
}

/** Safahat sayfası parse çıktısı. */
export interface UyapSafahatListesi {
  /** Sayfadan tespit edilebiliyorsa ilgili dosya numarası. */
  readonly dosyaNo: string | null;
  readonly kayitlar: readonly UyapSafahatKaydi[];
}

/** Evrak listesi sayfası parse çıktısı. */
export interface UyapEvrakListesi {
  readonly dosyaNo: string | null;
  readonly evraklar: readonly UyapEvrakKaydi[];
}

/** Duruşma sayfası parse çıktısı. */
export interface UyapDurusmaListesi {
  readonly durusmalar: readonly UyapDurusmaKaydi[];
}
