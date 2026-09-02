# NomosOS — Tanıtım Sitesi: Tasarım Dili ve İçerik

> Halka açık pazarlama sitesi (`apps/web` → `src/app/page.tsx` ve `src/components/marketing/*`).
> Bu doküman, sitenin hem **görsel dilini** hem de **birebir kullanılacak Türkçe metnini**
> tanımlar. Uygulayan ajan metinleri buradan alır, yeniden yazmaz.
> Önceki sürüm: [07-arayuz-ve-pazarlama-sitesi.md](07-arayuz-ve-pazarlama-sitesi.md) —
> bu doküman onun B bölümünü **günceller ve genişletir**.

---

## 1. Tasarım Dili: Hukuk Bürosu Estetiği

Hedef his: **bir hukuk bürosunun antetli kağıdı** — ciddi, oturaklı, güven veren.
"Startup landing page" değil, mesleki bir yayın gibi durmalı.

### 1.1 Tipografi (kimliğin taşıyıcısı)

| Kullanım | Yazı tipi | Not |
|---|---|---|
| Başlıklar (h1-h3) | **Serif** — Lora, Source Serif 4 veya Playfair Display | Otorite ve gelenek hissi; hukuk yayınlarının dili |
| Gövde metni | **Inter** (sans) | Okunabilirlik |
| Rakam/tablo | Inter + `font-variant-numeric: tabular-nums` | Fiyat ve sayı hizası |

Serif başlık + sans gövde ikilisi bu sitenin imzasıdır. Başlıklarda `letter-spacing: -0.01em`,
satır yüksekliği 1.15; gövdede 1.7 (uzun metin okunaklılığı).

### 1.2 Palet

```
--ink:        #0F1B33   /* derin lacivert — başlık, koyu bölüm zemini */
--ink-soft:   #2C3A57   /* ikincil metin */
--gold:       #B8963E   /* mat altın — yalnız vurgu: CTA, ayraç, rozet */
--gold-soft:  #E8DCC0   /* altın tonu zemin */
--paper:      #FAF8F4   /* fildişi/kağıt — ana zemin */
--paper-alt:  #F2EFE9   /* şerit bölüm zemini */
--rule:       #DCD6CA   /* ince ayraç çizgisi */
--text:       #1F2937
```

Altın **cimri** kullanılır: birincil düğme, bölüm ayraç çizgisi, aktif durum. Her yere
altın koymak ucuzlaştırır.

### 1.3 Düzen ve doku

- **Kağıt hissi**: fildişi zemin, ince (1px) ayraç çizgileri, geniş kenar boşlukları,
  bölümler arasında altın ince çizgi ayracı.
- **Ölçülü hareket**: kaydırma animasyonu yok denecek kadar az; sadece yumuşak fade-in.
  Parallax, sayaç animasyonu, otomatik kayan slider **yok**.
- Köşe yarıçapı küçük (4-6px), gölge yok denecek kadar hafif — ciddiyet düz yüzeylerle kurulur.
- Bölüm başlıklarında küçük harfli, harf aralığı açılmış, altın renkli **üst etiket**
  (örn. `MODÜLLER`) + altında serif başlık.

### 1.4 Görsel dil — yapılacaklar ve YASAKLAR

**Kullanılacak:** ürün ekran görüntüleri/mockup'ları (asıl kanıt budur), tipografik
düzen, ince çizgi ikonlar (inline SVG), belge/dosya sekmesi metaforu, terazi motifi
**sadece amblemde ve soyut biçimde**.

**Kullanılmayacak:**
- ⛔ **Tokmak (gavel)** — Türk mahkemelerinde tokmak **kullanılmaz**; Amerikan mahkeme
  klişesidir. Bir Türk avukatın gözünde ürünün alanı bilmediğini ilk anda ele verir.
- ⛔ Stok fotoğraf takım elbiseli el sıkışmalar, gülümseyen kürsü fotoğrafları
- ⛔ Yapay zekâ klişeleri: robot, beyin, nöron ağı, mavi parlayan devre görselleri
- ⛔ Abartılı pazarlama dili: "10 kat verimlilik", "devrim", "geleceği yakalayın"

### 1.5 Dil ve üslup

- Daima **siz** formu, mesleki ve ölçülü. Ünlem kullanılmaz.
- Doğru terminoloji kullanılır ve öne çıkarılır: *safahat, tensip, tebliğ, istinaf,
  ıslah, ödeme emri, haciz, vekâletname*. Bu, alan bilgisinin en güçlü kanıtıdır.
- Vaatlerde ölçülülük: "süre kaçırma riskinizi azaltır" ✓ · "asla süre kaçırmazsınız" ✗
- **Mesleki sorumluluk vurgusu bir satış argümanıdır**, gizlenecek bir kısıt değil:
  "Yapay zekâ önerir, kararı siz verirsiniz."

---

## 2. Site Haritası

Tek sayfa (uzun kaydırmalı) + ayrı sayfalar:

| Bölüm / Sayfa | Yol | İçerik |
|---|---|---|
| Üst gezinme | — | Logo · Özellikler · Güvenlik · Fiyatlandırma · SSS · Giriş Yap · **Demo Talep Edin** |
| Hero | `/#` | Ana vaat |
| Sorun | `/#sorun` | Avukatın gerçek günü |
| Modüller | `/#moduller` | 12 modül kartı |
| Süre motoru | `/#sureler` | Öne çıkan özellik (derin anlatım) |
| Belge hattı | `/#belge` | Öne çıkan özellik (derin anlatım) |
| Yapay zekâ | `/#yapay-zeka` | Asistan, dilekçe, içtihat + sorumluluk ilkesi |
| UYAP | `/#uyap` | Eklenti ve senkronizasyon |
| Güvenlik & KVKK | `/guvenlik` | Ayrı sayfa — BYO-LLM, yerel model, veri ilkeleri |
| Fiyatlandırma | `/fiyatlandirma` | Planlar + kredi sistemi |
| SSS | `/#sss` | 10 soru |
| Demo talep | `/demo` | Form |
| Alt bilgi | — | Yasal, iletişim, KVKK aydınlatma |

---

## 3. Bölüm Bölüm İçerik (birebir metin)

### 3.1 Hero

> **Üst etiket:** HUKUK BÜROSU İŞLETİM SİSTEMİ
>
> **Başlık (serif, büyük):**
> Büronuzun bütün işi. Tek sistemde.
>
> **Alt başlık:**
> Müvekkil, dosya, duruşma, süre, icra ve finans yönetimi; üzerinde çalışan bir yapay
> zekâ katmanı. Kendi yapay zekânızı bağlayın, verileriniz büronuzdan çıkmasın.
>
> **Birincil düğme:** Demo Talep Edin  **İkincil:** Özellikleri İnceleyin
>
> **Güven şeridi (küçük punto, altın ayraçla):**
> Deterministik süre hesabı · KVKK uyumlu veri mimarisi · Kendi LLM'inizi bağlayın · İçtihat atıf teyidi

Görsel: panel ekran görüntüsü (yaklaşan süreler + bugünün duruşmaları), hafif çerçeveli,
kağıt zemine oturmuş.

### 3.2 Sorun — "Bir avukatın günü"

> **Üst etiket:** NEDEN NOMOSOS
>
> **Başlık:** Dosyanız yedi ayrı yerde duruyor.
>
> **Gövde:**
> Duruşma takviminiz bir yerde, dosya evrakı UYAP'ta, müvekkil bilgileri Excel'de,
> tahsilat takibi bir başka defterde. Süreler ajandada — ya da hafızada.
>
> Bir mahkeme kararı tebliğ edildiğinde şu soruların yanıtını aramak zorunda kalıyorsunuz:
> Hangi dosyaydı? Süre ne zaman doluyor? Kim ilgilenecek? Müvekkile ne yazacağız?
>
> NomosOS bu soruların yanıtını, evrak sisteme girdiği anda kendisi çıkarır — ve
> **onayınıza sunar.**

Üç sütunlu küçük kartlar:
1. **Süre riski** — "Bir sürenin kaçması, dosyanın kaybedilmesi demektir."
2. **Dağınık bilgi** — "Müvekkil aradığında 15 dakika dosya incelemek zorunda kalıyorsunuz."
3. **Görünmeyen tahsilat** — "Hangi müvekkilden ne kadar alacağınız var, tek ekranda görünmüyor."

### 3.3 Modüller (17 kart)

> **Üst etiket:** MODÜLLER
> **Başlık:** Büronun tamamı, tek sistemde.

| Kart | Metin |
|---|---|
| **Müvekkil Yönetimi** | Gerçek ve tüzel kişi kartları, yetkililer, vekâletnameler, sözleşmeler. Bir müvekkilin bütün dosyaları, tahsilatları ve iletişim geçmişi tek ekranda. |
| **Dava Dosyası** | Taraflar, safahat, duruşmalar, deliller, kararlar, istinaf ve temyiz süreci. Dosyanın açılıştan kapanışa bütün yaşam döngüsü. |
| **Duruşma Yönetimi** | Bugünün duruşmaları sabah açtığınız ilk ekranda. Duruşma öncesi hazırlık paketi: son gelişmeler, karşı tarafın beyanları, sorulacak sorular. |
| **Süre Takibi** | Tebliğ tarihinden son güne kadar hesabı sistem yapar; her adımı gösterir. Kaçırılan sürenin bedelini bilen bir sistem. |
| **Görev ve İş Akışı** | Kim yapacak, kim kontrol edecek, kim onaylayacak. Avukat, stajyer, sekreter ve partner arasında net iş akışı. |
| **Belge Yönetimi** | Evrak sisteme girer girmez sınıflandırılır, dosyaya bağlanır, süresi tespit edilir ve size aksiyon önerisi sunulur. |
| **İcra Takibi** | Takip talebinden tahsilata bütün aşamalar, borçlu malvarlığı kaydı, faiz ve bakiye hesabı, İcra Copilot analizleri. |
| **Finans** | Tahakkuk, tahsilat, avans, masraf ve harç takibi. Müvekkil bazlı alacak durumu ve yaşlandırma tablosu. |
| **Faturalama** | Ücret sözleşmeleri, zaman kaydı, zaman kayıtlarından fatura üretimi, e-Fatura/e-Arşiv altyapısı. |
| **Dilekçe Stüdyosu** | Dosya bilgilerinden bölüm bölüm dilekçe taslağı. UDF formatında dışa aktarım. İçtihat atıfları kayıt üzerinden doğrulanmadan "hazır" olmaz; mevzuat atıfları tanınır ama doğrulanmaz. |
| **İçtihat Araştırma** | Karar arama, özetleme ve dosyaya emsal olarak bağlama. Her içtihat atfı kayıt üzerinden doğrulanır. |
| **Delil Matrisi** | İddia × delil matrisi: her bağın yönü (destekler mi, çürütür mü) ve gücü kayda geçer. Bizim sunduğumuz delili kendi iddiamıza çürütücü olarak bağlamazsınız — tutarlılık kuralı. |
| **Risk Değerlendirmesi** | Yedi boyutta deterministik risk skoru; yapay zekâ katkısı sınırlı ve her zaman görünür. Skorların kural tabanı her gece otomatik tazelenir. |
| **Randevu Yönetimi** | Büro ajandası ve müvekkil portalında self-servis randevu. Müvekkiliniz portalından 30 dakikalık randevu alır; sistem çakışan saatleri otomatik engeller. |
| **Vekalet Ücreti Hesabı** | AAÜT asgari ücret tarifesi üzerinden maktu/nispi hesaplama. Kademe, tekrar dilimi, asgari kuralı ve KDV — hesabın her adımı görünür. Tarife rakamlarını siz girersiniz, motor uydurmaz. |
| **Banka Haciz Cevabı Ajanı** | İİK m.89/2 banka cevap belgesi yüklendiğinde banka adı, IBAN, bakiye ve tarih otomatik tespit edilir. İcra dosyasına bağlıysa malvarlığı kaydı önerilir — kaydı yine siz onaylarsınız. |
| **UYAP Köprüsü** | Tarayıcı eklentisiyle dosya listesi, safahat ve evrak aktarımı. NomosOS'tan indirilir, eşleştirme koduyla büronuza bağlanır. UYAP'ın yerine geçmez; üzerine bir operasyon katmanı kurar. |

### 3.4 Öne çıkan: Süre Motoru

> **Üst etiket:** ÖNE ÇIKAN
> **Başlık:** Süreyi yapay zekâ değil, kural motoru hesaplar.
>
> Bir sürenin yanlış hesaplanması meslekî sorumluluk doğurur. Bu yüzden NomosOS'ta süre
> hesabı yapay zekâya bırakılmaz: tebliğ tarihi, tebligat yöntemi, mevzuat hükmü, adli
> tatil ve resmî tatil takvimi kullanılarak **deterministik olarak** hesaplanır.
>
> Yapay zekânın görevi yalnızca tespit etmektir: "Bu belgede süre başlatan bir olay var."
> Hesabı motor yapar, kararı siz verirsiniz.

Yanında **hesap izi kartı** (gerçek çıktı):

```
18.08.2026 tebliğ · İstinaf süresi (HMK m.345 — 2 hafta)

1  Tetik tarihi           18.08.2026 Salı — posta yoluyla tebliğ
2  Tebligat düzeltmesi    Bu yöntemde ekleme yapılmaz
3  Başlangıç              HMK m.92: tebliğ günü hesaba katılmaz
4  Süre ekleme            2 hafta → 01.09.2026 Salı
5  Adli tatil kontrolü    01.09 > 31.08 → HMK m.104: tatil izleyen iş gününe kadar uzar
6  Tatil uzatması         01.09.2026 Salı (tatil bitişi 31.08; süre zaten tatil sonrasına denk)

SON GÜN                   01.09.2026 Salı
```

Altına küçük not: *Hesabın her adımı görünür. Neye güvendiğinizi bilirsiniz.*

Ayrıca: 29 hazır süre kuralı — HMK, İİK, CMK, İYUK, TKHK ve İş Kanunu hükümleriyle;
büroya özel kural tanımlanabilir.

### 3.5 Öne çıkan: Belge → Aksiyon Hattı

> **Üst etiket:** ÖNE ÇIKAN
> **Başlık:** Evrak geldi. Sistem ne yapılacağını çıkardı.
>
> Bugün belge yüklemek bir arşivleme işidir. NomosOS'ta belge, sürecin başlangıcıdır.

Akış görseli (dikey adımlar, altın çizgiyle bağlı):

```
Evrak sisteme girer  (yükleme · UYAP eklentisi · portal)
        ↓
Metin çıkarılır ve sınıflandırılır  (ara karar · bilirkişi raporu · tebligat …
        PDF, Word (DOCX), UDF ve düz metin — metin katmanı olan belgelerde)
        ↓
İlgili dosyayla eşleştirilir
        ↓
Süre başlatan olaylar tespit edilir → kural motoru hesaplar
        ↓
Görev, süre ve safahat kaydı ÖNERİLİR
        ↓
Siz onaylarsınız — sistem uygular
```

> **Vurgu kutusu:**
> Sistem hiçbir kaydı kendiliğinden oluşturmaz. Her öneri, gerekçesi ve belgeden alınan
> kaynak cümlesiyle birlikte onay kuyruğunuza düşer. Onaylamadığınız hiçbir şey dosyanıza
> işlenmez.

### 3.6 Yapay Zekâ

> **Üst etiket:** YAPAY ZEKÂ
> **Başlık:** Yapay zekâ önerir. Kararı siz verirsiniz.
>
> NomosOS'ta yapay zekâ, dosyanızın bütün verisi üzerinde çalışan bir katmandır — ayrı
> bir sohbet penceresi değil. Analizleri TARAFSIZ yürütür: lehte bulguları abartmaz,
> aleyhte bulguları gizlemez.

Dört kart:

1. **Dosya Asistanı** — "Bu dosyada bilirkişi ne dedi?" diye sorun; yanıt, hangi belgenin
   hangi bölümüne dayandığını göstererek gelir. Kaynaksız cevap vermez.
2. **Dilekçe Stüdyosu** — Dosya bilgilerinden bölüm bölüm taslak: konu, açıklamalar,
   hukuki sebepler, deliller, sonuç ve istem. UDF olarak dışa aktarın.
3. **İcra Copilot** — Borçlunun malvarlığı ve işlem geçmişi analizi, sonraki adım
   önerileri, tahsilat ihtimali değerlendirmesi.
4. **Duruşma Hazırlığı** — Duruşmadan önce dosya özeti, son gelişmeler, karşı tarafın
   beyanları, eksik deliller ve sorulacak sorular.

> **Halüsinasyon şeridi (altın çerçeveli kutu):**
> **Uydurma içtihat sorunu.**
> Yapay zekâ modelleri, var olmayan Yargıtay kararlarını gerçekmiş gibi üretebilir.
> NomosOS'ta bir dilekçedeki her İÇTİHAT künyesi, kayıt üzerinden doğrulanır — modele "bu karar var
> mı" diye sorulmaz, kayıtta aranır. Mevzuat atıfları tanınır ancak doğrulanmaz; madde numarasını
> yürürlükteki metinden siz teyit edersiniz. **Doğrulanmamış içtihat atfı içeren bir dilekçe
> "hazır" durumuna geçemez.**

### 3.7 Kendi Yapay Zekânızı Bağlayın

> **Üst etiket:** VERİ EGEMENLİĞİ
> **Başlık:** Verileriniz kimin sunucusunda?
>
> NomosOS'u kendi yapay zekâ aboneliğinizle kullanabilirsiniz. Hangi modeli
> kullanacağınıza siz karar verirsiniz — ve bu kararı sonradan değiştirebilirsiniz.

Sağlayıcı listesi (ince çerçeveli rozetler): **Anthropic Claude · OpenAI · Google Gemini ·
OpenAI uyumlu her servis (Azure, OpenRouter, Groq, vLLM) · Ollama ile yerel model ·
Kendi özel sunucunuz**

> **Vurgu:**
> Yerel model (Ollama) veya büro içi kendi sunucunuzu seçtiğinizde, dosya içerikleri
> büronuzun ağından hiç çıkmaz. Kurumsal müvekkil portföyü olan bürolar için tasarlanmış
> bir seçenektir.

Üç küçük madde:
- **Sınırsız kullanım** — Kendi anahtarınızı bağladığınızda yapay zekâ kullanımınızda
  NomosOS tarafından bir sınır uygulanmaz.
- **Abonelikte indirim** — Kendi sağlayıcınızı kullanan bürolar için %30 indirim.
- **Bağımlılık yok** — Sağlayıcınızı istediğiniz zaman değiştirirsiniz; verileriniz sizde kalır.

### 3.8 UYAP Köprüsü

> **Üst etiket:** ENTEGRASYON
> **Başlık:** UYAP'ın yerine geçmez. Üzerine bir katman kurar.
>
> Tarayıcı eklentisi, kendi UYAP oturumunuz üzerinden dosya listesi, safahat ve
> duruşma bilgilerini NomosOS'a aktarır; UYAP evrakları belge kütüphanenize
> düşer ve otomatik aksiyon hattına girer. Eklenti NomosOS'tan indirilir
> (Chrome Web Mağazası gerekmez), büronuzla eşleştirme koduyla bağlanır.
>
> Hazırladığınız dilekçeyi UDF formatında dışa aktarır; UYAP ekranına aktarım
> hedefi eklentiyle birlikte gelecek — ancak **e-imzanızı siz atarsınız,
> gönderimi siz onaylarsınız.** Sistem sizin adınıza hiçbir evrak göndermez.

Küçük not: *UYAP oturum ve e-imza bilgileriniz NomosOS'a hiçbir şekilde aktarılmaz.*

### 3.9 Güvenlik ve KVKK (ayrı sayfa `/guvenlik`)

> **Başlık:** Müvekkil verisi, en hassas veridir.
>
> Bir hukuk bürosunun elindeki veri; kimlik bilgisi, sağlık verisi, mali durum ve aile
> hayatına ilişkin bilgiler içerir. NomosOS bu veriyi buna göre ele alır.

Bölümler:

1. **Otomatik kişisel veri tespiti** — Yapay zekâ sağlayıcısına gönderilecek metinde
   TC kimlik numarası, IBAN, telefon ve e-posta otomatik tespit edilir; maskelenir ve
   **gönderim öncesi onayınıza sunulur.** Bu sorumluluk kullanıcıya bırakılmaz.
2. **Yerel model seçeneği** — Ollama veya büro içi sunucunuzu kullandığınızda veri
   büronuzun ağından çıkmaz.
3. **Verileriniz model eğitiminde kullanılmaz** — Müvekkil dosyalarınız hiçbir koşulda
   yapay zekâ modeli eğitmek için kullanılmaz. Veri sorumlusu sizsiniz, NomosOS veri
   işleyendir; sözleşme setine veri işleme protokolü dahildir.
4. **Denetim izi** — Kim, hangi kayda, ne zaman erişti; hangi veri hangi yapay zekâ
   sağlayıcısına gitti — tamamı kayıt altındadır.
5. **Yapay zekâ çağrı izleri** — Her yapay zekâ çağrısının izi tutulur: hangi ajan, hangi
   görev, hangi model, ne kadar sürdü ve hangi durumla döndü. İzlerde belge veya yazışma
   metni saklanmaz; girdiler yalnız **kişisel verileri maskelenmiş kısa özet** olarak kayda girer.
6. **Veri özne hakları: dışa aktarma** — Bir müvekkilin büronuzda tuttuğunuz tüm verisi,
   KVKK m.11 erişim hakkı kapsamında makine-okunur tek dosyada dışa aktarılır: kimlik,
   dosyalar, süreler, duruşmalar, belge listesi, faturalar, ödemeler, vekâletler ve
   iletişim kayıtları. **Her dışa aktarma denetim izine yazılır.**
7. **Erişim yetkileri** — Partner, avukat, stajyer ve sekreter rolleri için ayrı yetki
   düzeyleri; yetkiler sunucu tarafında uygulanır.
8. **Destek erişimi** — NomosOS ekibi verilerinize erişemez. Zorunlu bir destek talebinde
   erişim; gerekçeli, süreli (en fazla 24 saat), kişisel verileri maskeli ve iki tarafta
   da kayıtlıdır. Sizin adınıza sisteme girme (impersonation) özelliği **yoktur.**

### 3.10 Fiyatlandırma (ayrı sayfa `/fiyatlandirma`)

> **Başlık:** Büronuzun ölçeğine göre.
> **Alt başlık:** Bütün planlar dosya, müvekkil, duruşma, süre ve görev yönetiminin
> tamamını içerir. Planlar yapay zekâ kullanım hacmine göre ayrışır.

| | **Solo** | **Büro** | **Kurumsal** |
|---|---|---|---|
| Kimin için | Bağımsız avukat | 3+ avukatlı bürolar | Kurumsal hukuk departmanları ve büyük bürolar |
| Kullanıcı | 1 | Sınırsız (kullanıcı başına ücret) | Sınırsız |
| Bütün modüller | ✓ | ✓ | ✓ |
| UYAP eklentisi | ✓ | ✓ | ✓ |
| Aylık AI kredisi | 500 | Kullanıcı başına 400 (havuzlanmış) | Sözleşmeye bağlı |
| Aylık belge işleme | 200 | Kullanıcı başına 250 | Sözleşmeye bağlı |
| Kendi LLM'inizi bağlama | ✓ | ✓ | ✓ |
| Yerel/özel model (Private AI) | — | ✓ | ✓ |
| Müvekkil portalı | — | ✓ | ✓ |
| Öncelikli destek | — | — | ✓ |
| Kurulum ve eğitim | — | — | ✓ |

**Kredi sistemi açıklaması** (fiyatlandırma sayfasında ayrı kutu):

> **Yapay zekâ kredisi nedir?**
> Dosya analizi, dilekçe taslağı, duruşma hazırlığı gibi yapay zekâ işlemleri kredi
> tüketir. Her işlemin kaç kredi olduğunu, işlemi başlatmadan önce görürsünüz.
>
> **Kredi tüketmeyen işlemler:** süre hesabı, belge sınıflandırma, evrakın dosyaya
> bağlanması, içtihat atıf teyidi ve dosya/müvekkil/duruşma yönetiminin tamamı.
>
> **Krediniz biterse ne olur?** Dosya yönetimi, süreler, duruşmalar ve belge işleme
> çalışmaya devam eder; yalnızca kredili yapay zekâ işlemleri durur. Ek kredi
> alabilir veya kendi yapay zekâ anahtarınızı bağlayarak sınırı tamamen kaldırabilirsiniz.
>
> **Kendi anahtarınızı bağlarsanız:** kredi sınırı uygulanmaz ve aboneliğinizde **%30
> indirim** yapılır.

Alt not: *Fiyatlar için demo talebi oluşturun; büronuzun büyüklüğüne göre teklif hazırlıyoruz.*

### 3.11 SSS

1. **Verilerimiz nerede saklanıyor?** — Dosya ve belgeleriniz NomosOS altyapısında,
   şifreli olarak saklanır. Kurumsal planda Türkiye'de barındırma ve kendi sunucunuzda
   kurulum seçenekleri sunulur.
2. **Yapay zekâ müvekkil verilerimizi öğrenir mi?** — Hayır. Verileriniz model eğitiminde
   kullanılmaz. Yapay zekâya gönderilen metinlerde kişisel veriler tespit edilip
   maskelenir ve gönderim onayınıza sunulur.
3. **Yapay zekânın ne yaptığını görebilir miyiz?** — Evet. Her yapay zekâ çağrısının izi
   kayıt altındadır: hangi ajan, hangi görev, hangi model, ne kadar sürdü ve hangi
   durumla döndü. İzlerde belge veya yazışma metni saklanmaz; girdiler yalnız maskelenmiş
   kısa özet olarak kayda girer.
4. **Müvekkil verilerini talep üzerine alabilir miyiz?** — Evet. Bir müvekkilin tüm verisi,
   KVKK m.11 erişim hakkı kapsamında makine-okunur tek dosyada dışa aktarılır ve her
   dışa aktarma denetim izine yazılır.
5. **Kendi yapay zekâ aboneliğimizi kullanabilir miyiz?** — Evet. Anthropic, OpenAI,
   Gemini, OpenAI uyumlu servisler, Ollama ile yerel model veya kendi özel sunucunuz
   desteklenir. Bu durumda kullanım sınırı uygulanmaz ve aboneliğinizde indirim yapılır.
6. **Süreleri sistem mi hesaplıyor? Güvenilir mi?** — Süre hesabı yapay zekâ ile değil,
   mevzuat hükümleri, tebligat yöntemi ve resmî/adli tatil takvimi kullanılarak
   deterministik olarak yapılır. Hesabın her adımı gösterilir. Nihai kontrol ve
   sorumluluk avukata aittir.
7. **UYAP entegrasyonu nasıl çalışıyor?** — Tarayıcı eklentisi, sizin kendi UYAP
   oturumunuz üzerinden çalışır. UYAP şifreniz veya e-imzanız NomosOS'a aktarılmaz.
   Sistem sizin adınıza evrak göndermez.
8. **Yapay zekânın ürettiği dilekçeye güvenebilir miyim?** — Üretilen her metin bir
   taslaktır ve avukat denetiminden geçmelidir. Atıf yapılan içtihatlar kayıt üzerinden
   doğrulanır; doğrulanmamış atıf içeren dilekçe "hazır" durumuna geçemez.
9. **Mevcut dosyalarımızı aktarabilir miyiz?** — Evet. UYAP eklentisiyle dosya, safahat
   ve evrak aktarımı yapılır; ayrıca toplu veri aktarımı için destek sağlanır.
10. **Ekibimizin farklı yetkileri olabilir mi?** — Evet. Partner, avukat, stajyer ve
    sekreter rolleri için ayrı yetki düzeyleri tanımlıdır ve sunucu tarafında uygulanır.
11. **Müvekkilim portaldan randevu alabilir mi?** — Evet. Müvekkil portalınızdan 30 dakikalık
    randevu alabilir. Sistem çakışan saatleri otomatik engeller; randevuyu avukat onaylar.
12. **Vekalet ücreti hesabı yapılabilir mi?** — Evet. AAÜT asgari ücret tarifesi üzerinden
    maktu/nispi hesaplama yapılır; hesabın her adımı görünür. Tarife rakamlarını yılda bir
    (Resmî Gazete'den) siz girersiniz — sistem rakam uydurmaz.
13. **e-SMM (Serbest Meslek Makbuzu) düzenleyebilir miyim?** — e-Fatura/e-Arşiv altyapısı
    e-SMM gönderimini de destekler. GİB entegratörü sözleşmeniz bağlandığında e-SMM gönderimi
    aktif olur; bağlanana kadar sistem dürüstçe "yapılandırılmadı" der.
14. **Müvekkillerim online ödeme yapabilir mi?** — Faturaya tek kullanımlık ödeme bağlantısı
    üretebilirsiniz. Müvekkil portaldan öder; tahsilat faturaya otomatik işlenir. Bu özellik
    büronuzun sanal POS/ödeme kuruluşu sözleşmesi gerektirir.
15. **Mevcut müşteri listemi aktarabilir miyim?** — Evet. CSV formatındaki müşteri listenizi
    (ad, e-posta, TCKN, telefon) tek seferde içe aktarabilirsiniz. Mükerrer TCKN kontrolü
    otomatik yapılır.
16. **Banka haciz cevapları otomatik okunuyor mu?** — Metin katmanı olan banka cevap
    PDF'lerinde banka adı, IBAN ve bakiye otomatik tespit edilir. İcra dosyasına bağlıysa
    malvarlığı kaydı önerilir — onay avukata aittir. Taranmış (OCR gerektiren) belgelerde
    bu özellik henüz çalışmaz.
17. **İnternet olmadan çalışır mı?** — NomosOS bulut tabanlıdır. Kurumsal planda büro
    içi kurulum seçeneği değerlendirilir.
18. **Sözleşmeyi istediğimiz zaman sonlandırabilir miyiz?** — Evet. Sonlandırma
    durumunda bütün dosya ve belge verileriniz standart biçimde dışa aktarılır.

### 3.12 Kapanış / Demo

> **Başlık:** Büronuzu bir sonraki duruşmaya hazırlayalım.
>
> Size büronuzun kendi dosya yapısı üzerinden 30 dakikalık bir tanıtım yapalım.
> Demo sonunda, sisteme kendi dosyalarınızdan biriyle bakabilirsiniz.
>
> **Düğme:** Demo Talep Edin

Form alanları: Ad soyad · Baro / büro adı · E-posta · Telefon · Avukat sayısı
(1 / 2-5 / 6-20 / 20+) · Mesaj (opsiyonel) · KVKK aydınlatma onayı (zorunlu).

### 3.13 Alt bilgi

Sütunlar: **Ürün** (Özellikler, Güvenlik, Fiyatlandırma, UYAP Eklentisi) · **Kaynaklar**
(SSS, Demo, Yardım) · **Yasal** (KVKK Aydınlatma Metni, Kullanım Koşulları, Veri İşleme
Protokolü, Çerez Politikası) · **İletişim**.

Alt satır: *NomosOS bir hukuk bürosu değildir ve hukuki danışmanlık vermez. Sistem
tarafından üretilen çıktılar avukat denetimine tabidir.*

**Geliştirici künyesi** (alt bilginin en altında, telif satırının yanında):

```html
Developed by <a href="https://mindaeon.com" target="_blank" rel="noopener noreferrer">MindAeon AI</a>
```

- Konum: `© 2026 NomosOS` telif satırıyla aynı hizada, sağda (mobilde alt alta).
- Biçim: küçük punto (13px), soluk metin rengi (`--ink-soft` üzerinde %70 opaklık);
  bağlantı üzerine gelindiğinde altın renge (`--gold`) döner ve altı çizilir.
- Metin **İngilizce kalır** ("Developed by MindAeon AI") — marka adı çevrilmez.
- `target="_blank"` ile birlikte `rel="noopener noreferrer"` **zorunludur** (güvenlik).
- Aynı künye, uygulama içi (`/app`) alt bilgide ve admin panelinde de yer alır.

---

## 4. Uygulama Notları

- Bütün metinler `src/components/marketing/content.ts` içinde tek yerde toplanır
  (JSX içine gömülmez) — böylece metin güncellemesi kolaydır.
- Bölümler ayrı bileşenler: `Hero`, `ProblemSection`, `ModulesGrid`, `DeadlineFeature`,
  `PipelineFeature`, `AiSection`, `ByoLlmSection`, `UyapSection`, `FaqSection`, `Footer`.
- Serif yazı tipi Google Fonts yerine **sistem serif yığını + isteğe bağlı yerel font**
  ile yüklenir (çevrimdışı derlemede sorun çıkmasın): `Georgia, 'Times New Roman', serif`
  başlangıç için yeterlidir; üretimde Lora eklenebilir.
- Ekran görüntüleri henüz yoksa, gerçekçi **CSS/SVG mockup** çizilir (sahte fotoğraf
  kullanılmaz); üzerinde "örnek veri" ibaresi bulunur.
- Erişilebilirlik: kontrast AA, başlık hiyerarşisi doğru, form etiketleri bağlı,
  klavyeyle gezinilebilir SSS (details/summary).
- Mobil: tek sütuna iner; tablolar yatay kaydırılabilir kapsayıcı içinde.
- Açık/koyu tema: pazarlama sayfası **yalnız açık temada** tasarlanmıştır (kağıt
  estetiği); zorunlu koyu tema desteği istenirse `--paper` → `#12161F`, `--ink` → `#E8E2D4`
  ters çevrimi uygulanır.

## 5. Kabul Kriterleri

1. Sayfada tokmak (gavel), robot, beyin veya stok fotoğraf görseli **bulunmaz**.
2. Başlıklar serif, gövde sans; ikisi net biçimde ayrışır.
3. 12 modül kartının tamamı mevcut ve metinleri bu dokümanla birebir aynıdır.
4. Süre motoru bölümünde gerçek hesap izi (5 adım + son gün) gösterilir.
5. Belge→aksiyon hattı 6 adımlı akış olarak görselleştirilir ve "onaysız kayıt
   oluşmaz" vurgusu yer alır.
6. Halüsinasyon/uydurma içtihat şeridi yapay zekâ bölümünde bulunur.
7. BYO-LLM bölümünde altı sağlayıcı seçeneği ve yerel model vurgusu yer alır.
8. Fiyatlandırma sayfasında üç plan + kredi sistemi açıklaması + "krediniz biterse ne
   olur" kutusu bulunur.
9. Güvenlik sayfasında altı başlığın tamamı yer alır; "impersonation yoktur" ifadesi geçer.
10. SSS'de 10 soru vardır ve tamamı bu dokümandaki yanıtlarla eşleşir.
11. Demo formu KVKK onay kutusu olmadan gönderilemez.
12. Alt bilgide "Developed by MindAeon AI" künyesi bulunur ve `https://mindaeon.com`
    adresine `rel="noopener noreferrer"` ile açılır.
13. `pnpm --filter @nomosos/web build` hatasız geçer; mobilde yatay taşma olmaz.
