/**
 * /dosya/[id] — dosya künyesi, taraflar, safahat, süreler, belgeler.
 *
 * SALT OKUR. Tek dış eylem belge indirmedir; o da sunucudan SÜRELİ İMZALI URL
 * ister ve sunucu bunu denetim günlüğüne yazar (belgeye kim, ne zaman erişti).
 * Belge cihaza kalıcı olarak indirilmez, sistem tarayıcısında açılır: kaybolan
 * bir telefonun indirilenler klasöründe müvekkil belgesi bırakmayız.
 *
 * Finans bilgisi (tahsilat, masraf, vekâlet ücreti) bu ekranda YOKTUR —
 * rol kısıtları sunucuda uygulanır ve mobilde bu alana hiç girilmez.
 */

import React, { useCallback, useState } from "react";
import { Linking, RefreshControl, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { errorMessage } from "@/api/client";
import { fetchCase, requestDocumentUrl } from "@/api/endpoints";
import { useOnline } from "@/net/connectivity";
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONES,
  CASE_TYPE_LABELS,
  PARTY_ROLE_LABELS,
  label,
  tone,
} from "@/lib/labels";
import { formatDay, formatLocalDate, formatMoney, formatTime } from "@/lib/format";
import {
  Badge,
  Body,
  Card,
  DesktopOnlyNote,
  Divider,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Muted,
  ScrollScreen,
  Section,
} from "@/ui/components";
import { DeadlineRow } from "@/ui/list-items";
import { colors, font, radius, space } from "@/ui/theme";
import { useLoad } from "@/hooks/use-load";

/** Safahatta gösterilecek kayıt sayısı — koridorda son hareketler yeter. */
const TIMELINE_LIMIT = 15;

export default function CaseDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const online = useOnline();
  const caseId = typeof id === "string" ? id : "";

  const { data, error, loading, reload } = useLoad(() => fetchCase(caseId), [caseId]);
  const [docError, setDocError] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);

  const openDocument = useCallback(
    async (documentId: string) => {
      if (!online) {
        setDocError("Bağlantı gerekli. Belgeler cihazda saklanmaz, sunucudan açılır.");
        return;
      }
      setOpeningDocId(documentId);
      setDocError(null);
      try {
        const result = await requestDocumentUrl(documentId);
        const canOpen = await Linking.canOpenURL(result.url);
        if (!canOpen) {
          setDocError("Belge bu cihazda açılamıyor. Büro panelinden görüntüleyin.");
          return;
        }
        await Linking.openURL(result.url);
      } catch (caught) {
        setDocError(errorMessage(caught));
      } finally {
        setOpeningDocId(null);
      }
    },
    [online],
  );

  if (loading && data === null) return <Loading label="Dosya alınıyor…" />;
  if (error !== null && data === null) return <ErrorState message={error} onRetry={reload} />;
  if (data === null) return <ErrorState message="Dosya bulunamadı." onRetry={reload} />;

  const openDeadlines = (data.deadlines ?? []).filter(
    (deadline) => deadline.status === "BEKLIYOR" || deadline.status === "ONAYLANDI",
  );
  const upcomingHearings = (data.hearings ?? []).filter((hearing) => hearing.status === "PLANLANDI");
  const timeline = (data.timelineEvents ?? []).slice(0, TIMELINE_LIMIT);

  return (
    <>
      <Stack.Screen options={{ title: data.fileNumber ?? "Dosya" }} />
      <ScrollScreen refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.navy} />}>
        <Card>
          <View style={styles.headRow}>
            <Body style={styles.fileNumber}>{data.fileNumber ?? "Esas no girilmemiş"}</Body>
            {data.status ? (
              <Badge text={label(CASE_STATUS_LABELS, data.status)} tone={tone(CASE_STATUS_TONES, data.status)} />
            ) : null}
          </View>
          <Body style={styles.title}>{data.title}</Body>
          <Divider />
          <Field label="Mahkeme / Daire" value={data.courtName ?? "—"} />
          <Field label="Dosya türü" value={label(CASE_TYPE_LABELS, data.type)} />
          <Field label="Müvekkil" value={data.client?.name ?? "—"} />
          <Field label="Sorumlu" value={data.responsibleUser?.fullName ?? "—"} />
          {data.subject ? <Field label="Konu" value={data.subject} /> : null}
          {data.amount ? <Field label="Dava değeri / takip tutarı" value={formatMoney(data.amount)} /> : null}
          {data.nextHearingAt ? (
            <Field label="Sonraki duruşma" value={`${formatLocalDate(data.nextHearingAt)} ${formatTime(data.nextHearingAt)}`} />
          ) : null}
        </Card>

        <Section title="Taraflar">
          {(data.parties ?? []).length === 0 ? (
            <EmptyState title="Taraf kaydı yok." />
          ) : (
            <Card>
              {(data.parties ?? []).map((party, index) => (
                <View key={party.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.partyRow}>
                    <Badge text={label(PARTY_ROLE_LABELS, party.role)} tone="navy" />
                    <View style={styles.partyText}>
                      <Body>{party.name}</Body>
                      {party.attorneyName ? <Muted>Vekili: {party.attorneyName}</Muted> : null}
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          )}
        </Section>

        <Section title="Planlanan duruşmalar">
          {upcomingHearings.length === 0 ? (
            <EmptyState title="Planlanmış duruşma yok." />
          ) : (
            upcomingHearings.map((hearing) => (
              <Card key={hearing.id} onPress={() => router.push(`/durusma/${hearing.id}`)} accent={colors.navy}>
                <Body style={styles.hearingDate}>
                  {formatLocalDate(hearing.date)} · {formatTime(hearing.date)}
                </Body>
                <Muted>{hearing.courtroom ? `Salon ${hearing.courtroom}` : "Salon belirtilmemiş"}</Muted>
              </Card>
            ))
          )}
        </Section>

        <Section title="Açık süreler">
          {openDeadlines.length === 0 ? (
            <EmptyState title="Açık süre yok." />
          ) : (
            openDeadlines.map((deadline) => (
              <DeadlineRow
                key={deadline.id}
                item={{
                  id: deadline.id,
                  title: deadline.title,
                  dueDate: deadline.dueDate,
                  status: deadline.status,
                  source: deadline.source,
                  legalBasis: deadline.legalBasis ?? null,
                  fileNumber: null,
                  caseTitle: null,
                }}
              />
            ))
          )}
        </Section>

        <Section title="Safahat">
          {timeline.length === 0 ? (
            <EmptyState title="Safahat kaydı yok." />
          ) : (
            <Card>
              {timeline.map((event, index) => (
                <View key={event.id}>
                  {index > 0 ? <Divider /> : null}
                  <Muted>{formatDay(event.date)}</Muted>
                  <Body style={styles.timelineTitle}>{event.title}</Body>
                  {event.detail ? <Muted>{event.detail}</Muted> : null}
                </View>
              ))}
              {(data.timelineEvents ?? []).length > TIMELINE_LIMIT ? (
                <Muted style={styles.more}>
                  Son {TIMELINE_LIMIT} kayıt gösteriliyor. Tamamı için büro panelini kullanın.
                </Muted>
              ) : null}
            </Card>
          )}
        </Section>

        <Section title="Belgeler">
          {docError ? (
            <View style={styles.docError}>
              <Body style={styles.docErrorText}>{docError}</Body>
            </View>
          ) : null}
          {(data.documents ?? []).length === 0 ? (
            <EmptyState title="Belge yok." />
          ) : (
            (data.documents ?? []).map((document) => (
              <Card
                key={document.id}
                onPress={() => void openDocument(document.id)}
                accent={openingDocId === document.id ? colors.gold : undefined}
              >
                <Body numberOfLines={2}>{document.name}</Body>
                <Muted>
                  {formatLocalDate(document.createdAt)}
                  {openingDocId === document.id ? " · açılıyor…" : " · açmak için dokunun"}
                </Muted>
              </Card>
            ))
          )}
          <Muted style={styles.docNote}>
            Belgeler cihaza indirilmez; sunucudan süreli bağlantıyla açılır ve her erişim denetim günlüğüne yazılır.
          </Muted>
        </Section>

        <DesktopOnlyNote what="Dilekçe üretimi, belge yükleme, finans ve fatura işlemleri" />
      </ScrollScreen>
    </>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.sm },
  fileNumber: { fontWeight: "700", color: colors.textSoft },
  title: { fontSize: font.h2, fontWeight: "700", lineHeight: 26 },
  partyRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.xs },
  partyText: { flex: 1 },
  hearingDate: { fontWeight: "700", fontSize: font.h3 },
  timelineTitle: { fontWeight: "600", marginTop: 2 },
  more: { marginTop: space.md, fontStyle: "italic" },
  docNote: { marginTop: space.sm },
  docError: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  docErrorText: { color: "#7F1D1D", fontSize: font.small, lineHeight: 20 },
});
