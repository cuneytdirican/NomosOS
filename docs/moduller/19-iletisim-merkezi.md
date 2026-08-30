# Modül 19 — Müvekkil İletişim Merkezi

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 11'in iletişim kısmı `[P1, WhatsApp/e-posta 8/10]`

## Amaç

İletişim Merkezi, büronun müvekkille tüm yazışmasını tek çatı altında toplar: WhatsApp Business API, e-posta ve SMS kanallarından gelen-giden her mesaj `CommunicationLog` olarak kaydedilir, ilgili müvekkile ve mümkünse dosyaya bağlanır. Hedef, "müvekkil geçen ay ne sormuştu, kim ne cevap vermişti?" sorusunun tek zaman çizelgesinde cevaplanmasıdır — avukatın telefonundaki WhatsApp'ta kaybolan kurumsal hafıza sisteme taşınır.

Modülün AI tarafı **durum özeti üretimi**dir: müvekkil "davam ne oldu?" diye aradığında avukat 15 dakika dosya incelemez; "durum özeti hazırla" der, AI dosyanın safahatını **hukukçu olmayan birinin anlayacağı Türkçeyle** özetler (`CLIENT_STATUS_SUMMARY`). Kritik ilke **onay akışıdır**: *AI taslak yazar → avukat düzenler/onaylar → sistem gönderir.* Hiçbir AI metni onaysız müvekkile ulaşmaz; gönderim, onaylayan kullanıcı kimliğiyle loglanır.

Gelen mesajlar için eşleştirme hattı çalışır: webhook ile düşen mesaj telefon/e-posta üzerinden müvekkile otomatik bağlanır; müvekkilin birden çok dosyası varsa AI içerikten dosya önerir (`MESSAGE_CASE_MATCH`), sekreter/avukat onaylar. Cevapsız kalan mesajlar Partner Dashboard'un öncelik havuzuna düşer.

## Kullanıcı Hikâyeleri

1. **Avukat** olarak, müvekkil aradığında dosyanın "İletişim" sekmesinden tüm kanalların birleşik geçmişini görmek isterim; böylece bağlamı 10 saniyede kaparım.
2. **Avukat** olarak, "durum özeti hazırla" dediğimde AI'ın anlaşılır Türkçe taslak yazmasını, düzenleyip tek tıkla WhatsApp'tan göndermeyi isterim.
3. **Sekreter** olarak, duruşma tarihi değiştiğinde şablondan ("duruşma erteleme bildirimi") mesaj hazırlayıp avukat onayına sunmak isterim.
4. **Partner** olarak, onay bekleyen giden mesajları tek kuyruğda görüp onaylamak/düzeltmek isterim; büro adına çıkan her metin kontrolümden geçsin.
5. **Sekreter** olarak, gelen WhatsApp mesajının hangi dosyayla ilgili olduğu belirsizse AI'ın önerdiği dosyayı onaylayarak bağlamak isterim.
6. **Avukat** olarak, 48 saattir cevapsız müvekkil mesajlarının görev/uyarıya dönüşmesini isterim; hiçbir müvekkil sorusu unutulmasın.
7. **Müvekkil** olarak (portal üzerinden), avukatıma mesaj yazmak ve dosyamla ilgili bilgilendirmeleri tek yerden görmek isterim.
8. **Admin** olarak, kanal yapılandırmalarını (WhatsApp Business hesabı, SMTP, SMS sağlayıcı) tenant ayarlarından yönetmek isterim.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Gelen Kutusu | `/app/communications` | Kanal/durum filtreli birleşik kutu, cevapsız rozetleri, dosyaya bağlama paneli |
| Dosya İletişimi | `/app/cases/:caseId/communications` | Dosyaya bağlı zaman çizelgesi, "Durum özeti hazırla" butonu |
| Müvekkil İletişimi | `/app/clients/:clientId/communications` | Müvekkilin tüm dosyalardaki geçmişi |
| Onay Kuyruğu | `/app/communications/approvals` | Bekleyen taslaklar, önizleme, Onayla/Düzenle/Reddet |
| Şablonlar | `/app/settings/communication-templates` | Şablon CRUD, değişkenler ({{muvekkil_ad}}, {{durusma_tarihi}}...) |

ASCII wireframe — Onay Kuyruğu:

```
┌─ Giden Mesaj Onay Kuyruğu (4 bekliyor) ────────────────────────────┐
│ ● ABC Holding — 2026/145        Kanal: WhatsApp   Taslak: AI       │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ Sayın Yetkili, 2026/145 sayılı dosyanızda bilirkişi raporu     │ │
│ │ 12.08.2026'da tebliğ edilmiştir. Rapora iki hafta içinde       │ │
│ │ itiraz hakkımız bulunmaktadır; itiraz dilekçemiz hazırlanmakta │ │
│ │ olup gelişmelerden bilgilendirileceksiniz.                     │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ Hazırlayan: AI (CLIENT_STATUS_SUMMARY) · Talep: Av. Kaya 09:40     │
│ KVKK: ✔ kişisel veri taraması temiz                                │
│ [✔ Onayla ve Gönder]  [✎ Düzenle]  [✖ Reddet]  [Dosyayı Aç]        │
├────────────────────────────────────────────────────────────────────┤
│ ○ Mehmet Yılmaz — 2025/341      Kanal: SMS        Taslak: Şablon   │
└────────────────────────────────────────────────────────────────────┘
```

## Veri Modeli

**CommunicationLog** (gelen + giden tüm mesajların birleşik kaydı)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| client_id | uuid FK→Client null | Eşleşmemiş gelen mesajda null olabilir |
| case_id | uuid FK→Case null | Dosya bağlama sonrası dolar |
| channel | enum(WHATSAPP, EMAIL, SMS, PORTAL, PHONE_NOTE) | PHONE_NOTE: telefon görüşmesi elle notu |
| direction | enum(INBOUND, OUTBOUND) | |
| body | text | Mesaj içeriği |
| attachments | jsonb | [{document_id, filename}] — ekler `Document`'a kaydedilir |
| external_id | text | Sağlayıcı mesaj id'si (webhook idempotency) |
| match_status | enum(MATCHED, SUGGESTED, UNMATCHED) | Dosya eşleştirme durumu |
| match_suggestion | jsonb null | {case_id, confidence, reason} — AI önerisi |
| status | enum(RECEIVED, READ, SENT, DELIVERED, FAILED) | Kanal durum geri bildirimi |
| outbound_message_id | uuid FK→OutboundMessage null | Giden mesajın onay iziyle bağı |
| occurred_at / created_by | timestamptz / uuid null | |

**OutboundMessage** (onay akışı taşıyıcısı)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| client_id / case_id | uuid FK | |
| channel | enum(WHATSAPP, EMAIL, SMS) | |
| draft_body / final_body | text | AI/şablon taslağı ve gönderilen son metin |
| source | enum(AI_DRAFT, TEMPLATE, MANUAL) | |
| template_id | uuid FK→MessageTemplate null | |
| ai_usage_log_id | uuid FK→AiUsageLog null | AI taslaksa zorunlu |
| status | enum(DRAFT, PENDING_APPROVAL, APPROVED, SENT, DELIVERED, FAILED, REJECTED) | Durum makinesi |
| requested_by / approved_by | uuid FK→User | approved_by ≠ null olmadan SENT olamaz |
| pii_scan | jsonb | Gönderim öncesi kişisel veri taraması sonucu |
| sent_at / created_at | timestamptz | |

**MessageTemplate**

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| name / channel / body | text/enum/text | Body, {{degisken}} yer tutucuları içerir |
| variables | jsonb | Beklenen değişken listesi + kaynak alan eşlemesi |
| category | enum(DURUM_OZETI, DURUSMA, TAHSILAT, EVRAK_TALEBI, GENEL) | |
| requires_approval | bool | Varsayılan true; false yalnız ADMIN kararıyla (örn. randevu hatırlatma) |
| is_active / created_by | bool / uuid | |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı |
|---|---|
| `CLIENT_STATUS_SUMMARY` | Dosya safahatı + son gelişmeler + hedef kanal (uzunluk sınırı) → hukukçu olmayan dille durum özeti taslağı |
| `MESSAGE_CASE_MATCH` | Gelen mesaj metni + müvekkilin açık dosya listesi (no + kısa özet) → {case_id, confidence 0-1, reason} veya "eşleşme yok" |
| `COMM_TONE_REWRITE` (ops.) | Taslak + hedef ton (resmi/sade) → yeniden yazım |

`CLIENT_STATUS_SUMMARY` sistem prompt taslağı:

```
Sen bir Türk hukuk bürosunun müvekkil iletişiminden sorumlu avukatısın.
Sana bir dosyanın safahatı ve son gelişmeleri verildi. Görevin: müvekkile
gönderilecek, HUKUKÇU OLMAYAN birinin anlayacağı sade Türkçe bir durum özeti
taslağı yazmak. KURALLAR: (1) Hukuki terim kullanman gerekiyorsa tek cümlede
açıkla ("istinaf, yani kararın üst mahkemece incelenmesi"). (2) Sonuç garantisi
verme, olasılık taahhüt etme ("kazanacağız" deme). (3) Yalnızca verilen safahat
bilgisine dayan; tarih ve tutar uydurma. (4) Bir sonraki adımı ve varsa
müvekkilden beklenen aksiyonu belirt. (5) Kanal {channel}: WhatsApp/SMS için
en fazla {max_len} karakter, e-posta için konu satırı + gövde üret.
(6) Bu bir TASLAKTIR; "taslak" olduğunu belirtme, avukat onaylayacak.
```

**KVKK notu**: (a) AI'a giden dosya bağlamı maskeleme hattından geçer; (b) giden her mesaj **gönderim öncesi** kişisel veri taramasından geçer (`pii_scan`) — üçüncü kişi TCKN'si, sağlık verisi vb. tespitinde onay ekranı uyarı gösterir; (c) WhatsApp/SMS sağlayıcılarına yalnız alıcı numarası ve onaylı metin gider; (d) tüm AI çağrıları `AiUsageLog`'a yazılır. Müvekkilin iletişim tercihi (`Client.consent`) yoksa pazarlama-dışı bile olsa toplu gönderim engellenir.

## İş Kuralları

1. AI veya şablon kaynaklı hiçbir mesaj `approved_by` dolmadan gönderilemez; onaylayan, gönderilen `final_body`'nin sorumlusudur (AuditLog'a yazılır).
2. Onay yetkisi AVUKAT ve üstü; SEKRETER taslak hazırlar, gönderemez. `requires_approval=false` şablonlar yalnız değişken-doldurmalı sabit metinlerdir ve serbest metin alanı içeremez.
3. Taslak düzenlendiğinde `draft_body` korunur, `final_body` ayrı saklanır (AI'ın ne önerdiği ile ne gönderildiği ayrıştırılabilir).
4. Gelen mesaj `external_id` ile idempotent işlenir; aynı webhook iki kez düşerse tek kayıt oluşur.
5. `MESSAGE_CASE_MATCH` confidence ≥ 0.85 ise öneri otomatik ön-seçili gelir ama yine insan onayıyla MATCHED olur; < 0.5 ise öneri gösterilmez, UNMATCHED kalır.
6. INBOUND mesaj 48 saat RECEIVED/READ'de kalırsa sorumlu avukata görev açılır ve dashboard öncelik havuzuna aday olur.
7. Gönderim FAILED olursa 3 deneme (backoff'lu); yine başarısızsa mesaj sahibine bildirim + kayıt FAILED kalır, sessiz kaybolmaz.
8. Simülasyon/strateji içerikleri ve iç notlar İletişim Merkezi'nden gönderilemez (kaynak modül kısıtı); yalnız durum özeti ve şablon kategorileri müvekkile çıkar.
9. Müvekkil silme/anonimleştirme (KVKK talebi) durumunda `CommunicationLog.body` anonimleştirilir, kayıt iskeleti ve AuditLog izi korunur.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/communications?channel=&status=&match_status=` | Birleşik kutu |
| GET | `/api/v1/cases/:caseId/communications` / `/api/v1/clients/:clientId/communications` | Bağlam görünümleri |
| POST | `/api/v1/cases/:caseId/communications/draft-status-summary` | body: {channel} → AI taslak (async) |
| POST | `/api/v1/outbound-messages` | Taslak oluştur (şablon/manuel) |
| PATCH | `/api/v1/outbound-messages/:id` | Taslağı düzenle |
| POST | `/api/v1/outbound-messages/:id/approve` | Onayla → gönderim kuyruğu |
| POST | `/api/v1/outbound-messages/:id/reject` | Reddet (gerekçeli) |
| POST | `/api/v1/communications/:id/link-case` | body: {case_id} → dosyaya bağla |
| POST | `/api/v1/webhooks/whatsapp` · `/email-inbound` · `/sms` | Sağlayıcı webhook'ları (imza doğrulamalı) |
| CRUD | `/api/v1/communication-templates` | Şablon yönetimi |

## Diğer Modüllerle İlişkiler

- **Müvekkil CRM**: iletişim geçmişi müvekkil kartının sekmesidir; iletişim tercihi/rıza alanları Client'tan okunur.
- **Müvekkil Portalı**: PORTAL kanalı bu modülün kaydına düşer; portal mesajları aynı onay akışıyla cevaplanır.
- **Belge→Aksiyon hattı**: "müvekkil bilgilendirme taslağı oluştur" otomatik aksiyonu bu modülde DRAFT üretir.
- **Görev/Workflow**: cevapsız mesaj → görev; onay kuyruğu görev sayacına yansır.
- **Partner Dashboard (18)**: cevapsız mesajlar ve bekleyen onaylar öncelik adayıdır.
- **AI Agents (21)**: Müvekkil İletişim Ajanı bu modülün görevlerini yürütür; KVKK maskeleme hattı Gereksinim 20 bileşenidir.

## Kabul Kriterleri

1. WhatsApp webhook'una düşen mesaj 30 sn içinde birleşik kutuda görünür; telefon numarası kayıtlı müvekkile otomatik bağlanır (client_id dolu).
2. Aynı `external_id` ile iki webhook çağrısı tek `CommunicationLog` kaydı üretir.
3. `approved_by` boşken gönderim denemesi 409 döner; onay sonrası mesaj SENT→DELIVERED durum güncellemeleri webhook'la kayda işlenir.
4. AI taslağı düzenlenip gönderildiğinde `draft_body` ve `final_body` farklı saklanır; her ikisi de onay ekranında diff olarak görülebilir.
5. Çok dosyalı müvekkilin mesajında `MESSAGE_CASE_MATCH` önerisi confidence ve gerekçeyle gösterilir; insan onayı olmadan `case_id` yazılmaz.
6. 48 saat cevapsız INBOUND mesaj için sorumlu avukata görev açılır (test: saat ileri alınarak).
7. SEKRETER token'ı approve ucunda 403 alır; taslak oluşturma 201 döner.
8. `pii_scan` üçüncü kişi TCKN'si tespit ettiğinde onay ekranı engelleyici uyarı gösterir; "yine de gönder" kararı AuditLog'a gerekçeyle yazılır.
9. Şablondaki {{degisken}} alanları dosya verisiyle doldurulur; çözülemeyen değişken varsa taslak onaya düşmeden hata verir.
10. Farklı tenant'ın iletişim kaydına erişim 404; webhook imza doğrulaması geçersizse 401 döner.

## Faz

**Faz 5.** Alt sıra: 5.1 CommunicationLog + e-posta kanalı + manuel/şablon gönderim + onay akışı → 5.2 WhatsApp Business API + SMS + webhook eşleştirme (`MESSAGE_CASE_MATCH`) → 5.3 `CLIENT_STATUS_SUMMARY`, cevapsız mesaj kuralları, portal kanalı entegrasyonu. Belge→Aksiyon hattının "bilgilendirme taslağı" aksiyonu bu modül yayınlanana dek görev notu olarak düşer.
