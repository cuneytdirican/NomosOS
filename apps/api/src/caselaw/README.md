# İçtihat & Mevzuat Modülü (Modül 23)

Bu modül üç şey yapar: **kaynak-bağımsız içtihat araması**, **dosyaya emsal bağlama** ve
ürünün halüsinasyon savunmasının kalbi olan **deterministik atıf teyidi (CITATION_VERIFY)**.

---

## 1. GERÇEK DIŞ KAYNAK YOKTUR — ve sahte bir tane de yazılmamıştır

Türkiye'de Yargıtay, Danıştay, BAM, AYM kararları için üçüncü taraflara açık, sözleşmesi
belli, kararlı bir **resmî API bulunmamaktadır**. UYAP'ın da dışarıya açık bir içtihat
servisi yoktur.

Bu nedenle bu depoda **"Yargıtay entegrasyonu" adı altında sahte bir HTTP istemcisi
YOKTUR**. Çalışan iki adaptör yalnızca kendi veritabanımızdaki, kaynağı belli kayıtlarla
çalışır:

| Adaptör | Anahtar | Ne yapar |
|---|---|---|
| `LocalDbCaseLawAdapter` | `YEREL_HAVUZ` | Ortak `CaseLawDocument` havuzunda ILIKE + deterministik skorlama ile arar; künye ile nokta arama yapar. |
| `ManualEntryCaseLawAdapter` | `MANUEL` | Avukatın elle girdiği kararları yazar ve arar. Faz 2'de havuzun **gerçek** verilerle dolduğu tek yol budur. |

Havuzdaki üçüncü kaynak `SEED_DEMO`'dur: seed'in eklediği **sahte örnek kararlar**.
Bunlar `isDemo: true` ile işaretlenir, arama yanıtlarında uyarı üretir ve **dilekçe teyit
kapısını geçemez** (aşağıda).

### Yeni kaynak eklemek

`adapters/types.ts` içindeki `CaseLawSourceAdapter` arayüzünü uygulayan bir sınıf yazın,
`caselaw.module.ts`'te provider olarak kaydedin ve `adapters/registry.service.ts`
içindeki listeye ekleyin. **Başka hiçbir dosya değişmez** — servis ve controller katmanı
adaptörün arkasını bilmez (Modül 23, kabul kriteri 10).

```ts
export interface CaseLawSourceAdapter {
  readonly key: string;
  readonly name: string;
  readonly canSearch: boolean;
  readonly canFetchByCitation: boolean;
  search(query: string, filters?: CaseLawFilters): Promise<CaseLawHit[]>;
  fetchByCitation(query: CaseLawCitationQuery): Promise<CaseLawCitationLookup>;
  healthCheck(): Promise<CaseLawAdapterHealth>;
}
```

---

## 2. Teyit Ajanı (CITATION_VERIFY) — LLM'e sorulmaz

`citation-verify.service.ts` içinde **hiçbir LLM çağrısı yoktur ve olmayacaktır.**

```
ham künye metni
   ↓  packages/legal-ai citation-patterns (regex, deterministik)
{kind, source, chamber, esasNo, kararNo}
   ↓  adaptörlerde esas/karar no BİREBİR eşleşme
FOUND / NOT_FOUND / SEARCH_FAILED
   ↓
DOGRULANDI / BULUNAMADI / BELIRSIZ  →  CitationCheck'e yazılır
```

Statü kuralları (istisnasız):

| Durum | Statü |
|---|---|
| Havuzda birebir eşleşme var, mahkeme ve daire bağdaşıyor | `DOGRULANDI` |
| Arama sağlıklı çalıştı, kayıt yok | `BULUNAMADI` (atıf muhtemelen uydurma) |
| Adaptöre erişilemedi / arama yapılamadı | `BELIRSIZ` (**fail-closed** — asla doğrulanmış sayılmaz) |
| Aynı künyeyle birden çok kayıt | `BELIRSIZ` |
| Künyede daire var, kayıtla bağdaşmıyor | `BELIRSIZ` |
| Esas **veya** karar numarası eksik | `BELIRSIZ` |
| Biçim tanınmadı | `BELIRSIZ` |
| Mevzuat atfı (`HMK m.317`) | `BELIRSIZ` — bkz. aşağı |

### Mevzuat atıfları neden `DOGRULANDI` olmuyor?

`Statute` / `StatuteArticle` / `StatuteArticleVersion` modelleri Faz 2 şemasında **yok**
(Faz 3). Madde numarasının gerçekten var olduğunu ve dava tarihinde yürürlükte olduğunu
deterministik olarak doğrulayacak veri elimizde olmadığı için, mevzuat atfını sessizce
"doğrulandı" saymak tam da önlemeye çalıştığımız hatayı üretirdi. Bu yüzden `BELIRSIZ`
döner ve dilekçe kapısı avukatın **açık beyanını** ister (bkz. `petitions/README.md`).

---

## 3. AI destekli arama — model karar üretmez, sorgu yazar

`POST /caselaw/ai-search` üç adımdır:

1. **CASELAW_SEARCH (LLM)** — soruyu anahtar kelime + kavram listesine çevirir.
   Sistem promptu modelin esas/karar numarası, daire adı veya tarih yazmasını **yasaklar**.
2. **Yerel havuz araması (LLM YOK)** — genişletilmiş sorgu ILIKE ile çalıştırılır.
   Dönen her sonuç veritabanında **gerçekten duran** bir satırdır; künye kayıttan gelir.
3. **CASELAW_SUMMARIZE (LLM)** — bulunan gerçek kararların metni 5 bölümlü şemayla
   özetlenir. Model künye yazamaz; metinde olmayan bilgi için "kararda açık değil" der.

Böylece "AI bir karar uydurup arama sonucu diye sundu" senaryosu mimari olarak imkânsızdır.

---

## 4. KVKK

Dışa giden her metin `@nomosos/ai` `scanPii`'den geçer (`AiRunnerService.applyPiiGate`).
Dış sağlayıcı + PII + onay yoksa **HTTP 409** `{ requiresPiiApproval, findings, maskedText }`.
Dosya bağlamı aramaya **asgari** hâliyle gider: dava türü, mahkeme, konu — **taraf adları
ve kimlik bilgisi bilinçli olarak dışarıda bırakılır** (arama terimi üretmeye katkısı yok).

Karar metinleri kamusal veridir ama yine de taranır; PII bulunursa aynı 409 akışı çalışır.

---

## 5. Uçlar

| Metod | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/caselaw/search?q=&court=&from=&to=&limit=` | Deterministik arama (LLM yok) |
| GET | `/api/v1/caselaw/adapters` | Adaptör sağlık durumu |
| POST | `/api/v1/caselaw/verify` | **Teyit Ajanı** — `{ citations[], sourceType?, sourceId? }` |
| POST | `/api/v1/caselaw/ai-search` | AI destekli arama + özet |
| POST | `/api/v1/caselaw` | Elle karar girişi (HUKUKİ rol) |
| GET | `/api/v1/caselaw/:id` | Karar detayı + bu kiracının bağlı dosyaları |
| POST | `/api/v1/caselaw/:id/summarize` | Tek kararın 5 bölümlü AI özeti |
| GET | `/api/v1/cases/:caseId/caselaw` | Dosyanın emsalleri |
| POST | `/api/v1/cases/:caseId/caselaw` | Emsal bağla (daima `ADAY`) |
| PATCH | `/api/v1/caselaw-references/:id` | `ADAY → KABUL/RED` (HUKUKİ rol) |

## 6. Kiracı izolasyonu

`CaseLawDocument` **ortak havuzdur, `tenantId` alanı yoktur** (içtihat kamusal veridir).
Kiracıya ait olan tek şey `CaseLawReference`'tır ve her sorgusunda `tenantId` süzgeci
vardır. Karar detayında gösterilen "bağlı dosyalar" listesi de yalnızca çağıran kiracının
bağlarını içerir. Ortak havuza kiracıya özgü hiçbir veri (not, dosya bağı) yazılmaz.
