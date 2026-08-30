# Modül 11 — Conflict Check (Çıkar Çatışması Taraması)

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 12 `[P1, 9/10]`

## Amaç

Büroya yeni bir müvekkil adayı (gerçek veya tüzel kişi) geldiğinde, bu kişinin büro
geçmişiyle çıkar çatışması yaratıp yaratmayacağını sistematik olarak taramak. Tarama
altı soruyu yanıtlar: Mevcut müvekkil mi? Herhangi bir dosyada karşı taraf mı? Mevcut
bir müvekkilin bağlı şirketi mi? Eski müvekkil mi? Dosyalarda geçen (tanık, üçüncü
kişi, ilgili) taraf mı? Mevcut bir müvekkilin ticari rakibi mi? Avukatlık Kanunu ve
TBB Meslek Kuralları çerçevesinde çatışma değerlendirmesi nihai olarak avukatın mesleki
takdiridir — bu yüzden modülün yaklaşımı **engelleme değil uyarıdır**: sistem riski
görünür kılar, kararı ve gerekçesini insana bırakır, her ikisini de kalıcı kayda geçirir.

Tarama iki katmanlıdır. Birinci katman deterministik eşleştirmedir: normalize edilmiş
unvan/ad karşılaştırması, VKN/TCKN tam eşleşmesi, fuzzy isim benzerliği (trigram +
Levenshtein). İkinci katman AI çıkarımıdır: "Aymar Gıda San. A.Ş." ile "Aymar Holding"
arasındaki olası bağı, eski unvan değişikliklerini, grup şirketi ilişkilerini ve rakiplik
ihtimalini isim/sektör/dosya bağlamından çıkarır. AI katmanı yalnızca aday eşleşme üretir;
skorlar ve kanıt gerekçesiyle birlikte rapora düşer.

Sonuç, onay akışına bağlanır: tarama raporu üretilir, riskli bulgu varsa PARTNER
değerlendirmesi istenir, karar (kabul / koşullu kabul / ret) gerekçesiyle kaydedilir.
Bu kayıt, ileride "bu müvekkili alırken çatışmayı biliyor muyduk?" sorusunun denetim
kanıtıdır.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, yeni müvekkil kaydı açarken sistemin otomatik çatışma taraması
   yapmasını istiyorum ki farkında olmadan karşı tarafı müvekkil yapmayayım.
2. **Avukat olarak**, kayıt açmadan önce hızlı bir "ön tarama" (sadece isim/VKN ile)
   yapmak istiyorum ki telefonda görüşürken bile riski görebileyim.
3. **Partner olarak**, riskli bulgusu olan taramaların onayıma düşmesini istiyorum ki
   iş kabul kararı bilinçli verilsin.
4. **Partner olarak**, taramayı gerekçe yazarak "kabul" veya "ret" ile kapatmak
   istiyorum ki karar denetlenebilir olsun.
5. **Avukat olarak**, benzer isimli eşleşmelerin neden eşleştiğini (hangi dosya, hangi
   rol, benzerlik skoru) görmek istiyorum ki yanlış pozitifleri hızla eleyeyim.
6. **Avukat olarak**, AI'ın bağlı şirket çıkarımlarını kanıt cümleleriyle görmek
   istiyorum ki çıkarımın dayanağını değerlendirebileyim.
7. **Admin olarak**, müvekkil kartına bağlı şirketleri (grup yapısını) elle tanımlamak
   istiyorum ki sonraki taramalar bu bilgiyi deterministik kullansın.
8. **Partner olarak**, geçmiş taramaları ve verilen kararları listelemek istiyorum ki
   büronun çatışma politikası tutarlı uygulansın.
9. **Avukat olarak**, tarama sonucu temiz çıksa bile raporun dosyaya iliştirilmesini
   istiyorum ki ileride "tarama yapılmadı" iddiası doğmasın.
10. **Sekreter olarak**, tarama sırasında sistemin beni bloke etmemesini istiyorum ki
    kayıt akışı dursun ama veri girişim kaybolmasın (uyarı yaklaşımı).

## Ekranlar ve UX

### 1. Tarama Başlat — `/app/conflict-check/new`
Bileşenler: ad/unvan alanı, kişi tipi (gerçek/tüzel), VKN/TCKN (opsiyonel), sektör
(opsiyonel, rakip analizi için), "Tara" butonu. Yeni müvekkil sihirbazının 1. adımı
olarak da gömülür.

### 2. Tarama Sonucu — `/app/conflict-check/:checkId`

```
┌───────────────────────────────────────────────────────────────┐
│ Conflict Check #CC-2026-0087 — "XYZ Gıda San. ve Tic. A.Ş."   │
│ Sonuç: 🔴 ÇIKAR ÇATIŞMASI İHTİMALİ TESPİT EDİLDİ (2 bulgu)    │
├───────────────────────────────────────────────────────────────┤
│ 🔴 KARŞI TARAF EŞLEŞMESİ                        Skor: 0.97    │
│    "XYZ Gıda A.Ş." — 2024/512 sayılı dosyada DAVALI           │
│    Müvekkilimiz: Mehmet Y*** · Dosya durumu: Derdest          │
├───────────────────────────────────────────────────────────────┤
│ 🟡 BAĞLI ŞİRKET (AI çıkarımı)                   Skor: 0.71    │
│    "XYZ Holding A.Ş." mevcut müvekkil. AI: "Unvan kökü ve     │
│    aynı adres kaydı grup ilişkisine işaret ediyor."           │
├───────────────────────────────────────────────────────────────┤
│ 🟢 Eski müvekkil: eşleşme yok  🟢 Rakip: eşleşme yok          │
├───────────────────────────────────────────────────────────────┤
│ [Partner Onayına Gönder]  [Yanlış Pozitif İşaretle]  [Rapor]  │
└───────────────────────────────────────────────────────────────┘
```

### 3. Onay Kuyruğu — `/app/conflict-check/approvals` (PARTNER)
Bileşenler: bekleyen taramalar, bulgu özeti, karar formu (KABUL / KOŞULLU KABUL /
RET + zorunlu gerekçe), karar geçmişi.

### 4. Tarama Geçmişi — `/app/conflict-check`
Bileşenler: filtreli liste (sonuç, karar, tarih, tarayan), rapor PDF indirme.

## Veri Modeli

### ConflictCheck (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| check_no | VARCHAR | CC-YYYY-NNNN, tenant içinde ardışık |
| subject_name | VARCHAR | Taranan ad/unvan (girildiği hali) |
| subject_normalized | VARCHAR | Normalize form (küçük harf, A.Ş./LTD. sadeleştirme) |
| subject_type | ENUM | PERSON, COMPANY |
| subject_tax_id | VARCHAR NULL | VKN/TCKN (şifreli saklanır) |
| subject_sector | VARCHAR NULL | Rakip analizi girdisi |
| client_id | UUID FK→Client NULL | Tarama sonrası oluşturulan müvekkil bağlanır |
| overall_result | ENUM | CLEAR (🟢), POTENTIAL (🟡), CONFLICT_LIKELY (🔴) |
| status | ENUM | RUNNING, COMPLETED, PENDING_APPROVAL, DECIDED |
| decision | ENUM NULL | ACCEPT, ACCEPT_WITH_CONDITIONS, REJECT |
| decision_reason | TEXT NULL | Zorunlu gerekçe |
| decided_by | UUID FK→User NULL | PARTNER/ADMIN |
| decided_at | TIMESTAMPTZ NULL | |
| requested_by | UUID FK→User | |
| created_at | TIMESTAMPTZ | |

### ConflictCheckHit (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / conflict_check_id | UUID | |
| hit_type | ENUM | EXISTING_CLIENT, OPPOSING_PARTY, RELATED_COMPANY, FORMER_CLIENT, CASE_PARTY, COMPETITOR |
| severity | ENUM | RED, YELLOW, GREEN_NOTE |
| matched_entity_type | ENUM | CLIENT, CASE_PARTY, RELATED_COMPANY |
| matched_entity_id | UUID | Eşleşen kaydın id'si |
| matched_case_id | UUID FK→Case NULL | Eşleşmenin geçtiği dosya |
| match_method | ENUM | EXACT_TAX_ID, EXACT_NAME, FUZZY_NAME, AI_INFERENCE |
| similarity_score | DECIMAL(3,2) | 0.00–1.00 |
| ai_reasoning | TEXT NULL | AI çıkarım gerekçesi (kanıt cümleleri) |
| dismissed | BOOLEAN | Yanlış pozitif işareti |
| dismissed_by / dismissed_at | UUID / TIMESTAMPTZ NULL | |

### RelatedCompany (yeni — grup/bağlı şirket bilgisi)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id | UUID FK→Client | Ana müvekkil |
| related_name | VARCHAR | Bağlı şirket unvanı |
| related_client_id | UUID FK→Client NULL | Sistemde müvekkilse bağ |
| relation_type | ENUM | PARENT, SUBSIDIARY, SISTER, SHAREHOLDER, COMPETITOR |
| source | ENUM | MANUAL, AI_SUGGESTED_CONFIRMED |
| notes | TEXT NULL | |

Tarama kaynakları (salt okunur): `Client` (status ACTIVE/INACTIVE = mevcut/eski
müvekkil), `CaseParty` (role: karşı taraf, tanık, üçüncü kişi), `RelatedCompany`.

## AI Yetenekleri

### CONFLICT_INFERENCE
- **Girdi:** Taranan ad/unvan + sektör + deterministik katmanın skoru 0.5–0.9 arası kalan "gri bölge" aday listesi (her aday: ad, rol, dosya no, ilişki bağlamı).
- **Çıktı:** Aday başına `{is_related: bool, relation_hypothesis, confidence: 0-1, evidence: string[]}` JSON'u. `confidence ≥ 0.6` olanlar YELLOW hit olarak rapora eklenir.
- **Gördüğü veri:** Yalnızca ad/unvan, rol, dosya esas no ve sektör etiketi; dosya içerikleri gönderilmez.
- **KVKK:** Gerçek kişi adayların TCKN'si asla gönderilmez; ad-soyad zorunlu olarak gider (eşleştirmenin konusu olduğundan) — bu, tenant'ın AI veri politikasında açıkça belirtilir; yerel/BYO-LLM ile tam yerinde çalışma önerilir.

### COMPETITOR_ANALYSIS
- **Girdi:** Taranan şirketin unvanı + sektörü, mevcut müvekkillerin unvan + sektör listesi.
- **Çıktı:** Olası rakiplik eşleşmeleri (aynı sektör + benzer ölçek işaretleri) GREEN_NOTE/YELLOW olarak. Rakiplik hukuki engel değildir; ticari hassasiyet notu olarak raporlanır.
- **KVKK:** Yalnızca tüzel kişi unvanları gönderilir.

## İş Kuralları

1. **Uyarı, engelleme değil:** Hiçbir tarama sonucu müvekkil kaydını teknik olarak engellemez. 🔴 sonuçta kayıt "onay bekliyor" bayrağıyla açılır; dosya açma işlemi PARTNER kararına kadar uyarı bandı taşır.
2. Yeni `Client` kaydı, tamamlanmış bir ConflictCheck referansı olmadan oluşturulamaz (tenant ayarıyla zorunluluk kapatılabilir; varsayılan açık).
3. Deterministik eşikler: `similarity_score ≥ 0.90` veya VKN/TCKN tam eşleşme → doğrudan hit (AI'a sorulmaz); `0.50–0.89` → AI gri bölge değerlendirmesi; `< 0.50` → elenir.
4. OPPOSING_PARTY eşleşmesi derdest dosyada her zaman RED; kapanmış dosyada YELLOW.
5. FORMER_CLIENT eşleşmesi YELLOW'dur ve rapor "sır saklama yükümlülüğü değerlendirilmeli" notunu içerir.
6. RED bulgusu olan tarama otomatik PENDING_APPROVAL'a geçer; karar yetkisi yalnızca PARTNER ve ADMIN'dedir; `decision_reason` boş bırakılamaz.
7. Hit "yanlış pozitif" işaretlenirse gerekçe zorunludur; işaret kaydı silinmez, `dismissed=true` olur.
8. AI çıkarımıyla bulunan bağlı şirket, avukat onaylarsa `RelatedCompany(source=AI_SUGGESTED_CONFIRMED)` olarak kalıcılaşır ve sonraki taramalarda deterministik katmana geçer.
9. Tarama anlık verilerle çalışır ve raporu o anın fotoğrafı olarak saklanır; aynı ad için yeni tarama yeni kayıt açar (eski rapor değişmez).
10. Tüm tarama, karar ve dismiss olayları `AuditLog`'a yazılır (CONFLICT_* aksiyon tipleri).
11. Normalizasyon kuralları: Türkçe karakter katlama (İ/i, I/ı), şirket tipi eklerinin (A.Ş., LTD. ŞTİ., SAN., TİC.) sadeleştirilmesi, çoklu boşluk temizliği — hem taramada hem indekste aynı fonksiyon kullanılır.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| POST | /api/v1/conflict-checks | Tarama başlat (async; 202 + check id) |
| GET | /api/v1/conflict-checks/:id | Sonuç ve hit listesi |
| GET | /api/v1/conflict-checks | Geçmiş; filtre: result, decision, date |
| POST | /api/v1/conflict-checks/:id/submit-approval | Partner onayına gönder |
| POST | /api/v1/conflict-checks/:id/decide | Karar (decision + reason) |
| POST | /api/v1/conflict-checks/:id/hits/:hitId/dismiss | Yanlış pozitif işaretle |
| GET | /api/v1/conflict-checks/:id/report.pdf | Rapor PDF |
| GET/POST | /api/v1/clients/:clientId/related-companies | Bağlı şirket listele/ekle |
| POST | /api/v1/conflict-checks/quick | Ön tarama (kayıt oluşturmadan, sadece özet döner) |

## Diğer Modüllerle İlişkiler

- **Modül 01 Müvekkil CRM:** Yeni müvekkil sihirbazı 1. adımda taramayı gömer; müvekkil kartı tarama geçmişini gösterir.
- **Modül 02 Dava Dosyası:** `CaseParty` kayıtları taramanın ana veri kaynağıdır; yeni dosya açılışında taraflar için de hızlı tarama önerilir.
- **Görev Modülü:** PENDING_APPROVAL taraması PARTNER'a onay görevi düşürür.
- **Modül 19 Partner Dashboard:** Bekleyen çatışma kararları KPI olarak görünür.
- **KVKK Katmanı (G20):** AI'a giden aday listesi maskeleme politikasına tabidir.

## Kabul Kriterleri

1. VKN tam eşleşmesi olan aday, AI çağrısı yapılmadan RED/EXISTING_CLIENT veya OPPOSING_PARTY hit'i üretiyor.
2. "Ayşe Yılmaz" / "AYŞE YILMAZ" / "Ayse Yilmaz" varyantları aynı kişiyle eşleşiyor (normalizasyon + fuzzy test seti).
3. Derdest dosyada davalı olan şirket tarandığında sonuç CONFLICT_LIKELY (🔴) ve hit'te dosya no + rol görünüyor.
4. RED bulgulu tarama karar verilmeden DECIDED yapılamıyor; kararsız client kaydı "onay bekliyor" bayrağı taşıyor ama oluşturulabiliyor (engelleme yok).
5. Karar isteğinde `decision_reason` boşsa 422 dönüyor; AVUKAT rolü decide ucunda 403 alıyor.
6. AI gri bölge adayı `confidence ≥ 0.6` ile YELLOW hit üretiyor; `ai_reasoning` alanı raporda görünüyor (mock AI ile deterministik test).
7. Onaylanan AI bağlı-şirket çıkarımı RelatedCompany'ye yazılıyor ve ikinci taramada match_method=EXACT_NAME ile deterministik eşleşiyor.
8. Rapor PDF'i tarama anındaki hit'leri içeriyor; sonradan eklenen dosyalar eski raporu değiştirmiyor.
9. Tüm uçlar tenant-scoped: başka tenant'ın check id'si 404 dönüyor.
10. Tarama, karar ve dismiss olayları AuditLog'da doğru aktör ve zaman damgasıyla listeleniyor.

## Faz

**Faz 4.** Önkoşullar: Müvekkil CRM ve CaseParty verisinin dolu olması (Faz 1-2),
AI görev altyapısı + KVKK maskeleme hattı (Faz 2-3). Deterministik katman Faz 4
başında, AI çıkarım katmanı (CONFLICT_INFERENCE, COMPETITOR_ANALYSIS) aynı fazın
ikinci iterasyonunda devreye alınır.
