# Açılış Öncesi Hazır Veri Havuzu Planı ("avukat boş sistemle karşılaşmasın")

> Hedef: büro sisteme girdiğinde sorgulama/danışma/belge üretimi İLK GÜNDEN
> veriyle çalışsın. Büro kendi verisini ekleyebilir (bunda sakınca yok) ama
> ZORUNLU OLMASIN. Mevcut durum + eksikler + yapılacak iş bu planda.

## Mevcut durum (kod tarafı)

| Havuz | Durum | Açılış için yeterli mi |
|---|---|---|
| İçtihat havuzu (`CaseLawDocument` ortak havuz + `/caselaw-pool/import`) | Altyapı hazır; testte 3 DEMO kayıt | ❌ VERİ YOK — en kritik boşluk |
| Mevzuat (`Legislation`) | **TENANT-scoped** — her büro kendi giriyor | ❌ Hem veri yok hem mimari platform havuzuna izin vermiyor |
| Vekalet tarifesi (`VekaletTarife`) | "büro tarafından girilir" (yıllık AAÜT) | ❌ Yeni büro hesap aracını boş görür ("tarife girilmemiş" 404 durumu) |
| Yargı/noter/vergi kataloğu | Temsili seed + sync mekanizması var | ❌ Tam liste değil (81 il, tüm daireler) |
| Tatil/adli tatil (legal-core holidays) | 2026+2027 dolu; dini günler "yaklaşık" işaretli | ⚠️ 2028+ yok; dini günler teyit istiyor |
| Dilekçe şablonları (`SYSTEM_PETITION_TEMPLATES`) | Sistem şablon seti seed'de | ✅ Yeterli (sayısı ürün kararı) |
| Süre kuralları (30 kural) + hesap motoru | Dolu, altın değer testli | ✅ |
| Yargı/noter/vergi **senkron** kaynağı | Ayarlanabilir dış senkron var | ⚠️ Kaynak sözleşmesi yok |

## AŞAMA 1 — Platform mevzuat havuzu (KOD — 1-2 gün)

`Legislation` tenant-scoped. Açılışta her büroya 300 kanunu tek tek girdirmek
satılır bir şey değil.

Yapılacak:
1. Şema: `Legislation.tenantId` → nullable + `source` alanı
   (`PLATFORM` | `BURE`). `tenantId = null` kayıtlar TÜM kiracılara görünür
   (aynı desen `CaseLawDocument.createdByTenantId null|tenant` ile).
2. API: `GET /legislation` birleşik sorgular (önce büro kaydı, sonra platform);
   `POST/PATCH/DELETE` platform kayıtlarına yalnız platform rolü (admin uçları
   `judicial` desenindeki gibi ADMIN_ROUTE_PREFIX altına).
3. Arama/danışma bağlamı (`CaseContextBuilder`) mevzuat havuzunu okur hale
   getirilir.
4. Migration + seed uyumu (mevcut büro kayıtları `BURE` olarak işaretlenir).

## AŞAMA 2 — AAÜT tarifesini platform beslemesi (KOD — yarım gün)

1. `VekaletTarife` için platform varsayılanı: büro kendi tarifesini girmediyse
   sistem O YILIN resmî tarifesini kullanır (kaynak: Resmî Gazete; tarife
   motoru `packages/legal-core/vekalet-ucreti.ts` zaten veri odurlu).
2. "Tarife girilmemiş" 404 durumu yalnız tarife gerçekten yoksa kalır.
3. Yıllık yenileme: `subscription-renewal` deseniyle yıl başı kontrolü yapan
   küçük bir zamanlanmış iş + platform panelinde uyarı.

## AŞAMA 3 — Tam yargı/noter/vergi kataloğu (VERİ + KOD)

1. Kaynak: resmî yayınlar (adalet.gov.tr mahkeme listeleri, GİB vergi dairesi
   listesi, noterler birliği). Tek seferlik YAML/CSV → mevcut `/judicial/sync`
   içe aktarma hattı.
2. `TRUSTED` kaynak işareti + `isApproximate` benzeri dürüstlük alanı.
3. Kabul testi: 81 il için il bazında sıfır "listede yok" durumu; formlardaki
   "listede yok → serbest metin" kaçamağı yine de kalır (kasıtlı).

## AŞAMA 4 — İçtihat havuzu doldurma (VERİ — en büyük iş)

1. Kaynak: Yargıtay/Danıştay/Bölge Adliye Mahkemeleri RESMÎ KARAR YAYINLARI
   (kararlar.yargitay.gov.tr vb.). UYAP kazıması DEĞİL — resmî yayın;
   KVKK için kararların kişi bilgileri girişte maskelenir (maskeleme kuralı
   içe aktarma şemasına eklenir).
2. Hacim hedefi (aşamalı): ilk sürüm ~10.000 künye+özet (en sık daireler);
   sürüm 2 ~50.000 + tam metin.
3. İçe aktarma: mevcut `/caselaw-pool/import` (künye doğrulaması, mükerrer
   koruması) toplu parti yükleme için yeterli; partiler denetim izine yazılır.
4. Kalite ölçütü: her kayıtta `esas/karar/daire/tarih` tam künye (adaptör
   teyidi bu künyeyle çalışıyor) — künyesiz kayıt zaten reddediliyor.
5. "Kaynak kırılımı" istatistiği admin panelde görünür kalır (SEED_DEMO/RESMI).

## AŞAMA 5 — Tatil takvimi ve dini gün teyidi (VERİ — yarım gün)

1. 2028 (ve mümkünse 2029) resmî tatil listesi `legal-core/holidays.ts`'e.
2. Yaklaşık işaretli dini günler için Resmî Gazete teyidi; teyit edilenlerin
   `isApproximate` bayrağı düşürülür.
3. `deadline-engine.test.ts` altın değerleri yeni takvimle genişletilir.

## AŞAMA 6 — Güncel kalma operasyonu (ZAMANLANMIŞ İŞ)

Veri bir kere girilince bayatlar; açılış sonrası:
1. `mevzuat-gunluk` işi: resmî kaynak fark kontrolü (Resmî Gazete) → platform
   mevzuatına sürüm notuyla değişiklik (dokunulmazlık: eski sürüm kalır,
   `versionNote` zorunluluğu korunur).
2. `ictihat-haftalik` işi: yeni kararların havuza akışı (ön inceleme kuyruğu,
   otomatik yayın DEĞİL — platform onayı).
3. Yıl başı işi: AAÜT tarife + dava harç parametreleri yenileme uyarısı.

## Hukuki çerçeve (niyet mektubu)

- Tüm kaynaklar RESMÎ YAYINLAR (mevzuat.gov.tr, kararlar.yargitay.gov.tr,
  Resmî Gazete, adalet.gov.tr, GİB). UYAP iç içeriği toplanmaz/ezilmez.
- Karar metinlerindeki kişi bilgileri içe aktarımda maskelenir (maskelenmeyen
  parti reddedilir) — portal/maskeleme altyapısındaki desen.
- Platform havuzu kaynakları `source` alanıyla işaretlenir; "veri nereden
  geldi" her kayıtta görünürdür (içtihat havuzundaki Kaynak kırılımı gibi).

## Sıra ve efor

| Aşama | Tür | Efor |
|---|---|---|
| 1 Platform mevzuat havuzu (kod) | geliştirme | 1-2 gün |
| 2 AAÜT platform tarifesi (kod) | geliştirme | yarım gün |
| 3 Yargı/noter/vergi tam katalog (kod+veri) | karma | 1 gün |
| 4 İçtihat havuzu (veri) | veri operasyonu | 1-2 hafta (araçlı) |
| 5 Tatil 2028+ (veri) | veri | yarım gün |
| 6 Güncelleme işleri (kod) | geliştirme | 1-2 gün |

Önerilen yayınlama sırası: 1 → 2 → 5 → 3 → 4 (ilk parti) → 6 → 4 (ikinci
parti). Aşama 1-3 bitmeden pazarlama "hazır veriyle" vaadi verilmemeli.
