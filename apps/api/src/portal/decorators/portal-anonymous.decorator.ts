import { SetMetadata } from "@nestjs/common";

export const PORTAL_ANON_KEY = "portalAnonymous";

/**
 * Portal zincirinde KİMLİK GEREKTİRMEYEN uç (giriş, davet kabulü, parola
 * sıfırlama). `@Public()` ile karıştırılmamalıdır: `@Public()` BÜRO guard'ını
 * atlatır ve portal controller'larının TAMAMINDA zaten kuruludur;
 * `@PortalAnonymous()` ise portalın KENDİ guard'ını yalnız o metotta atlar.
 *
 * Yeni bir portal ucu eklerken bu dekoratör YAZILMAZSA uç KAPALI gelir —
 * varsayılan güvenli taraftadır.
 */
export const PortalAnonymous = () => SetMetadata(PORTAL_ANON_KEY, true);
