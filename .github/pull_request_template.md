## Ne değişti?

<!-- Bir iki cümle: hangi sorun, hangi çözüm. İlgili modül/doküman bağlantısı. -->

İlgili konu / doküman:

---

## Kontrol listesi

- [ ] **Testler geçti** — `pnpm build`, `pnpm typecheck` ve `pnpm -r test` yerelde temiz.
- [ ] **Migration** — Prisma şeması değiştiyse migration eklendi (`pnpm db:migrate`), zaman damgası mevcut son migration'dan **sonra**, yayımlanmış hiçbir migration düzenlenmedi ve `docs/02-veri-modeli.md` güncellendi.
- [ ] **Tenant izolasyonu** — yeni sorgu/uç `tenantId` ile sınırlandı; hiçbir yol başka kiracının verisine erişemiyor (kiracı `/api/v1` ile platform `/api/admin/v1` sınırı korunuyor).
- [ ] **AI çıktısı "öneri" statüsünde** — model üretimi kullanıcıya öneri/taslak olarak sunuluyor, otomatik olarak kesin hukuki sonuç veya işlem üretmiyor; süre/hesap kritik değerler `legal-core` üzerinden doğrulanıyor.
- [ ] **KVKK maskeleme hattı** — dış (büro dışı) sağlayıcıya giden metin maskeleme hattından geçiyor; `SADECE_YEREL` politikasındaki kiracı için dış çağrı yolu hâlâ kapalı.
- [ ] **Sır sızıntısı yok** — anahtar/parola/token commit edilmedi; yeni ayarlar yalnızca `.env.example`'a **boş veya yer tutucu** değerle eklendi.

---

## Etki ve geri alma

- Kırıcı değişiklik: <!-- yok / var → nedir, tüketiciler nasıl güncellenir -->
- Yeni ortam değişkeni: <!-- yok / var → adı, varsayılanı, .env.example'a eklendi mi -->
- Geri alma planı: <!-- revert yeterli mi, migration geri alınabilir mi -->
