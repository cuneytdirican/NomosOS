import { Injectable, Logger } from "@nestjs/common";
import type { DevicePlatform, NotificationKind } from "@nomosos/db";

/**
 * SAĞLAYICI-BAĞIMSIZ PUSH ARAYÜZÜ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU FAZDA GERÇEK PUSH GÖNDERİLMEZ. SAHTE PUSH DE GÖNDERİLMEZ.             ║
 * ║                                                                          ║
 * ║ FCM/APNs entegrasyonu kimlik dosyaları, sertifika yönetimi ve KVKK       ║
 * ║ tarafında ayrı bir aydınlatma gerektirir; hiçbiri bu fazın kapsamında    ║
 * ║ değildir. Kapsamda olmayan bir yeteneği "çalışıyormuş gibi" göstermek    ║
 * ║ (log'a "bildirim gönderildi" yazmak, `sentAt` damgalamak) en kötü        ║
 * ║ seçenektir: mobil ajanı çalışan bir kanal varsayar, operatör panelde     ║
 * ║ "GONDERILDI" görür ve kimsenin telefonuna hiçbir şey düşmez.             ║
 * ║                                                                          ║
 * ║ Bu yüzden `NoopPushProvider` HİÇBİR ŞEY GÖNDERMEZ ve bunu açıkça         ║
 * ║ raporlar. Bildirimler `BEKLIYOR` durumunda kalır — durumları "gönderildi"║
 * ║ yapmak yalan olurdu. Uygulama içi bildirim yolu (GET /notifications)     ║
 * ║ push'tan bağımsız olarak TAM ÇALIŞIR; kullanıcı hiçbir şey kaybetmez.    ║
 * ║                                                                          ║
 * ║ GERÇEK SAĞLAYICI EKLENDİĞİNDE: bu arayüzü uygulayan bir sınıf yazılır ve ║
 * ║ `SchedulerModule` içindeki `PUSH_PROVIDER` sağlayıcısı değiştirilir.     ║
 * ║ Çağıran taraf (bildirim üreten işler) DEĞİŞMEZ. Sağlayıcı gösterilecek   ║
 * ║ metni `buildPushPayload(message.kind)` ile üretmek ZORUNDADIR; serbest   ║
 * ║ metin arayüzde YOKTUR. KVKK aydınlatması ve kullanıcı başına "bildirim   ║
 * ║ içeriğini gizle" tercihi de o adımın ön koşuludur.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ KİLİT EKRANINA MÜVEKKİL BİLGİSİ DÜŞMEZ (denetim bulgusu 7).              ║
 * ║                                                                          ║
 * ║ Uygulama içi bildirim gövdeleri dosya adını, esas numarasını, mahkemeyi  ║
 * ║ ve kanunî dayanağı TAŞIR — orada doğrudur, çünkü kullanıcı kimliğini     ║
 * ║ doğrulamış hâlde okur. Türk hukuk bürolarında `Case.title` neredeyse her ║
 * ║ zaman taraf adını içerir ("Ahmet Yılmaz / X A.Ş. — İşe İade"); müvekkil  ║
 * ║ adı + esas no + mahkeme üçlüsü tek başına meslek sırrıdır ve kime karşı, ║
 * ║ hangi mahkemede bir ilişki bulunduğunu açığa çıkarır.                    ║
 * ║                                                                          ║
 * ║ Eski `PushMessage` arayüzü serbest `title`/`body` taşıyordu: gerçek      ║
 * ║ FCM/APNs sağlayıcısı takıldığı anda, HİÇBİR KOD DEĞİŞMEDEN bu metin      ║
 * ║ masadaki kilitli telefonun ekranına düşerdi. Arayüz artık serbest metin  ║
 * ║ KABUL ETMEZ: sağlayıcıya yalnız bildirim TÜRÜ ve kaynak kimliği verilir, ║
 * ║ gösterilecek metni `buildPushPayload` üretir. Sızıntı bir dikkat         ║
 * ║ meselesi olmaktan çıkıp TİP HATASI hâline gelir.                         ║
 * ║                                                                          ║
 * ║ Ayrıntı, kullanıcı uygulamayı AÇTIKTAN sonra `GET /notifications`ten     ║
 * ║ okunur.                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
export interface PushMessage {
  tenantId: string;
  userId: string;
  /** Bildirim türü — gösterilecek metin BUNDAN türetilir, çağırandan değil. */
  kind: NotificationKind;
  /** Uygulamanın açacağı kaynak — { resourceType, resourceId }. */
  data?: Record<string, string>;
}

/** Kilit ekranına düşecek KAYNAK TAŞIMAYAN metin. */
export interface PushPayload {
  title: string;
  body: string;
}

/**
 * Bildirim türünden kilit ekranı metni üretir.
 *
 * KURAL: dosya adı, esas no, mahkeme, müvekkil adı, tutar ve süre başlığı
 * BURAYA GİREMEZ. Metin "bir şey var, uygulamayı aç" der; ne olduğunu
 * uygulamanın içinde kimliğini doğrulamış kullanıcı görür.
 */
export function buildPushPayload(kind: NotificationKind): PushPayload {
  switch (kind) {
    case "SURE_YAKLASIYOR":
      return { title: "NomosOS", body: "Yaklaşan bir süreniz var. Ayrıntı için uygulamayı açın." };
    case "SURE_GECTI":
      return {
        title: "NomosOS",
        body: "Vadesi geçmiş ve hâlâ açık bir süreniz var. Ayrıntı için uygulamayı açın.",
      };
    case "DURUSMA_YARIN":
      return { title: "NomosOS", body: "Yarın duruşmanız var. Ayrıntı için uygulamayı açın." };
    default:
      return { title: "NomosOS", body: "Yeni bir bildiriminiz var." };
  }
}

export interface PushTarget {
  token: string;
  platform: DevicePlatform;
}

export interface PushSendResult {
  /** Gerçekten sağlayıcıya teslim edilen mesaj sayısı. */
  delivered: number;
  /** Gönderilmeyen mesaj sayısı. */
  skipped: number;
  /** Neden gönderilmediği — panelde ve günlükte görünür. */
  reason: string;
}

export interface PushProvider {
  /** Sağlayıcı adı ("noop", "fcm", "apns"). */
  readonly name: string;
  /** Yapılandırılmış mı? `false` ise çağıran taraf hiç uğraşmaz. */
  readonly configured: boolean;
  send(messages: PushMessage[], targets: PushTarget[]): Promise<PushSendResult>;
}

export const PUSH_PROVIDER = "PUSH_PROVIDER";

/** Yapılandırılmamış sağlayıcı — hiçbir şey göndermez, hiçbir şey uydurmaz. */
@Injectable()
export class NoopPushProvider implements PushProvider {
  readonly name = "noop";
  readonly configured = false;

  private readonly logger = new Logger(NoopPushProvider.name);
  private warned = false;

  async send(messages: PushMessage[], targets: PushTarget[]): Promise<PushSendResult> {
    const reason =
      "Push sağlayıcısı yapılandırılmamış (noop). Bildirimler yalnız uygulama içinde " +
      "görünür; cihazlara gönderim YAPILMADI.";
    if (!this.warned && messages.length > 0) {
      // Tek seferlik uyarı: her gece yüzlerce satır basmanın anlamı yok.
      this.logger.warn(`${reason} (${messages.length} mesaj, ${targets.length} cihaz).`);
      this.warned = true;
    }
    return { delivered: 0, skipped: messages.length, reason };
  }
}
