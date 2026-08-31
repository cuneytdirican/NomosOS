/**
 * İcra modülü API istemcisi — `/api/v1/enforcement/**` (Modül 05).
 *
 * UÇ ADLARI `@nomosos/shared` İÇİNDEKİ TEK TABLODAN GELİR (`ENFORCEMENT_ROUTES`).
 *
 * GERÇEK SÖZLEŞME (enforcement.controller.ts):
 *   GET/POST   /enforcement                 — liste / yeni takip
 *   GET/PATCH  /enforcement/:id             — detay / künye güncelleme
 *   PATCH      /enforcement/:id/stage       — aşama geçişi (kural denetimli)
 *   GET/POST   /enforcement/:id/actions     — işlem günlüğü
 *   GET/POST   /enforcement/:id/assets      — malvarlığı
 *   PATCH      /assets/:assetId             — malvarlığı güncelleme (DOSYADAN BAĞIMSIZ)
 *   GET/POST   /enforcement/:id/collections — tahsilatlar
 *   GET        /enforcement/:id/balance     — bakiye + hesap dökümü (SUNUCU hesabı)
 *   GET        /enforcement/:id/score       — son tahsilat skoru
 *   POST       /enforcement/:id/copilot     — ENF_* komutu (skoru da BU üretir)
 *
 * Önceki sürüm `/enforcement/:id/assets/:assetId` ve `/enforcement/:id/score/refresh`
 * çağırıyordu; ikisi de API'de YOK (denetim bulgusu 12). Skorun ayrı bir
 * "yenile" ucu hiç olmadı — skor `TAHSILAT_IHTIMALI` komutuyla üretilir.
 *
 * PARA: hiçbir tutar burada hesaplanmaz. Bakiye, takip çıkışı ve kalan daima
 * `/balance` ucundan okunur; liste satırındaki toplamlar da sunucudan gelir.
 * Listede toplam gelmezse arayüz "—" gösterir, kendi toplamını UYDURMAZ.
 */

import { ENFORCEMENT_ROUTES } from "@nomosos/shared";
import { api, asList, fetchPaged, type PagedResult } from "@/lib/api";
import type {
  AssetRecord,
  AssetStatus,
  AssetType,
  CollectionMethod,
  CollectionRecord,
  CollectionScore,
  CopilotCommand,
  CopilotResult,
  EnforcementAction,
  EnforcementActionType,
  EnforcementBalance,
  EnforcementFile,
  EnforcementStage,
  EnforcementType,
  RuleSignal,
} from "@/lib/faz3-types";

// -------------------------------------------------------------------- liste

export interface EnforcementQuery {
  stage?: string;
  trackingType?: string;
  clientId?: string;
  q?: string;
  limit?: number;
}

/**
 * İcra dosyaları — SAYFALAMA ZARFIYLA (denetim bulgusu K-15).
 * `limit: 200` isteyip `total`'i atmak, 200'den fazla takibi olan büroda
 * dosyaların sessizce kaybolması demekti.
 */
export async function listEnforcementFilesPaged(
  query: EnforcementQuery & { page?: number } = {},
): Promise<PagedResult<EnforcementFile>> {
  const { page, limit, ...filters } = query;
  return fetchPaged<EnforcementFile>(ENFORCEMENT_ROUTES.list, {
    query: { ...filters },
    page,
    limit,
  });
}

export function listEnforcementFiles(query: EnforcementQuery = {}): Promise<EnforcementFile[]> {
  return api<unknown>(ENFORCEMENT_ROUTES.list, { query: { ...query } }).then((p) =>
    asList<EnforcementFile>(p),
  );
}

export interface CreateEnforcementBody {
  /** İcra dosyası bir Case'e 1:1 bağlıdır; Case tipi ICRA olmalıdır. */
  caseId: string;
  officeName: string;
  fileNumber: string;
  trackingType: EnforcementType;
  /** Decimal(18,2) — STRING gönderilir, Number DEĞİL. */
  principalAmount: string;
  interestRate?: string;
  currency?: string;
  requestDate: string;
  debtorInfo?: string;
}

export function createEnforcementFile(body: CreateEnforcementBody): Promise<EnforcementFile> {
  return api<EnforcementFile>(ENFORCEMENT_ROUTES.list, { method: "POST", body: clean(body) });
}

export function getEnforcementFile(id: string): Promise<EnforcementFile> {
  return api<EnforcementFile>(ENFORCEMENT_ROUTES.detail(id));
}

export function updateEnforcementFile(
  id: string,
  patch: Partial<CreateEnforcementBody>,
): Promise<EnforcementFile> {
  return api<EnforcementFile>(ENFORCEMENT_ROUTES.detail(id), { method: "PATCH", body: clean(patch) });
}

/**
 * Aşama geçişi. Sunucu tek yönlü şerit kurallarını uygular (örn. itirazlı
 * dosyada doğrudan HACIZ'e geçiş 422, haciz tutanağı olmadan SATIS engelli);
 * arayüz geçişi kendi başına ONAYLAMAZ, hatayı olduğu gibi gösterir.
 */
export function changeStage(
  id: string,
  stage: EnforcementStage,
  note?: string,
): Promise<EnforcementFile> {
  return api<EnforcementFile>(ENFORCEMENT_ROUTES.stage(id), {
    method: "POST",
    body: clean({ stage, note }),
  });
}

// ------------------------------------------------------------------- bakiye

export function getBalance(id: string, asOf?: string): Promise<EnforcementBalance> {
  return api<EnforcementBalance>(ENFORCEMENT_ROUTES.balance(id), {
    query: { asOf: asOf || undefined },
  });
}

/** Hesap dökümü adımları — alan adı `steps` ya da `calculationSteps` olabilir. */
export function balanceSteps(b: EnforcementBalance | null): NonNullable<EnforcementBalance["steps"]> {
  if (!b) return [];
  return b.steps ?? b.calculationSteps ?? [];
}

// ------------------------------------------------------------------ işlemler

export function listActions(id: string): Promise<EnforcementAction[]> {
  return api<unknown>(ENFORCEMENT_ROUTES.actions(id)).then((p) => asList<EnforcementAction>(p));
}

export interface CreateActionBody {
  type: EnforcementActionType;
  date: string;
  description: string;
  amount?: string;
  resultNote?: string;
}

export function createAction(id: string, body: CreateActionBody): Promise<EnforcementAction> {
  return api<EnforcementAction>(ENFORCEMENT_ROUTES.actions(id), {
    method: "POST",
    body: clean(body),
  });
}

// --------------------------------------------------------------- malvarlığı

export function listAssets(id: string): Promise<AssetRecord[]> {
  return api<unknown>(ENFORCEMENT_ROUTES.assets(id)).then((p) => asList<AssetRecord>(p));
}

export interface CreateAssetBody {
  assetType: AssetType;
  description: string;
  estimatedValue?: string;
  status?: AssetStatus;
  discoveredAt: string;
  note?: string;
}

export function createAsset(id: string, body: CreateAssetBody): Promise<AssetRecord> {
  return api<AssetRecord>(ENFORCEMENT_ROUTES.assets(id), { method: "POST", body: clean(body) });
}

/**
 * Malvarlığı durum güncelleme.
 *
 * UÇ DOSYADAN BAĞIMSIZDIR: `PATCH /assets/:assetId`. Kiracı doğrulaması
 * sunucuda `requireAsset` ile kayıt üzerinden yapılır; dosya kimliği yola
 * girmez. `id` parametresi imzada KORUNUR (çağıranlar dosya bağlamında
 * çalışıyor) ama yol kurmakta kullanılmaz.
 */
export function updateAssetStatus(
  id: string,
  assetId: string,
  status: AssetStatus,
  note?: string,
): Promise<AssetRecord> {
  void id;
  return api<AssetRecord>(ENFORCEMENT_ROUTES.asset(assetId), {
    method: "PATCH",
    body: clean({ status, note }),
  });
}

// --------------------------------------------------------------- tahsilatlar

export function listCollections(id: string): Promise<CollectionRecord[]> {
  return api<unknown>(ENFORCEMENT_ROUTES.collections(id)).then((p) => asList<CollectionRecord>(p));
}

export interface CreateCollectionBody {
  amount: string;
  date: string;
  method: CollectionMethod;
  note?: string;
}

/**
 * Tahsilat kaydı. Sunucu aynı işlemde FinancialEntry üretir ve müvekkil
 * bakiyesini günceller; istemci hiçbir toplamı kendisi güncellemez, kayıt
 * sonrası bakiyeyi `/balance` ucundan YENİDEN OKUR.
 */
export function createCollection(
  id: string,
  body: CreateCollectionBody,
): Promise<CollectionRecord> {
  return api<CollectionRecord>(ENFORCEMENT_ROUTES.collections(id), {
    method: "POST",
    body: clean(body),
  });
}

// -------------------------------------------------------------- skor/copilot

export function getScore(id: string): Promise<CollectionScore | null> {
  return api<CollectionScore | null>(ENFORCEMENT_ROUTES.score(id));
}

/**
 * Skoru YENİDEN HESAPLAR.
 *
 * Ayrı bir "refresh" ucu YOKTUR ve olmamalıdır: skor, copilot'un
 * `TAHSILAT_IHTIMALI` komutunun ürünüdür — kural motoru taban skoru üretir, AI
 * yalnızca ±15 puanlık bir düzeltme ÖNERİR ve BANDI DEĞİŞTİREMEZ. Hesabı
 * komuttan ayırmak, skorun nasıl doğduğunu görünmez kılardı.
 *
 * Komut dış sağlayıcıya gidebileceği için KVKK 409 (`requiresPiiApproval`)
 * akışına tabidir; çağıran taraf `piiApproved` ile ikinci turu yapar.
 */
export function refreshScore(id: string, piiApproved = false): Promise<CopilotResult> {
  return api<CopilotResult>(ENFORCEMENT_ROUTES.copilot(id), {
    method: "POST",
    body: { command: "TAHSILAT_IHTIMALI", piiApproved },
  });
}

export interface CopilotInput {
  command: CopilotCommand;
  params?: Record<string, unknown>;
  piiApproved?: boolean;
}

/**
 * İcra Copilot. Çıktı ÖNERİDİR: sunucu bu çağrıdan hiçbir EnforcementAction,
 * Task veya süre kaydı yazmaz (Modül 05 iş kuralı 8).
 *
 * KVKK: borçlu kimlik/IBAN bilgisi dış sağlayıcıya giderken maskelenir; sunucu
 * 409 `requiresPiiApproval` dönerse çağıran `piiApproved: true` ile tekrarlar.
 */
export function runCopilot(id: string, input: CopilotInput): Promise<CopilotResult> {
  return api<CopilotResult>(ENFORCEMENT_ROUTES.copilot(id), {
    method: "POST",
    body: clean({
      command: input.command,
      params: input.params,
      ...(input.piiApproved ? { piiApproved: true } : {}),
    }),
  });
}

/** Copilot metnini tek biçime indirger. */
export function copilotText(res: CopilotResult | null): string {
  if (!res) return "";
  return res.summary ?? res.text ?? res.content ?? "";
}

/** Kural sinyalleri — skor nesnesinde dizi ya da JSON string olabilir. */
export function ruleSignalsOf(score: CollectionScore | null | undefined): RuleSignal[] {
  if (!score) return [];
  if (Array.isArray(score.ruleSignals)) return score.ruleSignals;
  const raw = score.ruleSignalsJson;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RuleSignal[];
      if (parsed && typeof parsed === "object") {
        // { signals: [...] } sarmalayıcısı
        const inner = (parsed as Record<string, unknown>).signals;
        if (Array.isArray(inner)) return inner as RuleSignal[];
        // { anahtar: değer } sözlüğü
        return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
          key,
          label: key,
          value: value as RuleSignal["value"],
        }));
      }
    } catch {
      return [];
    }
  }
  return [];
}

// ------------------------------------------------------------------ yardımcı

/** Boş/undefined alanları gövdeden düşürür (Zod "" değerini reddeder). */
function clean(body: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}
