/**
 * Liste satırları — Bugün, Süreler, Görevler ve Dosya detayı aynı bileşenleri
 * paylaşır ki bir duruşma kartı ekrandan ekrana farklı görünmesin.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Body, Card, Muted } from "./components";
import { colors, font, space } from "./theme";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  DEADLINE_SOURCE_LABELS,
  DEADLINE_STATUS_LABELS,
  DEADLINE_STATUS_TONES,
  HEARING_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_TONES,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
  label,
  tone,
} from "@/lib/labels";
import { daysUntil, formatDay, formatLocalDate, formatTime, remainingLabel } from "@/lib/format";

/**
 * Kalan güne göre renk. SAHADA TEK BAKIŞTA OKUNUR:
 *   kırmızı = geçti veya bugün · amber = 1-3 gün · lacivert = 4-7 gün · gri = ötesi
 */
export function urgencyColor(dueDate: string | null | undefined): string {
  const days = daysUntil(dueDate);
  if (days === null) return colors.border;
  if (days <= 0) return colors.danger;
  if (days <= 3) return colors.gold;
  if (days <= 7) return colors.navyLighter;
  return colors.border;
}

// ---------------------------------------------------------------------------

export interface HearingRowData {
  id: string;
  date: string;
  type: string;
  courtroom?: string | null;
  caseTitle?: string | null;
  fileNumber?: string | null;
  courtName?: string | null;
  clientName?: string | null;
}

export function HearingRow({ item, onPress }: { item: HearingRowData; onPress?: () => void }) {
  return (
    <Card onPress={onPress} accent={colors.navy}>
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(item.date)}</Text>
        <View style={styles.timeMeta}>
          <Badge text={label(HEARING_TYPE_LABELS, item.type)} tone="navy" />
          {item.courtroom ? <Text style={styles.room}>{item.courtroom}</Text> : null}
        </View>
      </View>
      <Body style={styles.strong} numberOfLines={2}>
        {item.courtName ?? "Mahkeme belirtilmemiş"}
      </Body>
      <Muted numberOfLines={2}>
        {[item.fileNumber, item.caseTitle].filter(Boolean).join(" · ") || "Dosya bilgisi yok"}
      </Muted>
      {item.clientName ? <Muted numberOfLines={1}>Müvekkil: {item.clientName}</Muted> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export interface DeadlineRowData {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  source: string;
  legalBasis?: string | null;
  fileNumber?: string | null;
  caseTitle?: string | null;
}

export function DeadlineRow({
  item,
  onPress,
  footer,
}: {
  item: DeadlineRowData;
  onPress?: () => void;
  /** Hızlı aksiyon düğmeleri (Onayla / Reddet) buraya gelir. */
  footer?: React.ReactNode;
}) {
  const days = daysUntil(item.dueDate);
  const overdue = days !== null && days < 0;

  return (
    <Card onPress={onPress} accent={urgencyColor(item.dueDate)}>
      <View style={styles.headRow}>
        <Text style={[styles.remaining, overdue ? styles.remainingOverdue : null]}>
          {remainingLabel(item.dueDate)}
        </Text>
        <Text style={styles.dueDate}>{formatDay(item.dueDate)}</Text>
      </View>
      <Body style={styles.strong} numberOfLines={3}>
        {item.title}
      </Body>
      {item.legalBasis ? <Muted numberOfLines={2}>Dayanak: {item.legalBasis}</Muted> : null}
      <Muted numberOfLines={2}>
        {[item.fileNumber, item.caseTitle].filter(Boolean).join(" · ") || "Dosya bilgisi yok"}
      </Muted>
      <View style={styles.badgeRow}>
        <Badge text={label(DEADLINE_STATUS_LABELS, item.status)} tone={tone(DEADLINE_STATUS_TONES, item.status)} />
        {item.source === "AI_ONERISI" ? <Badge text="AI önerisi — onay bekliyor" tone="gold" /> : null}
        {item.source === "KURAL" ? <Badge text={label(DEADLINE_SOURCE_LABELS, item.source)} tone="blue" /> : null}
      </View>
      {footer}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export interface TaskRowData {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  caseTitle?: string | null;
}

export function TaskRow({ item, onPress, footer }: { item: TaskRowData; onPress?: () => void; footer?: React.ReactNode }) {
  return (
    <Card onPress={onPress} accent={item.dueDate ? urgencyColor(item.dueDate) : colors.border}>
      <Body style={styles.strong} numberOfLines={3}>
        {item.title}
      </Body>
      {item.caseTitle ? <Muted numberOfLines={1}>{item.caseTitle}</Muted> : null}
      {item.dueDate ? <Muted>Son tarih: {formatLocalDate(item.dueDate)} — {remainingLabel(item.dueDate)}</Muted> : null}
      <View style={styles.badgeRow}>
        <Badge text={label(TASK_STATUS_LABELS, item.status)} tone={tone(TASK_STATUS_TONES, item.status)} />
        <Badge text={label(TASK_PRIORITY_LABELS, item.priority)} tone={tone(TASK_PRIORITY_TONES, item.priority)} />
      </View>
      {footer}
    </Card>
  );
}

// ---------------------------------------------------------------------------

export interface CaseRowData {
  id: string;
  title: string;
  fileNumber?: string | null;
  courtName?: string | null;
  status?: string;
  clientName?: string | null;
}

export function CaseRow({ item, onPress }: { item: CaseRowData; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.headRow}>
        <Text style={styles.fileNumber}>{item.fileNumber ?? "Esas no yok"}</Text>
        {item.status ? (
          <Badge text={label(CASE_STATUS_LABELS, item.status)} tone={tone(CASE_STATUS_TONES, item.status)} />
        ) : null}
      </View>
      <Body style={styles.strong} numberOfLines={2}>
        {item.title}
      </Body>
      <Muted numberOfLines={2}>{[item.courtName, item.clientName].filter(Boolean).join(" · ") || "—"}</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
  },
  // Duruşma saati sahadaki en kritik rakamdır — uzaktan okunacak kadar büyük.
  time: { fontSize: 30, fontWeight: "800", color: colors.navy, letterSpacing: -0.8 },
  timeMeta: { alignItems: "flex-end", gap: 4 },
  room: { fontSize: font.small, fontWeight: "600", color: colors.textSoft },

  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.xs,
  },
  remaining: { fontSize: font.h3, fontWeight: "800", color: colors.navy },
  remainingOverdue: { color: colors.danger },
  dueDate: { fontSize: font.small, fontWeight: "600", color: colors.textMuted },
  fileNumber: { fontSize: font.small, fontWeight: "700", color: colors.textSoft },

  strong: { fontWeight: "600", marginBottom: 2 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
});
