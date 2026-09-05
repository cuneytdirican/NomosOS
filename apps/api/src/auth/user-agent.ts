/**
 * User-Agent → okunur cihaz etiketi (oturum listesi için). Kütüphane
 * bağımlılığı EKLENMEZ: tarayıcı/işletim sistemi ayrımı kaba ama yeterli
 * ("Chrome · Windows", "Safari · iPhone", "NomosOS mobil (Android)").
 */

export interface ParsedUserAgent {
  browser: string;
  os: string;
  /** Tek satır etiket — listede gösterilir. */
  label: string;
  kind: "tarayici" | "mobil-uygulama" | "diger";
}

export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  const s = (ua ?? "").trim();
  if (!s) return { browser: "Bilinmeyen istemci", os: "", label: "Bilinmeyen istemci", kind: "diger" };

  // Mobil uygulama (React Native / Expo) — tarayıcı imzası taşımaz.
  if (/NomosOS[-\s]?Mobile|Expo|okhttp|CFNetwork|Darwin\//i.test(s) && !/Mozilla/i.test(s)) {
    const os = /okhttp|Android/i.test(s) ? "Android" : /CFNetwork|Darwin|iOS|iPhone/i.test(s) ? "iOS" : "";
    return { browser: "NomosOS mobil", os, label: `NomosOS mobil${os ? ` (${os})` : ""}`, kind: "mobil-uygulama" };
  }

  let os = "";
  if (/Windows/i.test(s)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(s)) os = /iPad/i.test(s) ? "iPad" : "iPhone";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macOS";
  else if (/Android/i.test(s)) os = "Android";
  else if (/CrOS/i.test(s)) os = "ChromeOS";
  else if (/Linux/i.test(s)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s) && /Version\//i.test(s)) browser = "Safari";
  else if (/curl\//i.test(s)) browser = "curl";
  else if (/PostmanRuntime/i.test(s)) browser = "Postman";

  const kind: ParsedUserAgent["kind"] = browser && !/curl|Postman/.test(browser) ? "tarayici" : "diger";
  const label = [browser || "Bilinmeyen istemci", os].filter(Boolean).join(" · ");
  return { browser: browser || "Bilinmeyen istemci", os, label, kind };
}
