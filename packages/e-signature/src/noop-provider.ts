/**
 * NoopSignatureProvider — YAPILANDIRILMAMIŞ SAĞLAYICI.
 *
 * ================== BU BİR TASLAK/MOCK DEĞİLDİR ==================
 * NomosOS'un elinde gerçek bir NES/mobil imza sağlayıcısına ait kimlik bilgisi
 * YOKTUR. Bu sınıf, o boşluğu SAHTE BİR ENTEGRASYONLA doldurmaz:
 *
 *   • providerRef ÜRETMEZ (sahte süreç kimliği yok),
 *   • "IMZALANDI" durumu DÖNDÜRMEZ,
 *   • imzalı nüsha ÜRETMEZ,
 *   • hiçbir zaman başarı simüle etmez.
 *
 * Her işlem çağrısı anlaşılır Türkçe bir hatayla sonuçlanır. Çekirdek bu
 * hatayı yakalar, sözleşmeyi IMZAYA_HAZIR durumunda BIRAKIR ve kullanıcıya
 * "Ayarlar → E-imza" yönlendirmesini gösterir.
 *
 * TEK İSTİSNA `healthCheck`'tir: o bir İŞLEM değil, DURUM RAPORUDUR. Ayarlar
 * ekranının "sağlayıcı tanımlı mı?" sorusuna hata fırlatarak değil, rapor
 * döndürerek cevap verir (`configured: false`).
 *
 * DOĞRULAMA YİNE DE ÇALIŞIR: `createRequest`, yapılandırma hatasını fırlatmadan
 * ÖNCE imzacı/belge doğrulamasını koşar. Böylece kullanıcı sağlayıcıyı
 * tanımladıktan sonra ikinci bir hata turuyla karşılaşmaz; hatalı imzacı
 * listesi ilk denemede görünür.
 */

import {
  SignatureProviderError,
  SignatureProviderNotConfiguredError,
} from "./errors";
import type { ISignatureProvider, SignatureProviderConfig } from "./provider";
import type {
  CreateRequestOptions,
  ProviderHealth,
  SignatureDocument,
  SignatureMethod,
  SignatureRequestResult,
  SignatureStatusResult,
  SignedDocumentResult,
  Signer,
} from "./types";
import { validateDocument, validateOptions, validateSigners } from "./validation";

export const NOOP_PROVIDER_KEY = "noop";

/** Kullanıcıya gösterilen standart yönlendirme cümlesi. */
export const NOT_CONFIGURED_MESSAGE =
  "E-imza sağlayıcısı yapılandırılmamış. Ayarlar → E-imza bölümünden bir sağlayıcı tanımlayın.";

export class NoopSignatureProvider implements ISignatureProvider {
  readonly key = NOOP_PROVIDER_KEY;
  readonly displayName = "Yapılandırılmamış e-imza sağlayıcısı";
  /**
   * BOŞ KÜME — bilinçlidir. "Hangi yöntem desteklenir?" sorusunun dürüst
   * cevabı, sağlayıcı tanımlı değilken "hiçbiri"dir. Doğrulama katmanı bu
   * listeye bakarak yöntem seçimini de reddeder.
   */
  readonly supportedMethods: readonly SignatureMethod[] = [];

  /**
   * Kullanıcının Ayarlar'da SEÇTİĞİ ama bu kurulumda KAYITLI OLMAYAN sağlayıcı
   * anahtarı. Hata mesajı bunu anar: "docusign anahtarlı sağlayıcı kayıtlı
   * değil" demek, "hiç sağlayıcı yok" demekten çok daha kullanışlıdır.
   */
  private readonly requestedKey: string | null;

  constructor(config?: SignatureProviderConfig) {
    const requested = config?.provider?.trim();
    this.requestedKey =
      requested && requested.length > 0 && requested !== NOOP_PROVIDER_KEY ? requested : null;
  }

  /** Yapılandırma eksikliğinin ayrıntısı — mesajın parantez içi kısmı. */
  private get detail(): string | undefined {
    return this.requestedKey
      ? `"${this.requestedKey}" anahtarlı sağlayıcı bu kurulumda kayıtlı değil`
      : undefined;
  }

  private notConfigured(): never {
    throw new SignatureProviderNotConfiguredError(this.key, this.detail);
  }

  async createRequest(
    doc: SignatureDocument,
    signers: readonly Signer[],
    options: CreateRequestOptions,
  ): Promise<SignatureRequestResult> {
    // ÖNCE GİRDİ DOĞRULAMASI: kullanıcı sağlayıcıyı tanımladığında listesinin
    // hazır olduğunu bilsin. (Doğrulama hatası da bir hatadır — sahte başarı yok.)
    validateOptions(options, this.key);
    validateDocument(doc, this.key);
    validateSigners(signers, {
      method: options.method,
      sequential: options.sequential,
      // supportedMethods VERİLMEZ: boş küme her yöntemi reddederdi ve kullanıcı
      // asıl sorunu (sağlayıcı yok) göremezdi. Yöntem uygunluğunu gerçek
      // adaptör denetler.
      providerKey: this.key,
    });
    this.notConfigured();
  }

  async getStatus(_providerRef: string): Promise<SignatureStatusResult> {
    this.notConfigured();
  }

  async cancel(_providerRef: string, _reason?: string): Promise<SignatureStatusResult> {
    this.notConfigured();
  }

  async downloadSignedDocument(_providerRef: string): Promise<SignedDocumentResult> {
    this.notConfigured();
  }

  /** RAPOR DÖNER, HATA FIRLATMAZ — Ayarlar ekranı bu veriyi gösterir. */
  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.key,
      displayName: this.displayName,
      configured: false,
      supportedMethods: this.supportedMethods,
      message: this.requestedKey
        ? `${NOT_CONFIGURED_MESSAGE} (${this.detail})`
        : NOT_CONFIGURED_MESSAGE,
      // `reachable` BİLİNÇLİ OLARAK TANIMSIZ: hiçbir uç noktaya gidilmedi.
      // "false" yazmak "denedik, erişemedik" anlamına gelirdi.
      reachable: undefined,
    };
  }
}

/** Bir hatanın "sağlayıcı yapılandırılmamış" hatası olup olmadığını söyler. */
export function isNotConfiguredError(err: unknown): boolean {
  return (
    err instanceof SignatureProviderError && err.code === "SAGLAYICI_YAPILANDIRILMAMIS"
  );
}
