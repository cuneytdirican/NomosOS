import { SampleDataBadge } from "./primitives";
import { heroMockup } from "./content";

/**
 * Panel mockup'ı — ekran görüntüsü yerine CSS ile çizilmiş gerçekçi bir arayüz taslağı
 * (docs/08 §4: sahte fotoğraf kullanılmaz, üzerinde "örnek veri" ibaresi bulunur).
 */
export function DashboardMockup() {
  return (
    <figure className="m-0 overflow-hidden rounded-[6px] border border-[var(--rule)] bg-white shadow-[0_1px_2px_rgba(15,27,51,0.05)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--rule)] bg-[var(--paper-alt)] px-4 py-2.5">
        <span className="text-xs font-medium tracking-wide text-[var(--ink-soft)]">
          {heroMockup.windowTitle}
        </span>
        <SampleDataBadge label={heroMockup.sampleBadge} />
      </div>

      <div className="grid gap-0 sm:grid-cols-[1.35fr_1fr]">
        {/* Yaklaşan süreler */}
        <div className="border-b border-[var(--rule)] p-4 sm:border-b-0 sm:border-r">
          <h3 className="!text-[0.95rem] !font-semibold">{heroMockup.deadlines.title}</h3>
          <table className="tnum mt-3 w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[var(--ink-soft)]">
                <th scope="col" className="pb-2 font-medium">
                  Dosya
                </th>
                <th scope="col" className="pb-2 font-medium">
                  Son gün
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Kalan
                </th>
              </tr>
            </thead>
            <tbody>
              {heroMockup.deadlines.rows.map((row) => (
                <tr key={row.case} className="border-t border-[var(--rule)] align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-medium text-[var(--ink)]">{row.case}</span>
                    <span className="block text-[11.5px] text-[var(--ink-soft)]">{row.type}</span>
                  </td>
                  <td className="py-2 pr-3 text-[var(--ink)]">{row.due}</td>
                  <td className="py-2 text-right">
                    <span className="rounded-sm bg-[var(--gold-soft)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#6a5518]">
                      {row.left}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bugünün duruşmaları + onay kuyruğu */}
        <div className="p-4">
          <h3 className="!text-[0.95rem] !font-semibold">{heroMockup.hearings.title}</h3>
          <ul className="tnum mt-3 space-y-2.5">
            {heroMockup.hearings.rows.map((row) => (
              <li key={row.time} className="flex gap-3 border-t border-[var(--rule)] pt-2.5">
                <span className="w-11 shrink-0 text-[12.5px] font-semibold text-[var(--ink)]">
                  {row.time}
                </span>
                <span className="text-[12.5px] leading-snug text-[var(--ink-soft)]">
                  <span className="block text-[var(--ink)]">{row.court}</span>
                  {row.case}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 rounded-[4px] border border-[var(--rule)] bg-[var(--paper)] p-3">
            <div className="flex items-baseline gap-2">
              <span className="tnum serif text-[1.4rem] leading-none">{heroMockup.queue.value}</span>
              <span className="text-[12.5px] font-medium text-[var(--ink)]">
                {heroMockup.queue.title}
              </span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ink-soft)]">
              {heroMockup.queue.note}
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}
