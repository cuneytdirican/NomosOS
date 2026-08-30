# Modül 15 — Strateji Motoru (Strategy Engine)

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 16 `[P1, 9/10]`

## Amaç

Strateji Motoru, bir dava/icra dosyasının hukuki mücadele planını yapılandırılmış, versiyonlanabilir ve dosya geliştikçe kendini güncelleyen bir "strateji ağacı" olarak tutar. Avukatın kafasındaki dağınık plan ("karşı taraf şunu der, biz buna şöyle cevap veririz, elimizde şu delil var") sistemde şu zincirle somutlaşır: **Karşı tarafın argümanları → Bizim argümanlarımız → Deliller → Hukuki dayanak → Zayıf noktalar → Karşı tarafın kullanabileceği argümanlar → Bizim cevaplarımız → Alternatif senaryolar → Risk skoru.**

Modülün ayırt edici özelliği statik bir analiz raporu üretmek değil, **yaşayan bir strateji** tutmaktır: dosyaya yeni belge geldiğinde (örn. karşı tarafın cevap dilekçesi, bilirkişi raporu), Belge → Otomatik Aksiyon hattı (Modül: belge-aksiyon) `STRATEGY_UPDATE` görevini tetikler; AI mevcut strateji ağacını yeni bilgiyle karşılaştırır, etkilenen düğümleri işaretler ve bir **güncelleme önerisi** (diff) üretir. Avukat onaylarsa yeni bir `StrategyVersion` yayınlanır — eski versiyonlar tam geçmişiyle saklanır.

Strateji ağacı ayrıca Simülasyon Modları (Modül 16) ve Risk Motoru'nun (Modül 17) ortak veri temelidir: simülasyon çıktıları ağaca düğüm olarak eklenebilir, risk skoru ağacın "zayıf noktalar" ve "alternatif senaryolar" dallarını girdi olarak kullanır.

## Kullanıcı Hikâyeleri

1. **Avukat** olarak, yeni açtığım dava dosyası için "Strateji oluştur" dediğimde AI'ın dosyadaki dilekçe ve belgelerden tam zincirli bir strateji taslağı üretmesini isterim; böylece sıfırdan yazmak yerine düzenleyerek ilerlerim.
2. **Avukat** olarak, karşı tarafın cevap dilekçesi UYAP'tan düştüğünde sistemin "stratejinin 3 düğümü bu dilekçeden etkileniyor" uyarısı vermesini isterim; böylece stratejim güncelliğini yitirmez.
3. **Partner** olarak, bir dosyanın strateji versiyonları arasındaki farkı (v3 → v5) görmek isterim; böylece dosyanın hukuki seyrini denetlerim.
4. **Avukat** olarak, her argüman düğümüne delil (`Evidence`/`Document`) ve hukuki dayanak (madde/içtihat) bağlamak isterim; böylece duruşmada "bu iddiayı ne destekliyor?" sorusuna tek tıkla cevap veririm.
5. **Stajyer** olarak, bana atanan "emsal karar taraması" görevini tamamladığımda bulduğum içtihatları ilgili strateji düğümüne öneri olarak eklemek isterim; avukat onaylayınca ağaca işlenir.
6. **Partner** olarak, strateji ağacındaki AI önerilerinin Teyit Ajanı'ndan (Modül 21) geçmeden yayınlanamamasını isterim; böylece uydurma içtihat riskini kapatırım.
7. **Avukat** olarak, "alternatif senaryolar" dalında sulh, arabuluculuk ve davaya devam seçeneklerinin tahmini sonuç ve maliyetle listelenmesini isterim; müvekkile seçenek sunarken kullanırım.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Strateji Ağacı | `/app/cases/:caseId/strategy` | Ağaç görünümü (genişlet/daralt), düğüm detay paneli, delil/dayanak rozetleri, risk skoru başlığı, "AI ile güncelle" butonu |
| Versiyon Geçmişi | `/app/cases/:caseId/strategy/versions` | Versiyon listesi, iki versiyon seçip diff görünümü, "bu versiyona dön" |
| Güncelleme Önerisi | `/app/cases/:caseId/strategy/proposals/:proposalId` | Etkilenen düğüm listesi, eski/yeni karşılaştırma, düğüm bazlı Onayla/Reddet |

ASCII wireframe — Strateji Ağacı:

```
┌─ Dosya 2026/145 — Strateji (v5, 12.08.2026)          Risk: 🟡 62 ─┐
│ [AI ile Güncelle] [Versiyonlar] [Simülasyon Çalıştır]             │
├───────────────────────────────────────┬───────────────────────────┤
│ ▼ Karşı Taraf Argümanları (3)         │ DÜĞÜM DETAYI              │
│   ├ KT-1 Zamanaşımı def'i     🔴      │ KT-1: Zamanaşımı def'i    │
│   └ ...                               │ Güç: Yüksek               │
│ ▼ Bizim Argümanlarımız (4)            │ Cevabımız: AR-2 (ıslah    │
│   ├ AR-1 Ayıplı ifa           🟢      │  ile kesilme, TBK m.154)  │
│   │  Deliller: [Fatura][Rapor]        │ Deliller: 2 bağlı         │
│   │  Dayanak: TBK m.227               │ Dayanak: Yarg. 13.HD      │
│ ▼ Zayıf Noktalar (2)                  │  2019/4521 ✔ teyitli      │
│ ▼ Alternatif Senaryolar (3)           │ [Düzenle] [Delil Bağla]   │
└───────────────────────────────────────┴───────────────────────────┘
```

## Veri Modeli

**Strategy** (dosya başına 1 aktif strateji)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | Kiracı izolasyonu (tüm sorgularda zorunlu filtre) |
| case_id | uuid FK→Case | Bağlı dosya |
| current_version_id | uuid FK→StrategyVersion | Yayındaki versiyon |
| risk_score | int (0-100) | Risk Motoru'ndan senkronlanan güncel skor |
| status | enum(DRAFT, ACTIVE, STALE, ARCHIVED) | STALE = güncelleme önerisi bekliyor |
| created_by / created_at / updated_at | uuid / timestamptz | Audit alanları |

**StrategyVersion**

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| strategy_id | uuid FK→Strategy | |
| version_no | int | Artan; strateji içinde benzersiz |
| tree | jsonb | Düğüm ağacının tam anlık görüntüsü (aşağıdaki şema) |
| change_summary | text | Bu versiyonda ne değişti (AI üretir, avukat düzenleyebilir) |
| source | enum(MANUAL, AI_PROPOSAL) | |
| trigger_event_id | uuid FK→TimelineEvent null | Otomatik güncellemeyi tetikleyen olay |
| approved_by / created_at | uuid FK→User / timestamptz | AI önerisiyse onaylayan avukat zorunlu |

**StrategyNode** (sorgulanabilirlik için jsonb'ye ek olarak normalize tablo)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| version_id | uuid FK→StrategyVersion | |
| parent_id | uuid FK→StrategyNode null | Ağaç yapısı |
| node_type | enum(OPPONENT_ARG, OUR_ARG, EVIDENCE_LINK, LEGAL_BASIS, WEAK_POINT, OPPONENT_COUNTER, OUR_REPLY, SCENARIO, RISK_NOTE) | Zincirdeki halka |
| title / body | text | Başlık ve gerekçe |
| strength | enum(LOW, MEDIUM, HIGH) null | Argüman gücü |
| document_ids | uuid[] | Bağlı `Document` kayıtları |
| citations | jsonb | [{kind: MEVZUAT|ICTIHAT, ref, verified: bool, verification_id}] |
| ai_generated | bool | AI üretti mi (öneri statüsü işareti) |
| sort_order | int | Kardeşler arası sıra |

`tree` jsonb şeması: `{nodes: [{id, node_type, title, body, strength, children: [...]}], generated_at, model_used}`.

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı |
|---|---|
| `STRATEGY_BUILD` | Dosya özeti + dilekçeler + belge özetleri + safahat → tam strateji ağacı (jsonb `tree` şemasında) |
| `STRATEGY_UPDATE` | Mevcut `tree` + yeni belge/olay içeriği → etkilenen düğüm listesi + düğüm bazlı değişiklik önerileri (diff) |
| `SCENARIO_EXPLORE` | Ağaç + soru ("sulh olursa?") → yeni SCENARIO düğüm önerileri |

`STRATEGY_BUILD` sistem prompt taslağı:

```
Sen kıdemli bir Türk avukatısın. Sana bir dava dosyasının özeti, taraf dilekçeleri
ve belge özetleri verilecek. Görevin, şu zincirde yapılandırılmış bir dava stratejisi
üretmek: karşı tarafın argümanları, bizim argümanlarımız, her argümanı destekleyen
deliller, hukuki dayanak (kanun maddesi ve varsa içtihat), stratejimizin zayıf
noktaları, karşı tarafın bunlara karşı kullanabileceği argümanlar, bizim cevaplarımız,
alternatif senaryolar (sulh/arabuluculuk/devam) ve genel risk değerlendirmesi.
KURALLAR: (1) SADECE verilen dosya içeriğine dayan; dosyada olmayan olgu uydurma.
(2) Her içtihat atıfında daire/esas/karar no ver; emin değilsen "teyit gerekli" işaretle.
(3) Çıktıyı verilen JSON şemasında döndür, serbest metin ekleme.
(4) Her argümana strength (LOW/MEDIUM/HIGH) ve kısa gerekçe yaz.
```

**KVKK notu**: Prompt'a giden dosya içerikleri Gereksinim 20'deki maskeleme hattından geçer (TCKN, IBAN, telefon, adres, sağlık verisi maskelenir). Yerel LLM (Ollama/custom endpoint) seçili kiracıda maskeleme opsiyonel gevşetilebilir. Tüm çağrılar `AiUsageLog`'a yazılır.

## İş Kuralları

1. AI'ın ürettiği strateji ve güncelleme önerileri her zaman **öneri** statüsündedir; avukat onayı olmadan `ACTIVE` versiyon oluşmaz (`approved_by` zorunlu).
2. İçtihat/mevzuat atıfı içeren düğümler, Teyit Ajanı (`CITATION_VERIFY`, Modül 21) geçişi tamamlanmadan `verified=false` rozetiyle gösterilir; teyitsiz atıf dilekçe üretimine aktarılamaz.
3. Dosyaya `TimelineEvent` türü DILEKCE_GELDI, KARAR_GELDI, BILIRKISI_RAPORU olan olay eklendiğinde strateji `STALE` durumuna çekilir ve `STRATEGY_UPDATE` kuyruğa alınır.
4. Versiyonlar silinemez; yalnızca strateji `ARCHIVED` yapılabilir (AuditLog kaydıyla).
5. Bir düğüm silindiğinde alt ağacı da yeni versiyonda yer almaz; fiziksel silme yok, versiyon farkı olarak tutulur.
6. Strateji ağacındaki `risk_score`, Risk Motoru yeniden hesapladığında otomatik senkronlanır; elle değiştirilemez.
7. Müvekkil Portalı stratejiyi **hiçbir koşulda** göremez (iç çalışma ürünü / sır saklama).
8. Rol yetkileri: STAJYER düğüm önerisi ekleyebilir ama onaylayamaz; onay AVUKAT ve üstü.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/cases/:caseId/strategy` | Aktif strateji + güncel versiyon ağacı |
| POST | `/api/v1/cases/:caseId/strategy/build` | `STRATEGY_BUILD` işini başlat (async, job id döner) |
| GET | `/api/v1/strategies/:id/versions` | Versiyon listesi |
| GET | `/api/v1/strategies/:id/versions/:v1/diff/:v2` | İki versiyon farkı |
| POST | `/api/v1/strategies/:id/proposals/:pid/approve` | Öneriyi (tamamen/düğüm bazlı body ile) onayla → yeni versiyon |
| POST | `/api/v1/strategies/:id/proposals/:pid/reject` | Öneriyi reddet |
| PATCH | `/api/v1/strategies/:id/nodes/:nodeId` | Düğüm elle düzenle (yeni versiyon taslağına yazar) |
| POST | `/api/v1/strategies/:id/nodes/:nodeId/link-document` | Delil/belge bağla |

## Diğer Modüllerle İlişkiler

- **Belge → Otomatik Aksiyon**: yeni evrak sınıflandırılınca `STRATEGY_UPDATE` tetikler.
- **Risk Motoru (17)**: zayıf nokta/senaryo düğümlerini girdi alır; skoru stratejiye yazar.
- **Simülasyon Modları (16)**: simülasyon çıktıları OPPONENT_ARG/WEAK_POINT düğümü olarak içe aktarılabilir.
- **Delil Yönetimi**: `document_ids` üzerinden iddia→delil matrisiyle çift yönlü bağ.
- **Duruşma Hazırlık**: duruşma paketi, aktif stratejinin özetini içerir.
- **AI Agents (21)**: Strateji Ajanı ve Teyit Ajanı bu modülün görevlerini yürütür; BYO-LLM eşlemesi oradan gelir.

## Kabul Kriterleri

1. Belge yüklü bir dosyada "Strateji oluştur" çağrısı 9 halkalı zincirin tamamını içeren bir taslak versiyon üretir (boş dal kalmaz; veri yoksa dal "veri yetersiz" notu taşır).
2. AI taslağı onaylanmadan `Strategy.status = ACTIVE` olamaz; onaysız yayınlama denemesi 409 döner.
3. Karşı taraf dilekçesi eklendiğinde 5 dk içinde strateji `STALE` olur ve bir güncelleme önerisi kaydı oluşur.
4. Güncelleme önerisinde en az bir düğüm reddedilip kalanı onaylandığında yeni versiyon yalnızca onaylanan değişiklikleri içerir.
5. v(n) ile v(n-1) diff uç noktası eklenen/silinen/değişen düğümleri düğüm id bazında listeler.
6. Teyitsiz içtihat atıfı taşıyan düğüm UI'da "teyit bekliyor" rozetiyle görünür ve dilekçe modülüne aktarım isteği 422 döner.
7. Farklı tenant'ın strateji kaydına erişim denemesi 404 döner (id tahmin edilse bile).
8. Her AI çağrısı `AiUsageLog`'a görev tipi, model, token ve maliyetle yazılır.
9. Versiyon geçmişi 50+ versiyonda da listelenebilir (sayfalama), hiçbir versiyon silinemez.
10. STAJYER rolü öneri POST edebilir, approve uçları 403 döner.

## Faz

**Faz 4.** Ön koşullar: dava dosyası çekirdeği (Faz 1), belge analiz hattı (Faz 2), Belge→Aksiyon pipeline'ı (Faz 3). Faz 4'te `STRATEGY_BUILD` + versiyonlama; otomatik `STRATEGY_UPDATE` tetiklemesi Faz 4 sonunda açılır.
