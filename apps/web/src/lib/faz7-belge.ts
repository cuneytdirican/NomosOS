/**
 * Faz 7A — belge sürümleri, klasörler, paylaşım bağlantıları ve e-posta belge girişi (istemci).
 */

import { API_BASE, ApiError, api, getToken } from "@/lib/api";
import { DOCUMENTS_ROUTES, MAIL_INGEST_ROUTES } from "@nomosos/shared";
import type { DocumentItem } from "@/lib/types";

export interface FolderInfo {
  path: string;
  count: number;
}

export function listDocumentFolders(caseId?: string): Promise<FolderInfo[]> {
  return api<FolderInfo[]>(DOCUMENTS_ROUTES.folders, { query: caseId ? { caseId } : {} });
}

export function moveDocument(id: string, folderPath: string): Promise<{ id: string; folderPath: string }> {
  return api(DOCUMENTS_ROUTES.move(id), { method: "POST", body: { folderPath } });
}

export interface DocumentVersionRow {
  id: string;
  name: string;
  versionNo: number;
  sizeBytes: number | null;
  mimeType: string | null;
  uploadedBy: string | null;
  createdAt: string;
  supersededAt: string | null;
  hash: string | null;
}

export function listDocumentVersions(id: string): Promise<{ rootDocumentId: string; current: string | null; items: DocumentVersionRow[] }> {
  return api(DOCUMENTS_ROUTES.versions(id));
}

/** Yeni sürüm: multipart; ilerleme geri çağrısı XHR ile. */
export function uploadDocumentVersion(id: string, file: File, note?: string, onProgress?: (p: number) => void): Promise<{ document: DocumentItem; previousId: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (note) form.append("note", note);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/v1${DOCUMENTS_ROUTES.versions(id)}`);
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { document: DocumentItem; previousId: string });
      else reject(new ApiError((data as { message?: string } | null)?.message ?? `Sürüm yüklenemedi (HTTP ${xhr.status}).`, xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError("API sunucusuna ulaşılamadı.", 0, null));
    xhr.send(form);
  });
}

export interface ShareLinkCreated {
  id: string;
  url: string;
  expiresAt: string;
  maxDownloads: number | null;
  note: string | null;
}

export interface ShareLinkRow {
  id: string;
  expiresAt: string;
  maxDownloads: number | null;
  downloads: number;
  note: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastAccessAt: string | null;
  durum: "AKTIF" | "IPTAL" | "SURESI_DOLDU" | "TUKENDI";
}

export function createShareLink(id: string, body: { ttlHours: number; maxDownloads?: number | null; note?: string | null }): Promise<ShareLinkCreated> {
  return api(DOCUMENTS_ROUTES.share(id), { method: "POST", body });
}

export function listShareLinks(id: string): Promise<ShareLinkRow[]> {
  return api(DOCUMENTS_ROUTES.shares(id));
}

export function revokeShareLink(shareId: string): Promise<{ ok: boolean }> {
  return api(DOCUMENTS_ROUTES.revokeShare(shareId), { method: "DELETE" });
}

// ------------------------------------------------------------ e-posta belge girişi

export interface MailIngestConfigView {
  configured: boolean;
  id?: string;
  enabled: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  folder?: string;
  defaultCaseId?: string | null;
  lastUid?: number;
  lastSyncAt?: string | null;
  lastError?: string | null;
  lastSummary?: string | null;
  hasPassword?: boolean;
}

export function getMailIngest(): Promise<MailIngestConfigView> {
  return api(MAIL_INGEST_ROUTES.get);
}

export function saveMailIngest(body: { enabled: boolean; host: string; port: number; secure: boolean; username: string; password?: string | null; folder: string; defaultCaseId?: string | null }): Promise<MailIngestConfigView> {
  return api(MAIL_INGEST_ROUTES.upsert, { method: "PUT", body });
}

export function removeMailIngest(): Promise<{ ok: boolean }> {
  return api(MAIL_INGEST_ROUTES.remove, { method: "DELETE" });
}

export function testMailIngest(): Promise<{ ok: boolean; message: string; exists?: number }> {
  return api(MAIL_INGEST_ROUTES.test, { method: "POST" });
}

export function runMailIngest(): Promise<{ messages: number; documents: number; matched: number; triage: number; skipped: number; errors: string[] }> {
  return api(MAIL_INGEST_ROUTES.run, { method: "POST" });
}
