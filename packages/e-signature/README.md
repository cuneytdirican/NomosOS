# @nomosos/e-signature

Sağlayıcı-bağımsız **e-imza adaptör çerçevesi**. Çekirdek (`apps/api/src/contracts`)
yalnız `ISignatureProvider` arayüzünü bilir; hangi NES sağlayıcısının, hangi mobil
imza operatörünün ya da hangi ıslak-imza+tarama akışının kullanıldığını bilmez.

## Bu pakette GERÇEK SAĞLAYICI YOKTUR

NomosOS'un elinde 5070 sayılı Elektronik İmza Kanunu kapsamında çalışan bir
sağlayıcıya ait kimlik bilgisi bulunmamaktadır. Bu boşluk **sahte bir entegrasyonla
doldurulmamıştır**. Tek uygulama `NoopSignatureProvider`'dır ve:

- `providerRef` **üretmez** (sahte süreç kimliği yok),
- `IMZALANDI` durumu **döndürmez**,
- imzalı nüsha **üretmez**,
- her işlem çağrısında anlaşılır bir Türkçe hata döndürür:
  _"E-imza sağlayıcısı yapılandırılmamış. Ayarlar → E-imza bölümünden bir sağlayıcı tanımlayın."_

Çekirdek bu hatayı 503'e çevirir ve sözleşme `IMZAYA_HAZIR` durumunda **kalır**.

## Türkiye bağlamı

`SignatureMethod` dört değer taşır:

| Değer | Anlamı |
|---|---|
| `NES` | Nitelikli elektronik sertifikayla atılan imza. 5070 m.5 uyarınca elle atılan imzayla aynı hukuki sonucu doğurur; kanunun resmî şekle tabi tuttuğu işlemlerde kullanılamaz. |
| `MOBIL_IMZA` | GSM operatörünün SIM tabanlı NES'i. İmzacının **GSM numarası zorunludur**. |
| `E_DEVLET` | e-Devlet Kapısı üzerinden kimlik doğrulamalı onay akışı. |
| `SAGLAYICI_ICI` | Sağlayıcının kendi doğrulama akışı. **NES değildir**; hukuki değeri delil değerlendirmesine bağlıdır ve sistem bunu NES gibi sunmaz. |

Hangi sağlayıcının hangi yöntemi desteklediği **yapılandırmadan** gelir
(`ISignatureProvider.supportedMethods`); paket hiçbir yöntemi varsayılan olarak
kullanılabilir saymaz.

## Arayüz

```ts
interface ISignatureProvider {
  readonly key: string;
  readonly displayName: string;
  readonly supportedMethods: readonly SignatureMethod[];

  createRequest(doc, signers, options): Promise<SignatureRequestResult>;
  getStatus(providerRef): Promise<SignatureStatusResult>;   // yan etkisiz
  cancel(providerRef, reason?): Promise<SignatureStatusResult>;
  downloadSignedDocument(providerRef): Promise<SignedDocumentResult>;
  healthCheck(): Promise<ProviderHealth>;                   // hata fırlatmaz
}
```

## Durum makinesi

```
OLUSTURULDU ──► GONDERILDI ──► IMZALANDI     (nihai)
     │               ├───────► REDDEDILDI    (nihai)
     │               ├───────► SURESI_DOLDU  (nihai)
     └───────────────┴───────► IPTAL         (nihai)
```

Değerler Prisma `SignatureStatus` enum'uyla **birebir aynıdır**; çekirdek
sağlayıcı durumunu çevirmeden kaydeder. Nihai durumdan çıkış yoktur: yeni bir tur
gerekiyorsa yeni `SignatureRequest` açılır, imza kanıt izi bozulmaz.

## İmzacı doğrulama

`validateSigners()` sağlayıcıdan **önce** çalışır ve tüm sorunları tek seferde
toplar: en az bir imzacı, geçerli e-posta, tekrarsız e-posta, mobil imzada GSM,
tekrarsız sıra numarası, sıralı akışta tam sıra listesi, sağlayıcının desteklediği
yöntem.

## Yeni sağlayıcı eklemek

```ts
registerSignatureProvider("nes-x", (config) => new NesXProvider(config));
```

Çekirdekte tek satır değişmez. Sağlayıcı değişimi **açık süreçleri etkilemez**:
her `SignatureRequest` kendi `provider` alanıyla çözülür, güncel ayarla değil.

## Testler

`pnpm --filter @nomosos/e-signature test` — 37 test: arayüz sözleşmesi, Noop
davranışı (sahte imza üretilmediğinin güvencesi), imzacı doğrulama, durum
makinesi geçişleri, kayıt defteri.
