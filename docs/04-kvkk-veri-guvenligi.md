# NomosOS — KVKK ve Veri Güvenliği Mimarisi

Benchmark üründeki kırmızı bayrak: kişisel verilerin maskelenmesi **kullanıcıya**
bırakılmış. NomosOS bunu sistem seviyesinde çözer (Gereksinim 20). Bu, hukuk
bürolarına satışta ürün bariyerini kaldıran ve enterprise'da fark yaratan katmandır.

## Temel Akış: Tespit → Maskele → Onayla → Gönder

Dış LLM sağlayıcısına (ANTHROPIC / OPENAI_COMPAT / GEMINI) gidecek **her** metin
önce PII taramasından geçer (`packages/ai/src/pii.ts`):

```
Kullanıcı metni / belge içeriği
  → scanPii(text)
      tespit: TCKN (algoritmik doğrulama) · IBAN (TR) · Telefon (+90 5xx) · E-posta
  → PII yoksa                → doğrudan gönder
  → PII varsa
      → API 409 döner: { requiresPiiApproval, findings, maskedText }
      → Arayüz: "Kişisel veri tespit edildi" + maskeli önizleme
      → Kullanıcı "Maskele ve Gönder" onayı verir (piiApproved: true)
      → maskedText gönderilir; AiUsageLog.piiMasked = true
```

Maske etiketleri: `[TCKN-MASKELİ]`, `[IBAN-MASKELİ]`, `[TELEFON-MASKELİ]`, `[EPOSTA-MASKELİ]`.

### Yerel/özel sağlayıcı istisnası

`OLLAMA` ve büro-içi `CUSTOM` endpoint'lerde veri büro ağından çıkmadığı için
maskeleme **zorunlu değildir** (`isExternalProvider()` false). Arayüz yine de
bilgilendirir: "Bu sağlayıcı yereldir; verileriniz dışarı gönderilmez."

### Kapsam genişlemesi (Faz 2+)

Regex tabanlı iskelet şunları kapsar: TCKN, IBAN, telefon, e-posta.
Faz 2'de NER (adlandırılmış varlık tanıma) tabanlı tespit eklenir: ad-soyad,
adres, sağlık verisi, çocuk bilgisi; belge OCR çıktıları da aynı hattan geçer.
RAG için saklanan `DocumentChunk` içerikleri **maskeli** saklanır (Modül 24).

## Private AI / Türkiye Veri Bölgesi (Enterprise)

Kademeli teklif:
1. **Standart**: büro kendi dış LLM anahtarını bağlar; maskeleme hattı zorunlu.
2. **Private AI**: yalnızca OLLAMA/CUSTOM (yerel) sağlayıcılara izin veren tenant
   politikası — "Verileriniz dış LLM'e gönderilmez" garantisi tek ayarla.
3. **Türkiye veri bölgesi** (yol haritası): uygulama + veritabanı + belge deposu
   Türkiye'de barındırılır; ayrık veritabanı seçeneği.

Tenant politika alanı (Faz 2): `Tenant.aiPolicy = SERBEST | SADECE_YEREL`.

## Veri Güvenliği Kontrolleri

| Katman | Kontrol |
|--------|---------|
| Kimlik | bcrypt parola, JWT (12h), rol tabanlı yetki (RBAC) |
| İzolasyon | Satır seviyesi tenant süzgeci; tenant-ötesi negatif testler her fazda |
| Sırlar | AI anahtarları AES-256-GCM; `MASTER_ENCRYPTION_KEY` yalnızca ortam değişkeninde |
| Belgeler | MinIO/S3 özel bucket; erişim yalnızca API üzerinden ön-imzalı URL ile (Faz 1) |
| Aktarım | Üretimde her uçta TLS; extension→API extension token'ı |
| İz | `AuditLog` (kim, ne, ne zaman) + `AiUsageLog` (hangi veri AI'a, maskeli mi) |
| Silme | KVKK veri öznesi talepleri: müvekkil bazlı dışa aktarım + anonimleştirme prosedürü (Faz 3) |

## KVKK Uyum Notları (ürün gereksinimi olarak)

- **Aydınlatma**: büro, müvekkillerine karşı veri sorumlusudur; NomosOS veri
  işleyendir. Sözleşme setine Veri İşleme Ek Protokolü (DPA) dahil edilir (Faz 1).
- **Amaç sınırlılığı**: AI'a giden bağlam, görevin gerektirdiği asgari veriyle
  sınırlı tutulur (veri minimizasyonu — örn. OFFICE_QUERY deseninde LLM'e satır
  verisi değil sorgu planı üretimi yaptırılır, bkz. Modül 24).
- **Üçüncü kişi verileri**: karşı taraf ve tanık verileri de kişisel veridir;
  maskeleme hattı ayrımsız uygulanır.
- **Saklama süreleri**: dosya kapanışı + yasal saklama süresi sonunda arşiv/imha
  politikası (Faz 3'te otomatik kural).

## Kabul Kriterleri (Faz 0-1)

1. Dış sağlayıcıya PII içeren metin, kullanıcı onayı olmadan **gönderilemez** (409).
2. Onay sonrası giden metinde ham TCKN/IBAN/telefon/e-posta bulunmaz.
3. OLLAMA sağlayıcısında onay adımı atlanır, bilgilendirme gösterilir.
4. `AiUsageLog.piiMasked` alanı gerçeği yansıtır.
5. API yanıtlarında `encryptedApiKey` asla görünmez.
6. Farklı tenant'ın kaydına ID ile erişim 404/403 döner (izolasyon testi).
