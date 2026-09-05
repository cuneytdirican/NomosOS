/**
 * SÖZLEŞME METİNLERİ (Faz 8B) — büro ↔ NomosOS ilişkisinin sözleşme seti.
 *
 * TEK KAYNAK: tanıtım sitesi (okuma), uygulama (kabul) ve API (sürüm + özet) aynı nesneyi kullanır.
 * Sürüm değişince `version` artar; kabul kaydı (TermsAcceptance) sürüm + SHA-256 özetiyle tutulur,
 * eski kabuller yeni sürümde "güncel değil" sayılır.
 *
 * DÜRÜSTLÜK: bu metinler TASLAKTIR — ürün ekibince yazılmış, AVUKAT ONAYI ALINMAMIŞ şablonlardır.
 * `draftNotice` her sayfada görünür; büroya "onaylı sözleşme" gibi sunulmaz. Ticari unvan, sicil
 * ve adres şirket kuruluşu tamamlanınca doldurulur (yer tutucu yok, "ilan edilecektir" yazılır).
 */

export type ContractDocKey = "HIZMET_SOZLESMESI" | "DPA" | "SLA" | "MESAFELI_SATIS";

export interface ContractSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface ContractDoc {
  key: ContractDocKey;
  slug: string;
  version: string;
  title: string;
  kicker: string;
  lead: string;
  /** Portal/uygulamayı kullanmak için ONAY rolünce kabulü ZORUNLU mu? */
  required: boolean;
  updatedAt: string;
  draftNotice: string;
  sections: ContractSection[];
}

const DRAFT = "Bu metin ürün ekibince hazırlanmış bir TASLAKTIR; avukat incelemesinden geçmemiştir. Yürürlüğe girmeden önce hukuk danışmanı onayı alınır ve sürüm numarası yükseltilir. Ticari unvan, sicil ve tebligat adresi şirket kuruluşu tamamlandığında ilan edilecektir.";

const PARTIES = [
  "Sağlayıcı: NomosOS (MindAeon AI bünyesinde yürütülen ürün çalışması) — iletişim: iletisim@nomosos.com.",
  "Müşteri: NomosOS hesabı açan hukuk bürosu / avukat; hesabı açan ve bu metni kabul eden kullanıcı, büroyu temsile yetkili olduğunu beyan eder.",
];

export const CONTRACT_DOCS: ContractDoc[] = [
  {
    key: "HIZMET_SOZLESMESI",
    slug: "hizmet-sozlesmesi",
    version: "v1",
    title: "Hizmet ve Lisans Sözleşmesi (EULA)",
    kicker: "HİZMET SÖZLEŞMESİ",
    lead: "NomosOS bulut hizmetinin kullanım koşulları: lisans kapsamı, tarafların yükümlülükleri, ücret, süre ve fesih.",
    required: true,
    updatedAt: "2026-09-06",
    draftNotice: DRAFT,
    sections: [
      { id: "taraflar", title: "Taraflar ve konu", paragraphs: ["Bu sözleşme, NomosOS yazılım hizmetinin (SaaS) Müşteri'ye sunulmasını düzenler. Hizmet; müvekkil, dosya, duruşma, süre, icra ve finans yönetimi modülleri ile bunların üzerinde çalışan yapay zekâ destekli öneri katmanını kapsar.", ...PARTIES] },
      { id: "lisans", title: "Lisans ve kullanım kapsamı", paragraphs: ["Sağlayıcı, Müşteri'ye sözleşme süresince, seçilen plandaki kullanıcı sayısıyla sınırlı, devredilemez ve münhasır olmayan bir kullanım hakkı verir.", "Yazılımın tersine mühendisliği, çoğaltılması, üçüncü kişilere kiralanması ya da hizmet olarak yeniden sunulması yasaktır. Müşteri'nin kendi verisi üzerindeki hakları saklıdır."] },
      { id: "yapay-zeka", title: "Yapay zekâ çıktıları", paragraphs: ["Sistemin ürettiği süre hesabı, dilekçe taslağı, özet ve her türlü öneri, avukat denetimine tabi TASLAKTIR; hukuki tavsiye değildir. Sonuç doğuran her karar Müşteri'nin sorumluluğundadır.", "Sağlayıcı, çıktıların doğruluğunu garanti etmez; içtihat atıfları kayıt üzerinden doğrulanır ve doğrulanamayan atıf dilekçeye alınmaz. Müşteri dış yapay zekâ sağlayıcısı kullanmayı seçtiğinde o sağlayıcının koşulları ayrıca geçerlidir."] },
      { id: "ucret", title: "Ücret ve ödeme", paragraphs: ["Ücret, seçilen plana ve kullanıcı sayısına göre aylık ya da yıllık peşin olarak tahakkuk eder; fiyat listesi uygulamada ve tanıtım sitesinde ilan edilir. Yapay zekâ kredileri ayrıca satın alınabilir; kendi model anahtarını bağlayan Müşteri'ye ilan edilen indirim uygulanır.", "Ödemenin gecikmesi hâlinde Sağlayıcı, bildirim sonrasında hizmeti askıya alabilir; veri erişimi askı süresince salt okunur biçimde korunur."] },
      { id: "veri", title: "Veri sahipliği ve gizlilik", paragraphs: ["Müşteri verisinin sahibi Müşteri'dir. Sağlayıcı veriyi yalnız hizmeti sunmak için işler; kişisel verilere ilişkin roller ve güvenceler Veri İşleme Protokolü'nde düzenlenir.", "Sözleşme sona erdiğinde Müşteri verisini dışa aktarabilir; Sağlayıcı yasal saklama süreleri saklı kalmak üzere veriyi siler."] },
      { id: "sure-fesih", title: "Süre ve fesih", paragraphs: ["Sözleşme, seçilen faturalama dönemi sonunda aynı süreyle yenilenir. Taraflar dönem sonu için yazılı bildirimle fesih edebilir; Müşteri'nin esaslı ihlali hâlinde Sağlayıcı hizmeti bildirimle durdurabilir.", "Feshi izleyen 30 gün içinde Müşteri verisini dışa aktarabilir."] },
      { id: "sorumluluk", title: "Sorumluluğun sınırı", paragraphs: ["Sağlayıcı'nın sözleşmeden doğan toplam sorumluluğu, olaydan önceki 12 ayda ödenen ücretle sınırlıdır; dolaylı zararlar ve kâr kaybı kapsam dışıdır. Kast ve ağır ihmal hâlleri saklıdır."] },
      { id: "uyusmazlik", title: "Uygulanacak hukuk ve uyuşmazlık", paragraphs: ["Bu sözleşmeye Türk hukuku uygulanır; uyuşmazlıklarda Sağlayıcı'nın ilan edilecek merkezinin bulunduğu yer mahkemeleri ve icra daireleri yetkilidir."] },
    ],
  },
  {
    key: "DPA",
    slug: "veri-isleme-protokolu",
    version: "v1",
    title: "Veri İşleme Protokolü (DPA)",
    kicker: "KVKK · VERİ İŞLEME",
    lead: "6698 sayılı Kanun kapsamında veri sorumlusu (büro) ile veri işleyen (NomosOS) arasındaki yükümlülükler, alt işleyenler, güvenlik tedbirleri ve ihlal bildirimi.",
    required: true,
    updatedAt: "2026-09-06",
    draftNotice: DRAFT,
    sections: [
      { id: "roller", title: "Roller", paragraphs: ["Müşteri, müvekkil ve üçüncü kişilere ait kişisel verilerin VERİ SORUMLUSUDUR. Sağlayıcı, bu verileri yalnız Müşteri'nin belgelenmiş talimatı (hizmetin kullanımı) doğrultusunda işleyen VERİ İŞLEYENDİR.", ...PARTIES] },
      { id: "kapsam", title: "İşlenen veri ve amaç", paragraphs: ["Kimlik, iletişim, hukuki işlem, finans ve — Müşteri seçtiği ölçüde — özel nitelikli veriler; yalnız dosya yönetimi, süre takibi, belge işleme, iletişim ve faturalama amaçlarıyla işlenir."], bullets: ["Yapay zekâ çağrılarında veri, maskeleme katmanından ve Müşteri'nin açık onayından geçmeden dış sağlayıcıya çıkmaz.", "Müşteri kendi modelini bağladığında veri Sağlayıcı dışına çıkmaz.", "Her dış çağrı denetim günlüğüne yazılır."] },
      { id: "alt-isleyen", title: "Alt işleyenler", paragraphs: ["Sağlayıcı; barındırma, e-posta, ödeme ve (Müşteri'nin seçimiyle) yapay zekâ sağlayıcılarını alt işleyen olarak kullanabilir. Güncel liste uygulamada ilan edilir; değişiklik en az 15 gün önce bildirilir ve Müşteri itiraz hakkına sahiptir."] },
      { id: "guvenlik", title: "Teknik ve idari tedbirler", paragraphs: ["Aktarımda ve depoda şifreleme, kiracı izolasyonu, rol tabanlı erişim, iki aşamalı doğrulama, denetim izi, günlük yedek ve geri yükleme tatbikatı, anahtar rotasyonu ve sızma testi uygulanır. Ayrıntılı tedbir listesi Güvenlik sayfasında ilan edilir."] },
      { id: "ihlal", title: "Veri ihlali bildirimi", paragraphs: ["Sağlayıcı, ihlali öğrendiği andan itibaren en geç 48 saat içinde Müşteri'ye bildirir; Müşteri'nin Kurul'a bildirim yükümlülüğü (72 saat) için gerekli bilgiyi sağlar."] },
      { id: "haklar", title: "İlgili kişi hakları ve yardım", paragraphs: ["Sağlayıcı, Müşteri'nin ilgili kişi başvurularını (bilgi, düzeltme, silme, taşıma) yanıtlamasına uygulama içi araçlarla yardım eder; başvuruları doğrudan Müşteri'ye yönlendirir."] },
      { id: "silme", title: "Sözleşme sonu", paragraphs: ["Sözleşme sona erdiğinde veri, Müşteri'nin talebine göre iade (dışa aktarma) edilir ve yasal saklama süreleri dışında silinir; silme yazılı olarak teyit edilir."] },
    ],
  },
  {
    key: "SLA",
    slug: "hizmet-seviyesi",
    version: "v1",
    title: "Hizmet Seviyesi Taahhüdü (SLA)",
    kicker: "SLA",
    lead: "Erişilebilirlik hedefi, bakım pencereleri, destek yanıt süreleri ve hizmet kredisi.",
    required: false,
    updatedAt: "2026-09-06",
    draftNotice: DRAFT,
    sections: [
      { id: "erisilebilirlik", title: "Erişilebilirlik", paragraphs: ["Aylık %99,5 erişilebilirlik hedeflenir (planlı bakım hariç). Ölçüm, Sağlayıcı'nın durum sayfasında yayımlanan bileşen sağlığına dayanır."] },
      { id: "bakim", title: "Planlı bakım", paragraphs: ["Bakım, Türkiye saatiyle 02:00–06:00 aralığında ve en az 48 saat önceden duyuru şeridinde bildirilerek yapılır."] },
      { id: "destek", title: "Destek yanıt süreleri", paragraphs: ["İlk yanıt süreleri öncelik seviyesine göre: KRİTİK (hizmet erişilemez) 2 saat, YÜKSEK 8 saat, NORMAL 24 saat, DÜŞÜK 72 saat — iş günü esasıyla; KRİTİK öncelik hafta sonu dahil izlenir."], bullets: ["Destek talepleri uygulama içinden açılır; her talepte SLA sayacı görünür.", "Kurumsal planda öncelikli destek ve adlandırılmış iletişim kişisi sağlanır."] },
      { id: "kredi", title: "Hizmet kredisi", paragraphs: ["Aylık erişilebilirlik %99,5'in altına düşerse Müşteri, izleyen ay faturasında %5; %99'un altına düşerse %10 hizmet kredisi talep edebilir. Kredi, talep hâlinde ve tek çözüm yolu olarak uygulanır."] },
      { id: "istisna", title: "İstisnalar", paragraphs: ["Müşteri'nin ağ/istemci kaynaklı sorunları, üçüncü taraf sağlayıcı kesintileri (UYAP, ödeme, yapay zekâ sağlayıcısı) ve mücbir sebepler hesaplamaya dahil edilmez."] },
    ],
  },
  {
    key: "MESAFELI_SATIS",
    slug: "mesafeli-satis",
    version: "v1",
    title: "Mesafeli Satış Sözleşmesi",
    kicker: "MESAFELİ SATIŞ",
    lead: "Çevrimiçi abonelik ve kredi paketi satın alımlarına ilişkin ön bilgilendirme, cayma ve iade koşulları.",
    required: true,
    updatedAt: "2026-09-06",
    draftNotice: DRAFT,
    sections: [
      { id: "on-bilgi", title: "Ön bilgilendirme", paragraphs: ["Satın alınan hizmetin niteliği, fiyatı (KDV dahil/hariç), faturalama dönemi ve ödeme yöntemi ödeme sayfasında satın alma öncesi gösterilir; ödeme onayıyla bu sözleşme kurulur.", ...PARTIES] },
      { id: "ifa", title: "İfa", paragraphs: ["Hizmet, ödemenin kesinleşmesiyle anında sunulur; kredi paketleri ödeme kesinleşince cüzdana yüklenir."] },
      { id: "cayma", title: "Cayma hakkı", paragraphs: ["Müşteri tacir/meslek erbabı sıfatıyla, mesleki faaliyeti kapsamında satın alım yaptığından tüketici mevzuatındaki cayma hakkı uygulanmaz. Bununla birlikte, dönem başlangıcından itibaren 14 gün içinde hizmet hiç kullanılmamışsa ücret iade edilir."] },
      { id: "iade", title: "İade ve iptal", paragraphs: ["Yıllık abonelikte dönem içi iptalde kullanılmayan tam aylar için iade yapılır; kredi paketleri kullanılan kısım düşülerek iade edilir. İadeler ödeme yöntemine yapılır."] },
      { id: "fatura", title: "Fatura", paragraphs: ["Her ödeme için e-Arşiv/e-Fatura düzenlenir ve uygulama içinde sunulur."] },
    ],
  },
];

export function findContractDoc(keyOrSlug: string): ContractDoc | undefined {
  return CONTRACT_DOCS.find((d) => d.key === keyOrSlug || d.slug === keyOrSlug);
}

/** Sürüm özeti için deterministik metin — API SHA-256 ile özetler. */
export function contractDocCanonicalText(doc: ContractDoc): string {
  return JSON.stringify({ key: doc.key, version: doc.version, title: doc.title, sections: doc.sections.map((s) => ({ id: s.id, title: s.title, paragraphs: s.paragraphs, bullets: s.bullets ?? [] })) });
}
