"use client";

/**
 * Avukatım — sorumlu avukatın iletişim kartı.
 *
 * Portalın en sade ekranı ama işlevi büyük: müvekkil paniklediğinde aradığı
 * ilk sayfa burasıdır. Bu yüzden telefon ve e-posta doğrudan aranabilir/
 * yazılabilir bağlantılardır (`tel:` / `mailto:`), üç tıklama arkasında değil.
 */

import Link from "next/link";
import { EP } from "@/lib/endpoints";
import { useResource } from "@/lib/useResource";
import { firstOf } from "@/lib/labels";
import type { PortalLawyer } from "@/lib/types";
import { Card, PageHeader, PrivacyNote, ResourceView } from "@/components/ui";

/**
 * Sunucu `{ officeName, lawyers: [...] }` döndürür — tek bir avukat nesnesi
 * DEĞİL (denetim bulgusu G). Kart, dosyalardan sorumlu ilk avukatı gösterir;
 * büro adı ayrı alandan gelir.
 *
 * `phone` alanı sunucuda YOKTUR ve uydurulmaz: `User` şemasında telefon
 * kolonu bulunmuyor. Alan gelmediğinde ekran o satırı hiç çizmez.
 */
interface LawyerCardResponse {
  officeName?: string | null;
  lawyers?: PortalLawyer[];
}

export default function MyLawyerPage() {
  const res = useResource<LawyerCardResponse>(EP.myLawyer);
  const lawyer = res.data?.lawyers?.[0] ?? null;

  const name = firstOf(lawyer?.fullName, lawyer?.name);
  const office = firstOf(res.data?.officeName ?? undefined, lawyer?.officeName, lawyer?.tenantName);
  const phone = firstOf(lawyer?.phone, lawyer?.officePhone);

  return (
    <div>
      <PageHeader
        title="Avukatım"
        description="Dosyalarınızdan sorumlu avukatınız ve büronuzun iletişim bilgileri."
      />

      <ResourceView
        loading={res.loading}
        missing={res.missing}
        forbidden={res.forbidden}
        error={res.error}
        empty={res.loaded && !lawyer}
        endpoint={res.endpoint}
        onRetry={res.reload}
        loadingLabel="İletişim bilgileri getiriliyor…"
        emptyMessage="İletişim bilgileri henüz paylaşılmadı."
        emptyHint="Bu bilgiler eklendiğinde burada görünür."
      >
        {lawyer && (
          <div className="space-y-6">
            <Card>
              <div className="flex flex-wrap items-center gap-5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ink text-2xl font-semibold text-paper">
                  {(name ?? "?").charAt(0).toLocaleUpperCase("tr-TR")}
                </div>
                <div className="min-w-0">
                  <p className="font-serif text-xl font-semibold text-ink">
                    {name ?? "Avukatınız"}
                  </p>
                  {firstOf(lawyer.title, lawyer.role) && (
                    <p className="mt-1 text-[15px] text-ink-soft">
                      {firstOf(lawyer.title, lawyer.role)}
                    </p>
                  )}
                  {office && <p className="mt-0.5 text-[15px] text-ink-soft">{office}</p>}
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {phone && (
                  <ContactLink
                    href={`tel:${phone.replace(/\s+/g, "")}`}
                    label="Telefon"
                    value={phone}
                  />
                )}
                {lawyer.email && (
                  <ContactLink
                    href={`mailto:${lawyer.email}`}
                    label="E-posta"
                    value={lawyer.email}
                  />
                )}
              </div>

              {(lawyer.officeAddress || lawyer.workingHours) && (
                <dl className="mt-6 space-y-3 border-t border-rule/60 pt-5 text-[15px]">
                  {lawyer.officeAddress && (
                    <div>
                      <dt className="text-sm font-medium text-ink-faint">Büro adresi</dt>
                      <dd className="mt-0.5 max-w-reading leading-relaxed text-ink">
                        {lawyer.officeAddress}
                      </dd>
                    </div>
                  )}
                  {lawyer.workingHours && (
                    <div>
                      <dt className="text-sm font-medium text-ink-faint">Çalışma saatleri</dt>
                      <dd className="mt-0.5 text-ink">{lawyer.workingHours}</dd>
                    </div>
                  )}
                </dl>
              )}
            </Card>

            <Card title="Nasıl ulaşmalıyım?">
              <ul className="space-y-3 text-[15px] leading-relaxed text-ink-soft">
                <li>
                  <strong className="font-medium text-ink">Acele olmayan sorular</strong> için{" "}
                  <Link href="/mesajlar" className="underline underline-offset-4 hover:text-gold-deep">
                    Mesajlar
                  </Link>{" "}
                  sayfasını kullanın. Yazışmanız dosyanızla birlikte kayıt altında kalır.
                </li>
                <li>
                  <strong className="font-medium text-ink">Duruşma günü değişikliği,
                  tebligat ya da acil bir belge</strong> söz konusuysa telefonla arayın.
                </li>
                <li>
                  Avukatınız veya büro çalışanları sizden <strong className="font-medium text-ink">hiçbir
                  zaman portal şifrenizi</strong> istemez.
                </li>
              </ul>
            </Card>
          </div>
        )}
      </ResourceView>

      <div className="mt-8">
        <PrivacyNote />
      </div>
    </div>
  );
}

function ContactLink({
  href,
  label,
  value,
}: {
  href: string;
  label: string;
  value: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col rounded-xl border border-rule bg-paper-alt/50 px-5 py-4 transition-colors hover:bg-paper-alt"
    >
      <span className="text-sm font-medium text-ink-faint">{label}</span>
      <span className="mt-1 break-words text-[15px] font-medium text-ink">{value}</span>
    </a>
  );
}
