# AI KATMANI AUDIT RAPORU — 02.09.2026

Kapsam: packages/legal-ai (promptlar, guard'lar, şemalar) + apps/api AI modülleri
(assistant, ai, simulation, caselaw, poa, expert, evidence, reports, petitions,
pipeline) + arayüz AI bileşenleri.

## Yöntem

Değişmezler makine tarandı (her LLM çağrı noktası için): PII maskeleme, guard
doğrulaması, kaynak zorunluluğu (findingPaths), kredi tahakkuk/iade, maxTokens,
kullanım kaydı; ardından arayüz-sunucu sözleşmeleri birebir karşılaştırıldı.

## Değişmezler — SAĞLAM

| Değişmez | Durum |
|---|---|
| KVKK maskeleme (scanPii/maskTerms) tüm 4 çağrı yolunda | ✅ |
| guardOutput şema doğrulaması (runTask, caselaw, agent-runner) | ✅ |
| Guard reddinde kredi iadesi (İ-13) | ✅ |
| Kaynak zorunluluğu: simulation 6 mod, POA, evidence eleme uyguluyor | ✅ |
| Tarafsızlık kuralı çekirdek promptta (kural 2) | ✅ |
| Alıntı doğrulama kapısı (KARSI_DILEKCE_ZAYIFLIK, Ö-20) | ✅ |
| Teyit Ajanı VERIFIED⇒deterministik eşleşme (fail-closed) | ✅ |

## Bulunan hatalar ve düzeltmeler

### A1 — NORMALİZASYON ÖLÜ KODDU (kritik)

`llm-normalize.ts` yazılmış ama `guardOutput`'a bağlanmamıştı. Üç saha hatası
buna takılıyordu:

1. **İçtihat arama:** model "01.01.2023" yazdı, şema YYYY-AA-GG istedi → TÜM
   arama planı reddediliyordu.
2. **Dilekçe taslağı:** MEVZUAT atfında model `source: "TCK"` yazdı, enum yalnız
   mahkeme kabul etti → TASLAK TAMAMEN DÜŞÜYORDU.
3. Tarih+saat biçimleri ("31.12.2024T00:00:00.000Z") onarılmıyordu.

**Düzeltme:** `guardOutput` artık şemadan ÖNCE `normalizeLlmOutput` çalıştırır:
GG.AA.YYYY(+saat) → YYYY-AA-GG; yalnız-yıl/ay DÜŞÜRÜLÜR (tahmin edilmez);
atıf source kanunsa `statuteRef`'e taşınır; "Yargıtay 9. HD" →
source=YARGITAY+chamber. Sözleşme testleri: ai-audit-contract.test.ts (11 test).

### A2 — SİMÜLASYON BULGULARI HİÇ GÖRÜNMÜYORDU (kritik)

İki ayrı hata bir arada:

1. `list()` ucu `outputJson` döndürmüyordu → koşu yenilendiğinde (load) ekrandaki
   bulgular KAYBOLUYORDU; liste satırı hiçbir zaman bulgu gösteremiyordu.
2. Sunucu çıktıyı `{result: {...}}` sarmalayıcısıyla saklıyor, arayüz en üst
   düzeyde arıyordu; `firstArray` yalnız en üst dizileri tarıyordu →
   KARSI_TARAF_AVUKATI argümanları ve HAKIM_GOZU eğilimi ASLA görünmüyordu.

**Düzeltme:** liste `output` (parse edilmiş) taşır; arayüz `simulationResultData`
sarmalayıcıyı çözer, `firstArray` iç içe arar. GLM 5.3'ün "boş koşu" yanıtı
dürüst davranıştı (kaynak yoksa uydurma argüman ÜRETMEZ) — modelin açıklaması
(`overallAssessment`) artık boş koşuda gösterilir + "belge yükleyip yeniden
deneyin" yönlendirmesi eklendi.

### A3 — ASİSTAN BOŞ BALONLAR (kritik)

`/ai/chat` yanıtı metni `content` alanında taşıyor; asistan sayfası `answer`
okuyordu → her yanıt BOŞ görünüyor. Ayrıca öneri şeridi (F2-Ö-12) eksikti.
**Düzeltme:** sayfa `content` okur; her yanıtta "öneridir" şeridi görünür.

### A4 — RAPOR YORUMU GEÇİŞSİZ REDDEDİLİYORDU (yüksek)

Rakam yasağı promptta vardı ama model sıra sayısı ("3 öneri") ve kanun/madde
numarası ("m. 25") yazdığında uydurma-rakam kapısı tüm yorumu 422'ye düşürüyordu.
**Düzeltme:** prompt kuralı netleştirildi — sıra sayısı ve madde numarası da
açıkça yasaklandı ("üç vurgu" gibi yazıyla da değil).

## Doğrulama

- ai-audit-contract.test.ts: 11 test (normalizasyon, sarmalayıcı, liste sözleşmesi)
- Tüm paketler yeşil; lint 0 uyarı
- Canlı: kullanıcının GLM 5.3 koşusu artık açıklamasıyla görüntüleniyor; içtihat
  AI araması `dateFrom: "2023-01-01"` döndürüyor

## Sonuç

GLM 5.3 destekleniyor (OpenAI-uyumlu uç) ve ÇALIŞIYORDU — hata modelde değil,
görüntüleme zincirindeydi. AI katmanındaki dört gerçek hata da arayüz-sunucu
sözleşme kopukluklarıydı; guard/kredi/maskeleme değişmezleri sapmadı.
