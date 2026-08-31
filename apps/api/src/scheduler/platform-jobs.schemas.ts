import { z } from "zod";
import { parseCron } from "./cron-expression";

/**
 * PLATFORM İŞ YÖNETİMİ GİRDİ ŞEMALARI.
 *
 * CRON İFADESİ KAYDETMEDEN ÖNCE ÇÖZÜLÜR. Doğrulamasız kabul edilseydi bozuk
 * bir ifade tabloya yazılır, iş bir daha hiç çalışmaz ve bu ancak günler sonra
 * "hatırlatmalar gelmiyor" şikâyetiyle fark edilirdi. `parseCron` Türkçe 400
 * fırlatır; `superRefine` içinde çağrılıp mesajı alana bağlanır.
 *
 * SÖZDİZİMİ YETMEZ — SIKLIK VE SAAT DE DOĞRULANIR:
 *
 *  1. SIKLIK (denetim bulgusu 18). `* * * * *` sözdizimsel olarak geçerlidir
 *     ve kabul ediliyordu; `deadline-reminder-daily` dakikada bir tüm
 *     kiracıları, üç pencereyi ve 30 günlük geçmiş taramasını çalıştırırdı.
 *     `dedupeKey` çift bildirimi engeller ama dakikada bir `JobRun` satırı ve
 *     sürekli tam tablo taraması üretilirdi. Gece işleri için en az SAATLİK
 *     bir alt sınır aranır: dakika alanı joker ya da adımlı (beş dakikada bir
 *     gibi) olamaz; tek bir sabit dakika değeri olmalıdır.
 *
 * SAAT KISITI KOYULMADI — GEREKÇESİ (denetim bulgusu 5):
 *   Denetim, gün bazlı işler için 00:00–03:00 TR aralığının yasaklanmasını
 *   öneriyordu. O öneri, işlerin "bugün"ü UTC takviminden okuduğu döneme
 *   aitti: cron TR saatinde, gün UTC'de olunca iki takvim o aralıkta ayrışıyor
 *   ve pencere bir gün kayıyordu. KÖK NEDEN DÜZELTİLDİ — bütün gün bazlı işler
 *   artık `trCalendarDay()` kullanır (bkz. common/dates.ts) — dolayısıyla
 *   02:00'de çalışan bir iş de 07:00'deki kadar doğrudur.
 *
 *   Saat aralığını yine de yasaklamak, sistemin KENDİ varsayılanlarını
 *   reddetmesi anlamına gelirdi: `credit-period-renewal-daily` "0 1 * * *",
 *   `usage-snapshot-daily` "0 2 * * *" ile gelir ve bu saatler bilinçli
 *   seçilmiştir (gece yükü). Operatörün varsayılanı panelden yeniden
 *   kaydedememesi, gerçek bir sorunu çözmeyen ama günlük operasyonu bozan bir
 *   kısıt olurdu. Kayma riski artık kodda yoktur; kısıt da yoktur.
 */

/** Dakika alanı tek bir sabit değer mi (yani iş saatte en çok bir kez mi çalışır)? */
function isFixedMinute(field: string): boolean {
  return /^\d{1,2}$/.test(field.trim());
}
export const jobPatchSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    cronExpression: z
      .string()
      .trim()
      .min(9, "Cron ifadesi 5 alanlı olmalıdır, örn. \"0 7 * * *\".")
      .max(120, "Cron ifadesi 120 karakteri aşamaz.")
      .optional(),
  })
  .refine((v) => v.isEnabled !== undefined || v.cronExpression !== undefined, {
    message: "En az bir alan gönderilmelidir: isEnabled ya da cronExpression.",
  })
  .superRefine((value, ctx) => {
    if (value.cronExpression === undefined) return;
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cronExpression"], message });

    let spec: ReturnType<typeof parseCron>;
    try {
      spec = parseCron(value.cronExpression);
    } catch (err) {
      const response = (err as { getResponse?: () => unknown }).getResponse?.();
      const message =
        typeof response === "string"
          ? response
          : ((response as { message?: string })?.message ?? "Cron ifadesi geçersiz.");
      add(message);
      return;
    }

    const fields = spec.expression.split(" ");
    if (!isFixedMinute(fields[0])) {
      add(
        'Dakika alanı tek bir sabit değer olmalıdır (örn. "0"). Bu işler tüm kiracıları ve ' +
          "geniş tarih pencerelerini tarar; saatte birden çok kez çalıştırmak sürekli tam tablo " +
          "taraması ve dakika başına bir koşu kaydı üretir. En sık SAATLİK çalıştırılabilir.",
      );
    }
  });
export type JobPatchInput = z.infer<typeof jobPatchSchema>;

/**
 * Elle tetikleme gövdesi.
 *
 * `targetDate` YALNIZ GÜN BAZLI İŞLER için anlamlıdır (kullanım fotoğrafı,
 * süre/duruşma hatırlatmaları). Geçmişe dönük bir günün fotoğrafını almak
 * meşru bir operasyon ihtiyacıdır (kaçırılmış gece işini tamamlamak).
 * Kredi dönemi yenileme bu alanı BİLİNÇLİ OLARAK yok sayar — geçmiş bir
 * tarihe göre kota sıfırlamak parasal bir işlemi geriye almak olurdu.
 */
export const jobRunSchema = z.object({
  targetDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Hedef gün YYYY-MM-DD biçiminde olmalıdır.")
    .optional(),
});
export type JobRunInput = z.infer<typeof jobRunSchema>;
