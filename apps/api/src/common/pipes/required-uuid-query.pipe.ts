import { BadRequestException, ParseUUIDPipe } from "@nestjs/common";

/**
 * ZORUNLU UUID SORGU PARAMETRESİ — anlaşılır Türkçe hata ile.
 *
 * NEDEN AYRI BİR YARDIMCI: çıplak `@Query("clientId", ParseUUIDPipe)` kullanımı
 * parametre HİÇ GÖNDERİLMEDİĞİNDE (yani `undefined` olduğunda) kütüphanenin iç
 * mesajını istemciye aynen döker:
 *
 *     { "message": "The value passed as UUID is not a string", "statusCode": 400 }
 *
 * Nedeni Nest'in `ParseUUIDPipe.isUUID()` metodudur: değer string değilse
 * `exceptionFactory`'yi bu İngilizce metinle çağırır ve normal "Validation
 * failed (uuid is expected)" dalına hiç ulaşılmaz. Sonuç, baştan sona Türkçe
 * bir üründe İngilizce ve ne yapılacağını söylemeyen bir hata olur; üstelik
 * "eksik parametre" ile "bozuk parametre" ayrımı da kaybolur.
 *
 * Bu pipe iki dalı da tek ve açık bir Türkçe mesajta birleştirir; hangi
 * parametrenin beklendiğini ADIYLA söyler, böylece arayüz geliştiricisi hatayı
 * tarayıcı konsolunda okuyup düzeltebilir.
 *
 * Kullanım:
 *   `@Query("clientId", RequiredUuidQuery("clientId", "Müvekkil"))`
 */
export function RequiredUuidQuery(paramName: string, label: string): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new BadRequestException(
        `${label} seçilmeden bu liste getirilemez: "${paramName}" sorgu parametresi ` +
          "zorunludur ve geçerli bir kimlik (UUID) olmalıdır."
      ),
  });
}
