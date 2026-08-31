# NomosOS Mobil (`@nomosos/mobile`)

Avukatın **sahada** — adliye koridorunda, duruşma öncesi, yolda — kullandığı uygulama.
Masaüstü panelinin küçültülmüş hâli **değildir**: yalnızca sahada gerçekten gereken şeyler vardır.

Expo SDK 52 (managed workflow) · React Native 0.76 · TypeScript (strict) · expo-router (dosya tabanlı yönlendirme).

---

## 1. Kurulum ve çalıştırma

Bağımlılıklar depo kökündeki pnpm çalışma alanından kurulur (bu iş **Entegrasyon** ajanınındır;
tek başına `pnpm install` çalıştırmayın):

```bash
# depo kökünde — bir kez
pnpm install

# uygulamayı başlat
pnpm --filter @nomosos/mobile start
# ya da
cd apps/mobile && npx expo start
```

Açılan ekrandaki QR kodu **Expo Go** ile okutun (iOS: Kamera, Android: Expo Go içindeki tarayıcı).
`i` / `a` tuşları iOS simülatörünü / Android emülatörünü açar.

### API adresi

`apps/api` varsayılan olarak `:3001` portunda çalışır. İstemci taban adresi şu sırayla çözülür:

1. `EXPO_PUBLIC_API_URL` ortam değişkeni (`.env` — örnek için `.env.example`)
2. `app.json` → `expo.extra.apiUrl`
3. **Expo geliştirme sunucusunun IP'si + `:3001`** ← çoğu durumda hiçbir şey yapmanız gerekmez
4. `http://localhost:3001`

> **Gerçek cihazda `localhost` çalışmaz.** Telefon için `localhost` telefonun kendisidir.
> 3. adım tam da bunun için vardır: Expo, geliştirme makinenizin LAN IP'sini bildiği için
> istemci API'yi `http://<makine-ip>:3001` olarak hedefler. Makinenizin güvenlik duvarında
> 3001 portunun yerel ağa açık olması gerekir.

Demo giriş: `partner@demo.nomosos.local` / `Demo1234!`

### Cihazda çalıştırma (Expo Go dışı)

Expo Go, `expo-local-authentication` gibi yerel modülleri **taşır**; biyometrik kilit Expo Go'da da
çalışır. Mağazaya çıkacak sürüm için `eas build` gerekir; imzalama anahtarları ve APNs/FCM
yapılandırması Entegrasyon ajanının işidir.

---

## 2. Ekranlar

| Yol | Ekran | Ne işe yarar |
|---|---|---|
| `/giris` | Giriş | E-posta + şifre, "beni hatırla", biyometrik kurulum önerisi |
| `/` | **Bugün** | Bugünün duruşmaları · kritik süreler · görevlerim. Ana ekran. |
| `/sureler` | Süreler | Açık + gecikmiş süreler, kalan gün renklendirmesi, **AI önerisi onay/ret** |
| `/gorevler` | Görevler | Bana atanmış açık görevler, **durum değiştirme** |
| `/dosyalar` | Dosyalar | Esas no / müvekkil / taraf araması |
| `/bildirimler` | Bildirimler | Bildirim listesi, okundu işaretleme |
| `/durusma/[id]` | Duruşma detayı | Künye, hazırlık paketi, **duruşma sonrası hızlı not** |
| `/dosya/[id]` | Dosya detayı | Künye, taraflar, safahat, süreler, belgeler |
| `/ayarlar` | Ayarlar | Çıkış, biyometrik anahtar, cihaz kaydı, güvenlik beyanı |

Sekme çubuğu beş sekmeyle sınırlıdır; altıncısı dokunma hedeflerini adliyede kullanılamayacak
kadar daraltır. Ayarlar, Bugün ekranının başlığındaki dişli simgesindedir.

---

## 3. Sunucu uçları

Tümü **kiracı (büro) API'sidir**: `/api/v1`, JWT `aud="tenant"`.
Platform (`/api/admin/v1`) ve müvekkil portalı (`/api/v1/portal`) uçlarına bu uygulamadan
**erişilmez** — üç kimlik alanı karışmaz.

Eşleme tek bir dosyada toplanmıştır: `src/api/endpoints.ts`.

| Ekran | Uç |
|---|---|
| Giriş | `POST /auth/login` |
| Oturum bilgisi | `GET /me` |
| Bugün | `GET /hearings?from&to&status=PLANLANDI` · `GET /deadlines?open=true&to=+3g` · `GET /dashboard/summary?scope=me` |
| Süreler | `GET /deadlines?open=true&to=+30g` · `GET /deadlines?status=BEKLIYOR&source=AI_ONERISI` |
| Süre onay/ret | `PATCH /deadlines/:id/status` (`ONAYLANDI` / `IPTAL` + gerekçe) |
| Görevler | `GET /tasks?assigneeId&open=true` · `GET /tasks/:id` · `PATCH /tasks/:id/status` |
| Dosyalar | `GET /cases?q=` · `GET /cases/:id` |
| Belge açma | `GET /documents/:id/download` (süreli imzalı URL, sunucu denetim kaydı yazar) |
| Duruşma | `GET /hearings/:id` · `PATCH /hearings/:id` (yalnız `note`) |
| Bildirimler | `GET /notifications` · `PATCH /notifications/:id/read` |
| Cihaz kaydı | `POST /device-tokens` |

> **Bildirim ve cihaz kaydı uçları Zamanlı-iş modülüyle birlikte yayına girer.** Sunucu bu uçları
> henüz tanımıyorsa 404 döner; uygulama bunu hata olarak değil, "modül henüz açık değil" bilgisi
> olarak gösterir ve geri kalan her şey çalışmaya devam eder.

### Neden `/deadlines/upcoming` kullanılmıyor?

`upcoming` ucu `dueDate >= now` süzer. `Deadline.dueDate` şemada `@db.Date`, yani **UTC gün başı**.
Bu yüzden sabahın ilk saatinden sonra **bugün dolan süreler listeden düşer**. Sahada "bugün son gün"
bilgisi kaçırılamaz; bunun yerine `GET /deadlines?open=true&to=…` kullanılır — alt sınır konmadığı
için gecikmiş süreler de listeye girer.

---

## 4. Yazma işlemleri — bilinçli olarak dört tane

Mobil **salt-okur ağırlıklıdır**. İzin verilen tüm yazmalar:

1. **Duruşma notu ekleme/düzenleme** — `PATCH /hearings/:id` (yalnız `note`)
2. **Görev durumu değiştirme** — `PATCH /tasks/:id/status`
3. **Süre önerisini onaylama / reddetme** — `PATCH /deadlines/:id/status`
4. **Bildirim okundu** — `PATCH /notifications/:id/read`

Bunların dışında hiçbir `POST`/`PATCH`/`DELETE` çağrısı yoktur.

### Mobilde bilinçli olarak OLMAYAN özellikler

| Özellik | Neden yok |
|---|---|
| Dosya / müvekkil açma | Alan sayısı fazla, KVKK onayı ve çakışma taraması gerektirir; yarım kalmış bir dosya kaydı en kötü sonuçtur. |
| Dilekçe üretimi | Uzun AI çıktısının kaynak kontrolü küçük ekranda yapılamaz; "kaynak gösterme zorunlu" ilkesi gereği gözden geçirme masaüstünde olmalıdır. |
| Belge yükleme | Otomatik aksiyon hattını (sınıflandırma, süre önerisi) tetikler; koridorda yanlış dosyaya yüklenen bir tebligat zincirleme hata doğurur. |
| Finans / fatura / tahsilat | Para hesapları deterministiktir ve rol kısıtlıdır (STAJYER göremez); mobilde bu alana hiç girilmez. |
| Raporlar | Rakamlar tablo hâlinde okunur; telefon ekranı yanlış okumaya davetiye çıkarır. |
| İcra takibi, çakışma taraması, AI asistanı, e-imza | Masaüstü iş akışları; sahada ihtiyaç doğmaz. |
| **Duruşma SONUCU girme** (`/hearings/:id/result`) | Safahat açar, dosya durumunu değiştirir, erteleme hâlinde yeni duruşma yaratır. Geri alması zor bir işlem tek elle, acele ederken yapılmamalı. Mobil yalnızca `note` yazar. |
| Süre AÇMA / TAMAMLAMA / "kaçırıldı" işaretleme | İlki hesap izinin görülmesini, sonuncusu meslek sorumluluğu doğuran bir tespiti gerektirir. |
| Görev açma / atama / düzenleme | Sorumlu ve kontrol eden seçimi büro içi bir karardır. |
| **Sesli not** | Bkz. §6. |
| **Tam çevrimdışı senkron** | Bkz. §5. |

Uygulama bu işlemleri "yokmuş gibi" göstermez: ilgili ekranlarda *"… mobilde yapılmaz, büro
panelinden yürütülür"* notu vardır. Kullanıcı bozuk bir uygulama değil, bilinçli bir sınır görür.

---

## 5. Çevrimdışı davranış

**Tam çevrimdışı senkron yoktur.** Çift yönlü senkron çakışma çözümü demektir; bir hukuk
uygulamasında çakışma çözümünün sessizce yanlış tarafı seçmesi *süre kaçırmak* demektir.

Bunun yerine:

- **Okuma:** "Bugün" ekranının verisi her başarılı çekilişte indirgenmiş biçimde önbelleğe yazılır.
  Bağlantı yoksa bu kopya gösterilir ve üstte **"Çevrimdışı — son güncelleme HH:MM"** şeridi çıkar.
  Önbellekten gelen kayıtlar tıklanmaz (detay için ağ gerekir).
- **Yazma:** kuyruğa **alınmaz**. Bağlantı yoksa kullanıcıya *"bağlantı gerekli"* denir ve yazdığı
  metin pencerede durur. **Sessiz veri kaybı yoktur.**

Diğer ekranlar (Süreler, Görevler, Dosyalar, Bildirimler) önbelleklenmez — yaşlı bir süre listesi,
hiç liste olmamasından daha tehlikelidir.

---

## 6. Güvenlik kararları

> **Bu bir hukuk uygulamasıdır. Cihaz kaybında müvekkil verisi risk altındadır.**
> Aşağıdakiler bunu azaltır, sıfırlamaz.

### Oturum anahtarı (JWT)

`expo-secure-store` ile **iOS Keychain / Android Keystore** içinde saklanır — `AsyncStorage`
**kullanılmaz**. AsyncStorage, Android'de uygulama sanal alanındaki düz bir SQLite dosyasıdır;
root'lu ya da yedeği alınmış bir cihazda okunabilir. JWT bu uygulamada müvekkil dosyalarına açılan
anahtardır.

Anahtar `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ile yazılır: cihaz kilidi açıkken çözülür ve
**iCloud/iTunes yedeğine çıkmaz**, böylece yedekten başka bir cihaza taşınamaz.

Şifre **hiçbir koşulda** cihazda tutulmaz. "Beni hatırla" yalnızca e-posta adresini saklar.

### Biyometrik kilit

`expo-local-authentication`. Ayarlar'dan açılır/kapanır (kapatmak da doğrulama ister — telefonu
eline geçiren biri kilidi tek dokunuşla kaldıramamalı).

Uygulama arka planda **45 saniyeden** uzun kalırsa dönüşte kilit ekranı gelir. Sıfır saniye
seçilmedi: salonda bir saniyeliğine kameraya geçen avukat her seferinde parmak izi vermek zorunda
kalırsa kilidi kapatır — bu güvenliği artırmaz, azaltır.

Biyometri başarısız olursa cihazın PIN/desen ekranına düşülür; kullanıcı uygulamada mahsur kalmaz.
Kilit ekranında **çıkış** her zaman erişilebilirdir.

**Bu bir ekran kilididir, şifreleme değildir.** Parmak izi token'ı çözmez; token zaten
anahtarlıktadır. Kilit, telefonu masada açık bırakmış bir avukatın ekranını yanındakinden korur;
cihazı ele geçirmiş, kök erişimi olan bir saldırgandan korumaz.

### Cihazda ne duruyor?

| Duruyor | Durmuyor |
|---|---|
| Oturum anahtarı (anahtarlıkta) | Şifre |
| "Bugün" ekranının indirgenmiş kopyası: duruşma saati/salonu, mahkeme, esas no, dosya başlığı, müvekkil **adı**, süre başlıkları, görev başlıkları | TCKN / vergi no, adres, telefon, e-posta |
| — | Belge içeriği (belgeler indirilmez, süreli bağlantıyla açılır) |
| — | Safahat metni, AI hazırlık brifingi |

Önbellek, uygulama sanal alanındaki düz bir JSON dosyasıdır — işletim sisteminin disk şifrelemesi
dışında **ek şifreleme yoktur**. İçine yalnızca ekranda görünmesi zorunlu alanlar yazılır. Önbellek
kullanıcı kimliğiyle damgalanır: cihazda başka biri giriş yaparsa silinir.

**Çıkışta ve oturum düştüğünde (401) token, kullanıcı kaydı ve önbellek silinir.**

### Belgeler

Cihaza indirilmez. Sunucudan **süreli imzalı URL** istenir ve sistem tarayıcısında açılır; sunucu
her erişimi denetim günlüğüne yazar. Kaybolan bir telefonun "İndirilenler" klasöründe müvekkil
belgesi bırakmıyoruz.

### Sesli not neden yok?

Adliye koridorunda alınan bir ses kaydı çevredeki üçüncü kişilerin — başka müvekkiller, tanıklar,
karşı taraf — sesini de kaydeder. Bunun KVKK ve meslek sırrı bakımından savunulabilir bir hâli yok.
Duruşma notu yalnızca **metin** olarak girilir.

### Kurumsal öneri (MDM)

Müvekkil verisine erişen cihazlar için büroya önerilir:

- **Zorunlu cihaz kilidi** (PIN/biyometri) ve otomatik kilitlenme süresi ≤ 1 dakika
- **Uzaktan silme** (remote wipe) yeteneği — cihaz kaybında ilk yapılacak iş
- **Tam disk şifreleme** (iOS'ta varsayılan; Android'de doğrulanmalı)
- Root/jailbreak tespiti ve bu cihazlarda uygulamanın engellenmesi
- Uygulamanın **yalnızca kurumsal profilde** çalıştırılması; kişisel profille veri paylaşımının kapatılması
- Cihaz kaybı bildirilir bildirilmez **büro panelinden kullanıcının oturumunun kapatılması**
  (JWT'nin sunucu tarafında geçersiz kılınması)

### Ağ

- Üretimde API **yalnızca HTTPS** üzerinden yayınlanmalıdır. Geliştirmede düz `http://<lan-ip>:3001`
  kullanılır; bu yapılandırma üretime taşınmamalıdır.
- Her isteğin 20 saniyelik zaman aşımı vardır — zayıf adliye şebekesinde süresiz bekleyen bir istek
  "uygulama dondu" olarak algılanır.
- `EXPO_PUBLIC_*` değişkenleri **pakete gömülür**; gizli bilgi konmaz.

---

## 7. Ürün ilkelerinin mobildeki karşılığı

| İlke | Mobilde |
|---|---|
| **AI çıktısı ÖNERİDİR** | Duruşma hazırlık paketi ve AI kaynaklı süreler her zaman amber "AI ÖNERİSİ" şeridiyle gösterilir. `source=AI_ONERISI` süreler ayrı blokta, `BEKLIYOR` durumunda listelenir; onay olmadan takvime girmez. |
| **Süre ve para hesapları DETERMİNİSTİK** | Mobil hiçbir süre veya tutar **hesaplamaz**. Kalan gün sayısı yalnızca sunucudan gelen tarihin gösterimidir; para `Decimal` metni olarak alınır ve yalnız biçimlendirilir. |
| **Kaynak gösterme zorunlu** | Süre kartlarında `legalBasis` (dayanak) ve `computeNote` (hesap izi) gösterilir; onay ekranı bunları görmeden karar vermeyi zorlaştırır. |
| **Tenant izolasyonu** | Tüm istekler kiracı JWT'siyle gider; sunucu her sorguya `tenantId` koyar. Önbellek kullanıcı kimliğiyle damgalıdır. |
| **Üç kimlik alanı karışmaz** | İstemci yalnızca `/api/v1` çağırır. Platform ve portal uçları bu uygulamada tanımlı değildir. |
| **Rol kısıtları sunucuda** | Süre onayı `ADMIN/PARTNER/AVUKAT`, duruşma notu `ADMIN/PARTNER/AVUKAT/SEKRETER` ister. Mobil yetkisiz kullanıcıya düğmeyi göstermez, **ama asıl kapı sunucudadır** — istemci kontrolü yalnızca çalışmayacak bir düğmeyi gizlemek içindir. |

---

## 8. Tarih ve saat sözleşmesi

İki aile vardır ve **karıştırılmamalıdır** (`src/lib/format.ts`):

- **Gün bazlı alanlar** (`Deadline.dueDate` — şemada `@db.Date`): sunucu UTC gün başı üretir.
  `formatDay` / `formatDayLong` **UTC** bileşenleriyle okur. Cihazın saat dilimi ne olursa olsun
  "5 Eylül" 5 Eylül kalır.
- **Zaman damgalı alanlar** (`Hearing.date`, `createdAt`): gerçek bir ana işaret eder.
  `formatTime` / `formatDateTime` cihazın **yerel** saatiyle gösterir — duruşma saati avukatın
  bulunduğu yerin saatidir.

"Kalan gün" hesabı, sunucunun UTC takvim gününü kullanıcının **yerel** takvim günüyle karşılaştırır:
kullanıcı için "bugün", takvimde gördüğü gündür.

`Intl` **kullanılmaz**: Hermes'in Intl desteği platform ve sürüme göre değişir; bir cihazda
"31 Ağustos 2026", diğerinde "August 31, 2026" görmek bir hukuk uygulamasında kabul edilemez.
Ay ve gün adları elle tanımlıdır.

---

## 9. Dosya düzeni

```
apps/mobile/
  app/                        expo-router — dosya = ekran
    _layout.tsx               oturum + bağlantı + kilit katmanları, kök yönlendirme
    giris.tsx
    ayarlar.tsx
    +not-found.tsx
    (tabs)/
      _layout.tsx             sekme çubuğu (5 sekme)
      index.tsx               BUGÜN — ana ekran
      sureler.tsx             süreler + AI önerisi onay/ret
      gorevler.tsx            görevler + durum değiştirme
      dosyalar.tsx            arama
      bildirimler.tsx
    durusma/[id].tsx          duruşma detayı + hızlı not
    dosya/[id].tsx            dosya detayı
  src/
    api/client.ts             TEK API giriş noktası (token, 401, zaman aşımı, Türkçe hata)
    api/endpoints.ts          ekran → uç eşlemesi
    api/types.ts              sunucu yanıt tipleri (mobilin kullandığı kadarı)
    auth/session.tsx          oturum durumu + arka plan kilidi
    auth/secure-storage.ts    Keychain / Keystore sarmalayıcısı
    auth/biometrics.ts        expo-local-authentication
    auth/lock-screen.tsx      kilit kaplaması
    cache/today-cache.ts      "Bugün" çevrimdışı önbelleği (indirgenmiş)
    net/connectivity.tsx      bağlantı durumu
    hooks/use-load.ts         yükleniyor/hata/veri kancası
    lib/format.ts             tr-TR tarih, saat, para
    lib/labels.ts             Türkçe etiketler ve rozet tonları
    ui/theme.ts               lacivert + amber palet, dokunma hedefleri
    ui/components.tsx         ortak parçalar (kart, rozet, düğme, AI şeridi…)
    ui/list-items.tsx         duruşma/süre/görev/dosya satırları
    ui/note-dialog.tsx        metin girişli onay penceresi
```

### Kod kuralları

- **TypeScript strict** (+ `noUncheckedIndexedAccess`).
- **API istemcisi tek yerde**: hiçbir ekran doğrudan `fetch` çağırmaz.
- Hata durumları kullanıcıya **anlaşılır Türkçe** ile gösterilir; ağ hatası ile sunucu hatası ayrılır
  ve her hata ekranında "Tekrar dene" vardır.
- `Alert.prompt` kullanılmaz — yalnızca iOS'ta çalışır, Android'de sessizce hiçbir şey yapmaz.
  Metin girişi gereken her yerde `NoteDialog` kullanılır.

---

## 10. Tasarım

Web paneliyle aynı palet: **koyu lacivert** `#0F172A` + **amber** `#D97706`.

- **Büyük dokunma hedefleri** — minimum 48dp (Apple 44pt / Android 48dp önerilerinin üstü).
  Adliyede acele edilir.
- **Yüksek kontrast** — dış ortam aydınlığında okunabilirlik. Gövde metni `#0F172A`,
  en açık ikincil metin `#475569`de durur.
- **Duruşma saati 30-44 punto** — sahadaki en kritik rakam, uzaktan okunur.
- **Aciliyet rengi** kart sol kenarında: kırmızı = geçti/bugün · amber = 1-3 gün ·
  lacivert = 4-7 gün · gri = ötesi.
- Tarih/saat biçimleri **tr-TR** (`31.08.2026`, `09:30`, `31 Ağustos 2026 Pazartesi`).
