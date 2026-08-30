#!/usr/bin/env node
/**
 * KÖK `.env` YÜKLEYİCİ — Prisma CLI ve `tsx` için.
 *
 * SORUN (entegrasyon denetimi, bulgu 1): `prisma migrate` / `prisma generate` /
 * `tsx src/seed.ts` `.env` dosyasını YALNIZCA kendi çalışma dizininde ve
 * `prisma/` altında arar; üst dizine çıkmaz. Depoda `.env` kökte durduğu için
 * README'deki kurulum adımları `P1012 · Environment variable not found:
 * DATABASE_URL` ile düşerdi. API tarafında sorun yoktu çünkü Nest'in
 * `ConfigModule.envFilePath` değeri zaten `../../.env` içeriyor.
 *
 * NEDEN EK PAKET YOK: `dotenv-cli` eklemek tek bir yol sorunu için bağımlılık
 * ağacını büyütürdü. Buradaki ayrıştırıcı `KEY=VALUE`, tırnaklı değerler,
 * `export ` ön eki ve `#` yorum satırlarını kapsar — `.env` dosyalarının
 * kullandığı biçimin tamamı budur.
 *
 * ÖNCELİK: ORTAMDA ZATEN TANIMLI DEĞİŞKEN EZİLMEZ. CI ya da `docker compose`
 * kendi `DATABASE_URL`'ini vermişse dosyadaki geliştirme değeri onu
 * bastırmamalıdır.
 *
 * Kullanım: node scripts/with-root-env.mjs <komut> [argümanlar...]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** packages/db/scripts → packages/db → packages → <kök> */
const rootEnvPath = resolve(here, "..", "..", "..", ".env");

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loaded = 0;
try {
  const parsed = parseEnv(readFileSync(rootEnvPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  console.error(`[with-root-env] ${rootEnvPath} yüklendi (${loaded} yeni değişken).`);
} catch (err) {
  // Dosya yoksa bu bir hata DEĞİLDİR: üretimde değişkenler ortamdan gelir.
  if (err && err.code !== "ENOENT") throw err;
  console.error(`[with-root-env] ${rootEnvPath} bulunamadı; yalnız mevcut ortam kullanılıyor.`);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Kullanım: node scripts/with-root-env.mjs <komut> [argümanlar...]");
  process.exit(2);
}

const child = spawn(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (err) => {
  console.error(`[with-root-env] "${command}" çalıştırılamadı: ${err.message}`);
  process.exit(1);
});
