# KVKK Veri Kategorileri Politika Matrisi

> **Kaynak doküman:** `docs/faz2/00-yol-haritasi.md` A1 — "İlk task kod değil:
> Avukatlık K. m.39 saklama ↔ append-only denetim izi ↔ KVKK imha çelişkisinin
> politika matrisi."
>
> **ŞEMA-GÜDÜMLÜDÜR:** Kategoriler elle liste değil, Prisma şemasından
> (`packages/db/prisma/schema.prisma`) türetilir. Yeni bir model veri kategorisi
> ekliyorsa bu matris GÜNCELLENMEDİĞİ sürece yeni epic `docs/faz2` kılavuzuna
> göre `A1'i yeniden açar`.
>
> Durum: **v1** — 31.08.2026, Aeon (F2 turu)

## 1. Amaç

Bu matris, NomosOS'un kişisel veri işleyen HER tablosu için tek soru kümesini
yanıtlar: veri ne amaçla tutulur, hangi hukuki dayanakla, ne kadar saklanır,
kim görebilir, veri özne talebi gelince ne olur, yurt dışına çıkar mı, silinince
ne kalır?

**Merkezî çelişki** ve çözümü:

| Yükümlülük | Kaynak | Çelişki | Çözüm (bu matris) |
|---|---|---|---|
| Dosyaları **saklama** | Avukatlık Kanunu m.39 + TBB Üsul İlkeleri | Avukat, vekâlet ilişkisi bitse bile dosyayı saklamak zorundadır | Saklama süresi **hukuki yükümlülük süresiyle** eşitlenir (varsayılan 10 yıl, dosya kapanışından itibaren) |
| **Silme yok etma** talebi | KVKK m.7 (İLGİLİ KİŞİNİN HAKLARI) | Veri özne silme isterse avukat saklama yükümlülüğüyle çatışır | KVKK m.7/1'in **istisnası** uygulanır: "kanunun öngördüğü bir saklama yükümlülüğü" varsa veri silinmez; talep KAYDA geçer ve veri özneye GEREKÇELİ yanıt verilir |
| **Append-only denetim izi** | İç kontrol (denetim raporu Ö-27) | Silme/anonimleştirme denetim izinin bütünlüğünü bozamaz | Denetim izleri **veri kategorisinden AYRI** tablolardadır; KVKK silme talebi denetim izini **değiştiremez** (izler eylemi değil, KİM/NE ZAMAN'ı kaydeder) |

**Kural:** Silme/anonimleştirme talebi geldiğinde sıra: (1) hukuki saklama
yükümlülüğü var mı? → varsa GEREKÇELİ RED + kayıt; (2) yoksa ANONİMİLEŞTİRME
kuyruğu (hard purge değil — izler korunur); (3) hiçbir koşulda append-only
tablolara UPDATE atılmaz.

## 2. Veri kategorileri (şemadan türetilmiş)

| # | Kategori | Prisma modelleri | Kişisel veri türü | KVKK m.6/3 özel kategori? |
|---|---|---|---|---|
| K1 | **Kimlik ve iletişim** | `User`, `Client`, `ClientContact`, `PortalUser`, `PlatformUser` | Kimlik, iletişim, kimlik doğrulama (hash) | Hayır (TCKN alanı: evet — K2'de) |
| K2 | **Kimlik numaraları** | `Client.tckn`, `Client.taxNumber` | TCKN, VKN | TCKN: EVET (yüksek riskli) |
| K3 | **Vekâlet ilişkisi** | `PowerOfAttorney`, `PoaScopeItem` | Taraf, kapsam, tarih | Hayır (hukuki işlem metadata) |
| K4 | **Dosya içeriği** | `Case`, `CaseNote`, `CaseDecision`, `Deadline`, `Hearing`, `Task`, `Claim`, `ClaimEvidenceLink`, `Evidence` | Hukuki değerlendirme, dava konusu | Serbest metin içinde özel kategori TOPLANABİLİR |
| K5 | **Belge içerikleri** | `Document` (ve `ocrText`) | Belge metinleri — taranmış belge TCKN/IBAN içerebilir | Serbest metin içinde özel kategori TOPLANABİLİR |
| K6 | **Finansal** | `Invoice`, `Payment`, `FinancialEntry`, `CreditWallet`, `AiUsageLog` | Ödeme, kredi, kullanım | Hayır |
| K7 | **İletişim kayıtları** | `OutboundMessage`, `InboundMessage`, `MessageTemplate`, `Notification` | Mesaj içeriği, cihaz token'ı | Serbest metin içinde özel kategori TOPLANABİLİR |
| K8 | **Denetim ve güvenlik** | `AuditLog`, `PlatformAuditLog`, `AgentRun`, `AiUsageLog` | Eylem, IP, kullanıcı kimliği | Hayır (ama K5 içeriği ASLA kopyalanmaz — E1 özet sözleşmesi) |
| K9 | **RAG/köşe taşı** | `RagChunk` | MASKELİ metin öbekleri | Maskelenmiş — ama öbek sınıra dayalı maske HER ŞEYİ yakalamaz | 

## 3. Kural kümeleri × kategoriler

Sütun anahtarları — **S**aklama süresi · **İ**şleme amacı/dayanağı · **D**ışa aktarma (veri özne) · **A**nonimleştirme/silme · **Y**urt dışı aktarım · **E**kran erişimi (rol) · **V**ekâlet bitince · **R**ıza gerekli mi · **T**alep gelince

| Kat | S | İ | D | A | Y | E | V | R | T |
|---|---|---|---|---|---|---|---|---|---|
| K1 | Kapanış+10y (hukuki) | Sözleşme/vekillik (m.5/2-c) | ✅ TAM dışa aktarma (JSON) | Anonimleştirme kuyruğu | ❌ (yerinde) | ADMIN+ (PortalUser: kendi) | ✅ tutulur (m.39) | Hayır | Saklama yükümlülüğü GEREKÇELİ reddi + kayıt |
| K2 | Kapanış+10y | Hukuki yükümlülük (m.5/2-ç) | ✅ TAM | K2 ASLA anonimleştirilmez — SİLİNİR | ❌ | Yalnız AVUKAT+ | ✅ tutulur | Hayır | m.7/1 istisnası uygulanır |
| K3 | Süre sonuna kadar (vekillik süresi) | Sözleşme (m.5/2-c) | ✅ | Durum işaretiyle tutulur | ❌ | AVUKAT+ | ❌ pasife çekilir | Hayır | Süre dolumunda otomatik pasif |
| K4 | Kapanış+10y | Hukuki danışmanlık (m.5/2-c) | ✅ TAM (JSON dışa aktarma) | Tutarlılık için ASLA silinmez | ❌ | AVUKAT+ (STAJYER salt-okur) | ✅ tutulur | Hayır | m.7/1 istisnası uygulanır |
| K5 | Kapanış+10y | Hukuki danışmanlık (m.5/2-c) | ✅ (belge indirme bağlantılarıyla) | Belge SİLİNİR (KVKK amacı: ham içerik en riskli veri) | ❌ | AVUKAT+ (TCKN sütunu ASLA maskelenmeden AI'a gitmez) | ✅ tutulur | AI eğitimi için: HAYIR | Silme talebinde öncelikli — saklama yükümlülüğü belge TÜRÜNE göre avukatça değerlendirilir |
| K6 | Mali mevzuat (10y) | Sözleşme + yasal yükümlülük | ✅ TAM | Yasal saklama — SİLİNMEZ | ❌ | ADMIN/PARTNER (STAJYER/SEKRETER sınırlı) | ✅ tutulur | Hayır | Yasal saklama gerekçesi |
| K7 | Kapanış+5y | Sözleşme ifası | ✅ TAM | Anonimleştirme kuyruğu | ❌ | ADMIN+ | ❌ pasif | Hayır | m.7/1 istisnası |
| K8 | 10y (denetim) | İç kontrol + hukuki ispat | KISITLI (kendi eylemleri) | ASLA — append-only | ❌ | Rol bazlı (tenant izleri: ADMIN; platform izleri: SUPER_ADMIN) | ✅ tutulur | Hayır | Red — append-only bütünlüğü |
| K9 | Kapanış+10y | Hizmet kalitesi (m.5/2-c) | ❌ (tümü yeniden üretilebilir) | Belge silinince chunk'lar da SİLİNİR | ❌ (maskeli bile dış LLM'e YALNIZ avukat onayıyla) | Sistem | Belgeyi izler | AI gönderimi için PII onayı akışı | Belge silme talebini izler |

## 4. Uygulama eşlemesi (kod ↔ kural)

| Kural | Koddaki karşılığı | Durum |
|---|---|---|
| Append-only denetim izi | `PlatformAuditLog` trigger (migration `20260909090000`) | ✅ |
| Belge silme talebi > `RagChunk` cascade | Şemada FK cascade (`RagChunk.documentId` onDelete) | ✅ |
| Belge metni maskelenmeden dış LLM'e gitmez | `AiRunnerService.applyPiiGate` (fail-closed) | ✅ |
| Portal erişimi vekâlet bitince düşer | `portal-jwt.guard` KAPI 8 (K-12 kalıntısı) | ✅ |
| Veri özne TAM dışa aktarma | `GET /clients/:id/export` (bu epic) | ✅ (bu belgeyle kapatıldı) |
| Anonimleştirme kuyruğu (hard purge değil) | **AÇIK** — `DELETE /tenants/:id` halen hard purge; dönüşüm A1 kalan ayağı | ⏳ |
| Platform kiracı oluşturma | **AÇIK** — `POST /tenants` yok | ⏳ |

## 5. Yeniden açılma tetikleyicileri

- Şemaya kişisel veri işleyen yeni model eklenirse → matris güncellenir (F1/F2/B3/E6'nın kapanış kriterlerinden biri budur).
- OCR kesiti (B2) açılırsa K5 satırı "OCR metni" alt kategorisiyle genişler.
- UETS entegrasyonu (A3b) açılırsa K7'ye "tebligat kaydı" satırı eklenir.
