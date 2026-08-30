# NomosOS — Kaynak Gereksinim Analizi

> Bu doküman, projenin çıkış noktası olan pazar/ürün analizinin yapılandırılmış halidir.
> Tüm modül spec'leri (`docs/moduller/`) bu dokümandaki gereksinimleri temel alır.
> Analiz, mevcut bir "AI hukuk asistanı" ürününün (benchmark ürün) bir avukat gözüyle
> incelenmesinden çıkan eksikler üzerine kuruludur.

## Temel Tez

Benchmark ürün bugün "AI hukuk asistanı + belge/dosya çalışma alanı" seviyesinde.
AI tarafı güçlü: dosya analizi, içtihat araştırması, dilekçe üretimi, teyit ajanı,
UYAP Chrome eklentisi, kişiselleştirilmiş eğitim.

**NomosOS'un konumu farklı**: AI-Native Legal Operating System.

- Benchmark ürün = Legal AI Assistant
- NomosOS = **Legal ERP + Legal DMS + Legal CRM + UYAP Hub + AI Agents + Legal Intelligence**

Merkez **AI değil, DOSYA**. AI, tüm operasyonel verinin üzerinde çalışan zekâ katmanıdır.

```
                    ┌─────────────────┐
                    │   AI ENGINE     │
                    └────────┬────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
   Müvekkil                Dava                  İcra
       │                     │                     │
   Sözleşme               Duruşma              Tahsilat
       │                     │                     │
   Finans                 Süreler               Görev
       │                     │                     │
   İletişim                Deliller             Belgeler
       └─────────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  LEGAL CORE     │
                    └────────┬────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
            UYAP           Mevzuat         İçtihat
```

Hedef pazar: **binlerce avukat ve hukuk bürosu** — çok kiracılı (multi-tenant) SaaS.
Ayırt edici teknik gereksinim: **BYO-LLM** — her büro kendi LLM'ini bağlar
(Anthropic, OpenAI + OpenAI-uyumlu, Ollama/yerel, Gemini, tamamen özel endpoint).

---

## Gereksinim 1 — Müvekkil Yönetimi (CRM) `[P0, 10/10]`

Benchmark üründe dava dosyası, taraflar ve müvekkil işareti var; ancak tam teşekküllü
CRM yok. Ana yapı dava/belge/dilekçe etrafında kurulu — **müvekkil merkezli görünüm eksik**.

Müvekkil kartı yapısı:

```
Müvekkil
├── Genel Bilgiler (Gerçek / Tüzel Kişi)
├── İletişim, Adresler
├── Vergi Bilgileri, Banka Bilgileri
├── Yetkililer, İlgili Kişiler
├── Sözleşmeler, Vekaletnameler
├── Davalar, İcra Dosyaları, Arabuluculuk Dosyaları, Ceza Dosyaları
├── Belgeler
├── Finansal Hareketler, Tahakkuklar, Ödemeler
└── İletişim Geçmişi
```

Kritik ilke: **Müvekkil ≠ tek dosya.** Bir şirket müvekkilin 37 dava, 82 icra,
14 arabuluculuk dosyası, 6 sözleşmesi, 11 karşı tarafı, 4 avukatı, 2 devam eden
tahsilat süreci olabilir. Tüm bunlar müvekkil kartından tek bakışta görülmeli.

## Gereksinim 2 — Dava Dosyası Yaşam Döngüsü `[P0, 10/10]`

Dava sadece belgelerden oluşmaz. Dosya (örn. 2026/145) sekmeleri:

Dosya Özeti · Taraflar · Müvekkil · Mahkeme · Hakim · Duruşmalar · Safahat · Süreler ·
Görevler · Belgeler · Dilekçeler · Deliller · Tanıklar · Bilirkişi · Harçlar · Masraflar ·
Vekalet · Kararlar · İstinaf · Temyiz · İcra · Notlar · İletişim · Finans · AI Analiz

Benchmark ürünün güçlü olduğu zincir: Belgeler → AI → Araştırma → Dilekçe.
NomosOS **dava yaşam döngüsünün tamamını** kapsamalı (açılış → istinaf/temyiz → icra → kapanış).

## Gereksinim 3 — Duruşma Yönetimi `[P0, 10/10]`

Avukatın sabah açacağı ekran: **"Bugün hangi duruşmalarım var?"**

| Saat | Dosya | Mahkeme | İşlem |
|------|-------|---------|-------|
| 09:30 | 2025/341 | İstanbul 12. İş | Duruşma |
| 11:00 | 2026/72 | Ankara 4. Asliye | Ara karar |
| 14:30 | 2024/91 | Bursa 2. Tüketici | Tanık |

"Bugünkü duruşmalarımı hazırla" komutu şu paketi üretmeli: dosya özeti, son gelişmeler,
karşı tarafın son beyanı, son mahkeme kararı, eksik deliller, duruşmada sorulabilecek
sorular, ileri sürülmesi gereken hususlar, süreler, önceki duruşma tutanağı.

Bu, dosya içi bir AI özelliği değil **merkezi Duruşma Yönetimi modülü** olmalı.

## Gereksinim 4 — Süre / Deadline Motoru `[P0, 10/10]`

Hukukta AI'ın en değerli işi dilekçe yazmak değil: **"Bir şeyi kaçırmama yardım et."**

Örnek görünüm:
- ⚠️ 3 gün sonra — Cevap dilekçesi süresi
- ⚠️ 5 gün sonra — İstinaf süresi
- ⚠️ 8 gün sonra — Bilirkişi raporuna itiraz
- 🔴 Bugün — Ara karar gereği belge sunma
- 🟢 12 gün sonra — Duruşma

AI, dosyayı okuyup otomatik öneri üretmeli: *"Bu karar 18 Ağustos'ta tebliğ edilmiş.
İstinaf süresi açısından son gün 1 Eylül olabilir. Kontrol et."*

**Kritik mimari ilke**: Kesin hukuki süre hesabı mevzuat + dosya tarihi + tebliğ
yöntemi + resmi tatiller ile **deterministik** hesaplanmalı; AI yalnızca tespit/öneri
yapar, avukat onaylar. (Hibrit: kural motoru + AI önerisi.)

## Gereksinim 5 — İcra Modülü + İcra AI Copilot `[P0, 10/10]`

UYAP, dava yanında icra takiplerini de kapsıyor (ilamlı/ilamsız takip başlatma,
dosya inceleme, işlemler). NomosOS'ta icra ayrı bir ana modül olmalı; üzerine
**İcra AI Copilot**:

- "Bu dosyadaki borçlunun malvarlığı ve yapılan işlemleri analiz et."
- "Haciz aşamasında yapılabilecek işlemleri sırala."
- "Dosyada hangi süreleri kaçırdık?"
- "Bu dosyada tahsilat ihtimali nedir?"
- "İcra dosyasındaki son 20 işlemi analiz et."
- "Borçlunun itirazları ile bizim cevaplarımızı karşılaştır."

## Gereksinim 6 — UYAP Entegrasyon Hub `[P0, 10/10]`

Benchmark ürünün Chrome Extension yaklaşımı iyi bir başlangıç (UYAP'tan belge aktarımı).
Ama hedef "UYAP'tan aktar" değil, **"NomosOS büronun merkezi olsun"**:

```
UYAP → Dosya Senkronizasyonu → NomosOS → AI → Yeni Evrak
     → Otomatik sınıflandır → Dosyaya bağla → Süre tespit et
     → Görev oluştur → Avukata bildir
```

Mümkün olduğu ölçüde **iki yönlü**: UYAP → NomosOS → UYAP.
UYAP zaten dosya, safahat, duruşma, belge gönderimi, e-takip, harç/masraf ve
e-duruşma operasyonlarını kapsıyor. NomosOS'un uzun vadeli değeri UYAP'ın yerine
geçmek değil, **UYAP'ın üzerine AI operasyon katmanı** koymak.

## Gereksinim 7 — Belge → Otomatik Aksiyon Hattı `[P0, 10/10]`

Mevcut paradigma: "Belge yükle → AI analiz et."
NomosOS paradigması: **"Belge geldi → sistem ne yapılması gerektiğini kendisi çıkardı."**

Örnek — mahkeme ara kararı geldi:

```
BELGE ANALİZİ: Bu belge ara karardır.
TESPİTLER: Bilirkişi raporu talep edilmiş. 2 haftalık süre verilmiş.
           X belgesinin sunulması istenmiş.
OTOMATİK AKSİYONLAR:
☑ Görev oluştur          ☑ Son tarih oluştur
☑ Sorumlu avukata ata    ☑ Müvekkil bilgilendirme taslağı oluştur
☑ Dosya stratejisini güncelle  ☑ Duruşma hazırlığını güncelle
```

Ürünün asıl farklılaştığı yer burasıdır. Olay-tabanlı (event-driven) pipeline mimarisi gerektirir.

## Gereksinim 8 — Görev / Workflow Yönetimi `[P0, 10/10]`

Büroda "bu işi kim yapacak?" kritik. Tam Legal Workflow zinciri:

Dosya → Görev → Sorumlu → Kontrol eden → Son tarih → Öncelik → Durum → Onay → Tamamlandı

Örnek (istinaf dosyası): Avukat A → hukuki araştırma · Stajyer B → emsal karar taraması ·
Avukat C → dilekçe taslağı kontrol · Partner → son onay · Sekreter → UYAP gönderimi.

Roller: PARTNER / AVUKAT / STAJYER / SEKRETER (+ ADMIN).

## Gereksinim 9 — Hukuk Bürosu Finansı `[P1, 9/10]`

Takip edilmesi gerekenler: müvekkil, alacak, tahsilat, avans, masraf, harç,
vekalet ücreti, sözleşme bedeli, aylık danışmanlık.

Örnek sorgu — "ABC Holding'in bize toplam borcu ne?":

```
Açık dosya sayısı: 37
Tahakkuk: 1.240.000 TL | Tahsil edilen: 890.000 TL | Bekleyen: 350.000 TL
Masraflar: 72.450 TL | Tahsilat riski: Orta
```

## Gereksinim 10 — Faturalama, e-Fatura / e-Arşiv `[P2, 8/10]`

Ücret sözleşmesi tipleri: sabit ücret, başarı primi, saatlik, dosya bazlı, aylık
danışmanlık. Ayrıca: masraf yansıtma, avans, tahsilat, fatura, e-Fatura/e-Arşiv
entegrasyonu, ödeme takibi. Bu katman ürünü "AI uygulaması"ndan
"hukuk bürosu işletim sistemi"ne taşır.

## Gereksinim 11 — Müvekkil İletişim Merkezi + Portal `[P1, 9/10 · iletişim 8/10]`

Müvekkil "davam ne oldu?" diye aradığında avukat 15 dk dosya incelememeli.
AI: "Müvekkile gönderilecek durum özeti hazırla" → anlaşılır Türkçe özet →
WhatsApp / e-posta / SMS ile gönderim.

**Müvekkil Portalı** (ayrı giriş): Dosyalarım · Belgelerim · Son gelişmeler ·
Duruşmalar · Yapılması gerekenler · Ödemeler · Mesajlar · Avukatım.

## Gereksinim 12 — Conflict Check (Çıkar Çatışması) `[P1, 9/10]`

Yeni müvekkil (örn. XYZ A.Ş.) geldiğinde otomatik tarama:
Mevcut müvekkil mi? → Karşı taraf mı? → Bağlı şirket mi? → Eski müvekkil mi? →
Dosyalarda geçen taraf mı? → Rakip şirket mi?
Sonuç: 🔴 "Çıkar çatışması ihtimali tespit edildi." AI için mükemmel kullanım alanı
(isim benzerliği, bağlı şirket çıkarımı).

## Gereksinim 13 — Vekaletname Yönetimi `[P1]`

Ayrı modül: Müvekkil → Vekaletname → Başlangıç tarihi → Kapsam → Azil → Süre → Dosyalar.
AI analizi: "Bu vekaletnamenin kapsamı bu dava için yeterli mi?"

## Gereksinim 14 — Bilirkişi Yönetimi `[P1, 9/10]`

Özel AI modülü: bilirkişi raporu, ek rapor, itiraz, raporlar arası fark, teknik tespitler.
Örnek: "İlk bilirkişi raporu ile ek rapor arasındaki 27 maddelik farklılığı çıkar."
Genel chatbot'tan çok daha değerli, yapılandırılmış karşılaştırma çıktısı.

## Gereksinim 15 — Delil Yönetimi `[P1, 9/10]`

```
Delil ├── Belge ├── Fotoğraf ├── Video ├── Ses ├── Tanık ├── Bilirkişi ├── Keşif └── Diğer
```

AI: "Bu davada hangi iddiamızı hangi delil destekliyor?" →
**iddia → delil → belge → hukuki dayanak matrisi**.

## Gereksinim 16 — Strateji Motoru (Strategy Engine) `[P1, 9/10]`

Zincir: Karşı tarafın argümanları → Bizim argümanlarımız → Deliller → Hukuki dayanak →
Zayıf noktalar → Karşı tarafın kullanabileceği argümanlar → Bizim cevaplarımız →
Alternatif senaryolar → Risk skoru.

## Gereksinim 17 — Simülasyon Modları `[P1]`

- "Bu dosyayı **karşı taraf avukatı gibi** analiz et." → en güçlü 7 argüman
- "**Hakim gözüyle** dosyayı analiz et."
- "Davayı kaybetmemize neden olabilecek hususları bul."
- "Karşı tarafın dilekçesindeki zayıf noktaları bul."
- "**Bilirkişi** bu dosyada hangi noktalara takılabilir?"

## Gereksinim 18 — Dosya Risk Skoru (Risk Engine) `[P1, 9/10]`

Her dosyada boyut bazlı skor: Hukuki Risk (🟢/🟡/🔴), Süre Riski, Delil Riski,
Tahsilat Riski, Usul Riski, İçtihat Riski, Karşı Taraf Riski.
Partner sabah: "Büromda riskli 17 dosya var" diyebilmeli.

## Gereksinim 19 — Partner / Yönetici Dashboard `[P2 raporlama, dashboard P0-yakın]`

```
TOPLAM DOSYA 1.284 | AKTİF 734 | BU HAFTA DURUŞMA 42 | KRİTİK SÜRE 9
RİSKLİ DOSYA 17 | TAHSİL EDİLECEK 4.2M TL | BU AY FATURA 1.8M TL | AÇIK GÖREV 126
```

Ve: **"Bana bugün müdahale etmem gereken 10 şeyi göster."**

## Gereksinim 20 — KVKK / Veri Mimarisi `[P0 — ürün bariyeri]`

Benchmark üründe kırmızı bayrak: kişisel verilerin maskelenmesi kullanıcıya bırakılmış
(ABD/Avrupa menşeli LLM altyapıları nedeniyle sorumluluk kullanıcıda). NomosOS bunu
**sistem seviyesinde** çözmeli:

Otomatik tespit: TC Kimlik No, telefon, adres, IBAN, e-posta, sağlık verisi, çocuk bilgileri.
Akış: **Tespit → "Kişisel veri tespit edildi" → Maskele → Onayla → AI'a gönder.**

Enterprise farkı: **Private AI / Türkiye veri bölgesi / yerel LLM** —
"Verileriniz dış LLM'e gönderilmez" opsiyonu. BYO-LLM mimarisi bunun taşıyıcısıdır:
Ollama/yerel model veya şirket-içi custom endpoint seçildiğinde veri dışarı çıkmaz.

## Gereksinim 21 — Sözleşme Yaşam Döngüsü + E-imza `[P2, 8/10]`

Sözleşme taslağı → müzakere → versiyon → imza (e-imza) → yürürlük → yenileme/fesih takibi.

## Öncelik Tablosu

| Öncelik | Modül | Önem |
|---------|-------|------|
| 🔴 P0 | Müvekkil CRM | 10/10 |
| 🔴 P0 | Dava yaşam döngüsü | 10/10 |
| 🔴 P0 | Duruşma & süre yönetimi | 10/10 |
| 🔴 P0 | Görev / workflow | 10/10 |
| 🔴 P0 | UYAP entegrasyonu | 10/10 |
| 🔴 P0 | İcra yönetimi | 10/10 |
| 🔴 P0 | AI dosya asistanı | 10/10 |
| 🔴 P0 | Belge → otomatik aksiyon | 10/10 |
| 🟠 P1 | Delil yönetimi | 9/10 |
| 🟠 P1 | Bilirkişi yönetimi | 9/10 |
| 🟠 P1 | Müvekkil portalı | 9/10 |
| 🟠 P1 | Hukuk bürosu finansı | 9/10 |
| 🟠 P1 | Conflict Check | 9/10 |
| 🟠 P1 | Risk Engine | 9/10 |
| 🟠 P1 | AI Strategy Engine | 9/10 |
| 🟠 P1 | WhatsApp/e-mail iletişimi | 8/10 |
| 🟡 P2 | e-Fatura/e-Arşiv | 8/10 |
| 🟡 P2 | Sözleşme yaşam döngüsü | 8/10 |
| 🟡 P2 | E-imza | 8/10 |
| 🟡 P2 | Kurumsal raporlama | 7/10 |
| 🟡 P2 | Mobil uygulama | 7/10 |

## Strateji Notu

Benchmark ürünü kopyalamak yanlış strateji: onlar AI asistan tarafında ürün-pazar
uyumu yakalamış (150+ avukat beta). NomosOS'un fırsatı:
**"Oradaki AI özelliklerini de yapan, ama hukuk bürosunun bütün operasyonunu yöneten sistem."**
