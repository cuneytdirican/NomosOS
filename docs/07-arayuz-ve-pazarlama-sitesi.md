# NomosOS — Arayüz Tasarım Sistemi ve Pazarlama Sitesi

> İki bölüm: (A) uygulama UI tasarım sistemi (`apps/web`), (B) halka açık tanıtım
> sitesi (`apps/site`). Geliştirici ajan bu dokümanı doğrudan uygulayabilmelidir.

---

## Bölüm A — Uygulama UI Tasarım Sistemi

### A.1 Estetik: Profesyonel Hukuk Kimliği

Güven veren, ciddi, modern. "Oyuncak SaaS" değil; "büronun işletim sistemi" hissi.

- **Renk önerisi**: koyu lacivert temel + altın vurgu.
  - `--primary: #1B2A4A` (koyu lacivert), tonları `#0F1B33` → `#3B4C6E`
  - `--accent: #B8963E` (mat altın; yalnız vurgu — CTA, aktif menü, rozet çizgisi)
  - Nötrler: `#F7F8FA` zemin (açık tema), `#0D1421` zemin (koyu tema), `#1F2937` metin
  - Durum renkleri: başarı `#1E7F4F`, uyarı `#B45309`, kritik `#B91C1C`, bilgi `#1D4ED8`
  - Risk/süre göstergeleri kaynak dokümandaki 🟢/🟡/🔴 anlamıyla birebir eşleşir.
- **Açık/koyu tema** birinci sınıf: tüm renkler token üzerinden (`:root` + `.dark`),
  hiçbir bileşende sabit hex kullanılmaz.
- **Tipografi**: Inter (UI) + tabular rakamlar (finans/tablolarda `font-variant-numeric:
  tabular-nums`); başlıklarda hafif letter-spacing daralması. Uzun hukuki metin
  (dilekçe önizleme) için serif okuma modu opsiyonu (örn. Source Serif).
- Köşe yarıçapı ölçülü (6-8px), gölgeler hafif; ciddiyet düz yüzeylerle kurulur.

### A.2 Teknoloji: Tailwind + shadcn/ui

- Tailwind CSS + **shadcn/ui** bileşen seti; tema token'ları CSS değişkenleriyle.
- Standart bileşenler: `DataTable` (TanStack Table sarmalayıcı), `Sheet` (kayıt hızlı
  önizleme), `Command` (global arama), `Dialog`, `Tabs` (dosya sekmeleri), `Badge`
  (durum/risk), `Toast`/`Sonner` (bildirim), `Calendar` (duruşma/süre).
- Proje-özel bileşenler `packages/ui` altında: `RiskBadge`, `DeadlineChip`
  ("⚠️ 3 gün"), `CaseHeader`, `ClientCard`, `AiSuggestionCard` (öner-onayla deseni:
  her AI önerisinde **Onayla / Düzenle / Reddet** üçlüsü + kaynak satırı).

### A.3 Bilgi-Yoğun Ekran Desenleri

Hukuk bürosu ekranları veri yoğundur; desenler:

- **Tablo birincil desendir**: sıralama, çoklu filtre, sütun seçimi, kaydedilebilir
  görünümler ("Benim duruşmalarım", "Bu hafta süresi dolanlar"), satır yoğunluğu
  seçeneği (rahat/sıkı), sayfalama yerine sanal kaydırma (büyük listelerde).
- **Satır tıklama → sağdan `Sheet`** ile hızlı önizleme; çift tıklama/enter → tam sayfa.
- **Liste + detay** (master-detail) deseni: Süreler ve Görevler ekranlarında sol liste,
  sağ detay.
- Her tabloda boş durum (empty state) yönlendirme içerir ("Henüz dosya yok —
  UYAP'tan aktarın veya yeni dosya açın").
- Kritik bilgiler renge değil **renk + ikon + metin** üçlüsüne dayanır (erişilebilirlik).

### A.4 Navigasyon ve Yerleşim

- **Sol menü** (daraltılabilir, ikon+etiket):
  Panel · Müvekkiller · Dosyalar · Duruşmalar · Süreler · Görevler · İcra · Finans ·
  Raporlar · Ayarlar
- **Rol bazlı görünürlük**: SEKRETER → Finans'ı görmez (ayarlanabilir); STAJYER →
  Raporlar kısıtlı; Finans ve Raporlar tam görünümü PARTNER/ADMIN; menü öğeleri
  yetkiye göre sunucu tarafından süzülür (yalnız CSS ile gizleme yasak).
- Üst çubuk: tenant/büro adı, global arama, bildirim zili, kullanıcı menüsü.
- **Global arama (Cmd+K / Ctrl+K)**: müvekkil, dosya no (örn. `2026/145`), taraf adı,
  belge, görev tek kutudan; sonuçlar tür gruplu; komutlar da buradan
  ("yeni görev", "duruşma ekle", "dosyaya git").
- **Bildirim merkezi**: süre uyarıları (kritiklik sıralı), gelen UYAP evrağı, onay
  bekleyen AI aksiyonları, görev atamaları; her bildirim ilgili kayda derin bağlantı;
  "tümünü okundu işaretle" + tür bazlı sessize alma.

### A.5 Türkçe Arayüz Dili Kuralları

- Arayüz dili **Türkçe**; hukuk terminolojisi resmi kullanım ile uyumlu
  (duruşma, safahat, tebliğ, istinaf, tahakkuk — İngilizce karşılık uydurulmaz).
- Buton dili emir kipinde ve kısa: "Kaydet", "Onayla", "UYAP'a Aktar".
- Tarihler `18 Ağustos 2026, Salı` uzun / `18.08.2026` kısa; saatler 24 saat;
  para `1.240.000 TL` (binlik ayraç nokta). `Intl` + `tr-TR` locale zorunlu.
- Büyük harf kuralları Türkçe'ye uygun (İ/ı dönüşümleri `toLocaleUpperCase('tr')`).
- AI çıktıları etiketlenir: "AI önerisi — kontrol ediniz."

### A.6 Erişilebilirlik

- WCAG 2.1 AA hedefi: kontrast ≥ 4.5:1 (altın vurgu koyu zeminde test edilir),
  tam klavye gezinimi (tablolar dahil), görünür odak halkası, `aria-live` ile süre
  uyarıları, form hatalarında metinli açıklama, hareket azaltma (`prefers-reduced-motion`).

---

## Bölüm B — Pazarlama Sitesi (`apps/site`)

Halka açık, binlerce avukat/büroya hitap eden SaaS vitrini. Amaç: sistemi **çok iyi
anlatmak** ve demo talebine dönüştürmek. Ana CTA her sayfada: **"Demo Talep Edin"**.

### B.1 Sayfa Haritası

```
/                → Ana sayfa (hero + değer önerisi + modül turu)
/ozellikler      → Özellikler (ana modül başına ekran görüntülü bölüm)
/nasil-calisir   → Nasıl Çalışır (3 adımlı akış)
/guvenlik        → Güvenlik & KVKK (BYO-LLM mesajı öne çıkar)
/fiyatlandirma   → Fiyatlandırma (Solo / Büro / Enterprise)
/sss             → SSS
/iletisim        → İletişim / Demo talebi (form)
```

### B.2 Ana Sayfa — Bölüm Taslağı

1. **Hero**
   - Başlık: **"Büronuzun işletim sistemi. Yapay zekâ destekli."**
   - Alt metin: "NomosOS; müvekkil, dava, icra, duruşma, süre ve finansı tek çatıda
     yönetir. Yapay zekâ her dosyayı okur, önerir — kararı siz verirsiniz."
   - CTA: [Demo Talep Edin] (birincil, altın) · [Özellikleri İnceleyin] (ikincil)
   - Görsel: Panel ekran görüntüsü (bugünkü duruşmalar + kritik süreler kartı).
2. **Sorun şeridi** — 3 kart:
   "Süre kaçırma korkusu" · "Dağınık dosyalar, Excel'ler, ajandalar" ·
   "'Davam ne oldu?' telefonları". Her kartta bir cümlelik çözüm cevabı.
3. **Değer önerisi**: "AI asistan değil, işletim sistemi." — kısa paragraf:
   "Piyasadaki araçlar dilekçe yazar. NomosOS bunu da yapar; ama asıl işi büronuzun
   tamamını yönetmektir: CRM, dava yaşam döngüsü, icra, görevler, finans ve UYAP —
   hepsi tek sistemde, hepsinin üzerinde yapay zekâ."
4. **Modül turu** (sekmeli ya da kaydırmalı, her biri ekran görüntülü):
   Müvekkil 360° · Dava Dosyası · Duruşma Günü · Süre Motoru · UYAP Hub ·
   Belge→Aksiyon · İcra Copilot · Partner Paneli.
   Örnek mikro-metin (Süre Motoru): "İstinaf süresi deterministik hesaplanır —
   tebliğ tarihi, tebliğ yöntemi ve resmi tatiller dahil. AI tespit eder, siz onaylarsınız."
5. **Güven şeridi**: "Verileriniz sizde kalır — kendi yapay zekânızı bağlayın."
   → /guvenlik'e bağlantı.
6. **Kapanış CTA**: "Büronuzu 30 dakikada tanıyalım." + [Demo Talep Edin].

### B.3 Özellikler Sayfası

Her ana modül için: başlık + 2-3 cümle + ekran görüntüsü + 3 maddelik "neler yaparsınız"
listesi. Sıra ve örnek başlıklar:

- **Müvekkil 360°** — "Bir müvekkil, tek kart: 37 dava, 82 icra, sözleşmeler, bakiye."
- **Dava Yaşam Döngüsü** — "Açılıştan temyize, temyizden icraya — dosyanın tamamı."
- **Duruşma Yönetimi** — "'Bugünkü duruşmalarımı hazırla' deyin; özet, son beyanlar ve
  sorulacak sorular hazır."
- **Süre Motoru** — "Hiçbir süreyi kaçırmayın. Hesap deterministik, onay sizde."
- **UYAP Hub** — "UYAP'taki evrak NomosOS'a akar; sınıflanır, süreye ve göreve dönüşür."
- **Belge → Otomatik Aksiyon** — "Ara karar geldi; görev, son tarih ve müvekkil
  bilgilendirme taslağı sizi bekliyor."
- **İcra + İcra Copilot** — "Takipten tahsilata; borçlu analizi ve aşama önerileriyle."
- **Finans & Faturalama** — "Tahakkuk, tahsilat, masraf, harç — müvekkil bazında net tablo."
- **Legal Intelligence** — "Risk skoru, strateji analizi, karşı taraf simülasyonu,
  delil matrisi."
- **Partner Paneli** — "Büronun tamamı tek ekranda: 'Bugün müdahale etmem gereken 10 şey.'"

### B.4 Nasıl Çalışır Sayfası

3 adım + kısa video/animasyon alanı:
1. **Bağlanın** — "UYAP eklentisini kurun, dosyalarınız NomosOS'a aksın. Kendi yapay
   zekâ sağlayıcınızı 2 dakikada bağlayın."
2. **Sistem çalışsın** — "Gelen her evrak sınıflanır; süreler, görevler ve müvekkil
   bilgilendirmeleri öneri olarak önünüze gelir."
3. **Siz onaylayın** — "Yapay zekâ önerir, avukat onaylar. Her çıktı kaynağını gösterir."

Altta güven ilkeleri kutusu: "AI önerir, avukat onaylar" · "Deterministik süre hesabı" ·
"Kaynaksız hukuki beyan yok" · "Teyit Ajanı ile doğrulama".

### B.5 Güvenlik & KVKK Sayfası (stratejik sayfa)

- Hero: **"Kendi yapay zekânızı bağlayın. Verileriniz sizde kalsın."**
  Alt metin: "NomosOS, BYO-LLM mimarisiyle çalışır: Anthropic, OpenAI, Gemini,
  OpenAI-uyumlu servisler veya tamamen kendi sunucunuzdaki yerel model. Yerel model
  seçtiğinizde dosyalarınız büronuzun dışına hiç çıkmaz."
- Bölümler:
  1. **Sistem seviyesinde KVKK**: "TC kimlik no, telefon, IBAN, adres ve sağlık verileri
     otomatik tespit edilir; maskelenip onayınız alınmadan hiçbir yapay zekâya gönderilmez."
  2. **Private AI / Enterprise**: "Türkiye veri bölgesi, yerel LLM, 'verileriniz dış
     LLM'e gönderilmez' garantisi."
  3. **Çok kiracılı izolasyon**: tenant bazlı ayrım, şifreleme (aktarımda ve depoda),
     erişim logları, rol bazlı yetki.
  4. **Avukatın kontrolü**: UYAP gönderimleri dahil hiçbir işlem onaysız yapılmaz.
- CTA: "KVKK dokümanımızı isteyin" + [Demo Talep Edin].

### B.6 Fiyatlandırma Sayfası

3 kart (aylık/yıllık anahtarı; kullanıcı/ay fiyat alanları lansmanda doldurulacak
`{FİYAT}` yer tutucularıyla):

| | **Solo** | **Büro** (öne çıkan) | **Enterprise** |
|---|---|---|---|
| Hedef | Tek avukat | 3-20 avukat | 20+ avukat / kurumsal |
| Çekirdek | CRM, dava, duruşma, süre, görev | Solo'nun tamamı | Büro'nun tamamı |
| AI | AI asistan (kendi anahtarınızla) | + İcra Copilot, belge→aksiyon | + Private AI / yerel LLM |
| Diğer | UYAP eklentisi | Finans, faturalama, roller, raporlar | SSO, veri bölgesi, SLA, onboarding |
| CTA | [Ücretsiz Deneyin] | [Demo Talep Edin] | [Bize Ulaşın] |

Altına not: **"Tüm paketlerde yapay zekâ kendi sağlayıcınızla çalışır — sürpriz AI
faturası yok."** + kısa karşılaştırma tablosu + fiyatlandırma SSS'i (3 soru).

### B.7 SSS Sayfası (başlangıç seti)

- "UYAP ile nasıl entegre oluyorsunuz?" → Chrome eklentisi, sizin oturumunuzla; resmi
  gönderimlerde son onay her zaman sizde.
- "Verilerim yapay zekâ şirketlerine gidiyor mu?" → Yalnızca sizin bağladığınız
  sağlayıcıya, maskeleme onayınızdan sonra; yerel modelde hiç gitmez.
- "Yapay zekâ yanlış süre hesaplarsa?" → Süreler yapay zekâ ile değil deterministik
  kural motoruyla hesaplanır; yapay zekâ yalnız tespit önerir.
- "Mevcut programımdan geçiş?" → Excel/CSV içe aktarım + onboarding desteği.
- "Kaç kullanıcıyla çalışır?" → Tek avukattan 100+ avukatlı bürolara.
- "Mobil var mı?" → Yol haritasında; web arayüzü mobil uyumlu.

### B.8 İletişim / Demo Talebi

Form alanları: Ad Soyad · E-posta · Telefon · Büro adı · Avukat sayısı (Solo/2-5/6-20/
21-50/50+) · Not. Gönderim sonrası: "Teşekkürler — 1 iş günü içinde dönüş yapıyoruz."
KVKK aydınlatma metni onay kutusu zorunlu.

### B.9 SEO ve Dönüşüm Notları

- **Ana CTA her sayfada "Demo Talep Edin"**; header'da sabit, sayfa sonlarında tekrar.
- Hedef aramalar: "avukatlık büro yönetim programı", "hukuk bürosu yazılımı",
  "UYAP entegrasyonu", "avukat yapay zekâ", "icra takip programı", "hukuk bürosu CRM".
  Her özellik bölümü bu ifadeleri doğal biçimde içerir.
- Teknik: SSG/ISR (hızlı LCP), Türkçe `lang="tr"`, sayfa başına tek H1, açıklayıcı
  meta description, `Organization` + `SoftwareApplication` + `FAQPage` yapılandırılmış
  verisi, Open Graph görselleri (ekran görüntülü).
- Dönüşüm: modül turunda her ekran görüntüsünün altına bağlam CTA'sı ("Bu ekranı canlı
  görün → Demo"); /guvenlik sayfası Enterprise huninin girişidir, satış ekibine ayrı
  form yönlendirmesi; blog/içerik (süre hesabı rehberleri vb.) ikinci aşama.
- Ölçüm: demo formu gönderimi birincil dönüşüm olayı; kaynak (utm) alanları formda gizli.
