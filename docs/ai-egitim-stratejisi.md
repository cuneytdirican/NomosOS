# NomosOS AI Katmanı — Eğitim Stratejisi: RAG mi, Model Eğitimi mi?

Tarih: 03.09.2026 · Kapsam: `packages/ai`, `packages/legal-ai`, `apps/api/src/ai-training`,
`apps/admin`, `apps/web`, `apps/api/src/caselaw`, `apps/api/src/assistant`

---

## 1. KARAR (Verdict)

**NomosOS'un "Türk hukukuna göre eğitimi" RAG + bilgi havuzu mimarisiyle yapılır; model
ağırlık eğitimi (fine-tuning) YALNIZCA System Admin / Super Admin tarafında, opsiyonel ve
ikincil bir yetenek olarak kalır.**

Gerekçeler (mevcut kod tabanıyla doğrulanmış):

1. **Mimari zaten RAG-öncelikli kurulmuş.**
   - `packages/legal-ai/src/rag/chunker.ts` — örtüşen pencereli parçalama.
   - `packages/ai/src/embeddings.ts` — gömme (Prisma `Float[]`, JS kosinüsü; pgvector'a
     geçiş depolama detayı).
   - `apps/api/src/assistant/indexing.service.ts` + `retrieval.service.ts` — dosya belgeleri
     EMBEDDING/KEYWORD modlu erişim; her çağrı `AiUsageLog`'a düşer.
   - `packages/legal-ai/src/prompts/*` — 14 Türk hukuk görev promptu (system-core:
     "Sen NomosOS hukuk asistanısın. Türk hukuku bağlamında çalışırsın…").
2. **Halüsinasyon savunması RAG + deterministik teyit üzerine kurulu.** İçtihat atıfları
   LLM'e sorulmaz; `citation-verify.service.ts` regex + havuz eşleşmesiyle deterministik
   doğrular. Fine-tune edilmiş bir model bu zinciri GÜÇLENDİRMEZ, ZAYILTIR: model
   "öğrendi" dediği künyeyi uydurma eğilimi gösterir. Bu yüzden model eğitimi bu ürünün
   doğruluk mimarisine ters düşer.
3. **Sağlayıcı-agnostik BYO-LLM sözleşmesi** (`LlmProvider.chat/listModels/testConnection`)
   model eğitimini mimari olarak kapsamaz; tüm sağlayıcılar sohbet/gömme ucu sunar,
   eğitim ucu sunmaz. Eğitim entegrasyonu ancak sağlayıcıya özgü ayrı bir akış olur —
   ki `ai-training` modülü bunu bilinçli olarak SİSTEM DIŞINDA (elle manifest yükleme)
   tutar ("dürüstlük ilkesi", `apps/admin/(panel)/egitim/page.tsx` başlık yorumu).

**Sonuç:** "Sistemi Türk hukukuna göre eğitmek" = (a) ortak içtihat/mevzuat havuzunu
 Süper Admin entegrasyonlarıyla doldurmak, (b) RAG gömme/erişim kalitesini iyileştirmek,
 (c) görev promptlarını Türk hukuk kaynağına bağlam-korumalı güncellemek. Fine-tuning
 (=model eğitimi) sadece admin tarafında izlenen bir iş kaydıdır; son kullanıcının gördüğü
 davranış değişikliği yalnızca RAG havuzu ve promptlar üzerinden gelir.

---

## 2. MEVCUT DURUM ENVANTERİ

### 2.1 Kim neyi yönetiyor (izin haritası — istenen "avukat göremez" kuralı ZATEN doğru)

| Yüzey | Konu | Kim görür | Kaynak |
|---|---|---|---|
| `apps/web /app/ayarlar/ai-saglayici` | BYO-LLM sağlayıcı + anahtar + görev tipi rotası | ADMIN/PARTNER (büro yöneticisi) | K-9, ROLE_SETS.ONAY |
| `apps/web /app/ayarlar/ai-kullanim` | Kredi/kullanım | tüm büro kullanıcıları (salt-okunur tüketim) | Modül 26 |
| `apps/admin (panel)/ai-saglayicilar` | PLATFORM sağlayıcıları (BYO izni olmayan planlar) | yalnız Super Admin (`aiProvider.view/manage`) | D1.3 |
| `apps/admin (panel)/egitim` | Fine-tuning İŞ YÖNETİMİ (manifest, durum şeridi) | yalnız Super Admin (`aiProvider.view`) | D5/M4 |
| `apps/admin (panel)/yargi`, `isler`, `krediler`… | havuz, abonelik, denetim | yalnız Super Admin | panel |

Yani: **avukat/büro son kullanıcı "eğitim" yüzeyini hiçbir yerde göremez**; görebildiği tek
AI yönetim yüzeyi kendi bürosunun BYO-LLM sağlayıcı ayarıdır — bu da ürün gereksinimi
(Gereksinim 20, KVKK/özel AI) gereği bilinçli olarak büro yöneticisine açıktır. Eğitim ve
platform yeteneği Super Admin'e aittir. **Bu ayrım korunmalıdır; aşağıdaki yeni işler de
aynı `aiProvider.*` RBAC eylemiyle admin tarafında kalacaktır.**

### 2.2 Fine-tuning akışı (mevcut, elle)

`POST /admin/fine-tune` işi açar → ONAYLANMIŞ örnek havuzunun anlık görüntüsü → JSONL
manifest indirilir → operatör manifesti sağlayıcı paneline ELLE yükler → durum şeridi
(HAZIRLANDI→GÖNDERİLDİ→EGİTİLİYOR→TAMAMLANDI/BASARISIZ) → sonuç model adı elle girilir.
Otomatik sağlayıcı gönderimi YOKTUR. Bu "dürüstlük ilkesi" korunmalıdır.

### 2.3 İçtihat/mevzuat havuzu (RAG'ın kamusal tarafı)

`CaseLawDocument` ORTAK havuz (tenantId'siz). Adaptörler: `YEREL_HAVUZ`, `MANUEL`,
`SEED_DEMO`(uyarılı). `CaseLawSourceAdapter` arayüzü ile yeni kaynak = yeni sınıf + registry
kaydı, başka hiçbir dosya değişmez. Türkiye'de resmî içtihat API'si olmadığı için havuzun
dolması bugün manuel girişe bağlıdır — **Türk hukuku eğitiminin asıl darboğazı budur.**

---

## 3. TÜRK HUKUKU "EĞİTİM"İ — UYGULAMA PLANI (admin tarafı, fazlı)

### D1 — İçtihat/Mevzuat Havuz Yönetimi (Super Admin) — UYGULANDI

- Uçlar: `apps/api/src/platform/caselaw-pool/` (`GET /admin/v1/caselaw-pool` sağlık,
  `GET …/records` son kayıtlar, `POST …/import` toplu içe aktarım; yetki
  `aiProvider.view/manage`).
- Panel sayfası: `apps/admin/(panel)/yargi/havuz` — havuz istatistikleri, kaynak
  kırılımı, daire ilk-10, son kayıtlar, JSON toplu içe aktarma ve kayıt bazlı sonuç.
- İçerik güvenliği: biçimsiz künye şemada reddedilir; aynı künye büronun MANUEL
  kaydındaysa ATLANIR (ortak havuza yazma ortak değildir); parti içi tekrar reddedilir;
  her parti `CASELAW_POOL_IMPORT` denetim izine düşer. Test: `caselaw-pool.test.ts` (12).

### D2 — Entegrasyon Kaynakları (adaptör adayı)

| Kaynak | Biçim | Entegrasyon şekli |
|---|---|---|
| Karar PDF/Word arşivi (büro anlaşması) | dosya | toplu metin çıkarımı (pipeline/B2) + manuel künye |
| Lexpera/Normyx/Checkup gibi ticari veritabanları | dışa aktarım dosyası | zamanlanmış içe aktarım işi (sözleşmeye bağlı; otomatik çekme YOK) |
| Mevzuat.gov.tr CSV/JSON | dosya | `Statute`/`StatuteArticle` (Faz 3 şeması) dolduran içe aktarıcı |
| Resmî Gazete kutuphane.tbb.gov.tr | HTML/dosya | periyodik indirme işi (scheduler) |

Her kaynak bir `CaseLawSourceAdapter` olur; `SEED_DEMO` dışındaki her kaynak `isDemo:false`
taşır. **Sahte entegrasyon yazılmaz** — kaynak yoksa adaptör de yoktur (Modül 23 ilkesi).

### D3 — RAG kalitesi (platform tarafı)

- Gömme modeli varsayılanı ve parça boyutu yönetilebilir hale gelir (admin, platform
  sağlayıcı gömme yapılandırması).
- Havuz içtihatları da dosya belgeleri gibi gömülür: içtihat araması EMBEDDING moduna
  taşınır (şu an ILIKE) — pgvector geçişi burada değerlendirilir.
- `AiUsageLog`'da kaynak/havuz ayrımı zaten var; admin kullanım panosuna "eğitim havuzu"
  kırılımı eklenir.

### D4 — Prompt/Eşleme sürümü (yönetilen iyileştirme)

- `packages/legal-ai/src/prompts` sürüm numarası + değişiklik günlüğü; görev tipi →
  prompt sürümü admin panosundan görünür.
- A/B yok; değişiklikler sözleşme testleriyle (mevcut `__tests__`) kilitlenir.

### D5 — Fine-tuning (mevcut, değişmez)

Kalır: iş kaydı + manifest + elle yükleme. Yeni tek kural: TAMAMLANDI'da girilen sonuç
model adı yalnızca PLATFORM sağlayıcılarının görev rotalarında seçilebilir hale gelir;
kiracıya sızmaz. Kullanım kredisine yansıyan tüm çağrılar AiUsageLog'da izlenebilir kalır.

---

## 4. YARDIM MERKEZİ ve HEPO

Aynı turda teslim edilen iki kullanıcı-yüzü yetenek (bkz. `docs/moduller/27-yardim-merkezi.md`
ve `docs/moduller/28-hepo-modulu.md`):

- **Yardım Merkezi:** her kullanıcı sayfasında bağlamsal Yardım bağlantısı; modülün
  detaylı özeti, tek tıkla ilgili sayfaya/bölüme gidiş; Yardım Merkezi içinde tam metin
  arama, sonuçdan bölüme atlama.
- **HEPO:** İSG (6331) + Çevre + Sağlık mevzuatı yükümlülük kütüphanesi, yasal süre
  takvimi, idari yaptırım matrisi, dava rehberi — avukatın müşteri şirketlerine verdiği
  uyum hukuku hizmeti için.

## 5. Sonuç

- AI katmanının "aktif kullanımı" şu şekildedir: son kullanıcı AI'ı yalnızca uç olarak
  kullanır (asistan, dilekçe, öneriler, içtihat arama). Model eğitimi ve havuz yönetimi
  Super Admin'in tekelinde kalır; BYO-LLM isteyen bürolar kendi sağlayıcısını kendisi
  bağlar ve kendi anahtarını kendi yönetir.
- Yeni hiçbir yetki ucu avukat rolüne açılmadı; `aiProvider.*` RBAC eylemi admin tarafında
  kalır.
