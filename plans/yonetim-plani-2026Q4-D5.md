# NomosOS — Dalga 5: Platform Yönetimi ve Ölçekleme Planı (2026Q4-D5)

Tarih: 2026-09-02 · Durum: 5-A KISMEN TAMAM (M2+M3 bitti; panel envanteri düzeltildi)

## 0. Mevcut durum (kanıtlı envanter — 02.09.2026)

**Platform API katmanı ZENGİN, web katmanı YOK.** Kod tarandı; bulgular:

| Alan | API | Web UI | Kanıt |
|---|---|---|---|
| Kiracı listeleme/detay/askı/etkinleştirme/silme (KVKK tasfiyesi) | VAR | **YOK** | `platform/tenants/platform-tenants.controller.ts` (9 uç) |
| **Kiracı AÇMA (POST /tenants)** | **YOK** | YOK | denetleyicide kayıtsız `@Post()` yok — kiracı ancak seed ile açılıyor |
| Abonelik/plan değişimi, iptal, geçiş | VAR (3 uç) | **YOK** | `platform-subscriptions.controller.ts` |
| Ödemeler (PaymentRecord) | VAR | **YOK** | `platform/payments/` |
| Platform kullanıcıları + izin matrisi (dört göz) | VAR (4 uç) | **YOK** | `platform/users/`, `platform-permissions.ts` |
| Onaylar (PlatformApprovalRequest, dört göz) | VAR | **YOK** | `platform/approvals/` |
| Sistem ayarları + bakım kilidi + SystemSetting | VAR | **YOK** | `platform/system/` |
| Özellik bayrakları, duyurular, UsageSnapshot, demo talepleri | VAR (modeller) | **YOK** | FeatureFlag, Announcement, DemoRequest |
| Denetim izi (PlatformAuditLog), destek erişimi | VAR | **YOK** | `platform/audit/`, `platform/support/` |
| Metrik/DB sağlığı (db_up, /metrics) | VAR | **YOK** (Prometheus dışında) | `metrics/`, `platform-health.service.ts` |
| Kredi cüzdanları/paketler/model fiyatları | VAR | **YOK** | `credits/platform-credits.*` |
| AI eğitim verisi (onayla/ret + JSONL) | VAR | YOK (platform tarafı) | `ai-training/` (C3) |
| AI sağlayıcı kurulumu (PlatformAiProvider) | VAR | Kiracı ayarları var; **platform yönü YOK** | `ayarlar/ai-saglayici` |

**Sonuç:** Sistem yöneticisi bugün ürünü yalnızca `curl` ile yönetiyor. Bu planın amacı
yönetimin tamamını panele taşımak ve eksik uçları (kiracı açma başta) kapatmak.

**ÖNEMLİ DÜZELTME (02.09.2026, uygulama sırasında):** Panel `apps/web` altında
değil, ayrı `apps/admin` uygulamasıdır (port 3002, `/api/admin/v1`) — kiracılar,
abonelikler, ödemeler, onaylar, sistem+bakım kilidi, denetim, krediler,
yöneticiler, demo talepleri, AI sağlayıcılar sayfaları ZATEN VARDI. M1'in
"14 sayfa" kısmı hatalı envanterden geliyordu; gerçek eksikler M2+M3'tü.

## 1.5 Uygulananlar (02.09.2026 — commit geçmişine işlendi)

- **M2 TAMAM:** `POST /api/admin/v1/tenants` — dört-göz TENANT_CREATE:
  talep anında bcrypt hash'lenmiş parola, tekil e-posta/ad + AKTİF plan +
  koltuk tavanı doğrulaması; yürütücüde TEK İŞLEMDE tenant + ilk ADMIN
  kullanıcı + 14 gün TRIAL abonelik + denetim izi (yürütme anı yeniden
  doğrulamasıyla). Panel: "Yeni Kiracı" düğmesi + modal (tenantlar sayfası).
  Canlı doğrulandı: talep 201 → kendi talebini onaylama 403 → ikinci imza
  200 → yeni kiracı girişi 200.
- **M3 TAMAM:** Askı/iptal artık GİRİŞİ KESİYOR — auth.login abonelik
  durumunu denetler; SUSPENDED/CANCELED 403 ("büro askıda/abonelik sona
  ermiş"), denetim izine yazılır. Yürütücüdeki "Faz 4'te bağlanacak" borcu
  kapandı. Canlı doğrulandı: askı sonrası giriş 403.
- Matris değişiklikleri: `tenant.create` dört-göz (iki matriste de — ikiz
  değişmezi testli); büro adı düzeltmesi yeni `tenant.update` eylemine
  taşındı (katalog taraması onay beyanı zorunlu kıldı).
- **M6 (UYAP) TAMAM:** Eşleşme çözümü sonrası otomatik yeniden senkron —
  `resolveMatch` artık eşleşme anında `caseId: null` bekleyen sahnelenmiş
  olayları TEK İŞLEMDE dosyaya işliyor (safahat → zaman çizelgesi, duruşma →
  ajanda PLANLANDI) ve `replayed` sayısını döndürüyor; web sayfası sayıyı
  kullanıcıya gösteriyor. Canlı doğrulandı: 3 sahnelenmiş olay → resolve
  200/replayed:3 → timeline +2 safahat + 1 PLANLANDI duruşma ajandada.
- **M4 TAMAM:** Fine-tuning iş yönetimi — FineTuneJob modeli + migration
  20260903090000; iş açılışı ONAYLANMIŞ havuzun ANLIK GÖRÜNTÜSÜNÜ alır
  (sayı + görev tipi kırılımı), manifest (JSONL) üretir, şerit denetimli
  durum geçişleri (HAZIRLANDI→GONDERILDI→EGITILIYOR→TAMAMLANDI;
  TAMAMLANDI sonuç model adı ZORUNLU), her adım denetim izine yazılır.
  DÜRÜSTLÜK: sağlayıcıya otomatik gönderim YOKTUR — manifest operatör
  tarafından ELLE yüklenir (kodda ve panelde yazılı). Panel: /egitim
  sayfası (havuz kartları, iş tablosu, manifest indirme, geçiş düğmeleri).
  Canlı doğrulandı: boş havuz 400 → 3 onaylı örnekle iş 201 (anlık görüntü
  3) → manifest 3 satır JSONL → şerit dışı 400 → geçiş zinciri 200 →
  TAMAMLANDI'sız 400 → model adıyla 200 → terminal durumda manifest/geçiş 400.
- **M5 DEĞERLENDİRİLDİ (karşılanmış):** Panel özet sayfası /metrics/overview +
  /health + onay kuyruğu uçlarına zaten bağlı; ayrı pano sayfası gerekmez.
- **Cila (dilekçe sürüm farkı) TAMAM:** GET /petitions/:id/versions/:versionNo
  (eski sürüm salt-okunur) + GET /petitions/:id/versions/diff?from=&to= —
  sunucuda LCS satır farkı + anahtar eşleşmeli bölüm farkı (diffLines/
  diffSections/summarizeDiff, 11 birim testi); web dilekçe detayında sürüm
  seçimi + renkli fark çizimi (eklenen yeşil / çıkarılan kırmızı).
  Canlı doğrulandı: yeni sürüm 201 → v1 görünümü 200 (5 bölüm) → v1→v2 fark
  200 (1 bölüm değişti, +3 satır) → olmayan sürüm 404, geçersiz parametre 400.

## 1. Eksikler (öncelik sırasıyla)

### M1. Yönetim paneli UI'si YOK — P0, yüksek
On dört platform API alanının hiçbirinin web arayüzü yok. Kabul: platform SUPER_ADMIN'i
panelden kiracıyı açabilir/askıya alabilir/plan değiştirebilir/ödemeleri görebilir/
duyuru geçebilir/bakım kilidi atabilir — tek curl komutu gerekmeden.

### M2. Kiracı AÇMA ucu YOK — P0, yüksek
`POST /platform/tenants` yok; askı/etkinleştir/silme var. Dört göz onayı ile kiracı
açma (name + ilk ADMIN kullanıcısı + plan) eklenmeli. Kabul: panelden kiracı açılır,
onay sürecinden geçer, ilk yönetici davet bağlantısı üretilir.

### M3. Kiracı KAPATMA akışı — P0 (uç VAR, süreç eksik)
Purge ucu var (tenant-purge-order KVKK sıralaması testli) ama "kapatma" (veriyi
koruyarak sözleşme sonu) ile "silme" ayrımı yok; Subscription iptali + veri saklama
süresi (KVKK m.138 / VUK) politikası tanımlı değil. Kabul: kapatılan kiracı salt-okunur
arşiv durumuna düşer, saklama süresi dolunca tasfiye emri gerekir.

### M4. Eğitim (fine-tuning) iş yönetimi YOK — P1
C3 örnek topluyor (onaylı JSONL dışa aktarım VAR) ama sağlayıcıya iş gönderme/durum
izleme/model kaydetme yok. Kabul: panelden onaylı örnek havuzundan iş açılır, sağlayıcı
durumu izlenir, çıkan model AiTaskRoute'a bağlanabilir.

### M5. Ölçekleme borcu — P2 (bilinçli ertelenmiş)
SSE tek örnek (Redis pub/sub yok), pgvector yok, TURN yok. replicas>1'de engel;
panel bunları DURUM SAYFASI olarak göstermeli (sürprayz değil bilinçli sınır).

### M6. Tamamlanmış görünen modüllerdeki cila eksikleri — P2 (taşınan)
UYAP eşleşme sonrası otomatik yeniden senkron; dilekçe sürüm fark görünümü; portal
bildirim e-postası (SMTP Noop); mobil ajanda/mesajlar ekranları.

## 2. Yol haritası (kabul kriterleriyle)

**DALGA 5-A — P0 "Yönetim paneli" (≈2 hafta)**
1. Kiracı açma ucu + onay akışı (M2): `POST /platform/tenants` (dört göz),
   ilk yönetici daveti. Kabul: uçtan uca kiracı açılır, onay damgalanır, denetim izi düşer.
2. Kiracı yaşam döngüsü (M3): kapatma (arşiv) durumu + saklama süresi politikası;
   askı→etkinleştirme panelde tek tık. Kabul: kapalı kiracı girişte 403 + arşiv notu.
3. Panel iskeleti `/yonetim` (M1): platform oturumu, izin matrisine göre menü,
   bakım kilidi üst bildirimi. Kabul: SUPER_ADMIN tam, OPERATOR salt-okunur görür.
4. Panel sayfaları (M1): Kiracılar (+detay: kullanıcılar/kullanım/AI yapılandırma/not),
   Abonelikler/Plan, Ödemeler, Platform Kullanıcıları, Onaylar, Sistem (ayar+bakım
   kilidi+özellik bayrakları+duyurular), Denetim, Metrik/Sağlık, Demo Talepleri,
   Destek Erişimi, Krediler. Kabul: her sayfa mevcut uçlara bağlı, taklit uç yok.

**DALGA 5-B — P1 "Eğitim ve sağlıklı ölçek" (≈2 hafta)**
5. Eğitim iş yönetimi (M4): FineTuneJob modeli + sağlayıcı şemaları + panel sayfası.
6. Sağlık sayfası (M5): /metrics panosu (db_up, iş sayaçları, kredi bakiyeleri),
   tek örnek sınırları görünür kılınır.
7. Cila maddeleri (M6) — UYAP yeniden senkron öncelikli.

**DALGA 5-C — P2 (ölçek kararı sonrası)**
8. Redis pub/sub (SSE çoklu örnek), pgvector, TURN — kiracı/parça sayımı tetikler.

## 3. Bilinçli yapılmayacaklar
- Otomatik yasal süre üretimi (İİK koşullu hükümler) — süreler kural motorundan kurulur.
- RG mevzuat senkronu — vaat kısıtı (A4'te belgeli).
- Üretim e-imza — e-imza modülü geliştirme ortamıyla sınırlı.
