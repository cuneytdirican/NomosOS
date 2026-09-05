/**
 * NomosOS tanıtım sitesi — bütün metinler burada toplanır.
 *
 * Kaynak: docs/08-tanitim-sitesi-icerik.md (§3). Metinler o dokümandan BİREBİR alınmıştır;
 * bileşenler metin gömmez, yalnızca buradan okur. Metin güncellemesi tek dosyadan yapılır.
 */

export const site = {
  name: "NomosOS",
  legalNote:
    "NomosOS bir hukuk bürosu değildir ve hukuki danışmanlık vermez. Sistem tarafından üretilen çıktılar avukat denetimine tabidir.",
  copyright: `© ${new Date().getFullYear()} NomosOS`,
  credit: {
    prefix: "Developed by",
    label: "MindAeon AI",
    href: "https://mindaeon.com",
  },
  contact: {
    email: "iletisim@nomosos.com",
    demoEmail: "demo@nomosos.com",
  },
} as const;

/* --------------------------------------------------------------------------
 * Üst gezinme
 * ----------------------------------------------------------------------- */

export const nav = {
  links: [
    { href: "/#moduller", label: "Özellikler" },
    { href: "/guvenlik", label: "Güvenlik" },
    { href: "/fiyatlandirma", label: "Fiyatlandırma" },
    { href: "/blog", label: "Blog" },
    { href: "/#sss", label: "SSS" },
  ],
  login: { href: "/giris", label: "Giriş Yap" },
  cta: { href: "/demo", label: "Demo Talep Edin" },
} as const;

/* --------------------------------------------------------------------------
 * 3.1 Hero
 * ----------------------------------------------------------------------- */

export const hero = {
  kicker: "HUKUK BÜROSU İŞLETİM SİSTEMİ",
  title: "Büronuzun bütün işi. Tek sistemde.",
  lead: "Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.",
  primary: { href: "/demo", label: "Demo Talep Edin" },
  secondary: { href: "#moduller", label: "Özellikleri İnceleyin" },
  trustStrip: [
    "Deterministik süre hesabı",
    "KVKK uyumlu veri mimarisi",
    "Kendi LLM'inizi bağlayın",
    "İçtihat atıf teyidi",
  ],
} as const;

/** Hero mockup'ında kullanılan örnek panel verisi (gerçek veri değildir). */
export const heroMockup = {
  sampleBadge: "örnek veri",
  windowTitle: "NomosOS · Panel",
  deadlines: {
    title: "Yaklaşan süreler",
    rows: [
      { case: "2026/412 E. — Alacak", type: "İstinaf süresi", due: "01.09.2026", left: "2 gün" },
      { case: "2026/188 E. — İşe iade", type: "Cevap dilekçesi", due: "04.09.2026", left: "5 gün" },
      { case: "2025/2210 E. — Tapu iptali", type: "Bilirkişi rapor itirazı", due: "09.09.2026", left: "10 gün" },
    ],
  },
  hearings: {
    title: "Bugünün duruşmaları",
    rows: [
      { time: "09:30", court: "Ankara 7. Asliye Hukuk", case: "2026/412 E." },
      { time: "11:00", court: "Ankara 3. İş Mahkemesi", case: "2026/188 E." },
      { time: "14:15", court: "Ankara 12. İcra Hukuk", case: "2026/77 E." },
    ],
  },
  queue: {
    title: "Onay bekleyen öneriler",
    value: "6",
    note: "Her öneri gerekçesi ve kaynak cümlesiyle listelenir.",
  },
} as const;

/* --------------------------------------------------------------------------
 * 3.2 Sorun
 * ----------------------------------------------------------------------- */

export const problem = {
  kicker: "NEDEN NOMOSOS",
  title: "Dosyanız yedi ayrı yerde duruyor.",
  paragraphs: [
    "Duruşma takviminiz bir yerde, dosya evrakı UYAP'ta, müvekkil bilgileri Excel'de, tahsilat takibi bir başka defterde. Süreler ajandada — ya da hafızada.",
    "Bir mahkeme kararı tebliğ edildiğinde şu soruların yanıtını aramak zorunda kalıyorsunuz: Hangi dosyaydı? Süre ne zaman doluyor? Kim ilgilenecek? Müvekkile ne yazacağız?",
  ],
  /** Son paragrafta "onayınıza sunar" vurgulanır. */
  closing: {
    before: "NomosOS bu soruların yanıtını, evrak sisteme girdiği anda kendisi çıkarır — ve ",
    strong: "onayınıza sunar.",
  },
  cards: [
    {
      title: "Süre riski",
      text: "Bir sürenin kaçması, dosyanın kaybedilmesi demektir.",
    },
    {
      title: "Dağınık bilgi",
      text: "Müvekkil aradığında 15 dakika dosya incelemek zorunda kalıyorsunuz.",
    },
    {
      title: "Görünmeyen tahsilat",
      text: "Hangi müvekkilden ne kadar alacağınız var, tek ekranda görünmüyor.",
    },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.3 Modüller (12 kart)
 * ----------------------------------------------------------------------- */

export const modules = {
  kicker: "MODÜLLER",
  title: "Büronun tamamı, tek sistemde.",
  items: [
    {
      title: "Müvekkil Yönetimi",
      text: "Gerçek ve tüzel kişi kartları, yetkililer, vekâletnameler, sözleşmeler. Bir müvekkilin bütün dosyaları, tahsilatları ve iletişim geçmişi tek ekranda.",
    },
    {
      title: "Dava Dosyası",
      text: "Taraflar, safahat, duruşmalar, deliller, kararlar, istinaf ve temyiz süreci. Dosyanın açılıştan kapanışa bütün yaşam döngüsü.",
    },
    {
      title: "Duruşma Yönetimi",
      text: "Bugünün duruşmaları sabah açtığınız ilk ekranda. Duruşma öncesi hazırlık paketi: son gelişmeler, karşı tarafın beyanları, sorulacak sorular.",
    },
    {
      title: "Süre Takibi",
      text: "Tebliğ tarihinden son güne kadar hesabı sistem yapar; her adımı gösterir. Kaçırılan sürenin bedelini bilen bir sistem.",
    },
    {
      title: "Görev ve İş Akışı",
      text: "Kim yapacak, kim kontrol edecek, kim onaylayacak. Avukat, stajyer, sekreter ve partner arasında net iş akışı.",
    },
    {
      title: "Belge Yönetimi",
      text: "Evrak sisteme girer girmez sınıflandırılır, dosyaya bağlanır, süresi tespit edilir ve size aksiyon önerisi sunulur.",
    },
    {
      title: "İcra Takibi",
      text: "Takip talebinden tahsilata bütün aşamalar, borçlu malvarlığı kaydı, faiz ve bakiye hesabı, İcra Copilot analizleri.",
    },
    {
      title: "Finans",
      text: "Tahakkuk, tahsilat, avans, masraf ve harç takibi. Müvekkil bazlı alacak durumu ve yaşlandırma tablosu.",
    },
    {
      title: "Faturalama",
      text: "Ücret sözleşmeleri, zaman kaydı, zaman kayıtlarından fatura üretimi, e-Fatura/e-Arşiv altyapısı.",
    },
    {
      title: "Dilekçe Stüdyosu",
      text: "Dosya bilgilerinden bölüm bölüm dilekçe taslağı. UDF formatında dışa aktarım. İçtihat atıfları kayıt üzerinden doğrulanmadan “hazır” olmaz; mevzuat atıfları tanınır ama doğrulanmaz.",
    },
    {
      title: "İçtihat Araştırma",
      text: "Karar arama, özetleme ve dosyaya emsal olarak bağlama. Her içtihat atfı kayıt üzerinden doğrulanır.",
    },
    {
      title: "Delil Matrisi",
      text: "İddia × delil matrisi: her bağın yönü (destekler mi, çürütür mü) ve gücü kayda geçer. Bizim sunduğumuz delili kendi iddiamıza çürütücü olarak bağlamazsınız — tutarlılık kuralı.",
    },
    {
      title: "Risk Değerlendirmesi",
      text: "Yedi boyutta deterministik risk skoru; yapay zekâ katkısı sınırlı ve her zaman görünür. Skorların kural tabanı her gece otomatik tazelenir.",
    },
    {
      title: "Randevu Yönetimi",
      text: "Büro ajandası ve müvekkil portalında self-servis randevu. Müvekkiliniz portalından 30 dakikalık randevu alır; sistem çakışan saatleri otomatik engeller.",
    },
    {
      title: "Vekalet Ücreti Hesabı",
      text: "AAÜT asgari ücret tarifesi üzerinden maktu/nispi hesaplama. Kademe, tekrar dilimi, asgari kuralı ve KDV — hesabın her adımı görünür. Tarife rakamlarını siz girersiniz, motor uydurmaz.",
    },
    {
      title: "Banka Haciz Cevabı Ajanı",
      text: "İİK m.89/2 banka cevap belgesi yüklendiğinde banka adı, IBAN, bakiye ve tarih otomatik tespit edilir. İcra dosyasına bağlıysa malvarlığı kaydı önerilir — kaydı yine siz onaylarsınız.",
    },
    {
      title: "UYAP Köprüsü",
      text: "Tarayıcı eklentisiyle dosya listesi, safahat ve evrak aktarımı. NomosOS'tan indirilir, eşleştirme koduyla büronuza bağlanır. UYAP'ın yerine geçmez; üzerine bir operasyon katmanı kurar.",
    },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.4 Süre motoru
 * ----------------------------------------------------------------------- */

export const deadline = {
  kicker: "ÖNE ÇIKAN",
  title: "Süreyi yapay zekâ değil, kural motoru hesaplar.",
  paragraphs: [
    "Bir sürenin yanlış hesaplanması meslekî sorumluluk doğurur. Bu yüzden NomosOS'ta süre hesabı yapay zekâya bırakılmaz: tebliğ tarihi, tebligat yöntemi, mevzuat hükmü, adli tatil ve resmî tatil takvimi kullanılarak deterministik olarak hesaplanır.",
    "Yapay zekânın görevi yalnızca tespit etmektir: “Bu belgede süre başlatan bir olay var.” Hesabı motor yapar, kararı siz verirsiniz.",
  ],
  /** Vurgulanacak kelime öbeği (ilk paragraf içinde kalın gösterilir). */
  emphasis: "deterministik olarak",
  /**
   * HESAP İZİ ARTIK BURADA DEĞİL — `deadline-trace.ts` içinde MOTORDAN üretilir.
   *
   * Elle yazıldığı sürece motordan sapıyordu: 3. adım "HMK m.92: tebliğ günü
   * hesaba katılmaz" diyordu, oysa örnek HMK m.345 istinaf süresidir ve birimi
   * HAFTA'dır — m.92/1 GÜN sürelerine aittir. Motor bu ayrımı bilerek yapar ve
   * "HMK m.91 + m.92/2 · karşılık gelen gün" der. Sonuç tarihi doğru, gerekçe
   * yanlıştı; bir hukuk ürününde asıl satılan gerekçedir.
   *
   * Aşağıda yalnız MOTORDAN GELMEYEN sunum metinleri kalır.
   */
  trace: {
    sampleBadge: "örnek veri",
    resultLabel: "SON GÜN",
    note: "Hesabın her adımı görünür. Neye güvendiğinizi bilirsiniz.",
    engineNote:
      "Bu iz elle yazılmamıştır: her satır, süre motorunun bu girdi için ürettiği " +
      "açıklamanın kendisidir.",
  },
  footnote:
    "29 hazır süre kuralı — HMK, İİK, CMK, İYUK, TKHK ve İş Kanunu hükümleriyle; büroya özel kural tanımlanabilir.",
} as const;

/* --------------------------------------------------------------------------
 * 3.5 Belge → Aksiyon hattı
 * ----------------------------------------------------------------------- */

export const pipeline = {
  kicker: "ÖNE ÇIKAN",
  title: "Evrak geldi. Sistem ne yapılacağını çıkardı.",
  lead: "Bugün belge yüklemek bir arşivleme işidir. NomosOS'ta belge, sürecin başlangıcıdır.",
  steps: [
    { title: "Evrak sisteme girer", detail: "yükleme · UYAP eklentisi · portal" },
    {
      title: "Metin çıkarılır ve sınıflandırılır",
      detail:
        "ara karar · bilirkişi raporu · tebligat … PDF, Word (DOCX), UDF ve düz metin (metin katmanı olan belgelerde)",
    },
    { title: "İlgili dosyayla eşleştirilir", detail: "" },
    { title: "Süre başlatan olaylar tespit edilir", detail: "kural motoru hesaplar" },
    { title: "Görev, süre ve safahat kaydı ÖNERİLİR", detail: "" },
    { title: "Siz onaylarsınız", detail: "sistem uygular" },
  ],
  callout: {
    title: "Onaysız kayıt oluşmaz.",
    text: "Sistem hiçbir kaydı kendiliğinden oluşturmaz. Her öneri, gerekçesi ve belgeden alınan kaynak cümlesiyle birlikte onay kuyruğunuza düşer. Onaylamadığınız hiçbir şey dosyanıza işlenmez.",
  },
} as const;

/* --------------------------------------------------------------------------
 * 3.6 Yapay zekâ
 * ----------------------------------------------------------------------- */

export const ai = {
  kicker: "YAPAY ZEKÂ",
  title: "Yapay zekâ önerir. Kararı siz verirsiniz.",
  lead: "NomosOS'ta yapay zekâ, dosyanızın bütün verisi üzerinde çalışan bir katmandır — ayrı bir sohbet penceresi değil. Analizleri TARAFSIZ yürütür: lehte bulguları abartmaz, aleyhte bulguları gizlemez.",
  cards: [
    {
      title: "Dosya Asistanı",
      text: "“Bu dosyada bilirkişi ne dedi?” diye sorun; yanıt, hangi belgenin hangi bölümüne dayandığını göstererek gelir. Kaynaksız cevap vermez.",
    },
    {
      title: "Dilekçe Stüdyosu",
      text: "Dosya bilgilerinden bölüm bölüm taslak: konu, açıklamalar, hukuki sebepler, deliller, sonuç ve istem. UDF olarak dışa aktarın.",
    },
    {
      title: "İcra Copilot",
      text: "Borçlunun malvarlığı ve işlem geçmişi analizi, sonraki adım önerileri, tahsilat ihtimali değerlendirmesi.",
    },
    {
      title: "Duruşma Hazırlığı",
      text: "Duruşmadan önce dosya özeti, son gelişmeler, karşı tarafın beyanları, eksik deliller ve sorulacak sorular.",
    },
  ],
  hallucination: {
    title: "Uydurma içtihat sorunu.",
    text: "Yapay zekâ modelleri, var olmayan Yargıtay kararlarını gerçekmiş gibi üretebilir. NomosOS'ta bir dilekçedeki her İÇTİHAT künyesi, kayıt üzerinden doğrulanır — modele “bu karar var mı” diye sorulmaz, kayıtta aranır. Mevzuat atıfları tanınır ancak doğrulanmaz; madde numarasını yürürlükteki metinden siz teyit edersiniz.",
    strong: "Doğrulanmamış içtihat atfı içeren bir dilekçe “hazır” durumuna geçemez.",
  },
} as const;

/* --------------------------------------------------------------------------
 * 3.7 BYO-LLM / veri egemenliği
 * ----------------------------------------------------------------------- */

export const byollm = {
  kicker: "VERİ EGEMENLİĞİ",
  title: "Verileriniz kimin sunucusunda?",
  lead: "NomosOS'u kendi yapay zekâ aboneliğinizle kullanabilirsiniz. Hangi modeli kullanacağınıza siz karar verirsiniz — ve bu kararı sonradan değiştirebilirsiniz.",
  providers: [
    "Anthropic Claude",
    "OpenAI",
    "Google Gemini",
    "OpenAI uyumlu her servis (Azure, OpenRouter, Groq, vLLM)",
    "Ollama ile yerel model",
    "Kendi özel sunucunuz",
  ],
  callout:
    "Yerel model (Ollama) veya büro içi kendi sunucunuzu seçtiğinizde, dosya içerikleri büronuzun ağından hiç çıkmaz. Kurumsal müvekkil portföyü olan bürolar için tasarlanmış bir seçenektir.",
  points: [
    {
      title: "Sınırsız kullanım",
      text: "Kendi anahtarınızı bağladığınızda yapay zekâ kullanımınızda NomosOS tarafından bir sınır uygulanmaz.",
    },
    {
      title: "Abonelikte indirim",
      text: "Kendi sağlayıcınızı kullanan bürolar için %30 indirim.",
    },
    {
      title: "Bağımlılık yok",
      text: "Sağlayıcınızı istediğiniz zaman değiştirirsiniz; verileriniz sizde kalır.",
    },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.8 UYAP
 * ----------------------------------------------------------------------- */

export const uyap = {
  kicker: "ENTEGRASYON",
  title: "UYAP'ın yerine geçmez. Üzerine bir katman kurar.",
  paragraphs: [
    "Tarayıcı eklentisi, kendi UYAP oturumunuz üzerinden dosya listesi, safahat ve duruşma bilgilerini NomosOS'a aktarır; UYAP evrakları belge kütüphanenize düşer ve otomatik aksiyon hattına girer. Eklenti NomosOS'tan indirilir (Chrome Web Mağazası gerekmez), büronuzla eşleştirme koduyla bağlanır.",
  ],
  signature: {
    before: "Hazırladığınız dilekçeyi UDF formatında dışa aktarır; UYAP ekranına aktarım hedefi eklentiyle birlikte gelecek — ancak ",
    strong: "e-imzanızı siz atarsınız, gönderimi siz onaylarsınız.",
    after: " Sistem sizin adınıza hiçbir evrak göndermez.",
  },
  note: "UYAP oturum ve e-imza bilgileriniz NomosOS'a hiçbir şekilde aktarılmaz.",
} as const;

/** UYAP köprüsü mockup'ı (gerçek veri değildir; akışın gösterimi). */
export const uyapMockup = {
  sampleBadge: "örnek veri",
  windowTitle: "NomosOS · UYAP Köprüsü",
  rows: [
    { label: "Dosya listesi", detail: "142 dosya eşleşti", state: "Senkron" },
    { label: "Safahat", detail: "38 yeni kayıt", state: "Senkron" },
    { label: "Duruşma bilgileri", detail: "9 duruşma güncellendi", state: "Senkron" },
    { label: "Evrak", detail: "5 evrak aksiyon hattına girdi", state: "Senkron" },
    { label: "Dilekçe gönderimi", detail: "e-imza sizde", state: "Onayınızda" },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.11 SSS
 * ----------------------------------------------------------------------- */

export const faq = {
  kicker: "SSS",
  title: "Sık sorulan sorular",
  items: [
    {
      q: "Verilerimiz nerede saklanıyor?",
      a: "Dosya ve belgeleriniz NomosOS altyapısında, şifreli olarak saklanır. Kurumsal planda Türkiye'de barındırma ve kendi sunucunuzda kurulum seçenekleri sunulur.",
    },
    {
      q: "Yapay zekâ müvekkil verilerimizi öğrenir mi?",
      a: "Hayır. Verileriniz model eğitiminde kullanılmaz. Yapay zekâya gönderilen metinlerde kişisel veriler tespit edilip maskelenir ve gönderim onayınıza sunulur.",
    },
    {
      q: "Yapay zekânın ne yaptığını görebilir miyiz?",
      a: "Evet. Her yapay zekâ çağrısının izi kayıt altındadır: hangi ajan, hangi görev, hangi model, ne kadar sürdü ve hangi durumla döndü. İzlerde belge veya yazışma metni saklanmaz; girdiler yalnız maskelenmiş kısa özet olarak kayda girer.",
    },
    {
      q: "Müvekkil verilerini talep üzerine alabilir miyiz?",
      a: "Evet. Bir müvekkilin tüm verisi, KVKK m.11 erişim hakkı kapsamında makine-okunur tek dosyada dışa aktarılır ve her dışa aktarma denetim izine yazılır.",
    },
    {
      q: "Kendi yapay zekâ aboneliğimizi kullanabilir miyiz?",
      a: "Evet. Anthropic, OpenAI, Gemini, OpenAI uyumlu servisler, Ollama ile yerel model veya kendi özel sunucunuz desteklenir. Bu durumda kullanım sınırı uygulanmaz ve aboneliğinizde indirim yapılır.",
    },
    {
      q: "Süreleri sistem mi hesaplıyor? Güvenilir mi?",
      a: "Süre hesabı yapay zekâ ile değil, mevzuat hükümleri, tebligat yöntemi ve resmî/adli tatil takvimi kullanılarak deterministik olarak yapılır. Hesabın her adımı gösterilir. Nihai kontrol ve sorumluluk avukata aittir.",
    },
    {
      q: "UYAP entegrasyonu nasıl çalışıyor?",
      a: "Tarayıcı eklentisi, sizin kendi UYAP oturumunuz üzerinden çalışır. UYAP şifreniz veya e-imzanız NomosOS'a aktarılmaz. Sistem sizin adınıza evrak göndermez.",
    },
    {
      q: "Yapay zekânın ürettiği dilekçeye güvenebilir miyim?",
      a: "Üretilen her metin bir taslaktır ve avukat denetiminden geçmelidir. Atıf yapılan içtihatlar kayıt üzerinden doğrulanır; doğrulanmamış atıf içeren dilekçe “hazır” durumuna geçemez.",
    },
    {
      q: "Mevcut dosyalarımızı aktarabilir miyiz?",
      a: "Evet. UYAP eklentisiyle dosya, safahat ve evrak aktarımı yapılır; ayrıca toplu veri aktarımı için destek sağlanır.",
    },
    {
      q: "Ekibimizin farklı yetkileri olabilir mi?",
      a: "Evet. Partner, avukat, stajyer ve sekreter rolleri için ayrı yetki düzeyleri tanımlıdır ve sunucu tarafında uygulanır.",
    },
    {
      q: "Müvekkilim portaldan randevu alabilir mi?",
      a: "Evet. Müvekkil portalınızdan 30 dakikalık randevu alabilir. Sistem çakışan saatleri otomatik engeller; randevuyu avukat onaylar.",
    },
    {
      q: "Vekalet ücreti hesabı yapılabilir mi?",
      a: "Evet. AAÜT asgari ücret tarifesi üzerinden maktu/nispi hesaplama yapılır; hesabın her adımı görünür. Tarife rakamlarını yılda bir (Resmî Gazete'den) siz girersiniz — sistem rakam uydurmaz.",
    },
    {
      q: "e-SMM (Serbest Meslek Makbuzu) düzenleyebilir miyim?",
      a: "e-Fatura/e-Arşiv altyapısı e-SMM gönderimini de destekler. GİB entegratörü sözleşmeniz bağlandığında e-SMM gönderimi aktif olur; bağlanana kadar sistem dürüstçe 'yapılandırılmadı' der.",
    },
    {
      q: "Müvekkillerim online ödeme yapabilir mi?",
      a: "Faturaya tek kullanımlık ödeme bağlantısı üretebilirsiniz. Müvekkil portaldan öder; tahsilat faturaya otomatik işlenir. Bu özellik büronuzun sanal POS/ödeme kuruluşu sözleşmesi gerektirir.",
    },
    {
      q: "Mevcut müşteri listemi aktarabilir miyim?",
      a: "Evet. CSV formatındaki müşteri listenizi (ad, e-posta, TCKN, telefon) tek seferde içe aktarabilirsiniz. Mükerrer TCKN kontrolü otomatik yapılır.",
    },
    {
      q: "Banka haciz cevapları otomatik okunuyor mu?",
      a: "Metin katmanı olan banka cevap PDF'lerinde banka adı, IBAN ve bakiye otomatik tespit edilir. İcra dosyasına bağlıysa malvarlığı kaydı önerilir — onay avukata aittir. Taranmış (OCR gerektiren) belgelerde bu özellik henüz çalışmaz.",
    },
    {
      q: "İnternet olmadan çalışır mı?",
      a: "NomosOS bulut tabanlıdır. Kurumsal planda büro içi kurulum seçeneği değerlendirilir.",
    },
    {
      q: "Sözleşmeyi istediğimiz zaman sonlandırabilir miyiz?",
      a: "Evet. Sonlandırma durumunda bütün dosya ve belge verileriniz standart biçimde dışa aktarılır.",
    },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.12 Kapanış / demo
 * ----------------------------------------------------------------------- */

export const closing = {
  title: "Büronuzu bir sonraki duruşmaya hazırlayalım.",
  paragraphs: [
    "Size büronuzun kendi dosya yapısı üzerinden 30 dakikalık bir tanıtım yapalım. Demo sonunda, sisteme kendi dosyalarınızdan biriyle bakabilirsiniz.",
  ],
  cta: { href: "/demo", label: "Demo Talep Edin" },
} as const;

/* --------------------------------------------------------------------------
 * 3.13 Alt bilgi
 * ----------------------------------------------------------------------- */

export const footer = {
  blurb:
    "Türk hukuk büroları için müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay zekâ katmanı.",
  columns: [
    {
      title: "Ürün",
      links: [
        { href: "/#moduller", label: "Özellikler" },
        { href: "/guvenlik", label: "Güvenlik" },
        { href: "/fiyatlandirma", label: "Fiyatlandırma" },
        { href: "/eklenti", label: "UYAP Eklentisi" },
      ],
    },
    {
      title: "Kaynaklar",
      links: [
        { href: "/blog", label: "Blog" },
        { href: "/#sss", label: "SSS" },
        { href: "/demo", label: "Demo" },
        { href: "/hakkimizda", label: "Hakkımızda" },
        { href: "/iletisim", label: "İletişim" },
        { href: "/durum", label: "Sistem Durumu" },
      ],
    },
    {
      // Dört bağlantı da gerçek metin sayfalarına gider. Faz 8B: veri işleme
      // protokolü + hizmet/SLA/mesafeli satış metinleri /sozlesmeler altında
      // (taslak uyarısıyla; avukat onayı gerekir).
      title: "Yasal",
      links: [
        { href: "/kvkk-aydinlatma", label: "KVKK Aydınlatma Metni" },
        { href: "/kullanim-kosullari", label: "Kullanım Koşulları" },
        { href: "/sozlesmeler/veri-isleme-protokolu", label: "Veri İşleme Protokolü" },
        { href: "/sozlesmeler", label: "Sözleşme Seti" },
        { href: "/cerez-politikasi", label: "Çerez Politikası" },
      ],
    },
  ],
  contactColumn: {
    title: "İletişim",
    lines: ["iletisim@nomosos.com", "demo@nomosos.com"],
  },
} as const;

/* --------------------------------------------------------------------------
 * 3.9 Güvenlik ve KVKK sayfası (/guvenlik)
 * ----------------------------------------------------------------------- */

export const security = {
  kicker: "GÜVENLİK VE KVKK",
  title: "Müvekkil verisi, en hassas veridir.",
  lead: "Bir hukuk bürosunun elindeki veri; kimlik bilgisi, sağlık verisi, mali durum ve aile hayatına ilişkin bilgiler içerir. NomosOS bu veriyi buna göre ele alır.",
  sections: [
    {
      id: "kisisel-veri-tespiti",
      title: "Otomatik kişisel veri tespiti",
      text: "Yapay zekâ sağlayıcısına gönderilecek metinde TC kimlik numarası, IBAN, telefon ve e-posta otomatik tespit edilir; maskelenir ve gönderim öncesi onayınıza sunulur. Bu sorumluluk kullanıcıya bırakılmaz.",
      strong: "gönderim öncesi onayınıza sunulur.",
    },
    {
      id: "yerel-model",
      title: "Yerel model seçeneği",
      text: "Ollama veya büro içi sunucunuzu kullandığınızda veri büronuzun ağından çıkmaz.",
      strong: "",
    },
    {
      id: "model-egitimi",
      title: "Verileriniz model eğitiminde kullanılmaz",
      text: "Müvekkil dosyalarınız hiçbir koşulda yapay zekâ modeli eğitmek için kullanılmaz. Veri sorumlusu sizsiniz, NomosOS veri işleyendir; sözleşme setine veri işleme protokolü dahildir.",
      strong: "",
    },
    {
      id: "denetim-izi",
      title: "Denetim izi",
      text: "Kim, hangi kayda, ne zaman erişti; hangi veri hangi yapay zekâ sağlayıcısına gitti — tamamı kayıt altındadır.",
      strong: "",
    },
    {
      id: "ai-cagri-izleri",
      title: "Yapay zekâ çağrı izleri",
      text: "Her yapay zekâ çağrısının izi tutulur: hangi ajan, hangi görev, hangi model, ne kadar sürdü ve hangi durumla döndü. İzlerde belge veya yazışma metni saklanmaz; girdiler yalnız kişisel verileri maskelenmiş kısa özet olarak kayda girer.",
      strong: "kişisel verileri maskelenmiş kısa özet olarak kayda girer.",
    },
    {
      id: "veri-ozne-haklari",
      title: "Veri özne hakları: dışa aktarma",
      text: "Bir müvekkilin büronuzda tuttuğunuz tüm verisi, KVKK m.11 erişim hakkı kapsamında makine-okunur tek dosyada dışa aktarılır: kimlik, dosyalar, süreler, duruşmalar, belge listesi, faturalar, ödemeler, vekâletler ve iletişim kayıtları. Her dışa aktarma denetim izine yazılır.",
      strong: "Her dışa aktarma denetim izine yazılır.",
    },
    {
      id: "erisim-yetkileri",
      title: "Erişim yetkileri",
      text: "Partner, avukat, stajyer ve sekreter rolleri için ayrı yetki düzeyleri; yetkiler sunucu tarafında uygulanır.",
      strong: "",
    },
    {
      id: "destek-erisimi",
      title: "Destek erişimi",
      text: "NomosOS ekibi verilerinize erişemez. Zorunlu bir destek talebinde erişim; gerekçeli, süreli (en fazla 24 saat), kişisel verileri maskeli ve iki tarafta da kayıtlıdır. Sizin adınıza sisteme girme (impersonation) özelliği yoktur.",
      strong: "Sizin adınıza sisteme girme (impersonation) özelliği yoktur.",
    },
  ],
  /** Alt bilgideki yasal bağlantıların indiği kısa açıklamalar. */
  legalNotes: [
    {
      id: "veri-isleme",
      text: "Veri sorumlusu büronuzdur; NomosOS veri işleyen sıfatıyla hareket eder. Sözleşme setine veri işleme protokolü dahildir ve talebiniz üzerine imzalanır.",
    },
    {
      id: "kullanim-kosullari",
      text: "Kullanım koşullarının ve KVKK aydınlatma metninin tam metni bu sitede yayımlanmıştır: /kullanim-kosullari ve /kvkk-aydinlatma. Abonelik ve hizmet seviyesi sözleşmeleri sözleşme sürecinde imzalanır.",
    },
    {
      id: "cerez",
      text: "Tanıtım sitesinde yalnızca oturumun çalışması için gereken zorunlu çerezler kullanılır; reklam veya profilleme amaçlı izleme yapılmaz. Tam metin: /cerez-politikasi.",
    },
  ],
} as const;

/* --------------------------------------------------------------------------
 * 3.10 Fiyatlandırma sayfası (/fiyatlandirma)
 * ----------------------------------------------------------------------- */

export const pricing = {
  kicker: "FİYATLANDIRMA",
  title: "Büronuzun ölçeğine göre.",
  lead: "Bütün planlar dosya, müvekkil, duruşma, süre ve görev yönetiminin tamamını içerir. Planlar yapay zekâ kullanım hacmine göre ayrışır.",
  plans: ["Solo", "Büro", "Kurumsal"],
  rows: [
    {
      label: "Kimin için",
      values: [
        "Bağımsız avukat",
        "3+ avukatlı bürolar",
        "Kurumsal hukuk departmanları ve büyük bürolar",
      ],
    },
    { label: "Kullanıcı", values: ["1", "Sınırsız (kullanıcı başına ücret)", "Sınırsız"] },
    { label: "Bütün modüller", values: ["✓", "✓", "✓"] },
    { label: "UYAP eklentisi", values: ["✓", "✓", "✓"] },
    {
      label: "Aylık AI kredisi",
      values: ["500", "Kullanıcı başına 400 (havuzlanmış)", "Sözleşmeye bağlı"],
    },
    {
      label: "Aylık belge işleme",
      values: ["200", "Kullanıcı başına 250", "Sözleşmeye bağlı"],
    },
    { label: "Kendi LLM'inizi bağlama", values: ["✓", "✓", "✓"] },
    { label: "Yerel/özel model (Private AI)", values: ["—", "✓", "✓"] },
    { label: "Müvekkil portalı", values: ["—", "✓", "✓"] },
    { label: "Öncelikli destek", values: ["—", "—", "✓"] },
    { label: "Kurulum ve eğitim", values: ["—", "—", "✓"] },
  ],
  credits: {
    title: "Yapay zekâ kredisi nedir?",
    intro:
      "Dosya analizi, dilekçe taslağı, duruşma hazırlığı gibi yapay zekâ işlemleri kredi tüketir. Her işlemin kaç kredi olduğunu, işlemi başlatmadan önce görürsünüz.",
    blocks: [
      {
        title: "Kredi tüketmeyen işlemler",
        text: "süre hesabı, belge sınıflandırma, evrakın dosyaya bağlanması, içtihat atıf teyidi ve dosya/müvekkil/duruşma yönetiminin tamamı.",
      },
      {
        title: "Krediniz biterse ne olur?",
        text: "Dosya yönetimi, süreler, duruşmalar ve belge işleme çalışmaya devam eder; yalnızca kredili yapay zekâ işlemleri durur. Ek kredi alabilir veya kendi yapay zekâ anahtarınızı bağlayarak sınırı tamamen kaldırabilirsiniz.",
      },
      {
        title: "Kendi anahtarınızı bağlarsanız",
        text: "kredi sınırı uygulanmaz ve aboneliğinizde %30 indirim yapılır.",
      },
    ],
  },
  footnote:
    "Fiyatlar için demo talebi oluşturun; büronuzun büyüklüğüne göre teklif hazırlıyoruz.",
  cta: { href: "/demo", label: "Demo Talep Edin" },
  a11y: {
    tableCaption: "NomosOS plan karşılaştırma tablosu: Solo, Büro ve Kurumsal",
    featureColumn: "Özellik",
    included: "Dahil",
    notIncluded: "Dahil değil",
  },
} as const;

/* --------------------------------------------------------------------------
 * Demo sayfası (/demo)
 * ----------------------------------------------------------------------- */

export const demo = {
  kicker: "DEMO TALEBİ",
  title: "Büronuzu bir sonraki duruşmaya hazırlayalım.",
  lead: "Size büronuzun kendi dosya yapısı üzerinden 30 dakikalık bir tanıtım yapalım. Demo sonunda, sisteme kendi dosyalarınızdan biriyle bakabilirsiniz.",
  fields: {
    fullName: { label: "Ad soyad", placeholder: "Av. Ad Soyad" },
    barAssociation: { label: "Baro / büro adı", placeholder: "Ankara Barosu — Örnek Hukuk Bürosu" },
    email: { label: "E-posta", placeholder: "ad.soyad@buronuz.av.tr" },
    phone: { label: "Telefon", placeholder: "0 (5xx) xxx xx xx" },
    lawyerCount: { label: "Avukat sayısı", options: ["1", "2-5", "6-20", "20+"] },
    message: { label: "Mesaj (opsiyonel)", placeholder: "Büronuzun çalışma biçimi hakkında kısa not" },
  },
  /**
   * KVKK ONAY METNİ — "okudum" beyanı KALDIRILDI.
   *
   * Form, ziyaretçiye "KVKK aydınlatma metnini okudum" beyanı yaptırıyor ve
   * `/guvenlik#kvkk-aydinlatma` çıpasına bağlanıyordu; o çıpanın indiği kutuda
   * ise aydınlatma metni YOKTU ("tam metinler sözleşme sürecinde paylaşılır"
   * yazıyordu). Yani yayımlanmamış bir metnin okunduğu beyan ettiriliyordu.
   *
   * İki taraflı düzeltildi: (a) `/kvkk-aydinlatma` sayfasında gerçek aydınlatma
   * metni yayımlandı ve bağlantı oraya gidiyor; (b) beyan, kullanıcının
   * gerçekten yapabileceği bir beyana indirildi — açık rıza. Aydınlatma,
   * KVKK m.10 gereği veri toplama ANINDA erişilebilir durumdadır.
   */
  consent: {
    label:
      "İletişim bilgilerimin demo talebi kapsamında işlenmesini onaylıyorum. " +
      "Verilerinizin nasıl işlendiğini aydınlatma metninde bulabilirsiniz:",
    linkLabel: "KVKK Aydınlatma Metni",
    linkHref: "/kvkk-aydinlatma",
    error: "Talebi gönderebilmek için kişisel verilerinizin işlenmesine onay vermeniz gerekir.",
  },
  submitLabel: "Demo Talep Edin",
  submittingLabel: "Gönderiliyor…",
  success: {
    title: "Talebiniz alındı.",
    text: "Ekibimiz bir iş günü içinde size dönecek. Acil bir durumda doğrudan demo@nomosos.com adresine yazabilirsiniz.",
  },
  /**
   * İLETİM YAPILANDIRILMAMIŞ / BAŞARISIZ DALI.
   * Talep gerçekten iletilmediyse "alındı" DENMEZ; kullanıcıya e-posta yolu
   * verilir ve girdiği bilgiler hazır doldurulur.
   */
  fallback: {
    title: "Talebinizi e-postayla iletin.",
    text:
      "Formu doğrudan gönderemedik; talebiniz henüz bize ulaşmadı. Aşağıdaki düğme, " +
      "girdiğiniz bilgilerle hazırlanmış bir e-posta açar — göndermeniz yeterli.",
    action: "E-posta ile gönder",
    mailTo: "demo@nomosos.com",
    mailSubject: "NomosOS demo talebi",
    mailto: "mailto:demo@nomosos.com?subject=NomosOS%20demo%20talebi",
    error: "Talep gönderilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.",
  },
  sidebar: {
    title: "Demoda ne konuşuyoruz?",
    items: [
      "Büronuzun dosya yapısı ve mevcut süre takibi düzeni",
      "UYAP eklentisi ve veri aktarım yol haritası",
      "Yapay zekâ sağlayıcısı tercihi: bulut, yerel model veya kendi sunucunuz",
      "Ekip rolleri, onay akışı ve yetki düzeyleri",
    ],
  },
} as const;

/* --------------------------------------------------------------------------
 * Faz 8A — Hakkımızda (/hakkimizda)
 * ----------------------------------------------------------------------- */

export const about = {
  kicker: "HAKKIMIZDA",
  title: "Dosya merkezdedir; yapay zekâ onun etrafında çalışır.",
  lead: "NomosOS, Türk hukuk bürolarının günlük işini tek sistemde toplamak için yapıldı: müvekkil, dosya, duruşma, süre, icra, finans. Yapay zekâ bu omurganın üstünde öneri üretir; kararı avukat verir.",
  principles: [
    { title: "AI önerir, avukat onaylar", text: "Süre, dilekçe, atıf ve müvekkil metinleri onaysız hiçbir yere gitmez. Her öneri kaynağını ve hesap izini gösterir; doğrulanamayan atıf dilekçeye giremez." },
    { title: "Veri büroda kalır", text: "Kendi yapay zekâ modelinizi bağlayabilirsiniz; dış sağlayıcıya çıkacak her çağrı maskeleme katmanından ve açık onaydan geçer, denetim günlüğüne yazılır." },
    { title: "Uydurma yok", text: "Faiz oranı, harç tarifesi, tebliğ tarihi gibi sonuç doğuran değerler ya resmî kaynaktan ya avukattan gelir; sistem tahmin yürütmez, bilmediğini söyler." },
  ],
  story: [
    "Ürün, bir hukuk bürosunun günlük işini uçtan uca izleyerek tasarlandı: UYAP'tan gelen dosya, tebligatla başlayan süre, duruşma notu, müvekkile giden mesaj, kesilen fatura. Bunların hiçbiri tek bir ekranda değildi; aralarındaki bağ avukatın hafızasında duruyordu.",
    "NomosOS bu bağı sisteme taşır. Süre kural motorundan açılır, görev zinciri şablondan doğar, belge yükleme OCR ve sınıflandırmadan geçip öneriye dönüşür, müvekkil portalda yalnız yayınladığınızı görür.",
    "Geliştirme MindAeon AI tarafından yürütülür. Ürün bir hukuk bürosu değildir ve hukuki danışmanlık vermez; ürettiği her çıktı avukat denetimine tabidir.",
  ],
  footnote: "Ticari unvan, sicil bilgileri ve tebligat adresi şirket kuruluş süreci tamamlandığında bu sayfada yayımlanacaktır; talep hâlinde iletisim@nomosos.com adresinden yazılı olarak paylaşılır.",
} as const;

/* --------------------------------------------------------------------------
 * Faz 8A — İletişim (/iletisim)
 * ----------------------------------------------------------------------- */

export const contact = {
  kicker: "İLETİŞİM",
  title: "Yazın; gerçek bir insan yanıtlar.",
  lead: "Demo ve satış için ayrı, destek ve KVKK başvuruları için ayrı kanallar. Yanıt süreleri iş günü esasına göre verilir; aciliyeti konu satırında belirtin.",
  channels: [
    { title: "Demo ve satış", text: "Büronuzun büyüklüğüne göre teklif ve canlı demo.", email: "demo@nomosos.com", sla: "İş günü içinde yanıt" },
    { title: "Destek", text: "Kurulum, UYAP eklentisi, faturalama ve kullanım soruları. Aboneler uygulama içinden destek talebi de açabilir.", email: "destek@nomosos.com", sla: "Öncelik seviyesine göre 2–72 saat içinde ilk yanıt" },
    { title: "KVKK başvuruları", text: "6698 sayılı Kanun'un 11. maddesi kapsamındaki başvurular (bilgi, düzeltme, silme, itiraz).", email: "kvkk@nomosos.com", sla: "En geç 30 gün içinde yanıt (Kanun m.13)" },
    { title: "Genel", text: "Basın, iş birliği ve diğer konular.", email: "iletisim@nomosos.com", sla: null },
  ],
} as const;

/* --------------------------------------------------------------------------
 * Faz 8A — UYAP eklentisi indirme (/eklenti)
 * ----------------------------------------------------------------------- */

export const extension = {
  kicker: "UYAP KÖPRÜSÜ",
  title: "Eklenti NomosOS'tan indirilir; UYAP'ı okur, sizin adınıza imzalamaz.",
  lead: "UYAP Avukat Portalı'nda açtığınız dosya, safahat, duruşma ve evrak listesini NomosOS'a taşır. Eşleştirme koduyla büronuza bağlanır; e-imza ve gönderim UYAP'ta, sizin elinizde kalır.",
  version: "0.1.0",
  downloadHref: "/downloads/nomosos-uyap-koprusu-v0.1.0.zip",
  downloadLabel: "Eklentiyi indir (.zip)",
  checksumHref: "/downloads/nomosos-uyap-koprusu-v0.1.0.zip.sha256",
  sizeNote: "Kendi sunucumuzdan dağıtılır",
  storeNote: "Eklenti tarayıcı mağazasında değildir; paket açık kaynak kodla derlenir ve SHA-256 özeti yanında yayımlanır. Mağaza yayını ayrıca duyurulacaktır.",
  steps: [
    "ZIP dosyasını indirip bir klasöre çıkarın.",
    "Tarayıcıda chrome://extensions (Edge: edge://extensions) adresini açın ve Geliştirici modunu etkinleştirin.",
    "\"Paketlenmemiş yükle\" ile çıkardığınız klasörü seçin.",
    "NomosOS'ta UYAP Köprüsü sayfasından eşleştirme kodu üretin; eklenti simgesine tıklayıp kodu girin.",
    "UYAP Avukat Portalı'nda dosya ya da safahat ekranını açın; sayfaya eklenen düğmeyle aktarın.",
  ],
  guarantees: [
    "Sistem sizin adınıza hiçbir evrak göndermez; e-imza ve gönderim avukattadır.",
    "UYAP şifrenizi görmez, oturumunuzu saklamaz; yalnız açık sayfayı okur.",
    "Sayfa düzeni değişirse tahmin etmez; okuma durur ve görünür uyarı verir.",
    "Aktarılan her kayıt eşleştirme kuyruğunda onayınızı bekler; kimliksiz dosya açılmaz.",
  ],
} as const;
