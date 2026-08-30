# NomosOS — Vizyon ve Konumlandırma

> Kaynak: `docs/99-kaynak-gereksinimler.md` (21 gereksinim, öncelik tablosu, strateji notu).
> Bu doküman projenin "neden var" ve "ne olacak" sorularına cevap verir; tüm modül
> spec'leri ve yol haritası (`docs/06-yol-haritasi.md`) bu vizyona hizalanır.

## 1. Tez: AI-Native Legal Operating System

Türkiye pazarındaki mevcut ürünler iki uçta toplanıyor:

- **Klasik büro takip programları**: dosya/duruşma listesi tutar, AI'sı yoktur, UYAP ile
  ilişkisi zayıftır, kullanıcı deneyimi eskidir.
- **AI hukuk asistanları** (benchmark ürün sınıfı): dosya analizi, içtihat araştırması,
  dilekçe üretimi ve teyit ajanı gibi AI özelliklerinde güçlüdür; ancak büronun
  **operasyonunu** yönetmez. Müvekkil merkezli görünüm, tam dava yaşam döngüsü, icra,
  finans, görev/workflow ve süre motoru yoktur ya da yüzeyseldir.

**NomosOS'un tezi**: Bu iki ucu birleştiren üçüncü bir kategori kurmak —
**AI-Native Legal Operating System**.

```
Benchmark ürün = Legal AI Assistant
NomosOS        = Legal ERP + Legal DMS + Legal CRM + UYAP Hub + AI Agents + Legal Intelligence
```

Strateji notu (kaynak dokümandan): benchmark ürünü kopyalamak yanlış stratejidir; onlar
AI asistan tarafında ürün-pazar uyumu yakalamıştır. NomosOS'un fırsatı:
**"Oradaki AI özelliklerini de yapan, ama hukuk bürosunun bütün operasyonunu yöneten sistem."**

## 2. Temel İlke: Merkez AI Değil, DOSYA

AI bir "sohbet kutusu" değil, tüm operasyonel verinin üzerinde çalışan zekâ katmanıdır.
Sistemin merkezinde dava/icra **dosyası** ve ona bağlı yapılandırılmış veri durur:
müvekkil, taraflar, duruşmalar, süreler, görevler, deliller, finans, iletişim.
AI bu veriyi okur, tespit ve öneri üretir; **karar ve onay her zaman avukattadır**.

Katman şeması:

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

Okuma yönü: dış kaynaklar (UYAP, mevzuat, içtihat) Legal Core'a akar; Legal Core
operasyonel modülleri besler; AI Engine hepsinin üzerinde çapraz zekâ katmanıdır.
Hiçbir modül "AI'sız çalışamaz" şekilde tasarlanmaz — AI kapalıyken NomosOS yine
eksiksiz bir büro yönetim sistemidir; AI açıkken işletim sistemine dönüşür.

## 3. Hedef Pazar

- **Binlerce avukat ve hukuk bürosu** — çok kiracılı (multi-tenant) SaaS.
- Ölçek yelpazesi: **tek avukatlık ofisten 100+ avukatlı kurumsal bürolara** kadar.
  - Solo avukat: ajanda + süre motoru + AI asistan → "hiçbir şeyi kaçırma" değeri.
  - Orta ölçekli büro (3-20 avukat): görev/workflow, roller (Partner/Avukat/Stajyer/
    Sekreter/Admin), finans, müvekkil iletişimi.
  - Kurumsal büro (20-100+): partner dashboard, risk motoru, conflict check,
    kurumsal raporlama, Private AI / yerel LLM.
- Coğrafya: Türkiye hukuku ve UYAP ekosistemi birinci hedeftir; mimari çok kiracılı ve
  yerelleştirilebilir kurulur.

## 4. BYO-LLM: Stratejik Fark

Her büro (tenant) kendi LLM'ini bağlar: **Anthropic, OpenAI + OpenAI-uyumlu,
Ollama/yerel, Gemini, tamamen özel endpoint**.

Bunun üç stratejik değeri var:

1. **KVKK / Private AI**: Benchmark üründeki kırmızı bayrak, kişisel veri maskelemenin
   kullanıcıya bırakılmasıdır. NomosOS bunu sistem seviyesinde çözer
   (Tespit → "Kişisel veri tespit edildi" → Maskele → Onayla → AI'a gönder) ve
   BYO-LLM ile bir adım öteye taşır: Ollama/yerel model veya şirket-içi custom endpoint
   seçildiğinde **veri büronun dışına hiç çıkmaz**. Enterprise mesajı:
   **"Verileriniz dış LLM'e gönderilmez."**
2. **Maliyet mimarisi**: AI token maliyeti tenant'ın kendi API anahtarına/altyapısına
   yazılır. NomosOS'un birim ekonomisi AI kullanımından bağımsızlaşır; agresif AI
   özellikleri "maliyet korkusu" olmadan sunulabilir.
3. **Kilitlenmeme (no lock-in)**: Model pazarı hızla değişiyor; büro istediği an model
   değiştirir, NomosOS model-agnostik kalır. Satış itirazı ("hangi AI'a güveneceğiz?")
   mimariyle cevaplanır.

## 5. Temel Ürün İlkeleri

1. **AI önerir, avukat onaylar.** Hiçbir AI çıktısı (süre, görev, dilekçe, müvekkil
   mesajı) avukat onayı olmadan hukuki sonuç doğuran bir kayda veya gönderime dönüşmez.
2. **Deterministik süre hesabı.** Kesin hukuki süreler mevzuat + dosya tarihi + tebliğ
   yöntemi + resmi tatiller ile kural motorunda deterministik hesaplanır. AI yalnızca
   tespit ve öneri üretir ("Bu karar 18 Ağustos'ta tebliğ edilmiş, istinaf için son gün
   1 Eylül olabilir — kontrol et."). Hibrit: kural motoru + AI önerisi.
3. **Kaynak gösterme zorunluluğu.** Hukuki iddia içeren her AI çıktısı dayanağını
   gösterir: madde numarası, içtihat künyesi, dosyadaki belge referansı. Kaynaksız
   hukuki beyan arayüzde "doğrulanmamış" olarak işaretlenir.
4. **Teyit Ajanı.** Üretilen içtihat/mevzuat atıfları ikinci bir ajan tarafından
   kaynağa karşı doğrulanır; halüsinasyon riski ürün seviyesinde yönetilir.
5. **Olay-tabanlı otomasyon.** "Belge yükle → analiz et" değil, "belge geldi → sistem
   ne yapılması gerektiğini kendisi çıkardı" (görev, süre, atama, müvekkil bilgilendirme
   taslağı) — hepsi onay kuyruğuna düşer.
6. **Müvekkil ≠ tek dosya.** CRM müvekkil merkezlidir: 37 dava + 82 icra + 14
   arabuluculuk + sözleşmeler + finans tek karttan görünür.
7. **KVKK by design.** Kişisel veri tespiti ve maskeleme, AI'a giden her akışın önünde
   sistem seviyesinde durur; denetlenebilir log tutulur.

## 6. İş Modeli Önerisi

**Kullanıcı/ay SaaS aboneliği**, yıllık ödemede indirim. Kademeler:

| Kademe | Hedef | Kapsam (özet) |
|--------|-------|----------------|
| **Solo** | Tek avukat / 1-2 kişilik ofis | Legal Core (CRM, dava, duruşma, süre, görev), AI asistan (kendi API anahtarıyla), UYAP extension |
| **Büro** | 3-20 avukat | Solo + roller/workflow, icra + İcra Copilot, finans, faturalama, müvekkil iletişimi, raporlar |
| **Enterprise** | 20-100+ avukat, kurumsal | Büro + Private AI/yerel LLM, Türkiye veri bölgesi, SSO, conflict check, risk motoru, partner dashboard, kurumsal raporlama, SLA, özel onboarding |

- **BYO-LLM sayesinde AI maliyeti kullanıcıya aittir**: her kademede AI, büronun kendi
  anahtarı/endpoint'i ile çalışır. Bu, fiyatın öngörülebilir ve marjın korunur olmasını
  sağlar; istenirse ileride "NomosOS anahtarı ile kullanım" ayrı ölçülü bir eklenti
  olarak sunulabilir.
- Ek gelir kalemleri (aday): e-Fatura/e-Arşiv entegrasyon eklentisi, e-imza paketi,
  müvekkil portalı için kullanım üstü müvekkil koltukları, kurulum/onboarding hizmeti.

## 7. Başarı Tanımı

- Avukatın günü NomosOS'ta başlar ("Bugün hangi duruşmalarım var?", "müdahale etmem
  gereken 10 şey") ve UYAP dahil tüm operasyon buradan yönetilir.
- Hiçbir süre kaçmaz: süre motoru + belge→aksiyon hattı, büronun sigortasıdır.
- Partner, büronun tamamını tek ekrandan görür: dosya, risk, tahsilat, iş yükü.
- Enterprise müşterisi KVKK sorusuna tek cümleyle cevap verir:
  "Verilerimiz kendi LLM'imizde, dışarı çıkmıyor."
