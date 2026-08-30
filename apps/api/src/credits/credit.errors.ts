/**
 * KREDİ KAPISININ YANIT SÖZLEŞMELERİ.
 *
 * İki hata da LLM'e istek GİTMEDEN üretilir (kabul kriterleri 1 ve 7).
 * Gövdeler `AllExceptionsFilter` tarafından olduğu gibi geçirilir; alan adları
 * Türkçedir çünkü doğrudan arayüzdeki açıklayıcı karta bağlanır.
 */

import { HttpException, HttpStatus } from "@nestjs/common";
import { MAX_CREDITS_PER_REQUEST } from "./credit-plans";

export interface CreditPackageOffer {
  key: string;
  credits: number;
  price: string;
  currency: string;
}

export interface InsufficientCreditsBody {
  statusCode: 402;
  message: string;
  kalanKredi: number;
  gerekenKredi: number;
  paketler: CreditPackageOffer[];
  byoLlmOnerisi: true;
  /** Hangi görev için reddedildi — arayüz doğru düğmeyi işaretler. */
  taskType: string;
  /** Kredi dışı hiçbir şey durmaz; kart bunu açıkça yazar. */
  engellenmeyenler: string;
}

/**
 * 402 Payment Required — bakiye yetersiz.
 *
 * ENGELLEYİCİ DEĞİL AÇIKLAYICI: gövde, kullanıcının ne yapabileceğini
 * (paket almak / kendi anahtarını bağlamak) ve neyin ETKİLENMEDİĞİNİ taşır.
 * Dosya, duruşma, süre, görev ve belge akışları bu hatadan etkilenmez.
 */
export function insufficientCredits(input: {
  taskType: string;
  available: number;
  required: number;
  packages: CreditPackageOffer[];
}): HttpException {
  const body: InsufficientCreditsBody = {
    statusCode: 402,
    message:
      `Bu işlem ${input.required} kredi gerektiriyor; kullanılabilir bakiyeniz ${input.available} kredi. ` +
      "Yapay zekâ işlemi başlatılmadı — sağlayıcıya hiçbir istek gitmedi. " +
      "Ek kredi paketi alabilir ya da kendi AI anahtarınızı bağlayarak limitleri tamamen kaldırabilirsiniz.",
    kalanKredi: input.available,
    gerekenKredi: input.required,
    paketler: input.packages,
    byoLlmOnerisi: true,
    taskType: input.taskType,
    engellenmeyenler:
      "Dosya ve müvekkil yönetimi, duruşma ve süre takibi, süre hesabı, görev yönetimi, " +
      "belge yükleme ve sınıflandırma, atıf doğrulama ve dışa aktarım çalışmaya devam eder.",
  };
  return new HttpException(body, HttpStatus.PAYMENT_REQUIRED);
}

export interface RequestTooLargeBody {
  statusCode: 400;
  message: string;
  gerekenKredi: number;
  istekBasinaTavan: number;
  taskType: string;
  oneri: string;
}

/**
 * 400 — tek istek 50 kredi tavanını aşıyor.
 *
 * Tek bir dev belgenin aylık bütçeyi yakmasını engelleyen kural budur
 * (Kullanıcı Hikâyesi 9). Reddetmek yetmez; kullanıcıya kapsamı DARALTMA
 * yolu gösterilir.
 */
export function requestTooLarge(input: {
  taskType: string;
  required: number;
}): HttpException {
  const body: RequestTooLargeBody = {
    statusCode: 400,
    message:
      `Bu istek tek başına ${input.required} kredi tutuyor; istek başına üst sınır ` +
      `${MAX_CREDITS_PER_REQUEST} kredidir. İşlem başlatılmadı.`,
    gerekenKredi: input.required,
    istekBasinaTavan: MAX_CREDITS_PER_REQUEST,
    taskType: input.taskType,
    oneri:
      "Gönderdiğiniz metin çok uzun. Belgenin yalnızca ilgili bölümlerini seçerek ya da " +
      "soruyu daraltarak tekrar deneyin. Bu sınır, tek bir işlemin aylık bütçenizi " +
      "tüketmesini engellemek içindir.",
  };
  return new HttpException(body, HttpStatus.BAD_REQUEST);
}
