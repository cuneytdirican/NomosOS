# Modül 21 — AI Ajan Mimarisi (AI Agents)

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Temel Tez + Gereksinim 4, 5, 7, 12, 16, 18, 20 (yatay katman)

## Amaç

NomosOS'un tüm AI yetenekleri, dağınık "AI butonları" olarak değil, **tanımlı bir ajan kataloğu** olarak inşa edilir. Ajan = tetikleyicisi (olay / manuel / zamanlı), girdi sözleşmesi, çıktı şeması, kullandığı AI görev tipleri ve **insan onay noktası** açıkça tanımlanmış bir iş birimidir. Her koşu `AgentRun` kaydıyla izlenir: hangi ajan, hangi tetikleyiciyle, hangi model üzerinde, hangi girdiyle koştu ve çıktısı kim tarafından onaylandı/reddedildi. Bu, hem denetlenebilirlik (AuditLog) hem maliyet takibi (`AiUsageLog`) hem de "AI ne yaptı?" sorusunun her zaman cevaplanabilir olması içindir.

Ajanlar doğrudan LLM sağlayıcısına bağlanmaz; **BYO-LLM katmanı** üzerinden çalışır. Her tenant kendi sağlayıcısını bağlar (`AiProviderConfig`: Anthropic, OpenAI ve OpenAI-uyumlu, Gemini, Ollama/yerel, özel endpoint) ve her **AI görev tipi** bir model sınıfına eşlenir (görev tipi → model eşleme tablosu). Böylece aynı ajan, bir büroda Claude ile, KVKK-hassas başka büroda yerel Ollama modeliyle koşar; kod değişmez.

Halüsinasyon savunması mimarinin parçasıdır: içtihat/mevzuat atıfı üretebilen her ajanın çıktısı **Teyit/Doğrulama Ajanı'ndan zorunlu geçer**; kaynak göstermeyen bulgular sunucu tarafında elenir; doğrulanamayan atıflar kullanıcıya işaretli gösterilir ve dilekçe/iletişim gibi dışa dönük çıktılara aktarılamaz.

## Kullanıcı Hikâyeleri

1. **Avukat** olarak, UYAP'tan evrak düştüğünde Belge Sınıflandırma + Süre Tespit ajanlarının zinciri otomatik koşup bana "ara karar geldi, 2 haftalık süre önerisi, görev taslağı" paketi sunmasını isterim; ben yalnız onaylarım.
2. **Partner** olarak, tenant ayarlarında görev tipi → model eşlemesini görmek ve değiştirmek isterim (örn. REASONING görevleri güçlü modele, EXTRACTION ucuz modele).
3. **Admin** olarak, KVKK-hassas büromda tüm ajanları yerel Ollama endpoint'ine bağlamak ve "veri dışarı çıkmaz" modunu tenant seviyesinde zorlamak isterim.
4. **Avukat** olarak, herhangi bir ajan çıktısının ekranında "hangi model, hangi girdi, hangi kaynaklar" bilgisini görmek isterim; kara kutu istemem.
5. **Partner** olarak, ajan bazlı aylık maliyet/koşu raporu isterim (`AiUsageLog` üzerinden); hangi ajan değer üretiyor göreyim.
6. **Avukat** olarak, Teyit Ajanı bir içtihat atıfını doğrulayamadığında bunun dilekçe taslağına kırmızı işaretle yansımasını ve o atıf çıkarılmadan UYAP gönderim görevinin açılmamasını isterim.
7. **Sekreter** olarak, ajanların ürettiği görev/süre önerilerini tek onay kuyruğunda görüp yetkili avukata yönlendirmek isterim.
8. **Admin** olarak, bir ajanı tenant genelinde kapatabilmek isterim (örn. İletişim Ajanı'nı portal yayınına kadar).

## Ajan Kataloğu

| # | Ajan | Tetikleyici | Girdiler | Çıktılar | AI görev tipi | İnsan onay noktası |
|---|---|---|---|---|---|---|
| 1 | **Belge Sınıflandırma Ajanı** | Olay: yeni `Document` (UYAP sync / yükleme / e-posta eki) | Belge içeriği (OCR'lı), dosya bağlamı | Belge türü, ilgili dosya önerisi, özet, `TimelineEvent` taslağı | `DOC_CLASSIFY`, `DOC_SUMMARIZE` | Düşük güvenli sınıflandırmada (confidence<0.8) dosya bağlama onayı; yüksek güvende otomatik bağlar + bildirim |
| 2 | **Süre Tespit Ajanı** | Olay: sınıflandırılmış belge (karar/tebligat türleri) | Belge metni, tebliğ bilgisi, dosya tipi | Süre önerisi: {süre türü, başlangıç, öneri son gün, dayanak} → deterministik kural motoru doğrulaması | `DEADLINE_DETECT` | **Zorunlu**: avukat onayı olmadan `Deadline` kesinleşmez (öneri statüsünde listelenir) |
| 3 | **Duruşma Hazırlık Ajanı** | Manuel ("duruşmalarımı hazırla") + zamanlı (duruşmadan 2 gün önce) | Dosya özeti, safahat, son beyanlar, strateji, önceki tutanak | Duruşma paketi: özet, gelişmeler, eksik deliller, sorulacak sorular, ileri sürülecek hususlar | `HEARING_PREP` | Paket bilgilendiricidir; duruşmada kullanım avukat takdiri (onay kapısı yok, teyit geçişi var) |
| 4 | **İcra Copilot** | Manuel (dosya içi komutlar) + olay: yeni icra işlemi | İcra dosyası işlemleri, malvarlığı sorguları, itirazlar | İşlem analizi, sonraki adım önerileri, kaçırılan süre tespiti, tahsilat ihtimali değerlendirmesi | `ENFORCEMENT_ANALYZE`, `COLLECTION_ESTIMATE` | Önerilen icra işlemi göreve dönüşürken avukat onayı |
| 5 | **Strateji Ajanı** | Manuel (build) + olay: strateji STALE (yeni dilekçe/karar) | Dosya içeriği, mevcut strateji ağacı | Strateji taslağı / güncelleme diff önerisi (Modül 15) | `STRATEGY_BUILD`, `STRATEGY_UPDATE` | **Zorunlu**: versiyon yayını avukat onayıyla |
| 6 | **Teyit/Doğrulama Ajanı** | Olay: atıf içeren herhangi bir ajan çıktısı (zorunlu ara katman) | Çıktıdaki içtihat/mevzuat atıf listesi | Atıf başına {verified, kaynak metni, uyumsuzluk notu}; `VerificationResult` | `CITATION_VERIFY` | Onay değil **kapı**: FAILED atıf dışa dönük çıktıya aktarılamaz |
| 7 | **Müvekkil İletişim Ajanı** | Manuel ("durum özeti hazırla") + olay: Belge→Aksiyon hattının bilgilendirme aksiyonu | Dosya safahatı, hedef kanal, şablonlar | Anlaşılır Türkçe mesaj taslağı (`OutboundMessage.DRAFT`) | `CLIENT_STATUS_SUMMARY`, `MESSAGE_CASE_MATCH` | **Zorunlu**: gönderim yalnız avukat onayıyla (Modül 19 akışı) |
| 8 | **Conflict Check Ajanı** | Olay: yeni `Client`/karşı taraf kaydı + manuel tarama | Yeni taraf kimliği, mevcut müvekkil/karşı taraf/dosya taraf indeksi | Çatışma raporu: {eşleşme türü, kayıt, benzerlik gerekçesi, şiddet 🟢/🟡/🔴} | `CONFLICT_CHECK` | 🔴/🟡 bulguda müvekkil kabulü PARTNER onayına düşer |
| 9 | **Risk Ajanı** | Zamanlı (gece 03:00) + olay: deadline/belge/duruşma/finans değişikliği | Kural sinyalleri, dosya özeti, simülasyon bulguları | Boyut bazlı risk düzeltmeleri + gerekçeler (Modül 17) | `RISK_ASSESS`, `RISK_EXPLAIN` | Skor otomatik yazılır (±25 sınırlı düzeltme); avukat override hakkı saklı |

Zamanlı onuncu koşu: **Günlük Önceliklendirme** (`DAILY_PRIORITIZE`, Modül 18) Risk Ajanı ailesinde, her sabah 06:30'da tenant başına koşar.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Ajan Merkezi | `/app/agents` | Katalog kartları (açık/kapalı, son koşu, başarı oranı), tenant bazlı aç/kapat |
| Koşu Geçmişi | `/app/agents/runs?agent=&status=` | Filtreli koşu listesi, girdi/çıktı/model/maliyet detayı |
| Onay Kuyruğu | `/app/agents/approvals` | Tüm ajanların bekleyen önerileri tek kuyrukta (tip filtreli) |
| Model Eşleme | `/app/settings/ai/models` | Görev tipi → model sınıfı → sağlayıcı modeli matrisi (ADMIN) |

ASCII wireframe — Koşu detayı:

```
┌─ AgentRun #ar-8412 — Süre Tespit Ajanı            Durum: ONAY BEKLİYOR ─┐
│ Tetikleyici: Belge #d-231 (ara karar) sınıflandırıldı · 12.08 14:03      │
│ Model: (EXTRACTION → tenant: ollama/qwen-local) · 4.1k token · ₺0,00     │
├──────────────────────────────────────────────────────────────────────────┤
│ ÖNERİ: "Bilirkişi raporuna itiraz — son gün 26.08.2026"                  │
│ Dayanak: tebliğ 12.08 + HMK m.281 (2 hafta) · Kural motoru: ✔ uyumlu     │
│ Kaynak: belge s.2 ¶3 "iki haftalık kesin süre..."  [belgeyi aç]          │
│ [✔ Onayla → Deadline oluştur]  [✎ Düzelt]  [✖ Reddet (gerekçe)]          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Veri Modeli

**AgentDefinition** (katalog; sistem seed'i + tenant override)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant null | null = sistem tanımı; tenant satırı override eder |
| agent_key | text | DOC_CLASSIFIER, DEADLINE_DETECTOR, HEARING_PREP, ENFORCEMENT_COPILOT, STRATEGY, VERIFIER, CLIENT_COMM, CONFLICT_CHECK, RISK |
| enabled | bool | Tenant bazlı aç/kapat (VERIFIER kapatılamaz) |
| triggers | jsonb | [{type: EVENT\|MANUAL\|SCHEDULED, event_key?/cron?}] |
| task_types | text[] | Kullandığı AI görev tipleri |
| approval_mode | enum(MANDATORY, CONFIDENCE_GATED, INFORMATIONAL, GATE) | İnsan onay modeli |
| config | jsonb | Ajan özel eşikler (örn. confidence eşiği) |

**AgentRun**

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| agent_key | text | |
| trigger | jsonb | {type, event_id?/user_id?/cron} |
| case_id / client_id | uuid FK null | Bağlam |
| input_refs | jsonb | Girdi kaynakları (belge/strateji/sinyal id'leri) |
| status | enum(QUEUED, RUNNING, AWAITING_APPROVAL, APPROVED, REJECTED, APPLIED, FAILED, SKIPPED) | |
| output | jsonb | Ajan çıktı şeması |
| verification_id | uuid FK→VerificationResult null | Teyit geçişi sonucu |
| approved_by / approval_note | uuid FK→User null / text | |
| ai_usage_log_ids | uuid[] | Koşudaki tüm LLM çağrıları |
| started_at / completed_at | timestamptz | |

**VerificationResult**

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| source_run_id | uuid FK→AgentRun | Doğrulanan çıktı |
| citations | jsonb | [{kind: ICTIHAT\|MEVZUAT, ref, verified: bool, matched_source, mismatch_note}] |
| status | enum(PASSED, PARTIAL, FAILED) | PARTIAL: en az bir atıf doğrulanamadı |
| checked_against | jsonb | Kullanılan kaynaklar (mevzuat DB sürümü, içtihat indeksi) |
| created_at | timestamptz | |

**Görev tipi → model sınıfı eşlemesi** (`AiProviderConfig.task_model_map` jsonb; varsayılan tablo):

| Model sınıfı | Görev tipleri | Örnek eşleme (tenant seçer) |
|---|---|---|
| REASONING (güçlü) | STRATEGY_BUILD/UPDATE, OPPONENT_SIMULATION, JUDGE_VIEW, LOSS_FACTORS, RISK_ASSESS, CONTRACT_REVIEW, HEARING_PREP, ENFORCEMENT_ANALYZE | Anthropic güçlü model / yerel 70B |
| EXTRACTION (hızlı/ucuz) | DOC_CLASSIFY, DEADLINE_DETECT, MESSAGE_CASE_MATCH, CONTRACT_KEYDATA_EXTRACT, CONFLICT_CHECK | Hızlı model / yerel 8B |
| DRAFTING | CLIENT_STATUS_SUMMARY, RISK_EXPLAIN, CONTRACT_DIFF_SUMMARY, DOC_SUMMARIZE | Orta model |
| VERIFICATION | CITATION_VERIFY | Deterministik arama + orta model (düşük sıcaklık) |

## AI Yetenekleri (çapraz kesit)

Ajanların görev tipleri ilgili modüllerde tanımlıdır; bu modül iki çapraz görevi tanımlar:

`CITATION_VERIFY` — girdi: atıf listesi; süreç: önce **deterministik arama** (mevzuat DB'de madde metni, içtihat indeksinde esas/karar no), sonra LLM ile "atfın kullanıldığı önerme, kaynak metinle uyumlu mu?" karşılaştırması; çıktı: atıf başına verified + uyumsuzluk notu. Sistem prompt taslağı:

```
Sen bir hukuk kontrolörüsün. Sana (a) bir metinde kullanılan atıf ve o atıfla
desteklenen önerme, (b) atfın gerçek kaynak metni verildi. Görevin YALNIZCA
karşılaştırma: kaynak metin bu önermeyi gerçekten destekliyor mu?
verdict: SUPPORTS | PARTIAL | CONTRADICTS | UNRELATED. Tek cümle gerekçe yaz.
Kaynak metin sana verilmediyse verdict üretme, NOT_FOUND döndür. Yorum ekleme.
```

`DEADLINE_DETECT` — girdi: belge metni + tebliğ verisi; çıktı: süre önerileri. **Hibrit ilke (Gereksinim 4)**: AI yalnız tespit eder ("bu bir ara karar, 2 haftalık süre veriyor, tebliğ 12.08"); son gün hesabını **deterministik kural motoru** yapar (mevzuat süresi + tebliğ yöntemi + resmi tatiller). AI hesabıyla kural motoru çelişirse öneri "çelişki" bayrağıyla onaya düşer.

**KVKK notu (katman geneli)**: Her ajan çağrısı Gereksinim 20 maskeleme hattından geçer (TCKN, telefon, adres, IBAN, e-posta, sağlık verisi, çocuk verisi). Tenant "Private AI" modundaysa yalnız LOCAL sınıfı sağlayıcılar (Ollama/özel endpoint) kullanılabilir; bulut modeli eşlenmiş görev tipi koşmaz, koşu SKIPPED + uyarı üretir. Tüm çağrılar `AiUsageLog`'a (görev tipi, model, token, maliyet, maskeleme durumu) yazılır.

## İş Kuralları

1. **Tüm ajan çıktıları öneridir.** Veri yazan aksiyonlar (Deadline, Task, StrategyVersion, OutboundMessage gönderimi) `approval_mode`'a göre insan onayından geçer; INFORMATIONAL çıktılar bile "AI üretti" rozetiyle gösterilir.
2. **Teyit zorunlu geçişi**: içtihat/mevzuat atıfı üretebilen görev tiplerinin (REASONING + DRAFTING sınıfının atıf üretenleri) çıktısı, Teyit Ajanı koşusu tamamlanmadan AWAITING_APPROVAL'a düşmez. VERIFIER ajanı tenant tarafından kapatılamaz.
3. **Kaynak gösterme zorunluluğu**: bulgular `source_refs`/`refs` olmadan sunucuda elenir; elenen bulgu sayısı koşu kaydında raporlanır.
4. FAILED/UNRELATED atıf taşıyan içerik dilekçe üretimine, UYAP gönderim görevine ve müvekkil iletişimine aktarılamaz (422); UI'da üstü çizili + gerekçeli gösterilir.
5. Görev tipi → model eşlemesi tenant'ta tanımsızsa sistem varsayılanı kullanılır; hiçbir görev "eşleme yok" diye sessizce başka sınıfa düşmez (koşu FAILED + config uyarısı).
6. Olay tetiklemeli ajanlar idempotenttir: aynı olay id'siyle ikinci tetikleme SKIPPED döner.
7. Ajan koşuları tenant başına eşzamanlılık ve günlük bütçe limitine tabidir (`AiProviderConfig.budget`); bütçe aşımında zamanlı koşular durur, manuel koşular uyarıyla devam eder (ADMIN kararı).
8. `AgentRun` ve `VerificationResult` silinemez; kişisel veri içeren `output` alanları KVKK saklama süresi sonunda anonimleştirilir, koşu iskeleti kalır.
9. Onay/red aksiyonları AuditLog'a yazılır; reddedilen önerinin gerekçesi ajan iyileştirme metriklerine (kabul oranı) işlenir.
10. Bir ajanın çıktısı başka ajanı tetikleyebilir (zincir: DOC_CLASSIFY → DEADLINE_DETECT → görev taslağı), ancak zincir derinliği ≤ 4 ve her halka kendi `AgentRun` kaydını üretir (döngü koruması).

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/agents` | Katalog + tenant durumu |
| PATCH | `/api/v1/agents/:agentKey` | enable/config (ADMIN; VERIFIER disable → 422) |
| POST | `/api/v1/agents/:agentKey/run` | Manuel koşu (body: bağlam) |
| GET | `/api/v1/agent-runs?agent=&status=&case_id=` | Koşu listesi |
| GET | `/api/v1/agent-runs/:id` | Koşu detayı (girdi/çıktı/teyit/maliyet) |
| POST | `/api/v1/agent-runs/:id/approve` · `/reject` | Onay kuyruğu aksiyonları |
| GET | `/api/v1/agent-runs/approvals` | Bekleyen öneriler (tüm ajanlar) |
| GET/PUT | `/api/v1/settings/ai/task-model-map` | Görev tipi → model eşlemesi (ADMIN) |
| GET | `/api/v1/agents/usage-report?from=&to=&group_by=agent` | Maliyet/koşu raporu |

## Diğer Modüllerle İlişkiler

Bu modül yatay katmandır: Belge→Aksiyon hattı (ajanların ana olay kaynağı), Süre Motoru (DEADLINE_DETECT önerilerinin kural doğrulaması), Strateji (15), Simülasyon (16), Risk (17), Dashboard (18, zamanlı önceliklendirme), İletişim (19), Sözleşme (20), İcra Modülü, Conflict Check ve Müvekkil CRM ajan katalogu üzerinden bu altyapıyı kullanır. `AiProviderConfig`/`AiUsageLog` çekirdek şemadandır; KVKK maskeleme hattı Gereksinim 20 bileşenidir.

## Kabul Kriterleri

1. Katalogdaki 9 ajanın her biri `AgentDefinition` seed'iyle gelir; tetikleyici, görev tipleri ve approval_mode dolu olmadan migration geçmez.
2. UYAP'tan gelen örnek ara karar belgesiyle DOC_CLASSIFY → DEADLINE_DETECT zinciri koşar; süre önerisi AWAITING_APPROVAL'da bekler, onaysız `Deadline` oluşmaz.
3. AI son-gün hesabı kural motoruyla çelişen öneri "çelişki" bayrağıyla onaya düşer; bayraksız otomatik onay yolu yoktur.
4. Sahte esas/karar no'lu atıf içeren test çıktısında Teyit Ajanı NOT_FOUND/FAILED üretir; bu içerik dilekçe modülüne aktarımda 422 alır.
5. Kaynaksız (refs boş) bulgular sunucuda elenir ve koşu kaydında "elenen bulgu: N" görünür.
6. Tenant model eşlemesi değiştirildiğinde (REASONING → farklı model) sonraki koşu yeni modelle koşar ve `AiUsageLog` bunu gösterir; eşleme silinirse koşu FAILED + config uyarısı üretir.
7. "Private AI" modlu tenant'ta bulut sağlayıcıya eşlenmiş görev SKIPPED olur ve hiçbir payload dış endpoint'e gitmez (ağ izleme testi).
8. Aynı `event_id` ile çift tetikleme tek işlenen koşu + bir SKIPPED kaydı üretir.
9. VERIFIER'ı kapatma denemesi 422 döner; diğer ajanlar kapatılınca tetikleyicileri koşu üretmez.
10. Günlük bütçe aşıldığında zamanlı koşular durur, olay bildirimle ADMIN'e düşer; manuel koşu uyarı metniyle devam eder.
11. `agent-runs/:id` detayında model, token, maliyet, girdi referansları ve teyit sonucu eksiksiz görünür; farklı tenant'ın koşusu 404 döner.

## Faz

**Tüm fazlara yayılır.** Faz 1: AgentRun/AiUsageLog altyapısı + Belge Sınıflandırma + Süre Tespit (çekirdek değer). Faz 2: Duruşma Hazırlık + Teyit Ajanı (araştırma/dilekçe yetenekleriyle birlikte). Faz 3: İcra Copilot + Conflict Check (Belge→Aksiyon hattı olgunlaşınca). Faz 4: Strateji + Risk ajanları + günlük önceliklendirme. Faz 5: Müvekkil İletişim Ajanı. Model eşleme matrisi ve Private AI modu Faz 1'den itibaren zorunlu altyapıdır (BYO-LLM ürünün kuruluş ilkesi).
