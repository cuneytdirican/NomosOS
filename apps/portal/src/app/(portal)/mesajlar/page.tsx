"use client";

/**
 * Mesajlar — müvekkil ile büro arasındaki yazışma.
 *
 * ÜRÜN İLKESİ (ortak karar 3): giden mesajda insan onayı zorunludur. Avukat
 * tarafında AI taslak yazabilir, ama onaylanmamış hiçbir mesaj gönderilmez —
 * dolayısıyla bu ekrana da DÜŞMEZ. Müvekkile bu durum açıkça anlatılır ki
 * "yazdım, neden cevap gelmedi" beklentisi doğru kurulsun.
 *
 * Müvekkilin yazdığı mesaj büro tarafında bir görev/kuyruk kaydı üretir; burada
 * "iletildi" olarak görünür.
 */

import { useMemo, useState, type FormEvent } from "react";
import { EP } from "@/lib/endpoints";
import { errorMessage, isEndpointMissing, portalApi } from "@/lib/api";
import { useListResource } from "@/lib/useResource";
import { isFromClient, messageTime } from "@/lib/messages";
import { caseHeadline, fmtDateTime, fmtDayHeading } from "@/lib/labels";
import type { PortalCase, PortalMessage } from "@/lib/types";
import {
  Button,
  Card,
  ErrorBox,
  Field,
  PageHeader,
  PrivacyNote,
  ResourceView,
  SuccessBox,
  Textarea,
} from "@/components/ui";
import { TermText } from "@/components/Term";

export default function MessagesPage() {
  const messages = useListResource<PortalMessage>(EP.messages);
  const cases = useListResource<PortalCase>(EP.cases);

  const [body, setBody] = useState("");
  const [caseId, setCaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const groups = useMemo(() => groupByDay(messages.data), [messages.data]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text.length === 0) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await portalApi(EP.messages, {
        method: "POST",
        body: { body: text, caseId: caseId || undefined },
      });
      setBody("");
      setSent(true);
      messages.reload();
    } catch (err) {
      if (isEndpointMissing(err)) {
        setError(
          "Mesajınız şu anda gönderilemiyor. Kısa süre sonra tekrar deneyin; acil bir konuysa avukatınızı telefonla arayın.",
        );
      } else {
        setError(errorMessage(err, "Mesajınız gönderilemedi. Lütfen tekrar deneyin."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mesajlar"
        description="Avukatınıza buradan yazabilir, size gönderilen mesajları okuyabilirsiniz."
      />

      <Card title="Avukatınıza yazın" className="mb-6">
        <form onSubmit={onSubmit} className="space-y-4">
          {cases.data.length > 0 && (
            <Field
              label="Hangi dosyayla ilgili? (isteğe bağlı)"
              htmlFor="caseId"
              hint="Dosya seçmeniz mesajınızın doğru kişiye ulaşmasını hızlandırır."
            >
              <select
                id="caseId"
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full rounded-xl border border-rule bg-white px-4 py-3 text-base text-ink focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
              >
                <option value="">Genel konu</option>
                {cases.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {caseHeadline(c)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Mesajınız" htmlFor="body">
            <Textarea
              id="body"
              rows={5}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Sormak istediğinizi kendi cümlelerinizle yazabilirsiniz."
            />
          </Field>

          {error && <ErrorBox message={error} />}
          {sent && (
            <SuccessBox>
              Mesajınız avukatınıza iletildi. Yanıt hazırlandığında bu sayfada görünür.
            </SuccessBox>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-reading text-sm leading-relaxed text-ink-faint">
              Mesajlar avukatınız tarafından okunur ve yanıtlanır. Yanıtlar,
              avukatınız onayladıktan sonra burada görünür — bu yüzden anında cevap
              beklemeyin. Acil durumlarda telefonla arayın.
            </p>
            <Button type="submit" disabled={busy || body.trim().length === 0}>
              {busy ? "Gönderiliyor…" : "Gönder"}
            </Button>
          </div>
        </form>
      </Card>

      <ResourceView
        loading={messages.loading}
        missing={messages.missing}
        forbidden={messages.forbidden}
        error={messages.error}
        empty={messages.empty}
        endpoint={messages.endpoint}
        onRetry={messages.reload}
        loadingLabel="Mesajlarınız getiriliyor…"
        emptyMessage="Henüz bir yazışmanız bulunmuyor."
        emptyHint="Yukarıdaki kutudan avukatınıza ilk mesajınızı yazabilirsiniz."
      >
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-4 border-b border-rule pb-2 font-serif text-[17px] font-semibold text-ink">
                {g.heading}
              </h2>
              <ul className="space-y-4">
                {g.items.map((m) => (
                  <li key={m.id}>
                    <MessageBubble message={m} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: PortalMessage }) {
  const mine = isFromClient(message);
  const when = fmtDateTime(message.createdAt ?? message.sentAt);
  const who = mine
    ? "Siz"
    : (message.senderName ?? "Avukatınız");

  return (
    <article
      className={`max-w-[46rem] rounded-2xl border px-5 py-4 shadow-paper ${
        mine
          ? "ml-auto border-gold-soft bg-gold-soft/40"
          : "mr-auto border-rule bg-white"
      }`}
    >
      <header className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-ink">{who}</span>
        {when && <span className="text-sm text-ink-faint tnum">{when}</span>}
      </header>
      {message.caseTitle && (
        <p className="mb-2 text-sm text-ink-faint">{message.caseTitle}</p>
      )}
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        <TermText text={message.body} />
      </p>
    </article>
  );
}

interface DayGroup {
  key: string;
  heading: string;
  items: PortalMessage[];
}

/** Mesajlar eskiden yeniye sıralanır; gün başlıklarıyla gruplanır. */
function groupByDay(rows: PortalMessage[]): DayGroup[] {
  const sorted = [...rows].sort((a, b) => messageTime(a) - messageTime(b));
  const groups: DayGroup[] = [];
  for (const m of sorted) {
    const heading = fmtDayHeading(m.createdAt ?? m.sentAt) ?? "Tarihi belirtilmemiş";
    const last = groups[groups.length - 1];
    if (last && last.heading === heading) {
      last.items.push(m);
      continue;
    }
    groups.push({ key: `${heading}-${groups.length}`, heading, items: [m] });
  }
  return groups;
}
