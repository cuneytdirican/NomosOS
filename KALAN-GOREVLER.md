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

---

# 🔖 KALDIĞIM YER — 31 Ağustos 2026, 08:30

> Kullanıcı laptopu kapattı, işte devam edecek. **"Devam et" dediğinde buradan başla.**

## Anlık durum

**Derin denetim (Aşama 8) — düzeltme aşamasında, ~%75.**

- Denetim raporu YAZILDI: `docs/DENETIM-RAPORU.md` (630 satır)
  - 71 bulgu üretildi → adversaryal doğrulama → **16 KRİTİK, 34 ÖNEMLİ, 21 İYİLEŞTİRME**
- Düzeltme ajanı çalışırken laptop kapandı; **workflow öldü, ama çalışması diskte duruyor ve commit edildi.**
- Son durum: `pnpm build` 12/12 ✅ · `pnpm -r test` **663 test geçiyor** ✅
  (legal-core 78→79: K-04 için regresyon testi eklenmiş)

## Düzeltilenler (kodda bulgu numarasıyla işaretli)

**KRİTİK (16'da 12):** K-01, K-02, K-03, K-04, K-05, K-06, K-07, K-08, K-09, K-10, K-12, K-13

**KRİTİK — KALAN 4 (İLK İŞ BUNLAR):**
- **K-11** — Dört-göz kataloğu ile yetki matrisi çelişiyor; arayüz söz veriyor, API tutmuyor
- **K-14** — Kural motorundan üretilen sürenin girdisi (tebliğ tarihi/yöntem) düzeltilemiyor
- **K-15** — Liste ekranlarında sayfalama zarfı atılıyor; kayıtlar sessizce kırpılıyor
- **K-16** — Arama istemcide yapılıyor; sunucudaki `q` süzgeci kullanılmıyor

**ÖNEMLİ (34'te en az 13):** Ö-01, Ö-03, Ö-04, Ö-05, Ö-07, Ö-11, Ö-12, Ö-13, Ö-14, Ö-15, Ö-17, Ö-19, Ö-20
(Not: bu bir ALT SINIR — yorumunda bulgu numarası taşımayan düzeltmeler sayıma girmedi.)

## Devam edince yapılacaklar (sırayla)

1. **`docs/DENETIM-RAPORU.md` dosyasını oku** — kalan KRİTİK (K-11, K-14, K-15, K-16) ve
   düzeltilmemiş ÖNEMLİ bulguların tam metnini oradan al.
2. Kalan bulguları düzelt; her düzeltmeye **regresyon testi** ekle.
3. Rapora **"## Düzeltme Turu Sonucu"** bölümünü ekle (hangi bulgu düzeltildi, hangisi neden
   bırakıldı, eklenen test sayısı, son test durumu). Bu bölüm yoksa iş bitmemiş demektir.
4. **Bağımsız doğrulama** — ajan raporuna güvenme, düzeltmeleri kendin canlı test et:
   platform 2FA kurulumu (K-01), `/ai/chat` maskelemesi (K-07), 2027 tatil hesabı (K-04),
   azil sonrası portal erişimi (K-12).
5. **Aşama 8.5 — Docker test ortamı**: `docker-compose.test.yml` (otomatik migration+seed),
   imajları derle ve çalıştığını doğrula. Kayıt defteri seçeneği kullanıcıya soruldu,
   karar bekleniyor (yerel derleme / ghcr.io / Docker Hub — ayrıntı §Aşama 8.5).
6. **Aşama 9 — Kapanış**: final build+test+duman testi, GitHub'a gönderim, kapsamlı
   kapanış raporu.

## Workflow bilgisi (gerekirse)

Ölen düzeltme workflow'u: `resumeFromRunId: "wf_e8e70670-0c4"`,
script: `C:\Users\cdiri\.claude\projects\C--Projeler-NomosOS\f2f9eb96-2326-4f00-a47b-4a6c30f86d9c\workflows\scripts\nomosos-derin-denetim-wf_e8e70670-0c4.js`
Tamamlanan ajanlar önbellekten döner. **Ama muhtemelen daha temizi: kalan 4 kritik bulgu için
yeni ve dar kapsamlı bir workflow açmak** — denetim ve rapor zaten bitti.

## Ortam hatırlatması

- Docker konteynerleri (postgres/redis/minio) laptop kapanınca durur; `docker compose up -d` ile geri başlat.
- API duman testi için: `docs/test-ortami.md` §3 ve ortam değişkenleri.
- Migration tuzağı: sistem saati migration geçmişinin gerisinde. `--create-only` ile üret,
  klasörü elle adlandır. Son migration: `20260906090000_faz6_raporlama_zamanlanmis`.

---

## Durum

| # | İş | Durum |
|---|----|-------|
| 0 | Faz 0 — İskelet, BYO-LLM, KVKK hattı, monorepo | ✅ |
| 1 | Faz 1 — Legal Core (CRM, dava, duruşma, süre motoru, görev) | ✅ |
| 2 | Faz 2 — AI asistan/RAG, belge→aksiyon hattı, dilekçe, içtihat, UYAP eklentisi | ✅ |
| 3 | Faz 3 — İcra + Copilot, finans, faturalama, platform admin API | ✅ |
| 4 | Faz 4 (strateji/simülasyon/risk/delil/bilirkişi/çakışma) + tanıtım sitesi + Modül 26 kredi sistemi | ✅ |
| 7 | Üretim dağıtımı — `docs/uretim-dagitimi.md`, CI, Docker üretim profili | ✅ ⚠️ |
| 5 | Faz 5 — Müvekkil portalı, iletişim merkezi, vekaletname, sözleşme + e-imza | ✅ |
| 6 | Faz 6 — Kurumsal raporlama, zamanlanmış işler, bildirimler, mobil | ✅ |
| 8 | **DERİN DENETİM** (aşağıdaki prompt) | ⏳ |
| 9 | Final GitHub gönderimi + kapanış raporu | ⏳ |

### ✅ Çözülen engel — CI dosyaları

Kullanıcı 31 Ağustos 2026'da token'a `workflow` yetkisi verdi; `ci.yml`, `security.yml` ve
`workflows/README.md` commit `b62e5b1` ile gönderildi. Depo ayarı önerisi: `dogrula` ve
`sir-taramasi` işlerini branch protection'da zorunlu status check yapın.

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

## Aşama 8.5 — Docker imajları ve test ortamı (kullanıcı isteği, 31 Ağustos 2026)

Kullanıcı denetim bitince sistemi Docker üzerinden test etmek istiyor.

**Yapılacak:**
1. Beş imajı yerelde derle ve çalıştığını doğrula: `api`, `web`, `admin`, `portal` (+ `postgres/redis/minio` hazır imajlar). `apps/mobile` imaja girmez (Expo, cihazda çalışır).
2. `docker-compose.test.yml` — TEK KOMUTLA ayağa kalkan test yığını: altyapı + uygulamalar + **otomatik migration ve seed** (operatör elle adım atmasın). Üretim profilinden farkı: sırlar üretilmiş test değerleriyle gelir, MinIO konsolu açıktır, portlar dışarı yayınlanır.
3. `docs/test-ortami.md` — tek sayfa: `docker compose -f docker-compose.test.yml up -d --build`, açılacak adresler, giriş bilgileri, neyin çalıştığı/çalışmadığı.
4. **Kayıt defterine (registry) gönderim** — kullanıcıya seçenek sunuldu, kararı bekleniyor:
   - **(a) Yerel derleme (önerilen, kimlik bilgisi gerektirmez):** kullanıcı kendi makinesinde `--build` ile ayağa kaldırır. Test için yeterli.
   - **(b) GitHub Container Registry (ghcr.io):** GitHub token'ında `write:packages` yetkisi gerekir; depo zaten GitHub'da olduğu için en doğal yol. CI'ya imaj yayımlama adımı eklenebilir.
   - **(c) Docker Hub:** ayrı hesap ve erişim jetonu gerekir. Parola ASLA sohbete yazılmamalı; `docker login` kullanıcı tarafından yapılır ya da erişim jetonu CI secret'ı olarak tanımlanır.

## Aşama 9 — Kapanış

Final build + tüm testler + uçtan uca duman testi → GitHub'a gönderim → kullanıcıya
kapsamlı kapanış raporu (ne yapıldı, ne çalışıyor, ne eksik kaldı, sonraki adımlar).
