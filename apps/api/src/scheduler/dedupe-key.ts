/**
 * BİLDİRİM İDEMPOTENTLİK ANAHTARLARI (`NotificationOutbox.dedupeKey`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * İDEMPOTENTLİK VERİTABANINDADIR, KODDA DEĞİL.
 * `@@unique([tenantId, dedupeKey])` tek gerçek korumadır: iki süreç aynı anda
 * aynı bildirimi yazmaya kalksa bile ikincisi P2002 alır ve ATLANIR. Buradaki
 * fonksiyonlar yalnız o anahtarı ÜRETİR; "önce SELECT sonra INSERT" gibi bir
 * kontrol yarış koşuluna açıktır ve bilinçli olarak KULLANILMAZ.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ANAHTAR BİÇİMİ — `<TÜR>:<kaynakId>:<pencere>:<alıcıId>`
 *
 * ALICI NEDEN ANAHTARIN PARÇASI:
 *   Bir olay birden çok kişiye gidebilir (sahipsiz bir sürede büro yöneticileri
 *   uyarılır). Alıcı anahtarda olmasaydı ikinci alıcının kaydı, birincinin
 *   anahtarıyla çakışıp SESSİZCE DÜŞERDİ; yani bildirim "tek kişilik" olurdu.
 *   Ayrıca sahibi değişen bir kayıt için de anahtar doğal olarak değişir.
 *
 * PENCERE NEDEN ANAHTARIN PARÇASI:
 *   Aynı süre için 7/3/1 gün kala AYRI bildirim gider; pencere olmasaydı
 *   yalnız ilki yazılır, kalan ikisi çakışırdı.
 *
 * TARİH NEDEN GÜN BAZLI (YYYY-MM-DD):
 *   Anahtar "gün" çözünürlüğündedir; iş aynı gün on kez tetiklense de anahtar
 *   değişmez, dolayısıyla bildirim bir kez yazılır. Saat bileşeni girseydi
 *   idempotentlik tamamen kaybolurdu.
 */

import type { NotificationKind } from "@nomosos/db";

/** Süre hatırlatma pencereleri — kalan gün sayısı. */
export type DeadlineWindow = 7 | 3 | 1;

/** UTC gün etiketi (YYYY-MM-DD). Saat bileşeni bilinçli olarak atılır. */
export function dayTag(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function build(kind: NotificationKind, resourceId: string, window: string, userId: string): string {
  return `${kind}:${resourceId}:${window}:${userId}`;
}

/**
 * "SURE_YAKLASIYOR:<deadlineId>:<YYYY-MM-DD>:3g:<userId>"
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ANAHTAR VADE GÜNÜNÜ TAŞIR (denetim bulgusu 4).                           ║
 * ║                                                                          ║
 * ║ Duruşma anahtarında tarihin NEDEN bulunduğu bu dosyada zaten yazılıydı   ║
 * ║ ("duruşma ertelenirse yeni tarih yeni anahtar üretir"), ama aynı akıl    ║
 * ║ yürütme süreye uygulanmamıştı. `Deadline.dueDate` DEĞİŞTİRİLEBİLİR bir   ║
 * ║ alandır — MANUEL kaynaklı sürelerde vade güncellemesine izin verilir ve  ║
 * ║ büroda elle girilen sürelerin çoğunluğu budur.                           ║
 * ║                                                                          ║
 * ║ Tarihsiz anahtarla yaşanan somut arıza: 15 Eylül vadeli süre için 8      ║
 * ║ Eylül'de "7 gün kaldı" gider. Ertesi gün tebliğ tarihi düzeltilir, vade  ║
 * ║ 30 Ekim'e çekilir. 23 Ekim'de iş çalışır, anahtar ZATEN YAZILIDIR,       ║
 * ║ `enqueue` P2002 alır ve "atlandı" sayar. Yeni tarih için 7/3/1           ║
 * ║ hatırlatmalarının HİÇBİRİ gitmez — ve bu panelde hata olarak da          ║
 * ║ görünmez: `skipped` sayısı "sistem doğru çalışıyor" diye okunur.         ║
 * ║                                                                          ║
 * ║ İDEMPOTENTLİK BOZULMAZ: vade değişmediği sürece anahtar da değişmez, iş  ║
 * ║ aynı gün on kez tetiklense de bildirim bir kez yazılır.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export function deadlineReminderKey(
  deadlineId: string,
  window: DeadlineWindow,
  userId: string,
  dueDate: Date
): string {
  return build("SURE_YAKLASIYOR", deadlineId, `${dayTag(dueDate)}:${window}g`, userId);
}

/**
 * "SURE_GECTI:<deadlineId>:<YYYY-MM-DD>:ilk:<userId>" — VADE BAŞINA TEK SEFERLİK.
 *
 * İŞİN ÇALIŞTIĞI GÜN ANAHTARDA YOKTUR ve bu bilinçlidir: kaçırılmış bir süre
 * kapatılana kadar her sabah yeniden bildirim üretseydi, kullanıcı bildirimleri
 * okumayı bırakırdı ("alarm yorgunluğu") ve asıl taze uyarılar da gözden
 * kaçardı. Kaçırılmış süre, süre listesinde kalıcı olarak görünür; bildirim
 * yalnız OLAYIN İLK FARK EDİLİŞİNİ taşır.
 *
 * VADE GÜNÜ ise anahtardadır (denetim bulgusu 4). Vade düzeltildiğinde ortada
 * BAŞKA bir olay vardır: yeni tarih de geçmişse kullanıcı yeniden uyarılmalıdır.
 * Tarihsiz anahtar, düzeltilmiş vadeyi sonsuza kadar susturuyordu.
 */
export function deadlineOverdueKey(deadlineId: string, userId: string, dueDate: Date): string {
  return build("SURE_GECTI", deadlineId, `${dayTag(dueDate)}:ilk`, userId);
}

/**
 * "DURUSMA_YARIN:<hearingId>:<YYYY-MM-DD>:<userId>"
 *
 * Pencere olarak DURUŞMANIN GÜNÜ kullanılır, işin çalıştığı gün değil.
 * Duruşma ertelenirse yeni tarih yeni anahtar üretir ve avukat yeni tarih için
 * yeniden uyarılır — doğru davranış budur.
 */
export function hearingReminderKey(hearingId: string, hearingDay: Date, userId: string): string {
  return build("DURUSMA_YARIN", hearingId, dayTag(hearingDay), userId);
}

/**
 * "KREDI_AZALDI:<tenantId>:<dönem başlangıcı YYYY-MM-DD>:<userId>"
 * — denetim bulgusu Ö-29.
 *
 * PENCERE OLARAK **KREDİ DÖNEMİ** KULLANILIR, işin çalıştığı gün değil.
 * Sonuç: bir büroya bir dönemde EN FAZLA BİR "kredi azaldı" uyarısı gider.
 * İşin saatte bir koşması bu yüzden güvenlidir; ikinci koşu P2002 alır ve
 * `atlandi` sayılır.
 *
 * DÖNEM YENİLENDİĞİNDE ANAHTAR DA YENİLENİR: `CreditWallet.periodStart`
 * ileri gider, dolayısıyla yeni dönemde eşik yeniden aşılırsa büro yeniden
 * uyarılır. Tarihsiz bir anahtar, bir kez uyarılan büroyu SONSUZA DEK
 * susturur ve ikinci ayın 402'si yine sürpriz olurdu.
 *
 * ALICI ANAHTARDADIR — bu dosyanın başındaki kuralla aynı gerekçe: uyarı büro
 * yönetimindeki HERKESE (ADMIN/PARTNER) gider; alıcı anahtarda olmasaydı
 * yalnız ilk yöneticinin kaydı yazılır, kalanlar sessizce düşerdi.
 * `tenantId` anahtarda AYRICA taşınır (kısıt zaten `[tenantId, dedupeKey]`
 * çiftindedir): anahtarın kendisi tek başına okunduğunda hangi büroya ait
 * olduğu görülebilsin diye.
 */
export function creditLowKey(tenantId: string, periodStart: Date, userId: string): string {
  return `KREDI_AZALDI:${tenantId}:${dayTag(periodStart)}:${userId}`;
}

/**
 * HEPO (Modül 28) — müvekkil yükümlülüğü vade hatırlatmaları.
 *
 * Anahtar biçimi süreyle AYNI sözleşmeyi izler; kaynak kimliği `HEPO:<satırId>`
 * ad alanıyla taşınır ki Deadline kimlikleriyle ÇAKIŞMASIN. Bildirim türü
 * bilinçli olarak SURE_YAKLASIYOR/SURE_GECTI'dir: HEPO vadesi hukuken bir
 * süredir, arayüzde de süre bildirimi olarak görünür (ayrı tür açmak tür
 * etiketi, filtre ve arayüz eşlemesi gerektirirdi; kazanım yoktu).
 */
export type HepoWindow = 30 | 7 | 1;

export function hepoReminderKey(
  rowId: string,
  window: HepoWindow,
  userId: string,
  dueDate: Date
): string {
  return build("SURE_YAKLASIYOR", `HEPO:${rowId}`, `${dayTag(dueDate)}:${window}g`, userId);
}

export function hepoOverdueKey(rowId: string, userId: string, dueDate: Date): string {
  return build("SURE_GECTI", `HEPO:${rowId}`, `${dayTag(dueDate)}:ilk`, userId);
}
