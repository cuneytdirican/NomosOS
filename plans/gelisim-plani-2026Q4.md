# NomosOS Geliştirme Planı — 2026 Q4

> Dört gözle analiz: avukat, hukuk bürosu sahibi, yazılım mimarı, yazılım geliştirici.
> Her bulgu KOD KANITIYA bağlanmıştır; varsayım yok. "YOK" = şemada/uçta/arayüzde
> doğrulandı. Bu plan, yarım kalan taahhütleri, hukuki derinlik eksiklerini ve
> mimari olgunlaşmayı tek sıraya koyar.

## 0. Mevcut durum (kanıtlı envanter)

**Çalışan yüzey:** 23 UI modülü (dosyalar, dilekçeler, icra, sureler, durusmalar,
randevular, gorevler, oneriler, ictihat, mesajlar, asistan, iletisim, finans,
faturalar, zaman, raporlar, riskli-dosyalar, cakisma, araclar, UYAP eklentisi,
ayarlar×3, muvekkiller, portal, mobil, platform paneli). legal-core: sure motoru
(tatiller dahil) + AAUT vekalet ucreti. AI: 4 yurutme motoru, guard + KVKK +
kredi + tarafsizlik sozlesmeleri (satir-satir audit edildi, bkz.
AI-AUDIT-RAPORU.md). UYAP koprusu uctan uca (eklenti + 7 uclu arka uc + kendi
sunucumuzdan indirme). 1100+ test, lint 0 uyari.

**Bilinen dis engeller (uretim hazirligi):** sanal POS, GIB entegratoru, SMS
saglayici Noop (sozlesme gerekli; FINAL-COMPLETION-REPORT).

## 1. Avukat gozu — hukuki derinlik eksikleri

### A1. Dosya GIDER takibi YOK (model: CaseExpense yok) — P1, yuksek
Sadece fatura ve zaman kaydi var. Bir dosyanin GERCEK maliyeti (pesin narc,
islah harci, bilirkisi ucreti, tebligat gideri, yol/danisma) kayit altinda
degil. Eksik: narc/gider avansi kaydi -> IIK m.202 iadesi takibi -> dosya
kapatma hesabi -> masraflarin tarafa yansitilmasi. Bu olmadan karlilik
raporlari yanlis.

### A2. Arabuluculuk SUREC yonetimi YOK (yalniz davet sure kurali var) — P1, yuksek
Ise iade/is uyusmazliginda dava sarti. Davet->toplanti->anlasma/son tutanak
zinciri, anlasilmazsa 2 haftalik dava suresi uyrisi, masraf kaydi, tutanak
yukleme yok. Sure motoru kurali VAR; surec VERISI yok (model Arabuluculuk YOK).

### A3. Hukuk hesap aracları — P1
Vekalet ucreti aracı VAR; avukatın haftalık kullandığı diğer hesaplar YOK:
kıdem/ihbar tazminatı, temerrüt ve 3095 kanuni+asgari temerrüt faizi, dava
harcı/gider avansı, nafaka, miras (elde kalan pay). Aynı "hesabın her adımı
görünür" ilkesiyle legal-core'a.

### A4. Mevzuat kutuphanesi YOK — P2
Ictihat arama + teyit VAR; MEVZUAT tarayici yok (yururlukteki hal, RG
degisiklik izleme). Vaat kisiti geregi dikkat: resmi kaynak yoksa "yerel
kutuphane + buro kendi yukler" modeliyle baslanmali; RG izleme ancak gercek
entegrasyonla vaat edilir.

### A5. e-Tebligat (PTT UETS) YOK — P2 (dis sozlesme)
UYAP'tan OKUMA var; tebligat Tarihi -> sure baslangici otomasyonu kismen var.
UETS API'si entegrasyon gerektirir.

### A6. Icra derinligi — P3
EnforcementFile/Action + IIK m.89 banka haciz ajani + mahsup motoru VAR;
kiymet takdiri, satis, IIK kademe akisi, iflas/concordato modelleri yok.

### A7. Durusma sonrasi hizli sonuc — P1 (mobil agirlikli)
Hearing durumu elle guncelleniyor; "durustan ciktim, ertelendi, yeni tarih X"
tek ekrandan (mobil) girilebilmeli; yeni tarih otomatik ajanda+sure tetiklemeli.

## 2. Butosahibi gozu — gelir/kullanici/verimlilik

### B1. Kullanici yonetimi ekrani YOK (API TAM) — P0
`/users/manage` uclari hazir (liste, olustur, rol degistir, parola sifirla,
kilidi ac, oturum dusur); arayuz yok. Butosahibi kendi personelini
yönetemiyor. Sayfa: Ayarlar → Kullanıcılar (rol matrisi, lisans koltuk gostergesi).

### B2. Birlesik AJANDA (kurumsal takvim) YOK — P0
Durusmalar + randevular + sureler + gorev teslimleri ayri listelerde. Tek
takvim gorunumu (ay/hafta/gun, kisi suzgeci, tur renkleri, tatil isaretleri)
istendi ("enterprise++"); hic yok. Veri hazir: 4 kaynagi birlestiren
`GET /agenda` ucu + takvim sayfasi.

### B3. Dosya karliligi raporu — P1 (A1'e bagimli)
Gelir (fatura+zamanxoran) - gider (A1) - vekalet ucreti tahakkuk
karsilastirmasi. Altyapi cogunlukla var; gider modeli eklenince tamamlanir.

### B4. Kasa/nakit akisi — P2
Tahsilat-makbuz, buro kasasi, ortak avanslari. A1'in ustune insa edilir.

## 3. Mimargozu

### C1. Platform AI saglayici sistemi YOK — P0 (taahhut edildi, kesildi)
PlatformAiProvider modeli yok. Istenen mimari: platform coklu saglayici
tanimlar (anahtar sifreli), plan tier'da varsayilan atamasi + `allowBYOLLM`
yetki bayragi; BYO yetkisi olmayan kiraci yalniz platform saglayicilarini
kullanir; kiraci saglayici ekrani kilitli gorunum. `resolveRoute` zinciri
genisletilir (once yetkili kiraci rotasi -> plan varsayilani -> platform
yedekleri). Model listesi: saglayicilarda `listModels()` HAZIR, baglanmadi.

### C2. Model listesi otomatik cekme — P0 (C1'in parcasi)
`POST /ai/providers/:id/fetch-models` -> saglayicidan model listesini cek,
secmeli listele, elle yazmayi bitir. Desteklenmeyen model uyrisi iki tarafta
(buro + platform): desteklenen model katalogu ile karsilastir.

### C3. AI egitim verisi (RLHF toplanmasi) — P1 (taahhut edildi, kesildi)
TrainingSample modeli yok. KAYNAKLAR (mevcut sistemde zaten uretiliyor): oneri
kabul/ret kayitlari (DocumentActionProposal), dilekce surum farklari (AI
taslak -> avukat duzenlemesi), belge sinif duzeltmeleri, ajan red
gerekceleri (AiAgentRun), ictihat teyit sonuclari. `Tenant.aiTrainingOptIn`
(varsayilan KAPALI — KVKK) + maskeleme zorunlu + platform panelinden JSONL
disa aktarma (dort-goz). Disa aktarim SADECE opt-in kiraci verisinden.

### C4. Gercek zamanli iletisim (WS/SSE) — P2
Mesajlar/varlik durumu polling (3-10 sn). SSE ile baslanir (ters vekil
dostu), video arama sinyallesmesi de ayni kanaldan.

### C5. Vektor arama olcegi — P3
Float[] + JS kosinus, bilincl karar (belgeli). 100k+ parca ustunde pgvector
gecisi planlanmali; simdilik dokunma.

### C6. Calisabilirlik: merkezi metrik/izleme, DR/backup — P2
Korelasyon kimlikli hatalar var; metrik yok, yedekleme proseduru belgeli
degil. Coklu ornek: hiz siniri Redis'te tek; BullMQ tekil kosu kilidi
dogrulanmali (deploy.replicas>1 senaryosu).

### C7. Guvenlik borcu — P2 (bilinen, ertelenmis)
I-46 JWT httpOnly cookie, User.email global unique + arama. Ikisi de mimari
degisiklik; plana alindi.

## 4. Gelistirici gozu — tamamlanmis gorunen modullerdeki eksikler

| Modul | Eksik | Kanit |
|---|---|---|
| Mesajlar | Video arama UI + avatar | Arka uc TAM (OfficeCall+signals, avatar presign/GET); sayfada getUserMedia/avatar YOK |
| Ayarlar→AI | Model listesi cekme + platform kilit gorunumu | C1/C2 |
| UYAP | Eslesme cozumu sonrasi otomatik yeniden senkron | Eslesince kuyruk kaydi cozulur; bekleyen safahat/durusmalar gecmis kosu icin yeniden islenmez |
| Dilekceler | Surum fark gorunumu | Surum farklari kayitli, UI'da diff gorunumu yok |
| Icra | Kıymet takdiri/satış kademesi (A6) | Model yok |
| Sureler | Arabuluculuk yalnız davet kuralı (A2) | Tek deadline rule |
| Portal | Bildirim e-postası (SMTP Noop) | Dış bağımlılık |
| Mobil | Ajanda/mesajlar ekranları | Expo app daralmış |

## 5. Yol haritası (kabul kriterleriyle)

**DALGA 1 — P0 "Söz verilen eksikler" (≈2 hafta)**
1. Kullanıcı yönetimi ekranı (B1) — uç hazır; kabul: büro sahibi kullanıcı
   ekleyip rol verir, lisans koltuk göstergesi doğru.
2. Birleşik Ajanda (B2) — `GET /agenda` + takvim UI; kabul: 4 kaynak tek
   takvimde, tatiller işaretli, kişi süzgeci çalışır.
3. Platform AI sağlayıcı + BYO yetkisi + model çekme (C1+C2); kabul: BYO'suz
   planda kiracı sağlayıcı EKLEYEMEZ (kilitli görünüm), platform sağlayıcısı
   atanabilir, model listesi sağlayıcıdan düşer, desteklenmeyen model iki
   tarafta uyarır.
4. Mesajlar tamamlama — video arama UI + avatar; kabul: iki sekme arası
   WebRTC görüntülü konuşur (STUN), avatar profil kartında görünür.

**DALGA 2 — P1 "Hukuki çekirdek" (≈3 hafta)**
5. Gider takibi + kasa çekirdeği (A1+B4); kabul: dosyaya harç/bilirkişi/yol
   girişi, İİK m.202 iade listesi, dosya kapatma hesabı.
6. Arabuluculuk süreç modülü (A2); kabul: son tutanak tarihinden itibaren
   2 haftalık dava süresi uyarısı ajandaya düşer.
7. Hesap araçları (A3): kıdem/ihbar, faiz, harç/gider avansı; kabul:
   legal-core birim testli, her adım görünür (vekalet ücreti deseni).
8. Dosya kârlılığı raporu (B3).
9. AI eğitim verisi (C3); kabul: opt-in kiracı verisi toplanır, maske zorunlu,
   JSONL dışa aktarma dört-göz onaylı.
10. Mobil duruşma hızlı sonuç (A7).

**DALGA 3 — P2 "Entegrasyon ve olgunlaşma" (dış bağımlılıklı)**
11. Mevzuat kütüphanesi (yerel yükleme modeliyle başlangıç) (A4).
12. e-Tebligat UETS (A5) — PTT sözleşmesi şart.
13. POS/GİB/SMS gerçek sağlayıcılar — satış sözleşmesi şart.
14. SSE gerçek zamanlı iletişim (C4) + izleme/DR (C6) + İ-46 (C7).

**DALGA 4 — P3 "Ölçek"**
15. İcra kademe akışı + iflas (A6), pgvector (C5), çoklu örnek doğrulama.

## 6. Yapılmayacaklar (dürüstlük)

- RG'den otomatik mevzuat senkronu vaadi — kaynak entegrasyonu olmadan.
- TURN sunucusu (video arama P2P+STUN ile sınırlı; aşırı NAT'ta bağlanmayabilir
  — arayüzde açıkça yazılacak).
- Mesaj silme (ürün kararı — denetim izi).
