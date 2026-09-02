"use client";

/**
 * ASİSTAN — yazılı + sesli.
 *
 * Yazılı: mevcut /ai/chat ucu (CASE_CHAT; dosya bağlamsız genel sorular dahil).
 * Sesli: Web Speech API —
 *   - SÖYLE: tarayıcının konuşma tanıması (webkitSpeechRecognition, tr-TR)
 *   - DİNLE: tarayıcının konuşma sentezi (speechSynthesis)
 *
 * TARAYICI DESTEĞİ DÜRÜSTÇÜ BİLDİRİLİR: SpeechRecognition yalnız Chrome/Edge'de
 * vardır; desteklenmiyorsa sesli düğme gizlenir, yazılı asistan her yerde çalışır.
 *
 * ÜRÜN İLKESİ: yanıtlar KAYNAK GÖSTERİR (citations) ve ÖNERİDİR — avukat
 * onaylamadan dosyaya işlenmez. AI TARAFSIZDIR (çekirdek prompt kuralı 2).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, Card, EmptyState, ErrorBox, Input, Spinner } from "@/components/ui";

interface Citation {
  kind?: string;
  label?: string;
  quote?: string;
}

interface ChatAnswer {
  answer: string;
  citations?: Citation[];
  noSource?: boolean;
  followUpSuggestions?: string[];
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
}

/** Web Speech API tipleri — tarayıcı destekliyorsa dolar. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export default function AsistanPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOut, setVoiceOut] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Konuşma tanıması desteği (Chrome/Edge) — yoksa sesli girişi gizle.
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSpeechSupported(Ctor !== undefined);
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = "tr-TR";
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (event) => {
        const transcript = event.results[event.resultIndex]?.[0]?.transcript;
        if (transcript) setQuestion((q) => (q ? `${q} ${transcript}` : transcript));
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recognitionRef.current = rec;
    }
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* zaten kapalı */
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length]);

  // voiceOut ref'te tutulur — speak bağımlılığı sabit kalır.
  const voiceOutRef = useRef(voiceOut);
  voiceOutRef.current = voiceOut;

  function speak(text: string) {
    if (!voiceOutRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "tr-TR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setBusy(true);
      setError(null);
      setTurns((prev) => [...prev, { role: "user", text: q }]);
      setQuestion("");
      try {
        const res = await api<ChatAnswer>("/ai/chat", { method: "POST", body: { message: q } });
        setTurns((prev) => [
          ...prev,
          { role: "assistant", text: res.answer, citations: res.citations },
        ]);
        speak(res.answer);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "Asistan yanıtlamadı.";
        setError(msg);
        setTurns((prev) => [...prev, { role: "assistant", text: `Yanıt alınamadı: ${msg}` }]);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  function toggleListen() {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      setListening(true);
      try {
        rec.start();
      } catch {
        setListening(false);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Asistan</h1>
          <p className="mt-1 text-sm text-slate-500">
            Yazılı veya sesli sorun — yanıtlar kaynak gösterir, tarafsızdır ve öneridir.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={voiceOut}
            onChange={(e) => setVoiceOut(e.target.checked)}
            className="h-4 w-4 accent-amber-600"
          />
          Yanıtları sesli oku
        </label>
      </div>

      <Card className="flex h-[calc(100vh-300px)] min-h-[420px] flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {turns.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                message={
                  speechSupported
                    ? "Yazın veya mikrofona basıp konuşun — «İşe iade davasında ispat yükü kimdedir?» gibi."
                    : "Yazın — «İşe iade davasında ispat yükü kimdedir?» gibi. Sesli giriş bu tarayıcıda desteklenmiyor."
                }
              />
            </div>
          ) : (
            turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    t.role === "user"
                      ? "rounded-br-md bg-amber-500 text-white"
                      : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{t.text}</p>
                  {t.citations && t.citations.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-slate-200 pt-1.5">
                      {t.citations.map((c, j) => (
                        <p key={j} className="text-[11px] text-slate-500">
                          📄 {c.label ?? c.kind ?? "Kaynak"}
                          {c.quote ? ` — "${c.quote.slice(0, 80)}…"` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-500">
                <Spinner label="Düşünülüyor…" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="px-4 pt-2">
            <ErrorBox message={error} />
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-3">
          {speechSupported && (
            <Button
              variant={listening ? "danger" : "secondary"}
              onClick={toggleListen}
              aria-label={listening ? "Dinlemeyi durdur" : "Mikrofonla konuş"}
            >
              {listening ? "● Durdur" : "🎤"}
            </Button>
          )}
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder="Sorunuzu yazın… (Enter gönderir)"
            aria-label="Soru"
          />
          <Button variant="gold" disabled={busy || !question.trim()} onClick={() => void ask(question)}>
            {busy ? "…" : "Sor"}
          </Button>
        </div>
      </Card>

      <p className="text-center text-[11px] text-slate-500">
        Çıktılar yapay zekâ önerisidir; hukuki değerlendirme ve sorumluluk avukata aittir. Analizler
        tarafsız yürütülür — lehte bulgu abartılmaz, aleyhte bulgu gizlenmez.
      </p>
    </div>
  );
}
