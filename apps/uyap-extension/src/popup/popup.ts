/**
 * Popup mantığı — bağımlılıksız TypeScript (React kurulmaz).
 * Tüm iş service worker'da yapılır; popup yalnızca durum gösterir ve komut gönderir.
 */

import { requestHostPermission } from "../lib/permissions";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { sendMessage } from "../types/messages";
import type { PopupState } from "../types/state";
import type { QueueItem } from "../types/queue";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Popup öğesi bulunamadı: ${id}`);
  return node as T;
}

function goster(node: HTMLElement, gorunur: boolean): void {
  node.classList.toggle("gizli", !gorunur);
}

/** "3 dakika önce" biçiminde göreli zaman. */
function goreliZaman(epochMs: number | null): string {
  if (!epochMs) return "hiç";
  const fark = Date.now() - epochMs;
  if (fark < 60_000) return "az önce";
  const dakika = Math.floor(fark / 60_000);
  if (dakika < 60) return `${dakika} dakika önce`;
  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} saat önce`;
  const gun = Math.floor(saat / 24);
  return `${gun} gün önce`;
}

function saatBicimi(epochMs: number): string {
  return new Date(epochMs).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const DURUM_METNI: Record<QueueItem["status"], string> = {
  PENDING: "bekliyor",
  INFLIGHT: "gönderiliyor",
  DONE: "tamam",
  DUPLICATE: "yinelenen",
  FAILED: "hata",
};

function kuyrukListesiCiz(items: readonly QueueItem[]): void {
  const liste = el<HTMLUListElement>("kuyrukListesi");
  liste.textContent = "";
  if (items.length === 0) {
    const bos = document.createElement("li");
    bos.textContent = "Kuyruk boş.";
    liste.appendChild(bos);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    const rozet = document.createElement("span");
    rozet.className = `durum-etiketi durum-${item.status}`;
    rozet.textContent = DURUM_METNI[item.status];
    const baslik = document.createElement("span");
    baslik.textContent = ` ${item.label}`;
    li.appendChild(rozet);
    li.appendChild(baslik);
    if (item.lastError) {
      const hata = document.createElement("span");
      hata.className = "zaman";
      hata.textContent = item.lastError;
      li.appendChild(hata);
    }
    const zaman = document.createElement("span");
    zaman.className = "zaman";
    zaman.textContent = `${saatBicimi(item.updatedAt)} · ${item.attempts} deneme`;
    li.appendChild(zaman);
    liste.appendChild(li);
  }
}

function hataListesiCiz(state: PopupState): void {
  const liste = el<HTMLUListElement>("hataListesi");
  liste.textContent = "";
  if (state.logs.length === 0) {
    const bos = document.createElement("li");
    bos.textContent = "Kayıt yok.";
    liste.appendChild(bos);
    return;
  }
  for (const log of state.logs) {
    const li = document.createElement("li");
    li.textContent = `${log.level === "error" ? "⚠ " : ""}${log.message}`;
    const zaman = document.createElement("span");
    zaman.className = "zaman";
    zaman.textContent = `${saatBicimi(log.at)} · ${log.scope}${log.detail ? ` · ${log.detail}` : ""}`;
    li.appendChild(zaman);
    liste.appendChild(li);
  }
}

function durumCiz(state: PopupState): void {
  el("surum").textContent = `v${state.extensionVersion}`;
  goster(el("eslestirmeBolumu"), !state.paired);
  goster(el("durumBolumu"), state.paired);

  const uyari = el("parserUyari");
  if (state.runtime.parserAlert) {
    // Metin GERÇEĞİ söyler (denetim bulgusu 12): yalnızca ilgili ekran okunamadı;
    // diğer ekranların aktarımı sürer. Ekran yeniden okunabildiğinde uyarı kendiliğinden
    // kalkar (içerik betiği PARSER_OK gönderir).
    uyari.textContent =
      `UYAP "${state.runtime.parserAlert.kind}" ekranı beklenen yapıda okunamadı ` +
      `(selector ${state.runtime.parserAlert.selectorVersion}). ${state.runtime.parserAlert.message} ` +
      "Bu ekrandan veri alınmadı; diğer aktarımlar sürüyor. Ekran yeniden okunabildiğinde bu uyarı kalkar.";
    goster(uyari, true);
  } else {
    goster(uyari, false);
  }

  (el<HTMLInputElement>("apiAdresi")).value = state.settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl;

  if (!state.paired) return;

  el("tenantAdi").textContent = state.identity?.tenantName ?? "—";
  el("kullaniciAdi").textContent = state.identity?.userName ?? "—";
  el("sonSenkron").textContent = goreliZaman(state.runtime.lastSyncAt);

  el("izlenenDosya").textContent = String(
    state.runtime.lastStatus?.watchedFileCount ?? state.runtime.seenDosyaNos.length,
  );
  el("kuyrukBekleyen").textContent = String(state.queue.pending);
  el("kuyrukHatali").textContent = String(state.queue.failed);
  el("onayBekleyen").textContent = String(state.runtime.lastStatus?.pendingApprovalCount ?? 0);

  const durum = el("senkronDurum");
  durum.textContent = state.runtime.lastSyncError
    ? state.runtime.lastSyncError
    : "Senkron yalnızca tarayıcı açıkken çalışır.";

  (el<HTMLInputElement>("otomatikSenkron")).checked = state.settings.autoSyncEnabled;
  (el<HTMLInputElement>("senkronAralik")).value = String(state.settings.syncIntervalMinutes);
  (el<HTMLInputElement>("dugmeEnjeksiyon")).checked = state.settings.injectButtons;
  (el<HTMLInputElement>("cihazAdi")).value = state.settings.deviceName;

  kuyrukListesiCiz(state.queue.items);
  hataListesiCiz(state);
}

async function yenile(): Promise<void> {
  const response = await sendMessage({ type: "GET_POPUP_STATE" });
  if (!response.ok) {
    el("senkronDurum").textContent = response.error.message;
    return;
  }
  durumCiz(response.data);
}

function hataGoster(mesaj: string): void {
  const alan = el("eslestirmeHata");
  alan.textContent = mesaj;
  goster(alan, true);
}

async function eslestir(): Promise<void> {
  const apiBaseUrl = (el<HTMLInputElement>("apiAdresi")).value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
  const pairingCode = (el<HTMLInputElement>("eslestirmeKodu")).value.trim();
  goster(el("eslestirmeHata"), false);

  if (pairingCode.length < 6) {
    hataGoster("Eşleştirme kodunu girin.");
    return;
  }

  // Kendi sunucusunu kullanan bürolar için ana bilgisayar izni kullanıcı hareketiyle istenir.
  // İzin YALNIZCA yukarıda girilen tek origin için istenir (ör. https://app.nomosos.com/*);
  // manifest'teki geniş kalıp yalnızca bu tek adresin çalışma anında istenebilmesini sağlar,
  // eklenti başka hiçbir siteye erişmez (denetim bulgusu 11 — kullanıcıya açıkça yazılır).
  const izin = await requestHostPermission(apiBaseUrl);
  if (!izin) {
    hataGoster(
      "Sunucu adresine erişim izni verilmedi. Eşleştirme yapılamadı. " +
        "İzin yalnızca girdiğiniz NomosOS adresi için istenir; eklenti başka sitelere erişmez.",
    );
    return;
  }

  const response = await sendMessage({ type: "PAIR", pairingCode, apiBaseUrl });
  if (!response.ok) {
    // 404 = sunucu adresi yanlış veya NomosOS sürümü UYAP arka ucu
    // içermiyor. Kod/adres hatası olabileceği gibi sürüm farkı da olabilir —
    // kullanıcıya ikisini de açıkla.
    const mesaj = response.error.message.includes("bulunamadı")
      ? "Eşleştirilemedi: NomosOS sunucusu bu adreste UYAP eşleştirme ucunu " +
        "sunmuyor. Sunucu adresini kontrol edin; NomosOS sürümü UYAP Köprüsü " +
        "içermiyorsa büronuzun NomosOS yöneticisiyle görüşün."
      : response.error.message;
    hataGoster(mesaj);
    return;
  }
  (el<HTMLInputElement>("eslestirmeKodu")).value = "";
  await yenile();
}

function baglaOlaylar(): void {
  el("eslestirBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("eslestirBtn"), eslestir);
  });

  el("senkronBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("senkronBtn"), async () => {
      el("senkronDurum").textContent = "Senkronize ediliyor…";
      const response = await sendMessage({ type: "SYNC_NOW", trigger: "MANUAL" });
      if (!response.ok) el("senkronDurum").textContent = response.error.message;
      await yenile();
    });
  });

  el("yenidenDeneBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("yenidenDeneBtn"), async () => {
      await sendMessage({ type: "RETRY_FAILED" });
      await yenile();
    });
  });

  el("kuyrukTemizleBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("kuyrukTemizleBtn"), async () => {
      await sendMessage({ type: "CLEAR_QUEUE" });
      await yenile();
    });
  });

  el("ayarKaydetBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("ayarKaydetBtn"), async () => {
      const patch = {
        autoSyncEnabled: (el<HTMLInputElement>("otomatikSenkron")).checked,
        syncIntervalMinutes: Number((el<HTMLInputElement>("senkronAralik")).value),
        injectButtons: (el<HTMLInputElement>("dugmeEnjeksiyon")).checked,
        deviceName: (el<HTMLInputElement>("cihazAdi")).value,
      };
      await sendMessage({ type: "SAVE_SETTINGS", patch });
      await yenile();
    });
  });

  el("baglantiKesBtn").addEventListener("click", () => {
    void withBusy(el<HTMLButtonElement>("baglantiKesBtn"), async () => {
      await sendMessage({ type: "UNPAIR" });
      await yenile();
    });
  });
}

async function withBusy(button: HTMLButtonElement, task: () => Promise<void>): Promise<void> {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    el("senkronDurum").textContent =
      error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu.";
  } finally {
    button.disabled = false;
  }
}

baglaOlaylar();
void yenile();
