# NomosOS — Kalan Görevler ve Çalışma Sözleşmesi

> **Bu dosya bir çalışma sözleşmesidir.** Kullanıcı, tüm görevler eksiksiz bitene kadar
> durmadan çalışmamı istedi. Bağlam sıkışsa veya oturum yenilense bile buradan devam
> edilir. Her adım bitiminde bu dosyadaki durum işaretlenir ve GitHub'a gönderilir.

## Çalışma Kuralları (değiştirilemez)

1. **Durma yok.** Bir aşama bitince bir sonraki aşama hemen başlatılır; onay beklenmez.
2. **Her aşama ultracode ile çalışır** — çok ajanlı workflow, denetim ve düzeltme fazları dahil.
3. **Her aşama sonunda kendi doğrulamam yapılır** (build + test + canlı duman testi), ajan raporuna körlemesine güvenilmez.
4. **Her aşama sonunda GitHub'a gönderilir** (`cuneytdirican/NomosOS`). `.env` ASLA commit edilmez.
5. **Ürün ilkelerinden taviz verilmez**: AI önerir avukat onaylar · süre ve para hesapları deterministik · kaynak gösterme zorunlu, uydurma yasak · atıflar kayıt üzerinden doğrulanır · KVKK maskeleme onayı · tenant izolasyonu.
6. **Dosya sahipliği** ajanlar arasında keskin bölünür; `app.module.ts`, `main.ts`, kök `package.json` yalnız entegrasyon ajanına aittir.

## Durum

| # | İş | Durum |
|---|----|-------|
| 0 | Faz 0 — İskelet, BYO-LLM, KVKK hattı, monorepo | ✅ |
| 1 | Faz 1 — Legal Core (CRM, dava, duruşma, süre motoru, görev) | ✅ |
| 2 | Faz 2 — AI asistan/RAG, belge→aksiyon hattı, dilekçe, içtihat, UYAP eklentisi | ✅ |
| 3 | Faz 3 — İcra + Copilot, finans, faturalama, platform admin API | ✅ |
| 4 | Faz 4 (strateji/simülasyon/risk/delil/bilirkişi/çakışma) + tanıtım sitesi + Modül 26 kredi sistemi | ✅ |
| 7 | Üretim dağıtımı — `docs/uretim-dagitimi.md`, CI, Docker üretim profili | ✅ ⚠️ |
| 5 | **Faz 5 — Müvekkil portalı, iletişim merkezi, vekaletname, e-Fatura, sözleşme + e-imza** | ⏳ SIRADA |
| 6 | **Faz 6 — Kurumsal raporlama, mobil uygulama, zamanlanmış işler** | ⏳ |
| 8 | **DERİN DENETİM** (aşağıdaki prompt) | ⏳ |
| 9 | Final GitHub gönderimi + kapanış raporu | ⏳ |

### ⚠️ Açık engel — CI dosyaları gönderilemedi

`.github/workflows/ci.yml`, `security.yml` ve `README.md` yerelde hazır ancak GitHub'a
**gönderilemedi**: token'da `workflow` yetkisi yok (GitHub, OAuth uygulamalarının workflow
dosyası yazmasını bu yetki olmadan reddediyor). Çözüm: `gh auth refresh -h github.com -s workflow`
ile yetki verilmesi ya da dosyaların elle eklenmesi. Diğer tüm CI yardımcıları (sır tarayıcı,
dependabot, CodeQL yapılandırması, PR şablonu) gönderildi.

## Aşama 5 — Faz 5 kapsamı

- **Müvekkil portalı** (`apps/portal`, yeni Next.js uygulaması + `PortalUser` ayrı kimlik):
  Dosyalarım · Belgelerim · Son gelişmeler · Duruşmalar · Ödemeler · Mesajlar · Avukatım.
  Avukat neyin yayınlanacağını denetler (`PortalPublication`). Modül 10.
- **İletişim merkezi** (Modül 19): tüm müvekkil iletişim geçmişi, AI durum özeti →
  WhatsApp/e-posta/SMS; **AI taslak yazar, avukat onaylar, sistem gönderir** akışı;
  gelen mesajın dosyaya eşleştirilmesi.
- **Vekaletname** (Modül 12): kapsam/azil/süre takibi, süre uyarıları Deadline motoruna
  bağlı, AI kapsam yeterlilik analizi.
- **e-Fatura/e-Arşiv** (Modül 09 tamamlama): GİB özel entegratör adaptörünün
  gerçek bir sağlayıcıya bağlanabilir hâle getirilmesi (kimlik bilgisi yoksa Noop kalır).
- **Sözleşme + e-imza** (Modül 20): sözleşme yaşam döngüsü, versiyon, sağlayıcı-bağımsız
  `ISignatureProvider`, yenileme/fesih ihbar sürelerinin Deadline'a yazılması.

## Aşama 6 — Faz 6 kapsamı

- **Kurumsal raporlama**: partner dashboard'un tam sürümü, kaydedilebilir raporlar,
  CSV/PDF dışa aktarım, dönemsel karşılaştırmalar, avukat bazlı iş yükü ve verimlilik.
- **Mobil uygulama** (`apps/mobile`, React Native/Expo): aynı API'yi tüketir —
  bugünün duruşmaları, kritik süreler, görevler, dosya arama, belge görüntüleme,
  bildirimler. Tam CRUD hedeflenmez; sahada ihtiyaç duyulan okuma + hızlı aksiyon.
- **Zamanlanmış işler**: `UsageSnapshot` gece toplu işi, süre hatırlatmaları,
  abonelik dönem yenileme (BullMQ + Redis — altyapı zaten ayakta).

## Aşama 7 — Üretim dağıtımı

- `docs/uretim-dagitimi.md`: yönetilen PostgreSQL/S3/Redis, ortam değişkenleri,
  gizli anahtar yönetimi, yedekleme ve geri dönüş, ölçekleme notları.
- Docker üretim profili (çok aşamalı imajlar), sağlık kontrolleri.
- CI: GitHub Actions — `pnpm install`, `build`, `typecheck`, `test`, migration kontrolü.

## Aşama 8 — DERİN DENETİM (kullanıcının verdiği prompt)

> **"do not guess, read all files. read all lines. then deep audit against all projects."**

Uygulama biçimi: çok ajanlı, **tam okuma** esaslı denetim. Ajanlar dosyaları örneklemez,
**baştan sona okur**. Denetim eksenleri:

1. **Spec ↔ kod uyumu** — 26 modül spec'inin her kabul kriteri gerçekten karşılanıyor mu;
   dokümanda vaat edilip kodda olmayan ne var (ve tersi).
2. **Ürün ilkeleri ihlali** — AI'ın deterministik hesabın yerine geçtiği, insan onayının
   atlandığı, kaynak gösterilmeyen, uydurmaya açık her nokta.
3. **Güvenlik** — tenant izolasyonu (her sorgu tek tek), kimlik/aud ayrımı, RBAC'ın
   sunucu tarafında gerçekten uygulanması, dosya yükleme, SSRF, sır sızıntısı.
4. **KVKK** — maskeleme hattında kaçak, RAG'de ham veri saklama, dış sağlayıcıya giden
   her yol, veri minimizasyonu.
5. **Doğruluk** — para aritmetiği (float kullanımı), süre hesabı, faiz ve mahsup sırası,
   KDV, kredi mutabakatı.
6. **Tutarlılık** — Prisma şeması ↔ `docs/02-veri-modeli.md`, `packages/shared` sabitleri ↔
   veritabanı enum'ları, API rota kataloğu ↔ gerçek controller'lar, ölü kod, kullanılmayan
   bağımlılık, TODO/FIXME envanteri.
7. **Test kapsamı** — hangi kritik yol test edilmiyor.

Çıktı: `docs/DENETIM-RAPORU.md` — bulgu listesi (KRİTİK/ÖNEMLİ/İYİLEŞTİRME), her bulguda
dosya:satır, kanıt ve düzeltme önerisi. Ardından KRİTİK ve ÖNEMLİ bulgular düzeltilir ve
düzeltmeler kanıtlanır.

## Aşama 9 — Kapanış

Final build + tüm testler + uçtan uca duman testi → GitHub'a gönderim → kullanıcıya
kapsamlı kapanış raporu (ne yapıldı, ne çalışıyor, ne eksik kaldı, sonraki adımlar).
