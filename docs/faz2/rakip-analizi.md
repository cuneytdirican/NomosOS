# NomosOS Rakip Analizi — Türkiye Hukuk Bürosu Yazılım Pazarı

> **Tarih:** 1 Eylül 2026 · **Yöntem:** Web araştırması (ürün siteleri satıcı beyanına dayanır; her madde kaynak URL'siyle gelir).
> **Amaç:** Türkiye'deki avukat yazılımlarında OLUP NomosOS'ta OLMAYAN özellikleri tespit etmek ve F2 planına bağlamak.

## 1. Okunan kaynaklar

| Satıcı/Ürün | URL | Odak |
|---|---|---|
| Hansoft | hansoftyazilim.com/hukuk-yonetim | Masaüstü, icra+UYAP-derin, AI |
| Avukat Bulut / Evobulut | avukatbulut.com, evobulut.com/hukuk-programi | Bulut, muhasebe, arabuluculuk |
| Lexmira | lexmira.com.tr/hukuk-burosu-yazilimi | Bulut+AI, UYAP dosya çekme, müvekkil portalı |
| Hukuk Bulutu | hukukbulutu.com.tr | Bulut hafif, Google Drive, iyzico |
| DavaCep | davacep.com | Bulut, 17 modül, randevu portalı, 50.000 şablon |
| Hukuk Bilgi Sistemi | hukukbilgisistemi.com/buro-yazilimi | SaaS, AAÜT vekalet ücreti, performans |
| Rod Responsa | rodresponsa.com | AI çalışma alanı, 10,7M kararda arama |
| Lexpera | lexpera.com.tr | Araştırma veritabanı (~5M karar), LEXI AI |
| Kanunum | kanunum.com | Mevzuat izleme (atıf bazlı) |
| Sinerji | sinerjias.com.tr | Mevzuat+içtihat+dava takip+icra, 3 kanal |
| Corpus | corpus.com.tr | İçtihat (AİHM dahil), sözlük, şablonlar |
| mevzuat.gov.tr / mevzuat.adalet.gov.tr | — | Resmi sistemler |

**Erişilemeyen / doğrulanamayan:** hukukturkiye.com (transport error) · avukatportal.com (transport error) · AjandaX (JS; yalnız arama snippet'i: "UYAP uyumlu, otomatik tebligat takibi ve süre hesaplama") · e-avukat.com (boş yanıt).
**Düzeltme kaydı:** Araştırma öncesi listemizde adı geçen "Lawaia" adlı rakip **mevcut değil** — lawaia.com en az 2011'den beri park edilmiş alan adı; Türkçe web'de bu adda hukuk yazılımı izi yok. Listeye yapay zekâ kaynaklı halüsinasyon girmiş olabilir; rakip listeleri doğrulanmadan kullanılmamalı.

## 2. Pazar haritası

İki kamp var: **(a) masaüstü/UYAP-derin** oyuncular (tek temsilci: Hansoft — UYAP'a e-imzalı gönderim, toplu malvarlığı sorgusu, banka cevabı okuma) ve **(b) bulut + AI + muhasebe** platformları (Avukat Bulut, Lexmira, Hukuk Bulutu, DavaCep, Hukuk Bilgi Sistemi, Rod Responsa). Ayrıca saf **araştırma veritabanı** kampı (Lexpera, Kanunum, Sinerji, Corpus). Pazar genelinde **UETS e-Tebligat ve toplu veri taşıma sihirbazı boşluktur** — kimse tam çözmemiş.

## 3. ONLARDA OLUP BİZDE OLMAYANLAR

### 3.1 F2 planında zaten var (önceliği güçlenen kalemler)

| # | Özellik | Kimde var (kaynak beyanı) | NomosOS durumu | F2 yeri |
|---|---|---|---|---|
| 1 | **UYAP'a e-imzalı dilekçe/evrak GÖNDERİMİ** (UYAP Editör + tek e-imza) | Hansoft | Yok — eklenti istemci tarafı yazıldı, arka uç yok | **B4** (pazarda yalnız 1 özel oyuncuda var → farklılaştırıcı fırsat) |
| 2 | **UYAP'tan otomatik dosya/evrak çekme** ("%100 entegrasyon") | Hansoft; Lexmira (dosya+evrak görüntüleme); DavaCep | Yok | **B4** |
| 3 | **e-Tebligat UETS/PTT + tebligat akıbet izleme** | Hansoft (akıbet izleme); AjandaX (iddia, doğrulanamadı) | Yok | **A3a** (PTT süreci başladı; pazarda da boşluk → öncelik) |
| 4 | **Mevzuat/içtihat VERİTABANI** (Rod 10,7M karar; Lexpera ~5M; Sinerji/Corpus; AİHM Corpus'ta) | Rod, Lexpera, Sinerji, Corpus | İçtihat kaynaklarımız yalnız `local-db` + `manual-entry` — dış veritabanı bağlantısı yok | **D1 (benchmark parite)** — veri sağlayıcı sözleşmesi gerekli |
| 5 | Toplu veri taşıma (Excel/Word sihirbazı) | Pazarda da boşluk | Yok | **A1 kalanı** |
| 6 | SMS müvekkil bilgilendirme (GERÇEK gönderim) | Lexmira; Evobulut ekosistemi | Kanal şemada var (EPOSTA/SMS) ama sağlayıcı Noop — gönderim yok | **B6 (iletişim sağlayıcıları)** |

### 3.2 Planda olmayan — yeni epic önerileri

| # | Özellik | Kimde var | NomosOS durumu | Önerilen epic | Boyut |
|---|---|---|---|---|---|
| 7 | **Toplu malvarlığı sorgusu** (MERNİS, tapu, banka, araç, maaş, MERSİS, posta çeki, İSKİ-GİB — "10 tür, tek tuş") | Hansoft (tek rakip) | Malvarlığı KAYDI var; DIŞ SORGU yok | **YENİ: C7 — Malvarlık sorgu köprüsü** (UYAP ABS servisleri üzerinden; tarama/yasal dayanak hukuk metni ile) | L |
| 8 | **Banka haciz cevabı (İİK m.89/1) otomatik okuma + borçlu malvarlığı DEĞİŞİM uyarısı** | Hansoft AI | Belge yüklenir, metin çıkarılır; cevap analizi ve değişim izleme yok | **YENİ: B7 — Haciz cevabı ajanı** (B2 OCR kesitine bağımlı) | M |
| 9 | **e-SMM (Serbest Meslek Makbuzu) düzenleme** | Hansoft, Evobulut | Fatura + e-Fatura altyapısı (Noop) var; **e-SMM yok** — avukatın en sık belgesi | **YENİ: A6 — e-SMM** (mevcut e-Fatura adaptör mimarisini genişletir; GİB e-SMM belge türü) | M |
| 10 | **Vekalet ücreti AAÜT tarife hesaplayıcısı** (maktu/nispi, KDV, tahsilat takibi, CSV) | Hukuk Bilgi Sistemi (modül); Hansoft/Rod (ücretsiz araç) | İcra dosyasında vekalet ücreti hesabı var; genel **AAÜT tarifesiyle** hesap yok | **YENİ: D7 — Vekalet ücreti tarifesı** (legal-core'a kural + tarife yılları verisi; dava değerinden maktu/nispi) | S-M |
| 11 | **Müvekkil online ödemesi** (portal üzerinden kartla tahsilat; iyzico/sanal POS) | Lexmira (portal tahsilat); Hukuk Bulutu (iyzico) | Portal fatura görüntüleme var; ÖDEME yok | **YENİ: E8 — Portal ödeme** (ödeme bağlantısı + webhook → Payment kaydı; fatura mutabakatı) | M |
| 12 | **Online randevu portalı + dijital kartvizit** ("müsaitlik takvimi + online randevu") | DavaCep (tek rakip) | Randevu kavramı yok | **YENİ: E9 — Randevu** (ajanda + müvekkil self-servis; çakışma önleme) | M |
| 13 | **Hazır şablon kütüphanesi** (DavaCep: "50.000+ hukuki şablon"; Sinerji: "binlerce dilekçe/sözleşme") | DavaCep, Sinerji, Corpus | Dilekçe şablon motoru var; içerik kütüphanesi tohum düzeyinde | **YENİ: D8 — Şablon kütüphanesi** (içerik programı; lisanslı tedarik + büro şablonları) | M (içerik) |
| 14 | **Mevzuat değişiklik İZLEME/UYARI sistemi** (Lexpera: RG bülteni + madde izleme + torba kanun takibi + sürüm karşılaştırma; Kanunum: atıf bazlı madde izleme; Lebib Yalkın: anında bildirim) | Lexpera, Kanunum, Sinerji | Yok | **YENİ: D9 — Mevzuat radarı** (D3 madde atıflarına bağlanır: izlenen maddeler + RG/UYAP kaynağı + uyarı) | M |
| 15 | Danışmanlık → Dava dönüşümü (tek tuş) | Avukat Bulut | Aynı dosyada tür değişimi yok | **YENİ: küçük** (case type dönüşümü + safahat taşıma) | S |
| 16 | Özel alanlar (custom fields) müvekkil/dosya kartında | Avukat Bulut | Yok | **YENİ: A7** (şema: tip güvenli 3-5 alan; UI koşullu gösterim) | S |
| 17 | Toplu icra takibi başlatma (XML/UYAP, binlerce dosya) | Hansoft | Yok | B4 sonrası önceliklendirilir | M |
| 18 | Arabuluculuk DERİNLİĞİ (toplantı, sonuç, evrak; ücret tarifesi) | Avukat Bulut (ayrı modül) | `CaseType.ARABULUCULUK` var; süreç derinliği yok | **YENİ: C8** (toplantı tutanağı, anlaşma/belge, arabuluculuk ücret tarifesi) | M |
| 19 | Muhasebeleşme (masraf→kayıt, barokart/harcama karşılaştırması) | Hansoft | Finans kayıtları var; dış muhasebe akışı yok | A6/e-SMM ile birlikte değerlendirilir | S-M |
| 20 | Çoklu şube/büro yönetimi | (Lexmira kurumsal belli belirsiz) | Tek kiracı = tek büro varsayımı | İhtiyaç analizi ile (kurumsal satış ön koşulu olabilir) | ? |

**Bilinçli YAPMAMA kararı (farklılaşmamızın kaynağı):** Google Drive senkronizasyonu (Hukuk Bulutu) — belge içeriği büro dışına üçüncü taraf bulut depolamaya taşınır; NomosOS'un veri egemenliği taahhüdüyle çelişir (KVKK/meslek sırrı). Raporlanır, önerilmez.

## 4. Bizde olup pazarın çoğunda olmayanlar (farklılaştırıcılar — koruma listesi)

1. **Deterministik süre motoru + görünür hesap izi** (29 kural; HMK m.92-104 adli tatil dahil; pazarda yalnız Hukuk Bilgi Sistemi "adli tatil dahil" diyor, iz gösteren yok)
2. **Belge → aksiyon hattı** (sınıflandırma + süre tespiti + onay kuyruğu; pazarda kısmen Hansoft AI)
3. **BYO-LLM veri egemenliği** (kendi anahtar/sunucu; pazarda yok — Lexmira kurumsal sunucu dışında)
4. **İçtihat atıf TEYİT kapısı** (doğrulanmamış atıfla dilekçe "hazır" olmaz; Rod "kaynak atıflı yanıt" veriyor ama teyit kapısı bizde)
5. **KVKK PII maskeleme hattı** (dış sağlayıcıya gitmeden önce maskele+onayla; pazarda yok)
6. **Delil matrisi, risk motoru, strateji/simülasyon, ajan izleri** (pazarda karşılığı yok)
7. **Müvekkil portalı yayın modeli** (Lexmira'da portal var; bizdeki görünürlük modeli daha sıkı)

## 5. Öneri

Yukarıdaki yeni epic'ler (7-20) `docs/faz2/00-yol-haritasi.md`'ya T2+ turuna aday olarak eklenmelidir. Öncelik sırası (değer/efor + stratejik boşluk):
1. **D9 Mevzuat radarı + D1 içtihat veritabanı** — en görünür boşluk (her rakibin çekirdeği)
2. **A6 e-SMM** — avukatın günlük muhasebe ihtiyacı; mimari hazır (e-Fatura adaptörü)
3. **E8 Portal ödemesi** — tahsilat döngüsünü kapatan tek adım
4. **D7 AAÜT vekalet ücreti** — düşük efor, yüksek görünürlük
5. **C7 Malvarlık sorgusu / B7 Haciz cevabı ajanı** — icra-derin rekabet (Hansoft'a karşı); B2 OCR'ya bağımlı
6. **E9 Randevu** — pazarda tek oyuncuda var; kolay fark yaratan yüzey özelliği

*Araştırma sınırları: tüm veriler satıcı sitelerinin beyanıdır; hiçbiri ürünü birebir test edilmemiştir. "Lawaia" adlı rakip doğrulanamamıştır (bkz. §1 düzeltme kaydı).*
