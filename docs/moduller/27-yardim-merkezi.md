# Modül 27 — Yardım Merkezi ve Bağlamsal Yardım

Kullanıcı yüzü: `apps/web`.

## Bileşenler

| Parça | Dosya | İş |
|---|---|---|
| Katalog | `apps/web/src/lib/help-catalog.ts` | Tüm modüllerin konu kaydı: özet, bölümler, ilgili sayfa bağlantıları, etiketler |
| Yardım Merkezi | `apps/web/src/app/app/yardim/page.tsx` | Aranabilir kılavuz; `?q=` arama, `?konu=` konu, `#bolum-…` bölüm çapası |
| Bağlamsal düğme | `apps/web/src/components/context-help.tsx` | Üst çubuktaki `?` düğmesi; gezilen yolun konusunu açılır pencerede özetler |

## Kurallar

1. **Tek kaynak:** içerik yalnız katalogda yaşar; sayfalar içerik taşımaz.
2. **Arama:** istemci tarafı, AND semantiği (her terim bir yerde geçmeli); sıralama
   başlık > etiket > özet > gövde ağırlıklı skorla. Uç gerektirmez.
3. **Bölüme tek tık:** ContextHelp düğmesi bölümü `/app/yardim?konu=<id>#<bölüm>` ile
   açar; sayfa çapayı yakalayıp bölüme kaydırır ve kısa süre vurgular.
4. **Bağlamsal eşleşme:** `findHelpTopicForPath` en uzun yol önekiyle konu bulur;
   bulunamazsa Yardım Merkezi aramasına düşer.
5. Yeni modül eklendiğinde kataloğa bir konu kaydı eklenir — başka dosya değişmez.

## Yol haritası (Faz 2+)

- Admin tarafında katalog içeriğinin yönetimi (çeviriler, video, görsel).
- Kullanıcı davranış analitiği (en çok aranan, sonuç bulunamayan sorgular).
