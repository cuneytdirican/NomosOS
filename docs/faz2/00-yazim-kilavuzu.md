# NomosOS F2 — Epic Yazım Kılavuzu

> Bu kılavuz, `docs/faz2/epics/` altındaki 37 epic dosyasının **nasıl yazılacağını**
> tanımlar. Birlikte okunması gereken: [00-sozluk.md](00-sozluk.md) (terimler ve yasak
> ifadeler) · [00-yol-haritasi.md](00-yol-haritasi.md) (epic listesi ve sıralama).

---

## 1. Dosya adlandırma

```
docs/faz2/epics/<KİMLİK>-<kebab-case-slug>.md
```

- Kimlik: `A0`, `A1`, `A3a`, `B4`, `C1`… — blok harfi + numara. **Asla değişmez.**
- Slug ASCII'ye indirgenir (`ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u`), 2-4 kelime. Sonradan değişebilir.
- Blok adı dosya adına **girmez** — blok yeniden gruplanabilir bir üstveri, kimlik değil.

Örnek: `B4-uyap-arka-ucu.md` · `A1-kvkk-veri-ozne-haklari.md` · `D3-hukuki-hesaplama.md`

---

## 2. Numaralandırma ve kalıcılık

```
B4                 Epic
B4-T01             Task        (epic başına 3-8)
B4-T01-S02         Sub Task    (task başına 2-6)
B4-T01-S02-A05     Atomic Task (subtask başına 3-10)
```

Her seviye iki hane, `01`'den başlar. Bir subtask'ta 10'dan fazla atomic varsa
**numara devam ettirilmez, subtask bölünür.**

### Kalıcılık kuralları (pazarlıksız)

1. Numara bir kez verilir, **asla geri alınmaz, asla yeniden kullanılmaz.**
2. Sıralama değişirse numaralar **kaydırılmaz.** Sıra fizikseldir; numara kimliktir.
3. İptal edilen öğe **silinmez**; satırı kalır, durumu `⛔ İPTAL` olur, gerekçesiyle.
   *(Mezar taşı deseni — eski commit'lerdeki kimlikler bulunabilmeli.)*
4. Yeni öğe araya değil **sona** eklenir.
5. Başka epic'e taşınan öğe: eski yerde `📦 DEVREDİLDİ → C3-T02` satırı kalır.

### Bağımlılık gösterimi

Yalnız **Epic / Task / SubTask** seviyesinde, iki alan:

```markdown
| Engelleyen (blocked-by) | B1, B2-T03 |
| Engellediği (blocks)    | B6-T01 |
```

Değer ya virgüllü kimlik listesi ya tek başına `—`. **Serbest metin yasak** (mekanik
ayrıştırılabilmeli). **Çift yönlü tutarlılık zorunlu:** X'in `Engelleyen`'inde Y varsa,
Y'nin `Engellediği`'nde X olmalı.

**Atomic görevlerde bağımlılık alanı yoktur.** Varsayılan: `A01→A02→…` sırası. İstisnai
bir dış bağımlılık varsa görev adının sonuna `⛓ B1-T02` yazılır.

### Denetim bulgularıyla bağ (üçü de zorunlu)

**(a) Künyede:** `| Denetim bulguları | Ö-26 (backlog), İ-27 |`
**(b) Bulguyu kapatan SubTask başlığında:** `#### B4-T01-S04 · Rota kataloğuna UYAP uçları (İ-27)`
**(c)** [`90-bulgu-eslesmesi.md`](90-bulgu-eslesmesi.md)'de ters indeks satırı.

> `grep -rn "İ-27" docs/faz2/` işin tam olarak nerede kapandığını vermelidir.

---

## 3. Epic dosyası şablonu

11 bölümün **11'i de**, **bu sırayla** bulunmak zorundadır. `Kapsam Dışı` ve
`Vaat Kısıtı` **boş bırakılamaz.**

````markdown
# <KİMLİK> — <Epic Başlığı>

> ⬅ [F2 Yol Haritası](../00-yol-haritasi.md) · **Blok <X> — <Blok Adı>**
> Modül spec'i: [<NN-slug>](../../moduller/<NN-slug>.md) · Denetim: <bulgu kodları>
> İlerleme: **<bitti>/<toplam>** atomic (%<yüzde>) · Durum: <rozet>

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `<KİMLİK>` |
| Blok | <X> — <blok adı> |
| Öncelik | P0 üretim kapatıcısı · P1 · P2 · P3 |
| T-shirt boyut | XS (<15p) · S (15-30p) · M (30-60p) · L (60-90p) · XL (>90p) |
| Atomic puan toplamı | <sayı> |
| Engelleyen (blocked-by) | `B1` \| — |
| Engellediği (blocks) | `B6` \| — |
| Modül spec'i | `docs/moduller/06-belge-yonetimi.md` — KK1, KK5 |
| Ürün fazı borcu | Faz 2 çıkış kriteri (`docs/06-yol-haritasi.md`) |
| Denetim bulguları | `Ö-26` (backlog), `İ-27` |
| Dokunulan paketler | `apps/api`, `packages/db` |
| Şema değişikliği | Var → migration `20260910090000_...` \| Yok |

## Neden

### Problem
<2-4 cümle: ürün açısından hangi vaat tutulmuyor.>

### Bugün ne oluyor
<Kanıtlı. Her iddia `dosya:satır` veya denetim bulgu numarası taşır.
Somut kullanıcı senaryosu ZORUNLU — "640 dosyalı bir büro…" gibi.>

### Kapanınca ne değişir
<Ölçülebilir. "Daha iyi olur" yasak. "Şu uç 200 döner", "şu vaat verilebilir hale gelir".>

## Kapsam

<Madde madde, her madde tek satır, her biri bir Task'a karşılık gelir. 3-8 madde.>

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| <somut iş> | <gerekçe> | `<KİMLİK>` \| Ürün fazı <n> \| Hiç yapılmayacak |

<En az 3 satır. Bir ajan bu tabloda yazan bir işi yaparsa iş REDDEDİLİR.>

## Veri Modeli Değişikliği

<Yeni/değişen Prisma modelleri, modül spec'lerindeki alan tablosu biçiminde.
Değişiklik yoksa tek satır: `— yok —`. Migration klasör adı burada sabitlenir.>

## Kırılım

### <KİMLİK>-T01 · <Task başlığı>  ⬜

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engellediği | `<KİMLİK>-T02` |
| Puan | <toplam> |

<1-3 cümle: bu task ne teslim eder, "bitti" ne demek.>

#### <KİMLİK>-T01-S01 · <SubTask başlığı> (<bulgu kodu, varsa>)  ⬜

<1 cümle amaç.>

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `…-A01` | <emir kipi, tek iş> | `path/to/file.ts` (yeni) | <mekanik doğrulanabilir tek cümle> | 2 | ⬜ |

## Kabul Kriterleri

<Epic seviyesinde, numaralı, TEST EDİLEBİLİR. 6-12 madde. Her maddenin sonunda onu
karşılayan Task kimliği parantez içinde. En az 2 madde NEGATİF olmalı (403/422/reddedilir).>

1. <Davranış cümlesi.> (`<KİMLİK>-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| <test dosyası> | `apps/api/src/<mod>/<ad>.test.ts` (yeni) | <hangi regresyon> |

<ZORUNLU bölüm. Denetimin açık bulgusu: birinci turun düzeltmeleri "yalnız kaynaktaki
yorumla korunuyor; biri geri alınırsa hiçbir test kırmızıya dönmez".>

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | <soru> | Ürün \| Hukuk \| Altyapı | <hangi task bloke olur> |

<Cevaplanan soru silinmez; cevabı yazılır ve ✅ işaretlenir.>

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde, tanıtım sitesinde
> (`docs/08-tanitim-sitesi-icerik.md`) ve satış konuşmasında SÖYLENEMEZ:**
>
> - <yasak cümle>
>
> **Bunun yerine söylenecek:** <dürüst alternatif>
>
> **Bugün nerede yazıyor (temizlenecek):** `apps/web/src/…:satır`

<Boş bırakılamaz. Epic hiçbir vaadi kısıtlamıyorsa gerekçesi yazılır.>

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu (23 atomic, 47 puan) | <ajan> |
````

---

## 4. Atomic görev yazım kuralı

Bir atomic görev, **bir ajanın tek oturumda yapıp tek commit'te gönderebileceği, tek bir
doğrulama komutuyla kanıtlanabilen değişikliktir.**

| Kural | Sınır |
|---|---|
| Dokunulan dosya | **≤ 3** (+1 test dosyası) |
| Paket sınırı | **Tek** — `apps/api` ve `apps/web`'e aynı anda dokunamaz |
| Kabul kriteri | **Tam olarak 1** — "ve" ile bağlanan iki kriter iki görevdir |
| Şema + kullanım | **Ayrı görevler** — alan eklemek ile o alanı kullanmak ayrıdır |
| Puan | **≤ 3** — aşıyorsa SubTask'tır |

> **Bölme sınavı:** *"Bu görevi bitirdim"* denildiğinde doğrulamak için birden fazla
> komut/ekran gerekiyorsa, görev bölünmemiştir.

### Sütun kuralları

| Sütun | Kural |
|---|---|
| `ID` | Tam nitelikli: `B4-T01-S02-A03` |
| `Atomic görev` | Emir kipi, tek fiil: *ekle, yaz, kaldır, bağla*. **"İncele/araştır/gözden geçir" yasak** — bunlar açık sorudur |
| `Dokunulan dosya(lar)` | Depoya göre tam yol. Yeni dosya `(yeni)` ile işaretlenir. **Var olduğu iddia edilen her yol yazmadan önce doğrulanır** |
| `Kabul kriteri` | Mekanik doğrulanabilir tek cümle: komut çıktısı, HTTP kodu, test adı, dönen alan |
| `P` (puan) | `1` mekanik/tek dosya · `2` çok dosya veya yeni dosya · `3` yeni davranış + test. **Saat tahmini yok** |
| `Durum` | `⬜ 🔄 ✅ 🚫 ⛔ 📦` |

**Her SubTask'ın son atomic görevi bir test görevidir. İstisnası yoktur.**

---

## 5. Referans örnek — `POST /uyap/pair`

Bu set **model alınacaktır.** Depo gerçeğine dayanır: `apps/api/src/` altında `uyap`
dizini yoktur; eklentinin sözleşmesi `apps/uyap-extension/src/types/dto.ts` ve
`src/lib/auth.ts` içinde **zaten yazılıdır** — arka uç ona uyar, sözleşmeyi yeniden
tasarlamaz.

````markdown
#### B4-T01-S02 · `POST /uyap/pair` — eşleştirme kodunu extension token'a çevirme (Ö-26)

Eklentinin `pairWithCode()` çağrısını karşılayan uç. Dönen gövde `PairResponse` ile
**birebir** aynı olmalıdır; eklenti alan adlarını değiştiremez.

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `B4-T01-S02-A01` | `UyapPairingCode` ve `UyapExtensionToken` modellerini şemaya ekle ve migration üret | `packages/db/prisma/schema.prisma`<br>`packages/db/prisma/migrations/20260910090000_f2_uyap_eslestirme/migration.sql` (yeni) | `prisma migrate status` temiz; `codeHash` ve `refreshTokenHash` **unique**, ikisi de `@@index([tenantId, userId])` taşıyor | 2 | ⬜ |
| `B4-T01-S02-A02` | `uyap.constants.ts` yaz: `UYAP_JWT_AUDIENCE = "uyap-extension"`, erişim 15 dk, yenileme 30 gün, kod 10 dk | `apps/api/src/uyap/uyap.constants.ts` (yeni) | Dört audience sabiti ikişerli karşılaştırmada farklı; imza anahtarı `portal.constants.ts` deseniyle `JWT_SECRET`'ten **türetiliyor** | 2 | ⬜ |
| `B4-T01-S02-A03` | `uyap-token.ts`: jeton üretimi + SHA-256 özet + sabit zamanlı karşılaştırma | `apps/api/src/uyap/uyap-token.ts` (yeni) | `portal-token.ts` deseniyle aynı: ham değer **hiçbir yerde saklanmıyor**; `newUyapCode()` 32 bayt entropi döndürüyor | 2 | ⬜ |
| `B4-T01-S02-A04` | `pairRequestSchema` ve `refreshRequestSchema` zod şemalarını yaz | `apps/api/src/uyap/uyap.dto.ts` (yeni) | Alanlar eklentinin `PairRequest` tipiyle **birebir**; `pairingCode` min 6, `deviceName` max 120, fazla alan `strict()` ile reddediliyor | 2 | ⬜ |
| `B4-T01-S02-A05` | `redeemPairingCode()` mutlu yolunu yaz | `apps/api/src/uyap/uyap-pairing.service.ts` (yeni) | Geçerli kodla `PairResponse` dönüyor: `accessToken`, `refreshToken`, `accessTokenExpiresAt` (**ISO 8601 metin**, epoch değil), `identity{...}`, `storageHosts` | 3 | ⬜ |
| `B4-T01-S02-A06` | Kapıları ekle: süresi dolmuş / kullanılmış / iptal kod, pasif kullanıcı, askıya alınmış tenant | `apps/api/src/uyap/uyap-pairing.service.ts` | Beş durum da **401** dönüyor ve gövdede hangi durum olduğu **ayırt edilmiyor** (numaralandırma sızıntısı yok) | 3 | ⬜ |
| `B4-T01-S02-A07` | `storageHosts` listesini ortam değişkeninden oku ve yanıta ekle | `apps/api/src/uyap/uyap.constants.ts`<br>`apps/api/src/uyap/uyap-pairing.service.ts` | `UYAP_STORAGE_HOSTS` tanımsızsa `storageHosts: []` dönüyor; eklenti bunu **yalnız API ana bilgisayarına yükleme** olarak yorumluyor (fail-closed korunuyor) | 2 | ⬜ |
| `B4-T01-S02-A08` | Controller: `@Controller("uyap")` + `@Public()` + `ZodValidationPipe` + IP başına dakikada 10 istek | `apps/api/src/uyap/uyap.controller.ts` (yeni)<br>`apps/api/src/uyap/uyap.module.ts` (yeni) | `POST /api/v1/uyap/pair` kimliksiz erişilebiliyor (kod **kimlik bilgisidir**); 11. istek **429**; sayaç `common/rate-limit/counter-store.ts` üzerinden | 3 | ⬜ |
| `B4-T01-S02-A09` | `UyapModule`'ü `AppModule`'e kaydet ve rotayı ortak kataloğa ekle | `apps/api/src/app.module.ts`<br>`packages/shared/src/api-routes.ts` | `GET /api/v1/uyap/pair` **405**, tanımsız alt yol **404**; `UYAP_ROUTES.pair` eklentinin beklediği yolu üretiyor. ⛓ **entegrasyon ajanına ait** | 1 | ⬜ |
| `B4-T01-S02-A10` | Eşleştirme ve iptale denetim kaydı yaz | `apps/api/src/uyap/uyap-pairing.service.ts` | `AuditLog`'a `action: "uyap.pair"` + `deviceName`/`extensionVersion`; **ham jeton veya kod detay alanına yazılmıyor** | 1 | ⬜ |
| `B4-T01-S02-A11` | Regresyon testlerini yaz | `apps/api/src/uyap/uyap-pair.test.ts` (yeni) | Altı test: (1) `PairResponse` alan kümesi birebir, (2) aynı kod ikinci kez → 401, (3) süresi dolmuş → 401, (4) `aud:"tenant"` jetonu `/uyap/status`'ta → 401, (5) `aud:"uyap-extension"` jetonu `/api/v1/cases`'te → 401, (6) 11. istek → 429 | 3 | ⬜ |

**Puan: 24** · Kapanan: `Ö-26`'nın eşleştirme ayağı, `İ-27`'nin UYAP kesiti, `İ-29`
````

### Bu set neden model

1. **Şema ile kullanım ayrı** (A01 ≠ A05)
2. **Mutlu yol ile kapılar ayrı** (A05 ≠ A06) — kapılar unutulmasın diye kendi satırı var
3. **Her kabul kriteri tek ve mekanik** — "çalışıyor" yok; 401/429/405 var
4. **Mevcut depo sözleşmesine yaslanıyor** — istemci yazılı, arka uç ona uyuyor
5. **Dosya sahipliği çatışması işaretli** (A09, entegrasyon ajanı)
6. **Son görev testtir** ve testler bulguları isimle korur
7. **Depo tuzağı gömülü** — migration klasör adı elle verilmiş (sistem saati tuzağı)

---

## 6. Global "Tanımlı Bitti"

Her Task'ın altına **otomatik eklenir**; epic'lerde tekrar yazılmaz. Bu liste denetimin
kök nedenlerinden türetildi.

1. Prisma migration + [`docs/02-veri-modeli.md`](../02-veri-modeli.md) güncellemesi
   *(bugün 46 model eksik — kök neden bu maddenin olmaması)*
2. `packages/shared/src/api-routes.ts` girdisi *(bugün 3/30 modül — 8 uydurma uç bu yüzden çıktı)*
3. `packages/shared/src/schemas.ts` zod şeması
4. Rol kapısı + **tenant izolasyon testi**
5. Denetim izi kaydı (`AuditLog`)
6. AI görev tipi katalog girişi + `AiTaskCost` satırı *(11 tanımsız görev tipi var)*
7. **Regresyon testi** *(denetimin açık bulgusu: 1. tur düzeltmeleri teste bağlı değil)*
8. İlgili `docs/moduller/NN-*.md` kabul kriterinin işaretlenmesi

### Epic kapanış kapısı

1. `pnpm build` 12/12 ✅ · `pnpm typecheck` ✅
2. `pnpm lint` → **0 hata**, uyarı sayısı artmamış
3. `pnpm -r test` yeşil; `Test Yükümlülüğü` tablosundaki her satır gerçek bir dosya
4. Şema değiştiyse `prisma migrate status` temiz
5. Yeni uç varsa `api-routes.ts`'de kayıtlı
6. Arayüz, sunucuda **var olmayan** hiçbir çözüm yolu önermiyor
7. `Vaat Kısıtı` bölümündeki yasak ifadeler arayüz ve `docs/08`'den kaldırılmış **ya da**
   kısıt hâlâ geçerliyse yerinde bırakılmış
8. `README.md` panosu ve `90-bulgu-eslesmesi.md` **aynı commit'te** güncellenmiş

---

## 7. Durum rozetleri

| Rozet | Anlam | Kim değiştirir |
|---|---|---|
| `⬜` | AÇIK | — |
| `🔄` | SÜRÜYOR | işi alan ajan |
| `✅` | BİTTİ | işi bitiren ajan (kapanış kapısından sonra) |
| `🚫` | ENGELLİ | ajan; yanına engelleyen kimlik veya açık soru numarası |
| `⛔` | İPTAL | koordinatör; gerekçe zorunlu |
| `📦` | DEVREDİLDİ | koordinatör; hedef kimlik zorunlu |

**Tüm alt öğeler `✅` olmadan üst öğe `✅` olamaz.**

### Commit bağı

```
faz2(B4-T01-S02-A05): eşleştirme kodu mutlu yolu
```

`git log --grep="B4-T01"` bir task'ın tüm işini verir. Bir atomic görev `✅` ama commit'i
yoksa, işaret yanlıştır.

---

## 8. Tutarlılık denetimi

```bash
# 11 zorunlu bölüm
for f in docs/faz2/epics/*.md; do
  n=$(grep -c '^## \(Künye\|Neden\|Kapsam\|Kapsam Dışı\|Veri Modeli Değişikliği\|Kırılım\|Kabul Kriterleri\|Test Yükümlülüğü\|Riskler ve Açık Sorular\|Vaat Kısıtı\|Değişiklik Günlüğü\)$' "$f")
  [ "$n" -eq 11 ] || echo "EKSİK BÖLÜM: $f ($n/11)"
done

# Yasak ifadeler
grep -rniE 'gerekirse|gözden geçirilir|incelenir|basitçe|tam otomatik|AI hesaplar|AI karar verir|%100' docs/faz2/epics/

# Çift kimlik
grep -rhoE '\b[A-F][0-9]+[a-z]?(-T[0-9]{2}(-S[0-9]{2}(-A[0-9]{2})?)?)?\b' docs/faz2/epics/ | sort | uniq -d
```
