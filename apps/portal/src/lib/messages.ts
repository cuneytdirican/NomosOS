import type { PortalMessage } from "./types";

/**
 * Mesajın müvekkile mi büroya mı ait olduğunu çözer.
 *
 * Portal-API tarafı alanı `fromClient`, `sender` ya da `senderRole` olarak
 * gönderebilir; ekran üçünü de kabul eder. Bilinmeyen bir değer geldiğinde
 * mesaj BÜRODAN sayılır — müvekkilin kendi yazdığı sanılan bir avukat mesajı,
 * tersinden daha yanıltıcı olurdu.
 */
export function isFromClient(m: PortalMessage): boolean {
  // Sunucunun gerçek alanı: "BENDEN" (müvekkil yazdı) / "BURODAN" (büro gönderdi).
  if (m.direction === "BENDEN") return true;
  if (m.direction === "BURODAN") return false;
  if (typeof m.fromClient === "boolean") return m.fromClient;
  const role = (m.senderRole ?? m.sender ?? "").toUpperCase();
  return role.includes("MUVEKKIL") || role.includes("PORTAL") || role === "CLIENT";
}

/** Mesajın zaman damgası. Sunucunun alanı `at`; diğerleri geriye dönük yedektir. */
export function messageTime(m: PortalMessage): number {
  const t = new Date(m.at ?? m.createdAt ?? m.sentAt ?? "").getTime();
  return Number.isFinite(t) ? t : 0;
}
