/**
 * Sunucu yanıt tipleri — mobilin KULLANDIĞI alanlar kadarı.
 *
 * Bilinçli olarak dar tutulur: mobil salt-okur ağırlıklıdır, sunucu şeması
 * büyüdükçe burayı büyütmek gerekmez. Alanların çoğu `?` çünkü uçlar farklı
 * derinlikte `select` kullanır (liste özeti vs. detay).
 */

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface MeResponse extends AuthUser {
  barNumber?: string | null;
  isActive?: boolean;
  tenant?: { id: string; name: string } | null;
}

export interface UserBrief {
  id: string;
  fullName: string;
}

export interface ClientBrief {
  id: string;
  name: string;
  type?: string;
  phone?: string | null;
  email?: string | null;
}

export interface CaseBrief {
  id: string;
  title: string;
  fileNumber?: string | null;
  courtName?: string | null;
  type?: string;
  status?: string;
  client?: ClientBrief | null;
  responsibleUser?: UserBrief | null;
}

export interface CaseParty {
  id: string;
  role: string;
  name: string;
  isClient?: boolean;
  attorneyName?: string | null;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  detail?: string | null;
  source?: string;
  user?: UserBrief | null;
}

export interface DocumentBrief {
  id: string;
  name: string;
  class?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
}

export interface Hearing {
  id: string;
  caseId: string;
  type: string;
  status: string;
  /** ZAMAN DAMGALI — yerel saatle gösterilir. */
  date: string;
  courtroom?: string | null;
  /** Ara karar / duruşma sonucu özeti. */
  note?: string | null;
  /** Duruşma hazırlık brifingi — AI üretimi olabilir, "öneri" şeridiyle gösterilir. */
  prepSummary?: string | null;
  preparedAt?: string | null;
  case?: CaseBrief | null;
}

export interface Deadline {
  id: string;
  caseId: string;
  title: string;
  /** GÜN BAZLI (`@db.Date`) — UTC bileşenleriyle okunur. */
  dueDate: string;
  source: string;
  status: string;
  legalBasis?: string | null;
  computeNote?: string | null;
  ruleKey?: string | null;
  triggerDate?: string | null;
  owner?: UserBrief | null;
  case?: CaseBrief | null;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  caseId?: string | null;
  case?: CaseBrief | null;
  assignee?: UserBrief | null;
  reviewer?: UserBrief | null;
  /** Detay ucunda gelir; hızlı aksiyon düğmelerini bu belirler. */
  allowedStatusTransitions?: string[];
}

export interface CaseDetail extends CaseBrief {
  subject?: string | null;
  judgeName?: string | null;
  amount?: string | null;
  openedAt?: string;
  nextHearingAt?: string | null;
  lastActivityAt?: string | null;
  parties?: CaseParty[];
  hearings?: Hearing[];
  deadlines?: Deadline[];
  tasks?: Task[];
  documents?: DocumentBrief[];
  timelineEvents?: TimelineEvent[];
}

export interface DashboardSummary {
  scope: string;
  generatedAt: string;
  period?: { weekStart: string; weekEnd: string; criticalDays: number };
  hearingsThisWeek: { count: number; items: Hearing[] };
  criticalDeadlines: { count: number; items: Deadline[] };
  openTasks: { count: number; byStatus: Array<{ status: string; count: number }> };
  activeCases: { count: number; total: number };
  clientCount: number;
  myTasks: { count: number; overdue: number; items: Task[] };
  riskyDeadlines: { count: number; items: Deadline[] };
}

/**
 * Bildirim — NotificationOutbox kaydının mobil görünümü.
 * Bu ucu Zamanlı-iş modülü yayına alır; henüz yoksa istemci 404'ü nazikçe karşılar.
 */
export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  resourceType?: string | null;
  resourceId?: string | null;
  status: string;
  createdAt: string;
  sentAt?: string | null;
  readAt?: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
