# Modül 18 — Partner / Yönetici Dashboard

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 19 `[dashboard P0-yakın, raporlama P2]`

## Amaç

Partner Dashboard, büroyu yöneten ortağın güne başladığı tek ekrandır. Sekiz KPI kartı büronun anlık fotoğrafını verir: **Toplam Dosya, Aktif Dosya, Bu Hafta Duruşma, Kritik Süre, Riskli Dosya, Tahsil Edilecek, Bu Ay Fatura, Açık Görev**. Her kart tıklanabilir ve ilgili modülün filtrelenmiş listesine iner (drill-down): "Kritik Süre 9" kartı, 9 deadline'ın dosya/sorumlu/kalan gün listesini açar.

Modülün AI katmanı **"Bugün müdahale etmem gereken 10 şey"** panelidir (`DAILY_PRIORITIZE`): sistem; kritik süreleri, riskli dosyaları, onay bekleyen işleri, cevapsız müvekkil mesajlarını ve geciken görevleri tek aday havuzunda toplar, AI bunları partner gözüyle önem sırasına dizer ve her madde için tek cümlelik gerekçe + önerilen aksiyon üretir. Bu liste bir öneridir; partner maddeyi "yapıldı/ertelendi/bana göre değil" olarak işaretleyebilir ve bu geri bildirim sıralama kalitesine veri sağlar.

Dashboard iki fazda yaşar: **Faz 1'de basit sürüm** — KPI'lar doğrudan çekirdek tablolardan sayılır (dosya, duruşma, süre, görev), AI panosu yoktur. **Faz 4'te tam sürüm** — Risk Motoru ve Finans entegrasyonuyla tüm kartlar, AI önceliklendirme, avukat bazlı iş yükü ve KPI trend grafikleri (`DashboardSnapshot` geçmişi) devreye girer.

## Kullanıcı Hikâyeleri

1. **Partner** olarak, sabah tek ekranda 8 KPI'ı ve dünden farklarını görmek isterim; böylece büroyu 30 saniyede tararım.
2. **Partner** olarak, "bugün müdahale etmem gereken 10 şey" listesini gerekçeleriyle görmek ve her maddeden ilgili kayda tek tıkla gitmek isterim.
3. **Partner** olarak, avukat bazlı iş yükü tablosunu (açık görev, bu hafta duruşma, kritik süre, riskli dosya kişi başına) görmek isterim; böylece dosya dağıtımını dengelerim.
4. **Partner** olarak, "Tahsil Edilecek 4.2M TL" kartından müvekkil bazlı alacak dökümüne inmek isterim; böylece tahsilat görüşmelerini planlarım.
5. **Yönetici (ADMIN)** olarak, KPI kartlarının hangi rollere görüneceğini yapılandırmak isterim (örn. finans kartları yalnız PARTNER'a).
6. **Avukat** olarak, dashboard'un benim rolümde kendi dosyalarıma daraltılmış halini görmek isterim ("Benim Günüm" görünümü).
7. **Partner** olarak, öncelik listesindeki bir maddeyi "ertelendi" işaretlediğimde ertesi gün gerekçesiyle tekrar önüme gelmesini isterim; hiçbir kritik iş sessizce kaybolmasın.
8. **Partner** olarak, KPI'ların 90 günlük trendini görmek isterim (aktif dosya, açık görev, riskli dosya eğrisi).

## Ekranlar ve UX

| Ekran | URL | Bileşenler |
|---|---|---|
| Ana Dashboard | `/app/dashboard` | 8 KPI kartı (+trend oku), "Bugünkü 10 Şey" paneli, bu haftanın duruşma mini-takvimi, avukat iş yükü tablosu |
| Drill-down | `/app/dashboard/drill/:kpi` | İlgili modül listesine yönlendirme (filtre parametreli), örn. `/app/deadlines?band=critical` |
| Trendler | `/app/dashboard/trends` | KPI zaman serisi grafikleri (snapshot verisi) |
| Görünürlük Ayarları | `/app/settings/dashboard` | Rol → kart matrisi (ADMIN) |

ASCII wireframe — Ana Dashboard:

```
┌──────────────────────── NomosOS — Günaydın, Av. Kaya ───────────────────────┐
│ TOPLAM DOSYA │ AKTİF │ BU HAFTA DUR. │ KRİTİK SÜRE │ RİSKLİ │ TAHSİL EDİL. │
│    1.284     │  734  │      42       │    9 🔴     │  17 🔴 │   4.2M TL    │
│ BU AY FATURA │ AÇIK GÖREV │   (her kart tıklanır → filtreli liste)         │
│   1.8M TL    │   126 (↑8) │                                                │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ BUGÜN MÜDAHALE: 10 ŞEY (AI)  │ AVUKAT İŞ YÜKÜ                               │
│ 1.🔴 2026/145 istinaf süresi │ Avukat   Görev  Duruşma  Kritik  Riskli      │
│    son gün — taslak onaysız  │ A. Kaya    23      4       2       5         │
│    [Dosyaya git] [Yapıldı]   │ B. Demir   31      7       4       6         │
│ 2.🔴 ABC Holding 3 gündür    │ C. Yıldız  18      2       1       2         │
│    cevapsız mesaj            │ S. Ak (stj)12      –       –       –         │
│ 3.🟡 Bilirkişi itirazı ...   ├──────────────────────────────────────────────┤
│ ... (10/10)  [Listeyi yenile]│ BU HAFTA DURUŞMALAR  Pzt 9 · Sal 12 · Çar 8  │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

## Veri Modeli

KPI'lar büyük oranda mevcut çekirdek tablolardan (`Case`, `Hearing`, `Deadline`, `Task`, `FinancialEntry`, `RiskScore`) sorgu ile türetilir; kalıcılaşan iki yeni entity vardır.

**DashboardSnapshot** (günlük KPI fotoğrafı — trend grafikleri için)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK→Tenant | |
| snapshot_date | date | Tenant başına günde 1 (unique: tenant_id+snapshot_date) |
| kpis | jsonb | {total_cases, active_cases, hearings_this_week, critical_deadlines, risky_cases, receivable_total, invoiced_this_month, open_tasks} |
| per_lawyer | jsonb | [{user_id, open_tasks, hearings_week, critical_deadlines, risky_cases}] |
| computed_at | timestamptz | Gece koşusunda yazılır |

**PriorityItem** ("10 şey" listesi kalemleri — geri bildirim izli)

| Alan | Tip | Açıklama |
|---|---|---|
| id | uuid PK | |
| tenant_id / user_id | uuid FK | Listenin sahibi (partner) |
| list_date | date | |
| rank | int (1-10) | AI sırası |
| source_type | enum(DEADLINE, RISK, TASK, MESSAGE, APPROVAL, HEARING, FINANCE) | Aday kaynağı |
| source_ref | jsonb | {entity, id} — tıklanınca gidilecek kayıt |
| title / reason / suggested_action | text | AI gerekçesi ve önerisi |
| status | enum(OPEN, DONE, SNOOZED, DISMISSED) | Partner geri bildirimi |
| snoozed_until | date null | |
| ai_usage_log_id | uuid FK→AiUsageLog | |

## AI Yetenekleri

| Görev tipi | Girdi → Çıktı |
|---|---|
| `DAILY_PRIORITIZE` | Aday havuzu (kural motoruyla toplanmış ≤50 kalem: kritik süreler, 🔴 dosyalar, geciken görevler, cevapsız mesajlar, onay kuyruğu) + dünkü SNOOZED/DISMISSED geri bildirimi → sıralı 10 kalem {rank, title, reason, suggested_action, source_ref} |
| `KPI_NARRATIVE` (ops.) | Snapshot + önceki dönem → 3-4 cümlelik yönetici özeti ("Riskli dosya sayısı 2 haftada 11→17 çıktı; artışın kaynağı...") |

`DAILY_PRIORITIZE` sistem prompt taslağı:

```
Sen bir Türk hukuk bürosunun yönetici ortağına asistanlık yapan deneyimli bir
büro müdürüsün. Sana bugünün aday iş kalemleri yapılandırılmış listede verildi.
Görevin: partnerin BUGÜN bizzat müdahale etmesi gereken en önemli 10 kalemi seçip
sıralamak. ÖNCELİK İLKELERİ: (1) Telafisi imkânsız olan önce gelir (hak düşürücü
süre > her şey). (2) Bugün/yarın son günü olanlar, gelecek haftakilerden önce.
(3) Yüksek parasal etki ve 🔴 risk bandı öne çıkar. (4) Dün SNOOZED işaretlenen
kalem bugün tekrar aday ise sırasını yükselt. (5) Aday listesinde OLMAYAN hiçbir
kalem üretme; kalem ekleme, sadece seç ve sırala. Her kalem için tek cümle
gerekçe (reason) ve somut bir aksiyon önerisi (suggested_action) yaz.
Çıktı yalnızca verilen JSON şemasında olsun.
```

**KVKK notu**: Aday havuzunda müvekkil adları görünür ancak TCKN/iletişim/finansal hesap detayları maskelenir; yalnız tutar ve kalan gün gibi operasyonel alanlar gönderilir. Çağrılar `AiUsageLog`'a yazılır; yerel LLM kiracısında ham gönderim tenant ayarına tabidir.

## İş Kuralları

1. "10 şey" listesi **öneridir**: hiçbir kalem otomatik aksiyon almaz; DONE işareti kaynak kaydı kapatmaz, yalnızca listedeki durumu günceller (kaynak kayıt kendi modülünde kapatılır).
2. AI aday havuzuna kalem **ekleyemez**; havuz deterministik kurallarla oluşur, AI yalnız seçer/sıralar. Havuz boşsa liste "bugün kritik iş yok" der, uydurma kalem üretilmez.
3. Kritik Süre tanımı: ≤3 gün kalan veya geçmiş, kapatılmamış `Deadline`. Riskli Dosya tanımı: `RiskScore` OVERALL bandı RED (Faz 1'de: kaçırılmış/kritik süreli dosya sayısı proxy'si).
4. Finansal kartlar (Tahsil Edilecek, Bu Ay Fatura) varsayılan olarak yalnızca PARTNER ve ADMIN'e görünür; matris ADMIN'ce değiştirilebilir.
5. AVUKAT rolü `/app/dashboard`'da yalnız kendi dosyalarına daraltılmış KPI görür; büro geneli sayılar PARTNER/ADMIN'e özeldir.
6. Snapshot günde bir kez yazılır; gün içi kartlar canlı sorgudur (cache TTL ≤ 5 dk). Snapshot'lar silinemez.
7. SNOOZED kalem `snoozed_until` günü geldiğinde aday havuzuna yükseltilmiş öncelikle döner; DISMISSED kalem aynı kaynak için 7 gün tekrar önerilmez (kaynak durumu kötüleşmedikçe: örn. süre bugün'e düştüyse kural bunu ezer).
8. Drill-down uçları her zaman kartın sayısını üreten sorguyla **aynı filtreyi** kullanır (sayı-liste tutarlılığı sözleşmesi).

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | `/api/v1/dashboard/kpis` | 8 KPI + dünle fark (rol bazlı daraltılmış) |
| GET | `/api/v1/dashboard/kpis/:kpi/items?limit=&offset=` | Drill-down listesi |
| GET | `/api/v1/dashboard/priorities?date=` | "10 şey" listesi |
| POST | `/api/v1/dashboard/priorities/refresh` | Listeyi yeniden üret (async) |
| PATCH | `/api/v1/dashboard/priorities/:itemId` | body: {status, snoozed_until?} |
| GET | `/api/v1/dashboard/workload` | Avukat bazlı iş yükü tablosu |
| GET | `/api/v1/dashboard/trends?kpi=&from=&to=` | Snapshot zaman serisi |
| GET/PUT | `/api/v1/dashboard/config` | Rol→kart görünürlük matrisi (ADMIN) |

## Diğer Modüllerle İlişkiler

- **Risk Motoru (17)**: Riskli Dosya kartı ve öncelik adayları `GET /risk/cases?band=RED` ile birebir aynı kaynaktan.
- **Süre Motoru**: Kritik Süre kartı + en güçlü öncelik adayı kaynağı.
- **Duruşma Yönetimi**: haftalık duruşma sayısı ve mini-takvim.
- **Görev/Workflow**: Açık Görev kartı, iş yükü tablosu, onay kuyruğu adayları.
- **Finans + Faturalama**: Tahsil Edilecek ve Bu Ay Fatura kartları (`FinancialEntry`).
- **İletişim Merkezi (19)**: cevapsız müvekkil mesajları öncelik adayı olur.
- **AI Agents (21)**: `DAILY_PRIORITIZE` zamanlı ajan koşusudur (her sabah 06:30); BYO-LLM eşlemesi oradan.

## Kabul Kriterleri

1. 8 KPI kartının her biri, drill-down listesindeki kayıt sayısıyla birebir eşleşir (otomatik tutarlılık testi kart başına).
2. Faz 1 sürümünde AI panosuz dashboard, çekirdek tablolarla 500 ms altında yüklenir (734 aktif dosyalık örnek veri setinde, cache'siz).
3. `DAILY_PRIORITIZE` çıktısındaki her kalemin `source_ref`'i aday havuzundaki bir kayda çözülür; havuz dışı kalem sunucuda reddedilir ve loglanır.
4. Bugün son günü olan kapatılmamış hak düşürücü süre, üretilen listede her zaman ilk 3'te yer alır (kural override testi).
5. SNOOZED kalem `snoozed_until` günü listede yeniden görünür; DISMISSED aynı kaynak 7 gün görünmez.
6. AVUKAT token'ı ile `/dashboard/kpis` yalnız kendi dosyalarının sayılarını döner; PARTNER token'ı büro genelini döner (yetki testi).
7. Finans kartları görünürlük matrisi kapatıldığında API cevabından da çıkar (yalnız UI gizleme değil).
8. Gece koşusu her tenant için tek snapshot yazar; aynı güne ikinci yazım unique kısıtına takılır.
9. Trend ucu 90 günlük seriyi döner; snapshot silme denemesi 405 döner.
10. "Listeyi yenile" 30 sn içinde yeni liste üretir; üretim başarısızsa önceki liste korunur ve kullanıcıya hata gösterilir.

## Faz

**Faz 1 (basit)**: KPI kartlarından Toplam/Aktif Dosya, Bu Hafta Duruşma, Kritik Süre, Açık Görev + drill-down; "Benim Günüm" görünümü. **Faz 4 (tam)**: Riskli Dosya (Risk Motoru), Tahsil Edilecek/Bu Ay Fatura (Finans), `DAILY_PRIORITIZE` paneli, iş yükü tablosu, snapshot trendleri, görünürlük matrisi.
