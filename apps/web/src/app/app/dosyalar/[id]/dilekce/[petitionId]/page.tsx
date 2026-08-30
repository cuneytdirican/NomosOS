"use client";

/**
 * DİLEKÇE STÜDYOSU — /app/dosyalar/:id/dilekce/:petitionId
 *
 * GET   /petitions/:id                          · detay + güncel sürüm + `verification` + `readyGate`
 * POST  /petitions/:id/versions                 · yeni (DEĞİŞTİRİLEMEZ) sürüm
 * POST  /petitions/:id/generate                 · AI taslağı (409 PII) — SUNUCUDA SÜRÜM AÇAR
 * POST  /petitions/:id/sections/:key/rewrite    · bölüm yeniden yaz (409 PII) — SÜRÜM AÇAR
 * POST  /petitions/:id/verify                   · atıf teyidi (Teyit Ajanı, LLM YOK)
 * PATCH /petitions/:id/status { status }        · 422 → `blocking` listesi
 * POST  /petitions/:id/export/udf               · teyit kapısı BİR KEZ DAHA çalışır
 *
 * ÜRÜN İLKESİ: uydurma madde/içtihat yasaktır. HAZIR ve SONRASINDAKİ her statü
 * geçişi TEYİT KAPISINDAN geçer; takılan atıflar burada tek tek gösterilir.
 *
 * KAYDEDİLMEMİŞ METİN KORUMASI: `load()` sunucudaki sürümü editöre yazar.
 * Kullanıcının kaydetmediği metni SESSİZCE EZMEMEK için `dirty` iken bölümler
 * korunur; yalnızca meta/teyit bilgisi tazelenir.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  aiDraftPetition,
  aiRewriteSection,
  detailChecks,
  errText,
  exportPetitionUdf,
  extractFailedCitations,
  extractPii,
  extractStatuteDeclarations,
  getPetition,
  isFeatureMissing,
  listPetitionVersions,
  savePetitionVersion,
  sectionBody,
  sectionsOf,
  updatePetitionStatus,
  verifyChecks,
  verifyPetition,
  type PiiPrompt,
} from "@/lib/faz2";
import type {
  CitationCheckItem,
  PetitionDetail,
  PetitionSection,
  PetitionVersionItem,
  ReadyGate,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Spinner,
  SuccessBox,
  Textarea,
} from "@/components/ui";
import {
  AiDisclaimer,
  FeatureUnavailable,
  PiiApprovalBox,
  ToastStack,
  useToasts,
} from "@/components/ai-ui";
import {
  CITATION_STATUS_LABELS,
  CITATION_STATUS_TONES,
  DEFAULT_PETITION_SECTIONS,
  PETITION_STATUS_LABELS,
  PETITION_STATUS_TONES,
  PETITION_TYPE_LABELS,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";

type PendingAction =
  | { kind: "draft"; instruction: string }
  | { kind: "rewrite"; title: string; instruction: string };

export default function DilekceStudyoPage({
  params,
}: {
  params: Promise<{ id: string; petitionId: string }>;
}) {
  const { id: caseId, petitionId } = use(params);

  const [petition, setPetition] = useState<PetitionDetail | null>(null);
  const [sections, setSections] = useState<PetitionSection[]>([]);
  const [versions, setVersions] = useState<PetitionVersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [checks, setChecks] = useState<CitationCheckItem[]>([]);
  const [readyGate, setReadyGate] = useState<ReadyGate | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [failedOnPublish, setFailedOnPublish] = useState<CitationCheckItem[]>([]);
  /** 422 gövdesindeki, avukat beyanı bekleyen mevzuat atıfları. */
  const [statuteAsk, setStatuteAsk] = useState<string[]>([]);

  const [drafting, setDrafting] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftInstruction, setDraftInstruction] = useState("");
  const [rewriteTarget, setRewriteTarget] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [pii, setPii] = useState<{ prompt: PiiPrompt; action: PendingAction } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  const { toasts, push, dismiss } = useToasts();

  /**
   * Sunucudan gelen detayı ekrana uygular.
   *
   * @param keepEditor `true` ise BÖLÜM GÖVDELERİNE DOKUNULMAZ. Kullanıcı
   * düzenleme yapmışken (`dirty`) teyit/statü/AI eylemleri sonrası `load()`
   * çağrıldığında kaydedilmemiş metin SESSİZCE EZİLİYORDU; `beforeunload`
   * uyarısı yalnızca sekme kapanışını koruyordu, bu yolu korumuyordu.
   */
  const applyDetail = useCallback((detail: PetitionDetail, keepEditor = false) => {
    setPetition(detail);
    // API alan adı `verification`tır; `citationChecks` yalnızca geriye dönük.
    setChecks(detailChecks(detail));
    setReadyGate(detail.readyGate ?? null);

    if (keepEditor) return;

    const current =
      detail.currentVersion ??
      (detail.versions && detail.versions.length > 0
        ? [...detail.versions].sort((a, b) => b.versionNo - a.versionNo)[0]
        : null);
    let next = sectionsOf(current);
    if (next.length === 0) next = sectionsOf(detail.template);
    if (next.length === 0) {
      next = DEFAULT_PETITION_SECTIONS.map((t) => ({ title: t, body: "" }));
    }
    setSections(next);
    setDirty(false);
  }, []);

  const load = useCallback(
    async (keepEditor = false) => {
      if (!keepEditor) setLoading(true);
      setError(null);
      try {
        const detail = await getPetition(petitionId);
        applyDetail(detail, keepEditor);
        setMissing(false);
        setVersions(detail.versions ?? []);
      } catch (err) {
        if (isFeatureMissing(err)) setMissing(true);
        else setError(errText(err, "Dilekçe yüklenemedi."));
      } finally {
        setLoading(false);
      }
    },
    [petitionId, applyDetail],
  );

  /** Meta/teyit bilgisini tazeler; kaydedilmemiş metni KORUR. */
  const refreshMeta = useCallback(() => load(true), [load]);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Kaydedilmemiş değişiklikte sekme kapatma uyarısı
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function updateSection(title: string, body: string) {
    setSections((prev) => prev.map((s) => (s.title === title ? { ...s, body } : s)));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await savePetitionVersion(petitionId, sections, saveNote);
      setSaveNote("");
      push("Yeni sürüm kaydedildi. Önceki sürümler değiştirilemez biçimde saklanır.", "success");
      setDirty(false);
      await load(false);
    } catch (err) {
      push(errText(err, "Sürüm kaydedilemedi."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function runDraft(instruction: string, piiApproved: boolean) {
    // AI taslağı SUNUCUDA yeni bir sürüm açar; kaydedilmemiş metin varsa
    // kullanıcı önce karar vermelidir.
    if (!(await confirmDiscardIfDirty("AI taslağı üretmek"))) return;

    setDrafting(true);
    try {
      const res = await aiDraftPetition(petitionId, instruction, piiApproved);
      const produced = sectionsOf(res);
      if (produced.length > 0) {
        setSections(produced);
        // Sürüm SUNUCUDA oluştu; editör o sürümle aynı → dirty değil.
        setDirty(false);
      }
      setPii(null);
      setDraftOpen(false);
      push(
        `AI taslağı üretildi ve sürüm ${res.versionNo} olarak KAYDEDİLDİ. İçeriği okuyup ` +
          "düzenleyin; değişiklikleriniz yeni bir sürüm olur.",
        "success",
      );
      await refreshMeta();
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) setPii({ prompt, action: { kind: "draft", instruction } });
      else push(errText(err, "AI taslağı üretilemedi."), "error");
    } finally {
      setDrafting(false);
    }
  }

  async function runRewrite(title: string, instruction: string, piiApproved: boolean) {
    if (!(await confirmDiscardIfDirty(`"${title}" bölümünü AI ile yeniden yazmak`))) return;

    setRewriting(true);
    try {
      const res = await aiRewriteSection(petitionId, title, instruction, piiApproved);
      // API alan adı `newBody`dir (eskiden body|content|text aranıyordu ve
      // arayüz "AI boş içerik döndürdü" diyordu — oysa sunucuda SÜRÜM AÇILMIŞTI).
      const text = res.newBody ?? "";
      if (text) {
        setSections((prev) => prev.map((sec) => (sec.title === title ? { ...sec, body: text } : sec)));
        setDirty(false);
        push(
          `"${title}" bölümü yeniden yazıldı ve sürüm ${res.versionNo} olarak KAYDEDİLDİ.`,
          "success",
        );
      } else {
        push("AI boş içerik döndürdü; bölüm değiştirilmedi.", "error");
      }
      setPii(null);
      setRewriteTarget(null);
      setRewriteInstruction("");
      await refreshMeta();
    } catch (err) {
      const prompt = extractPii(err);
      if (prompt) setPii({ prompt, action: { kind: "rewrite", title, instruction } });
      else push(errText(err, "Bölüm yeniden yazılamadı."), "error");
    } finally {
      setRewriting(false);
    }
  }

  async function handleVerify() {
    // TEYİT SUNUCUDAKİ GÜNCEL SÜRÜM ÜZERİNDE koşar. Ekrandaki kaydedilmemiş
    // metin üzerinde koşmaz; bu yüzden önce kaydetmek gerekir, yoksa sonuç
    // yanıltıcı olur.
    if (dirty) {
      push(
        "Teyit, SUNUCUDAKİ güncel sürüm üzerinde çalışır. Kaydedilmemiş değişiklikleriniz " +
          "teyide dahil edilmez — önce «Yeni Sürüm Kaydet» deyin.",
        "error",
      );
      return;
    }

    setVerifying(true);
    setFailedOnPublish([]);
    try {
      const res = await verifyPetition(petitionId);
      const list = verifyChecks(res);
      setChecks(list);
      setReadyGate(res.readyGate ?? null);
      const bad = list.filter((c) => c.status !== "DOGRULANDI" || c.isDemo);
      push(
        list.length === 0
          ? "Metinde teyit edilecek içtihat/mevzuat atfı bulunamadı."
          : bad.length === 0
            ? `Teyit tamam: ${list.length} atıfın tamamı doğrulandı.`
            : `${bad.length} atıf doğrulanamadı — dilekçeyi HAZIR yapmadan önce düzeltin.`,
        bad.length === 0 ? "success" : "error",
      );
      await refreshMeta();
    } catch (err) {
      push(errText(err, "Teyit çalıştırılamadı."), "error");
    } finally {
      setVerifying(false);
    }
  }

  async function handleStatus(status: string, confirmedStatutes?: string[]) {
    if (dirty) {
      push(
        "Kaydedilmemiş değişiklikleriniz var. Statü, SUNUCUDAKİ güncel sürüm üzerinden " +
          "değerlendirilir — önce «Yeni Sürüm Kaydet» deyin.",
        "error",
      );
      return;
    }

    setFailedOnPublish([]);
    setStatuteAsk([]);
    try {
      await updatePetitionStatus(petitionId, status, confirmedStatutes);
      push(`Statü güncellendi: ${labelOf(PETITION_STATUS_LABELS, status)}`, "success");
      await load(false);
    } catch (err) {
      const failed = extractFailedCitations(err);
      const statutes = extractStatuteDeclarations(err);
      if (failed.length > 0) {
        setFailedOnPublish(failed);
        setStatuteAsk(statutes);
        push(`${failed.length} atıf teyit kapısını geçemedi; statü değiştirilemedi.`, "error");
      } else {
        push(errText(err, "Statü güncellenemedi."), "error");
      }
    }
  }

  /**
   * Kaydedilmemiş metin varken sunucuda sürüm açan bir eyleme geçmeden önce
   * kullanıcıya sorar. `false` dönerse eylem YAPILMAZ.
   */
  async function confirmDiscardIfDirty(action: string): Promise<boolean> {
    if (!dirty) return true;
    const ok = window.confirm(
      `Kaydedilmemiş değişiklikleriniz var.\n\n${action}, sunucudaki güncel sürüm üzerinde ` +
        "çalışır ve sonuç editöre yazılır; kaydetmediğiniz metin KAYBOLUR.\n\n" +
        "Devam etmek için Tamam, önce kaydetmek için İptal.",
    );
    return ok;
  }

  async function handleExport() {
    try {
      const url = await exportPetitionUdf(petitionId);
      window.open(url, "_blank", "noopener,noreferrer");
      push(
        "UDF dosyası üretildi ve indirme başlatıldı. Bağlantı 15 dakika geçerlidir.",
        "success",
      );
    } catch (err) {
      // Dışa aktarımda TEYİT KAPISI BİR KEZ DAHA çalışır (savunma derinliği):
      // statü doğru olsa bile doğrulanmamış atıf varsa 422 döner.
      const failed = extractFailedCitations(err);
      if (failed.length > 0) {
        setFailedOnPublish(failed);
        setStatuteAsk(extractStatuteDeclarations(err));
        push(`${failed.length} atıf teyit kapısını geçemediği için dışa aktarılamadı.`, "error");
      } else {
        push(errText(err, "UDF üretilemedi."), "error");
      }
    }
  }

  function approvePii() {
    if (!pii) return;
    if (pii.action.kind === "draft") void runDraft(pii.action.instruction, true);
    else void runRewrite(pii.action.title, pii.action.instruction, true);
  }

  // [DEMO VERİ] işaretli kayıtla eşleşen atıf teknik olarak "bulunmuş" olsa da
  // GERÇEK KARAR DEĞİLDİR ve kapıyı geçmez; sayımda da doğrulanmış sayılmaz.
  const verifiedCount = useMemo(
    () => checks.filter((c) => c.status === "DOGRULANDI" && !c.isDemo).length,
    [checks],
  );
  const failedChecks = useMemo(
    () => checks.filter((c) => c.status !== "DOGRULANDI" || c.isDemo),
    [checks],
  );

  if (loading) return <Spinner label="Dilekçe yükleniyor…" />;
  if (missing) {
    return (
      <div className="space-y-4">
        <Link href={`/app/dosyalar/${caseId}`} className="text-xs text-slate-500 hover:text-amber-600">
          ← Dosyaya dön
        </Link>
        <FeatureUnavailable
          title="Dilekçe Stüdyosu henüz hazır değil"
          detail="/petitions/:id uçları yayına alındığında bu ekran bölüm bölüm düzenleme, AI taslağı, atıf teyidi ve UDF dışa aktarımı ile çalışacak."
          onRetry={() => void load()}
        />
      </div>
    );
  }
  if (error) return <ErrorBox message={error} />;
  if (!petition) return <EmptyState message="Dilekçe bulunamadı." />;

  return (
    <div className="space-y-6">
      <Link href={`/app/dosyalar/${caseId}`} className="text-xs text-slate-500 hover:text-amber-600">
        ← Dosyaya dön
      </Link>

      {/* Başlık */}
      <div className="rounded-xl border border-slate-200 bg-slate-900 p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">{petition.title}</h1>
              <Badge tone={PETITION_STATUS_TONES[petition.status] ?? "gray"}>
                {labelOf(PETITION_STATUS_LABELS, petition.status)}
              </Badge>
              <Badge tone="gold">{labelOf(PETITION_TYPE_LABELS, petition.type)}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {petition.case?.title ?? "Dilekçe Stüdyosu"}
              {versions.length > 0 ? ` · ${versions.length} sürüm` : ""}
              {dirty ? " · kaydedilmemiş değişiklik var" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gold" onClick={() => setDraftOpen(true)} disabled={drafting}>
              {drafting ? "Üretiliyor…" : "AI ile Taslak Üret"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleVerify()} disabled={verifying}>
              {verifying ? "Teyit ediliyor…" : "Atıfları Teyit Et"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setVersionsOpen(true)}>
              Versiyon Geçmişi
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleExport()}>
              UDF olarak indir
            </Button>
          </div>
        </div>
      </div>

      <AiDisclaimer text="AI taslağı bir ÖNERİDİR. Madde numaraları ve içtihat künyeleri teyit edilmeden dilekçe HAZIR statüsüne alınamaz." />

      {/* TEYİT DURUMU ŞERİDİ */}
      <VerifyStrip
        checks={checks}
        verifiedCount={verifiedCount}
        failedChecks={failedChecks}
        verifying={verifying}
        status={petition.status}
        dirty={dirty}
        unverifiedInText={petition.unverifiedInText ?? []}
        verificationRun={readyGate?.verificationRun ?? checks.length > 0}
        onVerify={() => void handleVerify()}
        onPublish={() => void handleStatus("HAZIR")}
      />

      {failedOnPublish.length > 0 && (
        <Card title="Teyit kapısı geçilemedi — takılan atıflar">
          <p className="text-xs text-slate-600">
            Aşağıdaki atıflar doğrulanamadığı için işlem reddedildi.{" "}
            <strong>İçtihat atıfları için istisna yoktur:</strong> kararı künyesiyle sisteme
            ekleyin, doğru künyeyle değiştirin ya da cümleyi metinden çıkarın.
          </p>
          <ul className="mt-3 space-y-2">
            {failedOnPublish.map((c, i) => (
              <li key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={CITATION_STATUS_TONES[c.status] ?? "red"}>
                    {labelOf(CITATION_STATUS_LABELS, c.status)}
                  </Badge>
                  {c.kind && <Badge tone="gray">{c.kind}</Badge>}
                  <span className="text-sm font-medium text-red-900">{c.rawCitation}</span>
                </div>
                {c.reason && <p className="mt-1 text-xs text-red-800">{c.reason}</p>}
                {c.remedy && <p className="mt-0.5 text-xs text-red-700">→ {c.remedy}</p>}
                {!c.reason && c.note && <p className="mt-1 text-xs text-red-800">{c.note}</p>}
              </li>
            ))}
          </ul>

          {statuteAsk.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
              <p className="text-xs font-semibold text-amber-900">
                Mevzuat atıfları için avukat beyanı gerekiyor
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                Madde metni ve yürürlük havuzu sistemde henüz yok; bu yüzden mevzuat atıfları
                otomatik doğrulanamıyor. Aşağıdaki maddeleri{" "}
                <strong>yürürlükteki mevzuattan kontrol ettiyseniz</strong> beyan edebilirsiniz;
                beyanınız denetim kaydına yazılır ve sorumluluk size ait olur.
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
                {statuteAsk.map((raw) => (
                  <li key={raw}>{raw}</li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="gold"
                className="mt-3"
                onClick={() => void handleStatus("HAZIR", statuteAsk)}
              >
                Bu maddeleri teyit ettim, HAZIR yap
              </Button>
            </div>
          )}
        </Card>
      )}

      {pii && (
        <PiiApprovalBox
          prompt={pii.prompt}
          busy={drafting || rewriting}
          onApprove={approvePii}
          onCancel={() => setPii(null)}
        />
      )}

      {/* Bölümler */}
      <div className="space-y-4">
        {sections.map((s) => (
          <Card
            key={s.title}
            title={s.title}
            action={
              <div className="flex items-center gap-2">
                {s.required && <Badge tone="navy">zorunlu</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setRewriteTarget(s.title);
                    setRewriteInstruction("");
                  }}
                >
                  Yeniden Yaz
                </Button>
              </div>
            }
          >
            {s.hint && <p className="mb-2 text-xs text-slate-400">{s.hint}</p>}
            <Textarea
              rows={Math.min(20, Math.max(4, sectionBody(s).split("\n").length + 2))}
              value={sectionBody(s)}
              onChange={(e) => updateSection(s.title, e.target.value)}
              placeholder={`${s.title} bölümünü buraya yazın veya AI ile üretin…`}
              className="font-serif leading-7"
            />
            <p className="mt-1 text-right text-[11px] text-slate-400">
              {sectionBody(s).length.toLocaleString("tr-TR")} karakter
            </p>
          </Card>
        ))}
      </div>

      {/* Kaydetme şeridi */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-lg">
        <Input
          value={saveNote}
          onChange={(e) => setSaveNote(e.target.value)}
          placeholder="Sürüm notu (örn. bilirkişi itirazı eklendi)"
          className="max-w-sm flex-1"
        />
        <Button variant="gold" disabled={saving || !dirty} onClick={() => void handleSave()}>
          {saving ? "Kaydediliyor…" : dirty ? "Yeni Sürüm Kaydet" : "Değişiklik yok"}
        </Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => void load(false)}>
          Değişiklikleri geri al
        </Button>
        <span className="ml-auto text-[11px] text-slate-400">
          Sürümler değiştirilemez — her kayıt yeni bir sürüm numarası üretir.
        </span>
      </div>

      {/* AI taslak modalı */}
      <Modal open={draftOpen} title="AI ile Taslak Üret" onClose={() => setDraftOpen(false)} wide>
        <div className="space-y-4">
          <AiDisclaimer text="AI, dosyanın belgelerini ve safahatını kullanarak taslak üretir. Üretilen metin doğrudan kaydedilmez; siz düzenleyip kaydedene kadar sürüm oluşmaz." />
          <Field
            label="Talimat"
            hint="Boş bırakırsanız dosya bağlamına göre standart taslak üretilir."
          >
            <Textarea
              rows={4}
              value={draftInstruction}
              onChange={(e) => setDraftInstruction(e.target.value)}
              placeholder="Örn. Zamanaşımı savunmasını öne çıkar, fazla mesai alacağı hesabına ayrı başlık aç."
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDraftOpen(false)}>
              Vazgeç
            </Button>
            <Button
              variant="gold"
              disabled={drafting}
              onClick={() => void runDraft(draftInstruction, false)}
            >
              {drafting ? "Üretiliyor…" : "Taslağı Üret"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bölüm yeniden yazma modalı */}
      <Modal
        open={rewriteTarget !== null}
        title={`Yeniden Yaz — ${rewriteTarget ?? ""}`}
        onClose={() => setRewriteTarget(null)}
        wide
      >
        <div className="space-y-4">
          <Field label="Talimat" hint="Bu bölüm nasıl değişsin?">
            <Textarea
              rows={4}
              autoFocus
              value={rewriteInstruction}
              onChange={(e) => setRewriteInstruction(e.target.value)}
              placeholder="Örn. Daha kısa ve resmî bir dille yeniden yaz; HMK m.119 atfını koru."
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setRewriteTarget(null)}>
              Vazgeç
            </Button>
            <Button
              variant="gold"
              disabled={rewriting || !rewriteInstruction.trim() || !rewriteTarget}
              onClick={() =>
                rewriteTarget && void runRewrite(rewriteTarget, rewriteInstruction, false)
              }
            >
              {rewriting ? "Yazılıyor…" : "Yeniden Yaz"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Versiyon geçmişi */}
      <Modal
        open={versionsOpen}
        title="Versiyon Geçmişi"
        onClose={() => setVersionsOpen(false)}
        wide
      >
        {versions.length === 0 ? (
          <EmptyState message="Henüz kaydedilmiş sürüm yok." />
        ) : (
          <ul className="space-y-3">
            {[...versions]
              .sort((a, b) => b.versionNo - a.versionNo)
              .map((v) => (
                <li key={v.id} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      Sürüm {v.versionNo}
                      {petition.currentVersionId === v.id && (
                        <Badge tone="gold" className="ml-2">
                          güncel
                        </Badge>
                      )}
                    </p>
                    <span className="text-xs text-slate-400">{fmtDateTime(v.createdAt)}</span>
                  </div>
                  {v.note && <p className="mt-1 text-xs text-slate-600">{v.note}</p>}
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      const restored = sectionsOf(v);
                      if (restored.length > 0) {
                        setSections(restored);
                        setDirty(true);
                        setVersionsOpen(false);
                        push(
                          `Sürüm ${v.versionNo} düzenleyiciye yüklendi. Kaydettiğinizde yeni bir sürüm olarak yazılır.`,
                          "info",
                        );
                      }
                    }}
                  >
                    Bu sürümü düzenleyiciye yükle
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </Modal>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

/**
 * Atıf teyit durumu şeridi — dilekçenin yayına hazırlık göstergesi.
 *
 * ÜÇ DURUM AYRI AYRI GÖSTERİLİR ve asla karıştırılmaz:
 *  - ÇALIŞTIRILMADI (nötr): teyit henüz koşmadı. Boş liste "tamam" DEĞİLDİR.
 *  - TAKILAN VAR (kırmızı): doğrulanmayan ya da [DEMO VERİ] atıf var.
 *  - TAMAM (yeşil): teyit koştu ve her atıf gerçek bir kayda bağlandı.
 */
function VerifyStrip({
  checks,
  verifiedCount,
  failedChecks,
  verifying,
  status,
  dirty,
  unverifiedInText,
  verificationRun,
  onVerify,
  onPublish,
}: {
  checks: CitationCheckItem[];
  verifiedCount: number;
  failedChecks: CitationCheckItem[];
  verifying: boolean;
  status: string;
  dirty: boolean;
  unverifiedInText: string[];
  verificationRun: boolean;
  onVerify: () => void;
  onPublish: () => void;
}) {
  const ran = verificationRun && (checks.length > 0 || unverifiedInText.length === 0);
  const clean = ran && failedChecks.length === 0 && unverifiedInText.length === 0;
  const tone = !ran
    ? "border-slate-200 bg-white"
    : clean
      ? "border-emerald-300 bg-emerald-50"
      : "border-red-300 bg-red-50";

  return (
    <div className={`rounded-xl border px-5 py-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Teyit durumu:{" "}
            {!ran
              ? "henüz çalıştırılmadı"
              : clean
                ? checks.length === 0
                  ? "metinde atıf yok"
                  : `${verifiedCount} atıfın tamamı doğrulandı`
                : `${failedChecks.length} atıf doğrulanamadı (${verifiedCount}/${checks.length} tamam)`}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Madde ve içtihat künyeleri kaynağa karşı denetlenir; uydurma atıf tespit edilirse
            dilekçe HAZIR statüsüne alınamaz ve dışa aktarılamaz.
          </p>
          {dirty && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Kaydedilmemiş değişiklikleriniz var — teyit ve statü, sunucudaki güncel sürüm
              üzerinde çalışır. Önce kaydedin.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onVerify} disabled={verifying || dirty}>
            {verifying ? "Teyit ediliyor…" : "Teyidi Çalıştır"}
          </Button>
          <Button
            size="sm"
            variant="gold"
            onClick={onPublish}
            disabled={status === "HAZIR" || verifying || dirty}
          >
            {status === "HAZIR" ? "Hazır" : "Hazır olarak işaretle"}
          </Button>
        </div>
      </div>

      {unverifiedInText.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-xs font-semibold text-amber-900">
            Metinde teyit çalıştırılmamış {unverifiedInText.length} atıf var
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {unverifiedInText.map((raw) => (
              <li key={raw}>{raw}</li>
            ))}
          </ul>
        </div>
      )}

      {checks.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {checks.map((c, i) => (
            <li key={i} className="flex flex-wrap items-start gap-2 text-xs">
              <Badge tone={c.isDemo ? "red" : (CITATION_STATUS_TONES[c.status] ?? "gray")}>
                {c.isDemo ? "DEMO VERİ" : labelOf(CITATION_STATUS_LABELS, c.status)}
              </Badge>
              <span className="font-medium text-slate-800">{c.rawCitation}</span>
              {c.note && <span className="text-slate-500">— {c.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {clean && checks.length > 0 && (
        <div className="mt-3">
          <SuccessBox message="Tüm atıflar kaynağa karşı doğrulandı. Dilekçe dışa aktarmaya hazır." />
        </div>
      )}
    </div>
  );
}
