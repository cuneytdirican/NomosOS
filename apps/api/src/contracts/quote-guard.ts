/**
 * ALINTI DOĞRULAMA — artık `common/ai/quote-guard.ts` içindedir.
 *
 * Denetim bulgusu Ö-20: kapı `contracts/` altında durduğu için belge hattı ve
 * simülasyon yolları onu hiç çağırmamıştı. Modül ortak bir yere taşındı; bu
 * dosya mevcut çağıranları (contracts, poa, communication) bozmamak için
 * yeniden dışa aktarım yapar.
 */
export * from "../common/ai/quote-guard";
