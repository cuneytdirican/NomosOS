# İçtihat Havuzu Yol Haritası — Değerlendirme ve Plan

> Kapsam: İçtihat Araştırma ekranı (büro) + sistem yönetimi (admin) havuz yönetimi.
> Her madde: DURUM TESPİTİ → ÖNERİ → UYGULAMA ADIMI. "Eğitme" vizyonu sonda.

## 1. Neden yalnızca 5 canlı sonuç? Artırılabilir mi?

**Tespit:** Sınır bilinçli bir seçimdi: `caselaw.service.ts` içinde `liveAdapter.search(q, 5)`
— resmî kaynağı yormamak, yanıt süresini kısa tutmak ve tek ekranda okunabilirlik için.
Canlı arama HER klasik aramada paralel tetiklenir; 50 sonuç çekersek her tuş-vuruş
araması resmî siteye 50 kayıtlık istek gönderir.

**Öneri:** Kaynak tarafı hız limitine saygılı kalarak artır:
- Varsayılan **10**, kullanıcı tercihli **10/25/50** ("Daha fazla canlı sonuç" butonu —
  tıklanınca 2. sayfa, pageNumber=2).
- Sayfalama: canlı bölüm kendi sayfa kontrolünü taşır (resmî `/aramalist` zaten
  `pageSize`/`pageNumber` alıyor — parametre altyapısı hazır).
- Filtre aktifken (mahkeme/tarih) canlı sorgu da aynı filtreyi taşısın.

**Adım:** adapter `search(q, limit, page)` parametreleri → servise `liveLimit/livePage`
→ arayüzde sayfa kontrolü. Efor: yarım gün.

## 2. Kaynak göstergesi (Yargıtay / Sayıştay / AİHM…)

**Tespit:** Şu anda iki katman var: VERİTABANI (kaynak etiketi = `sourceAdapter`: SEED_DEMO,
FEED_TEST, PLATFORM_ICAKTARIM…) ve CANLI (yalnız Yargıtay). Sayıştay ve AİHM
**bağlı değil** — karararama.yargitay.gov.tr tek canlı kaynak.

**Öneri:** İki eksenli gösterim:
- **Mahkeme unvanı** künyenin parçası (zaten var: "Yargıtay 21. HD").
- **KAYNAK ROZETİ** satır başında, sabit renk sözlüğüyle:
  `YARGITAY CANLI` (yeşil) · `HAVUZ` (mavi) · `BÜRO KAYDI` (mor) · `DEMO` (sarı).
- Yeni canlı kaynak adaptörleri eklenirken rozet sözlüğü tek yerden beslenir
  (`SOURCE_LABELS` — Sayıştay turkuaz, AİHM lila vb.).

**Adım:** (a) rozet bileşeni + sözlük; (b) Sayıştay kamuya açık karar araması ve
AİHM HUDOC entegrasyonu ADAPTÖR OLARAK (aynı LiveAdapter sözleşmesiyle) — her
biri araştırılıp gerçek uç noktası doğrulanarak yazılır (uydurma yasağı). Efor:
rozet yarım gün; her yeni kaynak adaptörü ~1 gün.

## 3. Aranan içtihatlar otomatik kaydedilmeli mi?

**Tespit:** Hayır — sistem tasarımı bilinçli olarak "çekim havuza otomatik YAZMAZ"
(caselaw-ingest onay kuyruğu). Nedenleri hâlâ geçerli:
- Telif/veri sözleşmeleri: resmî yayınlar kamusal, ama TOPLU DEPOLAMA ve
  yeniden dağıtım farklı yükümlülükler doğurur (ücretli veri sağlayıcı sözleşmeleri
  özellikle yasaklar).
- Havuz kalitesi: her aramada alakasız kayıt yağmuru havuzu kirletir; arama skoru
  "havuzda varlık" ile orantılı çalışır.
- KVKK: karar metinlerindeki kişi verileri havuza girerken maskelenmeli — otomatik
  kayıt bu kapıyı atlar.

**Öneri — karma model:**
- Arama sonucu satırına **"Havuza öner"** butonu (avukat inisiyatifi) → öneri
  ONAY KUYRUĞU'NA düşer (mevcut CaseLawIngestItem tablosu yeniden kullanılır,
  `sourceKey: BURE_ONERI`). Avukat madde gerekçesi yazar.
- Kural tabanlı otomatik ÖNERİ (kayıt değil): aynı künye X farklı avukat tarafından
  arandıysa sistem "havuza alınması önerilir" işareti koyar — yine insan onayı şart.
- Otomatik yazım YALNIZ lisanslı besleme (CaselawSourceConfig) üzerinden, onaylı.

**Adım:** "Havuza öner" uç + kuyrukta `BURE_ONERI` kaynağı. Efor: 1 gün.

## 4. Yönetim onay akışı — OKUYARAK onay

**Tespit:** Kuyruk var (admin /yargi/havuz → Toplama Hattı) ama onay YALNIZ künye
+ özet gösteriyor; karar metni ONAY ÖNCESİ okunamıyor. Bu, onayı körlemeye
çevirir — kullanışsız olmasının ana nedeni.

**Önerilen ekran: "İçtihat Onay Masası" (admin /ictihat/onay)**

```
┌ Sol: kuyruk listesi ──────────┬ Sağ: okuma bölmesi (sticky) ──────────┐
│ Filtre: durum/kaynak/daire    │ [Künye kartı: daire, E./K., tarih]    │
│ ▢ BEKLIYOR (23)  ONAYLI (412) │ [Tam karar metni — kaydırılabilir,    │
│ ─────────────────────────────  │  sayfa konumlu şerhler burada görünür]│
│ ● Y.21.HD 2015/13151  ONERI   │ [Öneren: Av. Demo Partner — "bu       │
│ ● Sayıştay 2024/…    BESLEME  │  karar kira uyarlamasına emsal"]      │
│ ● AİHM 1234/56       BESLEME  │ ──────────────────────────────────    │
│ …                              │ [ONAYLA]  [REDDET (gerekçe zorunlu)] │
└───────────────────────────────┴───────────────────────────────────────┘
```

Akış: satır seç → metin sağda açılır (besleme/FETCH ile, demoysa [DEMO] şeridi) →
oku → ONAYLA (havuza CaselawPoolService'ten girer, tek kapı değişmez) veya REDDET
(gerekçe zorunlu, denetim izine yazar). Toplu işlemler: 10'lu seçim (yalnız aynı
kaynak + aynı daire için). Her onay PlatformAuditLog'a düşer — mevcut desen.

**Adım:** kuyruğa `getDokuman` önizleme entegrasyonu (canlı kayıtlar için) + okuma
bölmesi + klavye kısayolları (O=onay, R=red). Efor: 1-1,5 gün.

## 5. Satıra tıklayınca doğrudan metin

**Tespit:** Şu an iki tık gerekiyor (satır → "Metni oku").

**Öneri:** Satırın TAMAMI tıklanabilir olur (buton değil, `role="button"` erişilebilir
satır): tıkla → metin sağda/altta açılır. İki biçim:
- (a) Arama sayfasında **bölünmüş düzen**: solda sonuç listesi, sağda sabit okuma
  bölmesi (seçim değişince metin değişir) — dosya detay ekranlarındaki desen.
- (b) Satır içi genişleme (accordion) — mobil/ dar ekran için.
Öneri: (a) masaüstü, (b) mobil. "Metni oku" butonu kalabilir ikincil olarak
(bağlam menüsü), tek tık = satır.

**Adım:** düzen değişikliği + seçili satır vurgusu. Efor: yarım gün.

## 6. "Mahkeme" kriteri %100 doğru mu? Test senaryoları

**Tespit:** Mahkeme süzgeci bugün `court contains ILIKE` (veritabanı katmanı) —
"Yargıtay 21" sorgusu "Yargıtay 21. Hukuk Dairesi"ni bulur ama "21. HD" yazmazsanız
bulamaz; eş anlamlı yazımlar ("Y21HD", "Yargıtay Hukuk Genel Kurulu" vs.) tutmaz.
Canlı katmanda mahkeme süzgeci HENÜZ YOK (canlı arama yalnız anahtar kelimeyle gider).

**Önerilen test matrisi (otomatik e2e senaryoları):**
1. **Tam unvan:** "Yargıtay 21. Hukuk Dairesi" → yalnız 21. HD kayıtları.
2. **Kısaltma:** "21. HD" / "Y21HD" → aynı sonuç (eş anlamsı sözlük: daire kodu
   normalizasyonu önerisi — `21. Hukuk Dairesi ↔ 21. HD ↔ Y21`).
3. **Kısmi eşleşme:** "Hukuk Genel Kurulu" → HGK kayıtları.
4. **Sayıştay:** "Sayıştay 10. Daire" → Sayıştay kayıtları (adaptör eklenince).
5. **AİHM:** "AİHM" / "Mahkeme (İç Adalet Divanı)" → AİHM kayıtları.
6. **Tarih aralığı + mahkeme birlikte:** 2015-2020 + "Yargıtay 21" → hem süzgeçler
   birlikte doğru mu (çapraz süzgeç hatası klasik bug kaynağı).
7. **Negatif:** "Anayasa Mahkemesi" → havuzda kayıt yoksa dürüst boş sonuç (uydurma yok).
8. **Sıralama:** aynı sorguda ilgi skoru mahkeme süzgecünden sonra da doğru mu.
9. **Canlı+DB birlikte:** mahkeme süzgeci canlı katmana da taşınıyor mu (madde 1'deki
   iyileştirme).
10. **Performans:** 100 kayıtlı havuzda süzgeç < 500 ms (sayfalı tarama).

**Adım:** daire kodu normalizasyon sözlüğü + bu 10 senaryo Playwright/Vitest e2e
olarak yazılır (vaat-kısıtı testlerine eklenir). Efor: 1 gün.

## 7. Sistem yönetimi havuz ekranı — yöneticinin gözüyle

**Tespit:** Mevcut /yargi/havuz: havuz istatistikleri + elle toplu içe aktarma +
toplama hattı bölümü. Eksikler (yöneticinin gerçek ihtiyaçları):
- Kullanıcıların NE aradığını göremiyor (pazarlama/kalite sinyali).
- Onay akışı körlemeye yakın (madde 4).
- Havuzdaki kayıtları SÜREMİYOR/ARAMIYOR (künye arama, daire bazlı gezinme yok).
- Silme/düzeltme politikası yok (yanlış kayıt havuzda kalır).

**Önerilen sekme yapısı (yönetim):**

1. **Havuz Durum Panosu** — toplam kayıt, kaynak kırılımı (CANLI/BESLEME/BÜRO/DEMO),
   daire dağılımı grafikleri, haftalık büyüme eğrisi, son 10 arama trendi
   ("en çok aranan 20 sorgu" — eğitim önceliklerinin nereden çıkacağı yer).
2. **Onay Masası** (madde 4'teki ekran — ana çalışma yüzeyi).
3. **Havuz Kayıtları** — tam metin + künye arama, kaynak/daire/tarih süzgeçleri,
   kayıt detayı (kim ekledi, hangi onay, hangi koşu), YANLIŞ kayıt için "havuzdan
   çek" (yumuşak silme + denetim izi; büro kayıtlarına dokunulmaz).
4. **Besleme Kaynakları** — mevcut Toplama Hattı bölümü; kaynak başına son çekim,
   bekleyen sayısı, hata geçmişi.
5. **Arama Günlüğü** — kim, ne aradı, hangi kaynaklar sonuç verdi, tıklanan sonuç
   (anonimleştirilmiş raporlama; KVKK: sorgu metinleri persona verisi içerebilir —
   maskeleme kuralı).

**Eğitim vizyonu:** "Avukatlar ne arıyor + havuzda bulamıyor" listesi = hangi
dairelerin besleneceğinin ÖNCELİK tablosu. Arama günlüğü → boş sonuç analizi →
besleme planı. Bu, içtihat havuzunu ürünün öğrenen organı yapar (madde 8'le birleşir).

**Adım:** 2 → 5 → 3 → 1 → 4 sırasıyla; her biri 1-2 gün.

## 8. Zamanlanmış iş metni — "İçtihat toplama (besleme → onay kuyruğu)"

**Tespit:** Ad anlaşılmıyor çünkü "besleme" ve "onay kuyruğu" soyut.

**Öneri — yeni metin:**

- İş adı: **"İçtihat besleme çekimi"**
- Açıklama: "Her sabah 06:00'da tanımladığınız veri kaynaklarından (ör. lisanslı
  içtihat servisi) yeni Yargıtay kararlarını çeker. Çekilen kararlar doğrudan
  havuza GİRMEZ; İçtihat Onay Masası'nda bekleyen kayıtlar olarak listelenir.
  Sistem yöneticisi karar metnini okuyup onayladığında havuza yazılır."
- Arayüzde iş satırına **"Kuyrukta bekleyen: N kayıt → Onay Masası'na git"** bağlantısı
  (iş → sonuç arasında köprü; şu an ikisi kopuk).

**Adım:** `platform-jobs.service.ts` name/description güncellemesi + kuyruk sayısı
bağlantısı. Efor: 1 saat.

## Yol haritası (öncelik sırası)

| # | İş | Efor | Değer |
|---|---|---|---|
| 1 | Onay Masası (okuyarak onay, madde 4) | 1-1,5 gün | Havuz kalitesinin omurgası |
| 2 | Satır tıkla → doğrudan metin (madde 5) | yarım gün | Kullanıcı akışı |
| 3 | Kaynak rozetleri (madde 2) | yarım gün | Şeffaflık |
| 4 | Canlı sonuç sayısı + sayfalama (madde 1) | yarım gün | Derinlik |
| 5 | "Havuza öner" akışı (madde 3) | 1 gün | Büyüme motoru |
| 6 | Daire normalizasyonu + 10 test senaryosu (madde 6) | 1 gün | Doğruluk |
| 7 | Arama Günlüğü + Durum Panosu (madde 7) | 2 gün | Eğitim/öncelik sinyali |
| 8 | İş metni + kuyruk bağlantısı (madde 8) | 1 saat | Anlaşılırlık |
| 9 | Sayıştay + AİHM canlı adaptörleri (madde 2) | 2 gün | Kaynak çeşitliliği |

Toplam ~8-9 gün; 1-2-3-4 bir "sürüm" (kullanıcı yüzeyi), 5-6 ikinci sürüm
(büyüme + doğruluk), 7-8-9 üçüncü sürüm (yönetim + genişleme).

## "Eğitme" yaklaşımı — özet felsefe

Havuz üç girdiden öğrenir: (1) lisanslı beslemeler (yönetici onaylı), (2) avukat
önerileri (aramadan havuza öner, madde 3), (3) arama günlüğü analizi (neyin eksik
olduğunu söyler). Üçü de insan onaylı tek kapıdan (CaselawPoolService) geçer; hiçbir
kayıt sessizce havuza girmez, hiçbir kayıt sessizce silinmez. Fine-tune katmanı
(onaylanmış AiTrainingSample havuzu) ayrıca durur; RAG havuzu kalitesi arttıkça
içtihat araması ve AI cevap kalitesi kendiliğinden yükselir.
