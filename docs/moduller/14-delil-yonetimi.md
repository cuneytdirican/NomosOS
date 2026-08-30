# Modül 14 — Delil Yönetimi

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 15 `[P1, 9/10]`

## Amaç

Dosyadaki delilleri belge yığınından ayrıştırıp birinci sınıf kayıt haline getirmek.
Delil tipleri: belge, fotoğraf, video, ses kaydı, tanık, bilirkişi (raporu), keşif ve
diğer. Her delil; hangi vakıayı/iddiayı ispata yaradığı, nereden geldiği (müvekkil,
UYAP, karşı taraf sunumu, keşif tutanağı), sunulup sunulmadığı ve hangi belgeyle
temsil edildiği bilgisiyle kaydedilir. Tanık ve keşif gibi belge-olmayan deliller de
aynı modelde yaşar; böylece "delil listesi" dilekçesi sistemden üretilebilir hale gelir.

Modülün kalbi **iddia → delil → belge → hukuki dayanak matrisidir**. Avukat dosyanın
iddialarını (vakıa ve talepler) yapılandırır; her iddiaya destekleyen delilleri, her
delile temsil eden belgeleri, her iddiaya hukuki dayanağı (kanun maddesi, içtihat)
bağlar. Matris ekranı "Bu davada hangi iddiamızı hangi delil destekliyor?" sorusunun
tek bakışlık yanıtıdır ve duruşma hazırlığının, dilekçelerin ve strateji motorunun
(G16) ortak zeminidir.

AI iki işte kullanılır: (1) matris üretimi — dosyadaki dilekçeler ve belgelerden iddia
adaylarını, delil-iddia eşleşmelerini ve hukuki dayanak önerilerini çıkarır; avukat
onaylayınca matrise yazılır; (2) delil eksiği tespiti — desteksiz iddiaları, zayıf
(tek ve itiraza açık) delille duran iddiaları ve karşı tarafın delillerine cevapsız
kalan noktaları raporlar. Her iki çıktı da öneridir; matrisin kayıtlı hali her zaman
avukat onaylı veridir.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosyaya tipli delil kaydı (belge/fotoğraf/video/ses/tanık/
   bilirkişi/keşif/diğer) girmek istiyorum ki delil envanteri belge klasöründen
   bağımsız ve eksiksiz olsun.
2. **Avukat olarak**, dosyanın iddialarını vakıa listesi olarak yapılandırmak
   istiyorum ki her iddianın ispat durumu takip edilebilsin.
3. **Avukat olarak**, iddia-delil-belge-hukuki dayanak matrisini tek ekranda görmek
   istiyorum ki dosyanın ispat haritası bir bakışta çıksın.
4. **Avukat olarak**, AI'ın dilekçe ve belgelerden matris taslağı üretmesini istiyorum
   ki 200 belgelik dosyada matrisi sıfırdan elle kurmayayım.
5. **Avukat olarak**, desteksiz iddiaların ve delil eksiklerinin listesini istiyorum ki
   delil ikamesi için süre varken harekete geçeyim.
6. **Avukat olarak**, tanık delilini kimlik/iletişim/hangi vakıayı bildiği bilgisiyle
   kaydetmek istiyorum ki tanık listesi dilekçesi sistemden üretilsin.
7. **Stajyer olarak**, delilleri kaynak ve sunum durumuna göre filtrelemek istiyorum
   ki "sunulmamış deliller" listesini avukata raporlayayım.
8. **Avukat olarak**, karşı tarafın sunduğu delilleri de matriste ayrı renkte görmek
   istiyorum ki hangi iddiamıza hangi karşı delil geldiğini izleyeyim.
9. **Partner olarak**, duruşma öncesi dosyanın delil risk özetini (eksik/zayıf ispat)
   görmek istiyorum ki riskli dosyalara müdahale edeyim.
10. **Avukat olarak**, matristen delil listesi bölümünü dilekçeye aktarmak istiyorum
    ki delil dilekçesi yazımı dakikalara insin.

## Ekranlar ve UX

### 1. Dosya Delilleri — `/app/cases/:caseId/evidence`
Bileşenler: tip filtreli delil tablosu (tip ikonu, ad, kaynak, sunum durumu, bağlı
iddia sayısı), "Delil Ekle" formu (tipe göre dinamik alanlar), toplu içe aktarma
(mevcut Document'lardan seç → delilleştir).

### 2. İspat Matrisi — `/app/cases/:caseId/evidence/matrix`

```
┌────────────────────────────────────────────────────────────────┐
│ 2026/145 — İspat Matrisi        [AI Matris Üret] [Eksik Analizi]│
├──────────────────┬──────────────────┬─────────────┬────────────┤
│ İDDİA            │ DELİL            │ BELGE       │ H. DAYANAK │
├──────────────────┼──────────────────┼─────────────┼────────────┤
│ 1. Ayıplı imalat │ 📄 Teslim tutanağı│ EK-3        │ TBK m.474  │
│    yapıldı       │ 📷 Saha fotoğrafı │ EK-7 (12 ad)│ TBK m.475  │
│                  │ 🔬 Bilirkişi kök  │ EK-14       │            │
│                  │    raporu s.9-11  │             │            │
├──────────────────┼──────────────────┼─────────────┼────────────┤
│ 2. Sözleşme feshi│ 📄 İhtarname      │ EK-5        │ TBK m.125  │
│    haklıydı      │ 👤 Tanık: M.K.    │ —           │            │
├──────────────────┼──────────────────┼─────────────┼────────────┤
│ 3. Gelir kaybı   │ ⚠️ DELİL YOK      │ —           │ TBK m.112  │
│    100.000 TL    │                  │             │            │
└──────────────────┴──────────────────┴─────────────┴────────────┘
```

Bileşenler: matris ızgarası (iddia satırları, genişleyebilir delil hücreleri),
desteksiz iddia uyarı satırı, karşı taraf delili rozeti, sürükle-bırak delil-iddia
bağlama, dilekçeye aktar butonu.

### 3. Delil Detayı — `/app/cases/:caseId/evidence/:evidenceId`
Bileşenler: tipe özgü alanlar (tanıkta kimlik/iletişim; ses/videoda süre ve transkript
bağı), bağlı belgeler, desteklediği iddialar, zincir bilgisi (kaynak, elde edilme
tarihi), notlar.

### 4. Eksik Analizi Raporu — `/app/cases/:caseId/evidence/gaps`
Bileşenler: AI rapor görünümü (desteksiz iddialar, zayıf ispat, cevapsız karşı
deliller), her bulgu için önerilen aksiyon ve "Görev Oluştur" butonu.

## Veri Modeli

### Evidence (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| case_id | UUID FK→Case | |
| evidence_no | INT | Dosya içi sıra (delil listesi için) |
| evidence_type | ENUM | DOCUMENT, PHOTO, VIDEO, AUDIO, WITNESS, EXPERT_REPORT, INSPECTION (keşif), OTHER |
| title | VARCHAR | Örn. "14.02.2026 tarihli teslim tutanağı" |
| description | TEXT NULL | |
| source | ENUM | CLIENT_PROVIDED, UYAP, OPPOSING_PARTY, COURT (keşif/bilirkişi), THIRD_PARTY, OFFICE |
| offered_by | ENUM | US, OPPOSING, COURT — kimin delili |
| submission_status | ENUM | NOT_SUBMITTED, SUBMITTED, ADMITTED, REJECTED |
| submitted_at | DATE NULL | |
| obtained_at | DATE NULL | Elde edilme tarihi |
| witness_name / witness_contact | VARCHAR NULL | WITNESS tipinde |
| witness_facts | TEXT NULL | Tanığın hangi vakıayı bildiği |
| expert_report_id | UUID FK→ExpertReport NULL | EXPERT_REPORT tipinde (Modül 13 bağı) |
| media_duration_seconds | INT NULL | AUDIO/VIDEO |
| transcript_document_id | UUID FK→Document NULL | Ses/video transkripti |
| notes | TEXT NULL | |

### EvidenceDocument (yeni — delil ↔ belge, N:N)

| Alan | Tip | Açıklama |
|---|---|---|
| id / evidence_id | UUID | |
| document_id | UUID FK→Document | |
| exhibit_label | VARCHAR NULL | Dilekçedeki ek etiketi (örn. "EK-7") |
| page_ref | VARCHAR NULL | Sayfa/aralık referansı |

### Claim (yeni — iddia/vakıa)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| case_id | UUID FK→Case | |
| claim_no | INT | Matris satır sırası |
| claim_text | TEXT | İddia/vakıa ifadesi |
| claim_side | ENUM | OURS, OPPOSING — karşı tarafın iddiaları da izlenir |
| status | ENUM | ACTIVE, WITHDRAWN, PROVEN, DISPUTED |
| source | ENUM | MANUAL, AI_SUGGESTED_CONFIRMED |

### ClaimEvidenceLink (yeni — matrisin hücresi)

| Alan | Tip | Açıklama |
|---|---|---|
| id / tenant_id | UUID | |
| claim_id | UUID FK→Claim | |
| evidence_id | UUID FK→Evidence | |
| support_strength | ENUM | STRONG, MODERATE, WEAK — avukat değerlendirmesi |
| relation | ENUM | SUPPORTS, CONTRADICTS — karşı delil bağı için |
| note | TEXT NULL | |
| source | ENUM | MANUAL, AI_SUGGESTED_CONFIRMED |

### ClaimLegalBasis (yeni)

| Alan | Tip | Açıklama |
|---|---|---|
| id / claim_id | UUID | |
| basis_type | ENUM | STATUTE (mevzuat), PRECEDENT (içtihat), DOCTRINE, OTHER |
| citation | VARCHAR | Örn. "TBK m. 474", "Yarg. 15. HD 2019/1234 E." |
| note | TEXT NULL | |
| source | ENUM | MANUAL, AI_SUGGESTED_CONFIRMED |

## AI Yetenekleri

### EVIDENCE_MATRIX
- **Girdi:** Dosyanın dilekçeleri (dava/cevap/replik, maskeli metin), mevcut Evidence ve Claim kayıtları, belge başlıkları + AI belge özetleri.
- **Çıktı:** Öneri seti: `{claims: [{text, side, evidence_refs: [{evidence_id? | new_evidence_suggestion}], legal_basis_suggestions: [citation]}]}`. Ekranda "öneri kuyruğu" olarak listelenir; avukat tek tek veya toplu onaylar; onaylananlar `source=AI_SUGGESTED_CONFIRMED` ile matrise yazılır.
- **Gördüğü veri:** Yalnızca ilgili dosyanın dilekçe metinleri ve belge meta/özetleri.
- **KVKK:** Metinler maskeleme hattından geçer (tespit→maskele→onay→gönder); çocuk/sağlık verisi içeren dosyalarda tenant politikası yerel/BYO-LLM zorunluluğu koyabilir.

### EVIDENCE_GAP_ANALYSIS
- **Girdi:** Onaylı matris (Claim + ClaimEvidenceLink + ClaimLegalBasis) + karşı taraf delil listesi.
- **Çıktı:** Rapor: `{unsupported_claims[], weakly_supported[{claim_id, reason}], unanswered_opposing_evidence[], suggested_actions[{action, related_claim_id}]}` + okunur özet. "3 no'lu iddia (gelir kaybı) delilsiz; ticari defter kayıtları veya YMM raporu ikame edilebilir" düzeyinde somut öneri.
- **Gördüğü veri:** Matris kayıtları ve delil meta verisi; belge içeriği gerekmiyorsa gönderilmez.
- **KVKK:** Tanık ad-soyadları maskelenir; rapor öneri niteliğindedir, matrisi değiştirmez.

### WITNESS_FACT_MAPPING (opsiyonel, Faz 5 sonu)
- **Girdi:** Tanık beyanı/ifade tutanağı metni (maskeli) + Claim listesi.
- **Çıktı:** Tanığın hangi iddiaları desteklediği önerisi (ClaimEvidenceLink adayı).

## İş Kuralları

1. Evidence her zaman bir `case_id`'ye bağlıdır; `evidence_no` dosya içinde ardışıktır ve delil listesi dilekçesinde sıra numarası olarak kullanılır.
2. DOCUMENT/PHOTO/VIDEO/AUDIO tiplerinde en az bir `EvidenceDocument` bağı zorunludur; WITNESS tipinde `witness_name` ve `witness_facts` zorunludur; INSPECTION tipinde keşif tutanağı belgesi önerilir.
3. Aynı Document birden çok delile, aynı delil birden çok iddiaya bağlanabilir (N:N).
4. AI önerileri (`Claim`, link, dayanak) avukat onayı olmadan matrise yazılmaz; öneri kuyruğunda 30 gün işlem görmeyen kayıtlar arşivlenir.
5. `relation=CONTRADICTS` bağı yalnızca `offered_by=OPPOSING` veya `COURT` delillerle kurulabilir; matris ekranında ayrı renkle gösterilir.
6. Desteksiz iddia tanımı deterministiktir: `claim_side=OURS`, `status=ACTIVE` ve hiç `relation=SUPPORTS` bağı olmayan Claim. Matris ekranı bu satırları uyarı stiliyle işaretler (AI gerekmez); AI raporu bunun üzerine niteliksel analiz ekler.
7. `submission_status=REJECTED` delil matristen silinmez; bağları soluk gösterilir ve ispat gücü hesabına katılmaz.
8. Bilirkişi raporu delili `expert_report_id` üzerinden Modül 13 kaydına bağlanır; ayrıca belge bağı da kurulabilir (sayfa referanslı).
9. Delil silme yumuşak silmedir (soft delete) ve gerekçe ister; tüm delil/matris değişiklikleri `AuditLog`'a EVIDENCE_* tipleriyle yazılır.
10. Matris dışa aktarımı (dilekçe bölümü, PDF) yalnızca onaylı kayıtları içerir; öneri kuyruğundaki AI kayıtları asla dışa aktarılmaz.
11. Ses/video delillerde transkript belgesi bağlanmadan AI analizlerine içerik gönderilmez (yalnızca meta veri gider).

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET/POST | /api/v1/cases/:caseId/evidence | Delil listele (filtre: type, source, submission_status) / oluştur |
| GET/PATCH/DELETE | /api/v1/evidence/:id | Detay / güncelle / yumuşak sil |
| POST | /api/v1/evidence/:id/documents | Belge bağla (exhibit_label ile) |
| GET/POST | /api/v1/cases/:caseId/claims | İddia listele/oluştur |
| PATCH | /api/v1/claims/:id | İddia güncelle |
| POST | /api/v1/claims/:id/evidence-links | Delil bağla (strength, relation) |
| POST | /api/v1/claims/:id/legal-basis | Hukuki dayanak ekle |
| GET | /api/v1/cases/:caseId/evidence/matrix | Matris (iddia+delil+belge+dayanak join) |
| POST | /api/v1/cases/:caseId/evidence/matrix/ai-generate | EVIDENCE_MATRIX tetikle (öneri kuyruğu döner) |
| POST | /api/v1/cases/:caseId/evidence/suggestions/:id/approve | AI önerisini onayla |
| POST | /api/v1/cases/:caseId/evidence/gap-analysis | EVIDENCE_GAP_ANALYSIS tetikle |
| GET | /api/v1/cases/:caseId/evidence/matrix/export | Dilekçe bölümü / PDF dışa aktarım |

## Diğer Modüllerle İlişkiler

- **Modül 02 Dava Dosyası:** Deliller ve Tanıklar sekmeleri bu modüldür; delil olayları safahata düşer.
- **Modül 13 Bilirkişi:** Bilirkişi raporları delil tipi olarak matriste yer alır; itiraz taslağı matristen karşı delil referansı çeker.
- **Modül 03 Duruşma:** Hazırlık paketi "eksik deliller" bölümünü gap-analysis çıktısından alır.
- **Strateji Motoru (G16):** Argüman zinciri (iddia→delil→dayanak→zayıf nokta) doğrudan matris verisi üzerine kurulur.
- **Risk Engine (G18):** Delil Riski boyutu desteksiz/zayıf iddia oranından beslenir.
- **Belge→Aksiyon Hattı (G7):** Yeni gelen belge için "delilleştir ve şu iddiaya bağla" önerisi üretilebilir.
- **Görev Modülü:** Gap raporundaki önerilen aksiyonlar tek tıkla görev olur.

## Kabul Kriterleri

1. 8 delil tipi de tipe özgü zorunlu alanlarıyla kaydedilebiliyor; WITNESS'te belge bağı olmadan, DOCUMENT'ta belge bağıyla doğrulama çalışıyor.
2. Matris ucu; iddia, bağlı deliller, exhibit etiketli belgeler ve hukuki dayanakları tek yanıtta döndürüyor ve ekran wireframe'deki yapıda çiziyor.
3. Hiç SUPPORTS bağı olmayan aktif iddia, matris yanıtında `unsupported=true` bayrağıyla dönüyor (deterministik, AI'sız).
4. AI matris üretimi öneri kuyruğu oluşturuyor; onaysız hiçbir öneri matris ucunda görünmüyor; onaylanan kayıt `source=AI_SUGGESTED_CONFIRMED` taşıyor.
5. Gap-analysis, şemadaki dört bölümü (desteksiz, zayıf, cevapsız karşı delil, aksiyonlar) dolduran JSON döndürüyor (mock AI testi).
6. CONTRADICTS bağı `offered_by=US` delille kurulmaya çalışılınca 422 dönüyor.
7. REJECTED delilin bağları matris yanıtında `inactive` olarak işaretleniyor.
8. Yumuşak silinen delil listelerde görünmüyor ama AuditLog ve id ile erişimde izi kalıyor.
9. Matris dışa aktarımı delil listesi bölümünü evidence_no sırasıyla ve exhibit etiketleriyle üretiyor; öneri kuyruğu kayıtları çıktıda yok.
10. Tüm uçlar tenant-scoped; başka tenant'ın claim/evidence id'leri 404 dönüyor.
11. AI çağrılarında dilekçe metinlerinin maskeleme hattından geçtiği entegrasyon testiyle doğrulanıyor.

## Faz

**Faz 5.** Önkoşullar: Belge altyapısı + AI belge özetleri (Faz 2-3), Bilirkişi
modülü (Faz 4, EXPERT_REPORT delil bağı için), maskeleme hattı. Delil kayıt + elle
matris **Faz 5 başında**; AI katmanı (EVIDENCE_MATRIX, EVIDENCE_GAP_ANALYSIS) aynı
fazın ikinci iterasyonunda; WITNESS_FACT_MAPPING faz sonunda opsiyoneldir. Strateji
Motoru (G16) bu modülün matrisi olmadan başlatılmaz.
