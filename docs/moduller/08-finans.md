# Modül 08 — Finans (Hukuk Bürosu Finansı)

> Kaynak: `docs/99-kaynak-gereksinimler.md` → Gereksinim 9 `[P1, 9/10]`

## Amaç

Hukuk bürosunun tüm parasal hareketlerini tek modelde toplamak: tahakkuk (müvekkile
yansıtılan alacak), tahsilat (fiilen alınan ödeme), avans (müvekkilden peşin alınan ve
masraflara mahsup edilen tutar), masraf (büro cebinden çıkan dosya gideri), harç
(mahkeme/icra harçları), vekalet ücreti, sözleşme bedeli ve aylık danışmanlık ücreti.
Her hareket bir müvekkile ve — varsa — bir dosyaya bağlanır; böylece hem dosya bazlı
hem müvekkil bazlı hem de büro geneli finans görünümü aynı veriden türetilir.

Modülün ayırt edici hedefi müvekkil bazlı finans özetidir. "ABC Holding'in bize toplam
borcu ne?" sorusu tek ekranda ve tek AI sorgusuyla yanıtlanabilmelidir: açık dosya
sayısı, toplam tahakkuk, tahsil edilen, bekleyen bakiye, yansıtılmamış masraflar ve
tahsilat riski. Bu özet Müvekkil CRM kartının (Modül 01) Finans sekmesini besler.

Finans modülü muhasebe yazılımı değildir; resmi defter tutmaz. Faturalama ve e-Fatura
(Modül 09) bu modülün tahakkuk verisini fatura belgesine dönüştürür. Tüm parasal
kayıtlar `AuditLog`'a yazılır ve yalnızca yetkili roller (PARTNER, ADMIN, yetkili AVUKAT)
tarafından düzenlenebilir.

## Kullanıcı Hikâyeleri

1. **Avukat olarak**, dosyaya harç ve masraf girişi yapmak istiyorum ki dosya kapanışında
   müvekkile yansıtılacak tutar eksiksiz olsun.
2. **Avukat olarak**, müvekkilden alınan avansı kaydetmek ve masrafları bu avanstan
   mahsup etmek istiyorum ki avans bakiyesini elle takip etmek zorunda kalmayayım.
3. **Partner olarak**, "ABC Holding'in bize toplam borcu ne?" diye sorup tek ekranda
   tahakkuk/tahsilat/bekleyen özetini görmek istiyorum ki toplantıya hazır gireyim.
4. **Partner olarak**, büro geneli aylık tahakkuk-tahsilat raporunu görmek istiyorum ki
   nakit akışını planlayabileyim.
5. **Avukat olarak**, dosya bazlı finans sekmesinde o dosyanın tüm hareketlerini
   (harç, masraf, vekalet ücreti, tahsilat) kronolojik görmek istiyorum ki dosyanın
   maliyetini bileyim.
6. **Sekreter olarak**, gelen banka ödemesini ilgili müvekkil ve tahakkuka bağlamak
   istiyorum ki bakiye anında güncellensin.
7. **Partner olarak**, tahsilat riski yüksek müvekkilleri listelemek istiyorum ki
   yeni iş kabulünde ve avans politikasında bunu dikkate alayım.
8. **Avukat olarak**, aylık danışmanlık müvekkilim için her ay otomatik tahakkuk
   oluşmasını istiyorum ki faturalama dönemi elle takip gerektirmesin.
9. **Admin olarak**, finans kayıtlarında kimin ne değiştirdiğini `AuditLog` üzerinden
   görmek istiyorum ki parasal veride izlenebilirlik tam olsun.

## Ekranlar ve UX

### 1. Büro Finans Panosu — `/app/finance`
Bileşenler: dönem seçici (ay/çeyrek/yıl), KPI kartları (Toplam Tahakkuk, Tahsil Edilen,
Bekleyen, Masraf, Avans Bakiyesi), aylık tahakkuk-tahsilat çubuk grafiği, en borçlu 10
müvekkil tablosu, vadesi geçen alacaklar listesi.

### 2. Müvekkil Finans Özeti — `/app/clients/:clientId/finance`
Bileşenler: özet kartı (aşağıdaki wireframe), hareket listesi (filtre: tip, dosya, tarih),
avans mahsup geçmişi, "AI Özet" butonu (`CLIENT_FINANCIAL_SUMMARY`).

```
┌─────────────────────────────────────────────────────────────┐
│ ABC Holding A.Ş. — Finans Özeti           [AI Özet Üret]    │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Açık Dosya   │ Tahakkuk     │ Tahsil       │ Bekleyen       │
│     37       │ 1.240.000 TL │ 890.000 TL   │ 350.000 TL     │
├──────────────┴──────┬───────┴──────────────┴────────────────┤
│ Masraflar: 72.450 TL│ Avans Bakiyesi: 15.000 TL │ Risk: 🟡  │
├─────────────────────┴───────────────────────────────────────┤
│ Tarih      Tip            Dosya       Tutar        Durum    │
│ 12.08.2026 Vekalet Ücreti 2026/145   150.000 TL   Bekliyor  │
│ 05.08.2026 Tahsilat       2025/341    80.000 TL   Alındı    │
│ 01.08.2026 Harç           2026/145     4.250 TL   Yansıtıldı│
└─────────────────────────────────────────────────────────────┘
```

### 3. Dosya Finans Sekmesi — `/app/cases/:caseId/finance`
Bileşenler: dosya finans özeti (toplam masraf, harç, tahakkuk, tahsilat), hareket
listesi, "Hareket Ekle" formu (tip, tutar, tarih, açıklama, belge eki).

### 4. Hareket Girişi (modal) — `/app/finance/entries/new`
Bileşenler: tip seçici, müvekkil/dosya arama, tutar + para birimi, vade tarihi,
avanstan mahsup anahtarı, belge (dekont) yükleme.

## Veri Modeli

### FinancialEntry (çekirdek şemada mevcut — genişletilmiş tanım)

| Alan | Tip | Açıklama |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK→Tenant | Zorunlu; tüm sorgular tenant-scoped |
| client_id | UUID FK→Client | Zorunlu |
| case_id | UUID FK→Case NULL | Dosyaya bağlı değilse boş (örn. aylık danışmanlık) |
| entry_type | ENUM | ACCRUAL (tahakkuk), COLLECTION (tahsilat), ADVANCE (avans), EXPENSE (masraf), COURT_FEE (harç), ATTORNEY_FEE (vekalet ücreti), CONTRACT_FEE (sözleşme bedeli), RETAINER_FEE (aylık danışmanlık) |
| direction | ENUM | RECEIVABLE (alacak artışı) / RECEIVED (giriş) / SPENT (çıkış) — türetilir, raporlama için denormalize |
| amount | DECIMAL(18,2) | Pozitif tutar |
| currency | CHAR(3) | Varsayılan TRY |
| entry_date | DATE | Hareket tarihi |
| due_date | DATE NULL | Vade (tahakkuklar için) |
| status | ENUM | PENDING, PARTIALLY_PAID, PAID, WRITTEN_OFF, REIMBURSED |
| advance_entry_id | UUID FK→FinancialEntry NULL | Mahsup edilen avans kaydı |
| invoice_id | UUID FK→Invoice NULL | Modül 09 bağlantısı |
| description | TEXT | |
| document_id | UUID FK→Document NULL | Dekont/makbuz |
| created_by | UUID FK→User | |
| created_at / updated_at | TIMESTAMPTZ | |

### ClientFinancialSnapshot (yeni — gecelik hesaplanan özet)

| Alan | Tip | Açıklama |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID FK→Tenant | |
| client_id | UUID FK→Client | Unique(tenant_id, client_id, snapshot_date) |
| snapshot_date | DATE | |
| open_case_count | INT | Açık dosya sayısı |
| total_accrued | DECIMAL(18,2) | Toplam tahakkuk |
| total_collected | DECIMAL(18,2) | Toplam tahsilat |
| total_outstanding | DECIMAL(18,2) | Bekleyen bakiye |
| total_expenses | DECIMAL(18,2) | Yansıtılmamış masraflar |
| advance_balance | DECIMAL(18,2) | Kalan avans |
| collection_risk | ENUM | LOW / MEDIUM / HIGH (kural: gecikme gün ort. + bekleyen oranı) |

## AI Yetenekleri

### CLIENT_FINANCIAL_SUMMARY
- **Girdi:** client_id + snapshot + son 50 hareket + açık dosya listesi (başlık düzeyi).
- **Çıktı:** Doğal dilde Türkçe özet + yapılandırılmış JSON (`{open_cases, accrued, collected, outstanding, expenses, risk, highlights[]}`).
- **Gördüğü veri:** Yalnızca tutar, tarih, tip, dosya esas no ve müvekkil ticari unvanı. Sayısal alanlar deterministik hesaplanır; AI yalnızca anlatım ve yorum üretir, tutar hesaplamaz.
- **KVKK:** Gerçek kişi müvekkilde TC kimlik no, IBAN, adres maskeleme hattından geçer (Gereksinim 20 akışı: tespit→maskele→onay→gönder). BYO-LLM'de yerel model seçiliyse maskeleme opsiyonel uyarıya düşer.

### COLLECTION_RISK_EXPLANATION
- **Girdi:** müvekkilin ödeme geçmişi (gecikme günleri, kısmi ödemeler).
- **Çıktı:** Risk seviyesinin gerekçeli açıklaması + önerilen aksiyon (avans iste, ödeme planı öner). Risk seviyesinin kendisi kural motorundan gelir; AI yalnızca açıklar.

## İş Kuralları

1. Her `FinancialEntry` bir `client_id` içermek zorundadır; `case_id` opsiyoneldir.
2. Bakiye formülü deterministiktir: `outstanding = Σ(ACCRUAL,ATTORNEY_FEE,CONTRACT_FEE,RETAINER_FEE tahakkukları) − Σ(COLLECTION) − Σ(avans mahsupları)`. AI hiçbir zaman bakiye hesaplamaz.
3. Avans mahsubu yalnızca aynı müvekkilin pozitif avans bakiyesinden yapılabilir; bakiye eksiye düşemez (400 döner).
4. Tahsilat kaydı, bağlandığı tahakkukun kalanından büyük olamaz; fazlası ayrı ADVANCE olarak önerilir.
5. PAID durumundaki kayıt silinemez; yalnızca ters kayıt (storno) ile düzeltilir ve `AuditLog`'a `FINANCE_REVERSAL` yazılır.
6. RETAINER_FEE tahakkukları, aktif `FeeAgreement` (Modül 09, tip MONTHLY_RETAINER) varsa her ayın 1'inde zamanlanmış işle otomatik oluşturulur.
7. Finans yazma yetkisi: PARTNER ve ADMIN tümünde; AVUKAT yalnızca sorumlusu olduğu dosyalarda; STAJYER ve SEKRETER salt okunur (SEKRETER'e tahsilat girişi yetkisi tenant ayarıyla açılabilir).
8. `collection_risk` kuralı: ortalama gecikme >60 gün veya bekleyen/tahakkuk oranı >%40 → HIGH; >30 gün veya >%20 → MEDIUM; aksi LOW.
9. Para birimi TRY dışıysa hareket girişinde kur ve TRY karşılığı zorunludur; raporlar TRY üzerinden toplanır.
10. Snapshot işi her gece 03:00'te (tenant saat dilimi) çalışır; müvekkil ekranı canlı sorgu + son snapshot karışımı gösterir.

## API Uçları

| Method | Yol | Açıklama |
|---|---|---|
| GET | /api/v1/finance/entries | Liste; filtre: client_id, case_id, entry_type, status, date_from/to |
| POST | /api/v1/finance/entries | Hareket oluştur |
| PATCH | /api/v1/finance/entries/:id | Güncelle (PAID hariç) |
| POST | /api/v1/finance/entries/:id/reverse | Storno kaydı oluştur |
| GET | /api/v1/clients/:clientId/finance/summary | Müvekkil finans özeti (deterministik) |
| POST | /api/v1/clients/:clientId/finance/ai-summary | CLIENT_FINANCIAL_SUMMARY tetikle |
| GET | /api/v1/cases/:caseId/finance/summary | Dosya finans özeti |
| GET | /api/v1/finance/reports/office | Büro geneli rapor (dönem parametreli) |
| GET | /api/v1/finance/reports/receivables | Vadesi geçen alacaklar |
| GET | /api/v1/clients/:clientId/finance/advance-balance | Avans bakiyesi |

## Diğer Modüllerle İlişkiler

- **Modül 01 Müvekkil CRM:** Müvekkil kartının Finans sekmesi bu modülün özetini gömer.
- **Modül 02 Dava Dosyası:** Dosya sekmelerindeki Harçlar/Masraflar/Finans bu modülden beslenir.
- **Modül 09 Faturalama:** Tahakkuklar faturaya dönüştürülür (`invoice_id` bağı); ödeme kaydı buraya COLLECTION yazar.
- **Modül 10 Müvekkil Portalı:** Ödemeler ekranı, yayınlanmasına izin verilen tahakkuk/tahsilat verisini okur.
- **Modül 19 Partner Dashboard:** "Tahsil edilecek 4.2M TL" KPI'ı bu modülün rapor ucundan gelir.
- **İcra Modülü:** İcra tahsilatları COLLECTION olarak buraya akar.

## Kabul Kriterleri

1. 8 hareket tipi de girilebiliyor, listelenebiliyor ve tipe göre filtrelenebiliyor.
2. Avans girildikten sonra masraf mahsubu yapılınca avans bakiyesi doğru azalıyor; bakiye yetersizse istek 400 ile reddediliyor.
3. Müvekkil özeti ucu, kaynak gereksinimdeki örnekle aynı alanları döndürüyor (açık dosya, tahakkuk, tahsil, bekleyen, masraf, risk) ve tutarlar `FinancialEntry` toplamlarıyla birebir eşleşiyor.
4. AI özeti, deterministik özetle çelişen tutar içermiyor (test: JSON çıktı alanları kaynak toplamlara eşit).
5. PAID kayıt DELETE/PATCH denemesi 409 döndürüyor; storno ucu ters kayıt üretiyor ve `AuditLog`'da görünüyor.
6. Farklı tenant'ın müvekkil/dosya id'siyle yapılan her istek 404 döndürüyor (tenant izolasyon testi).
7. STAJYER rolü POST /finance/entries çağrısında 403 alıyor; AVUKAT başkasının dosyasına yazamıyor.
8. Aylık danışmanlık müvekkilinde ay başında RETAINER_FEE tahakkuku otomatik oluşuyor (zamanlanmış iş testi).
9. Büro raporu, seçilen dönem için aylık kırılımda tahakkuk/tahsilat serilerini döndürüyor ve toplamlar tekil kayıtlarla tutuyor.
10. USD hareket girişinde kur alanı zorunlu; rapor TRY karşılığıyla topluyor.

## Faz

**Faz 3.** Önkoşullar: Çekirdek şema (Tenant, Client, Case), Müvekkil CRM (Modül 01),
rol/yetki altyapısı. Faturalama (Modül 09) ile aynı fazda, ondan önce geliştirilir —
Invoice bağı Faz 3 içinde ikinci adımda eklenir.
