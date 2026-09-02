/**
 * Eklenti paketleyici — dist'i NomosOS web sunucusundan indirilecek ZIP'e yazar.
 *
 * NEDEN BAĞIMLILIKSIZ ZIP: Chrome uzantı ZIP'inde girdi adları İLERİ EĞİK
 * ÇİZGİ istenir; Windows PowerShell Compress-AArchive ters eğik çizgi yazar ve
 * Chrome paketi reddeder. Bu betik store-mode (sıkıştırmasız) ZIP'ı elle yazar:
 * CRC32 + local file header + central directory + EOCD — bağımlılık yok.
 *
 * Çıktı: apps/web/public/downloads/nomosos-uyap-koprusu-v{version}.zip
 * (Zip repo'da taşınır; web sunucusu statik olarak servis eder — mağaza YOK.)
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DIST = join(ROOT, "dist");
const MANIFEST = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf-8"));
const VERSION = MANIFEST.version;
const OUT_DIR = join(ROOT, "..", "web", "public", "downloads");
const OUT = join(OUT_DIR, `nomosos-uyap-koprusu-v${VERSION}.zip`);

/** CRC32 — klasik tablo tabanlı uygulama. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** dist altındaki TÜM dosyaları (öncelik sırasıyla) toplar. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** DOSYA ZAMANI (DOS) — ZIP yerel başlığı 2+2 bayt tarih/saat ister. */
function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

const files = walk(DIST);
if (files.length === 0) {
  console.error("dist boş — önce `pnpm --filter @nomosos/uyap-extension build` çalıştırın.");
  process.exit(1);
}

const now = new Date();
const { time, date } = dosDateTime(now);
const locals = [];
const centrals = [];
let offset = 0;

for (const file of files) {
  const content = readFileSync(file);
  // İleri eğik çizgi — Chrome/uzantı standardı.
  const name = relative(DIST, file).split(sep).join("/");
  const nameBuf = Buffer.from(name, "utf-8");
  const crc = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // imza
  local.writeUInt16LE(20, 4); // gereken sürüm
  local.writeUInt16LE(0, 6); // genel amaç bayrakları
  local.writeUInt16LE(0, 8); // yöntem: store (sıkıştırmasız)
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18); // sıkıştırılmış boyut
  local.writeUInt32LE(content.length, 22); // gerçek boyut
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // ek alan uzunluğu
  locals.push(local, nameBuf, content);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // yapan sürüm
  central.writeUInt16LE(20, 6); // gereken sürüm
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30); // ek alan
  central.writeUInt16LE(0, 32); // yorum
  central.writeUInt16LE(0, 34); // disk no
  central.writeUInt16LE(0, 36); // iç öznitelikler
  central.writeUInt32LE(0, 38); // dış öznitelikler
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + content.length;
}

const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4); // disk no
eocd.writeUInt16LE(0, 6); // merkez dizin diski
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, Buffer.concat([...locals, centralBuf, eocd]));
console.log(`Paketlendi: ${OUT} (${files.length} dosya, ${(offset / 1024).toFixed(1)} KB)`);
