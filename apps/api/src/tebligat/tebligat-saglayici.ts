/**
 * TEBLİGAT SAĞLAYICI ARAYÜZÜ (Faz 6) — KEP / UETS adaptörleri için sözleşme.
 *
 * NomosOS bugün UETS'e (PTT Ulusal Elektronik Tebligat Sistemi) ve KEP'e DOĞRUDAN
 * bağlanmaz: her ikisi yetkili hesap + sözleşme (PTT KEP, UETS API yetkisi) ister. Bu
 * dosya arayüzü ve dürüst Noop uygulamasını tanımlar; sözleşme sonrası sağlayıcı
 * sınıfı `register()` ile eklenir, tebligat servisi ve ekranlar değişmez.
 *
 * Ortam: TEBLIGAT_SAGLAYICI = noop (varsayılan) | <kayıtlı anahtar>.
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export interface TebligatGonderim {
  /** Alıcı KEP adresi ya da UETS kimlik/adres bilgisi. */
  alici: string;
  konu: string;
  govde: string;
  /** Ek belge anahtarları (S3). */
  ekler?: string[];
}

export interface TebligatGonderimSonucu {
  providerRef: string;
  gonderimZamani: Date;
}

export interface TebligatDurum {
  providerRef: string;
  durum: "GONDERILDI" | "TEBLIG_EDILDI" | "REDDEDILDI" | "BILINMIYOR";
  tebligZamani: Date | null;
}

export interface TebligatSaglayici {
  readonly key: string;
  readonly configured: boolean;
  gonder(input: TebligatGonderim): Promise<TebligatGonderimSonucu>;
  durumSorgula(providerRef: string): Promise<TebligatDurum>;
}

export class NoopTebligatSaglayici implements TebligatSaglayici {
  readonly key = "noop";
  readonly configured = false;

  private fail(op: string): never {
    throw new ServiceUnavailableException({
      message:
        `Elektronik tebligat sağlayıcısı yapılandırılmamış; ${op} yapılamadı. NomosOS KEP/UETS'e ` +
        "doğrudan bağlanmaz: büronun PTT KEP hesabı ya da UETS API yetkisi sözleşmesi bağlandığında sağlayıcı " +
        "adaptörü etkinleşir. Tebligat kaydı elle tutulabilir; tebliğ tarihi girildiğinde süreler yine otomatik açılır.",
      providerKey: this.key,
      configured: false,
      remedy: "Sözleşme sonrası TEBLIGAT_SAGLAYICI ortam değişkeni + adaptör kaydı.",
    });
  }

  async gonder(): Promise<TebligatGonderimSonucu> {
    this.fail("tebligat gönderimi");
  }

  async durumSorgula(): Promise<TebligatDurum> {
    this.fail("tebligat durum sorgusu");
  }
}

@Injectable()
export class TebligatSaglayiciRegistry {
  private readonly logger = new Logger(TebligatSaglayiciRegistry.name);
  private readonly adapters = new Map<string, TebligatSaglayici>();
  private readonly noop = new NoopTebligatSaglayici();

  constructor() {
    this.adapters.set(this.noop.key, this.noop);
  }

  register(adapter: TebligatSaglayici): void {
    this.adapters.set(adapter.key, adapter);
    this.logger.log(`Tebligat sağlayıcısı kaydedildi: ${adapter.key}`);
  }

  resolve(): TebligatSaglayici {
    const key = process.env.TEBLIGAT_SAGLAYICI?.trim().toLowerCase();
    if (!key || key === "noop") return this.noop;
    return this.adapters.get(key) ?? this.noop;
  }

  describe(): { providerKey: string; configured: boolean; note: string } {
    const a = this.resolve();
    return {
      providerKey: a.key,
      configured: a.configured,
      note: a.configured ? "Elektronik tebligat sağlayıcısı bağlı." : "KEP/UETS sağlayıcısı yok: tebligatlar elle kaydedilir; tebliğ tarihi süre motorunu tetikler.",
    };
  }
}
