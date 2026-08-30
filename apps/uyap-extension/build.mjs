// NomosOS UYAP Köprüsü — esbuild paketleyici.
// Üç giriş noktası ayrı paketlenir; manifest ve statik dosyalar dist/ altına kopyalanır.
// Chrome "paketlenmemiş uzantı" olarak dist/ klasörünü yükler.
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: ["chrome116"],
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
};

const bundles = [
  // Service worker manifest'te "type": "module" ile tanımlı → ESM çıktı.
  { ...common, entryPoints: [resolve(root, "src/background/service-worker.ts")], outfile: resolve(outdir, "background/service-worker.js"), format: "esm" },
  // Content script klasik script olarak yüklenir → IIFE.
  { ...common, entryPoints: [resolve(root, "src/content/inject.ts")], outfile: resolve(outdir, "content/inject.js"), format: "iife" },
  { ...common, entryPoints: [resolve(root, "src/popup/popup.ts")], outfile: resolve(outdir, "popup/popup.js"), format: "iife" },
];

async function copyStatic() {
  await mkdir(resolve(outdir, "popup"), { recursive: true });
  await mkdir(resolve(outdir, "content"), { recursive: true });
  await mkdir(resolve(outdir, "icons"), { recursive: true });
  await cp(resolve(root, "manifest.json"), resolve(outdir, "manifest.json"));
  // manifest.icons / action.default_icon bunlara işaret eder; eksikse Web Store reddeder.
  await cp(resolve(root, "icons"), resolve(outdir, "icons"), { recursive: true });
  await cp(resolve(root, "src/popup/popup.html"), resolve(outdir, "popup/popup.html"));
  await cp(resolve(root, "src/popup/popup.css"), resolve(outdir, "popup/popup.css"));
  await cp(resolve(root, "src/content/inject.css"), resolve(outdir, "content/inject.css"));
}

async function main() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  if (watch) {
    const contexts = await Promise.all(bundles.map((options) => context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    await copyStatic();
    console.log("[nomosos-uyap] izleme modu açık — dist/ hazır.");
    return;
  }

  await Promise.all(bundles.map((options) => build(options)));
  await copyStatic();
  console.log("[nomosos-uyap] derleme tamam → dist/");
}

main().catch((error) => {
  console.error("[nomosos-uyap] derleme hatası:", error);
  process.exitCode = 1;
});
