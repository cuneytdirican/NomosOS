# Modül 12 — Vekaletname Yönetimi

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 13 `[P1]`

## Amaç

Büronun elindeki tüm vekaletnameleri tek modülde kayıt altına almak: hangi müvekkilden,
hangi noterlikten, hangi tarihte alındı; kapsamı ne (genel dava vekaletnamesi mi, özel
yetkili mi); hangi özel yetkileri içeriyor (sulh, ibra, feragat, kabul, temyizden
feragat, ahzu kabz, boşanma davası açma, şirket temsili vb.); hangi avukatlar vekil;
hangi dosyalara dayanak yapıldı; süresi var mı; azledildi mi ya da istifa edildi mi.
Vekaletname olmadan dosya işlemi yapmak usul riski doğurur — modülün amacı bu riski
sistematik olarak görünür kılmaktır.

İkinci hedef proaktif uyarıdır: süreli vekaletnamelerde bitişten önce (30/7/1 gün)
uyarı üretilir; azil kaydı girildiğinde bağlı tüm dosyalar ve portal erişimi anında
işaretlenir; vekaletnamesi olmayan veya kapsamı şüpheli dosyalar dosya açılışında ve
duruşma hazırlığında uyarı bandı taşır. Uyarılar Süre/Deadline motoruna (Gereksinim 4)
bağlanır; kesin tarih hesapları deterministiktir.

Üçüncü hedef AI kapsam analizidir: "Bu vekaletname bu dava için yeterli mi?" sorusu,
vekaletname metni (taranmış belge → OCR → metin) ile dosyanın türü/talepleri
karşılaştırılarak yanıtlanır. Örn. boşanma davası özel yetki ister; sulh teklifini
kabul için özel yetki gerekir. AI çıktısı her zaman "hukuki değerlendirme önerisidir,
avukat teyidi gerekir" ibaresiyle sunulur ve dosyaya rapor olarak eklenir.

## Kullanıcı Hikâyeleri

1. **Sekreter olarak**, noterden gelen vekaletnameyi tarayıp kaydetmek istiyorum ki
   asıl nüsha arşivde, dijital kopya sistemde her an erişilebilir olsun.
2. **Avukat olarak**, vekaletname kaydında noter, yevmiye no, tarih, kapsam ve özel
   yetkileri yapılandırılmış girmek istiyorum ki arama ve analiz metin taramasına
   muhtaç kalmasın.
3. **Avukat olarak**, dosya açarken müvekkilin uygun vekaletnamesini dosyaya bağlamak
   istiyorum ki hangi dosyanın hangi vekaletle yürüdüğü net olsun.
4. **Avukat olarak**, süreli vekaletname bitmeden 30 gün önce uyarı almak istiyorum ki
   yenileme için müvekkille zamanında iletişime geçeyim.
5. **Avukat olarak**, azil bildirimi geldiğinde azli tek yerden işlemek istiyorum ki
   bağlı tüm dosyalar ve portal erişimi otomatik güncellensin.
6. **Avukat olarak**, "bu vekaletname bu dava için yeterli mi?" analizini tek tıkla
   almak istiyorum ki özel yetki eksiğini duruşmada değil dosya açılışında göreyim.
7. **Partner olarak**, vekaletnamesiz veya kapsamı yetersiz işaretli dosyaların
   listesini görmek istiyorum ki büro genelinde usul riskini yöneteyim.
8. **Avukat olarak**, bir müvekkilin tüm vekaletnamelerini müvekkil kartında görmek
   istiyorum ki hangi yetkilerin elimizde olduğunu tek bakışta bileyim.
9. **Stajyer olarak**, duruşma hazırlık paketinde dosyanın vekalet durumunu görmek
   istiyorum ki eksik vekalet mahkemede sürpriz olmasın.
10. **Admin olarak**, azil ve kapsam değişikliklerinin kim tarafından işlendiğini
    AuditLog'da görmek istiyorum ki kritik kayıtlar izlenebilir olsun.

## Ekranlar ve UX

### 1. Vekaletname Listesi — `/app/poa`
Bileşenler: filtreli tablo (müvekkil, durum: aktif/azledildi/süresi doldu/istifa,
bitiş tarihi, bağlı dosya sayısı), durum rozetleri, "Yeni Vekaletname" butonu,
"Süresi yaklaşanlar" hızlı filtresi.

### 2. Vekaletname Detayı — `/app/poa/:poaId`

```
┌─────────────────────────────────────────────────────────────┐
│ Vekaletname #VN-2026-041 — ABC Holding A.Ş.    Durum: AKTİF │
│ Beyoğlu 14. Noterliği · 12.03.2026 · Yevmiye: 08921         │
├─────────────────────────────────────────────────────────────┤
│ Tip: GENEL DAVA  ·  Süre: Süresiz  ·  Vekiller: Av. C.D.,   │
│ Av. E.F.                                                    │
│ Özel Yetkiler: ☑ Ahzu kabz ☑ Sulh ☑ İbra ☐ Feragat          │
│                ☐ Boşanma  ☑ Temyiz/İstinaf ☐ Şirket temsili │
├─────────────────────────────────────────────────────────────┤
│ Bağlı Dosyalar (3): 2026/145 ✅ · 2025/341 ✅ · 2026/72 ⚠️   │
│ ⚠️ 2026/72: AI analizi — "Feragat yetkisi yok; ıslah/feragat│
│    ihtimali olan bu dosyada özel yetki gerekebilir."        │
├─────────────────────────────────────────────────────────────┤
│ [Belgeyi Gör] [Kapsam Analizi Çalıştır] [Azil Kaydet]       │
└─────────────────────────────────────────────────────────────┘
```

### 3. Vekaletname Formu — `/app/poa/new`
Bileşenler: müvekkil seçici, belge yükleme (OCR tetikler), noter bilgileri, tip,
başlangıç/bitiş tarihi, özel yetki onay kutuları (standart katalog), vekil avukat
çoklu seçimi.

### 4. Azil / İstifa Kaydı (modal) — `/app/poa/:poaId/terminate`
Bileşenler: sonlanma tipi (azil / istifa / süre dolumu), tebliğ tarihi, dayanak belge,
etkilenen dosya listesi önizlemesi ve onay.

### 5. Müvekkil kartı sekmesi — `/app/clients/:clientId/poa` · Dosya sekmesi — `/app/cases/:caseId/poa`

## Veri Modeli

### PowerOfAttorney (çekirdek şemada mevcut — genişletilmiş tanım)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| client_id | UUID FK→Client | Vekalet veren |
| poa_no | VARCHAR | VN-YYYY-NNN, tenant içi sıra |
| notary_name | VARCHAR | Örn. "Beyoğlu 14. Noterliği" |
| notary_registry_no | VARCHAR | Yevmiye numarası |
| issue_date | DATE | Düzenleme/başlangıç tarihi |
| expiry_date | DATE NULL | NULL = süresiz |
| poa_type | ENUM | GENERAL_LITIGATION (genel dava), SPECIAL (özel), GENERAL (genel temsil), ENFORCEMENT (icra) |
| status | ENUM | ACTIVE, EXPIRED, REVOKED (azil), RESIGNED (istifa) |
| termination_type | ENUM NULL | REVOCATION, RESIGNATION, EXPIRY |
| termination_date | DATE NULL | Azil/istifa tebliğ tarihi |
| termination_document_id | UUID FK→Document NULL | Azilname vb. |
| document_id | UUID FK→Document | Taranmış vekaletname |
| ocr_text | TEXT NULL | OCR çıktısı (AI analizi girdisi) |
| notes | TEXT NULL | |

### PoaScopeItem (yeni — özel yetki katalog bağı)

| Alan | Tip | Açıklama |
|---|---|---|
| id / poa_id | UUID | |
| scope_code | ENUM | AHZU_KABZ, SULH, IBRA, FERAGAT, KABUL, DAVADAN_FERAGAT, TEMYIZ_ISTINAF, TEMYIZDEN_FERAGAT, BOSANMA, NAFAKA, SIRKET_TEMSIL, TAHKIM, ARABULUCULUK, HACIZ_FEK, YEMIN_TEKLIF, OTHER |
| present | BOOLEAN | Vekaletnamede var mı |
| source | ENUM | MANUAL, OCR_EXTRACTED_CONFIRMED |

### PoaLawyer (yeni — vekil avukatlar)

| Alan | Tip | Açıklama |
|---|---|---|
| id / poa_id | UUID | |
| user_id | UUID FK→User NULL | Sistemdeki avukat |
| lawyer_name / bar_no | VARCHAR | Sistem dışı vekil için serbest metin |

### CasePoaLink (yeni — dosya bağı)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| case_id | UUID FK→Case | |
| poa_id | UUID FK→PowerOfAttorney | |
| sufficiency | ENUM | UNKNOWN, SUFFICIENT, INSUFFICIENT, NEEDS_REVIEW |
| ai_analysis_id | UUID NULL | Son analiz raporu referansı |
| linked_by / linked_at | UUID / TIMESTAMPTZ | |

## AI Yetenekleri

### POA_SCOPE_EXTRACTION
- **Girdi:** `ocr_text` (vekaletname metni).
- **Çıktı:** Tespit edilen özel yetkilerin `scope_code` listesi + her biri için kanıt cümlesi + noter/yevmiye/tarih alan önerileri. Avukat onayıyla `PoaScopeItem(source=OCR_EXTRACTED_CONFIRMED)` yazılır.
- **KVKK:** Vekaletname metnindeki TCKN, adres ve kimlik bilgileri maskeleme hattından geçer (tespit→maskele→onay→gönder); yetki cümleleri maskelenmez.

### POA_SUFFICIENCY_ANALYSIS
- **Girdi:** Vekaletnamenin scope listesi + `ocr_text` (maskeli) + dosyanın türü (Case.case_type), talep sonucu özeti ve aşaması.
- **Çıktı:** `{verdict: SUFFICIENT|INSUFFICIENT|NEEDS_REVIEW, missing_scopes[], reasoning, recommended_action}` + okunur rapor. Örn. "Boşanma davası için HMK uyarınca özel yetki gerekir; bu vekaletnamede boşanma yetkisi bulunmamaktadır."
- **Gördüğü veri:** Yalnızca ilgili vekaletname metni ve dosyanın meta özeti; diğer dosyalar görünmez.
- **KVKK:** Üçüncü kişi verileri maskeli; çıktı raporu "AI önerisidir, avukat teyidi gerekir" ibaresini zorunlu taşır. Verdict, avukat onayı olmadan `CasePoaLink.sufficiency`'ye yazılmaz — onaya kadar NEEDS_REVIEW kalır.

## İş Kuralları

1. Azil (REVOKED) kaydı girildiğinde: bağlı tüm `CasePoaLink`'ler işaretlenir, ilgili dosyalara "vekalet sonlandı" TimelineEvent'i düşer, sorumlu avukatlara görev açılır, müvekkilin PortalUser'ları tenant politikasına göre askıya alınır.
2. Süre uyarıları deterministiktir: `expiry_date` dolu ise bitişten 30, 7 ve 1 gün önce `Deadline` kaydı üretilir (tip: POA_EXPIRY). AI bu tarihleri hesaplamaz.
3. `expiry_date < bugün` olan vekaletname gecelik işle EXPIRED yapılır; bağlı derdest dosyalar "geçerli vekalet yok" uyarısı alır.
4. Bir dosyaya birden çok vekaletname bağlanabilir (birden çok müvekkil veya yenileme); dosyanın "vekalet durumu" en iyi durumdaki aktif bağdan türetilir.
5. REVOKED/EXPIRED vekaletname yeni dosyaya bağlanamaz (409).
6. Azil ve kapsam değişiklikleri yalnızca AVUKAT ve üstü rollerce yapılabilir; SEKRETER kayıt oluşturabilir ama sonlandıramaz.
7. AI çıkarımlı scope, avukat onayı olmadan `present=true` yazılamaz; onaysız çıkarımlar öneri kuyruğunda bekler.
8. Sonlandırma kayıtları geri alınamaz; hatalı azil girişinde düzeltme yeni kayıt + AuditLog açıklamasıyla yapılır.
9. Duruşma hazırlık paketi (Modül 03) dosyanın vekalet durumunu içerir; INSUFFICIENT veya bağsız dosyada paket uyarıyla başlar.
10. Tüm oluşturma/sonlandırma/analiz olayları `AuditLog`'a POA_* aksiyon tipleriyle yazılır.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET/POST | /api/v1/poa | Listele (filtre: status, client_id, expiring_before) / oluştur |
| GET/PATCH | /api/v1/poa/:id | Detay / güncelle |
| POST | /api/v1/poa/:id/terminate | Azil / istifa / süre dolumu kaydı |
| GET/PUT | /api/v1/poa/:id/scopes | Özel yetki listesi / güncelle |
| POST | /api/v1/poa/:id/extract-scopes | POA_SCOPE_EXTRACTION tetikle |
| POST | /api/v1/poa/:id/links | Dosyaya bağla (case_id) |
| DELETE | /api/v1/poa/:id/links/:linkId | Bağı kaldır |
| POST | /api/v1/cases/:caseId/poa/analyze | POA_SUFFICIENCY_ANALYSIS tetikle |
| GET | /api/v1/cases/:caseId/poa | Dosyanın vekalet durumu + bağlar |
| GET | /api/v1/poa/alerts | Süresi yaklaşan / sorunlu vekaletler |

## Diğer Modüllerle İlişkiler

- **Modül 01 Müvekkil CRM:** Müvekkil kartının Vekaletnameler bölümü bu modülü gömer.
- **Modül 02 Dava Dosyası:** Dosyanın Vekalet sekmesi `CasePoaLink` üzerinden beslenir; dosya açılış sihirbazı vekalet bağlamayı adım olarak içerir.
- **Süre Motoru (G4):** POA_EXPIRY uyarıları Deadline olarak üretilir ve oradan bildirilir.
- **Modül 03 Duruşma:** Hazırlık paketi vekalet durumunu ve eksik yetki uyarısını içerir.
- **Modül 10 Portal:** Azil, portal erişiminin askıya alınmasını tetikler.
- **Belge→Aksiyon Hattı (G7):** Gelen azilname belgesi sınıflandırıldığında bu modülde sonlandırma taslağı önerilir.

## Kabul Kriterleri

1. Vekaletname; noter, yevmiye, tarih, tip, süre, vekiller ve özel yetki kataloğuyla kaydedilebiliyor ve filtrelerle listelenebiliyor.
2. `expiry_date` girilen kayıtta 30/7/1 gün öncesine üç Deadline otomatik oluşuyor; tarih değişince eski uyarılar güncelleniyor.
3. Azil kaydı tek işlemde: status REVOKED, bağlı dosyalara TimelineEvent, sorumlu avukata görev, portal kullanıcılarına askı uyguluyor (entegrasyon testi).
4. REVOKED vekaletnameyi dosyaya bağlama isteği 409 dönüyor.
5. OCR'lı belgeden POA_SCOPE_EXTRACTION en az yevmiye no + 3 özel yetkiyi kanıt cümlesiyle öneriyor; onaysız öneri `present=true` yazmıyor (mock AI testi).
6. Boşanma dosyası + boşanma yetkisi olmayan vekaletname senaryosunda POA_SUFFICIENCY_ANALYSIS INSUFFICIENT + missing_scopes=[BOSANMA] döndürüyor.
7. AI verdict'i avukat onayına kadar `CasePoaLink.sufficiency`'yi değiştirmiyor; onayla SUFFICIENT/INSUFFICIENT yazılıyor.
8. `/api/v1/poa/alerts` süresi 30 gün içinde dolacak ve EXPIRED-derdest kombinasyonlarını döndürüyor.
9. SEKRETER terminate ucunda 403 alıyor; tüm kritik olaylar AuditLog'da görünüyor.
10. Başka tenant'ın poa id'siyle her istek 404 dönüyor.

## Faz

**Faz 4.** Önkoşullar: Belge altyapısı + OCR hattı (Faz 2), Deadline motoru (Faz 2),
Müvekkil CRM. Kayıt/bağ/uyarı katmanı Faz 4 başında; AI analizi (POA_SCOPE_EXTRACTION,
POA_SUFFICIENCY_ANALYSIS) aynı fazın ikinci iterasyonunda devreye alınır.
