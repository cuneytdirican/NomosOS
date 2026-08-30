/** Hata tipleri ve Türkçe kullanıcı mesajları. */

export type ErrorCode =
  | "NETWORK"
  | "TIMEOUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER"
  | "BAD_REQUEST"
  | "NOT_PAIRED"
  | "PERMISSION_DENIED"
  | "PARSER_BROKEN"
  | "TOO_LARGE"
  | "UNKNOWN";

/** Backend/ağ hatalarını tek tipte toplar. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number | null;
  /** Geçici hata mı? Kuyruk buna bakarak yeniden dener. */
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const MESSAGES: Record<ErrorCode, string> = {
  NETWORK: "NomosOS sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.",
  TIMEOUT: "NomosOS sunucusu zamanında yanıt vermedi.",
  UNAUTHENTICATED: "Eklenti oturumu geçersiz. Lütfen yeniden eşleştirin.",
  FORBIDDEN: "Bu işlem için yetkiniz yok.",
  NOT_FOUND: "İstenen kayıt NomosOS'ta bulunamadı.",
  CONFLICT: "Kayıt NomosOS'ta zaten mevcut.",
  RATE_LIMITED: "Çok fazla istek gönderildi. Kısa süre sonra yeniden denenecek.",
  SERVER: "NomosOS sunucusunda bir hata oluştu. Yeniden denenecek.",
  BAD_REQUEST: "Gönderilen veri NomosOS tarafından kabul edilmedi.",
  NOT_PAIRED: "Eklenti bir NomosOS bürosuyla eşleştirilmemiş.",
  PERMISSION_DENIED: "Tarayıcı izni verilmedi; sunucuya bağlanılamıyor.",
  PARSER_BROKEN: "UYAP sayfa yapısı tanınamadı. Güvenlik gereği aktarım durduruldu.",
  TOO_LARGE: "Evrak, izin verilen boyut sınırını aşıyor.",
  UNKNOWN: "Beklenmeyen bir hata oluştu.",
};

export function messageForCode(code: ErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN;
}

/** HTTP durum kodunu iç hata koduna eşler. */
export function codeFromStatus(status: number): ErrorCode {
  if (status === 400 || status === 422) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  return "UNKNOWN";
}

/** Geçici (yeniden denenebilir) hata mı? */
export function isRetryableCode(code: ErrorCode): boolean {
  return code === "NETWORK" || code === "TIMEOUT" || code === "RATE_LIMITED" || code === "SERVER";
}

/** Herhangi bir hatayı kullanıcıya gösterilecek Türkçe metne çevirir. */
export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return MESSAGES.UNKNOWN;
}

export function toErrorCode(error: unknown): ErrorCode {
  return error instanceof ApiError ? error.code : "UNKNOWN";
}
