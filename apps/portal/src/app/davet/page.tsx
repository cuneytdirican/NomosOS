"use client";

/**
 * Davet kabul — ad soyad + şifre belirleme.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ TOKEN ADRES FRAGMENT'İNDEDİR: /davet#<token>                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Bağlantı eskiden `/davet/<64-hane-ham-token>` biçimindeydi ve ham token
 * böylece şuralara düşüyordu (denetim bulgusu 8):
 *
 *   • tarayıcı geçmişine,
 *   • Next.js sunucusunun ve önündeki her ters vekilin/CDN'in ERİŞİM
 *     GÜNLÜĞÜNE (yol tam olarak loglanır),
 *   • sayfadan dışa giden her isteğin `Referer` başlığına.
 *
 * Sonucu: erişim günlüklerini okuyabilen bir operatör (ya da sızmış bir log
 * toplayıcı), davet henüz kullanılmamışsa müvekkilin portal hesabını KENDİ
 * belirlediği parolayla açabilirdi. Token'ın veritabanında hash'lenerek
 * saklanması bu yolu KAPATMAZ — sızan şey ham token'ın kendisidir.
 *
 * Fragment (`#...`) sunucuya HİÇ GİTMEZ: loglanmaz, `Referer`'a girmez.
 * Kabul tamamlanınca `history.replaceState` ile adres ayrıca temizlenir.
 * Doğrulama sorgusu da POST gövdesiyle yapılır (`/auth/invite/check`), yani
 * token bir daha hiçbir URL'e yazılmaz.
 */

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  errorMessage,
  isEndpointMissing,
  portalApi,
  setStoredUser,
  setToken,
  toStoredUser,
} from "@/lib/api";
import { EP } from "@/lib/endpoints";
import { fmtDateTime } from "@/lib/labels";
import type { InviteInfo, LoginResponse } from "@/lib/types";
import { Button, ErrorBox, Field, InfoBox, Input, Spinner } from "@/components/ui";
import { AuthShell } from "@/components/AuthShell";

/**
 * SUNUCUYLA AYNI KURAL. Denetim bulgusu G: istemci 8 karakter istiyor, sunucu
 * 10 karakter + en az bir rakam arıyordu; müvekkil "8 karakter yeterli" diyen
 * bir ekranda şifre yazıp anlaşılmaz bir 400 alıyordu.
 * Kaynak: apps/api/src/portal/portal.constants.ts → PORTAL_MIN_PASSWORD_LENGTH
 * ve portal.schemas.ts → portalPassword.
 */
const MIN_PASSWORD_LENGTH = 10;
const PASSWORD_RULE = /^(?=.*[A-Za-zÇĞİÖŞÜçğıöşü])(?=.*\d).+$/;

export default function InvitePage() {
  const router = useRouter();

  const [token, setTokenValue] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  /** Davet ucu yanıt vermiyor — form yine de denenebilir. */
  const [checkUnavailable, setCheckUnavailable] = useState(false);
  /** Davet açıkça geçersiz (sunucu reddetti). Form gösterilmez. */
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Token adres fragment'inden okunur; fragment sunucuya hiç gönderilmez.
  // `null` = henüz okunmadı, `""` = bağlantıda token yok.
  useEffect(() => {
    setTokenValue(window.location.hash.replace(/^#/, "").trim());
  }, []);

  useEffect(() => {
    // İlk render: hash daha okunmadı.
    if (token === null) return;
    if (token === "") {
      setChecking(false);
      return;
    }
    let cancelled = false;
    portalApi<InviteInfo>(EP.auth.inviteCheck, {
      method: "POST",
      body: { token },
      noAuthRedirect: true,
    })
      .then((res) => {
        if (cancelled) return;
        if (res && res.valid === false) {
          setInvalidReason(
            res.message ??
              "Bu davet bağlantısı geçerli değil ya da süresi dolmuş olabilir.",
          );
          return;
        }
        setInvite(res ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isEndpointMissing(err)) {
          setCheckUnavailable(true);
          return;
        }
        setInvalidReason(
          errorMessage(err, "Bu davet bağlantısı geçerli değil ya da süresi dolmuş olabilir."),
        );
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (fullName.trim().length < 2) {
      setError("Ad ve soyadınızı yazın.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Şifreniz en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`);
      return;
    }
    if (!PASSWORD_RULE.test(password)) {
      setError("Şifreniz en az bir harf ve en az bir rakam içermeli.");
      return;
    }
    if (password !== confirm) {
      setError("İki şifre birbiriyle aynı değil. Lütfen tekrar yazın.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await portalApi<LoginResponse>(EP.auth.acceptInvite, {
        method: "POST",
        body: { token, fullName: fullName.trim(), password },
        noAuthRedirect: true,
      });

      // Token'ı adresten TEMİZLE: geri tuşu ya da paylaşılan ekran görüntüsü
      // üzerinden bir daha görünmesin.
      window.history.replaceState(null, "", "/davet");

      if (res?.accessToken) {
        setToken(res.accessToken);
        if (res.portalUser) setStoredUser(toStoredUser(res.portalUser));
        router.replace("/");
        return;
      }
      // Sunucu token döndürmediyse şifre kaydedilmiş olabilir; girişe yönlendiririz.
      router.replace("/giris");
    } catch (err) {
      if (isEndpointMissing(err)) {
        setError(
          "Portal şu anda hizmet veremiyor. Kısa bir süre sonra tekrar deneyin ya da avukatınıza ulaşın.",
        );
      } else {
        setError(errorMessage(err, "Şifreniz kaydedilemedi. Lütfen tekrar deneyin."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (token === "" && !checking) {
    return (
      <AuthShell title="Bağlantı eksik">
        <ErrorBox message="Davet bağlantısı okunamadı." />
        <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
          Bağlantıyı avukatınızın gönderdiği hâliyle, tamamını kopyalayarak açın.
          Bağlantının sonundaki uzun kod eksikse davet doğrulanamaz.
        </p>
        <Link
          href="/giris"
          className="mt-5 inline-block text-[15px] font-medium text-gold-deep underline underline-offset-4"
        >
          Giriş ekranına dön
        </Link>
      </AuthShell>
    );
  }

  if (checking) {
    return (
      <AuthShell title="Davetiniz kontrol ediliyor">
        <Spinner label="Bağlantınız doğrulanıyor…" />
      </AuthShell>
    );
  }

  if (invalidReason) {
    return (
      <AuthShell title="Bağlantı kullanılamıyor">
        <ErrorBox message={invalidReason} />
        <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
          Davet bağlantıları güvenlik gereği belirli bir süre sonra geçersiz olur.
          Avukatınızdan yeni bir davet isteyebilirsiniz.
        </p>
        <Link
          href="/giris"
          className="mt-5 inline-block text-[15px] font-medium text-gold-deep underline underline-offset-4"
        >
          Giriş ekranına dön
        </Link>
      </AuthShell>
    );
  }

  const expiresLabel = fmtDateTime(invite?.expiresAt);

  return (
    <AuthShell
      title="Portal hesabınızı oluşturun"
      subtitle={
        invite?.clientName
          ? `${invite.clientName} adına açılan portal erişiminiz için bir şifre belirleyin.`
          : "Portal erişiminiz için bir şifre belirleyin."
      }
    >
      {checkUnavailable && (
        <div className="mb-5">
          <InfoBox>
            Davetiniz şu anda doğrulanamadı, ancak şifrenizi belirlemeyi
            deneyebilirsiniz. Sorun sürerse avukatınıza ulaşın.
          </InfoBox>
        </div>
      )}

      {invite?.email && (
        <p className="mb-5 rounded-xl bg-paper-alt/70 px-4 py-3 text-[15px] text-ink-soft">
          Hesabınız <strong className="font-medium text-ink">{invite.email}</strong>{" "}
          adresine tanımlandı.
          {expiresLabel && (
            <>
              {" "}
              Bu bağlantı{" "}
              <span className="whitespace-nowrap">{expiresLabel}</span> tarihine
              kadar geçerlidir.
            </>
          )}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <Field
          label="Ad ve soyadınız"
          htmlFor="fullName"
          hint="Yazışmalarda size bu isimle hitap edilir."
        >
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ayşe Yılmaz"
          />
        </Field>

        <Field
          label="Yeni şifreniz"
          htmlFor="password"
          hint={`En az ${MIN_PASSWORD_LENGTH} karakter olmalı ve en az bir rakam içermeli. Kolay tahmin edilmeyen bir şifre seçin.`}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
          />
        </Field>

        <Field label="Şifrenizi tekrar yazın" htmlFor="confirm">
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••••"
          />
        </Field>

        {error && <ErrorBox message={error} />}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Kaydediliyor…" : "Şifremi belirle ve gir"}
        </Button>
      </form>

      <p className="mt-6 text-sm leading-relaxed text-ink-faint">
        Şifrenizi kimseyle paylaşmayın. Avukatınız veya büro çalışanları sizden
        hiçbir zaman şifrenizi istemez.
      </p>
    </AuthShell>
  );
}
