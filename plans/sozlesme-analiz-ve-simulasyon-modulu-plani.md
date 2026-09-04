# Sözleşme Analizi ve Simülasyon Modülü — Tasarım ve Uygulama Planı

> Temel: mevcut `contracts` modülü (Contract + Clause + tek taraflı AI analizi + sekmeli
> arayüz) ÜZERİNE genişletme. Sıfırdan yeni modül değil — mevcut sözleşme varlığı,
> tenant izolasyonu, KVKK kapısı, kredi ücretlendirme ve AI altyapısı (legal-ai
> çekirdek prompt sözleşmesi) yeniden kullanılır.

## Veri modeli (Prisma eklentileri)

```
ContractAnalysisRun        — her analiz koşusu (kalıcı; SimulationRun deseni)
  id, tenantId, contractId, versionId, mode: "ILK" | "REVIZYON" | "NIHAI"
  ourSideJson      — bizim taraf perspektifi: [{ rank, title, body, severity, refs }]
  otherSideJson    — karşı taraf perspektifi (aynı şema)
  overallRiskScore /100  — şerhlerin ağırlıklı bileşimi (sunucu hesaplar)
  model, durationMs, createdBy, createdAt
ContractClauseAnnotation   — ŞERH (tek gerçek kaynak: AI önerir, avukat görür)
  id, runId, clauseId, severity: "KRITIK" | "ORTA" | "DUSUK"
  explanation (gerekçe — ZORUNLU), quote (madde alıntısı), proposedFix?
  status: "ACIK" | "KAPALI" | "SUPERSEDED" (revizyonda kapanan şerh)
ContractVersion            — sürüm zinciri: id, contractId, seq, documentId (MinIO), uploadedBy, note
ContractVersionDiff        — otomatik fark: versionA, versionB, added/removed/changedJson (sunucuda üretir)
ContractEvent              — uçtan uca süreç akışı (append-only): YUKLENDI, GONDERILDI,
  REVIZYON_ALINDI, ANALIZ, SHERH_KAPANDI, MUVEKKIL_BILGILENDIRILDI, IMZALANDI, actorJson, createdAt
ContractNotifySetting      — müvekkil kritik şerh bildirimi: MANUAL | OTOMATIK (varsayılan MANUAL)
```

Kurallar: para/skor disiplinine uygun olarak `overallRiskScore` SUNUCUDA hesaplanır
(KRITIK=10, ORTA=5, DUSUK=2 ağırlıklı toplam, 100'e normalize). Şerhler künye
gibi DETERMİNİSTİK kalır: AI önerir, kayıt avukat komutuyla yazılır (uydurma
analizi yasak).

## Ekran akışı (web, /app/sozlesmeler)

1. **Liste** — sözleşme kartları: başlık, müvekkil (veya "ilişkisiz"), sürüm sayısı,
   genel risk skoru bandı (yeşil/sarı/kırmızı), durum (TASLAK/GONDERILDI/REVIZYONDA/IMZALANDI)
2. **Detay** — sekmeler:
   - **Genel bakış**: akış zaman çizelgesi (ContractEvent, canlı — 30 sn yoklama),
     genel risk skoru + dağılım, en son analiz özeti (her iki taraf ayrı panel)
   - **Metin + Şerhler**: sözleşme metni maddeler halinde; şerhli madde kenarlığı
     risk rengine göre (kırmızı/turuncu/sarı); maddeye tıklayınca şerh kartı:
     gerekçe + önerilen düzeltme + durum
   - **Versiyonlar**: sürüm listesi; iki sürüm seç → **anında diff görünümü**
     (eklenen yeşil / silinen kırmızı / değişen satır bazlı; sunucuda üretir)
   - **Analizler**: koşu arşivi (tüm geçmiş — öneri: arşivleme), her koşu iki
     perspektifli rapor
3. **İşlemler**: "Yeni Sürüm Yükle" (revizyon → otomatik iki taraflı analiz + eski
   şerhler kapanır mı kontrolü), "Nihai Analiz" (imza öncesi; çözülmemiş şerhler
   renk kodlu liste), "Müvekkile Bildir" (kritik şerhler PDF/özet — mevcut rapor
   üreticiyi kullanır)

## Mimari kararlar ve gerekçeler

- **Mevcut modülü genişletme**: Contract/Clause varlığı, MinIO belge altyapısı, kredi
  ücretlendirmesi, KVKK 409 kapısı, prompt sözleşme testleri zaten var — yeniden
  yazmak risk.
- **Şerhler AI tarafından yazılır ama AVUKAT onayıyla kalıcılaşır**: uydurma atıf
  yasağıyla aynı disiplin; şerh gerekçesi ZORUNLU.
- **İki taraf perspektifi tek koşuda, iki ayrı çıktıda** (ourSide/otherSide): tek
  promptta karışması sıralama/önyargı riski; şema ayrımı test edilebilir kalır.
- **Diff SUNUCUDA**: metinler istemciye tam gelmeden karşılaştırma tutarlı olur,
  denetim izine yazılır (kim, hangi iki sürüm).
- **Canlı izleme yoklama ile**: mevcut ajanda/mesaj altyapısındaki yoklama deseni;
  WebSocket eklemek bu ölçekte gereksiz karmaşıklık.
- **Bildirim**: kritik değişiklikte avukata otomatik bildirim mevcut Notification
  altyapısından; müvekkil bildirimi portal yayın mekanizmasıyla (onay akışı) +
  PDF özet.
- **İzinler**: sözleşme OPERASYON rolleri (STAJYER hariç); nihai analiz + müvekkil
  bildirimi HUKUKI; otomatik bildirim açma PARTNER+.

## Uygulama sırası

1. Veri modeli + migration + seed örnek sözleşme (2 sürüm)
2. API: analiz servisi (iki taraf) + şerh + diff + olay + skor (birim testli)
3. Web: liste + detay sekmeleri (şerh görünümü, versiyon diff)
4. Bildirimler (avukat otomatik; müvekkil portal + PDF)
5. Canlı test: yükle → analiz → revizyon → diff → nihai analiz → bildirim zinciri
