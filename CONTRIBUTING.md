# Katkı Rehberi

## Kurulum
```bash
corepack enable && pnpm install
cp .env.example .env            # MASTER_ENCRYPTION_KEY, JWT_SECRET üret (openssl rand -hex 32)
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev                         # api :3001 · web :3000 · admin :3002 · portal :3003
```
Docker test yığını (Postgres, Redis, MinIO, Mailpit, tüm uygulamalar): `docker compose -f docker-compose.test.yml up -d --build`
— her zaman **depo kökünden** çalıştırın.

## Kalite kapıları (PR açılmadan önce hepsi yeşil)
| Kapı | Komut |
|---|---|
| Lint (0 uyarı) | `pnpm lint` |
| Tip denetimi | `pnpm typecheck` (mobil: `pnpm --filter @nomosos/mobile typecheck`) |
| Testler | `pnpm test` (api/web/legal-core/legal-ai) — api testleri Redis'siz de geçmelidir |
| Biçim | `pnpm format:check` (husky + lint-staged commit öncesi otomatik) |
| Canlı duman | Docker test yığını + `scratchpad`/Playwright dumanı (yeni uç → HTTP kodu beklentisi) |

## Kurallar
- **Türkçe ürün metni, ASCII-Türkçe commit mesajı**: `ozellik:` / `duzelt:` / `belge:` önekleri.
- **Şema**: elle migration (`packages/db/prisma/migrations/<ts>_<ad>/migration.sql`) + `pnpm db:generate`.
  Silme/yıkıcı göç yok; geriye uyumlu (bkz. `docs/uretim-dagitimi.md` §6.2).
- **Yeni uç**: `packages/shared/src/api-routes.ts` + `pnpm --filter @nomosos/shared build`; sözleşme testi ekleyin.
- **Yeni zamanlanmış iş**: `scheduler.constants` + `job-registry` + `scheduler.module`.
- **Sırlar**: `.env` asla commit edilmez; anahtarlar `encryptSecret` ile yazılır, yanıtlara sızmaz.
- **Dış entegrasyon**: adaptör + fixture sözleşme testi; sağlayıcı yoksa dürüst 503 (sahte "başarılı" yok).
- **UTF-8**: dosyaları UTF-8 (BOM'suz, LF) yazın; Türkçe metinde mojibake taraması (`Ã¼`, `Ä±`, `ÅŸ`).

## Sürüm ve dağıtım
`CHANGELOG.md` "Yayımlanmamış" bölümünü sürüme taşıyın, `vX.Y.Z` etiketi atın; `deploy.yml`
imajları GHCR'ye gönderir ve sunucuda yedek → göç → `up -d` → readiness dumanı çalıştırır.
Geri alma: `workflow_dispatch` ile önceki etiket.
