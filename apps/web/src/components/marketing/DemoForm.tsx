"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { demo } from "./content";

/**
 * Demo talep formu (docs/08 §3.12).
 *
 * KVKK onayı ZORUNLUDUR: onay kutusu işaretlenmeden form gönderilemez. Kontrol
 * hem `required` özniteliğiyle (tarayıcı doğrulaması), hem gönderim
 * işleyicisinde, hem de SUNUCUDA yapılır — istemciye güvenilmez.
 *
 * DÜRÜSTLÜK KURALI (denetim bulgusu): form önce hiçbir yere istek atmadan
 * "Talebiniz alındı. Ekibimiz bir iş günü içinde size dönecek." diyordu. Artık
 * `POST /api/demo-talebi` çağrılır ve KULLANICIYA GERÇEK DURUM gösterilir:
 *   - iletildiyse  → "Talebiniz alındı" (çünkü alındı),
 *   - iletilemezse → talep e-postayla gönderilsin diye hazır doldurulmuş bir
 *     `mailto` bağlantısı. Gerçekleşmeyecek bir taahhüt hiçbir dalda verilmez.
 */
export function DemoForm() {
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  /** Talep gerçekten iletildi mi? `false` → e-posta yolu gösterilir. */
  const [delivered, setDelivered] = useState(false);
  const [mailtoHref, setMailtoHref] = useState<string>(demo.fallback.mailto);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) {
      setError(demo.consent.error);
      return;
    }
    setError(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      fullName: String(form.get("fullName") ?? ""),
      barAssociation: String(form.get("barAssociation") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      lawyerCount: String(form.get("lawyerCount") ?? ""),
      message: String(form.get("message") ?? ""),
      consent: true,
    };
    setMailtoHref(buildMailto(payload));

    try {
      const response = await fetch("/api/demo-talebi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { ok?: boolean; delivered?: boolean; hata?: string };
      if (!response.ok || !data.ok) {
        setError(data.hata ?? demo.fallback.error);
        setSubmitting(false);
        return;
      }
      setDelivered(data.delivered === true);
      setDone(true);
    } catch {
      // Ağ hatası: talep iletilmedi. Kullanıcıya bunu SÖYLE, e-posta yolunu ver.
      setDelivered(false);
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-[5px] border border-[var(--gold)] bg-[var(--gold-soft)]/35 p-7"
      >
        <h2 className="!text-[1.25rem]">
          {delivered ? demo.success.title : demo.fallback.title}
        </h2>
        <p className="mt-3 text-[1rem] text-[var(--ink-soft)]">
          {delivered ? demo.success.text : demo.fallback.text}
        </p>
        {!delivered && (
          <a
            href={mailtoHref}
            className="mt-5 inline-flex items-center justify-center rounded-[4px] bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[#16264a]"
          >
            {demo.fallback.action}
          </a>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate={false}
      className="rounded-[5px] border border-[var(--rule)] bg-white p-6 sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="demo-ad-soyad"
          name="fullName"
          label={demo.fields.fullName.label}
          placeholder={demo.fields.fullName.placeholder}
          autoComplete="name"
          required
        />
        <TextField
          id="demo-baro"
          name="barAssociation"
          label={demo.fields.barAssociation.label}
          placeholder={demo.fields.barAssociation.placeholder}
          autoComplete="organization"
          required
        />
        <TextField
          id="demo-eposta"
          name="email"
          type="email"
          label={demo.fields.email.label}
          placeholder={demo.fields.email.placeholder}
          autoComplete="email"
          required
        />
        <TextField
          id="demo-telefon"
          name="phone"
          type="tel"
          label={demo.fields.phone.label}
          placeholder={demo.fields.phone.placeholder}
          autoComplete="tel"
          required
        />

        <div className="sm:col-span-1">
          <label htmlFor="demo-avukat-sayisi" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
            {demo.fields.lawyerCount.label}
          </label>
          <select
            id="demo-avukat-sayisi"
            name="lawyerCount"
            required
            defaultValue={demo.fields.lawyerCount.options[0]}
            className="w-full rounded-[4px] border border-[var(--rule)] bg-white px-3 py-2.5 text-sm text-[var(--ink)]"
          >
            {demo.fields.lawyerCount.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="demo-mesaj" className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
            {demo.fields.message.label}
          </label>
          <textarea
            id="demo-mesaj"
            name="message"
            rows={4}
            placeholder={demo.fields.message.placeholder}
            className="w-full rounded-[4px] border border-[var(--rule)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)]/60"
          />
        </div>
      </div>

      {/* KVKK onayı — zorunlu */}
      <div className="mt-6 rounded-[4px] border border-[var(--rule)] bg-[var(--paper)] p-4">
        <div className="flex items-start gap-3">
          <input
            id="demo-kvkk"
            name="consent"
            type="checkbox"
            required
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (event.target.checked) setError(null);
            }}
            aria-describedby={error ? "demo-kvkk-hata" : undefined}
            aria-invalid={error ? true : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#7a6220]"
          />
          <label htmlFor="demo-kvkk" className="text-sm text-[var(--ink-soft)]">
            {demo.consent.label}{" "}
            <Link
              href={demo.consent.linkHref}
              className="font-medium text-[#7a6220] underline underline-offset-2"
            >
              {demo.consent.linkLabel}
            </Link>
          </label>
        </div>
        {error && (
          <p id="demo-kvkk-hata" role="alert" className="mt-3 text-sm font-medium text-[#8a2318]">
            {error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting || !consent}
        className="mt-6 inline-flex items-center justify-center rounded-[4px] bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] transition-colors hover:bg-[#16264a] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {submitting ? demo.submittingLabel : demo.submitLabel}
      </button>
    </form>
  );
}

/**
 * Talebi e-postayla göndermek için hazır doldurulmuş `mailto` bağlantısı.
 * Sunucu ucu yapılandırılmadığında ya da iletim düştüğünde kullanılır: kullanıcı
 * girdiği bilgileri ikinci kez yazmak zorunda kalmaz.
 */
function buildMailto(payload: {
  fullName: string;
  barAssociation: string;
  email: string;
  phone: string;
  lawyerCount: string;
  message: string;
}): string {
  const lines = [
    `Ad soyad: ${payload.fullName}`,
    `Baro / büro: ${payload.barAssociation}`,
    `E-posta: ${payload.email}`,
    `Telefon: ${payload.phone}`,
    `Avukat sayısı: ${payload.lawyerCount}`,
    payload.message ? `Mesaj: ${payload.message}` : "",
  ].filter(Boolean);

  const subject = encodeURIComponent(demo.fallback.mailSubject);
  const bodyText = encodeURIComponent(lines.join("\n"));
  return `mailto:${demo.fallback.mailTo}?subject=${subject}&body=${bodyText}`;
}

function TextField({
  id,
  name,
  label,
  placeholder,
  type = "text",
  autoComplete,
  required,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--ink)]">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="w-full rounded-[4px] border border-[var(--rule)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)]/60"
      />
    </div>
  );
}
