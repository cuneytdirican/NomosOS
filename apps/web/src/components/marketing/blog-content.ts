/**
 * BLOG İÇERİĞİ (Faz 8A) — kod içinde tutulan, sürüm kontrollü yazılar.
 *
 * MDX araç zinciri (derleme eklentisi, içerik dizini) bilinçli olarak eklenmedi: üç yazı için
 * Next derleme hattına yeni bağımlılık ve Docker derleme riski taşımak orantısız. Gövde sınırlı bir
 * Markdown alt kümesiyle yazılır (`## başlık`, paragraf, `- madde`, `**kalın**`, `[bağlantı](url)`)
 * ve `renderMarkdown` ile deterministik biçimde JSX'e çevrilir. Yazı sayısı büyüdüğünde MDX'e
 * geçiş yalnız bu dosyayı ilgilendirir.
 *
 * İÇERİK KURALI: hukuki bilgi verirken kaynak/madde belirt; "kesin", "garanti" gibi sonuç vaadi
 * YOK; OCR/UYAP/atıf vaatleri ürünün gerçek kapsamıyla birebir (bkz. vaat-kisitlari.test.ts).
 */

export interface BlogPost {
  slug: string;
  title: string;
  /** ISO tarih. */
  date: string;
  author: string;
  excerpt: string;
  tags: string[];
  /** Sınırlı Markdown. */
  body: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: "sure-hesabinda-uc-yaygin-hata",
    title: "Süre hesabında üç yaygın hata ve tebligat tarihinin önemi",
    date: "2026-09-01",
    author: "NomosOS Ekibi",
    excerpt:
      "İstinaf süresi 'karar tarihinden' değil tebliğden başlar; elektronik tebligat beşinci günün sonunda yapılmış sayılır; adli tatil bazı süreleri durdurur. Üç hata, üç kural.",
    tags: ["süre", "tebligat", "HMK"],
    body: `## 1. Süreyi karar tarihinden başlatmak

İstinaf ve temyiz süreleri HMK'de kararın **tebliğinden** itibaren işler (HMK m.345, m.361). Duruşmada tefhim edilen kısa kararda gerekçeli kararın tebliği beklenir. Sistemde tebligat kaydı girilmeden süre açılmaz; bu bir eksiklik değil, tasarım kararıdır.

## 2. Elektronik tebligatı teslim gününden saymak

7201 sayılı Tebligat Kanunu m.7/a uyarınca elektronik tebligat, muhatabın adresine ulaştığı tarihi izleyen **beşinci günün sonunda** yapılmış sayılır. UETS ekranındaki "okundu" saati sürenin başlangıcı değildir. Süre motoru tebliğ yöntemi ETEBLİGAT seçildiğinde bu beş günü kendisi ekler ve hesap izinde gösterir.

## 3. Adli tatili her sürede uygulamak

Adli tatil (20 Temmuz – 31 Ağustos) yalnız HMK m.104 kapsamındaki süreleri etkiler; ivedi işler ve bazı özel kanun süreleri işlemeye devam eder. Kural motorunda her kuralın adli tatil davranışı ayrı tanımlıdır ve hesap izinde "adli tatil uygulandı/uygulanmadı" satırı görünür.

## Ne öneriyoruz

- Tebligat kaydını (kanal + tebliğ tarihi) dosyaya işleyin; süre kuraldan otomatik açılsın.
- Hesap izini okuyun: hangi gün, hangi kural, hangi istisna.
- Emin olmadığınız sürede kısa olan tarihi esas alın; sistemdeki süre bir **öneridir**, karar avukatındır.`,
  },
  {
    slug: "kvkk-ve-yapay-zeka-buro-verisi-nereye-gider",
    title: "KVKK ve yapay zekâ: büro verisi nereye gider?",
    date: "2026-08-20",
    author: "NomosOS Ekibi",
    excerpt:
      "Bir dilekçe taslağı için model çağrısı yaptığınızda müvekkil verisi hangi sunucuya gider, kim işler, ne kadar kalır? Veri işleyen ilişkisini ve 'kendi modelini bağla' seçeneğini açıklıyoruz.",
    tags: ["KVKK", "yapay zekâ", "veri güvenliği"],
    body: `## Veri sorumlusu bürodur

Büro NomosOS'u kullandığında 6698 sayılı Kanun anlamında **veri sorumlusu bürodur**; NomosOS veri işleyendir. Bu ilişki yazılı veri işleme protokolüyle kurulur ve protokol metnini sözleşme setinde bulursunuz.

## Model çağrısında ne olur

- Kişisel veri, sağlayıcıya gitmeden önce **maskeleme** katmanından geçer (TCKN, telefon, IBAN gibi kalıplar).
- Dış sağlayıcıya çıkacak her çağrı için büro **açık onay** verir; onay olmadan çağrı yapılmaz.
- Her çağrı, hangi sağlayıcıya ne kadar veri gittiğiyle birlikte denetim günlüğüne yazılır.

## Kendi modelinizi bağlayın

Büronuzun kendi sunucusundaki bir model (Ollama, vLLM ya da OpenAI uyumlu bir uç) bağlandığında veri büro dışına hiç çıkmaz. Bu seçenek kredi sınırını kaldırır ve abonelikte indirim sağlar; teknik kurulum belgesi uygulama içindedir.

## Ne vaat etmiyoruz

Yapay zekâ çıktıları **öneridir**; hukuki tavsiye değildir. Her taslak avukat onayından geçmeden müvekkile gitmez. Sistem, atıf yaptığı içtihatları kayıt üzerinden doğrular; doğrulanamayan atıf dilekçeye girmez.`,
  },
  {
    slug: "uyap-koprusu-nasil-calisir",
    title: "UYAP Köprüsü nasıl çalışır: okur, imzalamaz",
    date: "2026-08-05",
    author: "NomosOS Ekibi",
    excerpt:
      "Tarayıcı eklentisi UYAP Avukat Portalı'ndaki dosya, safahat ve evrakı NomosOS'a taşır. Neyi yapar, neyi bilerek yapmaz?",
    tags: ["UYAP", "eklenti", "iş akışı"],
    body: `## Ne yapar

Eklenti NomosOS'tan indirilir, eşleştirme koduyla büronuza bağlanır ve UYAP Avukat Portalı'nda açtığınız sayfayı **okur**: dosya künyesi, taraflar, safahat, duruşma, evrak listesi. Okuduğunu eşleştirme kuyruğuna koyar; dosya numarası birebir tutan kayıtlar otomatik bağlanır, tutmayanlar sizin onayınızı bekler.

## Ne yapmaz

- Sistem sizin adınıza hiçbir evrak göndermez; e-imza ve gönderim UYAP'ta, sizin elinizdedir.
- UYAP oturumunuzu saklamaz; şifrenizi görmez.
- Sayfa düzeni değiştiğinde tahmin yürütmez: okuma durur, size görünür bir uyarı düşer.

## Dilekçe akışı

NomosOS'ta hazırlanan dilekçe UDF olarak indirilir; UYAP'ın evrak gönderme ekranında dosyayı siz seçer, siz imzalarsınız. Eklenti bu adımda yalnızca hazır dilekçelerin listesini gösterir ve indirmeyi kolaylaştırır.

## Kurulum

Eklenti mağazada değildir; paketi uygulama içindeki UYAP sayfasından ya da [eklenti sayfasından](/eklenti) indirip "Paketlenmemiş yükle" ile kurarsınız. Adımlar sayfada yazılıdır.`,
  },
];

export function findPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}
