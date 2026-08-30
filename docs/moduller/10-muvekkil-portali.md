# Modül 10 — Müvekkil Portalı

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 11 (portal kısmı) `[P1, 9/10]`

## Amaç

Müvekkilin "davam ne oldu?" sorusunu telefon etmeden yanıtlayabildiği, büro
uygulamasından tamamen ayrı kimlik doğrulamalı bir self-servis portal sunmak.
Müvekkil kendi dosyalarını, kendisiyle paylaşılan belgeleri, son gelişmeleri, yaklaşan
duruşmaları, kendisinden beklenen işleri, ödeme durumunu ve avukatıyla mesajlaşmasını
tek yerden görür. Portal, avukatın telefon trafiğini azaltırken müvekkile şeffaflık
hissi verir.

Temel tasarım ilkesi **yayın kontrolüdür**: Portal, büro verisinin otomatik aynası
değildir. Avukat (veya tenant politikası) neyin portala yansıyacağına açıkça karar
verir. Her dosya, belge, gelişme ve finans kalemi için "portala yayınla" kararı ayrı
bir kayıttır (`PortalPublication`). Yayınlanmayan hiçbir veri portal API'sinden
sızamaz — bu, uygulama katmanında değil sorgu katmanında garanti edilir.

Son gelişmeler ekranının kalbi AI durum özetidir: sistemdeki teknik safahat kayıtları
(`TimelineEvent`) müvekkilin anlayacağı sade Türkçeye çevrilir ("Bilirkişi raporu
geldi, lehimize noktalar var, 2 hafta içinde itiraz edeceğiz" düzeyinde). Özet her
zaman avukat onayından geçtikten sonra yayınlanır; AI çıktısı müvekkile doğrudan
gitmez.

## Kullanıcı Hikâyeleri

1. **Müvekkil olarak**, e-posta + tek kullanımlık kodla portala girmek istiyorum ki
   şifre yönetimiyle uğraşmadan güvenle dosyalarımı göreyim.
2. **Müvekkil olarak**, Dosyalarım ekranında tüm dosyalarımın durumunu görmek
   istiyorum ki avukatımı aramadan genel resmi bileyim.
3. **Müvekkil olarak**, dosyamdaki son gelişmeleri anlaşılır Türkçe özetle okumak
   istiyorum ki hukuki jargonu çözmek zorunda kalmayayım.
4. **Müvekkil olarak**, yaklaşan duruşmalarımı tarih/saat/mahkeme bilgisiyle görmek
   istiyorum ki takvimimi planlayayım.
5. **Müvekkil olarak**, benden beklenen belgeleri (Yapılması gerekenler) görüp portal
   üzerinden yüklemek istiyorum ki evrak teslimi hızlansın.
6. **Müvekkil olarak**, ödemelerimi ve açık bakiyemi görmek istiyorum ki mali durumu
   netçe takip edeyim.
7. **Müvekkil (tüzel kişi yetkilisi) olarak**, şirketimin tüm dosyalarını tek hesapla
   görmek istiyorum ki her dosya için ayrı takip yapmayayım.
8. **Avukat olarak**, hangi dosya/belge/gelişmenin portala yayınlanacağını tek tek
   seçmek istiyorum ki strateji notları ve iç yazışmalar asla müvekkile görünmesin.
9. **Avukat olarak**, "Durum özeti üret" deyip AI taslağını düzenleyerek yayınlamak
   istiyorum ki 15 dakikalık dosya incelemesi 1 dakikaya insin.
10. **Avukat olarak**, müvekkil mesajlarını büro uygulamasında görev kuyruğu gibi
    görmek istiyorum ki hiçbir mesaj yanıtsız kalmasın.
11. **Partner olarak**, portal erişimini müvekkil bazında açıp kapatmak istiyorum ki
    vekalet ilişkisi biten müvekkilin erişimi anında kesilsin.

## Ekranlar ve UX

Portal ayrı bir web uygulamasıdır (`portal.nomosos.com` veya `/portal`), büro
uygulamasının oturumunu ve çerezlerini paylaşmaz.

### 1. Giriş — `/portal/login`
Bileşenler: e-posta alanı, OTP kod doğrulama, tenant logosu (white-label), KVKK
aydınlatma metni bağlantısı.

### 2. Ana Sayfa / Dosyalarım — `/portal/cases`

```
┌────────────────────────────────────────────────────────────┐
│ NomosOS Portal — ABC Holding A.Ş.        [Mesajlar 🔔 2]   │
├────────────────────────────────────────────────────────────┤
│ ⚖ 2026/145 · İstanbul 12. Asliye Ticaret — Alacak Davası  │
│   Durum: Bilirkişi aşamasında      Son gelişme: 12.08.2026 │
│   "Bilirkişi raporu tebliğ edildi. İtiraz hazırlanıyor."   │
├────────────────────────────────────────────────────────────┤
│ ⚖ 2025/341 · İstanbul 3. İş Mahkemesi — İşe İade          │
│   Durum: Karar bekleniyor          Duruşma: 22.09 09:30    │
├────────────────────────────────────────────────────────────┤
│ [Dosyalarım] [Belgelerim] [Duruşmalar] [Yapılacaklar]      │
│ [Ödemeler] [Mesajlar] [Avukatım]                           │
└────────────────────────────────────────────────────────────┘
```

### 3. Dosya Detayı — `/portal/cases/:caseId`
Bileşenler: durum şeridi, Son Gelişmeler zaman çizelgesi (yayınlanmış özetler),
yayınlanmış belgeler, dosyaya bağlı yapılacaklar ve duruşmalar.

### 4. Belgelerim — `/portal/documents`
Bileşenler: yayınlanmış belge listesi (dosyaya göre gruplu), indirme, önizleme.

### 5. Duruşmalar — `/portal/hearings`
Bileşenler: takvim + liste görünümü, geçmiş duruşma sonucu (yayınlanmış özet).

### 6. Yapılması Gerekenler — `/portal/todos`
Bileşenler: müvekkile atanmış istekler (belge yükle, bilgi ver, onay ver), portal
üzerinden dosya yükleme, tamamlandı işareti.

### 7. Ödemeler — `/portal/payments`
Bileşenler: açık bakiye kartı, fatura listesi + PDF, ödeme geçmişi.

### 8. Mesajlar — `/portal/messages` · **Avukatım** — `/portal/my-lawyer`
Bileşenler: dosya bazlı mesaj dizileri; sorumlu avukat kartı (ad, fotoğraf, telefon,
e-posta, büro adresi).

### Büro tarafı: Portal Yönetimi — `/app/clients/:clientId/portal`
Bileşenler: portal erişimi aç/kapat, PortalUser listesi ve davet, yayın kuyruğu
(yayınlanmamış gelişme/belge önerileri), "AI Durum Özeti Üret" butonu, mesaj kuyruğu.

## Veri Modeli

### PortalUser (yeni — büro `User` tablosundan tamamen ayrı)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id | UUID FK→Client | Bağlı müvekkil (tüzel kişide şirket) |
| email | VARCHAR | Unique(tenant_id, email) |
| full_name | VARCHAR | |
| phone | VARCHAR NULL | SMS OTP için |
| auth_method | ENUM | EMAIL_OTP, SMS_OTP, PASSWORD |
| password_hash | VARCHAR NULL | Yalnızca PASSWORD yönteminde |
| status | ENUM | INVITED, ACTIVE, SUSPENDED |
| last_login_at | TIMESTAMPTZ NULL | |
| kvkk_consent_at | TIMESTAMPTZ NULL | Aydınlatma onay zamanı |

### PortalPublication (yeni — yayın kontrolünün kalbi)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id | UUID FK→Client | |
| case_id | UUID FK→Case NULL | |
| resource_type | ENUM | CASE, DOCUMENT, TIMELINE_SUMMARY, HEARING, FINANCIAL, TODO |
| resource_id | UUID | Kaynak kaydın id'si |
| summary_text | TEXT NULL | TIMELINE_SUMMARY'de yayınlanan sade metin |
| published_by | UUID FK→User | Yayınlayan avukat |
| published_at | TIMESTAMPTZ | |
| status | ENUM | PUBLISHED, RETRACTED |

### PortalMessage (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id / case_id | UUID / NULL | |
| sender_type | ENUM | PORTAL_USER, STAFF |
| sender_id | UUID | PortalUser veya User id |
| body | TEXT | |
| read_at | TIMESTAMPTZ NULL | |
| created_at | TIMESTAMPTZ | |

### PortalTodo (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id / client_id / case_id | UUID | |
| title / description | VARCHAR / TEXT | Örn. "Kira sözleşmesinin aslını yükleyin" |
| todo_type | ENUM | UPLOAD_DOCUMENT, PROVIDE_INFO, APPROVE, OTHER |
| due_date | DATE NULL | |
| status | ENUM | OPEN, DONE, CANCELLED |
| uploaded_document_id | UUID FK→Document NULL | Müvekkil yüklemesi |

## AI Yetenekleri

### CLIENT_STATUS_SUMMARY
- **Girdi:** case_id + son N `TimelineEvent` + son duruşma tutanağı özeti + açık `Deadline`'lar (başlık düzeyi).
- **Çıktı:** Müvekkile hitaben, hukuki jargonsuz, 3-6 cümlelik Türkçe durum özeti + "sonraki adım" cümlesi. Avukat düzenleme ekranına taslak olarak düşer.
- **Gördüğü veri:** Yalnızca ilgili dosyanın safahat başlıkları ve seçili belge özetleri; iç strateji notları ve `internal=true` işaretli kayıtlar asla gönderilmez.
- **KVKK:** Üçüncü kişilerin (karşı taraf, tanık) kimlik verileri maskeleme hattından geçer; müvekkilin kendi verisi maskelenmez. Yerel/BYO-LLM seçiliyse veri dışarı çıkmaz.

### PORTAL_MESSAGE_REPLY_DRAFT
- **Girdi:** Müvekkil mesajı + dosyanın yayınlanmış durum özeti.
- **Çıktı:** Avukat için yanıt taslağı. Otomatik gönderim yoktur; avukat düzenler ve gönderir.
- **KVKK:** Mesaj içeriği PII taramasından geçer.

## İş Kuralları

1. Portal auth, büro auth'undan tamamen ayrıdır: ayrı tablo (PortalUser), ayrı JWT issuer/audience, ayrı oturum deposu. Bir token diğer uygulamada asla geçerli değildir.
2. Portal API'si yalnızca `PortalPublication.status=PUBLISHED` kayıtlara JOIN'lenerek veri döndürür; yayın kaydı olmayan kaynak sorguya hiç girmez (repository katmanında zorunlu filtre).
3. Bir dosyanın portalda görünmesi için önce CASE tipinde yayın kaydı gerekir; dosya yayından kaldırılırsa (RETRACTED) altındaki tüm kaynaklar da görünmez olur.
4. AI durum özeti avukat onayı olmadan yayınlanamaz; yayınlanan metin `PortalPublication.summary_text`'te dondurulur (kaynak TimelineEvent sonradan değişse bile).
5. PortalUser yalnızca kendi `client_id`'sine bağlı verileri görür; tüzel kişide birden çok PortalUser aynı müvekkile bağlanabilir.
6. Müvekkilin yüklediği dosya `Document` olarak `source=PORTAL_UPLOAD` etiketiyle kaydedilir, virüs taramasından geçer ve avukat onayına düşer; otomatik olarak dava klasörüne girmez.
7. Yayınlama, geri çekme, portal girişi ve belge indirme olayları `AuditLog`'a yazılır (PORTAL_* aksiyon tipleri).
8. Client `status=INACTIVE` olduğunda veya vekalet azledildiğinde tüm bağlı PortalUser'lar otomatik SUSPENDED olur.
9. OTP 6 haneli, 5 dakika geçerli, 5 hatalı denemede 15 dakika kilit; oturum süresi 24 saat.
10. FINANCIAL yayını kalem bazlıdır: avukat yalnızca fatura ve tahsilatları yayınlayabilir; büro içi masraf detayı yayınlanamaz.
11. Portal rate limit: IP + kullanıcı başına 60 istek/dk; belge indirme imzalı ve süreli URL ile yapılır.

## API Uçları

Büro tarafı (`/api/v1`, büro auth):

| Method | Yol | Açıklama |
|---|---|---|
| POST | /api/v1/clients/:clientId/portal-users | PortalUser davet et |
| PATCH | /api/v1/portal-users/:id | Askıya al / aktifleştir |
| GET | /api/v1/clients/:clientId/portal/publications | Yayın listesi |
| POST | /api/v1/portal/publications | Kaynak yayınla |
| POST | /api/v1/portal/publications/:id/retract | Yayından kaldır |
| POST | /api/v1/cases/:caseId/portal/ai-status-summary | CLIENT_STATUS_SUMMARY taslağı üret |
| GET/POST | /api/v1/portal/messages | Mesaj kuyruğu / yanıt gönder |
| POST | /api/v1/portal/todos | Müvekkile yapılacak ata |

Portal tarafı (`/portal/api/v1`, PortalUser auth):

| Method | Yol | Açıklama |
|---|---|---|
| POST | /portal/api/v1/auth/otp · /auth/verify | OTP iste / doğrula |
| GET | /portal/api/v1/cases · /cases/:id | Yayınlanmış dosyalar / detay |
| GET | /portal/api/v1/documents · /documents/:id/download | Belgeler (imzalı URL) |
| GET | /portal/api/v1/hearings | Duruşmalar |
| GET/PATCH | /portal/api/v1/todos · /todos/:id | Yapılacaklar / tamamla |
| POST | /portal/api/v1/todos/:id/upload | Belge yükle |
| GET | /portal/api/v1/payments | Faturalar, bakiye, ödeme geçmişi |
| GET/POST | /portal/api/v1/messages | Mesajlar |
| GET | /portal/api/v1/my-lawyer | Sorumlu avukat kartı |

## Diğer Modüllerle İlişkiler

- **Modül 02 Dava Dosyası:** Dosya, safahat (TimelineEvent) ve belge kaynakları buradan yayınlanır.
- **Modül 03 Duruşma:** Yayınlanan duruşmalar portal takvimini besler.
- **Modül 08 Finans / 09 Faturalama:** Ödemeler ekranı yayınlanmış fatura/tahsilat verisini okur.
- **Görev Modülü:** Müvekkil mesajları ve portal yüklemeleri büro tarafında görev üretir.
- **Modül 12 Vekaletname:** Azil, portal erişimini otomatik keser.
- **İletişim Merkezi (G11 diğer yarısı):** Aynı durum özeti WhatsApp/e-posta kanalına da gönderilebilir.

## Kabul Kriterleri

1. PortalUser token'ı ile `/api/v1/*` uçlarına yapılan her istek 401 döndürüyor (ve tersi).
2. Yayınlanmamış dosya/belge, portal API'sinden id tahmin edilerek istendiğinde 404 döndürüyor.
3. Dosya RETRACTED yapıldığında altındaki belge ve gelişmeler tek istekte görünmez oluyor.
4. AI durum özeti üret→düzenle→yayınla akışı çalışıyor; yayınlanan metin, kaynak veri değişse bile sabit kalıyor.
5. Müvekkil portaldan belge yükleyebiliyor; belge avukat onay kuyruğuna düşüyor ve `source=PORTAL_UPLOAD` işaretli.
6. Tüzel müvekkilin iki PortalUser'ı aynı dosyaları görüyor; başka müvekkilin dosyası hiçbir sorguda dönmüyor.
7. OTP kilitleme kuralı çalışıyor (5 hata → 15 dk kilit, test edilebilir).
8. Azil kaydı girildiğinde ilgili PortalUser'lar SUSPENDED oluyor ve mevcut oturumları geçersizleşiyor.
9. Portal giriş, belge indirme ve yayınlama olayları AuditLog'da PORTAL_* tipiyle listeleniyor.
10. Ödemeler ekranı yalnızca FINANCIAL yayını yapılmış kalemleri gösteriyor; yayınlanmamış masraflar görünmüyor.

## Faz

**Faz 4.** Önkoşullar: Dava dosyası + TimelineEvent (Faz 1-2), Finans/Faturalama
(Faz 3, Ödemeler ekranı için), AI görev altyapısı. Mesajlaşma ve PortalTodo Faz 4
içinde ikinci iterasyonda; ilk iterasyon salt-okunur portal (Dosyalarım + Gelişmeler +
Duruşmalar + Belgeler) olarak çıkar.
