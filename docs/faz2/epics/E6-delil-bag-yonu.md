# E6 — Bilirkişi/Delil Tamamlama: Bağ Yönü

> ⬅ [F2 Yol Haritası](../00-yol-haritasi.md) · **Blok E — Spec borcu**
> Modül spec'i: [14-delil-yonetimi](../../moduller/14-delil-yonetimi.md) · Denetim: Ö-30 (kullanım ayağı)
> İlerleme: **7/7** atomic (%100) · Durum: `✅ BİTTİ` *(KK6'nın `offeredBy` ayağı kapsam dışı bırakıldı — bkz. Kapsam Dışı)*

## Künye

| Alan | Değer |
|---|---|
| Kimlik | `E6` |
| Blok | E — Spec borcu |
| Öncelik | P1 |
| T-shirt boyut | S (15-30p) |
| Atomic puan toplamı | 14 |
| Engelleyen (blocked-by) | `—` |
| Engellediği | `—` |
| Modül spec'i | `docs/moduller/14-delil-yonetimi.md` — KK3 |
| Ürün fazı borcu | Faz 4 delil matrisi "çürüten delil" vaadi |
| Denetim bulguları | Ö-30 (şema ayağı önceden kapatılmıştı; kullanım ayağı açıktı) |
| Dokunulan paketler | `apps/api`, `apps/web` |
| Şema değişikliği | Yok (`ClaimEvidenceLink.linkType` zaten var) |

## Neden

### Problem
Modül 14'ün ana vaadi "karşı tarafın hangi delili hangi iddiamızı çürütüyor" sorusuna cevap vermektir; matris bu ayrımı hesaba katmıyordu.

### Bugün ne oluyor
Şema ayağı ÇÜRÜTÜLDÜ: `EvidenceLinkType` enum'u ve `ClaimEvidenceLink.linkType` alanı var
(`schema.prisma:2262+`). Ancak kullanım ayağı DOĞRULANDI: `linkType` depoda hiçbir yerde
okunmuyor; `evidence-matrix.service.ts` desteksizlik kararını `counted.length === 0`
ile veriyor. Sonuç: yalnızca ÇÜRÜTEN delil bağı olan bir iddia "desteklenmiş" sayılıyor
(Modül 14 KK3 yanlış sonuç).

### Kapanınca ne değişer
Yalnızca CONTRADICTS bağı olan BİZ iddiası `unsupported: true` VE `contradicted: true`
döner; matris hücresi yönü görsel olarak gösterir (✕ / ? / ●); boşluk analizi çürüten
iddiaları `[ÇÜRÜTÜLEN]` satırıyla listeler.

## Kapsam

- Bağ kurma DTO ve hizmetine `linkType` ekle (varsayılan SUPPORTS)
- Matris hesabını yön-farkında yap: destek yalnız SUPPORTS'tan
- Çürütülen iddia bayrağı ve özet sayacı ekle
- Boşluk analizine çürüten satırlarını ekle
- Arayüz bağ kurma penceresine yön seçici ekle
- Matris hücrelerini yönle görselleştir
- Regresyon testleri yaz

## Kapsam Dışı

| Yapılmayacak | Neden | Nereye ait |
|---|---|---|
| `Evidence.offeredBy` alanı + KK6 (422 kapısı) | Şema değişikliği + arayüz alanı gerektirir; bu tur kapsam dışı | `E6` sonraki artış (backlog) |
| `ExpertAssignment` / `EvidenceDocument` modelleri | E6'nın kalan parçası; kullanım ayağından bağımsız | Sonraki tur |

## Veri Modeli Değişikliği

— yok — (alan zaten var; bu epic yalnız KULLANIM ayağını kapatır.)

## Kırılım

### E6-T01 · Yön-farkında hesap ve arayüz  ✅

| Alan | Değer |
|---|---|
| Engelleyen | `—` |
| Engellediği | `—` |
| Puan | 14 |

#### E6-T01-S01 · Sunucu: kalıcılık ve hesap  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E6-T01-S01-A01` | `linkEvidenceSchema`'ya `linkType` enum alanı ekle | `apps/api/src/evidence/evidence.dto.ts` | Geçersiz değer 422; dizi `EvidenceLinkType` ile birebir | 2 | ✅ |
| `E6-T01-S01-A02` | `linkEvidence` hizmeti `linkType` kalıcılaştırsın | `apps/api/src/evidence/evidence.service.ts` | Oluşturulan bağın `linkType` alanı istekle aynı; verilmemişse SUPPORTS | 2 | ✅ |
| `E6-T01-S01-A03` | Matris hesabını yön-farkında yap | `apps/api/src/evidence/evidence-matrix.service.ts` | Sadece CONTRADICTS bağı olan BİZ iddiası hem `unsupported` hem `contradicted` döner | 3 | ✅ |
| `E6-T01-S01-A04` | Boşluk analizine çürüten satırlarını ekle | `apps/api/src/evidence/evidence-ai.service.ts` | `deterministic.contradictedClaims` alanı döner; `[ÇÜRÜTÜLEN]` satırı üretilir | 2 | ✅ |

#### E6-T01-S02 · Arayüz: yön seçici ve görselleştirme  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E6-T01-S02-A01` | Bağ penceresine yön seçici ekle, gücü 1-5 tamsayıya çevir | `apps/web/src/app/app/_components/evidence-tab.tsx` | Gönderilen gövde `linkType` ve tamsayı `strength` taşır | 3 | ✅ |
| `E6-T01-S02-A02` | Matris hücrelerini yönle göster (✕ / ? / ●) | `apps/web/src/app/app/_components/evidence-tab.tsx` | CONTRADICTS hücresi kırmızı ✕; BELIRSIZ gri ?; SUPPORTS güç rengiyle ● | 2 | ✅ |
| `E6-T01-S02-A03` | İstemci rota sözleşmesini düzelt (gerçek uçlara bağla) | `apps/web/src/app/app/_lib/faz4.ts` | `linkClaimEvidence` POST `/claims/:id/evidence/:evidenceId` çağırır; gövdede evidenceId yok | 2 | ✅ |

#### E6-T01-S03 · Testler  ✅

| ID | Atomic görev | Dokunulan dosya(lar) | Kabul kriteri | P | Durum |
|---|---|---|---|---|---|
| `E6-T01-S03-A01` | Matris yön hesabı regresyon testleri yaz | `apps/api/src/evidence/evidence-matrix.test.ts` (yeni) | Sekiz test: yön-farkında desteksizlik, çürütme bayrağı, RED dışlama, karşı taraf muafiyeti, kaynak taahhüdü | 3 | ✅ |

## Kabul Kriterleri

1. Yalnızca CONTRADICTS bağı olan BİZ iddiası `unsupported: true` VE `contradicted: true` döner. (`E6-T01`)
2. `supportingCount` yalnız RED-edilmemiş SUPPORTS bağlarını sayar. (`E6-T01`)
3. BELIRSIZ bağı desteğe KATILMAZ: yalnız BELIRSIZ bağı olan BİZ iddiası `unsupported: true` döner. (`E6-T01`)
4. Matris yanıtı her hücrede `linkType` alanını taşır. (`E6-T01`)
5. KARSI_TARAF iddiasında CONTRADICTS bağı `contradicted` bayrağı üretmez. (`E6-T01`)
6. Geçersiz `linkType` değeri (ör. "DESTEKLER") 422 döner. (`E6-T01`)

## Test Yükümlülüğü

| Ne | Nerede | Neyi korur |
|---|---|---|
| `evidence-matrix.test.ts` | `apps/api/src/evidence/` (yeni) | Yön-farkında hesabın geri dönmesini, kalıcılık taahhüdünü, tanım sözlüğü |

## Riskler ve Açık Sorular

### Riskler
| Risk | Etki | Önlem |
|---|---|---|
| Göç öncesi bağlar SUPPORTS varsayılanıyla kuruldu | Eski veri yönü kaybedilmiş olabilir | `DEFAULT true` şema sözleşmesi: eski bağlar zaten "destekliyor" anlamında kurulmuştu (şema yorumunda belgeli) |

### Açık sorular
| # | Soru | Kime | Karar verilmezse |
|---|---|---|---|
| S1 | `Evidence.offeredBy` alanı hangi turda eklenir? | Ürün | KK6 422 kapısı açık kalır |

## Vaat Kısıtı

> **Bu epic kapanana kadar arayüzde ve tanıtım sitesinde SÖYLENEMEZ:**
>
> - "Delil matrisi karşı tarafın hangi delilinin hangi iddianızı çürüttüğünü gösterir" ifadesi `offeredBy` (KK6) kapanmadan tam söylenemez
>
> **Bunun yerine söylenecek:** "Matris her bağın YÖNÜNÜ (destekler/çürütür) kaydeder ve çürüten bağlar desteğe katılmaz"
>
> **Bugün nerede yazıyor (temizlendi):** `docs/moduller/14-delil-yonetimi.md` KK6 (açık kalır, S1)

## Değişiklik Günlüğü

| Tarih | Ne değişti | Kim |
|---|---|---|
| 31.08.2026 | Oluşturuldu ve tamamlandı (7 atomic, 14 puan) | Aeon (F2 turu) |
