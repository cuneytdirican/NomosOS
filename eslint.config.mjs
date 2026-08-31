// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ NomosOS LINT YAPILANDIRMASI — denetim bulgusu Ö-33b                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ÖNCEKİ DURUM: kökte `"lint": "turbo run lint"`, `turbo.json`da `"lint": {}`,
 * HİÇBİR pakette `lint` script'i, depoda HİÇBİR eslint bağımlılığı ve HİÇBİR
 * yapılandırma dosyası yoktu. Turbo, script'i olmayan paketi sessizce eler;
 * komut 0 görevle BAŞARIYLA çıkıyordu. Yani `pnpm lint` yeşil yanıyor ama
 * hiçbir şeyi denetlemiyordu — çalışmayan bir kontrolden daha kötüsü,
 * çalıştığı sanılan bir kontroldür.
 *
 * ┌─ ÜÇ TASARIM KARARI ────────────────────────────────────────────────────┐
 * │                                                                        │
 * │ 1) TEK KÖK YAPILANDIRMA, PAKET BAŞINA DEĞİL.                           │
 * │    Turbo görevi + 14 ayrı `lint` script'i yerine kökte tek `eslint .`   │
 * │    çalışır. Gerekçe: kurallar depo genelinde AYNI olmalıdır; paket      │
 * │    başına yapılandırma, her paketin kendi kural setini yavaşça          │
 * │    ayrıştırmasıyla biter. `turbo.json`daki boş `lint` görevi de bu      │
 * │    nedenle KALDIRILDI (bkz. oradaki not).                              │
 * │                                                                        │
 * │ 2) TİP BİLGİSİ GEREKTİRMEYEN KURALLAR (`recommended`), tip-farkındalı   │
 * │    (`recommendedTypeChecked`) set DEĞİL.                               │
 * │    Tip-farkındalı lint, 12 paketlik bu depoda `tsc`yi ikinci kez        │
 * │    koşturmak demektir; CI süresi katlanır ve zaten `pnpm typecheck`     │
 * │    adımı vardır. İSTİSNA aşağıda: `no-floating-promises` yalnız         │
 * │    `apps/api` için, tip bilgisiyle açılır — yutulmuş bir `await`in      │
 * │    bedeli (sessizce düşen bir bildirim, mahsup edilmemiş bir kredi)     │
 * │    burada en yüksektir.                                                │
 * │                                                                        │
 * │ 3) MEVCUT KOD GEÇMELİDİR; YENİ KOD UYARILIR.                           │
 * │    Bu tur bir "lint borcu kapatma" turu değildir. `no-explicit-any` ve  │
 * │    `no-floating-promises` UYARI seviyesindedir: CI'ı kırmazlar ama      │
 * │    çıktıda görünür ve zamanla azaltılır. HATA seviyesinde bırakılanlar  │
 * │    yalnız gerçek arıza sınıflarıdır (kullanılmayan değişken değil,      │
 * │    `no-case-declarations` gibi davranış değiştiren desenler).           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ÇALIŞTIRMA: `pnpm lint` (kökte) · `pnpm lint --fix` · CI'da ayrı adım.
 */

export default tseslint.config(
  {
    // ---- Denetlenmeyenler ------------------------------------------------
    // ÜRETİLMİŞ ve DERLENMİŞ çıktı lint'lenmez: uyarıları düzeltilemez ve
    // gerçek bulguları gürültüye boğar.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.d.ts",
      // Prisma istemcisi ve seed çıktıları üretilmiş koddur.
      "packages/db/generated/**",
      "packages/db/prisma/migrations/**",
      // Tarayıcı eklentisinin paketlenmiş çıktısı.
      "apps/uyap-extension/dist/**",
      // Next.js'in kendi ürettiği tip yardımcıları.
      "**/next-env.d.ts",
    ],
  },

  // ---- Temel JavaScript kuralları ---------------------------------------
  js.configs.recommended,

  // ---- TypeScript (tip bilgisi GEREKTİRMEYEN set) ------------------------
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2023,
      },
    },
    rules: {
      /**
       * `any` ÜRÜNDE BİR RİSKTİR ama bu turda 600+ mevcut kullanımı
       * düzeltmek kapsam dışıdır: UYARI olarak başlar, sayısı zamanla düşer.
       */
      "@typescript-eslint/no-explicit-any": "warn",

      /**
       * Kullanılmayan değişken UYARIDIR ve `_` önekli olanlar tamamen
       * muaftır: Nest'te imzayı korumak için kullanılmayan parametre
       * (`_ctx`, `_req`) meşru bir desendir.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      /**
       * `require()` ve `namespace` gibi eski desenler bu depoda yok; kural
       * uyarıda tutulur ki yeni giren kod fark edilsin.
       */
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-expect-error": "allow-with-description" },
      ],

      /**
       * `console` KODDA MEŞRUDUR: açılış günlükleri (`main.ts`), CLI seed
       * script'leri ve tarayıcı eklentisi bilinçli olarak yazar. Nest
       * servislerinde `Logger` kullanılır ama bunu lint değil kod incelemesi
       * denetler.
       */
      "no-console": "off",
      // `catch (err) { ... }` içinde boş blok gerçek bir yutma işaretidir.
      "no-empty": ["error", { allowEmptyCatch: false }],

      /**
       * KONTROL KARAKTERLİ DÜZENLİ İFADE KAPALI.
       *
       * Kural, kontrol karakteri (U+0000–U+001F) içeren bir düzenli ifadeyi
       * "muhtemelen yazım hatası" sayar. Bu depoda tek kullanımı `uyap-extension/src/lib/text.ts`teki
       * TEMİZLEYİCİDİR: UYAP'tan kopyalanan metindeki kontrol karakterlerini
       * ayıklar ve orada kontrol karakteri tam olarak AMAÇTIR. Kuralı açık
       * bırakmak, doğru kodu susturmak için dosyaya `eslint-disable` satırı
       * eklemeyi gerektirirdi.
       */
      "no-control-regex": "off",

      /**
       * ÜÇ KURAL BU TURDA **UYARI**, HATA DEĞİL — gerekçesi ve kapanış planı.
       *
       * Lint bu depoya ilk kez giriyor; amaç mevcut kodu bir gecede yeniden
       * yazmak değil, kontrolü ÇALIŞIR hâle getirmek. Aşağıdaki üç kural
       * bugün toplam DÖRT yerde tetikleniyor ve dördü de bu turun dosya
       * sahipliği dışında kalan alanlarda:
       *
       *   no-irregular-whitespace      apps/admin/src/lib/csv.ts:41
       *   no-useless-escape            apps/api/src/conflict/name-normalize.ts:105
       *   no-constant-binary-expression apps/admin/src/app/(panel)/kullanim/page.tsx:107
       *
       * Sonuncusu GERÇEK bir bulgudur (`?? ` solundaki ifade hiçbir zaman
       * null/undefined olmuyor; yani varsayılan değer ölü kod) ve ilgili
       * ajana ayrıca bildirildi. Dört yer temizlendiğinde bu blok silinir ve
       * kurallar `js.configs.recommended`ın varsayılanına (hata) döner.
       *
       * Kuralı KAPATMAK yerine UYARIYA çekmek bilinçlidir: kapatılan kural
       * görünmez olur ve bir daha hatırlanmaz; uyarı her koşuda çıktıda durur.
       */
      "no-irregular-whitespace": "warn",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
    },
  },

  // ---- apps/api: TİP BİLGİLİ TEK KURAL ----------------------------------
  {
    /**
     * `no-floating-promises` YALNIZ SUNUCU KODUNDA ve yalnız uyarı olarak.
     *
     * NEDEN BURADA: `await`i unutulmuş bir `enqueue`, `settle` ya da
     * `$transaction`, testte de derlemede de görünmez; üretimde sessizce
     * düşen bir bildirim ya da mahsup edilmemiş bir kredi olarak ortaya
     * çıkar. Bu, denetimin bulduğu sınıfın ta kendisidir.
     *
     * NEDEN YALNIZ `apps/api`: tip bilgili lint, TypeScript programını
     * yeniden kurar. Depo genelinde açmak CI'a dakikalar ekler; sunucu
     * kodunda ise kazanç bedelini karşılar.
     */
    files: ["apps/api/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
    },
  },

  // ---- React kancaları (apps/web, apps/admin, apps/portal, apps/mobile) --
  {
    /**
     * `react-hooks` EKLENTİSİ KURULU OLMAK ZORUNDAYDI: ön yüz dosyalarında
     * ZATEN `// eslint-disable-next-line react-hooks/exhaustive-deps`
     * satırları vardı. Eklenti olmadan bu satırlar "tanımsız kural" HATASI
     * üretiyordu — yani ekip yıllardır var olmayan bir lint'i susturuyordu.
     *
     * `rules-of-hooks` HATADIR (koşullu çağrılan bir kanca gerçek bir
     * arızadır), `exhaustive-deps` UYARIDIR: eksik bağımlılık çoğu zaman
     * gerçek bir hatadır ama bilinçli tercih de olabilir; CI'ı kırmadan
     * görünür kalır.
     */
    files: ["apps/{web,admin,portal,mobile}/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ---- Testler ----------------------------------------------------------
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      // Testlerde sahte nesneleri `as unknown as X` ile kurmak meşrudur.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // ---- Yapılandırma dosyaları -------------------------------------------
  {
    files: ["**/*.config.{js,mjs,cjs,ts}", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
