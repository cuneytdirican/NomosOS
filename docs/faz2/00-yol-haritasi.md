# NomosOS — İkinci Faz Yol Haritası

> **Durum:** Taslak — onay bekliyor · **Tarih:** 31.08.2026
> Bu doküman İkinci Faz'ın (F2) çerçevesidir: neden, hangi epic'ler, hangi sırayla,
> hangi risklerle. Epic'lerin atomic görev kırılımları `docs/faz2/epics/` altındadır.

## Bağlam

Ürün fazları 0-6 tamamlandı: 12 paket, 815 test, derin denetim yapıldı
([DENETIM-RAPORU.md](../DENETIM-RAPORU.md) — 86 bulgu, 58 kapandı, 5 backlog, 23 açık),
Docker test yığını çalışıyor. Ama [06-yol-haritasi.md](../06-yol-haritasi.md) **Faz 6'da
bitiyor** — sonrası için yazılmış plan yok.

Bu yol haritası iki soruyu yanıtlıyor:
1. **Spec'te vaat edilip kodda karşılığı olmayan ne var?**
2. **Türkiye hukuk yazılımı pazarında rakiplerde olup bizde olmayan ne var?**

**Alınan kararlar:** tüm epic'ler atomic görev seviyesine kadar kırılır · çıktı yalnız
Markdown · içtihat için hem kendi altyapımız hem üçüncü taraf lisans planlanır ·
sıralama **yasal zorunluluk önce** · kapasite **ajan tabanlı** (takvim çeyreği değil, tur) ·
UETS için **keşif izleği + soyutlama** deseni.

> ### ⚠ Terim disiplini (zorunlu)
> [06-yol-haritasi.md](../06-yol-haritasi.md)'de **"Faz 2"** zaten AI+UYAP fazını ifade
> ediyor. Karışmaması için:
> - **"ürün fazı 0-6"** → eski fazlar (`docs/06`)
> - **"İkinci Faz" / "F2"** → bu 37 epic'lik program
>
> Epic kimlikleri faz öneki taşımaz.

---

## Araştırmanın planı değiştiren dört bulgusu

### 1. UETS çok kiracılı SaaS için mimari kısıt taşıyor

e-Tebligat avukatlar için **yasal zorunlu**, rakiplerin hepsinde var, bizde hiç yok.
PTT'nin resmî API'si mevcut — **ancak**: taahhütname imzalanıyor, ücret peşin ödeniyor ve
kritik bir madde var: *"API başvuruları kullanıcıya özeldir, PTT'nin izni olmadan
paylaşılamaz."*

Bu, "her büro kendi anahtarını girer" modelini tehlikeye atıyor. İki olası yol var ve
hangisinin geçerli olduğu **PTT'den yazılı olarak doğrulanmalı**:
- **(a)** NomosOS entegratör firma olur ya da bir entegratörle sözleşme yapar, kiracı adına erişir
- **(b)** her büro kendi UETS kimlik bilgisini sisteme girer — "paylaşılamaz" maddesine takılabilir

→ **A3, tedarik/hukuk izleği (A3a) ve kod izleği (A3b) olarak ayrılır. A3a gün 1'de
başlar, kod yazılmadan.** Sözleşme senaryosu netleşmeden A3b'nin eforu tahmin edilemez.
Bu, tüm yol haritasının **en büyük takvim riskidir**.

### 2. UYAP gece senkronu muhtemelen imkânsız

Rakiplerin *"gece sunucudan bağlanıp evrak çekiyor"* iddiası doğrulanmalı: UYAP Avukat
Portalı oturumu **e-imza/akıllı karta bağlıdır**; başsız bir sunucu bu oturumu açamaz.
Muhtemel açıklamalar: büroda kalan bir masaüstü ajanı · kurumsal UYAP web servis anlaşması ·
kart PIN'inin önbelleklendiği yerel servis (güvenlik açısından savunulamaz).

→ **Epic değil, keşif spike'ı (B5).** Mimari doğrulanmadan XL epic açılmaz.

### 3. İçtihat için resmî toplu erişim API'si yok

Yargıtay, Danıştay ve UYAP Emsal yalnız web arama arayüzü sunuyor (Danıştay ~412 bin
doküman). Rakipler 10-11 milyon karar iddia ediyor (Apilex 11M+, HukukOS 10,9M); bizde
3 demo kaydı var.

FSEK m.31 uyarınca mevzuat ve yargı kararları serbestçe yararlanılabilir eserlerdir —
resmî devlet kaynaklarından toplamak savunulabilir. **Ancak** ticari yayıncıların eklediği
özet/anahtar kelime/dizin korunur ve FSEK ek m.8 sui generis veri tabanı hakkı derlemenin
kendisine bağlanabilir. Sitelerin kullanım şartları ve `robots.txt` durumu **doğrulanmadan
kod yazılmamalı**.

→ **C2 (üçüncü taraf lisans adaptörü) risk azaltıcı olarak C4'ten (kendi korpus) önce
gelir.** C4 gecikirse C2 korpusu sağlar ve C5 beklemez.

### 4. Denetim raporunun bir maddesi YARIM bayat

Ö-30 *"delil matrisinde `linkType` yok"* diyor. Şema ayağı **çürütüldü**:
`schema.prisma:2262`'de `EvidenceLinkType { SUPPORTS | CONTRADICTS | BELIRSIZ }` enum'u ve
`ClaimEvidenceLink.linkType` alanı **var**.

**Ama kullanım ayağı açık — doğrulandı:** `linkType` depoda **hiçbir yerde okunmuyor**
(`grep` sonucu 0), ve `evidence/evidence-matrix.service.ts:152`
`unsupported = counted.length === 0` bağın **yönüne bakmıyor**. Sonuç: yalnız *çürüten*
delil bağı olan bir iddia bugün **"desteklenmiş" sayılıyor.** Modül 14 KK3 yanlış sonuç
üretiyor, KK6 (`CONTRADICTS` + `offered_by=US` → 422) hiç yok.

→ **Modül 14'ün "çürüten delil" vaadi bugün VERİLEMEZ.** Kullanım ayağı `E6`'ya bağlandı.

---

## Sıralama kriterine bir düzeltme

Karar *"yasal zorunluluk önce"* idi ve ilk taslakta UETS başa konmuştu. **Bu, kriterin
kendi mantığına aykırı:**

| | Kimin yükümlülüğü | Sonuç |
|---|---|---|
| **UETS** | *Avukatın* (7201 s.K.) | Bizim entegre etmememiz yasa dışı değil — rekabet ve kusur riski |
| **KVKK veri özne hakları** | *Veri sorumlusunun* (6698 m.11-13), 30 gün içinde | Bugün `POST`/`DELETE /tenants` yok → **müşterimiz talep aldığında yasayı ihlal ediyor ve sebebi bizim ürünümüz.** İdari para cezası buna bağlı |
| **K-12 kalıntısı** | Azledilmiş müvekkil portalda dosya görmeye devam ediyor | Hukuken KVKK ve meslek sırrı ihlali |

→ Kritere **daha sadık** sıra: **KVKK → üretim kapatıcıları → UETS.**

---

## Epic listesi — 37 epic, ≈1.600 atomic görev

### BLOK A — Yasal kapı (≈243 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **A0** | Vaat hizalaması — arayüz ve pazarlama metninden karşılanmayan vaatlerin çıkarılması | XS (8) | **Gün 1.** Kod değil; her gecikme yanıltıcı ticari uygulama riski biriktiriyor |
| **A1** | KVKK veri özne hakları + **K-12 portal okuma-anı vekalet canlılığı** + `PoaScopeItem` | L (65) | İlk task **kod değil**: Avukatlık K. m.39 saklama ↔ append-only denetim izi ↔ KVKK imha çelişkisinin politika matrisi. Şema-güdümlü registry olmalı. **Düzeltme:** `DELETE /tenants/:id` **VAR** (`platform-tenants.controller.ts:134`, dört-göz) — ama spec'e uymuyor: Modül 25 "soft-delete + anonimleştirme kuyruğu" diyor, kod **geri alınamaz hard purge** koşuyor. Eksik olan `POST /tenants` ve müvekkil bazlı dışa aktarım. `PoaScopeItem` de TypeScript arayüzü olarak var (`poa-scope-catalog.ts:431`), Prisma modeli değil → iş "JSON'u entity'ye terfi + kayıpsız göç" |
| **A2** | Üretim kapatıcıları (denetimden kalan 5) | M (45) | Hacmin %60'ı regresyon test paketi (K-01/03/05/08/09/13) |
| **A3a** | UETS tedarik + hukuki mimari | M (15) | **Kod yok, süreç var. Takvimi biz kontrol etmiyoruz** |
| **A3b** | UETS kod — sağlayıcı-bağımsız adaptör + Noop + sahte sunucu testi | XL (90) | Sözleşme senaryosuna göre ±30 |
| **A4** | Süre kuralı tamamlama + tebligat→süre köprüsü | S (25) | **Değer/efor oranı en yüksek epic.** Bugün `rules.ts`'te **22 kural var** (pazarlama "18" diyor — iki yerde yanlış). Eksikler: İİK m.89 (**tek kural değil ÜÇ kural** — 7/7/15 gün), İİK m.33, HMK m.394, m.317/2, ve **İİK m.363 istinaf 10 gün** (Modül 04 seed tablosunda vaat edilmiş, `rules.ts`'te yok) |
| **A5** | Kimlik ve kripto sertleştirme | S (25) | **Yeni** — hiçbir epic'e bağlanmayan bulgular: İ-01 (TOTP `window:1`, kullanılmış adım saklanmıyor → aynı kod ~90 sn tekrar kullanılabilir) · İ-02 (bcrypt maliyeti 3 yerde de 10) · İ-19 (Gemini API anahtarı URL sorgu dizesinde — `x-goog-api-key` başlığına geçmeli) · İ-25 (demo formunda rate limit/captcha yok) |

### BLOK B — Belge ve UYAP hattı (≈300 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **B1** | **Asenkron iş altyapısı** — BullMQ worker + DLQ + geri basınç + kısmi başarısızlık semantiği | L (55) | **Öne alındı.** OCR, korpus ingest, UYAP senkron, gece risk — hepsi bunu bekliyor. Sonda kalırsa her ağır iş iki kez yazılır |
| **B2** | Belge metin çıkarma: gerçek OCR **+ DOCX + UDF** | L (60) | DOCX (~8) ve UDF (~10, `packages/udf/parser.ts` hazır) **ucuz kazanç**. İlk task ürün-politika kararı: kendi barındırdığımız OCR (KVKK temiz) vs. bulut OCR |
| **B3** | Belge yönetimi borcu — `DocumentVersion`, `Folder`, tam metin arama | M (40) | |
| **B4** | UYAP backend — 6 uç + `ExtensionToken` + `uyap.document.received` | L (70) | Sözleşme yazılı ([05-uyap-entegrasyonu.md](../05-uyap-entegrasyonu.md) §8), istemci %100 hazır → belirsizlik düşük. **Referans epic** |
| **B5** | UYAP gece senkron — **önce keşif spike'ı** | S (10) + ? | Mimari doğrulanana kadar epic açılmaz |
| **B6** | Toplu işlemler — toplu sorgu / takip açma / imzalama / gönderme / malvarlığı | L (65) | |

### BLOK C — Korpus ve arama (≈270 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **C1** | **pgvector göçü + hibrit (BM25+vektör) arama** | M (30) | **Korpustan ÖNCE.** Sonra yapılırsa 11M kaydın yeniden gömülmesi gerekir. Bugün 3 kayıtla ucuz |
| **C2** | Üçüncü taraf içtihat lisans adaptörü | S/M (25) | Adaptör arayüzü + registry hazır. **Hedge**: C4 gecikirse C5'i besler |
| **C3** | Mevzuat havuzu — `Statute*` + `STATUTE_RESOLVE` | L (70) | Zamansal sürüm çözümü ("madde X, Y tarihinde hangi metindi") sanıldığından zor |
| **C4** | Kendi içtihat korpusumuz | XL (110) | **İlk task hukuk görüşü.** Üç ayrı disiplin: toplama / normalizasyon-tekilleştirme / artımlı güncelleme |
| **C5** | Hukuki niteleme + semantik arama ürünleşmesi | M (35) | |

### BLOK D — Rakip paritesi (≈305 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **D1** | Takvim entegrasyonu — Google / MS Graph / ICS | M (40) | Bağımsız; UETS teslim tarihinin doğal teslim kanalı |
| **D2** | Duruşma hazırlık paketi + çakışma kontrolü + `/hearings/today` | M (40) | Kusur sorumluluğu kalemi: çakışan iki duruşma = kaçırılan duruşma |
| **D3** | Hukuki hesaplama motoru | XL (85) | **En yüksek sorumluluk riski.** Kıdemde *mevduata uygulanan en yüksek faiz*, diğerlerinde *yasal faiz* — tek "faiz" fonksiyonu yazan herkes yanlış yapar. Parametreler **tarihli-versiyonlu** olmalı. **LLM'e asla verilmez** |
| **D4** | Mesajlaşma kanalları + WhatsApp AI + `PortalMessage`/`PortalTodo` | L (60) | Meslek sırrının Meta altyapısından geçmesi baro etiği açısından **doğrulanmalı** |
| **D5** | Sözleşme hazırlama AI (emsal destekli) | M (35) | `Contract*` modelleri hazır |
| **D6** | Arabuluculuk modülü | M/L (45) | **İzolasyon modeline istisna açar** — arabulucu her iki tarafın verisini tutar |

### BLOK E — Spec borcu (≈245 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **E1** | AI ajan gözlemlenebilirliği — `AgentDefinition` / `AgentRun` | M (35) | **Öne alındı** — sonraki her AI epic'ini enstrümante eder |
| **E2** | Gece risk skorlama işi + `DashboardSnapshot` | S (15) | **En ucuz epic.** `RiskService.compute()` ve `job-registry` deseni hazır |
| **E3** | Görev workflow motoru | L (70) | **Ürettiği her süre onay kuyruğundan geçmeli** — yoksa "AI önerir, avukat onaylar" ilkesi delinir |
| **E4** | Partner dashboard (10/10 kriter) | M/L (55) | Metrikler **birim testli** olmalı — K-06 (TRY değeri EUR etiketiyle) sınıfı hata tekrarlamasın |
| **E5** | Gerçek sağlayıcı bağlama — e-imza / e-Fatura / push | M (50) | Kod kolay, tedarik zor → tedarik gün 1'de başlar |
| **E6** | Bilirkişi/delil tamamlama — `ExpertAssignment`, `EvidenceDocument` | S (20) | |

### BLOK F — Ölçek ve borç (≈235 atomic)

| # | Epic | Boyut | Not |
|---|---|---|---|
| **F1** | Sözleşme borcu: `api-routes.ts` 30 modül + `docs/02` 46 model + lint tavanı | M (50) | Mekanik ama kaçınılmaz — 8 uydurma uç bulgusunun kök nedeni |
| **F2** | CRM ve ilişki tamamlama — `ClientRepresentative`, `ClientInteraction`, `ClientMergeLog`, `RelatedCompany`, `SavedSearch` | M (45) | `RelatedCompany` conflict-check'in grup şirketi körlüğünü kapatır |
| **F3** | Operasyon gözlemlenebilirliği — `PlatformAlert` + UYAP ayrıştırıcı sağlık telemetrisi | M (30) | UETS 7/24 tarama başlayınca **sessiz arıza = kaçırılan tebligat = kusur sorumluluğu** |
| **F4** | Veri göçü / rakipten geçiş importer | M (40) | **Satış engeli** — 8 yıllık dosyasını taşıyamayan büro özellik paritesine bakmaz |
| **F5** | `Tenant.dataRegion` / veri yerelleştirme | M (25) | |
| **F6** | Kurumsal kimlik — SSO / SAML / SCIM | L (45) | **Talep sinyali yok** — ilk kurumsal müşteri isteyene kadar yazılmaz |
| **F7** | Erişilebilirlik ve istemci oturum borcu | M (35) | **Yeni** — hiçbir epic'e bağlanmayan bulgular: İ-21 (kontrast WCAG AA altı, `text-slate-400` **50 dosyada**) · `role="tabpanel"` eksik (Tabs `aria-controls` yayınlıyor ama panel yok) · İ-26 · İ-23/İ-24 (istemci oturum tazeleme — `/auth/me` çağrısı web'de **sıfır**) · İ-20 (`layout.tsx:418` ham enum basıyor) |

---

## Bağımlılık grafiği

```
A0 (vaat hizalama) ──────────────────────► hiçbir şeyi bloklamaz, GÜN 1

A2 (üretim kapatıcıları) ═══► SÜRÜM KAPISI ═══► her şeyin yayını

A1 (KVKK) ◄── şema envanteri ── F1, F2, B3, E6 yeni entity eklerse A1 YENİDEN AÇILIR
                                 ⚠ bu yüzden şema-güdümlü registry olmalı

┌── KRİTİK YOL 1 (belge/UYAP) ──────────────────────────────────┐
│  B1 asenkron ──► B2 metin çıkarma ──► B4 UYAP ──► B6 toplu    │
│       │              │                                         │
│       │              └──► A3b UETS (taranmış tebligat)         │
│       │              └──► E3 workflow (belge tetikli)          │
│       └──► E2 gece risk ──► E4 partner dashboard               │
└────────────────────────────────────────────────────────────────┘

┌── KRİTİK YOL 2 (korpus) ───────────────────────────────────────┐
│  C1 pgvector ──► C2 lisans ──► C4 kendi korpus ──► C5 niteleme │
│  C3 mevzuat havuzu ──► C5                                       │
│  C3 ──► D3 hesaplama (madde atıfları) [yumuşak]                 │
└─────────────────────────────────────────────────────────────────┘

A3a (tedarik) ══ AYLARCA SÜREBİLİR, TAKVİM DIŞI ══► A3b (kod)
E5 sağlayıcı tedariki ══ aynı şekilde ══► E5 (kod)     ⚠ ikisi de GÜN 1'de başlar

A3b ──► A4 (teslim tarihi → süre) ──► D1 (takvim daveti)
B4 ──► B5 (gece senkron)  ⚠ B5 mimarisi doğrulanmalı
E1 gözlemlenebilirlik ──► C5, D3, D4, D5 için enstrümantasyon (önce gelmeli)

BAĞIMSIZ: D1 · D6 · F4 · F5 · F6 · E1
```

**İki soru, iki net yanıt:**

- *"OCR olmadan UYAP backend yarım kalır mı?"* → **Evet, ama kritik yolda değil.** B4 OCR'sız
  yazılabilir; evrak yüklenir, dosyaya bağlanır, safahat gelir. Ama Modül 06'nın 7 adımının
  6'sı çalışmaz — UYAP entegrasyonu "dosya deposu" olur, "AI operasyon katmanı" olmaz.
  → B2 önce, B4 sonra; teknik olarak paralel yazılabilirler.
- *"Semantik arama korpus olmadan anlamsız mı?"* → **Semantik arama evet, pgvector hayır.**
  pgvector göçü bugünkü 3 kayıtla bile yapılabilir ve **yapılmalıdır**. Korpus geldikten
  sonra göç, 11M satırın yeniden gömülmesi demektir.

---

## Tur dağılımı

Kapasite ajan tabanlı olduğu için takvim çeyreği yerine **tur** kullanılıyor. Her tur bir
workflow dizisi; sonunda **gösterilebilir/satılabilir bir kesit** çıkar.

### T1 — "Yasal olarak satılabilir ve belgeyi gerçekten okuyan sürüm" (≈300 atomic)
**Kapsam:** A0 · A2 · A1 · B1 · B2 · A4 · E1 · E2 · **A3a ve E5 tedarikini başlat**

| Çıkış kriteri | Ölçüt |
|---|---|
| KVKK veri özne hakkı talebi 30 gün içinde karşılanabiliyor | `POST /tenants/:id/export` + `DELETE` + imha politika matrisi + dört-göz onayı; şema-güdümlü, yeni entity otomatik kapsanıyor |
| Azledilmiş müvekkil portalı **anında** kapanıyor | Canlı test: `expiresAt` geriye alınınca `/portal/cases` → 403 |
| Üretime çıkılabiliyor | Denetimin 6 kapatıcısının 6'sı kapalı; `uretim-dagitimi.md` güncel |
| **Taranmış UYAP evrakı okunuyor** | Taranmış tebligat PDF → metin → sınıflandırma → süre önerisi, uçtan uca; DOCX ve UDF de |
| Ağır iş kuyrukta | Belge hattı, RAG indeksleme, risk skorlama kuyruğa taşındı; kısmi başarısızlık dürüstçe gösteriliyor |
| 4 süre kuralı tam | İİK 89/33, HMK 394/317-2 birim testli |
| Her AI çağrısı izlenebilir | `AgentRun` kaydı + iz görünümü |

> *"Taranmış tebligatı sürükleyin — sistem okur, sınıflar, süreyi resmî tatilleri hesaba
> katarak çıkarır, görevi önerir. Onaylayın, takviminize düşsün."*

### T2 — "Tebligat ve UYAP hattı canlı" (≈320 atomic)
**Kapsam:** A3b · D1 · B4 · D2 · B3 · C1 · **B5 spike**

| Çıkış kriteri | Ölçüt |
|---|---|
| **e-Tebligat 7/24 otomatik içeri alınıyor** | UETS → belge → dosya eşleşmesi → **teslim tarihinden** süre → onay kuyruğu |
| Süre avukatın takvimine düşüyor | Outlook/Google davet + ICS; iptal/güncelleme senkronu |
| **Eklenti gerçek bir sunucuya konuşuyor** | 6 uç canlı; popup gerçek "son senkron" gösteriyor; evrak hash ile idempotent |
| Duruşma çakışması uyarıyor | `/hearings/today` + çakışma algoritması (tarih + şehir/seyahat süresi) |
| pgvector üretimde | 100K sahte kayıtla ölçek provası geçti; hibrit arama canlı |
| B5 kararı verildi | Gece senkron mimarisi belgelendi: masaüstü ajanı mı, web servis anlaşması mı, **yoksa yapılmayacak mı** |

> Bu tur, **rakiplerle aynı masaya oturduğunuz ilk andır.** *"Siz uyurken tebligat düştü.
> Sabah açtığınızda süresi hesaplanmış, dosyaya bağlanmış, takviminize davet gitmiş halde."*

### T3 — "İçtihat ve hesap" (≈325 atomic)
**Kapsam:** C2 · C3 · C4 · C5 · D3

| Çıkış kriteri | Ölçüt |
|---|---|
| Milyonlarca karar üzerinde semantik arama | C2 canlı **veya** C4'ün ilk kesiti; her sonuç kaynak künyesiyle, Teyit Ajanı `DOGRULANDI` dönüyor |
| **Madde atıfları artık `BELIRSIZ` dönmüyor** | `Statute*` havuzu + zamansal sürüm çözümü. **Ö-25 vaat kısıtı kalkar** |
| Olay örgüsünden hukuki nitelendirme | Değerlendirme setinde ölçülmüş doğruluk; **avukat onayı zorunlu** kapısı |
| **Hesap motoru dilekçeye deterministik basıyor** | Kıdem/ihbar/fazla mesai/yıllık izin/UBGT + 4 faiz türü + harç + AAÜT; **50 senaryoluk yayımlanmış test tablosu** geçiyor; parametreler yıla göre versiyonlu |

### T4 — "Büro operasyonu" (≈345 atomic) ⚠ dolu
**Kapsam:** E3 · E4 · B6 · D4 · E5 · D5 · F1

| Çıkış kriteri | Ölçüt |
|---|---|
| Süreç tek tuşla plana dönüyor | `WorkflowTemplate` → `WorkflowRun`; 48 saat eskalasyon. **Üretilen her süre onay kuyruğundan geçiyor.** Modül 07'nin 11/11 kriteri |
| Ortak paneli 10/10 | Metriklerin her biri birim testli; para birimi karıştırma sınıfı hata yok |
| İcra bürosu toplu çalışıyor | 5 toplu işlem tipi + kısmi başarısızlık mutabakatı |
| Müvekkil WhatsApp'tan cevap alıyor | AI taslak → avukat onayı → gönderim; şablonlar Meta onaylı |
| e-imza ve e-Fatura **gerçek** | Noop'lar üretim sağlayıcıya bağlı |
| Uç sözleşmesi tek kaynak | `api-routes.ts` 30 modül; `docs/02` 150 modeli kapsıyor |

### T5 — Taşan tur (≈310 atomic)
B5 (karar olumluysa) · D6 · F2 · F3 · F4 · F5 · E6 · F6

> **Baştan kabul edilen gerçek:** ≈1.600 atomic görev, mevcut kod tabanının 2-2,5 katı.
> Dört tura sığmıyor; beşinci tur planlanıyor. Bunu baştan kabul etmek, son turda panikle
> kalite düşürmekten iyidir. **F4 (veri göçü) erken bir kurumsal müşteri gelirse T2/T3'e
> çekilmeli** — planın en olası bozulma noktası budur.

---

## Riskler

| Blok | En büyük risk | Önlem |
|---|---|---|
| **A** | UETS'in çok kiracılı SaaS'a uygunluğu (API "paylaşılamaz" maddesi) | A3a gün 1'de başlar; PTT'den **yazılı** görüş alınır. Sağlayıcı-bağımsız adaptör + Noop deseni sözleşme senaryosundan bağımsız yazılabilir |
| **A** | KVKK imha politikası: Avukatlık K. m.39 saklama ↔ append-only denetim izi ↔ imha talebi çelişkisi | A1'in ilk task'ı kod değil, politika matrisi |
| **A** | `PlatformAuditLog.platformUser` FK `onDelete: SetNull` + append-only trigger → hard delete eklenirse platform kullanıcı yönetimi kilitlenir | Şema düzeyinde çöz: FK'yı kaldır, FK'sız nullable kolona indir |
| **B** | UYAP gece senkronunun teknik imkânsızlığı | B5 keşif spike'ı; sonuç olumsuzsa vaat geri çekilir |
| **B** | Türkçe OCR doğruluğu — İ/I ve ı/i karışması isim ve TCKN eşlemesini bozar | **Doğruluk kapısı zorunlu**: güven skoru eşiğin altındaysa `BASARISIZ`. Kötü OCR boş metinden beterdir — *yanlış* metin üretir ve sınıflandırma ona güvenir |
| **B** | Bulut OCR müvekkil belgesini yurt dışına gönderir — kendi KVKK ilkemizle çelişir | Ürün-politika kararı: kendi barındırdığımız OCR vs. kiracı bazlı opt-in bulut |
| **C** | Korpus toplamanın hukuki zemini (FSEK ek m.8 sui generis, kullanım şartları) | C4'ün ilk task'ı hukuk görüşü. Resmî kaynaktan toplanır, rakip veri tabanından **asla** |
| **C** | Gömme maliyeti: 10M karar ≈ 20 milyar token. `EMBEDDING` bugün "ücretsiz, yüksek hacim" işaretli — **bu varsayım 10M ölçekte çöker** | Kredi/maliyet modeli yeniden hesaplanır |
| **C** | pgvector ölçeği: 10M × 1024 boyut ≈ 40 GB, HNSW indeksi RAM'e sığmalı | C1'in bir task'ı "100K sahte kayıtla ölçek provası" |
| **D** | **Hukuki hesaplamada kusur sorumluluğu** — yanlış kıdem/faiz dilekçeye basılırsa bu yazılım hatası değil, **avukatın kusuru** olur | Deterministik `legal-core` deseni + hesap izi + 50 senaryoluk doğrulanmış test tablosu. **LLM'e asla verilmez** |
| **D** | WhatsApp: meslek sırrının Meta altyapısından geçmesi | Baro görüşü; kiracı bazlı opt-in + müvekkil rızası kaydı |
| **D** | Arabuluculuk her iki tarafın verisini tutar — tenant izolasyon modeli tek taraf vekilliği varsayıyor | D6 bir modül eklemesi değil, izolasyon modeline istisna. Şema etkisi geniş olabilir |
| **E** | Workflow'un otomatik süre üretip onay ilkesini delmesi | Üretilen her süre onay kuyruğundan geçer |
| **F** | Asenkrona geçişin işlem garantilerini bozması — kısmi başarısızlık semantiği | `dedupe-key.ts`, `idempotency.test.ts`, `job-runner-lock.test.ts` desenleri mevcut |

---

## Kaynaklar

**Pazar araştırması:** [Hukuk Asistan](https://hukas.com.tr/home) ·
[SmartHukuk — En İyi Avukat Programları 2026](https://smarthukuk.com/blog/en-iyi-avukat-programlari-hukuk-burosu-yazilimlari-2026) ·
[Apilex](https://www.apilex.ai/blog/turkiye-hukuk-sistemine-uygun-yapay-zeka) ·
[HukukOS](https://hukukos.com/) · [OveK Hukuk](https://www.ovekhukuk.com/) ·
[Lawyer Team](https://lawyerteam.pro/Yapay_Zeka) ·
[Tebli](https://www.tebli.co/post/en-iyi-hukuk-programlari-2026) ·
[UYAP Kâtibim / SHA Yazılım](https://shayazilim.com/Uyap_Katibim)

**UETS:** [PTT Entegrasyon Başvurusu](https://www.ptt.gov.tr/basvuru-entegrasyon) ·
[Entegratör Firma Kılavuzu (PDF)](https://pttwebdosya.ptt.gov.tr/api/file/getFile?FileName=Entegrator-Firma-Araciligi-ile-Gerceklestirilen-Entegrasyon-Hizmet-Basvuru-Kilavuzu-V1.0.pdf) ·
[Entegrasyon Taahhütnamesi (PDF)](https://www.etebligat.gov.tr/wp-content/uploads/2021/10/PTTUETS-Entegrasyon-Destegine-Iliskin-Taahhutname.pdf) ·
[UETS Mesaj Merkezi](https://ptt.etebligat.gov.tr/)

**İçtihat kaynakları:** [UYAP Emsal Karar](https://emsal.uyap.gov.tr/) ·
[Yargıtay Karar Arama](https://karararama.yargitay.gov.tr/) ·
[Danıştay Karar Arama](https://karararama.danistay.gov.tr/)

**Hukuki hesaplama referansları:**
[İşçilik alacakları hesaplama](https://topaktas.av.tr/iscilik-alacaklari-hesaplama-araci-kidem-ihbar/) ·
[Kıdem tazminatı faiz](https://hukukcularevi.com/kidem-tazminati-faiz-hesaplama-mevduat-faizi-2026/)
