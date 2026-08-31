/**
 * "Bugün" ekranının çevrimdışı önbelleği.
 *
 * ---------------------------------------------------------------------------
 * TASARIM KARARI: TAM ÇEVRİMDIŞI SENKRON YOKTUR (proje kararı 5)
 * ---------------------------------------------------------------------------
 * Çift yönlü senkron, çakışma çözümü demektir; bir hukuk uygulamasında çakışma
 * çözümünün sessizce yanlış tarafı seçmesi süre kaçırmak demektir. Bu yüzden:
 *   - SADECE OKUMA önbelleğe alınır ve sadece "Bugün" ekranı için,
 *   - önbellek yaşlıdır ve bunu söyler ("çevrimdışı — son güncelleme 09:14"),
 *   - YAZMA İŞLEMLERİ KUYRUĞA ALINMAZ; bağlantı yoksa kullanıcıya açıkça
 *     "bağlantı gerekli" denir. Sessiz veri kaybı yoktur.
 *
 * ---------------------------------------------------------------------------
 * GİZLİLİK: NE SAKLANIR, NE SAKLANMAZ
 * ---------------------------------------------------------------------------
 * Önbellek uygulama sanal alanındaki düz bir JSON dosyasıdır (işletim
 * sisteminin disk şifrelemesi dışında ek şifreleme YOKTUR). Bu yüzden içine
 * yalnızca ekranda görünmesi ZORUNLU alanlar yazılır:
 *   ✓ duruşma saati/salonu, mahkeme adı, dosya esas no ve başlığı,
 *     müvekkil adı, süre başlığı ve tarihi, görev başlığı
 *   ✗ TCKN/vergi no, adres, telefon, e-posta  → hiç yazılmaz
 *   ✗ belge içeriği, safahat metni, AI hazırlık brifingi → hiç yazılmaz
 * Çıkışta ve 401'de dosya SİLİNİR.
 */

import * as FileSystem from "expo-file-system";
import type { Deadline, Hearing, Task } from "@/api/types";

const CACHE_FILE = "today-cache.v1.json";

/** Önbellekte tutulan indirgenmiş duruşma kaydı. */
export interface CachedHearing {
  id: string;
  date: string;
  type: string;
  courtroom: string | null;
  caseId: string | null;
  caseTitle: string | null;
  fileNumber: string | null;
  courtName: string | null;
  clientName: string | null;
}

export interface CachedDeadline {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  source: string;
  caseId: string | null;
  fileNumber: string | null;
  caseTitle: string | null;
}

export interface CachedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  caseTitle: string | null;
}

export interface TodaySnapshot {
  /** Anlık görüntünün alındığı an (ISO). Banner'da saat olarak gösterilir. */
  capturedAt: string;
  /** Hangi kullanıcıya ait — başka kullanıcı giriş yaparsa önbellek kullanılmaz. */
  userId: string;
  hearings: CachedHearing[];
  deadlines: CachedDeadline[];
  tasks: CachedTask[];
}

function cacheUri(): string | null {
  const dir = FileSystem.documentDirectory;
  return dir ? `${dir}${CACHE_FILE}` : null;
}

/** Sunucu yanıtını gizlilik sınırlarına göre kırpar. */
export function buildSnapshot(
  userId: string,
  hearings: Hearing[],
  deadlines: Deadline[],
  tasks: Task[],
): TodaySnapshot {
  return {
    capturedAt: new Date().toISOString(),
    userId,
    hearings: hearings.map((h) => ({
      id: h.id,
      date: h.date,
      type: h.type,
      courtroom: h.courtroom ?? null,
      caseId: h.case?.id ?? h.caseId ?? null,
      caseTitle: h.case?.title ?? null,
      fileNumber: h.case?.fileNumber ?? null,
      courtName: h.case?.courtName ?? null,
      clientName: h.case?.client?.name ?? null,
    })),
    deadlines: deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      dueDate: d.dueDate,
      status: d.status,
      source: d.source,
      caseId: d.case?.id ?? d.caseId ?? null,
      fileNumber: d.case?.fileNumber ?? null,
      caseTitle: d.case?.title ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate ?? null,
      caseTitle: t.case?.title ?? null,
    })),
  };
}

export async function saveSnapshot(snapshot: TodaySnapshot): Promise<void> {
  const uri = cacheUri();
  if (!uri) return;
  try {
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(snapshot), {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    /* Önbellek yazılamazsa uygulama çevrimiçi çalışmaya devam eder. */
  }
}

/**
 * Önbelleği okur. Başka bir kullanıcıya aitse (cihaz devredilmiş, ikinci
 * avukat giriş yapmış) DÖNDÜRMEZ ve siler — bir kullanıcı diğerinin dosya
 * listesini görmemelidir.
 */
export async function loadSnapshot(userId: string): Promise<TodaySnapshot | null> {
  const uri = cacheUri();
  if (!uri) return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
    const parsed = JSON.parse(raw) as TodaySnapshot;
    if (!parsed || typeof parsed !== "object" || parsed.userId !== userId) {
      await clearSnapshot();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Çıkışta ve oturum düştüğünde çağrılır — cihazda müvekkil izi bırakılmaz. */
export async function clearSnapshot(): Promise<void> {
  const uri = cacheUri();
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* yoksay */
  }
}
