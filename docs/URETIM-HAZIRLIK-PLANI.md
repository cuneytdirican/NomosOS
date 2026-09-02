# NomosOS — Uçtan Uca Üretim Hazırlık Planı

> **Tarih:** 2 Eylül 2026 07:30
> **Yöntem:** Her madde dosya:satır kanıtıyla doğrulanmıştır; tahmin yoktur.
> **Kapsam:** Tüm 66 İYİLEŞTİRME maddesi + dikey dilim izleme + dış bağımlılıklar + üretim kapısı

---

## Mevcut Durum (doğrulanmış)

| Metrik | Değer | Kaynak |
|---|---|---|
| HEAD | `1a2830a` = `origin/main` | `git log` |
| Çalışma ağacı | Temiz | `git status` |
| Migration | 26 | `Get-ChildItem migrations` |
| Docker | 7/7 healthy | `docker compose ps` |
| Test | 1014 (api 662 · legal-core 90 · legal-ai 76 · web 70 · udf 44 · e-signature 37 · uyap 35) | Her paketten |
| Build/Tip/Lint | 12/12 · 20/20 · 0/0 | `pnpm build/typecheck/lint` |
| KRİTİK/ÖNEMLİ | 2/2 + 40/40 kapatıldı | Denetim raporu + commit'ler |
| Rakip farkları | 7/7 teslim | Her biri canlı kanıtlı |
| İYİLEŞTİRME | 13/66 kapatıldı | Aşağıdaki doğrulama |

### İYİLEŞTİRME doğrulama tablosu (kod kanıtıyla)

| # | Durum | Kanıt |
|---|---|---|
| İ-02 | ✅ KAPALI | `platform-auth.service.ts:639` — `updateMany` koşullu yazım |
| İ-03 | ✅ KAPALI | `platform-audit-query.service.ts` — formül enjeksiyon koruması |
| İ-04 | ✅ KAPALI | `counter-store.ts` — `scanStream` ile önekli silme |
| İ-14 | ✅ KAPALI | `ai.service.ts:291` — `assertRole(user, ROLE_SETS.ONAY, ...)` |
| İ-18(inbound) | ✅ KAPALI | `inbound.service.ts` — `VALID_MATCH_STATUSES` doğrulama |
| İ-20 | ✅ KAPALI | `iletisim/page.tsx` — PII onayla ve tekrar dene akışı |
| İ-25 | ✅ KAPALI | Üç sekme ekranına `tabPanelProps` bağlandı |
| İ-26(kontrast) | ✅ KAPALI | `layout.tsx` — koyu zeminde `slate-300` |
| İ-29/30 | ✅ KAPALI | Pazarlama + docs/08 senkron |
| İ-55 | ✅ KAPALI | `middleware.ts` + proxy çerez mekanizması |

---

## DALGA 1 — Güvenlik + Veri Bütünlüğü (P0) — 11 madde

| # | Dosya | Sorun | Düzeltme | Efor |
|---|---|---|---|---|
| İ-01 | `platform-auth.service.ts:606` | Hesap kilidi hata penceresi yok — hatalar süresiz birikir | `failureWindowEndsAt` kontrolü ekle (kiracı tarafındaki `account-lockout.ts` desenini uygula) | S |
| İ-05 | `users.service.ts:69` | Atama listesi 500'de sessiz kesilir | Sayfalama zarfı ekle (K-15 deseni) | S |
| İ-06 | `platform-serialize.ts:83` | Takma ad 16 bit rastgelelik | 32 byte crypto random kullan | S |
| İ-08 | `evidence.service.ts:244` | offeredBy sonradan BİZ yapılınca mevcut CONTRADICTS bağları doğrulanmıyor | updateEvidence'ta offeredBy değişince bağlı CONTRADICTS kayıtlarını kontrol et | S |
| İ-09 | `expert.service.ts:473` | İtiraz petitionId varlık/kiracı doğrulamasız | `findFirst({ where: { id, tenantId } })` ekle | S |
| İ-10 | `cases.dto.ts:29` | closedAt status'tan bağımsız PATCH'le yazılabilir | Zod refine: closedAt yalnızca status=KAPANDI'da yazılabilir | S |
| İ-16 | `documents.service.ts:574` | Belge fiziksel siliniyor — hukuki saklama ile çelişir | Soft-delete: `deletedAt` + `deletedBy` kolonları; liste sorgularında `where: { deletedAt: null }` | M |
| İ-26(şema) | `schema.prisma:66` | `User.email @unique` — küresel tekil; PortalUser kiracı-uzaylı değil | `@@unique([tenantId, email])` yap; migration + tüm sorguları güncelle | L |
| İ-46 | `lib/api.ts` | JWT localStorage'da — XSS ile çalınabilir | httpOnly cookie'a geçiş (API tarafında çerez set + client tarafında okuma) | L |
| İ-64 | `package.json` | `pdf-parse ^1.1.1` bakımsız | `pdf2json` veya `unpdf` değerlendir | M |
| İ-65 | `docker-compose.test.yml:41` | MinIO `latest` — yeniden üretilemez | Sabit sürüm etiketi (ör. `minio/minio:RELEASE.2025-...`) | S |

## DALGA 2 — Fonksiyonel Doğruluk (P1) — 14 madde

| # | Dosya | Sorun | Düzeltme | Efor |
|---|---|---|---|---|
| İ-11 | `retrieval.service.ts:175` | Anahtar kelime yedeği orderBy'suz take:400 | `orderBy: { createdAt: "desc" }` ekle | S |
| İ-12 | `risk-nightly.service.ts:275` | Dashboard fotoğrafı override bantlarını yok sayar | Override'ları dahil et (okuma anında uygulanır) | S |
| İ-13 | `assistant-llm.service.ts:331` | Guard reddinde kredi bağlamı discard edilmiyor | catch bloğunda kredi discard çağır | S |
| İ-17 | `durusma-takvimi.report.ts:72` | Görünmez 2000 tavanı | `takeWithProbe` kullan; kırpıldıysa bildir | S |
| İ-19 | `enforcement-deadlines.service.ts:75,230` | "Bugün" UTC — TR takvim günü değil | `trCalendarDay(new Date())` kullan | S |
| İ-21 | `communication.service.ts:483` | unanswered() N+1 sorgu | Tek aggregate sorgu ile çözümle | M |
| İ-22 | `schema.prisma:2983` | matchConfidence bayat yorum (0,85 → 0,80) | Yorumu güncelle | S |
| İ-23 | `balance.service.ts:13` | Başlık mahsup sırası vekâlet ücretini atlıyor | Mahsup sırasına vekâlet ücreti ekle | S |
| İ-24 | `enforcement.service.ts:1293` | sameDay "gün" diyor ama ms eşitliği | `startOfDay` karşılaştır | S |
| İ-27 | `inbound.service.ts:55` | Müvekkil taraması 5000'de sıralamasız | `orderBy` ekle + truncate bildirimi | S |
| İ-28 | `clients.service.ts:228` | /clients/:id/contacts sayfalama zarfı yok | `{ items, total, page, limit }` döndür | S |
| İ-30 | `invoices.service.ts:905` | serialize paidTotal para birimi süzmez | Para birimi filtresi ekle (Ö-14 ile aynı) | S |
| İ-31 | `invoices.service.ts:780` | TASLAK kontrolü mükellef sorgusundan sonra | TASLAK/IPTAL kontrolünü mükellef sorgusundan ÖNCE yap | S |
| İ-33 | `time-entries.service.ts:95` | summary sınırsız satır okur | `take: 1000` + truncate bildirimi | S |

## DALGA 3 — UX + Arayüz (P2) — 15 madde

| # | Dosya | Sorun | Düzeltme | Efor |
|---|---|---|---|---|
| İ-32 | `invoices.service.ts:827` | BEKLIYOR mutabakat yolu yok | `getStatus()` çağrısı ekle | M |
| İ-34 | `invoices.service.ts:77` | eInvoiceStatus filtre alanı ölü | Filtreyi where'e ekle veya kaldır | S |
| İ-35 | `finance-access.ts:28` | TIME_WRITE yorum davranışla çelişiyor | Yorumu düzelt | S |
| İ-36 | `platform-credits.service.ts:101` | Platform kredi listesi 500/1000'de sessiz kesilir | Sayfalama + truncate bildirimi | S |
| İ-37 | `finance-summary.service.ts:129` | Tahsilat riski yalnız primary para biriminden | Multi-currency toplama | M |
| İ-38 | `ayarlar/ai-saglayici/page.tsx:95` | 403 ayrımı yok | Rol kartı ekle (ai-kullanim deseni) | S |
| İ-39 | `raporlar/[key]/page.tsx:330` | Eski uç adı | Güncel sözleşmeye uygun uç adı göster | S |
| İ-40 | `iletisim/page.tsx:460` | Bayat eşik yorumu | 0,80/0,85 olarak güncelle | S |
| İ-41 | `ayarlar/ai-kullanim/page.tsx:615` | AgentRunRow token alanları render edilmiyor | Token sütunlarını render et | S |
| İ-42 | `ayarlar/ai-saglayici/page.tsx:273` | İç gezinme düz `<a>` | `next/link` kullan | S |
| İ-43 | `muvekkiller/page.tsx:192` | Satır onClick — klavye erişimi yok | `<Link>` ile sarmala | S |
| İ-45 | `muvekkiller/[id]/page.tsx:67` | İki benzer "Sözleşmeler" sekmesi | Sekmeleri birleştir veya ayır | S |
| İ-47 | `lib/api.ts:147` | 403'e özel mesaj yok | "Yetkiniz yok" mesajı ekle | S |
| İ-49 | `giris/page.tsx:45` | Kilit durumuna özel ileti yok | "Hesabınız kilitlendi" mesajı ekle | S |
| İ-50 | `documents-tab.tsx:8` | Baylık başlık yorumu | Güncel uç adını yaz | S |

## DALGA 4 — Kalite + Altyapı (P3) — 13 madde

| # | Dosya | Sorun | Düzeltme | Efor |
|---|---|---|---|---|
| İ-07 | `account-lockout.test.ts:23` | K-03 testi üretim eşikleriyle eşleşmiyor | Eşikleri production değerleriyle senkronize et | S |
| İ-44 | `save-report-modal.tsx:42` | defaultName open'da senkronlanmıyor | useEffect ile sync et | S |
| İ-48 | `giris/page.tsx` / `demo-giris` | Demo kimlik bilgileri üretimde görünür | `NEXT_PUBLIC_DISABLE_DEMO` zaten var; prod build'de doğrula | S |
| İ-51 | `deadline-wizard.tsx:107` | Tür eşleşmesi yoksa sessizce TÜM kurallar | "Tümü" etiketi göster veya filtre uygula | S |
| İ-52 | `lib/credits.ts:144` | fetchWallet tüm hataları "uç yok" sayar | Hata tipine göre ayır (404 vs 500 vs ağ) | S |
| İ-53 | `demo-talebi/route.ts:43` | Doğrulama hataları da sayaca girer | Doğrulama hatasını hız sınırından muaf tut | S |
| İ-54 | `content.ts:633` | Demo gündemi UYAP'ı kurulmuş gibi anlatıyor | "Yol haritasında" olarak değiştir (zaten yapıldı — doğrula) | S |
| İ-56 | `portal/dosyalarim/[id]/page.tsx:83` | 404 "geçici arıza" gibi gösterilir | "Yayın kaldırılmış" mesajı | S |
| İ-57 | `mobile/gorevler.tsx:38` | Gerekçe zorunluluğu istemci sabiti | Sunucu şemasından al | S |
| İ-58 | `admin/onaylar/page.tsx:171` | Onay rozetleri tutarsız | Abonelik ekranıyla senkronize et | S |
| İ-59 | `admin/denetim/page.tsx:201` | CSV istemci tarafında | Sunucu `POST /audit/export` ucunu bağla | M |
| İ-60 | `api-route-catalog.test.ts:36` | Sözleşme testi HTTP metodunu doğrulamıyor | Metot eşleşmesi ekle | S |
| İ-61 | `uyap/manifest.json:35` | `all_frames: true` gereksiz | `false` yap | S |

## DALGA 5 — Mimari + Test Kalitesi (P4) — 3 madde

| # | Dosya | Sorun | Düzeltme | Efor |
|---|---|---|---|---|
| İ-62 | `agent-catalog.ts` | Katalog ↔ AI_TASK_TYPES birebirliği test yok | Her görev tipinin bir ajanı olduğunu testle | S |
| İ-63 | `schemas.ts:38` | Zod mesajları iki dilde karışık | Tümünü Türkçe yap | S |
| İ-66 | `ci.yml:134` | Lint uyarı tavanı yok | `--max-warnings 0` ekle | S |

---

## DIŞ BAĞIMLILIKLAR (kod tarafında yapılabilecekler)

| Bağımlılık | Kod Tarafı | Sözleşme Gerekli |
|---|---|---|
| Sanal POS | ✅ `OdemeSaglayici` soyutlaması + SIMULASYON modu | İyzico/PayTR sözleşmesi |
| e-Fatura GİB | ✅ `EInvoiceService` + Noop adaptör | Entegratör sözleşmesi |
| SMS | ✅ Kanal şemada tanımlı | NetGSM/Turatel sözleşmesi |
| UYAP ABS | ✅ Eklenti istemcisi hazır | UYAP ABS ortaklığı |
| UETS PTT | Planlı (A3a) | PTT yazılı görüş |
| İçtihat veritabanı | ✅ local-db adapter | Veri sağlayıcı sözleşmesi |
| OCR | Karar verildi (tesseract.js) | Geliştirme ikinci kesit |

---

## TEST + DOĞRULAMA PLANI

### E2E Senaryolar (canlı Docker üzerinde)

| # | Senaryo | Adımlar |
|---|---|---|
| 1 | Giriş + 2FA | Login → 2FA verify → panel erişimi |
| 2 | Müvekkil CRUD | Oluştur → listele → detay → düzenle → KVKK export |
| 3 | Dosya yaşam döngüsü | Oluştur → durum değiştir → belge yükle → AI önerisi → onay |
| 4 | Süre hesabı | Tebliğ tarihi gir → kural seç → hesapla → iz görüntüle |
| 5 | Fatura + e-Fatura | Oluştur → kesinleştir → gönderim (Noop 503) |
| 6 | Ödeme bağlantısı | Üret → portalda öde → fatura kapansın → ikinci deneme 409 |
| 7 | Randevu | Büro oluştur → portal self-servis → çakışma 409 → iptal |
| 8 | Vekalet ücreti | Tarife gir → hesapla → iz görüntüle |
| 9 | Delil matrisi | İddia oluştur → delil bağla (yön + taraf) → KK6 422 test |
| 10 | İcra | Dosya aç → aşama geçişi → tahsilat → bakiye |
| 11 | İletişim | Mesaj taslağı → AI önerisi → onay → gönderim |
| 12 | Portal | Giriş → dosyalarım → belgelerim → randevu → ödeme → mesaj |

### Performans Testi
- 1000 müvekkil seed → liste sorgu < 200ms
- 10000 dosya seed → dashboard yükleme < 2s
- 100 belge toplu yükleme → kuyruk < 60s

### Güvenlik Testi
- Cross-tenant IDOR (kiracı A → kiracı B her entity)
- Yetki matrisi (her rol × her uç)
- Injection (SQL, NoSQL, XSS, path traversal)
- SSRF (URL doğrulama)
- Dosya yükleme (MIME, boyut, içerik)

---

## ÜRETİM KAPISI

```
[ ] Tüm İYİLEŞTİRME maddeleri kapatıldı (66/66)
[ ] Build 12/12 ✓
[ ] Typecheck 20/20 ✓
[ ] Lint 0 hata / 0 uyarı ✓
[ ] Testler 100% geçiyor
[ ] E2E senaryoları 12/12 geçiyor
[ ] Performans testi geçiyor
[ ] Sızma testi yapıldı
[ ] Yedekleme/geri yükleme test edildi
[ ] Dış bağımlılıklar sözüşldü VEYA açıkça belgelendi
[ ] FINAL-COMPLETION-REPORT.md PRODUCTION READY diyor
```

---

## Önerilen Yürütme Sırası

1. **Dalga 1** (güvenlik): İ-01, İ-05, İ-06, İ-08, İ-09, İ-10 (hepsi S — tek dalga)
2. **Dalga 1 devam**: İ-16 (M), İ-65 (S), İ-64 (M) — şema değişikliği gerektirenler
3. **Dalga 2** (doğruluk): 14 S-madde — tek dalga
4. **Dalga 3** (UX): 15 S-madde — iki alt dalga
5. **Dalga 4** (kalite): 13 madde
6. **Dalga 5** (mimari): 3 madde
7. **İ-26 + İ-46** (L): Mimari değişiklikler — ayrı tur (User.email + JWT cookie)
8. **E2E test matrisi**: 12 senaryoyu otomatikleştir
9. **Performans testi**: Seed + ölçüm
10. **Final denetim + rapor**
