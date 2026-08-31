/**
 * @nomosos/e-signature — sağlayıcı-bağımsız e-imza adaptör çerçevesi.
 *
 * KATMAN SIRASI:
 *   @nomosos/e-signature → arayüz + doğrulama + durum makinesi (bu paket)
 *   apps/api/src/contracts → süreç yönetimi, SignatureRequest kayıtları, denetim
 *
 * BU PAKET GERÇEK BİR SAĞLAYICIYA BAĞLANMAZ. Bugün tek uygulama
 * `NoopSignatureProvider`'dır ve her işlem çağrısında "yapılandırılmamış"
 * hatası döndürür. SAHTE İMZA ÜRETİLMEZ.
 *
 * Tipik kullanım (apps/api):
 * ```ts
 * const provider = createSignatureProvider({ provider: request.provider });
 * try {
 *   const result = await provider.createRequest(doc, signers, { method: "NES" });
 * } catch (err) {
 *   if (isNotConfiguredError(err)) { /* 503 + Ayarlar yönlendirmesi *\/ }
 * }
 * ```
 */

export * from "./types";
export * from "./errors";
export * from "./provider";
export * from "./validation";
export * from "./state-machine";
export * from "./noop-provider";
export * from "./registry";
