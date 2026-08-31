/**
 * ADAPTÖR KAYIT DEFTERİ.
 *
 * Çekirdek sağlayıcıyı ADIYLA değil, ANAHTARIYLA ister; hangi sınıfın
 * çalışacağını burası çözer. Gerçek bir sağlayıcı eklendiğinde tek yapılacak
 * `registerSignatureProvider("nes-x", (cfg) => new NesXProvider(cfg))` çağrısıdır;
 * contracts modülünde tek satır değişmez.
 *
 * BUGÜN KAYITLI GERÇEK SAĞLAYICI YOKTUR. Bilinmeyen anahtar sessizce yok
 * sayılmaz: talep edilen anahtarı ANAN bir `NoopSignatureProvider` döner, böylece
 * hata mesajı "sağlayıcı yok" değil, "'nes-x' anahtarlı sağlayıcı bu kurulumda
 * kayıtlı değil" olur.
 *
 * SAĞLAYICI DEĞİŞİMİ AÇIK SÜREÇLERİ ETKİLEMEZ (docs/moduller/20, iş kuralı 9):
 * çekirdek her `SignatureRequest` için kaydın KENDİ `provider` alanını okur ve
 * bu fonksiyona onu verir; tenant ayarındaki güncel sağlayıcıyı değil.
 */

import { NoopSignatureProvider, NOOP_PROVIDER_KEY } from "./noop-provider";
import type { ISignatureProvider, SignatureProviderConfig } from "./provider";

export type SignatureProviderFactory = (config: SignatureProviderConfig) => ISignatureProvider;

const registry = new Map<string, SignatureProviderFactory>();

/** Yeni adaptör kaydeder. Aynı anahtar ikinci kez kaydedilirse üzerine yazar. */
export function registerSignatureProvider(key: string, factory: SignatureProviderFactory): void {
  const normalized = key.trim().toLowerCase();
  if (!normalized || normalized === NOOP_PROVIDER_KEY) {
    throw new Error(
      `"${key}" geçerli bir e-imza adaptör anahtarı değil ("${NOOP_PROVIDER_KEY}" ayrılmıştır).`,
    );
  }
  registry.set(normalized, factory);
}

/** Kayıtlı gerçek adaptör anahtarları (noop hariç). Bugün BOŞTUR. */
export function listRegisteredProviders(): string[] {
  return [...registry.keys()].sort();
}

/** Yalnızca testler için — kayıt defterini boşaltır. */
export function clearSignatureProviders(): void {
  registry.clear();
}

/**
 * Yapılandırmaya göre adaptör üretir.
 *
 * Anahtar yoksa, "noop" ise ya da kayıtlı değilse → `NoopSignatureProvider`.
 * ASLA `null` dönmez: çağıran taraf her koşulda bir sağlayıcı nesnesi alır ve
 * hata, sağlayıcının kendi metodundan Türkçe olarak gelir.
 */
export function createSignatureProvider(config?: SignatureProviderConfig): ISignatureProvider {
  const key = config?.provider?.trim().toLowerCase();
  if (!key || key === NOOP_PROVIDER_KEY) {
    return new NoopSignatureProvider(config);
  }
  const factory = registry.get(key);
  if (!factory) {
    return new NoopSignatureProvider(config);
  }
  return factory(config ?? {});
}

/** Bir anahtarın gerçek (yapılandırılmış) bir adaptöre karşılık gelip gelmediği. */
export function isProviderRegistered(key: string | null | undefined): boolean {
  if (!key) return false;
  const normalized = key.trim().toLowerCase();
  return normalized !== NOOP_PROVIDER_KEY && registry.has(normalized);
}
