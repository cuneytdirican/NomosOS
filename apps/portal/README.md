# @nomosos/portal — Müvekkil Portalı

Hukuk bürosunun **müvekkillerinin** kullandığı self-servis portaldır. Büro uygulamasından
(`apps/web`) ve platform panelinden (`apps/admin`) tamamen ayrı bir Next.js 15 uygulamasıdır:
ayrı port, ayrı origin, ayrı JWT, ayrı localStorage anahtarı.

> Kaynak spec: `docs/moduller/10-muvekkil-portali.md`

| | Büro (`apps/web`) | Platform (`apps/admin`) | **Portal (`apps/portal`)** |
|---|---|---|---|
| Port | 3000 | 3002 | **3003** |
| API öneki | `/api/v1` | `/api/admin/v1` | **`/api/v1/portal`** |
| Token anahtarı | `nomosos_token` | `nomosos_admin_token` | **`nomosos_portal_token`** |
| Kimlik | `User` | `PlatformUser` | **`PortalUser`** |
| JWT audience | tenant | `platform` | **`portal`** |
| Tema | açık zemin · lacivert/amber | koyu çelik · mor-indigo | **fildişi kağıt · yumuşak lacivert · ölçülü altın** |
| Kullanıcı | avukat | operatör | **hukuk bilmeyen müvekkil** |

Üç kimlik yüzeyi de birbirine kapalıdır: portal token'ı `/api/v1` ve `/api/admin/v1` uçlarında,
büro/platform token'ı portal uçlarında **asla** geçerli değildir. Yaptırım sunucudadır (`aud`
denetimi); istemcinin görevi anahtarları ayrı tutmaktır.

## Çalıştırma

```bash
pnpm install                                # kök dizinde (bir kez)
pnpm --filter @nomosos/portal dev           # http://localhost:3003
pnpm --filter @nomosos/portal build
pnpm --filter @nomosos/portal typecheck
```

Ortam değişkeni:

```
NEXT_PUBLIC_API_URL=http://localhost:3001   # varsayılan
```

Portal `${NEXT_PUBLIC_API_URL}/api/v1/portal/...` uçlarını çağırır.

Demo giriş (seed): `portal@demo.nomosos.local` / `Demo1234!` (ABC Holding).

## Tasarım ilkeleri — bu ekranı avukat kullanmıyor

1. **Sade ve sakin.** Büro panelinden belirgin biçimde daha az bilgi yoğunluğu, bir kademe
   büyük punto (gövde 17px), geniş satır aralığı. Alarm rengi yoktur; "vadesi geçti" bile
   kırmızı değil kehribar tonundadır. Portal bir izleme ekranıdır, uyarı paneli değil.
2. **Hukuki jargon açıklanır.** `src/lib/labels.ts` içindeki `GLOSSARY` sözlüğü, "tensip zaptı",
   "safahat", "istinaf", "tebligat" gibi terimlerin sade karşılığını tutar. `<Term>` bileşeni
   tek terimi, `<TermText>` ise serbest metni tarayarak terimleri açıklama baloncuğuna bağlar.
   Baloncuk `<button>` üzerinden açılır: klavyeyle odaklanır, telefonda dokunulur.
   **Bu metinler elle yazılmıştır, AI üretimi değildir.**
3. **Ham enum gösterilmez.** Avukat "DERDEST" görür, müvekkil "Görülmeye devam ediyor" görür.
   `plain()` yardımcısı bilinmeyen bir enumu ekrana basmak yerine nötr bir ifadeye düşürür —
   müvekkile "ICRADA" yazmak bilgi vermez, kaygı üretir.
4. **Boş durumlar nazik ve açıklayıcıdır.** Portalda bir bölümün boş olması arıza değil,
   **yayın kararıdır**: "Avukatınız henüz bu bölümde paylaşım yapmadı."
5. **Gizlilik notu her sayfada.** Alt bilgide ve liste sayfalarının sonunda: *"Bu sayfada
   yalnızca avukatınızın sizinle paylaştığı bilgiler görünür."*

## Sayfalar ve bağlandıkları uçlar

Yollar `/api/v1/portal` öneki OLMADAN yazılmıştır (`src/lib/endpoints.ts`).

| Yol | Ekran | Tükettiği uçlar |
|---|---|---|
| `/giris` | E-posta + şifre girişi | `POST /auth/login` |
| `/davet/[token]` | Davet kabul, şifre belirleme | `GET /auth/invite/:token` · `POST /auth/accept-invite` |
| `/` | Panel: hoş geldiniz + 4 kart (aktif dosyalar, yaklaşan duruşma, bekleyen ödeme, avukattan mesaj) | `GET /dashboard` · **yedek:** `/cases`, `/hearings`, `/payments`, `/messages` |
| `/dosyalarim` | Yayınlanmış dosyalar listesi | `GET /cases` |
| `/dosyalarim/[id]` | Dosya detayı: durum, taraflar, duruşma, gelişmeler, belgeler | `GET /cases/:id` · **yedek:** `/cases/:id/timeline`, `/documents?caseId=` |
| `/belgelerim` | Paylaşılan belgeler (dosyaya göre gruplu) + indirme | `GET /documents` · `GET /documents/:id/download` |
| `/durusmalarim` | Gün başlıklı takvim listesi (yaklaşan / geçmiş) | `GET /hearings` |
| `/odemelerim` | Faturalar, ödeme geçmişi, açık bakiye | `GET /payments` |
| `/mesajlar` | Yazışma geçmişi + mesaj yazma | `GET /messages` · `POST /messages` |
| `/avukatim` | Sorumlu avukat kartı (`tel:` / `mailto:`) | `GET /my-lawyer` |
| (tüm oturumlu sayfalar) | Profil tazeleme | `GET /auth/me` · `POST /auth/logout` |

### Portal-API tarafının bilmesi gerekenler

- **Liste uçları** düz dizi ya da `{ data | items | results | rows }` sarmalayıcısı döndürebilir;
  ikisi de kabul edilir (`asList`).
- **`GET /payments`** iki biçimi de destekler: `{ openBalance, currency, invoices[], payments[] }`
  ya da düz fatura dizisi.
- **`GET /dashboard`** zorunlu değildir. Yoksa (404) panel kartları tek tek listelerden beslenir.
  Var olması dört isteği bire indirir.
- **Detay yanıtı zenginse ekran ikinci istek atmaz:** `GET /cases/:id` yanıtı `timeline` ve
  `documents` dizilerini içeriyorsa alt uçlar çağrılmaz.
- **Belge indirme** iki biçimi de destekler: `{ url }` (imzalı, süreli adres — tercih edilen)
  ya da doğrudan dosya akışı. İstek `Authorization` başlığıyla gider.
- **Para alanları** string (`"12500.00"`) ya da sayı gelebilir; portal yalnızca *gösterir*.
  **Aritmetik yapılmaz:** bakiye gelmezse toplam uydurulmaz, "N fatura bekliyor" yazılır.
- **Mesaj yönü** `fromClient` (boolean) ya da `sender`/`senderRole` metniyle bildirilebilir.
  Bilinmeyen değer **bürodan** sayılır.
- Enum değerleri `packages/db` şemasıyla birebirdir: `CaseStatus`, `CaseType`, `PartyRole`,
  `HearingType`, `HearingStatus`, `DocumentClass`, `InvoiceStatus`, `PaymentMethod`.

### 404 ve yayın kontrolü

Portal API'si, yayınlanmamış bir kaynağın id'si tahmin edilerek istendiğinde **404** döner
(Modül 10, kabul kriteri 2). İstemci bu 404'ü "uç henüz hazır değil" durumundan **ayırt
etmez ve etmemelidir**: her iki hâlde de müvekkile "burada gösterilecek bir şey yok" denir.
"Böyle bir kayıt var ama size kapalı" demek, yayın kontrolünü delen bir bilgi sızıntısı olurdu.

### API hazır değilken

Portal, Portal-API tarafı yazılmadan da açılır ve gezilir. Ağ hatası / 404 / 501–504
durumunda sayfa **çökmez**; ilgili bölümde *"Bu bölüm şu anda görüntülenemiyor"* ve bir
"Yeniden dene" düğmesi gösterilir. Beklenen uç adresi yalnızca `title` özniteliğinde durur —
müvekkile teknik ayrıntı gösterilmez. **Temsili (mock) veri yoktur.**

## Dizin yapısı

```
apps/portal/
├─ src/app/
│  ├─ layout.tsx              # html/body + globals.css (robots: noindex)
│  ├─ globals.css             # kağıt paleti, odak halkası, fade-in
│  ├─ giris/page.tsx          # e-posta + şifre
│  ├─ davet/[token]/page.tsx  # davet kabul (React 19: use(params))
│  └─ (portal)/               # oturum gerektiren kabuk
│     ├─ layout.tsx           # üst çubuk + tek satır gezinme + künye
│     ├─ page.tsx             # panel (4 kart)
│     ├─ dosyalarim/          # liste + [id] detay
│     ├─ belgelerim/ durusmalarim/ odemelerim/ mesajlar/ avukatim/
├─ src/components/
│  ├─ ui.tsx                  # Button, Card, Badge, Field, ResourceView, StatCard,
│  │                          # EmptyState, PrivacyNote, Disclosure, Modal…
│  ├─ Term.tsx                # <Term> / <TermText> — jargon açıklama baloncuğu
│  ├─ rows.tsx                # CaseStatusBadge, HearingCard, DocumentRow, TimelineList
│  ├─ AuthShell.tsx           # giriş/davet kabuğu + PortalMark amblemi
│  └─ Credit.tsx              # "Developed by MindAeon AI" künyesi
└─ src/lib/
   ├─ api.ts                  # /api/v1/portal istemcisi, 401 → /giris
   ├─ endpoints.ts            # EP.* — tüm uç yolları tek yerde
   ├─ types.ts                # API yanıt tipleri (alanlar isteğe bağlı)
   ├─ labels.ts               # MÜVEKKİL DİLİ: *_PLAIN, *_EXPLAIN, GLOSSARY, biçimlendirme
   ├─ messages.ts             # mesaj yönü / zaman damgası çözümü
   ├─ session.tsx             # PortalSessionProvider + usePortalSession
   ├─ useResource.ts          # useResource / useListResource (mock YOK)
   └─ nav.ts                  # yedi girişli menü
```

## Güvenlik ve KVKK

- `robots: noindex, nofollow` + `X-Robots-Tag`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Portal **hesap açamaz**: erişimi yalnızca büro verir (davet bağlantısı → şifre belirleme).
- Giriş hatasında hangi alanın yanlış olduğu ayrıştırılmaz (hesap sayımını kolaylaştırırdı).
- Ekranlarda hiçbir yerde iç strateji, risk skoru, dosya notu, görev veya başka müvekkil
  verisi **gösterilmez** — bu tür alanlar tip tanımlarında bile yoktur.
- Şifre uyarısı iki yerde tekrarlanır: "avukatınız veya büro çalışanları sizden hiçbir zaman
  şifrenizi istemez".

## Docker

```bash
docker build -f apps/portal/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.ornek-buro.com \
  -t nomosos-portal .
```

`NEXT_PUBLIC_*` değişkenleri **build anında** paketlenir; çalışma anında değiştirilemez.
