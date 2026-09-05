/**
 * NomosOS backend istemcisi — docs/05-uyap-entegrasyonu.md § "Backend API sözleşmesi".
 *
 * POST /api/v1/uyap/pair                 → eşleştirme (auth.ts)
 * POST /api/v1/uyap/sync/files           → dosya listesi/fark bildirimi
 * POST /api/v1/uyap/sync/events          → safahat (+ duruşma) kayıtları
 * POST /api/v1/uyap/documents/presign    → evrak için ön-imzalı yükleme adresi
 * POST /api/v1/uyap/documents/commit     → yükleme sonrası meta + hash → olay yayını
 * GET  /api/v1/uyap/status               → izlenen dosyalar, son senkron, kuyruk durumu
 *
 * Tüm çağrılar extension token ile imzalıdır; eklenti başka hiçbir servise konuşmaz.
 */

import { UYAP_API_PATHS, forceRefresh, getSession, getValidAccessToken } from "./auth";
import { ApiError, messageForCode } from "./errors";
import { assertAllowedUploadUrl, requestJson, uploadBinary } from "./http";
import type {
  CommitRequest,
  CommitResponse,
  PresignRequest,
  PresignResponse,
  StatusResponse,
  SyncEventsRequest,
  SyncEventsResponse,
  SyncFilesRequest,
  SyncFilesResponse,
  ReadyPetitionsResponse,
  PetitionUdfResponse,
} from "../types/dto";

async function authedRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const { token, session } = await getValidAccessToken();
  const url = `${session.apiBaseUrl}${path}`;
  try {
    return await requestJson<T>({ method, url, body, accessToken: token });
  } catch (error) {
    // Jeton sunucu tarafında iptal edilmiş olabilir: bir kez zorla yenile ve tekrar dene.
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
      const refreshed = await forceRefresh();
      if (!refreshed) throw error;
      return requestJson<T>({ method, url, body, accessToken: refreshed });
    }
    throw error;
  }
}

/** Eşleştirilmiş sunucu adresini döndürür; eşleştirme yoksa hata. */
export async function requireBaseUrl(): Promise<string> {
  const session = await getSession();
  if (!session) throw new ApiError("NOT_PAIRED", messageForCode("NOT_PAIRED"), null, false);
  return session.apiBaseUrl;
}

export async function syncFiles(payload: SyncFilesRequest): Promise<SyncFilesResponse> {
  return authedRequest<SyncFilesResponse>("POST", UYAP_API_PATHS.syncFiles, payload);
}

export async function syncEvents(payload: SyncEventsRequest): Promise<SyncEventsResponse> {
  return authedRequest<SyncEventsResponse>("POST", UYAP_API_PATHS.syncEvents, payload);
}

export async function presignDocument(payload: PresignRequest): Promise<PresignResponse> {
  return authedRequest<PresignResponse>("POST", UYAP_API_PATHS.presign, payload);
}

export async function commitDocument(payload: CommitRequest): Promise<CommitResponse> {
  return authedRequest<CommitResponse>("POST", UYAP_API_PATHS.commit, payload);
}

export async function fetchStatus(): Promise<StatusResponse> {
  return authedRequest<StatusResponse>("GET", UYAP_API_PATHS.status);
}

/**
 * Evrak aktarımının tam akışı: presign → (gerekiyorsa) yükle → commit.
 * Aynı içerik hash'i sunucuda varsa yükleme atlanır ve yeni pipeline koşumu açılmaz.
 */
export async function transferDocument(input: {
  readonly presign: PresignRequest;
  readonly bytes: Uint8Array;
  readonly evrakTuru: string | null;
  readonly evrakTarihi: string | null;
  readonly gonderen: string | null;
}): Promise<CommitResponse> {
  const session = await getSession();
  if (!session) throw new ApiError("NOT_PAIRED", messageForCode("NOT_PAIRED"), null, false);

  const presigned = await presignDocument(input.presign);
  if (!presigned || typeof presigned.storageKey !== "string" || presigned.storageKey.length === 0) {
    throw new ApiError("SERVER", "Sunucu geçerli bir yükleme yanıtı döndürmedi.", null, true);
  }

  if (!presigned.duplicate) {
    if (!presigned.uploadUrl) {
      throw new ApiError("SERVER", "Sunucu yükleme adresi döndürmedi.", null, true);
    }
    // KVKK/güvenlik kapısı: bayt göndermeden ÖNCE hedef host doğrulanır (bulgu 10).
    const verified = assertAllowedUploadUrl(
      presigned.uploadUrl,
      session.apiBaseUrl,
      session.storageHosts ?? [],
    );
    await uploadBinary(verified.toString(), presigned.method, input.bytes, presigned.headers);
  }

  const commit: CommitRequest = {
    client: input.presign.client,
    storageKey: presigned.storageKey,
    uyapDosyaNo: input.presign.uyapDosyaNo,
    uyapEvrakId: input.presign.uyapEvrakId,
    fileName: input.presign.fileName,
    mimeType: input.presign.mimeType,
    sizeBytes: input.presign.sizeBytes,
    contentHash: input.presign.contentHash,
    evrakTuru: input.evrakTuru,
    evrakTarihi: input.evrakTarihi,
    gonderen: input.gonderen,
  };
  return commitDocument(commit);
}

/** Faz 7D — UYAP'a gönderilmeye hazır dilekçeler. */
export async function fetchReadyPetitions(): Promise<ReadyPetitionsResponse> {
  return authedRequest<ReadyPetitionsResponse>("GET", "/api/v1/uyap/petitions/ready");
}

/** Faz 7D — dilekçe UDF'si için süreli indirme bağlantısı. */
export async function exportPetitionUdf(petitionId: string): Promise<PetitionUdfResponse> {
  return authedRequest<PetitionUdfResponse>("POST", `/api/v1/uyap/petitions/${encodeURIComponent(petitionId)}/udf`);
}
