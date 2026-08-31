# NomosOS F2 — Terim Sözlüğü ve Yasak İfadeler

> Bu dosya **bağlayıcıdır.** 37 epic'i farklı ajanlar yazacak; tutarlılık buradan gelir.
> Sözlükte karşılığı olan bir kavram **yalnız o kelimeyle** yazılır.

---

## 1. Terim sözlüğü

| Doğru | Kullanma |
|---|---|
| eşleştirme kodu | pairing code, senkron kodu, bağlantı kodu |
| extension token | eklenti jetonu, uzantı token'ı |
| onay kuyruğu | öneri listesi, bekleyenler, inbox |
| öneri (`BEKLIYOR`) | taslak, aday, tahmin |
| safahat | işlem geçmişi, hareket dökümü, timeline |
| deterministik | kesin, garantili, kurallı |
| kabul kriteri (KK) | başarı ölçütü, DoD maddesi |
| atomic görev | atom, alt-alt görev, mikro görev |
| kaynak-doğru (UYAP) | master data, tek doğru |
| tebligat | bildirim, ihbar (hukuki bağlamda) |
| teslim tarihi (UETS) | okunma tarihi, ulaşma tarihi |
| kiracı / tenant | müşteri, firma, hesap |
| müvekkil | danışan, müşteri |
| dört-göz onayı | çift onay, ikinci imza |
| vaat kısıtı | kısıtlama, uyarı notu |
| **ürün fazı 0-6** | faz 2 (belirsiz — `docs/06`'daki fazları kastediyorsan böyle yaz) |
| **İkinci Faz / F2** | faz 2 (bu programı kastediyorsan böyle yaz) |

### Kimlik yazımı

- Epic: `A1`, `B4`, `C3` — blok harfi + numara
- Task: `B4-T01` · SubTask: `B4-T01-S02` · Atomic: `B4-T01-S02-A05`
- **Alt kimlik epic öneki olmadan asla yazılmaz.** `T01` tek başına yasak — `grep` ile
  bulunamaz ve hangi epic'e ait olduğu belirsizdir.

---

## 2. Yasak ifadeler

`grep` ile denetlenir. Bir epic dosyasında geçerse **iş reddedilir.**

| Yasak | Neden |
|---|---|
| `gerekirse`, `ihtiyaç olursa`, `değerlendirilir` | Görev değil, karardır → "Açık Sorular"a gider |
| `iyileştirilir`, `gözden geçirilir`, `incelenir` | Ölçülemez → atomic görev olamaz |
| `vs.`, `gibi`, `benzeri`, `…` (kapsam ucu açık) | Kapsamı belirsizleştirir |
| `basitçe`, `sadece`, `kolayca` | Tahmini çarpıtır |
| `AI hesaplar`, `AI karar verir`, `AI onaylar` | **Ürün ilkesi ihlali** — AI önerir, avukat onaylar |
| `otomatik gönderilir` (dış hedefe) | İnsan onayı zorunlu |
| `tam otomatik`, `hatasız`, `%100`, `garanti` | Vaat kısıtı ihlali |
| `çalışıyor`, `düzgün`, `sorunsuz` (kabul kriterinde) | Ölçülemez — HTTP kodu / dönen değer / test adı yaz |
| İngilizce teknik terim Türkçesi varken | Depo Türkçe yazılmış |

---

## 3. Ürün ilkeleri — her epic'te geçerli

Bunlar tartışmaya kapalıdır; bir epic bunları deliyorsa **epic yanlıştır.**

1. **AI çıktısı öneridir; avukat onaylar.** Hiçbir AI çıktısı doğrudan `Deadline`, `Task`
   veya `TimelineEvent` kaydına dönüşmez — onay kuyruğundan geçer.
2. **Süre ve para hesapları deterministiktir.** Kural motoru hesaplar, AI yalnız tespit eder.
   LLM'e hesap yaptırmak yasaktır.
3. **Kaynak gösterme zorunludur.** Madde/içtihat numarası uydurulamaz; atıflar kayıt
   üzerinden doğrulanır — LLM'e *"bu karar var mı"* sorulmaz.
4. **KVKK maskeleme hattı atlanamaz.** Dış sağlayıcıya giden her metin `scanPii`'den geçer.
5. **Her sorgu `tenantId` süzgeçlidir.** Üç kimlik alanı (tenant / platform / portal)
   karışmaz; `aud` doğrulanır.
6. **Sahte entegrasyon yazılmaz.** Sağlayıcı yapılandırılmamışsa anlamlı Türkçe hata
   döner; sahte başarı üretilmez.
