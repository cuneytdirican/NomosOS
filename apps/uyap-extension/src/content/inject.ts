/**
 * UYAP sayfalarına enjekte edilen içerik betiği.
 *
 * Görevleri:
 *  - Sayfa türünü parser katmanıyla tespit etmek,
 *  - Dosya listesi satırlarına ve dosya detay/safahat/evrak/duruşma ekranlarına
 *    "NomosOS'a aktar" düğmeleri eklemek,
 *  - Kullanıcı aksiyonuyla (veya periyodik senkron komutuyla) veriyi okuyup service
 *    worker'a iletmek.
 *
 * SINIRLAR
 *  - UYAP'a hiçbir YAZMA işlemi yapılmaz; sayfa yalnızca OKUNUR.
 *  - Evrak indirme kullanıcının açık UYAP oturumu üzerinden yapılır; çerez/e-imza
 *    bilgisi okunmaz ve dışarı gönderilmez.
 *  - Parser sayfa imzasını doğrulayamazsa veri OKUNMAZ; kullanıcı görünür bir uyarıyla
 *    bilgilendirilir ("sessiz yanlış veri asla").
 */

import {
  cellsOf,
  dataRows,
  describeIssues,
  detectPageKinds,
  dosyaDetayParser,
  dosyaListesiParser,
  durusmaParser,
  evrakListesiParser,
  queryFirst,
  safahatParser,
  SELECTOR_SET_VERSION,
} from "./parsers";
import { SELECTORS_V1 as DOSYA_LISTESI_SELECTORS } from "./parsers/dosya-listesi";
import { SELECTORS_V1 as EVRAK_SELECTORS } from "./parsers/evrak-listesi";
import { getSettings } from "../lib/settings";
import { STORAGE_KEYS, readLocal, updateLocal } from "../lib/storage";
import { bytesToBase64 } from "../lib/hash";
import { downloadUyapDocument } from "../lib/udf";
import { safeFileName } from "../lib/text";
import { sendMessage } from "../types/messages";
import type { ContentCommand, ContentScanResult } from "../types/messages";
import type { PendingDocument, SyncTrigger } from "../types/dto";
import type { PageContext, ParseFailure, ParseResult } from "../types/parser";
import type {
  UyapDosyaOzeti,
  UyapDurusmaKaydi,
  UyapEvrakKaydi,
  UyapPageKind,
  UyapSafahatKaydi,
} from "../types/uyap";

const INJECTED_ATTR = "data-nomosos-injected";
const PANEL_ID = "nomosos-uyap-panel";
const BUTTON_CLASS = "nomosos-aktar-btn";
const ROW_BUTTON_CLASS = "nomosos-satir-btn";
const BANNER_ID = "nomosos-uyap-banner";

/** Tek seferde indirilecek azami evrak (kullanıcıyı ve UYAP'ı yormamak için). */
const MAX_DOCUMENTS_PER_ACTION = 25;

function ctx(): PageContext {
  return { doc: document, url: location.href };
}

function sourceHost(): string {
  return location.hostname;
}

/* ------------------------------------------------------------------ */
/* Aktarılmış evrak defteri (yeniden indirmeyi önler)                  */
/* ------------------------------------------------------------------ */

interface EvrakLedger {
  readonly keys: string[];
}

const EMPTY_EVRAK_LEDGER: EvrakLedger = { keys: [] };

function evrakKey(dosyaNo: string, evrak: UyapEvrakKaydi): string {
  return `${dosyaNo}#${evrak.evrakId ?? evrak.indirmeUrl ?? evrak.ad ?? evrak.tur ?? "?"}`;
}

async function knownEvrakKeys(): Promise<Set<string>> {
  const ledger = await readLocal<EvrakLedger>(STORAGE_KEYS.evrak, EMPTY_EVRAK_LEDGER);
  return new Set(ledger.keys);
}

async function rememberEvrakKeys(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await updateLocal<EvrakLedger>(STORAGE_KEYS.evrak, EMPTY_EVRAK_LEDGER, (current) => ({
    keys: [...new Set([...keys, ...current.keys])].slice(0, 5000),
  }));
}

/* ------------------------------------------------------------------ */
/* Kullanıcı arayüzü parçaları                                         */
/* ------------------------------------------------------------------ */

function ensurePanel(): HTMLElement {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <div class="nomosos-panel-baslik">
      <span class="nomosos-logo">NomosOS</span>
      <span class="nomosos-panel-alt">UYAP Köprüsü</span>
    </div>
    <div class="nomosos-panel-govde"></div>
    <div class="nomosos-panel-durum" role="status" aria-live="polite"></div>
  `;
  document.body.appendChild(panel);
  return panel;
}

function panelBody(): HTMLElement {
  const panel = ensurePanel();
  return panel.querySelector<HTMLElement>(".nomosos-panel-govde") as HTMLElement;
}

function setStatus(text: string, tone: "bilgi" | "hata" | "basari" = "bilgi"): void {
  const panel = ensurePanel();
  const status = panel.querySelector<HTMLElement>(".nomosos-panel-durum");
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function addPanelButton(id: string, label: string, onClick: () => Promise<void>): void {
  const body = panelBody();
  if (body.querySelector(`#${id}`)) return;
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    void onClick().finally(() => {
      button.disabled = false;
    });
  });
  body.appendChild(button);
}

/** Parser kırıldığında sayfanın üstünde görünür uyarı gösterir. */
function showBrokenBanner(kind: UyapPageKind, failure: ParseFailure): void {
  const existing = document.getElementById(BANNER_ID);
  const banner = existing ?? document.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = `NomosOS: ${describeIssues(failure)} Aktarım durduruldu; lütfen eklenti güncellemesini bekleyin. (${kind})`;
  if (!existing) document.body.appendChild(banner);
}

function clearBanner(): void {
  document.getElementById(BANNER_ID)?.remove();
}

/* ------------------------------------------------------------------ */
/* Parse sonucu ele alma                                               */
/* ------------------------------------------------------------------ */

/**
 * Parse hatasını değerlendirir.
 * EMPTY_RESULT bir arıza değildir (sayfada kayıt yok); diğer kodlar parser kırılmasıdır
 * ve service worker'a bildirilir.
 */
async function reportFailure(kind: UyapPageKind, result: ParseResult<unknown>): Promise<string> {
  if (result.ok) return "";
  if (result.failure.code === "EMPTY_RESULT") {
    return result.failure.message;
  }
  showBrokenBanner(kind, result.failure);
  await sendMessage({
    type: "PARSER_FAILURE",
    kind,
    selectorVersion: result.selectorVersion,
    url: result.url,
    failure: result.failure,
  });
  return describeIssues(result.failure);
}

/**
 * Başarılı okumayı bildirir: aynı ekran türü için duran parser uyarısı kaldırılır.
 * (Denetim bulgusu 12 — kalıcı yanlış uyarı zamanla göz ardı edilir.)
 */
async function reportOk(kind: UyapPageKind, selectorVersion: string): Promise<void> {
  clearBanner();
  await sendMessage({ type: "PARSER_OK", kind, selectorVersion });
}

/* ------------------------------------------------------------------ */
/* Aktarım aksiyonları                                                 */
/* ------------------------------------------------------------------ */

interface TransferCounts {
  queuedFiles: number;
  queuedEvents: number;
  queuedDocuments: number;
  errors: string[];
}

function emptyCounts(): TransferCounts {
  return { queuedFiles: 0, queuedEvents: 0, queuedDocuments: 0, errors: [] };
}

async function transferDosyaListesi(
  trigger: SyncTrigger,
  counts: TransferCounts,
  only?: UyapDosyaOzeti,
): Promise<void> {
  const result = dosyaListesiParser.parse(ctx());
  if (!result.ok) {
    const message = await reportFailure("DOSYA_LISTESI", result);
    if (message) counts.errors.push(message);
    return;
  }
  await reportOk("DOSYA_LISTESI", result.selectorVersion);

  const files = only ? [only] : result.data.dosyalar;
  const response = await sendMessage({
    type: "TRANSFER_FILES",
    files,
    detay: null,
    trigger,
    sourceHost: sourceHost(),
    selectorVersion: result.selectorVersion,
  });
  if (response.ok) counts.queuedFiles += response.data.queued;
  else counts.errors.push(response.error.message);
}

async function transferDosyaDetay(trigger: SyncTrigger, counts: TransferCounts): Promise<void> {
  const result = dosyaDetayParser.parse(ctx());
  if (!result.ok) {
    const message = await reportFailure("DOSYA_DETAY", result);
    if (message) counts.errors.push(message);
    return;
  }
  await reportOk("DOSYA_DETAY", result.selectorVersion);

  const detay = result.data;
  const response = await sendMessage({
    type: "TRANSFER_FILES",
    files: [detay],
    detay,
    trigger,
    sourceHost: sourceHost(),
    selectorVersion: result.selectorVersion,
  });
  if (response.ok) counts.queuedFiles += response.data.queued;
  else counts.errors.push(response.error.message);
}

/**
 * Safahat + (varsa) duruşma kayıtlarını aktarır.
 *
 * DÜZELTİLDİ (hukuki/KVKK denetimi, bulgu 1): Eskiden sayfadaki TÜM duruşmalar tek bir
 * dosya numarası altında gönderiliyor, dosya numarası okunamayan satırlar da o dosyaya
 * ait sayılıyor, farklı dosyaya ait satırlar ise sessizce ELENİYORDU — üstelik kullanıcıya
 * "kuyruğa alındı" başarı mesajı gösteriliyordu. "Duruşmalarım" gibi ÇOK DOSYALI ekranlarda
 * bu, ajandaya yanlış duruşma yazmak (meslek riski) demekti.
 *
 * Yeni davranış:
 *  - Duruşmalar KENDİ dosya numaralarına göre gruplanır; her dosya için ayrı aktarım gider.
 *  - Dosya numarası okunamayan duruşma AKTARILMAZ ve görünür uyarıya düşer (tahmin yok).
 *  - Safahat kayıtları yalnızca safahatın ait olduğu dosyaya yazılır.
 */
async function transferSafahatVeDurusma(trigger: SyncTrigger, counts: TransferCounts): Promise<void> {
  const page = ctx();
  const safahat = safahatParser.matches(page) ? safahatParser.parse(page) : null;
  const durusma = durusmaParser.matches(page) ? durusmaParser.parse(page) : null;

  if (safahat && !safahat.ok) {
    const message = await reportFailure("SAFAHAT", safahat);
    if (message) counts.errors.push(message);
  } else if (safahat?.ok) {
    await reportOk("SAFAHAT", safahat.selectorVersion);
  }
  if (durusma && !durusma.ok) {
    const message = await reportFailure("DURUSMA", durusma);
    if (message) counts.errors.push(message);
  } else if (durusma?.ok) {
    await reportOk("DURUSMA", durusma.selectorVersion);
  }

  const events = safahat?.ok ? safahat.data.kayitlar : [];
  const hearings = durusma?.ok ? durusma.data.durusmalar : [];
  if (events.length === 0 && hearings.length === 0) return;

  const sayfaDosyaNo = (safahat?.ok ? safahat.data.dosyaNo : null) ?? detectDosyaNoFromDetay();

  /** dosyaNo → o dosyaya ait kayıtlar. */
  const gruplar = new Map<string, { events: UyapSafahatKaydi[]; hearings: UyapDurusmaKaydi[] }>();
  const grupAl = (dosyaNo: string) => {
    const mevcut = gruplar.get(dosyaNo);
    if (mevcut) return mevcut;
    const yeni = { events: [] as UyapSafahatKaydi[], hearings: [] as UyapDurusmaKaydi[] };
    gruplar.set(dosyaNo, yeni);
    return yeni;
  };

  if (events.length > 0) {
    if (!sayfaDosyaNo) {
      counts.errors.push(
        "Safahat kayıtlarının hangi dosyaya ait olduğu sayfadan tespit edilemedi; yanlış dosyaya yazmamak için aktarım yapılmadı.",
      );
    } else {
      grupAl(sayfaDosyaNo).events.push(...events);
    }
  }

  let dosyasizDurusma = 0;
  for (const kayit of hearings) {
    // Parser satırdaki dosya no'yu okuyamazsa sayfa geneli dosya no'yu koyar; ikisi de
    // yoksa null kalır. Null'u BİR DOSYAYA ATAMAYIZ — tahmin yanlış ajanda kaydı demektir.
    if (!kayit.dosyaNo) {
      dosyasizDurusma += 1;
      continue;
    }
    grupAl(kayit.dosyaNo).hearings.push(kayit);
  }

  if (dosyasizDurusma > 0) {
    counts.errors.push(
      `${dosyasizDurusma} duruşma kaydının ait olduğu dosya numarası okunamadı; ajandaya yanlış kayıt düşmemesi için bu satırlar aktarılmadı.`,
    );
  }

  for (const [dosyaNo, grup] of gruplar) {
    if (grup.events.length === 0 && grup.hearings.length === 0) continue;
    const response = await sendMessage({
      type: "TRANSFER_EVENTS",
      uyapDosyaNo: dosyaNo,
      events: grup.events,
      hearings: grup.hearings,
      trigger,
      sourceHost: sourceHost(),
      selectorVersion: SELECTOR_SET_VERSION,
    });
    if (response.ok) counts.queuedEvents += response.data.queued;
    else counts.errors.push(response.error.message);
  }
}

/** Dosya detay parser'ı çalışıyorsa oradan dosya numarasını al. */
function detectDosyaNoFromDetay(): string | null {
  const page = ctx();
  if (!dosyaDetayParser.matches(page)) return null;
  const result = dosyaDetayParser.parse(page);
  return result.ok ? result.data.dosyaNo : null;
}

async function transferEvraklar(
  counts: TransferCounts,
  only?: UyapEvrakKaydi,
): Promise<void> {
  const result = evrakListesiParser.parse(ctx());
  if (!result.ok) {
    const message = await reportFailure("EVRAK_LISTESI", result);
    if (message) counts.errors.push(message);
    return;
  }
  await reportOk("EVRAK_LISTESI", result.selectorVersion);

  const dosyaNo = result.data.dosyaNo ?? detectDosyaNoFromDetay();
  if (!dosyaNo) {
    counts.errors.push("Evrakların ait olduğu dosya numarası tespit edilemedi; aktarım yapılmadı.");
    return;
  }

  const settings = await getSettings();
  const known = await knownEvrakKeys();
  // Tip koruyucu filtre (kod denetimi, bulgu 12): `as string` cast'i kaldırıldı; filtre
  // satırı ileride değişirse artık derleme hatası alınır, sessizce null URL indirilmez.
  const adaylar = (only ? [only] : result.data.evraklar)
    .filter((evrak): evrak is UyapEvrakKaydi & { indirmeUrl: string } => evrak.indirmeUrl !== null)
    .filter((evrak) => only !== undefined || !known.has(evrakKey(dosyaNo, evrak)))
    .slice(0, MAX_DOCUMENTS_PER_ACTION);

  if (adaylar.length === 0) {
    setStatus("Aktarılacak yeni evrak yok.", "bilgi");
    return;
  }

  const transferredKeys: string[] = [];

  for (let i = 0; i < adaylar.length; i += 1) {
    const evrak = adaylar[i];
    setStatus(`Evrak indiriliyor (${i + 1}/${adaylar.length})…`, "bilgi");
    try {
      const suggested = safeFileName(
        evrak.ad ?? `${evrak.tur ?? "evrak"}-${evrak.evrakId ?? i + 1}`,
        `uyap-evrak-${i + 1}`,
      );
      const file = await downloadUyapDocument(
        evrak.indirmeUrl,
        suggested,
        settings.maxDocumentBytes,
        location.origin,
      );
      const document_: PendingDocument = {
        uyapDosyaNo: dosyaNo,
        uyapEvrakId: evrak.evrakId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        evrakTuru: evrak.tur,
        evrakTarihi: evrak.tarih,
        gonderen: evrak.gonderen,
        base64: bytesToBase64(file.bytes),
        sizeBytes: file.sizeBytes,
      };

      // Evraklar TEK TEK mesajlanır (kod denetimi, bulgu 9): 25 evrak × ~33 MB base64 tek
      // mesajda taşınırsa Chrome mesaj sınırına takılır ve aktarım sessizce MESSAGE_FAILED olur.
      const response = await sendMessage({
        type: "TRANSFER_DOCUMENTS",
        documents: [document_],
        sourceHost: sourceHost(),
        selectorVersion: result.selectorVersion,
      });
      if (response.ok) {
        counts.queuedDocuments += response.data.queued;
        transferredKeys.push(evrakKey(dosyaNo, evrak));
      } else {
        counts.errors.push(`"${document_.fileName}" kuyruğa alınamadı: ${response.error.message}`);
      }
    } catch (error) {
      counts.errors.push(
        `"${evrak.ad ?? evrak.tur ?? "Evrak"}" indirilemedi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`,
      );
    }
  }

  if (transferredKeys.length > 0) await rememberEvrakKeys(transferredKeys);
}

/* ------------------------------------------------------------------ */
/* Tarama (manuel düğme veya periyodik senkron komutu)                 */
/* ------------------------------------------------------------------ */

/**
 * Sayfayı tarar ve aktarım kuyruğuna verir.
 *
 * Periyodik senkronda (SCHEDULED) yalnızca ÜSTVERİ aktarılır (dosya, safahat, duruşma);
 * evrak indirme kullanıcı isteğine bağlıdır — arka planda sessizce megabaytlarca evrak
 * indirmek kullanıcı beklentisini ihlal ederdi.
 */
async function runScan(trigger: SyncTrigger): Promise<ContentScanResult> {
  const counts = emptyCounts();
  const kinds = detectPageKinds(ctx());

  if (kinds.includes("DOSYA_DETAY")) {
    await transferDosyaDetay(trigger, counts);
  } else if (kinds.includes("DOSYA_LISTESI")) {
    await transferDosyaListesi(trigger, counts);
  }

  if (kinds.includes("SAFAHAT") || kinds.includes("DURUSMA")) {
    await transferSafahatVeDurusma(trigger, counts);
  }

  if (trigger !== "SCHEDULED" && kinds.includes("EVRAK_LISTESI")) {
    await transferEvraklar(counts);
  }

  return {
    kinds,
    queuedFiles: counts.queuedFiles,
    queuedEvents: counts.queuedEvents,
    queuedDocuments: counts.queuedDocuments,
    errors: counts.errors,
  };
}

function summarize(result: ContentScanResult): string {
  if (result.errors.length > 0) return result.errors[0];
  const parts: string[] = [];
  if (result.queuedFiles > 0) parts.push(`${result.queuedFiles} dosya`);
  if (result.queuedEvents > 0) parts.push(`${result.queuedEvents} safahat gönderimi`);
  if (result.queuedDocuments > 0) parts.push(`${result.queuedDocuments} evrak`);
  if (parts.length === 0) return "Aktarılacak yeni kayıt bulunamadı (yinelenenler atlandı).";
  return `${parts.join(", ")} NomosOS kuyruğuna alındı.`;
}

/* ------------------------------------------------------------------ */
/* Düğme enjeksiyonu                                                   */
/* ------------------------------------------------------------------ */

function injectRowButtons(): void {
  const page = ctx();

  // Dosya listesi satırları
  if (dosyaListesiParser.matches(page)) {
    const result = dosyaListesiParser.parse(page);
    const table = queryFirst(document, [...DOSYA_LISTESI_SELECTORS.table]);
    if (result.ok && table) {
      const rows = dataRows(table);
      rows.forEach((row, index) => {
        if (row.getAttribute(INJECTED_ATTR) === "1") return;
        const dosya = result.data.dosyalar[index];
        if (!dosya) return;
        const cells = cellsOf(row);
        const target = cells[cells.length - 1];
        if (!target) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = ROW_BUTTON_CLASS;
        button.textContent = "NomosOS'a aktar";
        button.title = `${dosya.dosyaNo} — ${dosya.birim}`;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.disabled = true;
          const counts = emptyCounts();
          void transferDosyaListesi("PAGE_ACTION", counts, dosya)
            .then(() => {
              setStatus(
                counts.errors.length > 0 ? counts.errors[0] : `${dosya.dosyaNo} kuyruğa alındı.`,
                counts.errors.length > 0 ? "hata" : "basari",
              );
            })
            .finally(() => {
              button.disabled = false;
            });
        });
        target.appendChild(button);
        row.setAttribute(INJECTED_ATTR, "1");
      });
    }
  }

  // Evrak listesi satırları
  if (evrakListesiParser.matches(page)) {
    const result = evrakListesiParser.parse(page);
    const table = queryFirst(document, [...EVRAK_SELECTORS.table]);
    if (result.ok && table) {
      const rows = dataRows(table);
      rows.forEach((row, index) => {
        if (row.getAttribute(INJECTED_ATTR) === "1") return;
        const evrak = result.data.evraklar[index];
        if (!evrak || !evrak.indirmeUrl) return;
        const cells = cellsOf(row);
        const target = cells[cells.length - 1];
        if (!target) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = ROW_BUTTON_CLASS;
        button.textContent = "NomosOS'a aktar";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          button.disabled = true;
          const counts = emptyCounts();
          void transferEvraklar(counts, evrak)
            .then(() => {
              setStatus(
                counts.errors.length > 0 ? counts.errors[0] : "Evrak kuyruğa alındı.",
                counts.errors.length > 0 ? "hata" : "basari",
              );
            })
            .finally(() => {
              button.disabled = false;
            });
        });
        target.appendChild(button);
        row.setAttribute(INJECTED_ATTR, "1");
      });
    }
  }
}

function injectPanelButtons(kinds: readonly UyapPageKind[]): void {
  if (kinds.length === 0) return;
  ensurePanel();

  if (kinds.includes("DOSYA_DETAY")) {
    addPanelButton("nomosos-btn-detay", "Bu dosyayı NomosOS'a aktar", async () => {
      const counts = emptyCounts();
      await transferDosyaDetay("PAGE_ACTION", counts);
      setStatus(
        counts.errors.length > 0 ? counts.errors[0] : "Dosya künyesi kuyruğa alındı.",
        counts.errors.length > 0 ? "hata" : "basari",
      );
    });
  } else if (kinds.includes("DOSYA_LISTESI")) {
    addPanelButton("nomosos-btn-liste", "Listedeki dosyaları aktar", async () => {
      const counts = emptyCounts();
      await transferDosyaListesi("PAGE_ACTION", counts);
      setStatus(
        counts.errors.length > 0 ? counts.errors[0] : `${counts.queuedFiles} dosya kuyruğa alındı.`,
        counts.errors.length > 0 ? "hata" : "basari",
      );
    });
  }

  if (kinds.includes("SAFAHAT") || kinds.includes("DURUSMA")) {
    addPanelButton("nomosos-btn-safahat", "Safahat/duruşmaları aktar", async () => {
      const counts = emptyCounts();
      await transferSafahatVeDurusma("PAGE_ACTION", counts);
      // Dürüst geri bildirim: hata varsa hata gösterilir; yoksa GERÇEKTEN kuyruğa giren
      // aktarım sayısı yazılır ("kuyruğa alındı" mesajı hiçbir şey aktarılmasa da çıkmaz).
      setStatus(
        counts.errors.length > 0
          ? counts.errors[0]
          : counts.queuedEvents > 0
            ? `${counts.queuedEvents} aktarım kuyruğa alındı.`
            : "Aktarılacak yeni safahat/duruşma kaydı bulunamadı.",
        counts.errors.length > 0 ? "hata" : "basari",
      );
    });
  }

  if (kinds.includes("EVRAK_LISTESI")) {
    addPanelButton("nomosos-btn-evrak", "Yeni evrakları aktar", async () => {
      const counts = emptyCounts();
      await transferEvraklar(counts);
      setStatus(
        counts.errors.length > 0
          ? counts.errors[0]
          : `${counts.queuedDocuments} evrak kuyruğa alındı.`,
        counts.errors.length > 0 ? "hata" : "basari",
      );
    });
  }
}

let refreshHandle: number | null = null;
/** Kendi DOM değişikliklerimiz gözlemciyi tetiklemesin diye kullanılan bayrak. */
let injecting = false;

/**
 * Yeniden tarama gecikmesi.
 * DÜZELTİLDİ (kod denetimi, bulgu 10): UYAP (PrimeFaces) sürekli kısmi güncelleme yapar;
 * 400 ms'lik debounce ağır listelerde her AJAX turunda TAM tablo parse'ı demekti.
 */
const REFRESH_DEBOUNCE_MS = 900;

function scheduleRefresh(): void {
  if (refreshHandle !== null) window.clearTimeout(refreshHandle);
  refreshHandle = window.setTimeout(() => {
    refreshHandle = null;
    try {
      const kinds = detectPageKinds(ctx());
      if (kinds.length === 0) return;
      void sendMessage({ type: "PAGE_DETECTED", kind: kinds.join(","), url: location.href });
      injecting = true;
      try {
        injectPanelButtons(kinds);
        injectRowButtons();
      } finally {
        injecting = false;
      }
    } catch (error) {
      console.warn("[nomosos-uyap] düğme enjeksiyonu başarısız:", error);
    }
  }, REFRESH_DEBOUNCE_MS);
}

/** Bu mutasyon bizim eklediğimiz düğüme mi ait? (kendi kendini tetiklemeyi önler) */
function isOwnMutation(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : null;
  if (target?.closest(`#${PANEL_ID}, #${BANNER_ID}, .${BUTTON_CLASS}, .${ROW_BUTTON_CLASS}`)) return true;
  for (const node of Array.from(record.addedNodes)) {
    if (!(node instanceof Element)) continue;
    if (
      node.id === PANEL_ID ||
      node.id === BANNER_ID ||
      node.classList.contains(BUTTON_CLASS) ||
      node.classList.contains(ROW_BUTTON_CLASS)
    ) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Başlatma                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const command = message as ContentCommand;
  if (command.type === "CONTENT_PING") {
    sendResponse({ kinds: detectPageKinds(ctx()), queuedFiles: 0, queuedEvents: 0, queuedDocuments: 0, errors: [] });
    return true;
  }
  if (command.type !== "CONTENT_SCAN") return false;

  void (async () => {
    const result = await runScan(command.trigger);
    setStatus(summarize(result), result.errors.length > 0 ? "hata" : "basari");
    sendResponse(result);
  })();
  return true;
});

async function init(): Promise<void> {
  const settings = await getSettings();
  if (!settings.injectButtons) return;

  scheduleRefresh();

  // UYAP kısmi (AJAX) güncellemeler yapar: DOM değişince düğmeleri yeniden kur.
  // Gözlem `document.body` ile sınırlıdır (head/script değişiklikleri ilgisizdir) ve
  // kendi enjeksiyonlarımız elenir; aksi halde her tur ek bir tam parse tetiklenir.
  const observer = new MutationObserver((records) => {
    if (injecting) return;
    if (records.every(isOwnMutation)) return;
    scheduleRefresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

void init();
