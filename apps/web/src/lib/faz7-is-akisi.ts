/**
 * Faz 7C — iş akışı şablonları, toplu görev işlemi, kontrol/onay kuyruğu, iş yükü (istemci).
 */

import { api } from "@/lib/api";
import { WORKFLOW_ROUTES } from "@nomosos/shared";
import type { Task } from "@/lib/types";

export interface WorkflowItem {
  title: string;
  description?: string | null;
  priority: "DUSUK" | "NORMAL" | "YUKSEK" | "KRITIK";
  offsetDays: number;
  roleHint?: string | null;
  needsReview: boolean;
}

export interface WorkflowTemplateView {
  id: string | null;
  key: string;
  name: string;
  caseType: string | null;
  description: string | null;
  items: WorkflowItem[];
  isSystem: boolean;
  isActive: boolean;
}

export function listWorkflowTemplates(caseType?: string): Promise<WorkflowTemplateView[]> {
  return api<WorkflowTemplateView[]>(WORKFLOW_ROUTES.list, { query: caseType ? { caseType } : {} });
}

export function applyWorkflow(key: string, body: { caseId: string; assigneeId?: string | null; reviewerId?: string | null; startDate?: string; skip?: number[] }): Promise<{ ok: boolean; templateName: string; count: number; tasks: Array<{ id: string; title: string; dueDate: string }> }> {
  return api(WORKFLOW_ROUTES.apply(key), { method: "POST", body });
}

export interface BulkTaskBody {
  ids: string[];
  action: "STATUS" | "ASSIGN" | "PRIORITY" | "DUE";
  status?: string;
  note?: string;
  assigneeId?: string;
  priority?: string;
  dueDate?: string | null;
}

export function bulkTasks(body: BulkTaskBody): Promise<{ ok: number; okIds: string[]; failed: Array<{ id: string; message: string }> }> {
  return api(WORKFLOW_ROUTES.tasksBulk, { method: "POST", body });
}

export function fetchReviewQueue(): Promise<{ items: Task[]; total: number; canApprove: boolean }> {
  return api(WORKFLOW_ROUTES.reviewQueue);
}

export interface WorkloadRow {
  userId: string;
  fullName: string;
  open: number;
  overdue: number;
  critical: number;
  inReview: number;
  nextDue: string | null;
  workflows: number;
}

export function fetchWorkload(): Promise<{ items: WorkloadRow[]; totalOpen: number; totalOverdue: number }> {
  return api(WORKFLOW_ROUTES.workload);
}
