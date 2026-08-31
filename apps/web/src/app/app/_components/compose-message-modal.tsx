"use client";

/**
 * Giden mesaj akışı — TASLAK → ONAY → GÖNDERİM (Modül 19).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ONAY AKIŞI ARAYÜZDE NASIL ZORLANIR                                       ║
 * ║                                                                          ║
 * ║ 1. "Gönder" YALNIZCA sunucudan dönen `status === "ONAYLANDI"` iken açılır.║
 * ║    Kaynak istemcideki bir bayrak DEĞİL, sunucu kaydıdır: `approvedBy`     ║
 * ║    dolmadan bu durum oluşmaz. Sunucu da onaysız gönderimi 409 ile reddeder║
 * ║ 2. Düğme pasifken NEDENİ yazıyla görünür (`outboundBlockReason`).         ║
 * ║ 3. ONAYLANAN METİN = GÖNDERİLEN METİN. `POST /approve` metin ALMAZ;       ║
 * ║    bu yüzden ekran, onaydan ÖNCE düzenlenen metni `PATCH` ile yazar ve    ║
 * ║    ancak sonra onaylar. Kaydedilmemiş değişiklikle onay düğmesi açılmaz.  ║
 * ║ 4. Onaydan sonra metin alanı KİLİTLENİR: sunucuda `PATCH` onayı düşürür,  ║
 * ║    arayüz de sessizce onaysız hâle düşen bir mesaj göstermez.             ║
 * ║ 5. Kanal yapılandırılmamışsa ("configured: false") gönderim baştan        ║
 * ║    kapatılır — sunucu 503 döner ve mesaj ONAYLANDI olarak korunur.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * TASLAK KAYNAĞI SUNUCUDA ÜRETİLİR: şablon çözümü ve AI taslağı
 * `POST /outbound-messages` içinde olur (`templateId` / `useAi`). İstemci
 * şablon değişkeni doldurmaya ÇALIŞMAZ — ekranda görünen metin ile sunucunun
 * ürettiği metin ayrışmasın diye.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea } from "@/components/ui";
import { AiDisclaimer, PiiApprovalBox } from "@/components/ai-ui";
import { CreditBadge, useCreditCosts } from "@/components/credits";
import { errText } from "@/lib/faz2";
import {
  COMM_CHANNEL_LABELS,
  OUTBOUND_STATUS_LABELS,
  OUTBOUND_STATUS_TONES,
  SENDABLE_COMM_CHANNELS,
  canSendOutbound,
  labelOf,
  outboundBlockReason,
} from "@/lib/labels";
import { useAiCall } from "../_lib/use-ai-call";
import {
  approveOutboundMessage,
  createOutboundMessage,
  extractThirdPartyPii,
  isFeatureMissing,
  isNotConfigured,
  type ThirdPartyPiiPrompt,
  listMessageTemplates,
  NOT_CONFIGURED_TEXT,
  sendOutboundMessage,
  updateOutboundMessage,
  type ChannelStatus,
} from "../_lib/faz5";
import type { CaseRef, ClientRef, CommChannel, CommEntry, MessageTemplateItem } from "../_lib/faz5-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

/** Taslak kaynağı — sunucudaki üç seçenekle birebir. */
type DraftSource = "TEMPLATE" | "MANUAL" | "AI";

/**
 * GÖNDERİLEBİLİR kanallar — sunucudaki `OUTBOUND_CHANNELS` (communication.dto.ts).
 * TELEFON ve YUZ_YUZE kasten yoktur: bunlar sistemin gönderdiği değil, insanın
 * yapıp sonradan NOT ETTİĞİ olaylardır ve `POST /communications` ile kaydedilir.
 */
const OUTBOUND_CHANNELS = SENDABLE_COMM_CHANNELS as readonly CommChannel[];

/** Çözülmemiş şablon değişkeni ({{...}}) — onayı engeller (iş kuralı 9). */
const VAR_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function unresolvedVars(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(VAR_PATTERN)) found.add(m[1]);
  return [...found];
}

export function ComposeMessageModal({
  open,
  onClose,
  onSaved,
  clients,
  cases,
  fixedClientId,
  fixedCaseId,
  existing,
  channelStatus,
  onNotify,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  clients: ClientRef[];
  cases: CaseRef[];
  fixedClientId?: string;
  fixedCaseId?: string;
  /** Var olan bir taslağı onay için açmak. */
  existing?: CommEntry | null;
  /** Kanal yapılandırma durumu — gönderim düğmesinin ikinci kapısı. */
  channelStatus?: ChannelStatus[];
  onNotify: Notify;
}) {
  const { costs } = useCreditCosts();

  // ---- hedef ----
  const [clientId, setClientId] = useState(fixedClientId ?? "");
  const [caseId, setCaseId] = useState(fixedCaseId ?? "");
  const [channel, setChannel] = useState<CommChannel>("EPOSTA");

  // ---- taslak kaynağı (yalnız oluşturma aşamasında) ----
  const [source, setSource] = useState<DraftSource>("TEMPLATE");
  const [templateId, setTemplateId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [templates, setTemplates] = useState<MessageTemplateItem[]>([]);

  // ---- metin ----
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  /** Sunucudaki son kayıtlı metin — "kaydedilmemiş değişiklik" bunun farkıdır. */
  const [savedBody, setSavedBody] = useState("");
  const [savedSubject, setSavedSubject] = useState("");

  const [draft, setDraft] = useState<CommEntry | null>(null);
  const [busy, setBusy] = useState<"create" | "save" | "approve" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** KVKK: taramaya rağmen devam kararının gerekçesi (sunucu zorunlu tutar). */
  const [piiNote, setPiiNote] = useState("");
  /**
   * ÜÇÜNCÜ KİŞİ KVKK KAPISI — kaynağı SUNUCUNUN 409 YANITIDIR.
   *
   * Eskiden kapı `draft.piiScan` alanına bakıyordu; o alan yalnızca onay/gönderim
   * ANINDA dolduğu için ilk denemede daima boştu ve gerekçe kutusu hiç
   * görünmüyordu (akış çıkmaz sokaktı). Şimdi kutu, sunucunun
   * `requiresPiiApproval` bayrağını döndürdüğü anda ve YALNIZCA o zaman açılır;
   * hangi işlemin beklediği (`approve` / `send`) de burada tutulur ki gerekçe
   * yazıldığında aynı işlem tekrarlansın.
   */
  const [piiGate, setPiiGate] = useState<
    { prompt: ThirdPartyPiiPrompt; pending: "approve" | "send" } | null
  >(null);

  const status = draft?.status ?? null;
  const approved = canSendOutbound(status) || status === "GONDERILDI";
  const sent = status === "GONDERILDI";
  const dirty = body !== savedBody || subject !== savedSubject;

  /** Sunucu kaydını forma yansıtır — tek yerden, kopyala-yapıştır olmadan. */
  const adopt = useCallback((entry: CommEntry) => {
    setDraft(entry);
    const text = entry.finalBody ?? entry.draftBody ?? entry.body ?? "";
    const subj = entry.subject ?? "";
    setBody(text);
    setSavedBody(text);
    setSubject(subj);
    setSavedSubject(subj);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
    setBusy(null);
    setPiiNote("");
    if (existing) {
      adopt(existing);
      setClientId(existing.client?.id ?? fixedClientId ?? "");
      setCaseId(existing.case?.id ?? fixedCaseId ?? "");
      setChannel(existing.channel);
      setTemplateId(existing.templateId ?? "");
    } else {
      setDraft(null);
      setClientId(fixedClientId ?? "");
      setCaseId(fixedCaseId ?? "");
      setChannel("EPOSTA");
      setSource("TEMPLATE");
      setTemplateId("");
      setInstruction("");
      setSubject("");
      setSavedSubject("");
      setBody("");
      setSavedBody("");
    }
  }, [open, existing, fixedClientId, fixedCaseId, adopt]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    listMessageTemplates()
      .then((list) => {
        if (alive) setTemplates(list);
      })
      .catch(() => {
        // Şablon ucu yoksa akış ELLE YAZMA ile sürer; hata gösterilmez.
        if (alive) setTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const caseOptions = useMemo(() => {
    if (!clientId) return cases;
    return cases.filter((c) => {
      const raw = c as CaseRef & { clientId?: string | null };
      return raw.clientId ? raw.clientId === clientId : true;
    });
  }, [cases, clientId]);

  const channelTemplates = useMemo(
    () => templates.filter((t) => t.channel === channel),
    [templates, channel],
  );

  const missingVars = useMemo(() => unresolvedVars(body), [body]);

  /** Kanal gerçekten gönderebiliyor mu? Bilgi yoksa engellemeyiz (sunucu karar verir). */
  const channelInfo = channelStatus?.find((c) => c.channel === channel) ?? null;
  const channelBlocked = channelInfo ? !channelInfo.configured : false;

  /**
   * KVKK kapısı AÇIK MI? Tek kaynak sunucunun 409 yanıtıdır.
   *
   * `draft.piiScan` BİLEREK KULLANILMAZ: o alan onaydan SONRA dolar ve
   * içeriğinde müvekkilin KENDİ verisi de bulunabilir; ona bakmak hem kapıyı
   * hiç açmıyor hem de (dolu olduğunda) avukatın görmediği bir kararı
   * "onaylanmış" sayıyordu.
   */
  const piiPending = piiGate !== null;

  // ---- AI taslağı: KAYIT OLUŞTURMA çağrısının kendisidir ----
  const ai = useAiCall(
    useCallback(
      (piiApproved: boolean) => {
        if (!clientId) return Promise.reject(new Error("Önce müvekkil seçin."));
        if (!caseId) {
          return Promise.reject(
            new Error("AI taslağı için dosya seçin — durum özeti dosya bağlamından yazılır."),
          );
        }
        return createOutboundMessage(
          { clientId, caseId, channel, useAi: true, instruction: instruction.trim() || undefined },
          piiApproved,
        );
      },
      [clientId, caseId, channel, instruction],
    ),
    "AI taslağı üretilemedi.",
  );

  async function runAi(withPiiApproval = false) {
    setError(null);
    const res = withPiiApproval ? await ai.approvePii() : await ai.run();
    if (!res) return;
    adopt(res);
    setNotice("AI taslağı oluşturuldu. Metni okuyup düzenleyin, sonra onaylayın.");
    await onSaved();
  }

  // ---- eylemler ----

  async function handleCreate() {
    setError(null);
    setNotice(null);
    if (!clientId) {
      setError("Müvekkil seçilmeden taslak oluşturulamaz.");
      return;
    }
    if (source === "TEMPLATE" && !templateId) {
      setError("Şablon seçin ya da “Elle yaz” kaynağına geçin.");
      return;
    }
    if (source === "MANUAL" && !body.trim()) {
      setError("Mesaj metni boş olamaz.");
      return;
    }
    setBusy("create");
    try {
      const created = await createOutboundMessage({
        clientId,
        caseId: caseId || null,
        channel,
        templateId: source === "TEMPLATE" ? templateId : null,
        draftBody: source === "MANUAL" ? body : undefined,
        subject: subject || undefined,
      });
      adopt(created);
      setNotice("Taslak oluşturuldu. Onaylamadan gönderilemez.");
      await onSaved();
    } catch (err) {
      setError(errText(err, "Taslak oluşturulamadı."));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setError(null);
    setNotice(null);
    if (!body.trim()) {
      setError("Mesaj metni boş olamaz.");
      return;
    }
    setBusy("save");
    try {
      const res = await updateOutboundMessage(draft.id, {
        finalBody: body,
        subject: subject || null,
      });
      adopt(res);
      setNotice("Metin kaydedildi.");
      await onSaved();
    } catch (err) {
      setError(errText(err, "Metin kaydedilemedi."));
    } finally {
      setBusy(null);
    }
  }

  /**
   * ONAY. `piiApproved` VARSAYILAN OLARAK GÖNDERİLMEZ.
   *
   * @param override Sunucu KVKK kapısını açtıktan sonra, avukat gerekçe yazıp
   *   "yine de onayla" dediğinde `true` gelir. İlk denemede daima `false`'tır:
   *   kararı sunucu sorar, istemci kendiliğinden onaylamaz.
   */
  async function handleApprove(override = false) {
    if (!draft) return;
    setError(null);
    setNotice(null);
    if (missingVars.length > 0) {
      setError(
        `Çözülmemiş şablon değişkeni var: ${missingVars
          .map((v) => `{{${v}}}`)
          .join(", ")}. Bunlar doldurulmadan mesaj onaylanamaz.`,
      );
      return;
    }
    if (override && piiNote.trim().length === 0) {
      setError("Devam etmek için gerekçe yazın; gerekçesiz karar denetim değeri taşımaz.");
      return;
    }
    setBusy("approve");
    try {
      /**
       * ÖNCE METİN, SONRA ONAY.
       *
       * `POST /approve` gövdesi metin almaz; kaydedilmemiş bir düzenlemeyle
       * onaylanırsa avukat ekranda gördüğünden BAŞKA bir metni onaylamış olur.
       * Bu yüzden fark varsa aynı akış içinde önce `PATCH` yapılır.
       */
      if (dirty) {
        await updateOutboundMessage(draft.id, { finalBody: body, subject: subject || null });
      }
      const res = await approveOutboundMessage(draft.id, {
        piiApproved: override ? true : undefined,
        piiOverrideNote: override ? piiNote.trim() : undefined,
      });
      adopt(res);
      setPiiGate(null);
      setNotice(
        res.status === "GONDERILDI"
          ? "Mesaj onaylandı ve gönderildi."
          : "Mesaj onaylandı. Onaylayan siz olarak kaydedildi; artık gönderilebilir.",
      );
      onNotify("Mesaj onaylandı.", "success");
      await onSaved();
    } catch (err) {
      // KVKK kapısı: hata DEĞİL, SORUDUR. Kırmızı satır yerine gerekçe kutusu açılır.
      const prompt = extractThirdPartyPii(err);
      if (prompt) {
        setPiiGate({ prompt, pending: "approve" });
        return;
      }
      setError(errText(err, "Mesaj onaylanamadı."));
    } finally {
      setBusy(null);
    }
  }

  /** Gönderim. Onayla aynı disiplin: `piiApproved` yalnızca AÇIK kararla gider. */
  async function handleSend(override = false) {
    if (!draft) return;
    setError(null);
    setNotice(null);
    if (override && piiNote.trim().length === 0) {
      setError("Devam etmek için gerekçe yazın; gerekçesiz karar denetim değeri taşımaz.");
      return;
    }
    setBusy("send");
    try {
      const res = await sendOutboundMessage(draft.id, {
        piiApproved: override ? true : undefined,
        piiOverrideNote: override ? piiNote.trim() : undefined,
      });
      adopt(res);
      setPiiGate(null);
      setNotice("Mesaj gönderim hattına verildi.");
      onNotify("Mesaj gönderildi.", "success");
      await onSaved();
    } catch (err) {
      const prompt = extractThirdPartyPii(err);
      if (prompt) {
        setPiiGate({ prompt, pending: "send" });
        return;
      }
      // SIRA ÖNEMLİ: yapılandırma hatası 503/501 taşıyabilir; `isFeatureMissing`
      // onu "uç yok" sanar ve avukat gerçek nedeni öğrenemezdi.
      if (isNotConfigured(err)) {
        setError(
          `${NOT_CONFIGURED_TEXT} Mesaj ONAYLI olarak korunuyor; sağlayıcı tanımlandığında bu ekrandan gönderebilirsiniz.`,
        );
      } else if (isFeatureMissing(err)) {
        setError("Gönderim ucu henüz yayında değil. Mesaj ONAYLI olarak kayıtlı kalır.");
      } else {
        setError(errText(err, "Mesaj gönderilemedi."));
      }
    } finally {
      setBusy(null);
    }
  }

  // ---- "Gönder" neden kapalı? ----
  const sendBlockReason = !draft
    ? "Gönder pasif: henüz kaydedilmiş bir taslak yok."
    : channelBlocked
      ? `Gönder pasif: ${labelOf(COMM_CHANNEL_LABELS, channel)} kanalı için sağlayıcı yapılandırılmamış${
          channelInfo?.requires.length ? ` (${channelInfo.requires.join(", ")} gerekli)` : ""
        }. Sahte gönderim yapılmaz.`
      : (outboundBlockReason(status) ?? null);

  return (
    <Modal open={open} wide title={draft ? "Mesaj — onay ve gönderim" : "Yeni Mesaj"} onClose={onClose}>
      <div className="space-y-4">
        {draft && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">Durum:</span>
            <Badge tone={OUTBOUND_STATUS_TONES[status ?? ""] ?? "gray"}>
              {labelOf(OUTBOUND_STATUS_LABELS, status)}
            </Badge>
            {draft.approvedAt && (
              <span className="text-[11px] text-slate-500">
                Onaylandı — gönderilen metnin sorumlusu onaylayandır.
              </span>
            )}
          </div>
        )}

        {/* Hedef — taslak oluştuktan sonra değiştirilemez */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Müvekkil">
            <Select
              value={clientId}
              disabled={Boolean(fixedClientId) || Boolean(draft)}
              onChange={(e) => {
                setClientId(e.target.value);
                setCaseId("");
              }}
            >
              <option value="">Seçiniz…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dosya" hint="AI taslağı için zorunlu">
            <Select
              value={caseId}
              disabled={Boolean(fixedCaseId) || Boolean(draft)}
              onChange={(e) => setCaseId(e.target.value)}
            >
              <option value="">(dosyasız)</option>
              {caseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title ?? c.fileNumber ?? c.id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Kanal">
            <Select
              value={channel}
              disabled={Boolean(draft)}
              onChange={(e) => setChannel(e.target.value as CommChannel)}
            >
              {OUTBOUND_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {labelOf(COMM_CHANNEL_LABELS, ch)}
                  {channelStatus?.find((c) => c.channel === ch)?.configured === false
                    ? " — sağlayıcı yok"
                    : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {channelBlocked && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <strong>{labelOf(COMM_CHANNEL_LABELS, channel)}</strong> kanalı için sağlayıcı
            yapılandırılmamış. Taslak hazırlayıp ONAYLAYABİLİRSİNİZ; gönderim, sağlayıcı
            tanımlanana kadar yapılamaz. Telefon/yüz yüze görüşmeler ise gönderilmez, dosya
            sayfasından KAYDEDİLİR.
          </p>
        )}

        {/* Taslak kaynağı — yalnız kayıt oluşmadan önce */}
        {!draft && (
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Taslağın kaynağı
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {(
                [
                  ["TEMPLATE", "Şablondan"],
                  ["MANUAL", "Elle yaz"],
                  ["AI", "AI ile yaz"],
                ] as Array<[DraftSource, string]>
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="draft-source"
                    checked={source === key}
                    onChange={() => setSource(key)}
                    className="h-3.5 w-3.5 border-slate-300 text-amber-500 focus:ring-amber-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            {source === "TEMPLATE" && (
              <div className="mt-3">
                <Field
                  label="Şablon"
                  hint="Değişkenleri sunucu doldurur; çözülemeyen değişken kalırsa mesaj onaya düşmez."
                >
                  <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    <option value="">Seçiniz…</option>
                    {channelTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.isSystem ? " · sistem" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                {channelTemplates.length === 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Bu kanal için şablon yok. “Elle yaz” ya da “AI ile yaz” seçin.
                  </p>
                )}
              </div>
            )}

            {source === "AI" && (
              <div className="mt-3 space-y-2">
                <Field label="AI talimatı (isteğe bağlı)">
                  <Input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder="Örn. bilirkişi raporunu da sade dille özetle"
                  />
                </Field>
                <Button
                  variant="gold"
                  size="sm"
                  disabled={ai.busy || !caseId || !clientId}
                  onClick={() => void runAi()}
                  title={
                    caseId
                      ? "Dosyanın safahatından, hukukçu olmayan dille taslak üretir."
                      : "Önce dosya seçin."
                  }
                >
                  {ai.busy ? "Taslak yazılıyor…" : "AI taslağı üret"}
                  <CreditBadge taskType="MESSAGE_DRAFT" costs={costs} />
                </Button>
                {!caseId && (
                  <p className="text-[11px] text-slate-400">
                    Dosya seçilmeden AI taslağı üretilmez: bağlamsız özet uydurmaya davettir.
                  </p>
                )}
                {ai.pii && (
                  <PiiApprovalBox
                    prompt={ai.pii}
                    busy={ai.busy}
                    onApprove={() => void runAi(true)}
                    onCancel={ai.cancelPii}
                  />
                )}
                {ai.error && <ErrorBox message={ai.error} />}
              </div>
            )}
          </div>
        )}

        {/* Metin */}
        <Field label="Konu">
          <Input
            value={subject}
            disabled={approved}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="E-posta konusu (SMS/WhatsApp için boş bırakılabilir)"
          />
        </Field>

        <Field
          label="Mesaj metni"
          hint={
            approved
              ? "Onaylanan metin kilitlidir. Değiştirmek isterseniz mesajı reddedip yeni taslak açın — metni düzenlemek onayı düşürür."
              : draft
                ? "Düzenlediğiniz metin `finalBody` alanına yazılır; AI/şablon çıktısı ayrıca saklanır."
                : "Elle yazma kaynağında metni buraya girin."
          }
        >
          <Textarea
            rows={12}
            value={body}
            disabled={approved}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        {body.trim().length > 0 && !approved && (
          <AiDisclaimer text="Taslak bir ÖNERİDİR: metni okumadan, düzeltmeden onaylamayın. Gönderilen metnin sorumluluğu onaylayan avukattadır." />
        )}

        {missingVars.length > 0 && !approved && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <strong>Çözülmemiş değişken:</strong> {missingVars.map((v) => `{{${v}}}`).join(", ")} —
            bunlar doldurulmadan mesaj onaylanamaz (müvekkile ham yer tutucu gönderilmez).
          </p>
        )}

        {/*
          ÜÇÜNCÜ KİŞİ KVKK KAPISI — yalnızca sunucu sorduğunda görünür.
          Kapıyı açan `draft.piiScan` değil, 409 yanıtının kendisidir; bu yüzden
          kutu ilk denemede de çıkar ve avukat kararı gerekçesiyle verebilir.
        */}
        {piiGate && !sent && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs font-semibold text-amber-900">
              KVKK: metinde ALICIYA AİT OLMAYAN kişisel veri tespit edildi
            </p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">{piiGate.prompt.message}</p>
            {piiGate.prompt.findings.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {piiGate.prompt.findings.map((f, i) => (
                  <li
                    key={`${f.kind ?? "veri"}-${i}`}
                    className="rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] text-amber-900"
                  >
                    {f.kind ?? "kişisel veri"}
                    {typeof f.count === "number" ? ` × ${f.count}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] leading-5 text-amber-800">
              Devam kararınız gerekçesiyle birlikte denetim izine yazılır. Gerekçesiz devam
              kararı kabul edilmez.
            </p>
            <div className="mt-2">
              <Input
                value={piiNote}
                onChange={(e) => setPiiNote(e.target.value)}
                placeholder="Devam gerekçesi (örn. karşı vekilin adresi müvekkile bildirilecektir)"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy !== null || piiNote.trim().length === 0}
                onClick={() =>
                  piiGate.pending === "approve" ? void handleApprove(true) : void handleSend(true)
                }
              >
                {piiGate.pending === "approve"
                  ? "Gerekçeyle onayla"
                  : "Gerekçeyle gönder"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPiiGate(null)}>
                Vazgeç, metni düzenleyeceğim
              </Button>
            </div>
          </div>
        )}

        {dirty && draft && !approved && (
          <p className="text-xs text-amber-800">
            Kaydedilmemiş değişiklik var. Onay, ekranda gördüğünüz metni kaydettikten sonra
            verilir.
          </p>
        )}

        {error && <ErrorBox message={error} />}
        {notice && <SuccessBox message={notice} />}

        {/* Eylemler */}
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Kapat
            </Button>

            {!draft ? (
              <Button
                variant="primary"
                disabled={busy !== null || source === "AI"}
                onClick={() => void handleCreate()}
                title={
                  source === "AI"
                    ? "AI kaynağında taslak, yukarıdaki “AI taslağı üret” düğmesiyle oluşturulur."
                    : undefined
                }
              >
                {busy === "create" ? "Oluşturuluyor…" : "Taslağı oluştur"}
              </Button>
            ) : (
              <>
                {!approved && (
                  <Button
                    variant="secondary"
                    disabled={busy !== null || !dirty}
                    onClick={() => void handleSave()}
                  >
                    {busy === "save" ? "Kaydediliyor…" : "Metni kaydet"}
                  </Button>
                )}
                {/*
                  KVKK kapısı açıkken bu düğmeler KİLİTLİDİR: karar, gerekçe
                  kutusundaki "gerekçeyle onayla/gönder" düğmesiyle verilir.
                  Aynı isteği gerekçesiz tekrarlamak yalnız aynı 409'u üretirdi.
                */}
                <Button
                  variant="primary"
                  disabled={busy !== null || approved || missingVars.length > 0 || piiPending}
                  onClick={() => void handleApprove()}
                  title={
                    missingVars.length > 0
                      ? "Çözülmemiş şablon değişkeni var."
                      : piiPending
                        ? "Önce KVKK devam gerekçesini yazın."
                        : "Onaylayan, gönderilen metnin sorumlusudur."
                  }
                >
                  {busy === "approve" ? "Onaylanıyor…" : approved ? "Onaylandı ✓" : "Onayla"}
                </Button>
                <Button
                  variant="gold"
                  disabled={
                    busy !== null || !canSendOutbound(status) || channelBlocked || piiPending
                  }
                  onClick={() => void handleSend()}
                >
                  {busy === "send" ? "Gönderiliyor…" : sent ? "Gönderildi ✓" : "Gönder"}
                </Button>
              </>
            )}
          </div>

          {/* Pasif "Gönder" düğmesinin GEREKÇESİ — daima yazılı. */}
          {!sent && sendBlockReason && (
            <p className="text-right text-[11px] leading-5 text-slate-500">{sendBlockReason}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
