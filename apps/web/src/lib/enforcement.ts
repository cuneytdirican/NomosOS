/**
 * İcra modülü API istemcisi — `/api/v1/enforcement/**` (Modül 05).
 *
 * SÖZLEŞME (docs/moduller/05-icra-modulu.md § API Uçları + Faz 3 şeması):
 *   GET/POST   /enforcement                     — liste / yeni takip
 *   GET/PATCH  /enforcement/:id                 — detay / künye güncelleme
 *   POST       /enforcement/:id/stage           — aşama geçişi (kural denetimli)
 *   GET/POST   /enforcement/:id/actions         — işlem günlüğü
 *   GET/POST   /enforcement/:id/assets          — malvarlığı
 *   PATCH      /enforcement/:id/assets/:assetId — malvarlığı durum güncelleme
 *   GET/POST   /enforcement/:id/collections     — tahsilatlar
 *   GET        /enforcement/:id/balance         — bakiye + hesap dökümü (SUNUCU hesabı)
 *   GET        /enforcement/:id/score           — güncel tahsilat skoru
 *   POST       /enforcement/:id/score/refresh   — skoru yeniden hesapla
 *   POST       /enforcement/:id/copilot         — ENF_* komutu
 *
 * PARA: hiçbir tutar burada hesaplanmaz. Bakiye, takip çıkışı ve kalan daima
 * `/balance` ucundan okunur; liste satırındaki toplamlar da sunucudan gelir.
 * Listede toplam gelmezse arayüz "—" gösterir, kendi toplamını UYDURMAZ.
 */

import { api, asList } from "@/lib/api";
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

export function listEnforcementFiles(query: EnforcementQuery = {}): Promise<EnforcementFile[]> {
  return api<unknown>("/enforcement", { query: { ...query } }).then((p) =>
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
  return api<EnforcementFile>("/enforcement", { method: "POST", body: clean(body) });
}

export function getEnforcementFile(id: string): Promise<EnforcementFile> {
  return api<EnforcementFile>(`/enforcement/${id}`);
}

export function updateEnforcementFile(
  id: string,
  patch: Partial<CreateEnforcementBody>,
): Promise<EnforcementFile> {
  return api<EnforcementFile>(`/enforcement/${id}`, { method: "PATCH", body: clean(patch) });
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
  return api<EnforcementFile>(`/enforcement/${id}/stage`, {
    method: "POST",
    body: clean({ stage, note }),
  });
}

// ------------------------------------------------------------------- bakiye

export function getBalance(id: string, asOf?: string): Promise<EnforcementBalance> {
  return api<EnforcementBalance>(`/enforcement/${id}/balance`, {
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
  return api<unknown>(`/enforcement/${id}/actions`).then((p) => asList<EnforcementAction>(p));
}

export interface CreateActionBody {
  type: EnforcementActionType;
  date: string;
  description: string;
  amount?: string;
  resultNote?: string;
}

export function createAction(id: string, body: CreateActionBody): Promise<EnforcementAction> {
  return api<EnforcementAction>(`/enforcement/${id}/actions`, {
    method: "POST",
    body: clean(body),
  });
}

// --------------------------------------------------------------- malvarlığı

export function listAssets(id: string): Promise<AssetRecord[]> {
  return api<unknown>(`/enforcement/${id}/assets`).then((p) => asList<AssetRecord>(p));
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
  return api<AssetRecord>(`/enforcement/${id}/assets`, { method: "POST", body: clean(body) });
}

export function updateAssetStatus(
  id: string,
  assetId: string,
  status: AssetStatus,
  note?: string,
): Promise<AssetRecord> {
  return api<AssetRecord>(`/enforcement/${id}/assets/${assetId}`, {
    method: "PATCH",
    body: clean({ status, note }),
  });
}

// --------------------------------------------------------------- tahsilatlar

export function listCollections(id: string): Promise<CollectionRecord[]> {
  return api<unknown>(`/enforcement/${id}/collections`).then((p) => asList<CollectionRecord>(p));
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
  return api<CollectionRecord>(`/enforcement/${id}/collections`, {
    method: "POST",
    body: clean(body),
  });
}

// -------------------------------------------------------------- skor/copilot

export function getScore(id: string): Promise<CollectionScore | null> {
  return api<CollectionScore | null>(`/enforcement/${id}/score`);
}

export function refreshScore(id: string): Promise<CollectionScore> {
  return api<CollectionScore>(`/enforcement/${id}/score/refresh`, { method: "POST", body: {} });
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
  return api<CopilotResult>(`/enforcement/${id}/copilot`, {
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
