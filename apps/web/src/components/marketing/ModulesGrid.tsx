import { Container, Section, SectionHeading } from "./primitives";
import { modules } from "./content";

/**
 * 3.3 Modüller — 12 kart.
 * Kartlarda ikon yerine dosya sekmesi metaforu kullanılır: serif, altın sıra numarası
 * ve üstte ince bir sekme çizgisi. (Robot/beyin/tokmak görseli kullanılmaz.)
 */
export function ModulesGrid() {
  return (
    <Section id="moduller">
      <Container>
        <SectionHeading kicker={modules.kicker} title={modules.title} />

        <ul className="mt-12 grid gap-px overflow-hidden rounded-[5px] border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
          {modules.items.map((module, index) => (
            <li key={module.title} className="bg-white p-6">
              <div className="flex items-baseline gap-3">
                <span
                  className="tnum serif text-[0.95rem] font-semibold !text-[#7a6220]"
                  aria-hidden="true"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="!text-[1.05rem]">{module.title}</h3>
              </div>
              <p className="mt-2.5 text-sm text-[var(--ink-soft)]">{module.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
