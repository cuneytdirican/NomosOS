# Dilekçe Stüdyosu (Modül 22)

Dilekçe burada "AI sohbetinden çıkan metin" değildir: dosyanın yapılandırılmış
verisinden üretilen, **sürümlenen**, **teyit edilen** ve UDF olarak dışa aktarılan bir
varlıktır.

---

## 1. TEYİT KAPISI — nasıl uygulanıyor

Bir dilekçe `HAZIR` statüsüne **yalnızca metnindeki her atıf hesabını verdiğinde** geçer.

```
PATCH /petitions/:id/status { status: "HAZIR" }
   │
   ├─ 1. Güncel sürümün plainText'i alınır
   ├─ 2. Atıflar output-guard'ın atıf çıkarıcısıyla bulunur
   │       (packages/legal-ai · extractCitations + dedupeCitations)
   ├─ 3. CitationVerifyService ile DETERMİNİSTİK doğrulama (LLM YOK)
   │       sonuç → CitationCheck (sourceType=PETITION, sourceId=SÜRÜM kimliği)
   ├─ 4. evaluateReadyGate(...) — petition-gate.ts
   │
   ├─ ok  → statü HAZIR, AuditLog'a teyit özeti + avukat beyanı yazılır
   └─ !ok → HTTP 422 + takılan atıfların listesi (raw · reason · remedy)
```

### Kapının kuralları

| Atıf | Karar |
|---|---|
| İçtihat, `DOGRULANDI` | Geçer |
| İçtihat, `BULUNAMADI` / `BELIRSIZ` | **Bloklar — istisnası yoktur** |
| İçtihat, `DOGRULANDI` ama `[DEMO VERİ]` kaydıyla eşleşmiş | **Bloklar** (demo kayıt gerçek karar değildir) |
| Mevzuat (`HMK m.317`) | Avukatın açık beyanı yoksa **bloklar** |
| Biçimi tanınmayan atıf | **Bloklar** (fail-closed) |

**İçtihat atıfları için geçersiz kılma (override) yolu YOKTUR.** Uydurma bir esas
numarasının mahkemeye gitmesi ürünün kabul edemeyeceği hatadır.

Mevzuat atıfları farklıdır: `Statute*` havuzu Faz 2'de yoktur, dolayısıyla madde
numarasını deterministik doğrulayacak veri yoktur. Sessizce geçirmek yanlış, sonsuza
kadar bloklamak kullanılamaz olurdu. Çözüm **avukatın açık beyanıdır**:

```jsonc
PATCH /petitions/:id/status
{ "status": "HAZIR", "confirmedStatuteCitations": ["HMK m.317"] }
```

Beyan `AuditLog`'a yazılır; sorumluluk kayda geçer.

### Bayat teyit yasağı

Teyit sonuçları dilekçeye değil **SÜRÜME** yazılır (`CitationCheck.sourceId = versionId`).
İçerik değişince yeni `PetitionVersion` doğar; o sürümün hiç teyidi yoktur ve kapı
"teyit çalıştırılmamış" diyerek bloklar. Ayrıca `TEYIT_EDILDI / INCELEMEDE / HAZIR /
DISA_AKTARILDI` statüsündeki bir dilekçenin içeriği değişirse statü otomatik
`TEYIT_EDILIYOR`'a düşer ve `PETITION_VERIFICATION_STALE` denetim kaydı yazılır.

---

## 2. Uydurma emsal riskine karşı alınan önlemler (katman katman)

1. **Prompt katmanı.** `PETITION_DRAFT` ve `PETITION_SECTION_REWRITE`, künye üretimini
   yalnızca bağlamdaki **onaylı emsaller** listesiyle sınırlar; liste boşsa modelden
   numara değil `[EMSAL ÖNERİSİ: ...]` işaretçisi istenir. Üstlerinde
   `NOMOSOS_SYSTEM_CORE_PROMPT` (uydurma yasağı, kaynak zorunluluğu, atıf disiplini) durur.
2. **Bağlam katmanı.** Bağlama yalnızca `CaseLawReference.status = KABUL` emsaller girer;
   `[DEMO VERİ]` kayıtları **bilinçli olarak dışarıda bırakılır** ve yanıtta
   `excludedDemoPrecedents` ile bildirilir.
3. **Şema katmanı.** Çıktı `PetitionDraftOutputSchema` ile doğrulanır; iskelette olmayan
   bölümler dilekçeye **yazılmaz**, `unmatchedSections` olarak raporlanır.
4. **Teyit katmanı.** Prompt ne derse desin, üretilen her künye deterministik doğrulamadan
   geçer. Model kuralı ihlal edip numara uydurursa atıf `BULUNAMADI` olur ve `HAZIR`
   geçişi 422 ile durur (uçtan uca halüsinasyon testi).
5. **Demo verisi katmanı.** Havuzdaki seed kayıtları gerçek karar sanılmasın diye
   `sourceAdapter = SEED_DEMO` ile işaretlenir, arama yanıtında uyarı üretir ve kapıyı
   geçemez.
6. **Dışa aktarım katmanı.** UDF üretimi yalnızca `HAZIR` ve sonrası statülerde açıktır;
   teyit kapısını geçmemiş metin UYAP'a gidecek biçimde paketlenemez.

---

## 3. AI uçları ve KVKK

`buildAiContext` sırası: **önce sağlayıcı tipi çözülür → sonra ham metinlerde PII taranır.**
Dış sağlayıcı + PII + onay yok → **HTTP 409** `{ requiresPiiApproval, findings, maskedText }`.
Onay varsa **her alan tek tek maskelenerek** bağlam kurulur; böylece
`buildCaseContext`'e verilen `piiScanned: true` bildirimi gerçekten doğrudur.

`PETITION_SECTION_REWRITE`'ta bölüm gövdesi ve talimat da ayrıca kapıdan geçer.
Bölüm yeniden yazımında **yalnızca hedef bölüm** değişir; diğer bölümlerin gövdesi
`replaceSection` ile bayt bayt kopyalanır ve yanıtta `unchangedSectionKeys` ile bildirilir.

**Dışa aktarımda maskeleme YOKTUR**: mahkemeye giden metin gerçek taraf bilgilerini
taşımak zorundadır. Maskeleme yalnızca dış LLM'e giden metne uygulanır.

---

## 4. UDF dışa aktarımı — tercih ve gerekçe

Genel `StorageService` başka bir ajanın sahiplik alanındadır (`apps/api/src/storage/**`).
Ona bağımlı olmamak için `petition-export.storage.ts` `@aws-sdk/client-s3`'ü **doğrudan ve
dar bir yüzeyle** kullanır: tek nesne yazma + ön-imzalı `GET` bağlantısı.

- Nesne anahtarı: `${tenantId}/${caseId}/dilekce/${petitionId}-v${n}-${güvenliDosyaAdı}.udf`
  (ortak anahtar deseniyle uyumlu; `documentId` yerine `petitionId`).
- S3 istemcisi **ilk kullanımda** kurulur (`ConfigService` bağımlılığı yok, .env yüklenme
  sırasına duyarsız).
- **S3 yapılandırılmamışsa hata verilmez**: UDF baytları `base64Content` olarak döner ve
  yanıttaki `storage: "INLINE"` + `note` alanı nedeni açıklar. Böylece depolamasız
  ortamlarda da dışa aktarım çalışır.
- Dışa aktarım şu an bir `Document` kaydı **oluşturmaz** — Belge modülü başka bir ajanın
  alanıdır; bağlama Entegrasyon fazında eklenecektir.

UDF üretimi `@nomosos/udf` `createPetitionUdf` ile yapılır. Paket **deneyseldir**
(UDF'in resmî spesifikasyonu yayımlanmamıştır); yanıt bu uyarıyı taşır.

Şablona özgü ek bölümler ("USULE İLİŞKİN İTİRAZLARIMIZ", "İSTİNAF SEBEPLERİMİZ" gibi)
UDF'in sabit iskeletinde karşılığı olmadığı için **AÇIKLAMALAR bloğuna kendi başlıklarıyla,
sırası korunarak** eklenir. Hiçbir bölüm gövdesi atılmaz.

---

## 5. Uçlar

| Metod | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/petition-templates?type=` | Sistem + büro şablonları (sistem salt-okunur) |
| GET | `/api/v1/cases/:caseId/petitions` | Dosyanın dilekçeleri |
| POST | `/api/v1/petitions` | Şablondan taslak aç (`caseId`, `type`, `templateId?`) |
| GET | `/api/v1/petitions/:id` | Detay + güncel sürüm + teyit durumu + kapı önizlemesi |
| POST | `/api/v1/petitions/:id/versions` | Yeni **değiştirilemez** sürüm |
| PATCH | `/api/v1/petitions/:id/status` | Statü; `HAZIR`'da teyit kapısı → 422 |
| POST | `/api/v1/petitions/:id/verify` | Teyidi güncel sürümde çalıştır (LLM yok) |
| POST | `/api/v1/petitions/:id/generate` | `PETITION_DRAFT` — AI taslağı |
| POST | `/api/v1/petitions/:id/sections/:key/rewrite` | `PETITION_SECTION_REWRITE` |
| POST | `/api/v1/petitions/:id/export/udf` | UDF + ön-imzalı indirme bağlantısı |
| DELETE | `/api/v1/petitions/:id` | Sil (gönderilmiş dilekçe silinemez) |

### Roller

- Dilekçe oluşturma / sürüm kaydetme / AI üretimi: `ADMIN, PARTNER, AVUKAT, STAJYER`
- `HAZIR / DISA_AKTARILDI / GONDERILDI` statüleri: yalnız `ADMIN, PARTNER, AVUKAT`
  (stajyer en fazla `INCELEMEDE`'ye gönderebilir)
- Dışa aktarım: `ADMIN, PARTNER, AVUKAT, SEKRETER`
- Silme: `ADMIN, PARTNER, AVUKAT`

---

## 6. Sürümler değiştirilemez

Her düzenleme yeni `PetitionVersion` doğurur; eski sürüm güncellenmez, silinmez.
`@@unique([petitionId, versionNo])` nedeniyle `MAX+1` hesabı yarış koşuludur; sürüm ekleme
`$transaction` içinde yapılır ve `P2002` alındığında sınırlı sayıda yeniden denenir.
`Petition.currentVersionId` skalerdir (FK yok, döngüyü önlemek için); sürüm bulunamazsa
en yüksek `versionNo`'ya düşülür.
