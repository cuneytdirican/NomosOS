/**
 * KANAL SAĞLAYICI KATMANI — SAĞLAYICI-BAĞIMSIZ ARAYÜZ + DÜRÜST NOOP.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SAHTE ENTEGRASYON YAZILMADI (ortak karar 4).                             ║
 * ║                                                                          ║
 * ║ WhatsApp Business API, SMTP ve SMS sağlayıcısı için gerçek kimlik        ║
 * ║ bilgisi YOK. "Gönderildi" diyip hiçbir yere gitmeyen bir uygulama        ║
 * ║ yazmak, bu üründe en tehlikeli hata olurdu: avukat müvekkili             ║
 * ║ bilgilendirdiğini sanır, müvekkil hiçbir şey almaz ve kimse fark etmez.  ║
 * ║                                                                          ║
 * ║ Bu yüzden `NoopChannelProvider` GÖNDERMEZ ve YALAN SÖYLEMEZ:             ║
 * ║ `ChannelNotConfiguredError` fırlatır, mesaj ONAYLANDI durumunda kalır ve ║
 * ║ hangi ayarların eksik olduğu Türkçe olarak söylenir.                     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * GERÇEK BAĞLANTI NASIL EKLENİR (bu dosyanın dışında hiçbir şey değişmez):
 *
 *   1. `MessageChannelProvider` arayüzünü uygulayan bir sınıf yazın; tek
 *      sorumluluğu `send()` içinde sağlayıcıya HTTP isteği atıp sağlayıcının
 *      mesaj kimliğini `providerRef` olarak döndürmektir.
 *   2. Sınıfı `ChannelProviderRegistry.register()` ile kanalına bağlayın.
 *   3. Yapılandırmayı ortam değişkenlerinden okuyun — anahtarlar KAYNAK KODA
 *      GÖMÜLMEZ, veritabanına düz metin YAZILMAZ. (Kiracı bazlı anahtar
 *      gerektiğinde `@nomosos/ai`'nin AES-256-GCM `encryptSecret/decryptSecret`
 *      hattı aynen kullanılabilir; şema tarafı hazır olduğunda.)
 *
 *   Beklenen ortam değişkenleri — bkz. {@link CHANNEL_CONFIG_KEYS}:
 *     EPOSTA   : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *     SMS      : SMS_PROVIDER_BASE_URL, SMS_PROVIDER_API_KEY, SMS_SENDER_TITLE
 *     WHATSAPP : WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN,
 *                WHATSAPP_BUSINESS_ACCOUNT_ID
 *
 *   NOT (WhatsApp): Business API'de 24 saatlik hizmet penceresi dışında ancak
 *   ÖNCEDEN ONAYLANMIŞ şablonlar gönderilebilir. Gerçek uygulama, `templateId`
 *   taşımayan bir mesajı pencere dışında göndermeyi REDDETMELİDİR; aksi hâlde
 *   sağlayıcı sessizce düşürür ve mesaj "gönderildi" görünür.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { MailService } from "../mail/mail.service";
import { NetgsmSmsProvider, SmtpChannelProvider, WhatsAppCloudProvider, netgsmConfigFromEnv, whatsappConfigFromEnv } from "./external-providers";
import type { CommChannel } from "@nomosos/db";

/** Sağlayıcıya verilecek asgari veri — KVKK: yalnız alıcı adresi ve onaylı metin. */
export interface ChannelSendPayload {
  channel: CommChannel;
  /** Alıcı adresi: e-posta / telefon numarası. */
  to: string;
  subject?: string | null;
  /** GÖNDERİLECEK NİHAİ METİN — `OutboundMessage.finalBody`. */
  body: string;
  /** Sağlayıcı tarafında onaylı şablon gerekiyorsa (WhatsApp) anahtarı. */
  templateKey?: string | null;
}

export interface ChannelSendResult {
  /** Sağlayıcının mesaj kimliği — durum geri bildirimi bununla eşleşir. */
  providerRef: string;
  /** Kayda düşecek serbest not (ör. "yerel teslim"). */
  note?: string;
}

/**
 * KANAL SÖZLEŞMESİ. Uygulamalar SADECE gönderimden sorumludur: onay kontrolü,
 * KVKK taraması ve durum makinesi `OutboundService`'te kalır ve sağlayıcı
 * eklenerek atlanamaz.
 */
export interface MessageChannelProvider {
  readonly channel: CommChannel;
  /** Kayıtlarda ve hata mesajlarında görünen ad. */
  readonly name: string;
  send(payload: ChannelSendPayload): Promise<ChannelSendResult>;
}

/**
 * Kanal yapılandırılmamış. AYRI BİR HATA TÜRÜDÜR çünkü sonucu farklıdır:
 * mesaj BAŞARISIZ sayılmaz, ONAYLANDI durumunda bekler ve yapılandırma
 * tamamlanınca yeniden gönderilebilir.
 */
export class ChannelNotConfiguredError extends Error {
  constructor(
    readonly channel: CommChannel,
    readonly missingKeys: readonly string[],
  ) {
    super(
      `${channel} kanalı henüz yapılandırılmadı, mesaj gönderilemedi. ` +
        `Eksik ayarlar: ${missingKeys.join(", ")}. ` +
        "Mesajınız ONAYLANDI durumunda korunmaktadır; yapılandırma tamamlandıktan sonra " +
        "aynı mesaj yeniden gönderilebilir.",
    );
    this.name = "ChannelNotConfiguredError";
  }
}

/** Her kanalın gerçek entegrasyonu için gereken ortam değişkenleri. */
export const CHANNEL_CONFIG_KEYS: Partial<Record<CommChannel, readonly string[]>> = {
  EPOSTA: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"],
  SMS: ["SMS_PROVIDER_BASE_URL", "SMS_PROVIDER_API_KEY", "SMS_SENDER_TITLE"],
  WHATSAPP: ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"],
};

/**
 * Yapılandırılmamış kanal uygulaması. GÖNDERMEZ.
 *
 * Bilinçli olarak "kuyruğa alındı" gibi bir yalan söylemez: gönderilmemiş bir
 * mesajın gönderilmiş görünmesi, iletişim merkezinin tek gerçek başarısızlık
 * biçimidir.
 */
export class NoopChannelProvider implements MessageChannelProvider {
  readonly name = "Yapılandırılmamış (Noop)";

  constructor(readonly channel: CommChannel) {}

  async send(): Promise<ChannelSendResult> {
    throw new ChannelNotConfiguredError(
      this.channel,
      CHANNEL_CONFIG_KEYS[this.channel] ?? ["(bu kanal için sağlayıcı tanımı yok)"],
    );
  }
}

/**
 * PORTAL kanalı — DIŞ SAĞLAYICI GEREKTİRMEZ.
 *
 * Portal mesajının "gönderimi", mesajın büro veritabanındaki iletişim kaydına
 * düşmesidir; müvekkil onu portal üzerinden okur. Bu yüzden portal, Noop
 * değildir: gerçekten çalışır ve gerçekten teslim eder.
 *
 * SINIR: mesajın müvekkile GÖRÜNÜR olması Müvekkil Portalı modülünün yayın
 * (allow-list) kararına bağlıdır (ortak karar 2). Bu sağlayıcı kaydı üretir,
 * görünürlüğe karar VERMEZ.
 */
export class PortalChannelProvider implements MessageChannelProvider {
  readonly channel: CommChannel = "PORTAL";
  readonly name = "Müvekkil portalı (yerel teslim)";

  async send(payload: ChannelSendPayload): Promise<ChannelSendResult> {
    return {
      providerRef: `portal:${Date.now().toString(36)}`,
      note:
        "Mesaj portal iletişim kaydına yazıldı. Müvekkile görünürlüğü, Müvekkil Portalı " +
        `modülünün yayın kararına bağlıdır. Alıcı: ${payload.to}`,
    };
  }
}

/**
 * Kanal → sağlayıcı çözümü.
 *
 * Kayıtlı sağlayıcı yoksa `NoopChannelProvider` döner: kapı AÇIK KALMAZ, kapalı
 * kalır. Bilinmeyen bir kanalın sessizce "gönderilmiş" sayılması imkânsızdır.
 */
@Injectable()
export class ChannelProviderRegistry {
  private readonly logger = new Logger(ChannelProviderRegistry.name);
  private readonly providers = new Map<CommChannel, MessageChannelProvider>();

  /**
   * Faz 2: gerçek sağlayıcılar ortam değişkenlerine göre kaydedilir. SMTP tanımlıysa
   * EPOSTA; SMS_PROVIDER_* tanımlıysa Netgsm; WHATSAPP_* tanımlıysa Cloud API.
   * Tanımsız kanal Noop kalır ve `status()` bunu ayarlar ekranına dürüstçe söyler.
   */
  constructor(@Optional() mail?: MailService) {
    this.register(new PortalChannelProvider());
    if (mail?.configured) this.register(new SmtpChannelProvider(mail));
    const sms = netgsmConfigFromEnv();
    if (sms) this.register(new NetgsmSmsProvider(sms));
    const wa = whatsappConfigFromEnv();
    if (wa) this.register(new WhatsAppCloudProvider(wa));
  }

  register(provider: MessageChannelProvider): void {
    this.providers.set(provider.channel, provider);
    this.logger.log(`${provider.channel} kanalı sağlayıcısı: ${provider.name}`);
  }

  resolve(channel: CommChannel): MessageChannelProvider {
    return this.providers.get(channel) ?? new NoopChannelProvider(channel);
  }

  /** Ayarlar ekranı için: hangi kanal gerçekten gönderebiliyor? */
  status(): Array<{ channel: CommChannel; provider: string; configured: boolean; requires: readonly string[] }> {
    const channels: CommChannel[] = ["EPOSTA", "SMS", "WHATSAPP", "PORTAL"];
    return channels.map((channel) => {
      const provider = this.resolve(channel);
      return {
        channel,
        provider: provider.name,
        configured: !(provider instanceof NoopChannelProvider),
        requires: CHANNEL_CONFIG_KEYS[channel] ?? [],
      };
    });
  }
}
