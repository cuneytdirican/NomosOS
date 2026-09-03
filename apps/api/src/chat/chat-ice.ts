/**
 * WEBRTC ICE SUNUCU YAPILANDIRMASI (D5 / 5-C kapanışı — TURN hazırlığı).
 *
 * DÜRÜSTLÜK: TURN sunucusu KURULU DEĞİLDİR; varsayılan yalnız genel STUN'dur
 * (mevcut davranış). Bu modül, operatör bir coturn sağladığında KOD
 * DEĞİŞİKLİĞİ GEREKMEYECEK şekilde yapılandırmayı sunucu tarafına alır:
 *
 *   STUN_URLS  — virgülle ayrılmış list; boşsa genel Google STUN (bugünkü davranış)
 *   TURN_URLS  — virgülle ayrılmış liste (örn. turn:turn.nomosos.local:3478?transport=udp)
 *   TURN_USERNAME / TURN_CREDENTIAL — TURN kimliği; TURN_URLS varsa zorunlu
 *
 * TURN kimlikleri STATİK PAYLAŞILIR — REST API ile kısa ömürlü kimlik üretimi
 * (HMAC) TURN sunucusu sağlandıktan sonra eklenir; bu yüzden kimlikler tüm
 * oturum açan kullanıcılara görünür, sunucu adresi sır değildir.
 */

/** İstemciye dönen ICE yapılandırması. */
export interface IceConfig {
  iceServers: RTCIceServerLike[];
  /** TURN yapılandırılmış mı — arayüz dürüstlük notu için. */
  turnEnabled: boolean;
}

export interface RTCIceServerLike {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Varsayılan STUN — mevcut davranışın birebir korunması. */
export const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

function splitUrls(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Ortam değişkenlerinden ICE yapılandırması üretir. ASLA fırlatmaz:
 * hatalı yapılandırma uyarı işaretiyle YOK SAYILIR ve varsayılan STUN döner —
 * video arama yapılandırma hatası yüzünden tamamen kapanmaz.
 */
export function resolveIceConfig(env: NodeJS.ProcessEnv = process.env): IceConfig {
  const stunUrls = splitUrls(env.STUN_URLS);
  const turnUrls = splitUrls(env.TURN_URLS);
  const turnUsername = (env.TURN_USERNAME ?? "").trim();
  const turnCredential = (env.TURN_CREDENTIAL ?? "").trim();

  const iceServers: RTCIceServerLike[] = [];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  } else {
    iceServers.push({ urls: [...DEFAULT_STUN_URLS] });
  }

  let turnEnabled = false;
  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    iceServers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
    turnEnabled = true;
  }

  return { iceServers, turnEnabled };
}
