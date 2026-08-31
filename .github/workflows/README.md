# NomosOS CI/CD hatları

Bu klasördeki iş akışları `.github/` altında tanımlıdır ve depo kodunu değiştirmez.

| Dosya | Ne zaman | Kırıcı mı? |
| --- | --- | --- |
| `ci.yml` | Her push, her PR, elle tetikleme | Evet |
| `security.yml` | Her pazartesi 04:00 UTC, her PR, `main`'e push, elle tetikleme | Kısmen (aşağıda) |
| `../dependabot.yml` | Her pazartesi 06:00 (Europe/Istanbul) | Hayır (PR açar) |

---

## 1. `ci.yml` — Derle · Tip denetle · Test et · Migration bütünlüğü

Tek iş (`dogrula`), `ubuntu-latest`, 30 dakika üst sınır. Matris yok: paketler
tek Node sürümünde (22) çalışır, matris hem süreyi hem hata yüzeyini büyütürdü.

**Servis konteyneri:** `postgres:16` (`nomosos/nomosos`, veritabanı `nomosos_ci`),
`pg_isready` sağlık kontrolüyle, `localhost:5432`'ye yayımlanmış.

### Adımlar

1. **Depoyu çek** — `actions/checkout@v4`, `fetch-depth: 0` (PR'da taban dalla
   migration sırası karşılaştırılacağı için tam geçmiş gerekir).
2. **pnpm 9 kurulumu** — `pnpm/action-setup@v4`, `run_install: false`. Sürüm
   burada sabitlenmez; kök `package.json` içindeki `packageManager: pnpm@9.15.4`
   alanından okunur — corepack'in kullandığı sözleşmenin aynısı. Böylece pnpm
   sürümü tek bir yerde (lockfile ile aynı dosyada) tanımlı kalır.
3. **Node 22 kurulumu ve pnpm store önbelleği** — `actions/setup-node@v4`,
   `node-version: 22`, `cache: 'pnpm'`. Bu adım pnpm kurulumundan **sonra**
   gelmelidir, çünkü önbellek yolunu `pnpm store path` ile bulur.
4. **Sürümleri raporla** — node/pnpm sürümü ve store yolu loga yazılır.
5. **Bağımlılıkları kur** — `pnpm install --frozen-lockfile`. Lockfile ile
   `package.json` ayrışmışsa iş burada durur.
6. **PostgreSQL hazır olana kadar bekle** — `pg_isready` ile en fazla 60 sn.
7. **Gölge veritabanını oluştur** — `nomosos_ci_shadow`. `prisma migrate diff
   --from-migrations` boş bir gölge veritabanı ister.
8. **Derle** — `pnpm build` (turbo; `packages/db` içinde `prisma generate` de burada koşar).
9. **Tip denetimi** — `pnpm typecheck`.
10. **Testler** — `pnpm -r test` (vitest: `legal-core`, `legal-ai`, `udf`, `uyap-extension`).
11. **Migration'ları boş veritabanına uygula** — `pnpm db:deploy`. Bu adım tek
    başına "migration'lar sıfırdan, sırayla, temiz uygulanıyor mu?" sorusunu yanıtlar.
12. **Migration durumu** — `prisma migrate status`.
13. **Şema/migration ayrışması (drift) kontrolü** —
    `prisma migrate diff --from-migrations ./prisma/migrations
    --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url … --script --exit-code`.
    Çıkış kodu `2` ise `schema.prisma` değişmiş ama migration üretilmemiştir;
    eksik SQL loga ve iş özetine basılır, iş **başarısız** olur.
    Düzeltme: `pnpm db:migrate` ile migration üretip commit etmek.
14. **Migration klasör hijyeni ve sıralaması** — klasör adları
    `<14 haneli zaman damgası>_<ad>` biçiminde mi, her klasörde `migration.sql`
    var mı, yinelenen zaman damgası var mı, diskteki küme `_prisma_migrations`
    tablosundaki uygulanan kümeyle birebir örtüşüyor mu.
15. **Yeni migration'lar taban dalın sonrasına yerleşiyor mu** (yalnız PR) —
    bu depoda daha önce yaşanan **migration sıralama sorununa** karşı asıl koruma:
    PR'ın eklediği her migration, taban daldaki **en son** migration'dan sonra
    sıralanmalıdır; ayrıca taban dalda zaten var olan bir migration dosyası
    **değiştirilmiş** olamaz. İkisinden biri ihlal edilirse iş başarısız olur.
16. **İş özetini yaz** (`if: always()`) — `$GITHUB_STEP_SUMMARY`'ye aşama tablosu,
    vitest özeti (`Test Files` / `Tests` / `Duration`) ve varsa başarısız testler,
    turbo görev özeti ile derleme çıktılarının boyut tablosu (`dist`, `.next`),
    `migrate status` çıktısı ve varsa drift SQL'i yazılır.

### CI'ya özel ortam değişkenleri

`ci.yml` içinde iş seviyesinde tanımlıdırlar; **hiçbiri gerçek sır değildir** ve
repository secret gerektirmezler:

`DATABASE_URL`, `SHADOW_DATABASE_URL`, `ADMIN_DATABASE_URL`, `API_PORT`,
`JWT_SECRET` (32+ karakter, atılabilir), `MASTER_ENCRYPTION_KEY` (64 hane hex,
atılabilir), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ADMIN_API_URL`, `S3_BUCKET`,
`S3_REGION`.

`REDIS_URL` ve `S3_ENDPOINT` bilinçli olarak **tanımsızdır**: derleme, tip
denetimi ve birim testleri bu servislere bağlanmaz. Uçtan uca test eklenirse
`redis:7` ve `minio` servis konteynerleri de eklenmelidir.

---

## 2. `security.yml` — Bağımlılık denetimi · Sır taraması · CodeQL

Üç bağımsız iş paralel koşar.

### `bagimlilik-denetimi` — kırmaz

`pnpm audit --audit-level=high` çalıştırılır. Çıktı iş özetine
(açılır blok) ve `metadata.vulnerabilities` sayıları özet satırına yazılır.
Bulgu varsa `::warning::` ek açıklaması düşülür ama **adım 0 ile çıkar**;
tedarik zinciri bulgusu tek başına dağıtımı durdurmaz, insan kararı ister.

### `sir-taramasi` — **kırar**

`bash .github/scripts/scan-secrets.sh` çağırır. Betik yalnızca **git tarafından
izlenen** dosyaları tarar (`node_modules`, `dist`, `.next` zaten izlenmez) ve
şunları arar:

| Kontrol | Ne aranır |
| --- | --- |
| İzlenen `.env` dosyaları | `.env`, `.env.local`, `.env.production`, `.env.development` sürüm kontrolünde olmamalı |
| Dolu değerli atama | `MASTER_ENCRYPTION_KEY=`, `JWT_SECRET=`, `PLATFORM_JWT_SECRET=`, `PLATFORM_2FA_ENCRYPTION_KEY=`, `S3_SECRET_KEY=`, `POSTGRES_PASSWORD=` — değeri en az 8 karakter ve yer tutucu değilse |
| Anthropic anahtarı | `sk-ant-` + 20+ karakter |
| OpenAI proje anahtarı | `sk-proj-` + 20+ karakter |
| OpenAI eski biçim | `sk-` + 32+ alfanümerik |
| Google API anahtarı | `AIza` + 35 karakter |
| Özel anahtar | `-----BEGIN … PRIVATE KEY-----` |
| AWS / GitHub | `AKIA…`, `ghp_/gho_/ghu_/ghs_/ghr_…` |

**Yanlış pozitifleri eleme.** "Dolu değerli atama" kontrolü şu değerleri sır
saymaz: başka bir değişken adı (`PLATFORM_JWT_SECRET=JWT_SECRET`), enterpolasyon
(`${JWT_SECRET}`, `process.env.…`), bilinen yer tutucu sözcükler
(`degistir`, `ornek`, `example`, `your-`, `sahte`, `test-`, `ci-`, `…`) ve tek
karakterin tekrarı (`0000…`).

**Hariç tutulan yollar.** `.env.example`, `pnpm-lock.yaml`, `docs/**` (yalnızca
atama kontrolünde — gerçek anahtar biçimleri dokümanlarda da aranır),
`.github/scripts/**` (betiğin kendi desenleri), `.github/workflows/*.md`,
`*.example`, `*.sample`.

> Bulgu çıkarsa dosyayı silmek **yeterli değildir**: değer git geçmişinde kalır.
> Önce sağlayıcıda geçersiz kılın (rotate), sonra geçmişi temizleyin.

### `codeql`

`github/codeql-action/init@v3` + `analyze@v3`, dil `javascript-typescript`,
sorgu takımı `security-and-quality`, yapılandırma
`.github/codeql/codeql-config.yml` (yalnız `apps/` ve `packages/`; `node_modules`,
`dist`, `.next`, `.turbo`, `coverage`, test dosyaları ve Prisma migration SQL'leri
hariç). İş `security-events: write` izniyle koşar; sonuçlar deponun
**Security → Code scanning** sekmesine düşer.

---

## 3. `../dependabot.yml`

- **npm** — kök (`/`) ve tüm workspace paketleri (`/apps/*`, `/packages/*`),
  haftalık, en fazla 8 açık PR. Gruplar: `prisma`, `nestjs`, `next-react`,
  `tailwind`, `derleme-araclari` ve kalan her şey için tek bir
  `diger-minor-patch` grubu (yalnız minor + patch). Major yükseltmeler
  gruplanmaz, ayrı PR olarak gelir.
- **github-actions** — kök, haftalık, tümü tek grupta.

---

## Gereken repository secret'ları

**Hiçbiri yok.** Her iki hat da yalnızca GitHub'ın otomatik sağladığı
`GITHUB_TOKEN` ile çalışır; CI'daki tüm anahtar görünümlü değerler iş akışı
dosyasında açıkça tanımlı, atılabilir CI değerleridir.

Yapılması gereken **ayarlar** (secret değil, depo ayarı):

| Ayar | Nerede | Neden |
| --- | --- | --- |
| Code scanning (CodeQL) etkin | Settings → Code security | Özel depoda CodeQL, GitHub Advanced Security gerektirir. Kapalıysa `codeql` işi `analyze` adımında hata verir; hattı geçici olarak çalıştırmak için o iş devre dışı bırakılabilir. |
| Dependabot alerts + security updates | Settings → Code security | `dependabot.yml` sürüm güncellemelerini açar; güvenlik uyarıları ayrı bir anahtardır. |
| Actions izinleri: "Read repository contents" | Settings → Actions → General | Varsayılan yeterlidir; hatlar yazma izni istemez (`permissions: contents: read`, yalnız CodeQL işi `security-events: write` alır). |
| Branch protection: `dogrula` ve `sir-taramasi` zorunlu | Settings → Branches | Derleme/test ve sır taraması `main`'e giriş koşulu olmalıdır. |

İleride gerekebilecekler (bugün kullanılmıyor): konteyner imajı yayımlanacaksa
kayıt defteri kimlik bilgileri, dağıtım hattı eklenirse ortam secret'ları.

---

## Yerelde çalıştırma

`act` gerekmez; hattın yaptığı her şey doğrudan çalıştırılabilir.

```bash
# 0) Altyapı (postgres + redis + minio)
docker compose up -d

# 1) Kurulum — CI ile aynı katılıkta
pnpm install --frozen-lockfile

# 2) CI sırası
pnpm build
pnpm typecheck
pnpm -r test

# 3) Migration bütünlüğü — CI ile aynı iki adım
#    Not: temiz bir veritabanına uygulanmalı.
createdb -h localhost -U nomosos nomosos_ci        2>/dev/null || true
createdb -h localhost -U nomosos nomosos_ci_shadow 2>/dev/null || true

DATABASE_URL='postgresql://nomosos:nomosos@localhost:5432/nomosos_ci' \
  pnpm db:deploy

pnpm --filter @nomosos/db exec prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url 'postgresql://nomosos:nomosos@localhost:5432/nomosos_ci_shadow' \
  --script --exit-code
# çıkış 0 = ayrışma yok · 2 = drift (pnpm db:migrate ile migration üret)

# 4) Sır taraması (CI ile birebir aynı betik)
bash .github/scripts/scan-secrets.sh

# 5) Bağımlılık denetimi
pnpm audit --audit-level=high
```

Windows'ta 4. adım Git Bash veya WSL içinde çalıştırılmalıdır.

CodeQL yerelde çalıştırılmak istenirse
[CodeQL CLI](https://docs.github.com/code-security/codeql-cli) gerekir; günlük
akışta gerekli değildir, PR'da otomatik koşar.
