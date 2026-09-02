# NomosOS — Geliştirme Yol Haritası

> Öncelikler `docs/99-kaynak-gereksinimler.md` öncelik tablosundan türetilmiştir.
> Modül referansları: `docs/moduller/NN-*.md`. İlke: her faz kendi başına
> **satılabilir/ kullanılabilir bir ürün kesiti** ile biter; hiçbir faz "yarım özellik"
> bırakmaz.

## Faz Tablosu (özet)

| Faz | Ad | Odak | Öncül |
|-----|----|------|-------|
| 0 | Kuruluş | Doküman + iskelet + çekirdek şema + BYO-LLM | — |
| 1 | Legal Core | CRM, dava, duruşma, süre, görev | Faz 0 |
| 2 | AI + UYAP | AI asistan, dilekçe, içtihat, belge→aksiyon, extension, DMS | Faz 1 |
| 3 | İcra + Para | İcra + Copilot, finans, faturalama | Faz 1 (finans), Faz 2 (Copilot) |
| 4 | Legal Intelligence | Strateji, simülasyon, risk, delil, bilirkişi, conflict, partner dashboard | Faz 2-3 |
| 5 | Dış Yüz | Müvekkil portalı, iletişim, vekaletname, e-Fatura, sözleşme+e-imza | Faz 3-4 |
| 6 | Kurumsal + Mobil | Kurumsal raporlama, React Native mobil | Faz 1-5 API'leri |

---

## Faz 0 — Kuruluş

**Hedef**: Geliştirici ajanların üzerine inşa edeceği eksiksiz zemin.

Kapsam:
- Dokümantasyon: 25 modül spec'i (`docs/moduller/01`–`25`) + bu üst düzey dokümanlar.
- Monorepo iskeleti (`apps/web`, `apps/api`, `packages/*`), lint/CI temeli.
- Çekirdek Prisma şeması: tenant, kullanıcı/rol (PARTNER/AVUKAT/STAJYER/SEKRETER/ADMIN),
  müvekkil, dosya, taraf, belge, görev, süre, duruşma — multi-tenant izolasyon baştan.
- **BYO-LLM katmanı** (`packages/ai`): Anthropic / OpenAI-uyumlu / Ollama / Gemini /
  özel endpoint sağlayıcı soyutlaması; tenant bazlı anahtar saklama (şifreli).
- Pazarlama sitesi iskeleti (`apps/web` içinde kök sayfa, bkz. `docs/07-arayuz-ve-pazarlama-sitesi.md`).
- Docker: yerel geliştirme compose (Postgres, Redis, MinIO/S3, api, web).

**Çıkış kriterleri**: 25 modül dokümanı tamam; `docker compose up` ile boş uygulama
ayağa kalkıyor; bir tenant oluşturulup LLM sağlayıcısı bağlanabiliyor ve test çağrısı
dönüyor; şema migrate ediliyor.

> **Faz 3.5 — Modül 26 (AI Kota ve Kredi Sistemi)**: Faz 3 bittikten sonra, Faz 4'ten
> önce yapılır ve **ticari açılışın ön koşuludur**. Yönetilen AI modunda (büro kendi
> LLM anahtarını bağlamadığında) maliyet NomosOS'a aittir; bu katman olmadan sınırsız
> maliyet riski doğar. Kullanıcıya token değil kredi satılır; belge hattı ve süre
> hesabı gibi çekirdek akışlar ücretsiz kalır. Ayrıntı:
> [moduller/26-ai-kota-kredi-sistemi.md](moduller/26-ai-kota-kredi-sistemi.md).

> **Kesit — Modül 25 (Sistem Yönetim Paneli / Platform Admin)**: ayrı bir faz değildir;
> `docs/moduller/25-sistem-yonetim-paneli.md` uyarınca Faz 1'den itibaren kesit olarak
> ilerler (Faz 1: PlatformUser + temel tenant listesi; Faz 3: abonelik/ödeme; Faz 4+:
> analitik ve yatırımcı read-only raporları). Ayrı `apps/admin` uygulaması, `/api/admin/v1`.

## Faz 1 — Legal Core

**Hedef**: AI'sız bile satın alınabilir, eksiksiz büro takip çekirdeği.

Kapsanan modüller: Müvekkil CRM (`moduller/01`), Dava Yaşam Döngüsü (`02`),
Duruşma Yönetimi (`03`), Süre/Deadline Motoru (`04`, **deterministik kural motoru**),
Görev/Workflow (`07`), basit dashboard (`18`'in Faz-1 kesiti: bugünkü duruşmalar,
yaklaşan süreler, açık görevler).

Bağımlılık: Faz 0 şeması ve auth/rol altyapısı.

**Çıkış kriterleri**: Müvekkil kartı tüm bağlı varlıkları gösteriyor (müvekkil ≠ tek
dosya); dosya ekranı sekmeleriyle çalışıyor; süre motoru tebliğ tarihi + yöntem +
resmi tatil ile doğru hesap yapıyor ve bu hesaplar **birim testlerle** kanıtlı;
görev zinciri (sorumlu → kontrol → onay) uçtan uca; rol bazlı yetki testleri geçiyor.

## Faz 2 — AI Katmanı + UYAP

> **DURUM GÜNCELLEMESİ (02.09.2026):** UYAP Köprüsü tamamlandı — eklentinin 7 uçluk
> arka ucu yazıldı (`apps/api/src/uyap`: pair, pair/refresh, sync/files, sync/events,
> documents/presign, documents/commit, status + web yönetim uçları), eşleştirme kodu +
> cihaz yönetimi + eşleştirme kuyruğu arayüzde (`/app/uyap`), eklenti NomosOS
> sunucusundan ZIP olarak iner (mağaza yok). Pazarlama metinleri "geliştirme
> aşamasında" ibaresinden arındırıldı (Ö-26 vaat testi güncellendi). Kalan:
> UYAP'tan aktarılan evrakın otomatik sınıflanıp dosyaya bağlanması tam otomasyonu.

**Hedef**: "AI-Native" iddiasının karşılanması; benchmark ürünle özellik paritesi + aşma.

Kapsanan modüller: AI Dosya Asistanı (`24`), Dilekçe Üretimi (`22`),
İçtihat/Mevzuat Araştırması + Teyit Ajanı (`23`), Belge → Otomatik Aksiyon (`06`,
event-driven pipeline), UYAP Extension (`docs/05-uyap-entegrasyonu.md`,
`apps/uyap-extension`), DMS (belge deposu, sürümleme, tam metin arama).

Bağımlılık: Faz 1 veri modeli (aksiyonlar görev/süre/duruşma kayıtları üretir),
Faz 0 BYO-LLM katmanı.

**Çıkış kriterleri**: UYAP'tan aktarılan evrak otomatik sınıflanıp dosyaya bağlanıyor,
süre/görev önerileri **onay kuyruğuna** düşüyor; dilekçe UDF olarak dışa aktarılıyor;
her AI hukuki çıktısı kaynak gösteriyor ve Teyit Ajanı'ndan geçiyor; KVKK maskeleme
akışı (tespit → maskele → onayla → gönder) tüm AI çağrılarının önünde zorunlu.

## Faz 3 — İcra + Finans

**Hedef**: Büronun para ve icra operasyonunun sisteme taşınması.

Kapsanan modüller: İcra + İcra AI Copilot (`05`), Hukuk Bürosu Finansı (`08`:
tahakkuk, tahsilat, avans, masraf, harç), Faturalama (`09`: ücret sözleşmesi tipleri,
fatura kaydı; e-Fatura entegrasyonu Faz 5'te).

Bağımlılık: Finans çekirdeği Faz 1 üzerine kurulabilir; İcra Copilot Faz 2 AI
katmanını kullanır; UYAP e-takip aktarımı Faz 2 extension'ını genişletir.

**Çıkış kriterleri**: "ABC Holding'in bize toplam borcu ne?" sorgusu doğru finansal
özet döndürüyor; icra dosyası aşamalarıyla izleniyor; Copilot analizleri (süre kaçağı,
tahsilat ihtimali) dosya verisine dayanıyor; masraf/harç kayıtları müvekkil finansına
otomatik yansıyor.

## Faz 4 — Legal Intelligence

**Hedef**: Rakiplerin giremediği zekâ katmanı; partner seviyesi değer.

Kapsanan modüller: Strateji Motoru (`15`), Simülasyon Modları (`16`), Risk Engine
(`17`), Delil Matrisi (`14`: iddia → delil → belge → hukuki dayanak), Bilirkişi
Yönetimi (`13`: rapor karşılaştırma), Conflict Check (`11`), tam Partner Dashboard
(`18`: büro geneli metrikler + "bugün müdahale etmem gereken 10 şey").

Bağımlılık: Faz 2 AI altyapısı + Faz 3 finans verisi (tahsilat riski, dashboard
finans kartları).

**Çıkış kriterleri**: Her dosya çok boyutlu risk skoru taşıyor; yeni müvekkil
kaydında conflict taraması otomatik koşuyor ve engelleyici uyarı üretiyor; partner
dashboard'u gerçek zamanlı; simülasyon çıktıları dosya delil/argüman kayıtlarına
referans veriyor.

## Faz 5 — Dış Yüz

**Hedef**: Müvekkile ve resmi ekosisteme açılan yüzler.

Kapsanan modüller: Müvekkil Portalı (`10`, ayrı giriş), İletişim Merkezi (`19`:
WhatsApp/e-posta/SMS + AI durum özeti taslakları), Vekaletname Yönetimi (`12`),
e-Fatura/e-Arşiv entegrasyonu (`09` genişlemesi), Sözleşme Yaşam Döngüsü + E-imza (`20`).

Bağımlılık: Portal ve iletişim, Faz 1-4 verisini müvekkil-görünür kesitlere indirger;
e-Fatura Faz 3 faturalamayı tamamlar.

**Çıkış kriterleri**: Müvekkil portalda yalnız kendine ait ve **paylaşıma açılmış**
veriyi görüyor (izolasyon testli); AI müvekkil özeti avukat onayından geçmeden
gönderilmiyor; e-Fatura uçtan uca kesiliyor; sözleşme sürüm + imza akışı çalışıyor.

## Faz 6 — Kurumsal + Mobil

**Hedef**: 100+ avukatlı bürolar ve saha kullanımı.

Kapsam: Kurumsal raporlama (özelleştirilebilir raporlar, dışa aktarım, dönemsel
otomatik rapor), Mobil uygulama (**React Native, aynı API** — ajanda, duruşma paketi,
bildirimler, görev onayı, hızlı arama odaklı kesit).

**Çıkış kriterleri**: Mobil, mevcut API'ye hiçbir özel uç eklemeden temel akışları
karşılıyor; push bildirimleri süre/duruşma uyarılarını taşıyor; kurumsal raporlar
yetki kesitlerine saygılı.

---

## Kesitler: Her Fazda KVKK/Güvenlik ve Test Beklentisi

**KVKK / Güvenlik (her fazda geçerli taban):**
- Faz 0: multi-tenant izolasyon şemada; sırlar (LLM anahtarları) şifreli; audit log iskeleti.
- Faz 1: rol bazlı yetkilendirme testleri; kişisel veri alanlarının envanteri.
- Faz 2: **maskeleme hattı zorunlu hale gelir** — hiçbir AI çağrısı maskeleme/onay
  akışını atlayamaz; extension token kapsam denetimi; DMS erişim logları.
- Faz 3: finansal veri erişimi rol-kısıtlı; icra verisinde borçlu kişisel verisi maskeli.
- Faz 4: conflict check verisi "gizli dosya" bariyerlerine (ethical wall) saygılı.
- Faz 5: portal için ayrı auth alanı, paylaşım onay mekanizması, iletişim kanallarında
  KVKK aydınlatma şablonları.
- Faz 6: SSO/SCIM, veri bölgesi seçeneği, sızma testi ve kurumsal güvenlik dokümantasyonu.

**Test beklentisi (faz "bitti" sayılmanın ortak koşulu):**
- Faz 0: CI'da lint + tip kontrolü + migration testi.
- Faz 1: süre motoru için kapsamlı birim test seti (tatil/tebliğ senaryoları),
  yetki matrisi entegrasyon testleri.
- Faz 2: parser'lar için fixture tabanlı testler (sahte UYAP sayfaları), pipeline
  entegrasyon testleri, AI çıktıları için kaynak-zorunluluğu sözleşme testleri.
- Faz 3: finansal hesaplarda mutabakat (toplamlar tutarlı) testleri.
- Faz 4: risk/conflict kuralları için senaryo testleri.
- Faz 5: tenant + portal izolasyonu için negatif erişim testleri.
- Faz 6: mobil için temel akış E2E; rapor çıktılarının yetki kesitine uygunluk testi.
