# Modül 17 — Risk Motoru (Risk Engine)

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 18 `[P1, 9/10]`

## Amaç

Risk Motoru, bürodaki her dosya için **yedi boyutta** sürekli güncellenen bir risk profili tutar: Hukuki Risk, Süre Riski, Delil Riski, Tahsilat Riski, Usul Riski, İçtihat Riski ve Karşı Taraf Riski. Her boyut 0-100 arası sayısal skor ve 🟢 (0-39) / 🟡 (40-69) / 🔴 (70-100) bandıyla gösterilir; dosyanın genel skoru boyutların ağırlıklı ortalamasıdır. Hedef, partnerin sabah tek bakışta "büromda riskli 17 dosya var" diyebilmesi ve her skorun **neden** o seviyede olduğunun gerekçeleriyle izlenebilmesidir.

Skor hesabı **hibrittir**: (a) **kural tabanlı sinyaller** — deterministik, dosya verisinden hesaplanır (örn. 3 gün içinde cevaplanmamış kritik süre → Süre Riski +40; delil listesindeki iddiaların %60'ının bağlı delili yok → Delil Riski sinyali; borçlunun malvarlığı sorgusu boş → Tahsilat Riski sinyali); (b) **AI değerlendirme** (`RISK_ASSESS`) — kural sinyallerinin yakalayamadığı nitel riskleri (çelişkili tanık beyanı, aleyhe içtihat eğilimi, karşı vekilin agresif usul stratejisi) puanlar ve gerekçelendirir. Nihai boyut skoru `clamp(kural_taban + AI_düzeltme, 0, 100)` formülüyle birleşir; AI düzeltmesi boyut başına ±25 ile sınırlıdır ki deterministik taban ezilmesin.

Skorlar `RiskScoreHistory` ile zaman serisi olarak saklanır: "bu dosyanın riski neden Mayıs'tan beri yükseliyor?" sorusu grafikle cevaplanır. Büro geneli riskli dosya listesi Partner Dashboard'un (Modül 18) ana beslemesidir.

## Kullanıcı Hikâyeleri

1. **Partner** olarak, büro genelinde skoru 🔴 olan dosyaları sorumlu avukat ve en baskın risk boyutuyla listelemek isterim; böylece sabah toplantısında doğru dosyalara odaklanırım.
2. **Avukat** olarak, dosyamın Süre Riski 🔴 olduğunda hangi deadline'ların bunu tetiklediğini skor kartından tek tıkla görmek isterim.
3. **Avukat** olarak, bilirkişi raporu aleyhe geldiğinde sistemin Hukuki/Delil riskini otomatik yeniden hesaplayıp beni bilgilendirmesini isterim.
4. **Partner** olarak, bir dosyanın 6 aylık risk skoru grafiğini görmek isterim; böylece dosya devri veya sulh kararını veriyle desteklerim.
5. **Avukat** olarak, AI'ın verdiği risk düzeltmesine katılmıyorsam gerekçe yazarak boyut skorunu geçersiz kılmak (override) isterim; sistemin bunu geçmişte işaretlemesini isterim.
6. **Stajyer** olarak, üzerimdeki dosyaların risk kartlarını okuyup 🔴 boyutlar için hazırlık görevlerimi önceliklendirmek isterim.
7. **Admin** olarak, tenant seviyesinde boyut ağırlıklarını (örn. icra ağırlıklı büroda Tahsilat Riski ×1.5) yapılandırmak isterim.

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Dosya Risk Kartı | `/app/cases/:caseId/risk` | 7 boyut göstergesi, genel skor, sinyal listesi (kural + AI), skor geçmişi grafiği, override paneli |
| Büro Risk Listesi | `/app/risk` | Filtreli tablo (boyut, bant, avukat, dosya tipi), toplu görünüm, CSV dışa aktarım |
| Risk Ayarları | `/app/settings/risk` | Boyut ağırlıkları, bant eşikleri, yeniden hesap periyodu (ADMIN) |

ASCII wireframe — Dosya Risk Kartı:

```
┌─ 2026/145 — Risk Kartı              GENEL: 🟡 62  (↑ +9 / 30 gün) ─┐
│ Hukuki   🟡 55 │ Süre    🔴 78 │ Delil   🟡 48 │ Tahsilat 🟢 20    │
│ Usul     🟢 15 │ İçtihat 🟡 60 │ K.Taraf 🟡 52 │                   │
├────────────────────────────────────────────────────────────────────┤
│ SÜRE RİSKİ — SİNYALLER                                             │
│ • [KURAL +40] İstinaf süresi son 3 gün, dilekçe taslağı yok        │
│ • [KURAL +20] Ara karar gereği belge sunumu bugün                  │
│ • [AI +18] "Tebliğ tarihi ihtilaflı; süre hesabı teyit edilmeli"   │
│   Gerekçe ve kaynak: tebliğ mazbatası (belge #231)  [belgeyi aç]   │
├────────────────────────────────────────────────────────────────────┤
│ SKOR GEÇMİŞİ  62┤        ╭──                                       │
│               40┤ ───────╯          [Yeniden Hesapla] [Override]   │
│                 └─Mar──Nis──May──Haz                               │
└────────────────────────────────────────────────────────────────────┘
```

## Veri Modeli

**RiskScore** (dosya başına güncel skor; boyut satırları ayrı)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| case_id | uuid FK→Case | |
| dimension | enum(LEGAL, DEADLINE, EVIDENCE, COLLECTION, PROCEDURE, PRECEDENT, OPPONENT, OVERALL) | OVERALL = ağırlıklı bileşke |
| score | int (0-100) | Nihai skor |
| band | enum(GREEN, YELLOW, RED) | Eşiklerden türetilir |
| rule_base | int | Kural sinyalleri toplamı (clamp'li) |
| ai_adjustment | int (−25..+25) | AI düzeltmesi |
| signals | jsonb | [{source: RULE\|AI, code, points, reason, refs}] |
| overridden_by / override_reason | uuid FK→User null / text | Elle geçersiz kılma |
| computed_at | timestamptz | |

**RiskScoreHistory** (append-only zaman serisi)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id / case_id | uuid FK | |
| dimension | enum (yukarıdaki) | |
| score / band | int / enum | O andaki değer |
| trigger | enum(SCHEDULED, EVENT, MANUAL, OVERRIDE) | Hesabı ne tetikledi |
| trigger_ref | jsonb | {event_id?, document_id?, user_id?} |
| computed_at | timestamptz | |

**RiskRuleConfig** (tenant bazlı ayar)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | uuid | |
| dimension_weights | jsonb | {LEGAL: 1.0, DEADLINE: 1.2, ...} |
| band_thresholds | jsonb | {yellow: 40, red: 70} |
| recompute_cron | text | Varsayılan: her gece 03:00 + olay tetiklemeli |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı |
|---|---|
| `RISK_ASSESS` | Dosya özeti + kural sinyalleri + son simülasyon bulguları + safahat → boyut başına {adjustment (−25..+25), reason, refs} |
| `RISK_EXPLAIN` | RiskScore kaydı → avukata anlaşılır Türkçe gerekçe metni (rapor/e-posta için) |

`RISK_ASSESS` sistem prompt taslağı:

```
Sen Türk hukuk bürosunda risk değerlendirmesi yapan kıdemli bir avukatsın.
Sana bir dosyanın özeti, deterministik kural sinyalleri ve güncel gelişmeler verildi.
Görevin: yedi risk boyutunun HER BİRİ için kural tabanına ek düzeltme önermek.
KURALLAR: (1) adjustment −25 ile +25 arasında tam sayıdır; kural sinyallerinin
zaten saydığı bir durumu ikinci kez puanlama (çifte sayım yasak).
(2) Her düzeltme için tek cümlelik somut gerekçe ve dayandığın belge/olay
referansı (refs) zorunlu; referanssız düzeltme verme, 0 döndür.
(3) Dosyada olmayan olguya dayanma. Emin olmadığın konuda adjustment=0 + not yaz.
(4) Çıktı yalnızca verilen JSON şemasında olsun.
```

**KVKK notu**: `RISK_ASSESS` girdisi maskeleme hattından geçer; tahsilat riski için gönderilen finansal özetlerde IBAN/hesap no maskelenir. Tüm çağrılar `AiUsageLog`'a bağlanır; `RISK_EXPLAIN` çıktısı müvekkile gönderilecekse İletişim Merkezi onay akışına (Modül 19) tabidir.

## İş Kuralları

1. AI düzeltmesi tek başına bandı 🟢'den 🔴'ye taşıyamaz (±25 sınırı); 🔴 bandın baskın nedeni her zaman izlenebilir sinyallerdir.
2. AI değerlendirmesi **öneri**dir: avukat boyut skorunu gerekçeli override edebilir; override edilen boyut, yeni bir olay tetiklemesine kadar otomatik hesapla ezilmez ve kartta "elle düzeltildi" rozetiyle görünür.
3. Yeniden hesap tetikleyicileri: gece zamanlı koşu; `Deadline` oluşturma/yaklaşma/kaçırma; yeni `Document` sınıflandırması; `Hearing` sonucu; `FinancialEntry` (tahsilat) değişikliği; simülasyon koşusu tamamlanması.
4. `signals` boş olan boyut skoru yazılamaz — her puanın kaynağı vardır (audit gereği).
5. OVERALL skor yalnızca boyutlardan türetilir; doğrudan yazılamaz.
6. Kaçırılmış (geçmiş, kapatılmamış) deadline varlığı Süre Riski'ni koşulsuz 🔴 yapar (kural: `MISSED_DEADLINE` → taban ≥ 70).
7. History append-only'dir; silme/güncelleme yok (AuditLog + uyum gereği).
8. Büro risk listesi yalnızca PARTNER ve ADMIN'e tüm dosyaları gösterir; AVUKAT kendi dosyalarını görür.
9. Skor hesabı bir dosyada 60 sn'de tamamlanamazsa eski skor korunur, hesap hatası loglanır (skorsuz dosya kalmaz).

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/cases/:caseId/risk` | Güncel 7 boyut + OVERALL + sinyaller |
| POST | `/api/v1/cases/:caseId/risk/recompute` | Elle yeniden hesap (async) |
| GET | `/api/v1/cases/:caseId/risk/history?dimension=&from=&to=` | Zaman serisi |
| POST | `/api/v1/cases/:caseId/risk/:dimension/override` | body: {score, reason} |
| DELETE | `/api/v1/cases/:caseId/risk/:dimension/override` | Override kaldır → otomatik hesaba dön |
| GET | `/api/v1/risk/cases?band=RED&dimension=&assignee=&sort=score` | Büro geneli riskli dosya listesi |
| GET | `/api/v1/risk/config` / PUT aynı yol | Tenant ayarları (ADMIN) |

## Diğer Modüllerle İlişkiler

- **Partner Dashboard (18)**: "Riskli dosya" KPI'ı ve drill-down listesi bu modülün `GET /risk/cases` ucundan beslenir.
- **Süre Motoru**: deadline durumları en güçlü kural sinyali kaynağıdır.
- **Strateji Motoru (15)**: zayıf nokta düğümleri Hukuki/İçtihat riski girdisidir; OVERALL skor stratejiye geri yazılır.
- **Simülasyon (16)**: LOSS_FACTORS/JUDGE_VIEW bulguları AI değerlendirme bağlamına eklenir.
- **Finans**: tahsilat gecikmeleri ve masraf/avans dengesi Tahsilat Riski sinyalidir.
- **İcra Modülü**: malvarlığı sorgu sonuçları Tahsilat Riski kural setine girer.
- **AI Agents (21)**: Risk Ajanı zamanlı/olay tetiklemeli koşuları yürütür; BYO-LLM eşlemesi oradan.

## Kabul Kriterleri

1. Yeni açılan dosyada ilk gece koşusundan sonra 7 boyut + OVERALL skoru vardır; hiçbir dosya skorsuz kalmaz.
2. Süresi geçmiş kapatılmamış deadline eklenen dosyada Süre Riski bir sonraki hesapta 🔴 olur ve sinyal listesinde `MISSED_DEADLINE` görünür.
3. AI düzeltmesi ±25 dışında dönerse sunucu clamp'ler ve sapmayı loglar; skor asla salt AI ile 🟢→🔴 geçmez (test: rule_base=10, ai=+25 → band ≠ RED).
4. Override edilen boyut, kaldırılana veya yeni olay tetiklemesine kadar zamanlı koşuda değişmez ve rozet taşır.
5. History ucu 12 aylık seriyi günlük çözünürlükte döner; hiçbir history kaydı update/delete edilemez (DB kısıtı testi).
6. `GET /risk/cases?band=RED` sonucu, dashboard'daki "Riskli dosya" sayısıyla birebir aynıdır.
7. AVUKAT rolü büro listesinde yalnızca kendi dosyalarını görür (yetki testi); PARTNER tümünü görür.
8. Her AI değerlendirme koşusu `AiUsageLog`'da izlenir; `signals` içindeki her AI satırında referans vardır (referanssız satır sunucuda elenir).
9. Boyut ağırlığı değiştirildiğinde sonraki hesapta OVERALL yeni ağırlıkla türetilir; geçmiş kayıtlar değişmez.
10. Farklı tenant'ın risk verisine erişim 404 döner.

## Faz

**Faz 4.** Alt sıra: 4.1 kural motoru + Süre/Tahsilat boyutları (deterministik, AI'sız çalışır) → 4.2 `RISK_ASSESS` entegrasyonu + kalan boyutlar → 4.3 history grafiği, override, tenant ayarları. Dashboard'daki basit "riskli dosya sayısı" Faz 1'de yalnız kural motoru sinyaliyle (kaçırılmış/kritik süre) yaklaşık verilebilir.
