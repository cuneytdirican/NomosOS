# AI Sözleşme Yönetimi — Uçtan Uca Arayüz ve İş Akışı Önerisi

> Hedef: müvekkilin getirdiği ticari sözleşme **ilk temastan müzakere kapanışına**
> tek akışta; her ekran avukata "şimdi ne yapmalıyım"ı bir bakışta söyleyen,
> görsel olarak baskın bir hiyerarşiyle kuruludur.

## 0. Tasarım sistemi (tüm ekranların ortak dili)

| Katman | Kurallar |
|---|---|
| **Tipografi** | Sayfa başlığı 24px/700 · kart başlıkları 15px/600 · gövde 14px/400 · künye/metaveri 12px/500 tabular. Renk: başlık `#0F172A`, gövde `#1E293B`, ikincil `#64748B`. Avukatın gözü önce BAŞLIK → DURUM ROZETİ → SAYISAL SKORA düşer. |
| **Anlam renkleri (sabit)** | 🔴 KIRMIZI `#DC2626` = kritik risk + **eklenecek madde** · 🟠 TURUNCU `#EA580C` = orta risk + **çıkarılacak madde** · 🟡 SARI `#CA8A04` = düşük risk · 🟢 YEŞİL `#16A34A` = bize avantajlı / kabul · 🔵 MAVİ `#2563EB` = bilgilendirme. Bu beş renk tüm ekranlarda aynı anlamı taşır — renk ezberi bir kez öğrenilir. |
| **Skor göstergesi** | 0-100 genel risk skodu daima büyük punto (28px) + renk bandı + "N açık şerh" alt yazısı. Skor kartı EKRANIN SAĞ ÜST köşesine sabitlenir — her ekranda görünür (kalıcı çıpa). |
| **Boşluk/durum hiyerarşisi** | Bir ekranın birincil eylemi tek butondur (dolu, altın/amber); ikincil eylemler outline; tehlikeli eylemler kırmızı outline. |

## Ekran akışı (uçtan uca)

```
[1] Sözleşme Girişi → [2] Analiz Önizleme (şerhli metin) → [3] Çift Taraflı Simülasyon
        → [4] Avukat Müdahalesi (şerh kapatma + kendi maddesi ekleme)
        → [5] Müvekkil Onayı → [6] Müzakere Masaası (versiyon/diff/karşılaştırma)
        → [7] Nihai Analiz + İmza → [8] Kapanış Raporu
```

---

## 1. Sözleşme Girişi Ekranı (`/app/sozlesmeler/yeni`)

**Amaç:** ilk izlenim; sözleşmeyi 30 saniyede, üç yoldan sisteme almak.

**Düzen (tek sütun, ortalanmış, max-w-3xl):**

1. **Başlık bloğu:** "Sözleşmenizi yükleyin" + alt satır: "PDF, Word veya metin — analiz ~1 dakika sürer, kredi tahmini önceden görünür."
2. **Sürükle-bırak alanı (dominant bileşen, ekranın %40'ı):** kesikli 2px kenarlık, hover'da amber yükselme animasyonu; ikon + "Dosyayı buraya bırakın ya da seçin"; kabul: .pdf .docx .doc .txt. Bırakan dosya kartı: ad, boyut, **biçim rozeti (PDF/WORD/METİN — otomatik algılanır)**, kaldır düğmesi.
3. **AYIRICI: "veya metni yapıştırın"** — genişleyen textarea (yapıştırma olayında otomatik büyür); yapıştırılan metin de biçim algılar (madde numaraları, sayfa sonları) ve "N sayfa · N madde tespit edildi" rozeti gösterir.
4. **Bağlam satırı (opsiyonel, akıllı):** Müvekkil seçici (arama) + dosya seçici. Boş bırakılırsa "İlişkisiz sözleşme — sonra bağlayabilirsiniz" bilgisi. Müvekkil seçildiyse karta mini özet (tür, vekalet durumu) düşer.
5. **Yükleme durumu:** dosya başına ilerleme çubuğu + aşama etiketi: "Yükleniyor → Metin çıkarılıyor → Sayfalandırılıyor → **Analize hazır**". PDF'te OCR gerekirse dürüst uyarı ("taranmış PDF — metin çıkarma birkaç dakika sürebilir").
6. **Önizleme kartı (analize hazır):** kapak mini görünümü (PDF ilk sayfa küçük resmi) + başlık (dosya adından önerilir, düzenlenebilir) + "12 sayfa · 34 madde · 2 taraf" + **TAHMİN KUTUSU: "14 parça × 25 kredi = 350"**.
7. **Birincil eylem:** "Analizi Başlat" (dolu amber buton) — tıklandığında kredi onay modalı (tahmin yinelenir; sürpriz yok).

**Aksiyonlar:** dosya bırak/seç · yapıştır · müvekkil/dosya bağla · başlığı düzenle · analizi başlat.

## 2. Analiz Önizleme (şerhli metin) — sözleşmenin ANA OKUMA EKRANI

**Amaç:** avukat fiziksel nüshası elinde, sayfayı-maddeyi 10 saniyede bulur; şerhler metinle birlikte okunur.

**Düzen (sol geniş metin + sağ dar panel):**

- **SOL — Şerhli metin (sayfalanmış):** metin 5 sayfalık pencerelerle akar; sayfa seçici üstte büyük rozetle ("132 sayfa · s.63-67"). Şerhli maddenin **sol kenarı kalın renk şeridi** (kırmızı/turuncu/sarı) + hafif renk zeminı; şerh rozeti madde numarasının yanında inline. Maddeye tıklayınca sağ panel o şerhi açar.
- **SAĞ — Şerh paneli (sticky):** seçili şerh: büyük severity rozeti, madde künyesi + SAYFA NO (fiziksel nüsha eşlemesi: "s.63 · m.7.2"), AI gerekçesi (birebir madde alıntısıyla), önerilen düzeltme, [Kabul et/Kapat] [Reddet] [Müvekkile göster] eylemleri. Üstte mini filtre: red/orange/sar sayım rozetleri (tıklanınca metinde o renk maddeler vurgulanır).
- **Fiziksel nüsha modu (özgün özellik):** tek tuşla "Sayfa haritası" görünümü — her sayfa için kırmızı/turuncu nokta ızgarası; avukat hangi fiziksel sayfada ne varsa anında görür.

**Şerh renk semantiği (önizleme):** 🔴 **eklenecek madde/kritik risk** (sözleşmedeki boşluk + aleyhimize hüküm), 🟠 **çıkarılacak madde** (ortasıra riskli hüküm — cezai şart, tek taraflı fesih), 🟡 düşük risk/bilgi. Her şerh kartında "EKLENMELİ/ÇIKARILMALI/REVİZE EDİLMELİ" eylem rozeti ayrıca yazılıdır (renk körlüğü erişilebilirliği).

**Aksiyonlar:** sayfa gez · şerh seç/kabul/red · sayfa haritası · PDF yazdır (şerh listesi fiziksel nüsha kenar notlarıyla).

## 3. Çift Taraflı Simülasyon Ekranı

**Amaç:** "Biz olsak ne derdik / karşı taraf ne der" yan yana, canlı.

**Düzen (iki eş sütun):**

- **SOL SÜTUN — BİZİM TARAF:** KIRMIZI üst başlık bandı. İçerik: risk sıralı bulgu listesi (güç puanıyla), her bulgu madde künyesine köprülü, "sizin açığınız" + "önerilen hamlemiz".
- **SAĞ SÜTUN — KARŞI TARAF:** MAVİ üst başlık bandı. İçerik: karşı tarafın dayanacağı argümanlar, onların güçlü/zayıf noktaları, muhtemel müzakere pozisyonları.
- **Orta şerit (canlı):** her iki tarafın AYNI madde üzerindeki çıkarsı yan yana hücrelenir (madde bazlı karşılaştırma matrisi — üstte madde seçici, altta iki hücre).
- **ALT BANT — "Nihai haller" karşılaştırmalı:** sekmeli üç görünüm: [Bizim revizyonumuz] [Karşı tarafın muhtemel revizyonu] [Orta zemin] — her biri maddeleri renkli diff olarak gösterir (eklenen kırmızı, çıkarılan turuncu, ortak yeşil).
- Canlılık: analiz koşarken sütunlarda parça ilerlemesi ("parça 9/14"()); şerhler aktıkça sağ panele düşer.

**Aksiyonlar:** taraf sütununu büyüt (tam ekran) · madde karşılaştır seç · nihai hal sekmeleri · simülasyonu yeniden çalıştır (mod seçimi).

## 4. Avukat Müdahalesi — Kendi Maddesini Ekleme

**Amaç:** avukatın hukuki içgüdüsünü AI'ya aktarmak; AI **anlamayıp birebir yazmadan**, derinleştirip sözleşme diline uyarlar.

**Düzen (madde üzerinde çalışma alanı):** şerh panelinde "Kendi maddemi öner" düğmesi → açılan panel:

1. Avukat girdisi: serbest metin ("Fesih ihbarı 60 gün olsun ve ceza karşılıklı işlesin").
2. **AI yorumlama adımı (önizlemeli):** AI önce avukata NE anladığını gösterir: "Anladım: ihbar süresi 30→60 gün, cezanın karşılıklılığı, güncel sözleşmede m.7 ve m.12'e dokunuyor" + [Anlam doğru] [Düzelt] onayı — avukat onayı olmadan metne dokunmaz.
3. **Üç varyant sunumu:** AI madde taslağını üç sertlikte sunar (Dengeli / Bizim lehimize agresif / Uzlaşmaya açık) — her biri sözleşme terminoloojisine ve numaralandırmasına uyumlu, yerleşik metin içinde kırmızı (ekleme) diff ile önizlenir.
4. Avukat varyantı seçer/yerelde düzenler → "Sözleşmeye uygula" → yeni taslak sürüm (onay istemli).

**Aksiyonlar:** öneri yaz · anlam onayı · varyant seç · elle ince düzenleme · uygula (yeni sürüm + şerh durumu güncellenir).

## 5. Müvekkil Onayı Ekranı

**Amaç:** kritik şerhler ve öneriler müvekkile sade dille; portal üzerinden onay.

**Bileşenler:** kararma/vurgu yok — "En kritik 3 madde" kartları (günlük dille özet, maddeden kısa alıntı, "önerimiz" tek cümle); risk skoru basit gösterge; onay/itiraz akışı portal mesajıyla. PDF/özet rapor ektedir (madde künyeli, sayfa numaralı — avukatın fiziksel nüshasıyla eşleşir).

## 6. Müzakere Masası (sürecin kalbi)

**Amaç:** karşı tarafla gidip gelen sürümleri tek ekranda, adım adım zaman çizelgesiyle yürütmek.

**Düzen:**

- **ÜST: yatay sürüm şeridi** — her sürüm bir kart: v1 → v2 → v3…, gönderen rozeti (BİZ/KARŞI TARAF), tarih, **risk skoru mini göstergesi (sürüm bazlı eğri — skorun sürümden sürüme seyri çizgi grafiği)**.
- **ORTA: karşılaştırmalı çalışma alanı** — iki sürüm seçilir; üç görünüm: (a) **Sayfa diff** (eklenen kırmızı satır, çıkarılan turuncu satır, değişen satır çifti), (b) **Şerh takibi** (v2'deki şerh v3'te kapandı mı — kapandıysa yeşil tik), (c) **Yan yana tam metin** (iki sütun, senkron kaydırma).
- **ALT: append-only süreç zaman çizelgesi** — yükleme/gönderim/revizyon/analiz/şerh kapanışı/onay/imza olayları; canlı yoklama ile yenilenir.
- **Sağ sabit sütun:** "Açık şerhler (4)" + her yeni sürüm yüklenince AI otomatik ön-analiz yapar, **"yeni kırmızı maddeler" listesi** avukata yükseltilmiş bildirimle çıkar (karşı tarafın gizlice soktuğu hükümler anında görünür).

**Aksiyonlar:** sürüm yükle · sürüm seç · diff görünümleri · şerh kapat/yeniden aç · karşıya gönder (e-imza akışı) · yeni analiz.

## 7. Nihai Analiz + İmza

**Amaç:** imza öncesi son kontrol kapısı — vizüel "uçuş öncesi kontrol listesi".

**Bileşenler:** büyük skor kartı; **çözülmemiş şerhler renk gruplu liste** (kırmızı grubu üstte, fiziksel sayfa künyesiyle); "İMZALANABİLİR" / "KIRTIK ŞERH AÇIK — ÖNERİLMEZ" durum bandı (kırmızı açık şerh varken bant kırmızı ve imza eylemi ikincil); müvekkile son bildirim (PDF); e-imza gönder.

## 8. Kapanış Raporu

**Amaç:** dosyaya konan özet + müvekkilin eline tutuştürülen profesyonel çıktı.

**Bileşenler:** süreç özeti (v1→vN skor eğrisi grafiği, kapanan şerh listesi, kazanılan/kaba değişiklikler), kalan riskler, tam denetim izi (kim, ne zaman, hangi AI koşusu). PDF çıktısı madde künyeli ve sayfa numaralıdır.

---

## Uygulama notları

- Ekran 1 (giriş) yeni sayfa; Ekran 2-3-6-7 mevcut `/app/sozlesmeler/[id]` sekmelerinin görsel hiyerarşi revizyonu (mevcut altyapı: sayfa pencereli metin, şerh, diff, olay akışı, parça bazlı analiz ZATEN var — bu öneri öncelikle SUNUM katmanını yükseltir).
- Avukat maddesi (Ekran 4) yeni uç ister: "öneri → anlam onayı → varyantlar" zinciri (legal-ai prompt sözleşmesiyle, kredi ücretli, son uygulama avukat onaylı).
- PDF/Word girişi: mevcut belge hattı (DOCX/UDF) + PDF metin çıkarma pipeline'ına bağlanır (OCR mevcut).
- Fiziksel nüsha eşlemesi: şerhlerde pageFrom/pageTo zaten var — sunumda "Sayfa haritası"na yükseltilir.
