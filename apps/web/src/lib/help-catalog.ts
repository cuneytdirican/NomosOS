/**
 * YARDIM KATALOĞU (Modül 27) — tüm kullanıcı modüllerinin yardım içeriği.
 *
 * Tek kaynak: hem sayfa-içi bağlamsal yardım (HelpButton) hem Yardım Merkezi
 * (/app/yardim) bu katalogdan okur. Arama istemci tarafında yapılır — içerik
 * statiktir, uç gerektirmez. Bölüm kimlikleri URL çapasına dönüşür
 * (/app/yardim?konu=x#bolum-y) ve sayfa açılınca ilgili bölüme kaydırır.
 */

export interface HelpSection {
  id: string;
  heading: string;
  body: string[];
}

export interface HelpLink {
  label: string;
  href: string;
}

export interface HelpTopic {
  id: string;
  /** Bu konunun eşleştiği panel yolu (önek eşleşmesi; exact ise birebir). */
  route: string;
  exact?: boolean;
  title: string;
  summary: string;
  sections: HelpSection[];
  links: HelpLink[];
  tags: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "panel",
    route: "/app",
    exact: true,
    title: "Panel (Gösterge Tablosu)",
    summary:
      "Panel, büronun bugünkü fotoğrafını tek ekranda toplar: yaklaşan duruşmalar ve süreler, "
      + "tehlikeli dosyalar, onayınızı bekleyen öneriler ve AI kredi durumu. Güne buradan başlayın; "
      + "her kart ilgili modüle tek tıkla götürür.",
    sections: [
      {
        id: "bolum-takvim",
        heading: "Takvim kartları",
        body: [
          "Yaklaşan duruşmalar, celse boşta mı yoksa ertelendi mi bilgisiyle listelenir. Karta tıklayınca duruşma detayına gidersiniz.",
          "Süre kartı, tebliğ tarihine göre hesaplanan kesin ve ön uyarı sürelerini gösterir; gecikmiş süre kırmızı vurgulanır.",
        ],
      },
      {
        id: "bolum-risk",
        heading: "Risk ve onay",
        body: [
          "Riskli dosyalar kartı risk motorunun en yüksek puanlı dosyalarını özetler.",
          "Onay bekleyen öneriler (AI tarafından üretilen taslak notlar, kayıtlar) avukat onayına sunulur — hiçbir öneri onaysız işlenmez.",
        ],
      },
    ],
    links: [
      { label: "Dosyalar", href: "/app/dosyalar" },
      { label: "Riskli Dosyalar", href: "/app/riskli-dosyalar" },
      { label: "Öneriler", href: "/app/oneriler" },
    ],
    tags: ["panel", "gösterge", "dashboard", "özet"],
  },
  {
    id: "ajanda",
    route: "/app/ajanda",
    title: "Ajanda",
    summary:
      "Ajanda, duruşma, celse, randevu, süre son günü ve görev teslim tarihlerini tek takvimde birleştirir. "
      + "Günlük/haftalık/aylık görünüm; olay rengi türüne göre ayrılır. Avukatın 'bugün ne var?' sorusunun cevabıdır.",
    sections: [
      {
        id: "bolum-gorunum",
        heading: "Görünümler ve filtreler",
        body: [
          "Gün, hafta ve ay görünümü arasında geçiş yapabilirsiniz. Filtre ile yalnız duruşmaları, süreleri veya kişisel görevleri gösterebilirsiniz.",
        ],
      },
      {
        id: "bolum-olay",
        heading: "Olay türleri",
        body: [
          "Duruşma (mavi), süre son günü (kırmızı), randevu (yeşil), görev teslimi (sarı) renk kodludur.",
        ],
      },
    ],
    links: [
      { label: "Duruşmalar", href: "/app/durusmalar" },
      { label: "Süreler", href: "/app/sureler" },
    ],
    tags: ["ajanda", "takvim", "celse", "randevu"],
  },
  {
    id: "muvekkiller",
    route: "/app/muvekkiller",
    title: "Müvekkiler (CRM)",
    summary:
      "Müvekkil kayıtları, iletişim bilgileri, uyuşmazlık geçmişi ve dosya bağları. Yeni müvekkil açarken "
      + "çakışma kontrolü (conflict check) önerilir; müvekkil kartından tüm dosyalarına, sözleşmelerine ve "
      + "faturalarına tek ekrandan ulaşılır.",
    sections: [
      {
        id: "bolum-kayit",
        heading: "Yeni müvekkil",
        body: [
          "Gerçek/tüzel kişi ayrımı zorunludur; TCKN/vergi no doğrulaması yapılır.",
          "Müvekkil açıldığında aynı adı taşıyan kayıtlar için olası eş ad uyarısı gösterilir.",
        ],
      },
      {
        id: "bolum-cakisma",
        heading: "Çakışma kontrolü",
        body: [
          "Müvekkili temsil etmeden önce Çakışma Kontrolü sayfasında taraf adı sorgusu çalıştırın; sistem açık ve kapalı dosyalarda taraf eşleşmesi arar.",
        ],
      },
    ],
    links: [
      { label: "Çakışma Kontrolü", href: "/app/cakisma" },
      { label: "Dosyalar", href: "/app/dosyalar" },
    ],
    tags: ["müvekkil", "crm", "taraf", "müşteri"],
  },
  {
    id: "dosyalar",
    route: "/app/dosyalar",
    title: "Dosyalar (Dava Yaşam Döngüsü)",
    summary:
      "Dosya, NomosOS'un kalbidir: safahat, taraflar, duruşmalar, süreler, belgeler, risk skoru, emsaller, "
      + "giderler ve strateji tek kartta. Dosya kartındaki sekmeler modüllerin o dosyaya açılan penceresidir.",
    sections: [
      {
        id: "bolum-safahat",
        heading: "Safahat",
        body: [
          "Safahat, dosyanın mahkemedeki işlem zaman çizgisidir; her kayıt kaynak belgeyle bağlanır. AI destekli safahat çıkarma, yüklenen belgeden olayları önerir — avukat onaylar.",
        ],
      },
      {
        id: "bolum-belgeler",
        heading: "Belgeler ve AI",
        body: [
          "Belge yüklediğinizde metin çıkarımı, sınıflandırma (dilekçe, tebligat, bilirkişi raporu…) otomatik çalışır; sınıflandırma güven skoru gösterilir.",
          "Dosya belgeleri AI asistanına bağlam olarak gider (RAG); asistan yalnız bu dosyaya ait belgelerden alıntı yapar.",
        ],
      },
      {
        id: "bolum-emsal",
        heading: "Emsaller",
        body: [
          "İçtihat havuzundan dosyaya emsal bağlanır; bağ ADAY olarak başlar, avukat KABUL/RED ile karara bağlar. Yalnız KABUL edilenler strateji bağlamına girer.",
        ],
      },
    ],
    links: [
      { label: "İçtihat", href: "/app/ictihat" },
      { label: "Duruşmalar", href: "/app/durusmalar" },
      { label: "Riskli Dosyalar", href: "/app/riskli-dosyalar" },
    ],
    tags: ["dosya", "dava", "safahat", "belge", "emsal"],
  },
  {
    id: "asistan",
    route: "/app/asistan",
    title: "AI Dosya Asistanı",
    summary:
      "Asistan, seçili dosyanın belgelerine, safahatına ve sürelerine dayalı soru-cevap aracıdır. Yanıtlar "
      + "kaynak belirtir; belgede olmayan bilgi için 'dosyada açık değil' der. Kullandığınız model büro "
      + "yöneticisinin bağladığı sağlayıcıdır; PII içeren metinler KVKK kuralına göre maskelenir.",
    sections: [
      {
        id: "bolum-rag",
        heading: "Nasıl çalışır?",
        body: [
          "Sorunuz dosya belgelerinde aranır (anahtar kelime veya gömme modu); bulunan parçalar modele bağlam olarak verilir. Asistan dosya dışı bilgiyle yanıt vermez.",
          "Her yanıt kullanım kaydına işlenir; token tüketimi AI Kullanımı sayfasında görünür.",
        ],
      },
      {
        id: "bolum-sorumluluk",
        heading: "Sorumluluk",
        body: [
          "Asistan çıktısı öneridir; nihai kontrol ve sorumluluk avukatındır. İçtihat künyesi önerildiğinde teyit durumu (DOĞRULANDI/BULUNAMADI/BELİRSİZ) mutlaka kontrol edin.",
        ],
      },
    ],
    links: [
      { label: "Öneriler", href: "/app/oneriler" },
      { label: "AI Kullanımı", href: "/app/ayarlar/ai-kullanim" },
    ],
    tags: ["asistan", "ai", "rag", "sohbet", "soru"],
  },
  {
    id: "mesajlar",
    route: "/app/mesajlar",
    title: "Mesajlar",
    summary:
      "Ekip içi yazışmalar ve dosya bazlı mesajlaşma. Dosya kartından açılan mesajlar dosya bağlamında saklanır.",
    sections: [
      {
        id: "bolum-dosya",
        heading: "Dosya bağlamı",
        body: ["Mesaj bir dosyadan gönderildiyse mesaj o dosyanın kaydına düşer; dosya değişse bile iz kaybolmaz."],
      },
    ],
    links: [{ label: "İletişim Merkezi", href: "/app/iletisim" }],
    tags: ["mesaj", "sohbet", "ekip"],
  },
  {
    id: "durusmalar",
    route: "/app/durusmalar",
    title: "Duruşma Yönetimi",
    summary:
      "Celse takvimi, duruşma tutanakları ve duruşma öncesi hazırlık. Her celse için durum (boşta, ertelendi, "
      + "karar verildi) ve sonraki tarih yönetilir. Duruşma hazırlık özeti (HEARING_PREP), dosya belgelerinden "
      + "tek dokunuşla üretilir.",
    sections: [
      {
        id: "bolum-celse",
        heading: "Celse durumları",
        body: [
          "Celse boşta → ertelendi akışı sonraki duruşma tarihini otomatik süre motoruna bildirir.",
          "Tutanak yüklendiğinde safahata eklenir ve dosya zaman çizelgesi güncellenir.",
        ],
      },
      {
        id: "bolum-hazirlik",
        heading: "AI duruşma hazırlığı",
        body: [
          "Duruşma hazırlık özeti; iddia savunma özeti, delil listesi ve önerilen sorularla gelir. Kaynak olarak yalnız dosyadaki belgeler kullanılır.",
        ],
      },
    ],
    links: [
      { label: "Ajanda", href: "/app/ajanda" },
      { label: "Dosyalar", href: "/app/dosyalar" },
    ],
    tags: ["duruşma", "celse", "tutanak", "mahkeme"],
  },
  {
    id: "randevular",
    route: "/app/randevular",
    title: "Randevular",
    summary: "Müvekkil ve üçüncü kişi randevuları; onay akışıyla yönetilir, ajandaya otomatik düşer.",
    sections: [
      {
        id: "bolum-onay",
        heading: "Onay akışı",
        body: ["Randevu talebi onaylanana kadar 'bekliyor' görünür; onaydan sonra ajandada görünür ve hatırlatma üretilir."],
      },
    ],
    links: [{ label: "Ajanda", href: "/app/ajanda" }],
    tags: ["randevu", "müvekkil", "takvim"],
  },
  {
    id: "icra",
    route: "/app/icra",
    title: "İcra Modülü",
    summary:
      "İlamlı/ilamsız icra takipleri, haciz ve ödeme kayıtları. İcra dosyası hesap ekranı faiz, masraf ve "
      + "avukatlık ücreti kalemlerini deterministik hesaplar. İcra yardımcısı (copilot) önerileri avukat onayına sunar.",
    sections: [
      {
        id: "bolum-takip",
        heading: "Takip türleri",
        body: [
          "İlamlı ve ilamsız takip ayrı hesap kurallarıyla yönetilir; tebligat tarihleri süre motoruna bağlanır.",
        ],
      },
      {
        id: "bolum-hesap",
        heading: "Hesap ve ödeme",
        body: [
          "Haciz ve ödeme kayıtları bakiyeyi günceller; hesap bileşeni faiz/masraf dökümünü gösterir. Hesaplamalar deterministiktir, AI tahmini içermez.",
        ],
      },
    ],
    links: [{ label: "Hesap Araçları", href: "/app/araclar/hesap-araclari" }],
    tags: ["icra", "haciz", "takip", "faiz"],
  },
  {
    id: "riskli-dosyalar",
    route: "/app/riskli-dosyalar",
    title: "Riskli Dosyalar (Risk Motoru)",
    summary:
      "Risk motoru, dosyaları süre tehlikesi, safahat seyri, karşı taraf aktivitesi ve hesap sinyallerine göre "
      + "puanlar. Bu ekran partnerin 'bugün hangi dosyalar yanıyor' görünümüdür; risk skoru açıklaması denetlenebilir "
      + "(hangi sinyal kaç puan getirdi).",
    sections: [
      {
        id: "bolum-puan",
        heading: "Risk puanı",
        body: [
          "Puan birikimlidir: her sinyal kendi katkısını gösterir, 'kara kutu' yoktur.",
          "Yüksek riskli dosya için AI değerlendirmesi tetiklenebilir (RISK_ASSESS); öneriler dosya bağlamına kaydedilir.",
        ],
      },
    ],
    links: [
      { label: "Dosyalar", href: "/app/dosyalar" },
      { label: "Süreler", href: "/app/sureler" },
    ],
    tags: ["risk", "puan", "partner", "uyarı"],
  },
  {
    id: "cakisma",
    route: "/app/cakisma",
    title: "Çakışma Kontrolü (Conflict Check)",
    summary:
      "İş kabulünden ÖNCE çalıştırılması gereken taraf/ad sorgusu. Açık ve kapalı dosyalarda, müvekkil "
      + "kayıtlarında taraf eşleşmesi arar; sonuç 'riskli/eşleşme yok' olarak raporlanır. AI destekli eşleşme "
      + "(CONFILCT) yazım varyantlarını da yakalar.",
    sections: [
      {
        id: "bolum-sonuc",
        heading: "Sonuç yorumu",
        body: [
          "Eşleşme varsa hangi dosyada, hangi tarafla eşleştiği listelenir; karar avukatındır.",
          "Eşleşme yok raporu, iş kabul kaydına eklenmek üzere arşivlenir.",
        ],
      },
    ],
    links: [{ label: "Müvekkiller", href: "/app/muvekkiller" }],
    tags: ["çakışma", "conflict", "taraf", "kontrol"],
  },
  {
    id: "sureler",
    route: "/app/sureler",
    title: "Süre Motoru",
    summary:
      "Tebliğ tarihinden kesin süreyi hesaplayan deterministik motor: tebligat pazarı, ışlaflar arası geçiş ve "
      + "erteleme kuralları uygulanır. Süre türü, başlangıç olayı ve kural kümesi her satırda görünür — hesap "
      + "şeffaftır, AI yoktur.",
    sections: [
      {
        id: "bolum-hesap",
        heading: "Hesap şeffaflığı",
        body: [
          "Her sürenin hangi olay ve kuraldan doğduğu gösterilir; hatalı tebligat verisini düzelttiğinizde süre yeniden hesaplanır.",
          "Kesin süreye 7 gün kala otomatik hatırlatma üretilir.",
        ],
      },
    ],
    links: [
      { label: "Ajanda", href: "/app/ajanda" },
      { label: "Görevler", href: "/app/gorevler" },
    ],
    tags: ["süre", "tebligat", "hatırlatma", "dava süresi"],
  },
  {
    id: "gorevler",
    route: "/app/gorevler",
    title: "Görevler ve İş Akışı",
    summary:
      "Dosya bazlı görev atama, durum akışı (açık → devam → tamamlandı) ve teslim tarihi takibi. Görevler "
      + "ajandaya ve kişiye düşer; gecikmiş görevler yükseltilir.",
    sections: [
      {
        id: "bolum-akis",
        heading: "Durum akışı",
        body: ["Görev durumu yalnız izin verilen sırayla değişir; atanan kişi değişikliği iz kaydına düşer."],
      },
    ],
    links: [{ label: "Ajanda", href: "/app/ajanda" }],
    tags: ["görev", "atama", "iş akışı"],
  },
  {
    id: "oneriler",
    route: "/app/oneriler",
    title: "Öneriler (AI Üretim Hattı)",
    summary:
      "AI'nın ürettiği her taslak (akış notu, kayıt, özet, uyarı) buraya düşer ve avukat onayı bekler. Hiçbir "
      + "öneri onaylanmadan veritabanına işlenmez. Onay oranı ve dağılımı görünür.",
    sections: [
      {
        id: "bolum-onay",
        heading: "Onay/ret",
        body: [
          "Öneriyi açtığınızda kaynak parçalar (hangi belgeden alındı) gösterilir.",
          "Reddettiğiniz öneri geri bildirim havuzuna gider; havuz anonimleştirilmiş kalite izleme için kullanılır.",
        ],
      },
    ],
    links: [{ label: "Asistan", href: "/app/asistan" }],
    tags: ["öneri", "onay", "ai", "üretim"],
  },
  {
    id: "ictihat",
    route: "/app/ictihat",
    title: "İçtihat",
    summary:
      "Yargıtay/Danıştay/BAM/AYM kararlarında arama. AI destekli arama, sorunuzdan anahtar kavram üretir ve "
      + "gerçek havuz kayıtlarını listeler; karar özetleri 5 bölümlü şemayla üretilir. Künye teyidi LLM'e değil "
      + "deterministik eşleşmeye dayanır.",
    sections: [
      {
        id: "bolum-arama",
        heading: "Arama modları",
        body: [
          "Deterministik arama (LLM yok): künye, daire, tarih filtresi.",
          "AI destekli arama: soru cümlesinden kavram üretilir; sonuçlar yine veritabanındaki gerçek kayıtlardır.",
        ],
      },
      {
        id: "bolum-teyit",
        heading: "Atıf teyidi",
        body: [
          "Her künye önerisi DOĞRULANDI / BULUNAMADI / BELİRSİZ ile etiketlenir. BELİRSİZ atfı dilekçe teyit kapısını tek başına geçemez.",
        ],
      },
    ],
    links: [
      { label: "Dosyalar", href: "/app/dosyalar" },
      { label: "Dilekçeler", href: "/app/dilekceler" },
    ],
    tags: ["içtihat", "yargıtay", "emsal", "karar"],
  },
  {
    id: "iletisim",
    route: "/app/iletisim",
    title: "İletişim Merkezi",
    summary:
      "Müvekkille yazışmanın tek adresi: e-posta ve mesaj akışı, giden onay bekleyen mesajlar ve dosya eşleştirme. "
      + "Onay gerektiren giden mesajlar avukat onayıyla gönderilir.",
    sections: [
      {
        id: "bolum-onay",
        heading: "Giden onayı",
        body: ["Taslak mesaj, imza yetkisi onayından geçer; onay izi kayda düşer."],
      },
    ],
    links: [{ label: "Müvekkiller", href: "/app/muvekkiller" }],
    tags: ["iletişim", "e-posta", "mesaj", "onay"],
  },
  {
    id: "finans",
    route: "/app/finans",
    title: "Finans",
    summary:
      "Gelir-gider, hesap hareketleri ve masraf kayıtları. Dosya giderleri dosya kartına bağlanır. Rol bazlı "
      + "görünürlük: stajyer dışarıda, sekreter kârlılık kırılımını göremez.",
    sections: [
      {
        id: "bolum-yetki",
        heading: "Görünürlük kuralları",
        body: ["Finans görünümü role bağlıdır; görünüm süzmesi değildir, uçta uygulanır."],
      },
    ],
    links: [
      { label: "Faturalar", href: "/app/faturalar" },
      { label: "Zaman Kaydı", href: "/app/zaman" },
    ],
    tags: ["finans", "gelir", "gider", "masraf"],
  },
  {
    id: "faturalar",
    route: "/app/faturalar",
    title: "Faturalar",
    summary: "Müvekkil faturaları, ödeme durumu ve hatırlatmalar. Vadesi geçen faturalar vurgulanır.",
    sections: [
      {
        id: "bolum-durum",
        heading: "Ödeme durumu",
        body: ["Fatura durumu ödeme kaydıyla güncellenir; kısmi ödemeler desteklenir."],
      },
    ],
    links: [{ label: "Finans", href: "/app/finans" }],
    tags: ["fatura", "ödeme", "tahsilat"],
  },
  {
    id: "zaman",
    route: "/app/zaman",
    title: "Zaman Kaydı",
    summary: "Dosya bazlı çalışma süresi kaydı; kıdem/vekalet ücreti hesabının ve faturalamanın girdisidir.",
    sections: [
      {
        id: "bolum-kayit",
        heading: "Kayıt kuralları",
        body: ["Stajyer zaman kaydı yazamaz; süreler 6 dakikalık dilimlerle tutulur."],
      },
    ],
    links: [{ label: "Vekalet Ücreti Hesabı", href: "/app/araclar/vekalet-ucreti" }],
    tags: ["zaman", "saat", "çalışma", "zaman kaydı"],
  },
  {
    id: "uyap",
    route: "/app/uyap",
    title: "UYAP Eklentisi",
    summary:
      "UYAP eklentisi, dosya durumunu UYAP'tan okur ve NomosOS'a aktarır. Eklenti kurulmuş tarayıcıda çalışır; "
      + "parola NomosOS'ta saklanmaz.",
    sections: [
      {
        id: "bolum-kurulum",
        heading: "Kurulum",
        body: ["Tarayıcı eklentisi kurulduktan sonra UYAP oturumu açılır; eşitleme tek tıkla çalışır."],
      },
    ],
    links: [{ label: "Dosyalar", href: "/app/dosyalar" }],
    tags: ["uyap", "eklenti", "eşitleme", "Ulusal Yargı Ağı"],
  },
  {
    id: "raporlar",
    route: "/app/raporlar",
    title: "Raporlar",
    summary:
      "Kurumsal rapor kataloğu: dosya yükü, sonuçlanma, gelir ve gecikme raporları. Rapor kataloğu sunucudaki rol "
      + "süzgecinden geçer; A4 baskıya uygundur.",
    sections: [
      {
        id: "bolum-yetki",
        heading: "Rol bazlı içerik",
        body: ["Aynı rapor sekreterde kârlılık kırılımı olmadan görünür; süzme sunucudadır."],
      },
    ],
    links: [{ label: "Finans", href: "/app/finans" }],
    tags: ["rapor", "istatistik", "baskı"],
  },
  {
    id: "vekalet-ucreti",
    route: "/app/araclar/vekalet-ucreti",
    title: "Vekalet Ücreti Hesabı",
    summary:
      "Asgari ücret tarifesine göre vekalet ücreti hesaplayan deterministik motor. Yıl, nispi/sabit ve temyiz "
      + "kademeleri parametreli seçilir.",
    sections: [
      {
        id: "bolum-parametre",
        heading: "Parametreler",
        body: ["Hesap, seçilen yıl tarifesine göre yapılır; sonuç dökümü kalem kalem gösterilir."],
      },
    ],
    links: [{ label: "Hesap Araçları", href: "/app/araclar/hesap-araclari" }],
    tags: ["vekalet ücreti", "hesap", "tarife", "avukatlık ücreti"],
  },
  {
    id: "hesap-araclari",
    route: "/app/araclar/hesap-araclari",
    title: "Hesap Araçları",
    summary:
      "Kıdem/ihbar tazminatı, faiz ve dava harcı hesap modulleri. Tamamı deterministiktir; AI içermez.",
    sections: [
      {
        id: "bolum-moduller",
        heading: "Mevcut hesaplar",
        body: ["Kıdem-ihbar (işçi lehine ayrı ayrı), işleyen faiz (yasal/temerrüt) ve nispi dava harcı hesapları."],
      },
    ],
    links: [{ label: "HEPO", href: "/app/hepo" }],
    tags: ["hesap", "kıdem", "ihbar", "faiz", "harc"],
  },
  {
    id: "arabuluculuk",
    route: "/app/arabuluculuk",
    title: "Arabuluculuk",
    summary:
      "Dava şartı arabuluculuk süreçleri: görüşme tutanakları, anlaşma durumu ve ANLAŞMA YOK sonucunda dava süresi "
      + "üretimi. Süre üretimi süre motoru kurallarıyla yapılır.",
    sections: [
      {
        id: "bolum-sure",
        heading: "Süre üretimi",
        body: ["ANLAŞMA YOK kaydı, arabuluculuk tutanağından dava açma süresini hesaplar ve sürelere yazar."],
      },
    ],
    links: [{ label: "Süreler", href: "/app/sureler" }],
    tags: ["arabuluculuk", "anlaşma", "uzlaşma", "tutanak"],
  },
  {
    id: "mevzuat",
    route: "/app/mevzuat",
    title: "Mevzuat",
    summary:
      "Büronun kendi yüklediği mevzuat metinlerinin tam metin arama kütüphanesi. Otomatik senkron yoktur; "
      + "büro istediği metni yükler ve etiketler.",
    sections: [
      {
        id: "bolum-yukleme",
        heading: "Yükleme ve etiketleme",
        body: ["Metin yüklenirken kanun/ad, sayı ve kabul tarihi künyesi girilir; metin maddelere ayrıştırılır."],
      },
    ],
    links: [{ label: "İçtihat", href: "/app/ictihat" }],
    tags: ["mevzuat", "kanun", "yönetmelik", "kütüphane"],
  },
  {
    id: "konkordato",
    route: "/app/konkordato",
    title: "Konkordato/İflas",
    summary:
      "Konkordato ve iflas süreçlerinin şerit denetimli aşama takibi (geçici moratoryum → kesin erteleme → …). "
      + "Süre ve rapor yükümlülükleri otomatik üretilir.",
    sections: [
      {
        id: "bolum-asama",
        heading: "Aşama geçişleri",
        body: ["Aşama geçişi ancak izin verilen sıradadır; geçiş iz kaydına düşer ve rapor sürelerini günceller."],
      },
    ],
    links: [{ label: "Süreler", href: "/app/sureler" }],
    tags: ["konkordato", "iflas", "moratoryum"],
  },
  {
    id: "hepo",
    route: "/app/hepo",
    title: "HEPO (Sağlık, Güvenlik, Çevre)",
    summary:
      "Müşteri şirketlerin İSG (6331), çevre ve sağlık mevzuatı uyum hukuku: yükümlülük kütüphanesi, yasal takvim, "
      + "idari yaptırım matrisi, dava rehberi ve kontrol listeleri. Uyum hukuku hizmeti veren büroların omurgasıdır.",
    sections: [
      {
        id: "bolum-yukumluluk",
        heading: "Yükümlülük kütüphanesi",
        body: [
          "Kanun maddesine bağlı yükümlülükler; sorumlu, periyot ve yaptırım bilgisiyle birlikte listelenir.",
        ],
      },
      {
        id: "bolum-takvim",
        heading: "Yasal takvim ve otomatik hatırlatma",
        body: [
          "Periyodik yükümlülükler (eğitim, tatbikat, periyodik muayene, raporlama) hatırlatma üretir.",
          "Müvekkil Takibi sekmesinde bir yükümlülüğü vadesiyle atadığınızda sistem otomatik hatırlatma üretir: 30/7/1 gün kala ve vade geçtiğinde bildirim gelir. UYGUN olarak işaretlediğiniz kayıt artık hatırlatılmaz.",
        ],
      },
      {
        id: "bolum-yaptirim",
        heading: "Yaptırım matrisi",
        body: ["İhlal → idari para cezası aralığı ve cezayı artıran nitelikler matrisi; ceza savunması için girdi."],
      },
      {
        id: "bolum-dava",
        heading: "Dava rehberi",
        body: ["İş kazası, meslek hastalığı, İSG cezası ve çevre cezası dava türleri; ispat ve süre stratejisi."],
      },
    ],
    links: [
      { label: "Hesap Araçları", href: "/app/araclar/hesap-araclari" },
      { label: "Müvekkiller", href: "/app/muvekkiller" },
    ],
    tags: ["hepo", "isg", "iş sağlığı", "çevre", "uyum", "6331", "compliance"],
  },
  {
    id: "dilekceler",
    route: "/app/dilekceler",
    title: "Dilekçe Üretimi",
    summary:
      "Dava türü ve iddialara göre dilekçe taslağı üretir. Üretim, atıf teyit kapısına bağlıdır: teyitsiz künye "
      + "varsa avukatın açık beyanı istenir. Taslak her zaman avukat düzenlemesiyle gönderilir.",
    sections: [
      {
        id: "bolum-kapi",
        heading: "Teyit kapısı",
        body: [
          "Taslaktaki içtihat künyeleri CITATION_VERIFY süzgecinden geçer; BELİRSİZ kalanlar için avukat onayı şarttır.",
          "Taslak, gönderim öncesi avukat tarafından son kez okunur ve imzalanır.",
        ],
      },
    ],
    links: [{ label: "İçtihat", href: "/app/ictihat" }],
    tags: ["dilekçe", "taslak", "dava", "teyit"],
  },
  {
    id: "ayarlar-kullanicilar",
    route: "/app/ayarlar/kullanicilar",
    title: "Kullanıcılar",
    summary:
      "Büro personeli, roller (ADMIN, PARTNER, AVUKAT, SEKRETER, STAJYER) ve lisans kapsamı. Rol, menü "
      + "görünürlüğünü değil SUNUCU yetkisini de belirler.",
    sections: [
      {
        id: "bolum-roller",
        heading: "Roller",
        body: ["ADMIN/PARTNER yönetim yetkisi taşır; AVUKAT üretim, SEKRETER destek, STAJYER sınırlı görünürlük alır."],
      },
    ],
    links: [{ label: "AI Sağlayıcı", href: "/app/ayarlar/ai-saglayici" }],
    tags: ["kullanıcı", "rol", "personel", "yetki"],
  },
  {
    id: "ayarlar-ai-kullanim",
    route: "/app/ayarlar/ai-kullanim",
    title: "AI Kullanımı",
    summary:
      "Dönemsel AI kredi tüketimi, paketler ve otomatik yükleme. Kullanım, görev tipi ve model kırılımıyla gösterilir.",
    sections: [
      {
        id: "bolum-kredi",
        heading: "Kredi akışı",
        body: ["Görev başlatılmadan kredi rezerve edilir; iş bitince fark iade edilir, hata durumunda reserve tamamı döner."],
      },
    ],
    links: [{ label: "Asistan", href: "/app/asistan" }],
    tags: ["ai kullanımı", "kredi", "kota", "paket"],
  },
  {
    id: "ayarlar-disk-kotasi",
    route: "/app/ayarlar/disk-kotasi",
    title: "Disk Kotası",
    summary: "Plan dahili depolama ve satın alınan ek paketler; kullanım oranı gösterilir.",
    sections: [
      {
        id: "bolum-kota",
        heading: "Kota aşımı",
        body: ["Kota dolunca yeni yükleme engellenir; silme ile alan açılır."],
      },
    ],
    links: [],
    tags: ["disk", "kota", "depolama"],
  },
  {
    id: "ayarlar-ai-saglayici",
    route: "/app/ayarlar/ai-saglayici",
    title: "AI Sağlayıcı (BYO-LLM)",
    summary:
      "Büronun kendi LLM sağlayıcısını (Anthropic, OpenAI-uyumlu, Gemini, Ollama, özel) bağladığı ekrandır. "
      + "API anahtarı AES-256-GCM ile şifreli saklanır; görev tipi → model rotası buradan yönetilir. Yalnız "
      + "ADMIN/PARTNER görebilir. Bu ekran model EĞİTİMİ değildir — eğitim platform yönetiminin tekelidir.",
    sections: [
      {
        id: "bolum-ekleme",
        heading: "Sağlayıcı ekleme",
        body: [
          "Tür, adres, anahtar ve varsayılan model girilir; 'Bağlantıyı Test Et' ile model listesi sağlayıcıdan çekilir.",
          "Ollama seçilirse veri büro ağından çıkmaz (KVKK / private AI).",
        ],
      },
      {
        id: "bolum-rota",
        heading: "Görev tipi rotası",
        body: [
          "Ucuz görevler (sınıflandırma) küçük modele, ağır görevler (dilekçe, strateji) güçlü modele yönlendirilebilir.",
        ],
      },
    ],
    links: [{ label: "AI Kullanımı", href: "/app/ayarlar/ai-kullanim" }],
    tags: ["ai sağlayıcı", "llm", "anahtar", "byo", "ollama", "rotası"],
  },
];

/** Yardım Merkezi'nde arama: başlık + özet + gövde + etiket üzerinden. */
export function searchHelpTopics(query: string): HelpTopic[] {
  const q = query.trim().toLocaleLowerCase("tr");
  if (!q) return HELP_TOPICS;
  const terms = q.split(/\s+/);
  return HELP_TOPICS.map((topic) => {
    const haystackTitle = topic.title.toLocaleLowerCase("tr");
    const haystackSummary = topic.summary.toLocaleLowerCase("tr");
    const haystackBody = topic.sections
      .map((s) => s.heading + " " + s.body.join(" "))
      .join(" ")
      .toLocaleLowerCase("tr");
    const haystackTags = topic.tags.join(" ").toLocaleLowerCase("tr");
    let score = 0;
    for (const term of terms) {
      if (haystackTitle.includes(term)) score += 5;
      else if (haystackTags.includes(term)) score += 4;
      else if (haystackSummary.includes(term)) score += 2;
      else if (haystackBody.includes(term)) score += 1;
      else return null; // tüm terimler bir yerde geçmeli (AND)
    }
    return { topic, score };
  })
    .filter((r): r is { topic: HelpTopic; score: number } => r !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.topic);
}

/** Gezilen yola göre ilgili yardım konusunu bulur (en uzun eşleşen yol kazanır). */
export function findHelpTopicForPath(pathname: string): HelpTopic | null {
  let best: HelpTopic | null = null;
  for (const topic of HELP_TOPICS) {
    const match = topic.exact
      ? pathname === topic.route
      : pathname === topic.route || pathname.startsWith(topic.route + "/");
    if (match && (!best || topic.route.length > best.route.length)) best = topic;
  }
  return best;
}
