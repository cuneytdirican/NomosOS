/**
 * MÜVEKKİL DİLİ SÖZLÜĞÜ.
 *
 * Bu dosya portalın en önemli ürün kararını taşır: **büro panelindeki her etiket,
 * müvekkil ekranında sade karşılığıyla gösterilir.** Avukat "DERDEST" görür,
 * müvekkil "Görülmeye devam ediyor" görür.
 *
 * Üç katmanlı yaklaşım:
 *   1. `*_PLAIN`  → enum'un sade Türkçe karşılığı (kısa, rozet/başlık için)
 *   2. `*_EXPLAIN`→ bir cümlelik açıklama (baloncukta veya kartın altında)
 *   3. `GLOSSARY` → serbest metinde geçen hukuk terimleri (tensip zaptı, safahat…)
 *
 * KURAL: hiçbir yerde ham enum gösterilmez. Bilinmeyen bir enum gelirse
 * `plain()` yardımcısı onu ekranda göstermek yerine nötr bir ifadeye düşürür —
 * müvekkile "ICRADA" yazmak, bilgi vermekten çok endişe yaratır.
 */

// ---------------------------------------------------------------------------
// Dosya durumu
// ---------------------------------------------------------------------------

export const CASE_STATUS_PLAIN: Record<string, string> = {
  ACIK: "Dosya açıldı",
  DERDEST: "Görülmeye devam ediyor",
  KARAR: "Karar aşamasında",
  ISTINAF: "Üst mahkemede inceleniyor",
  TEMYIZ: "Yargıtay incelemesinde",
  KESINLESTI: "Karar kesinleşti",
  ICRADA: "Tahsilat aşamasında",
  KAPANDI: "Sonuçlandı",
  ARSIV: "Arşivde",
};

export const CASE_STATUS_EXPLAIN: Record<string, string> = {
  ACIK: "Dosyanız açıldı, hazırlık işlemleri sürüyor.",
  DERDEST:
    "Dava mahkemede görülüyor. Duruşmalar devam ediyor, henüz karar verilmedi.",
  KARAR: "Mahkeme kararını verdi ya da vermek üzere; gerekçesi bekleniyor.",
  ISTINAF:
    "Karara itiraz edildi ve dosya bir üst mahkemede (Bölge Adliye Mahkemesi) yeniden inceleniyor.",
  TEMYIZ: "Dosya, son inceleme mercii olan Yargıtay'da değerlendiriliyor.",
  KESINLESTI:
    "Karar artık değiştirilemez hâle geldi; itiraz yolları tamamlandı.",
  ICRADA:
    "Kararla belirlenen alacağın tahsili için icra işlemleri yürütülüyor.",
  KAPANDI: "Bu dosyada yapılacak bir işlem kalmadı.",
  ARSIV: "Dosya kapandı ve arşive kaldırıldı.",
};

export type Tone = "neutral" | "info" | "good" | "warn" | "alert";

export const CASE_STATUS_TONES: Record<string, Tone> = {
  ACIK: "info",
  DERDEST: "info",
  KARAR: "warn",
  ISTINAF: "warn",
  TEMYIZ: "warn",
  KESINLESTI: "good",
  ICRADA: "warn",
  KAPANDI: "neutral",
  ARSIV: "neutral",
};

export const CASE_TYPE_PLAIN: Record<string, string> = {
  DAVA: "Dava",
  ICRA: "İcra takibi",
  ARABULUCULUK: "Arabuluculuk",
  CEZA: "Ceza dosyası",
  DANISMANLIK: "Danışmanlık",
};

// ---------------------------------------------------------------------------
// Taraflar
// ---------------------------------------------------------------------------

export const PARTY_ROLE_PLAIN: Record<string, string> = {
  DAVACI: "Davayı açan taraf",
  DAVALI: "Davanın açıldığı taraf",
  MUDAHIL: "Davaya sonradan katılan",
  ALACAKLI: "Alacaklı taraf",
  BORCLU: "Borçlu taraf",
  SANIK: "Hakkında dava açılan kişi",
  MUSTEKI: "Şikâyetçi",
  KATILAN: "Davaya katılan",
  TANIK: "Tanık",
  DIGER: "İlgili",
};

// ---------------------------------------------------------------------------
// Duruşmalar
// ---------------------------------------------------------------------------

export const HEARING_TYPE_PLAIN: Record<string, string> = {
  DURUSMA: "Duruşma",
  ON_INCELEME: "Ön inceleme duruşması",
  KESIF: "Keşif",
  E_DURUSMA: "Çevrimiçi duruşma",
  MUZAKERE: "Görüşme",
  DIGER: "Mahkeme işlemi",
};

export const HEARING_TYPE_EXPLAIN: Record<string, string> = {
  DURUSMA: "Tarafların ve avukatların mahkemede dinlendiği oturum.",
  ON_INCELEME:
    "Davanın ilk oturumu: mahkeme, tarafların iddialarını ve delillerini belirler.",
  KESIF:
    "Mahkeme heyetinin, uyuşmazlık konusu yeri veya malı yerinde görmesi.",
  E_DURUSMA: "Duruşmaya adliyeye gitmeden, çevrimiçi bağlanılarak katılınır.",
  MUZAKERE: "Tarafların anlaşma amacıyla bir araya geldiği görüşme.",
};

export const HEARING_STATUS_PLAIN: Record<string, string> = {
  PLANLANDI: "Planlandı",
  YAPILDI: "Yapıldı",
  ERTELENDI: "Ertelendi",
  IPTAL: "İptal edildi",
};

export const HEARING_STATUS_TONES: Record<string, Tone> = {
  PLANLANDI: "info",
  YAPILDI: "good",
  ERTELENDI: "warn",
  IPTAL: "neutral",
};

// ---------------------------------------------------------------------------
// Belgeler
// ---------------------------------------------------------------------------

export const DOCUMENT_CLASS_PLAIN: Record<string, string> = {
  DILEKCE: "Dilekçe",
  TENSIP_ZAPTI: "Tensip zaptı",
  ARA_KARAR: "Ara karar",
  GEREKCELI_KARAR: "Gerekçeli karar",
  BILIRKISI_RAPORU: "Bilirkişi raporu",
  DURUSMA_TUTANAGI: "Duruşma tutanağı",
  TEBLIGAT: "Tebligat",
  MUZEKKERE: "Müzekkere",
  VEKALETNAME: "Vekaletname",
  SOZLESME: "Sözleşme",
  DELIL: "Delil",
  FATURA: "Fatura",
  ICRA_EVRAKI: "İcra evrakı",
  DIGER: "Belge",
};

// ---------------------------------------------------------------------------
// Ödemeler
// ---------------------------------------------------------------------------

export const INVOICE_STATUS_PLAIN: Record<string, string> = {
  TASLAK: "Hazırlanıyor",
  GONDERILDI: "Ödeme bekliyor",
  KISMI_ODENDI: "Kısmen ödendi",
  ODENDI: "Ödendi",
  IPTAL: "İptal edildi",
  IADE: "İade edildi",
};

export const INVOICE_STATUS_TONES: Record<string, Tone> = {
  TASLAK: "neutral",
  GONDERILDI: "warn",
  KISMI_ODENDI: "warn",
  ODENDI: "good",
  IPTAL: "neutral",
  IADE: "neutral",
};

export const PAYMENT_METHOD_PLAIN: Record<string, string> = {
  HAVALE: "Havale / EFT",
  KREDI_KARTI: "Kredi kartı",
  NAKIT: "Nakit",
  CEK: "Çek",
  SENET: "Senet",
  MAHSUP: "Mahsup",
  DIGER: "Diğer",
};

// ---------------------------------------------------------------------------
// Hukuk terimleri sözlüğü — serbest metinde geçen jargon
// ---------------------------------------------------------------------------

/**
 * `<Term>` bileşeni bu sözlüğü kullanır. Anahtarlar KÜÇÜK HARF ve Türkçe
 * karakterlidir; `lookupTerm()` normalize ederek arar.
 */
export const GLOSSARY: Record<string, string> = {
  "tensip zaptı":
    "Mahkemenin dava açılır açılmaz hazırladığı yol haritası: hangi işlemlerin, hangi sürelerde yapılacağını gösterir.",
  safahat:
    "Dosyada bugüne kadar yapılan işlemlerin tarih sırasıyla listesi — dosyanın geçmişi.",
  istinaf:
    "Mahkeme kararına itiraz edip dosyanın bir üst mahkemede (Bölge Adliye Mahkemesi) yeniden incelenmesini istemek.",
  temyiz:
    "İstinaf kararından sonra dosyanın Yargıtay'da son kez incelenmesini istemek.",
  derdest: "Davanın hâlâ mahkemede görülüyor, henüz sonuçlanmamış olması.",
  tebligat:
    "Mahkemenin veya karşı tarafın bir belgeyi size resmen ulaştırması. Çoğu süre, tebligat gününden sonra işlemeye başlar.",
  "e-tebligat":
    "Tebligatın kâğıt yerine elektronik ortamda (UETS) yapılması.",
  bilirkişi:
    "Mahkemenin, teknik veya uzmanlık gerektiren bir konuda görüşüne başvurduğu uzman.",
  "bilirkişi raporu":
    "Mahkemenin görevlendirdiği uzmanın hazırladığı teknik değerlendirme raporu.",
  "gerekçeli karar":
    "Mahkemenin kararını hangi sebeplerle verdiğini ayrıntılı anlattığı belge. İtiraz süreleri genellikle bunun tebliğiyle başlar.",
  "ara karar":
    "Dava sonuçlanmadan önce, yargılamanın yürüyüşüyle ilgili verilen ara nitelikteki kararlar.",
  "ön inceleme":
    "Davanın ilk duruşması: mahkeme iddiaları, savunmaları ve delilleri netleştirir.",
  keşif:
    "Mahkemenin uyuşmazlık konusu yeri veya malı bizzat yerinde incelemesi.",
  müzekkere:
    "Mahkemenin bir kurumdan bilgi veya belge istemek için yazdığı resmî yazı.",
  vekaletname:
    "Avukatınıza sizin adınıza işlem yapma yetkisi veren, noterde düzenlenen belge.",
  azil: "Avukata verilen vekaletin müvekkil tarafından geri alınması.",
  ihtarname:
    "Karşı tarafa, dava açmadan önce resmen uyarıda bulunmak için gönderilen noter yazısı.",
  haciz:
    "Borcun tahsili için borçlunun mal, maaş veya banka hesabına icra dairesince el konulması.",
  "icra takibi":
    "Ödenmeyen bir alacağın devlet eliyle (icra dairesi aracılığıyla) tahsil edilmesi süreci.",
  "ödeme emri":
    "İcra dairesinin borçluya gönderdiği, borcu ödemesi veya itiraz etmesi için verilen resmî yazı.",
  ilam: "Mahkeme kararının, icraya konulabilecek resmî örneği.",
  "husumet": "Davanın doğru kişiye yöneltilip yöneltilmediği meselesi.",
  "dava dilekçesi":
    "Davayı başlatan, talebinizi ve gerekçelerinizi anlatan resmî yazı.",
  "cevap dilekçesi":
    "Açılan davaya karşı, iddialara verilen resmî yanıt yazısı.",
  duruşma:
    "Tarafların ve avukatların mahkemede dinlendiği oturum.",
  "esas numarası":
    "Mahkemenin dosyanıza verdiği numara (örn. 2026/145). Adliyede dosyanız bu numarayla bulunur.",
  arabuluculuk:
    "Dava açmadan önce veya dava sırasında, tarafsız bir arabulucu eşliğinde anlaşma aranması.",
  islah: "Dava sırasında talebin veya iddiaların usulüne uygun biçimde düzeltilmesi.",
  "delil listesi": "Davada dayanılan belge ve tanıkların mahkemeye bildirildiği liste.",
};

/** Sözlükte arama — büyük/küçük harf ve baştaki/sondaki boşluk farkını yok sayar. */
export function lookupTerm(term: string): string | null {
  const key = term.trim().toLocaleLowerCase("tr-TR");
  return GLOSSARY[key] ?? null;
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

/**
 * Enum → sade karşılık.
 *
 * Bilinmeyen değer gösterilmez: ham enum (örn. "ICRADA") müvekkil ekranında
 * bilgi değil kaygı üretir. Bunun yerine `fallback` yazılır.
 */
export function plain(
  map: Record<string, string>,
  key: string | null | undefined,
  fallback = "Bilgi bekleniyor",
): string {
  if (!key) return fallback;
  return map[key] ?? fallback;
}

export function fmtDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

export function fmtTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(value: string | Date | null | undefined): string | null {
  const date = fmtDate(value);
  const time = fmtTime(value);
  if (!date) return null;
  return time ? `${date}, ${time}` : date;
}

/** "Pazartesi, 2 Eylül 2026" — duruşma listesinde gün başlığı. */
export function fmtDayHeading(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Gün sayısı farkı (gelecekse pozitif). Saat farkı yok sayılır. */
export function daysUntil(value: string | Date): number | null {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * "Yarın", "3 gün sonra", "geçen hafta" — müvekkilin okuyabileceği zaman ifadesi.
 * Süre uyarısı DEĞİLDİR: portalda geri sayım/kırmızı alarm kullanılmaz, bu
 * bilgilendirmedir. Hukuki süreleri takip etmek avukatın işidir.
 */
export function relativeDayLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const days = daysUntil(value);
  if (days === null) return null;
  if (days === 0) return "Bugün";
  if (days === 1) return "Yarın";
  if (days === -1) return "Dün";
  if (days > 1 && days <= 30) return `${days} gün sonra`;
  if (days < -1 && days >= -30) return `${Math.abs(days)} gün önce`;
  return null;
}

export function fmtMoney(
  value: string | number | null | undefined,
  currency = "TRY",
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("tr-TR", {
    style: "currency",
    currency: currency || "TRY",
    maximumFractionDigits: 2,
  });
}

export function fmtBytes(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** İlk dolu değeri döndürür — API alan adları değişebilir (name/fileName/title gibi). */
export function firstOf(
  ...values: Array<string | null | undefined>
): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/** Dosya başlığı: "2026/145 · Alacak Davası" — numara varsa öne alınır. */
export function caseHeadline(c: {
  fileNumber?: string;
  caseNumber?: string;
  title?: string;
  subject?: string;
}): string {
  const no = firstOf(c.fileNumber, c.caseNumber);
  const name = firstOf(c.title, c.subject);
  if (no && name) return `${no} · ${name}`;
  return no ?? name ?? "Dosyanız";
}
