# Modül 16 — Simülasyon Modları

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 17 `[P1]`

## Amaç

Simülasyon Modları, avukatın dosyayı **başka bir aktörün gözünden** görmesini sağlar: karşı taraf avukatı, hakim ve bilirkişi. Her mod, aynı dosya verisi (dilekçeler, belgeler, safahat, strateji ağacı) üzerinde farklı bir persona ve farklı bir çıktı şemasıyla çalışan ayrı bir AI görevidir. Amaç genel bir sohbet botu değil; her modun **sabit sistem prompt'u ve JSON çıktı şeması** olan, tekrarlanabilir ve karşılaştırılabilir analiz koşularıdır.

Beş temel mod vardır: (1) **Karşı taraf avukatı** — "bu dosyada bana karşı en güçlü N argümanı kur"; (2) **Hakim gözü** — dosyanın usul ve esas yönünden nasıl değerlendirileceği; (3) **Kaybettiren hususlar** — davayı kaybettirebilecek riskler; (4) **Karşı dilekçe zayıflıkları** — karşı tarafın somut dilekçesindeki açıklar; (5) **Bilirkişi odağı** — bilirkişinin teknik olarak takılacağı noktalar. Her koşu `SimulationRun` olarak saklanır; avukat aynı modu dosya geliştikçe tekrar çalıştırıp koşuları karşılaştırabilir.

Simülasyon çıktıları tek başına rapor değildir: bulgular tek tıkla Strateji Motoru'na (Modül 15) düğüm önerisi olarak aktarılır ve Risk Motoru (Modül 17) son koşuların bulgularını risk sinyali olarak okur. Böylece "karşı taraf gibi düşünme" egzersizi büronun operasyonel verisine geri akar.

## Kullanıcı Hikâyeleri

1. **Avukat** olarak, duruşmadan önce "karşı taraf avukatı gibi analiz et" modunu çalıştırıp bana karşı kurulabilecek en güçlü 7 argümanı görmek isterim; böylece cevaplarımı önceden hazırlarım.
2. **Avukat** olarak, karşı tarafın cevap dilekçesini seçip "bu dilekçedeki zayıf noktaları bul" modunu çalıştırmak isterim; böylece replik dilekçemin omurgasını çıkarırım.
3. **Partner** olarak, kritik bir dosyada "hakim gözüyle" analizini okuyup dosyanın usulî eksiklerini (görev, husumet, süre) görmek isterim; böylece sürpriz red riskini erken yakalarım.
4. **Avukat** olarak, "kaybettirebilecek hususlar" modunun her bulgusuna olasılık ve önlem önerisi eklemesini isterim; böylece bulgulardan doğrudan görev üretebilirim.
5. **Avukat** olarak, bilirkişi incelemesi öncesi "bilirkişi hangi noktalara takılır" modunu çalıştırıp eksik teknik belgeleri tamamlamak isterim.
6. **Stajyer** olarak, geçmiş simülasyon koşularını okuyup (çalıştırma yetkim olmadan) duruşma hazırlık notu çıkarmak isterim.
7. **Avukat** olarak, iki koşuyu (bilirkişi raporu öncesi/sonrası) yan yana karşılaştırmak isterim; böylece raporun dosya gücüne etkisini görürüm.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Simülasyon Merkezi | `/app/cases/:caseId/simulations` | 5 mod kartı, geçmiş koşular listesi, koşu durumu (kuyrukta/çalışıyor/bitti) |
| Koşu Sonucu | `/app/cases/:caseId/simulations/:runId` | Şemaya göre render edilmiş bulgular, "Stratejiye aktar" ve "Görev oluştur" aksiyonları, kaynak belge bağlantıları |
| Koşu Karşılaştırma | `/app/cases/:caseId/simulations/compare?a=:id&b=:id` | İki koşunun bulgu bazlı diff'i |

ASCII wireframe — Koşu Sonucu (OPPONENT_SIMULATION):

```
┌─ 2026/145 — Karşı Taraf Avukatı Simülasyonu (koşu #4, bugün 09:12) ┐
│ Model: (BYO-LLM: mindaeon-*)  Girdi: 14 belge, strateji v5           │
├────────────────────────────────────────────────────────────────────┤
│ EN GÜÇLÜ 7 ARGÜMAN (güce göre sıralı)                              │
│ 1. 🔴 Zamanaşımı def'i               Güç: 9/10                     │
│    Dayanağı: TBK m.147 · Bizim açığımız: ıslah tarihi tartışmalı   │
│    Önerilen cevabımız: ... [Stratejiye Aktar] [Görev Oluştur]      │
│ 2. 🟡 Ayıp ihbarının süresinde yapılmadığı   Güç: 7/10             │
│    Kaynak: cevap dilekçesi s.3 ¶2 [belgeyi aç]                     │
│ ...                                                                │
├────────────────────────────────────────────────────────────────────┤
│ ⚠ Bu çıktı AI önerisidir; atıflar Teyit Ajanı'ndan geçmiştir (✔6/7)│
└────────────────────────────────────────────────────────────────────┘
```

## Veri Modeli

**SimulationRun**

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | Kiracı izolasyonu |
| case_id | uuid FK→Case | |
| mode | enum(OPPONENT_SIMULATION, JUDGE_VIEW, LOSS_FACTORS, OPPONENT_BRIEF_WEAKNESS, EXPERT_FOCUS) | Mod |
| params | jsonb | Mod parametreleri: {n_arguments: 7, target_document_id?, focus?} |
| input_snapshot | jsonb | Koşuya giren kaynakların listesi (belge id'leri, strateji versiyonu) — tekrarlanabilirlik |
| status | enum(QUEUED, RUNNING, DONE, FAILED) | |
| result | jsonb | Mod şemasına uygun çıktı (aşağıda) |
| verification_status | enum(PENDING, PASSED, PARTIAL, FAILED) | Teyit Ajanı sonucu |
| ai_usage_log_id | uuid FK→AiUsageLog | Model/token/maliyet izi |
| requested_by / created_at / completed_at | uuid FK→User / timestamptz | |

**SimulationFinding** (result'tan normalize edilir; görev/strateji bağlamak için)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| run_id | uuid FK→SimulationRun | |
| rank | int | Bulgunun sırası |
| title / body | text | |
| severity | enum(LOW, MEDIUM, HIGH, CRITICAL) | Mod içi normalize şiddet |
| citations | jsonb | [{kind, ref, verified}] |
| source_refs | jsonb | [{document_id, locator}] — bulgunun dayandığı yer |
| exported_to | jsonb | {strategy_node_id?, task_id?} — aktarım izi |

## AI Yetenekleri

Ortak sözleşme: **girdi** = maskelenmiş dosya bağlamı (özet + seçili belgeler + strateji ağacı) + mod parametreleri; **çıktı** = modun JSON şeması. Tüm modlarda `source_refs` zorunludur ("hangi belgeye dayandın").

| Görev tipi | Özgün girdi | Çıktı şeması (result) |
|---|---|---|
| `OPPONENT_SIMULATION` | n_arguments (varsayılan 7) | `{arguments: [{rank, title, basis, strength_1_10, our_gap, suggested_reply, citations, source_refs}]}` |
| `JUDGE_VIEW` | — | `{procedural_issues: [...], merits_assessment: [{issue, likely_view, reasoning}], missing_elements: [...], overall_leaning: LEHIMIZE\|ALEYHIMIZE\|BELIRSIZ}` |
| `LOSS_FACTORS` | — | `{factors: [{title, why, likelihood: LOW\|MED\|HIGH, mitigation, related_deadline?}]}` |
| `OPPONENT_BRIEF_WEAKNESS` | target_document_id (zorunlu) | `{weaknesses: [{locator, quote, weakness_type: CELISKI\|DAYANAKSIZ\|USUL\|EKSIK_DELIL, exploit_suggestion}]}` |
| `EXPERT_FOCUS` | uzmanlık alanı (ops.) | `{focus_points: [{topic, why_expert_cares, our_evidence_state: GUCLU\|EKSIK\|YOK, prep_action}]}` |

`OPPONENT_SIMULATION` sistem prompt taslağı:

```
Sen karşı tarafı temsil eden deneyimli bir Türk avukatısın. Sana dosyanın içeriği
verildi; müvekkilin KARŞI TARAF. Görevin: bu dosyada aleyhimize (yani senin lehine)
kurulabilecek EN GÜÇLÜ {n} argümanı, güç sırasına göre üretmek.
KURALLAR: (1) Yalnızca dosya içeriğine ve genel Türk hukukuna dayan; olgu uydurma.
(2) Her argüman için: hukuki dayanak, bizim dosyamızdaki açık (our_gap), ve bu
argümana karşı geliştirilebilecek cevap önerisi (suggested_reply) yaz.
(3) Her argümanın dayandığı belge/pasajı source_refs ile göster.
(4) İçtihat atıfı verirsen daire/esas/karar no belirt; emin değilsen verified:false.
(5) Çıktı SADECE verilen JSON şemasında olsun.
```

`JUDGE_VIEW` sistem prompt taslağı (kısaltılmış): *"Sen bu dosyaya bakan Türk hâkimisin. Önce usul (görev, yetki, husumet, süre, dava şartları), sonra esas yönünden değerlendir; her tespitte hangi taraf lehine olduğunu ve gerekçeni yaz; eksik gördüğün delil/açıklamaları listele. Kesin hüküm kurma — 'muhtemel değerlendirme' üret."*

**KVKK notu**: Tüm mod girdileri maskeleme hattından geçer; kişi adları takma etiketlerle (TARAF_A, TANIK_1) gönderilebilir ve çıktı geri eşlenir. Yerel LLM kiracılarında ham veri seçeneği tenant ayarına bağlıdır. Her koşu `AiUsageLog`'a yazılır.

## İş Kuralları

1. Tüm simülasyon çıktıları **öneri** statüsündedir; hiçbir bulgu otomatik olarak dilekçeye, stratejiye veya göreve dönüşmez — aktarım her zaman kullanıcı aksiyonudur.
2. İçtihat atıfı içeren koşular Teyit Ajanı'na otomatik gönderilir; `verification_status=FAILED` atıflar UI'da üstü çizili + "doğrulanamadı" gösterilir.
3. `OPPONENT_BRIEF_WEAKNESS` yalnızca karşı taraf menşeli bir `Document` seçiliyken çalışır; aksi 422.
4. Simülasyon çalıştırma yetkisi AVUKAT ve üstü; STAJYER ve SEKRETER yalnızca okur.
5. Koşu sonuçları değiştirilemez (immutable); yeniden analiz = yeni koşu.
6. Aynı dosyada aynı mod için eşzamanlı ikinci koşu isteği kuyruklanır (paralel koşu limiti tenant başına yapılandırılır).
7. Simülasyon içerikleri Müvekkil Portalı'na ve müvekkil iletişimine asla çıkmaz (iç çalışma ürünü).
8. `input_snapshot` doldurulmadan koşu başlatılamaz; sonuç ekranı hangi veriyle üretildiğini her zaman gösterir.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| POST | `/api/v1/cases/:caseId/simulations` | body: {mode, params} → koşu oluştur (async) |
| GET | `/api/v1/cases/:caseId/simulations` | Koşu listesi (mode/status filtreli) |
| GET | `/api/v1/simulations/:runId` | Koşu detayı + result |
| GET | `/api/v1/simulations/:runId/findings` | Normalize bulgular |
| POST | `/api/v1/simulations/:runId/findings/:fid/export-to-strategy` | Strateji düğüm önerisi oluştur |
| POST | `/api/v1/simulations/:runId/findings/:fid/create-task` | Bulgudan görev üret |
| GET | `/api/v1/simulations/compare?a=:id&b=:id` | Aynı modda iki koşunun diff'i |

## Diğer Modüllerle İlişkiler

- **Strateji Motoru (15)**: bulgular OPPONENT_ARG/WEAK_POINT düğüm önerisi olarak aktarılır; koşular strateji versiyonunu `input_snapshot`'ta referanslar.
- **Risk Motoru (17)**: son 30 gündeki LOSS_FACTORS ve JUDGE_VIEW bulguları risk sinyali olarak okunur.
- **Duruşma Hazırlık**: duruşma paketi son OPPONENT_SIMULATION koşusunun ilk 3 argümanını içerir.
- **Görev/Workflow**: bulgudan üretilen görev `SimulationFinding.exported_to.task_id` ile izlenir.
- **AI Agents (21)**: koşular BYO-LLM katmanından model seçer (REASONING sınıfı görev); Teyit Ajanı zorunlu geçiş buradan yönetilir.
- **Bilirkişi Yönetimi**: EXPERT_FOCUS, mevcut bilirkişi raporlarını girdiye ekler.

## Kabul Kriterleri

1. Beş modun her biri, örnek dosyada kendi JSON şemasına %100 uyan `result` üretir (şema doğrulaması sunucuda; uymazsa koşu FAILED + hata kaydı).
2. `OPPONENT_SIMULATION` varsayılan olarak tam 7 argüman döner; `params.n_arguments=5` verilince 5 döner.
3. Her bulguda en az bir `source_refs` girişi vardır; kaynaksız bulgu sunucu tarafında elenir ve elendiği loglanır.
4. İçtihat atıflı koşuda teyit süreci otomatik başlar; sonuç ekranı ✔/✖ atıf sayısını gösterir.
5. "Stratejiye aktar" aksiyonu Strateji Motoru'nda onay bekleyen bir düğüm önerisi oluşturur ve `exported_to` alanına yazar.
6. `OPPONENT_BRIEF_WEAKNESS` belge seçilmeden 422; bizim tarafımızın belgesi seçilirse uyarı + 422 döner.
7. Karşılaştırma ucu, farklı modlardaki iki koşu için 400; aynı moddaki iki koşu için bulgu bazlı eklendi/çıktı/değişti listesi döner.
8. STAJYER token'ı ile POST `/simulations` 403, GET uçları 200 döner.
9. Koşu tamamlandığında `AiUsageLog` kaydı (model, token, süre, maliyet) vardır ve `ai_usage_log_id` doludur.
10. Farklı tenant'ın koşusuna erişim 404 döner.

## Faz

**Faz 4** (Strateji Motoru ile birlikte). Sıra: önce `OPPONENT_SIMULATION` + `LOSS_FACTORS` (en yüksek değer), ardından `JUDGE_VIEW`, `OPPONENT_BRIEF_WEAKNESS`, `EXPERT_FOCUS`. Karşılaştırma ekranı Faz 4 sonunda.
