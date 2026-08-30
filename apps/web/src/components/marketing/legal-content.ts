/**
 * YASAL METİNLER — KVKK aydınlatma, kullanım koşulları, çerez politikası.
 *
 * NEDEN AYRI DOSYA VE NEDEN GERÇEK METİN:
 * Demo formu "KVKK aydınlatma metnini okudum" beyanını ZORUNLU tutuyor ve
 * `/guvenlik#kvkk-aydinlatma` çıpasına bağlanıyordu. O çıpanın indiği kutuda
 * aydınlatma metni yoktu; yazan şey "tam metinler sözleşme sürecinde
 * paylaşılır" idi. Yani ziyaretçiye, YAYIMLANMAMIŞ bir metni okuduğu beyan
 * ettiriliyordu — üstelik ürünün ana satış argümanının (KVKK titizliği)
 * sergilendiği sayfada.
 *
 * KVKK m.10 aydınlatma yükümlülüğü veri toplama ANINDA yerine getirilir; metin,
 * form gönderilmeden önce erişilebilir ve TAM olmalıdır. Bu dosya o metni
 * taşır.
 *
 * KAPSAM SINIRI — DÜRÜSTLÜK: buradaki metinler NomosOS'un TANITIM SİTESİ
 * üzerinden topladığı veriye (demo talebi, iletişim) ilişkindir. Bir hukuk
 * bürosu NomosOS'u kullanmaya başladığında veri sorumlusu BÜRODUR ve NomosOS
 * veri işleyendir; o ilişkinin aydınlatma ve veri işleme protokolü sözleşme
 * setinin parçasıdır. Bu ayrım her metinde açıkça yazılıdır.
 *
 * PLACEHOLDER YOKTUR: ticari unvan, adres ve VKN gibi alanlar şirket kaydı
 * tamamlandığında güncellenecek TEK YERDİR (`controller` bloğu) ve şu an
 * "kuruluş sürecinde" olduğu AÇIKÇA yazılıdır — uydurma bir sicil numarası
 * yazmak, metnin tamamını güvenilmez kılardı.
 */

export interface LegalSection {
  id: string;
  title: string;
  /** Paragraflar. */
  paragraphs: string[];
  /** Madde listesi (varsa). */
  bullets?: string[];
}

export interface LegalDocument {
  slug: string;
  kicker: string;
  title: string;
  lead: string;
  /** Son güncelleme — metnin sürümü. */
  updatedAt: string;
  sections: LegalSection[];
  /** Sayfanın altındaki kısa not. */
  footnote: string;
}

/** Veri sorumlusu künyesi — üç metinde de aynı blok kullanılır. */
const CONTROLLER_LINES = [
  "Veri sorumlusu: NomosOS (MindAeon AI bünyesinde yürütülen ürün çalışması).",
  "İletişim: iletisim@nomosos.com · Demo ve satış: demo@nomosos.com",
  "Ticari unvan, sicil bilgileri ve tebligat adresi şirket kuruluş süreci tamamlandığında " +
    "bu sayfada yayımlanacaktır; bu bilgiler talep etmeniz hâlinde hâlihazırda " +
    "iletisim@nomosos.com adresinden yazılı olarak paylaşılır.",
];

export const kvkkAydinlatma: LegalDocument = {
  slug: "kvkk-aydinlatma",
  kicker: "KVKK",
  title: "Aydınlatma Metni",
  lead:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu m.10 uyarınca, bu sitede kişisel " +
    "verilerinizi hangi amaçla, hangi hukuki sebeple işlediğimizi ve haklarınızı " +
    "aşağıda açıklıyoruz.",
  updatedAt: "31.08.2026",
  sections: [
    {
      id: "veri-sorumlusu",
      title: "Veri sorumlusunun kimliği",
      paragraphs: CONTROLLER_LINES,
    },
    {
      id: "kapsam",
      title: "Bu metnin kapsamı",
      paragraphs: [
        "Bu aydınlatma metni, NomosOS tanıtım sitesi (nomosos.com) üzerinden ilettiğiniz " +
          "demo talebi ve iletişim bilgilerine ilişkindir.",
        "Büronuz NomosOS'u kullanmaya başladığında, sisteme girilen müvekkil ve dosya " +
          "verileri bakımından VERİ SORUMLUSU BÜRONUZDUR; NomosOS veri işleyen sıfatıyla " +
          "hareket eder. O ilişkinin şartları, sözleşme setinin parçası olan veri işleme " +
          "protokolüyle düzenlenir ve bu metnin kapsamı dışındadır.",
      ],
    },
    {
      id: "islenen-veriler",
      title: "İşlenen kişisel veriler",
      paragraphs: [
        "Demo talep formu üzerinden yalnızca sizin girdiğiniz şu veriler işlenir:",
      ],
      bullets: [
        "Kimlik: ad ve soyad",
        "İletişim: e-posta adresi, telefon numarası",
        "Mesleki bilgi: bağlı olduğunuz baro / büro adı, bürodaki avukat sayısı",
        "Talebinize eklediğiniz serbest metin (opsiyonel mesaj alanı)",
      ],
    },
    {
      id: "amac",
      title: "İşleme amaçları",
      paragraphs: ["Yukarıdaki veriler yalnızca şu amaçlarla işlenir:"],
      bullets: [
        "Demo talebinizi karşılamak ve sizinle randevu planlamak",
        "Büronuzun ihtiyacına uygun bir teklif hazırlamak",
        "Talebinize ilişkin yazışmaları yürütmek ve kayıt altında tutmak",
      ],
    },
    {
      id: "hukuki-sebep",
      title: "Hukuki sebep",
      paragraphs: [
        "Veriler, KVKK m.5/2-(c) uyarınca «bir sözleşmenin kurulması veya ifasıyla " +
          "doğrudan doğruya ilgili olması» ve m.5/2-(f) uyarınca «veri sorumlusunun meşru " +
          "menfaati» hukuki sebeplerine dayanılarak işlenir. Formda verdiğiniz açık onay, " +
          "işlemenin sizin talebinizle başladığını gösterir.",
      ],
    },
    {
      id: "aktarim",
      title: "Aktarım",
      paragraphs: [
        "Demo talebiniz YURT DIŞINA AKTARILMAZ ve üçüncü kişilere satılmaz, pazarlama " +
          "amacıyla paylaşılmaz.",
        "Veriler yalnızca talebinizi karşılayan NomosOS ekibi tarafından görülür. Barındırma " +
          "ve e-posta altyapısı hizmet sağlayıcıları, KVKK m.8 kapsamında ve yalnız hizmetin " +
          "gerektirdiği ölçüde işleyen sıfatıyla erişebilir.",
      ],
    },
    {
      id: "saklama",
      title: "Saklama süresi",
      paragraphs: [
        "Demo talebi verileri, talebin sonuçlanmasından itibaren EN ÇOK 12 AY saklanır ve " +
          "süre sonunda silinir. Görüşme bir sözleşmeyle sonuçlanırsa, veriler sözleşme " +
          "ilişkisi kapsamındaki saklama sürelerine tabi olur.",
        "Süresi dolmadan silinmesini talep edebilirsiniz; talebiniz aşağıdaki haklar " +
          "bölümündeki usule göre karşılanır.",
      ],
    },
    {
      id: "haklar",
      title: "İlgili kişi olarak haklarınız (KVKK m.11)",
      paragraphs: [
        "Veri sorumlusuna başvurarak şu haklarınızı kullanabilirsiniz:",
      ],
      bullets: [
        "Kişisel verinizin işlenip işlenmediğini öğrenme ve işlenmişse buna ilişkin bilgi talep etme",
        "İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme",
        "Yurt içinde veya yurt dışında verilerin aktarıldığı üçüncü kişileri bilme",
        "Eksik veya yanlış işlenmiş olması hâlinde düzeltilmesini isteme",
        "KVKK m.7'deki şartlar çerçevesinde silinmesini veya yok edilmesini isteme",
        "Düzeltme, silme ve yok etme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme",
        "Münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonuç " +
          "doğmasına itiraz etme",
        "Kanuna aykırı işlenme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme",
      ],
    },
    {
      id: "basvuru",
      title: "Başvuru yolu",
      paragraphs: [
        "Taleplerinizi iletisim@nomosos.com adresine iletebilirsiniz. Başvurunuz, Veri " +
          "Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ uyarınca en geç 30 gün " +
          "içinde sonuçlandırılır ve tarafınıza yazılı olarak bildirilir.",
      ],
    },
  ],
  footnote:
    "Bu metin tanıtım sitesi üzerinden toplanan verilere ilişkindir. NomosOS'u kullanan " +
    "bir büroda müvekkil verilerinin veri sorumlusu büronun kendisidir.",
};

export const kullanimKosullari: LegalDocument = {
  slug: "kullanim-kosullari",
  kicker: "YASAL",
  title: "Kullanım Koşulları",
  lead:
    "Bu koşullar, NomosOS tanıtım sitesinin kullanımına ilişkindir. Ürünün kendisine " +
    "erişim, ayrıca imzalanan abonelik sözleşmesiyle düzenlenir.",
  updatedAt: "31.08.2026",
  sections: [
    {
      id: "taraflar",
      title: "Taraflar ve kapsam",
      paragraphs: [
        ...CONTROLLER_LINES,
        "Siteyi kullanarak bu koşulları kabul etmiş sayılırsınız. Koşulları kabul " +
          "etmiyorsanız siteyi kullanmayınız.",
      ],
    },
    {
      id: "hukuki-danismanlik-degildir",
      title: "Hukuki danışmanlık verilmez",
      paragraphs: [
        "NomosOS BİR HUKUK BÜROSU DEĞİLDİR ve hukuki danışmanlık vermez. Sitedeki hiçbir " +
          "içerik — süre hesabı örnekleri dâhil — somut bir uyuşmazlığa ilişkin hukuki " +
          "görüş, tavsiye veya vekâlet ilişkisi doğurmaz.",
        "Üründe üretilen yapay zekâ çıktıları ÖNERİDİR; her çıktının doğruluğundan ve " +
          "kullanımından avukat sorumludur. Süre ve para hesapları deterministik kural " +
          "motorlarıyla yapılır, yine de nihai denetim avukata aittir.",
      ],
    },
    {
      id: "fikri-haklar",
      title: "Fikri haklar",
      paragraphs: [
        "Sitedeki metin, görsel düzen, yazılım ve tasarım unsurlarının hakları NomosOS'a " +
          "aittir. Kaynak gösterilerek alıntı yapılabilir; bütünüyle veya önemli ölçüde " +
          "kopyalanamaz, ticari amaçla çoğaltılamaz.",
      ],
    },
    {
      id: "sorumluluk",
      title: "Sorumluluğun sınırı",
      paragraphs: [
        "Site içeriği, yayımlandığı tarihteki bilgiye dayanır. Mevzuat değişebilir; " +
          "sitedeki örnekler ve açıklamalar güncelliğini yitirebilir. NomosOS, site " +
          "içeriğine dayanılarak alınan kararlardan sorumlu tutulamaz.",
        "Hizmetin kesintisiz veya hatasız olacağı taahhüt edilmez; bakım ve geliştirme " +
          "sebebiyle geçici kesintiler olabilir.",
      ],
    },
    {
      id: "degisiklik",
      title: "Değişiklikler ve uygulanacak hukuk",
      paragraphs: [
        "Bu koşullar önceden haber verilmeksizin güncellenebilir; güncel sürüm bu sayfada " +
          "yayımlanır ve yayım tarihinde yürürlüğe girer.",
        "Uyuşmazlıklarda Türk hukuku uygulanır ve Ankara mahkemeleri ile icra daireleri " +
          "yetkilidir.",
      ],
    },
  ],
  footnote:
    "Abonelik, hizmet seviyesi ve veri işleme protokolü ayrı sözleşme metinleriyle " +
    "düzenlenir ve sözleşme sürecinde imzalanır.",
};

export const cerezPolitikasi: LegalDocument = {
  slug: "cerez-politikasi",
  kicker: "YASAL",
  title: "Çerez Politikası",
  lead:
    "Bu sitede reklam veya profilleme amaçlı izleme yapılmaz. Kullanılan çerezler " +
    "aşağıda tek tek sayılmıştır.",
  updatedAt: "31.08.2026",
  sections: [
    {
      id: "kullanilan-cerezler",
      title: "Kullanılan çerezler",
      paragraphs: [
        "Tanıtım sayfalarında (ana sayfa, güvenlik, fiyatlandırma, demo) YALNIZCA zorunlu " +
          "çerezler kullanılır. Üçüncü taraf reklam ağı, sosyal medya izleyicisi veya " +
          "davranışsal analitik betiği yüklenmez.",
      ],
      bullets: [
        "Zorunlu / oturum çerezleri: uygulamaya giriş yaptığınızda oturumunuzun sürmesi " +
          "için gereklidir. Tanıtım sayfalarında oturum çerezi oluşturulmaz.",
        "Güvenlik çerezleri: form gönderimlerinde kötüye kullanımı önlemek için " +
          "kullanılabilir; kişisel profil oluşturmaz.",
      ],
    },
    {
      id: "yerel-depolama",
      title: "Yerel depolama",
      paragraphs: [
        "Uygulamaya giriş yaptığınızda oturum anahtarınız tarayıcınızın yerel " +
          "depolamasında (localStorage) tutulur. Bu bir çerez değildir, sunucuya " +
          "kendiliğinden gönderilmez ve çıkış yaptığınızda silinir.",
      ],
    },
    {
      id: "yonetim",
      title: "Çerezleri yönetmek",
      paragraphs: [
        "Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Zorunlu " +
          "çerezleri engellemeniz hâlinde uygulamaya giriş yapamayabilirsiniz; tanıtım " +
          "sayfaları ise normal şekilde çalışmaya devam eder.",
      ],
    },
    {
      id: "iletisim",
      title: "İletişim",
      paragraphs: CONTROLLER_LINES,
    },
  ],
  footnote:
    "Çerez kullanımı değişirse bu sayfa güncellenir ve güncelleme tarihi yukarıda " +
    "gösterilir.",
};

export const legalDocuments = [kvkkAydinlatma, kullanimKosullari, cerezPolitikasi] as const;
