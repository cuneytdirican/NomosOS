# NomosOS — Çekirdek Veri Modeli

> Bu doküman `packages/db/prisma/schema.prisma` ile **birebir** uyumludur; şema
> değişiklikleri iki yerde birden yapılır. Modül spec'lerinin (docs/moduller/)
> önerdiği ek entity'ler ilgili fazda bu çekirdeğe eklenir.

## İlkeler

1. **Multi-tenant**: her iş kaydında `tenantId`; tüm sorgular tenant ile süzülür.
2. **Dosya merkezli**: `Case` sistemin merkezidir; duruşma, süre, görev, belge,
   safahat, vekalet ve finans kayıtları dosyaya bağlanır.
3. **Müvekkil ≠ dosya**: `Client` bağımsız köktür; bir müvekkilin onlarca dosyası,
   vekaletnamesi ve finans hareketi olabilir (Gereksinim 1).
4. **AI izi**: her AI çağrısı `AiUsageLog`'a, kritik işlemler `AuditLog`'a yazılır.
5. Kimlikler UUID; para alanları `Decimal(18,2)`, varsayılan para birimi TRY.

## Varlık İlişki Özeti

```
Tenant ─┬─ User ──────────┬─ (sorumlu) Case
        ├─ Client ─┬─ ClientContact
        │          ├─ Case ─┬─ CaseParty
        │          │        ├─ Hearing
        │          │        ├─ Deadline
        │          │        ├─ Task
        │          │        ├─ Document
        │          │        ├─ TimelineEvent (safahat)
        │          │        ├─ PowerOfAttorney
        │          │        └─ FinancialEntry
        │          ├─ PowerOfAttorney
        │          └─ FinancialEntry
        ├─ AiProviderConfig ─┬─ AiTaskRoute (taskType→model)
        │                    └─ AiUsageLog
        └─ AuditLog
```

## Entity'ler

### Tenant — Büro
| Alan | Tip | Açıklama |
|------|-----|----------|
| id | uuid | |
| name | string | Büro adı |

### User — Kullanıcı
| Alan | Tip | Açıklama |
|------|-----|----------|
| email | string, unique | Giriş kimliği |
| passwordHash | string | bcrypt |
| role | enum | ADMIN · PARTNER · AVUKAT · STAJYER · SEKRETER |
| barNumber | string? | Baro sicil no |

### Client — Müvekkil (CRM çekirdeği, Modül 01)
| Alan | Tip | Açıklama |
|------|-----|----------|
| type | enum | GERCEK_KISI · TUZEL_KISI |
| name | string | Ad soyad / ticaret unvanı |
| tckn | string? | KVKK: arayüzde maskeli gösterilir |
| taxNumber, taxOffice | string? | Tüzel kişi |
| email, phone, address, iban | string? | |
| contacts | ClientContact[] | Yetkililer / ilgili kişiler |

### Case — Dosya (sistemin merkezi, Modül 02)
| Alan | Tip | Açıklama |
|------|-----|----------|
| type | enum | DAVA · ICRA · ARABULUCULUK · CEZA · DANISMANLIK |
| status | enum | ACIK · DERDEST · KARAR · ISTINAF · TEMYIZ · KESINLESTI · ICRADA · KAPANDI · ARSIV |
| clientId | fk | Müvekkil |
| responsibleUserId | fk? | Sorumlu avukat |
| courtName | string? | "İstanbul 12. İş Mahkemesi" / "Ankara 4. İcra Dairesi" |
| fileNumber | string? | Esas no (2026/145) |
| judgeName, subject | string? | |
| amount | decimal? | Dava değeri / takip tutarı |
| openedAt, closedAt | date | Yaşam döngüsü |

### CaseParty — Taraf
role: DAVACI · DAVALI · MUDAHIL · ALACAKLI · BORCLU · SANIK · MUSTEKI · KATILAN · TANIK · DIGER;
`isClient` bayrağı müvekkil tarafını işaretler; `lawyerName` karşı vekil.

### Hearing — Duruşma (Modül 03)
type: DURUSMA · ON_INCELEME · KESIF · E_DURUSMA · MUZAKERE · DIGER;
status: PLANLANDI · YAPILDI · ERTELENDI · IPTAL; `date`, `courtroom`, `note` (ara karar özeti).
Endeks: `(tenantId, date)` — "bugünkü duruşmalarım" sorgusunun temeli.

### Deadline — Süre (Modül 04; sistemin en kritik tablosu)
| Alan | Tip | Açıklama |
|------|-----|----------|
| title | string | "İstinaf süresi son günü" |
| dueDate | datetime | |
| source | enum | MANUEL · KURAL (deterministik motor) · AI_ONERISI |
| status | enum | BEKLIYOR (AI önerisi, onay bekler) · ONAYLANDI · TAMAMLANDI · KACIRILDI · IPTAL |
| legalBasis | string? | "HMK m.345 — 2 hafta" |
| computeNote | string? | Hesap izi: tebliğ tarihi + yöntem + tatil kaydırması |

Kural: `source=AI_ONERISI` kayıtlar avukat onayı olmadan `ONAYLANDI` olamaz.

### Task — Görev (Modül 07)
`assigneeId` (sorumlu) + `reviewerId` (kontrol eden) onay zincirinin çekirdeği;
status: ACIK · DEVAM_EDIYOR · KONTROLDE · ONAY_BEKLIYOR · TAMAMLANDI · IPTAL;
priority: DUSUK · NORMAL · YUKSEK · KRITIK.

### Document — Belge (Modül 06)
| Alan | Tip | Açıklama |
|------|-----|----------|
| class | enum | DILEKCE · TENSIP_ZAPTI · ARA_KARAR · GEREKCELI_KARAR · BILIRKISI_RAPORU · DURUSMA_TUTANAGI · TEBLIGAT · MUZEKKERE · VEKALETNAME · SOZLESME · DELIL · FATURA · ICRA_EVRAKI · DIGER |
| classSource | string? | MANUEL veya AI (otomatik sınıflandırma) |
| storageKey | string | MinIO/S3 nesne anahtarı |
| aiSummary | string? | AI özet |

### TimelineEvent — Safahat
`(caseId, date)` sıralı; `source`: MANUEL · UYAP · SISTEM · AI.

### PowerOfAttorney — Vekaletname (Modül 12)
`notary`, `number` (yevmiye), `issuedAt`, `expiresAt`, `revokedAt` (azil), `scope`.

### FinancialEntry — Finans hareketi (Modül 08)
type: TAHAKKUK · TAHSILAT · AVANS · MASRAF · HARC · VEKALET_UCRETI · DANISMANLIK · IADE;
müvekkile ve/veya dosyaya bağlanır. Müvekkil bakiyesi = TAHAKKUK − TAHSILAT (rapor sorgusu).

### AiProviderConfig — BYO-LLM sağlayıcısı (Modül 21, docs/03)
| Alan | Tip | Açıklama |
|------|-----|----------|
| type | enum | ANTHROPIC · OPENAI_COMPAT · OLLAMA · GEMINI · CUSTOM |
| encryptedApiKey | string? | AES-256-GCM (asla düz metin) |
| baseUrl | string? | uyumlu/yerel/özel endpoint |
| defaultModel | string | |
| headersJson, mappingJson | string? | CUSTOM: ek header'lar + alan eşlemesi |

### AiTaskRoute — Görev tipi → model eşlemesi
`(tenantId, taskType)` unique; taskType değerleri `@nomosos/shared` AI_TASK_TYPES.

### AiUsageLog — AI kullanım izi
taskType, model, token sayıları, süre, `piiMasked` (maskeleme uygulandı mı).

### AuditLog — Denetim izi
action ("CLIENT_CREATE", "AI_CHAT", "DOCUMENT_DOWNLOAD"…), entity, entityId, detail.

## Fazlara Göre Genişleme

Modül spec'lerinin önerdiği ek entity'ler (özet; ayrıntı ilgili spec'te):
- Faz 2: `DocumentChunk` (RAG/pgvector), `ChatSession`, `ChatMessage`, `SmartNote`,
  `Petition`, `PetitionVersion`, `PetitionTemplate`, `CaseLawDocument`, `CaseLawReference`,
  `Statute`, `StatuteArticle`, `DeadlineRule` (kural motoru tanımları)
- Faz 3: `EnforcementFile` detayları, `FeeAgreement`, `TimeEntry`, `Invoice`, `Payment`
- Faz 4: `Strategy`, `StrategyNode`, `SimulationRun`, `RiskScore`, `RiskScoreHistory`,
  `Evidence`, `Claim`, `ClaimEvidenceLink`, `Expert`, `ExpertReport`, `ConflictCheck`
- Faz 5: `PortalUser`, `PortalPublication`, `CommunicationLog`, `MessageTemplate`,
  `OutboundMessage`, `Contract`, `ContractVersion`, `SignatureRequest`
