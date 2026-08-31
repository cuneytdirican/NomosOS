# NomosOS

**AI-Native Legal Operating System** — Türk hukuk büroları için dosya, müvekkil,
duruşma, süre, görev, icra ve finans yönetimini tek platformda toplayan, üzerine
**kendi LLM'inizi bağlayabildiğiniz** (BYO-LLM) çok kiracılı SaaS.

> Merkez AI değil, **DOSYA**. AI, büronun bütün operasyonel verisinin üzerinde
> çalışan zekâ katmanıdır.

## Doküman Haritası

| Doküman | İçerik |
|---------|--------|
| [docs/00-vizyon.md](docs/00-vizyon.md) | Konumlandırma, hedef pazar, iş modeli |
| [docs/01-mimari.md](docs/01-mimari.md) | Monorepo, multi-tenant, otomatik aksiyon hattı |
| [docs/02-veri-modeli.md](docs/02-veri-modeli.md) | Çekirdek entity'ler (Prisma ile birebir) |
| [docs/03-ai-katmani-byo-llm.md](docs/03-ai-katmani-byo-llm.md) | 5 sağlayıcı adaptörü, anahtar şifreleme, görev→model eşlemesi |
| [docs/04-kvkk-veri-guvenligi.md](docs/04-kvkk-veri-guvenligi.md) | PII tespiti, Maskele→Onayla→Gönder, Private AI |
| [docs/05-uyap-entegrasyonu.md](docs/05-uyap-entegrasyonu.md) | UYAP hub, Chrome extension mimarisi |
| [docs/06-yol-haritasi.md](docs/06-yol-haritasi.md) | Faz 0-6 geliştirme sırası ve çıkış kriterleri |
| [docs/07-arayuz-ve-pazarlama-sitesi.md](docs/07-arayuz-ve-pazarlama-sitesi.md) | UI tasarım sistemi + tanıtım sitesi spec'i |
| [docs/08-tanitim-sitesi-icerik.md](docs/08-tanitim-sitesi-icerik.md) | Tanıtım sitesi: hukuk estetiği tasarım dili + birebir Türkçe metin |
| [docs/test-ortami.md](docs/test-ortami.md) | **Test ortamı: adresler, giriş bilgileri, Docker ile çalıştırma, denenecekler** |
| [docs/uretim-dagitimi.md](docs/uretim-dagitimi.md) | Üretim dağıtımı: topolojiler, sırlar, yedekleme, KVKK yükümlülükleri |
| [docs/moduller/](docs/moduller/) | 26 modülün ayrıntılı spesifikasyonu (25: platform yönetim paneli, 26: AI kota/kredi sistemi) |
| [docs/99-kaynak-gereksinimler.md](docs/99-kaynak-gereksinimler.md) | Kaynak gereksinim analizi (tüm spec'lerin dayanağı) |

## Depo Yapısı

```
apps/web        Next.js 15 — pazarlama sitesi + uygulama arayüzü
apps/api        NestJS — REST API (/api/v1), iş mantığı, AI orkestrasyonu
packages/db     Prisma şeması + migration + seed
packages/ai     BYO-LLM katmanı (Anthropic · OpenAI-uyumlu · Ollama · Gemini · Custom)
packages/shared Zod şemaları, enum'lar, TR hukuk sabitleri, AI görev tipleri
```

## Hızlı Başlangıç (laptop'ta test)

Gereksinimler: Node 20+, pnpm 9+, Docker.

```bash
# 1) Ortam değişkenleri
cp .env.example .env
# .env içinde MASTER_ENCRYPTION_KEY doldurun:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2) Altyapı (PostgreSQL + Redis + MinIO)
docker compose up -d

# 3) Bağımlılıklar + veritabanı
pnpm install
pnpm db:migrate      # ilk çalıştırmada migration adı sorar, örn. "init"
pnpm db:seed

# 4) Geliştirme sunucuları (web: 3000, api: 3001)
pnpm dev
```

Giriş bilgileri (seed) — **tüm demo hesapların parolası `Demo1234!`**:

| Uygulama | Adres | Hesap |
|---|---|---|
| Büro paneli | :3000/giris | `partner@` · `avukat@` · `sekreter@` · `stajyer@demo.nomosos.local` |
| Platform paneli | :3002/giris | `superadmin@nomosos.local` · `analist@nomosos.local` (salt-okur) |
| Müvekkil portalı | :3003/giris | `portal@demo.nomosos.local` |

Ayrıntı, denenecek davranışlar ve bilinen sınırlar: **[docs/test-ortami.md](docs/test-ortami.md)**

### AI'ı denemek

1. Uygulamada **Ayarlar → AI Sağlayıcı** sayfasına gidin.
2. Sağlayıcı ekleyin — en hızlısı, makinede [Ollama](https://ollama.com) çalışıyorsa:
   tip `OLLAMA`, model örn. `llama3.2` (önce `ollama pull llama3.2`).
   Alternatif: `ANTHROPIC` / `OPENAI_COMPAT` / `GEMINI` tipiyle kendi API anahtarınız,
   ya da `CUSTOM` ile tamamen özel bir endpoint.
3. **Bağlantıyı Test Et** ile doğrulayın.
4. Bir dosya açıp **AI Asistan** sekmesinden soru sorun. Dış sağlayıcı + kişisel
   veri tespitinde sistem önce maskeleme onayı ister (KVKK hattı).

### Tam Docker ile (uygulamalar dahil)

```bash
docker compose --profile full up -d --build
```

## Komutlar

| Komut | İş |
|-------|-----|
| `pnpm dev` | Tüm uygulamalar geliştirme modunda |
| `pnpm build` | Monorepo build |
| `pnpm typecheck` | Tip denetimi |
| `pnpm db:migrate` / `db:seed` / `db:generate` | Veritabanı işlemleri |

## Durum

Faz 0 (kuruluş) tamamlandı: 25 modül dokümantasyonu + çalışır iskelet
(auth, müvekkil/dosya/duruşma/süre/görev çekirdeği, BYO-LLM katmanı, KVKK ön-filtresi,
pazarlama sitesi). Sonraki adımlar: [docs/06-yol-haritasi.md](docs/06-yol-haritasi.md).
