/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ KREDİ EŞİK KARARI — denetim bulgusu Ö-29                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * SORUN: `NotificationKind.KREDI_AZALDI` şemada ve `KIND_LABELS` içinde
 * tanımlıydı; deponun TAMAMINDA hiçbir kod bu bildirimi ÜRETMİYORDU. Modül 26
 * §Limit Davranışı tablosu "%80 → panelde uyarı şeridi + büro sahibine e-posta"
 * diyor. Uygulanmadığı için büronun kredi hakkındaki İLK sinyali, akışın
 * ortasında gelen 402 oluyordu — Kullanıcı hikâyesi 1'in ("sürpriz
 * yaşamayayım") tam tersi.
 *
 * BU DOSYA SAFTIR: veritabanı okumaz, `new Date()` çağırmaz, bildirim yazmaz.
 * Yalnız "bu cüzdan uyarılmalı mı" sorusunu yanıtlar; yazma işi jobun.
 *
 * ┌─ ÖLÇÜ NEDEN "KALAN / DÖNEM TAHSİSİ" ───────────────────────────────────┐
 * │ Naif ölçü `includedConsumed / includedCredits` olurdu. Yanlış olurdu:   │
 * │ dahil kotasını bitirip 5.000 kredi SATIN ALMIŞ bir büro %100 tüketimde  │
 * │ görünür ve "kredin azaldı" uyarısı alırdı — oysa kesesi doludur.        │
 * │ `purchasedCredits` DEVREDER ve tüketim sırası "önce dahil kota"dır      │
 * │ (schema.prisma § CreditWallet); dolayısıyla gerçekten anlamlı büyüklük  │
 * │ KULLANILABİLİR TOPLAM BAKİYEDİR:                                        │
 * │                                                                        │
 * │   kalan = max(0, includedCredits − includedConsumed) + purchasedCredits │
 * │   uyar  ⇔ kalan ≤ (1 − eşik) × includedCredits                          │
 * │                                                                        │
 * │ %80 eşiğinde bu, "dönem tahsisinin %20'sinden azı kaldı" demektir.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * REZERVE KREDİ (`reservedCredits`) HESABA KATILMAZ: uçuştaki çağrılar için
 * geçici olarak tutulur ve `settle`/`release` ile birkaç dakika içinde çözülür.
 * Katılsaydı, yoğun bir anda geçici bir düşüş kalıcı bir uyarı doğurur ve o
 * uyarı — anahtar dönem bazlı olduğu için — dönem boyunca geri alınamazdı.
 *
 * DAHİL KOTASI 0 OLAN CÜZDAN UYARILMAZ: BYO-LLM kiracısında kredi kapısı hiç
 * devreye girmez (`billing-mode.service.ts`); orada "kredin azaldı" demek
 * anlamsız bir alarmdır. Sıfıra bölme de bu kontrolle elenir.
 */

/** Eşik: dönem tahsisinin bu oranı tüketildiğinde uyarı üretilir (Modül 26). */
export const CREDIT_LOW_WARNING_RATIO = 0.8;

/** Kararın ihtiyaç duyduğu cüzdan alanları — Prisma modelinin alt kümesi. */
export interface CreditWalletSnapshot {
  includedCredits: number;
  includedConsumed: number;
  purchasedCredits: number;
}

export interface CreditWarningDecision {
  warn: boolean;
  /** Kalan kullanılabilir kredi (dahil kotadan kalan + satın alınan). */
  kalan: number;
  /** Dönem tahsisi. */
  tahsis: number;
  /** Tüketim oranı (0..1). Satın alınan bakiye kalanı büyüttüğü için 0'a da düşebilir. */
  tuketimOrani: number;
  /** Uyarı üretilmediyse nedeni — panelde ve testte okunabilir olsun diye. */
  gerekce: string;
}

export function evaluateCreditWarning(
  wallet: CreditWalletSnapshot,
  ratio: number = CREDIT_LOW_WARNING_RATIO,
): CreditWarningDecision {
  const tahsis = wallet.includedCredits;
  const kalan = Math.max(0, tahsis - wallet.includedConsumed) + wallet.purchasedCredits;

  if (tahsis <= 0) {
    return {
      warn: false,
      kalan,
      tahsis,
      tuketimOrani: 0,
      gerekce: "Dönem tahsisi yok (BYO-LLM ya da kotasız plan) — kredi uyarısı anlamsız.",
    };
  }

  const tuketimOrani = Math.min(1, Math.max(0, 1 - kalan / tahsis));

  /**
   * KARŞILAŞTIRMA "TÜKETİLEN ≥ TAHSİS × EŞİK" BİÇİMİNDE YAZILIR.
   *
   * Doğal görünen `kalan > tahsis × (1 − eşik)` biçimi KAYAR NOKTADA
   * YANLIŞTIR: `1 − 0.8 = 0.19999999999999996`, dolayısıyla 500 kredilik
   * tahsiste eşik 99.99999999999998 çıkar ve tam sınırdaki büro (kalan 100)
   * uyarı ALMAZDI. `500 × 0.8 = 400` ise tamdır. Sınır değeri kaçıran bir
   * eşik, tam da uyarılması gereken büroyu atlar.
   */
  const tuketilen = tahsis - kalan;
  if (tuketilen < tahsis * ratio) {
    return {
      warn: false,
      kalan,
      tahsis,
      tuketimOrani,
      gerekce: `Kalan ${kalan} kredi, eşiğin (${tahsis - Math.ceil(tahsis * ratio)}) üzerinde.`,
    };
  }

  return {
    warn: true,
    kalan,
    tahsis,
    tuketimOrani,
    gerekce: `Kalan ${kalan} kredi, dönem tahsisinin %${Math.round((1 - ratio) * 100)}'sinin altında.`,
  };
}

/** Bildirim başlığı ve gövdesi — tek yerde, testlenebilir. */
export function creditWarningText(
  decision: CreditWarningDecision,
  periodEnd: Date,
): { title: string; body: string } {
  const yuzde = Math.round(decision.tuketimOrani * 100);
  const bitis = periodEnd.toISOString().slice(0, 10).split("-").reverse().join(".");
  return {
    title: `AI kredinizin %${yuzde}'i kullanıldı`,
    body:
      `Bu dönemde tahsis edilen ${decision.tahsis} kredinin %${yuzde}'i kullanıldı; ` +
      `kullanılabilir bakiyeniz ${decision.kalan} kredi. Dönem ${bitis} tarihinde yenilenir. ` +
      "Bakiye biterse AI uçları 402 ile yanıt verir ve akışın ortasında kesilir; " +
      "kesinti yaşamamak için kredi paketi satın alabilir ya da otomatik yüklemeyi " +
      "açabilirsiniz (Ayarlar → AI Kredileri). Dahil kota dönem sonunda DEVRETMEZ, " +
      "satın alınan bakiye devreder.",
  };
}
