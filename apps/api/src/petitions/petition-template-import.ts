/**
 * FAZ 7D — büro dilekçe şablonu içe aktarma (UDF / düz metin → bölüm iskeleti).
 *
 * Büronun elindeki UDF dilekçe, bölüm başlıkları + gövde ipuçlarından oluşan şablona
 * çevrilir. Başlık sezgisi DETERMİNİSTİKTİR (AI yok):
 *   - paragraf ≤ 80 karakter VE harflerinin ≥ %80'i BÜYÜK → başlık ("AÇIKLAMALAR", "SONUÇ VE İSTEM"),
 *   - ya da bilinen dilekçe başlıklarından biriyle başlıyor ("Hukuki Nedenler:", "1- Konu").
 * Başlık sonrası paragraflar o bölümün `hint`'i olur (en çok 2000 karakter). Hiç başlık yoksa
 * tek bölüm ("İÇERİK") üretilir — avukat düzenler. Kişisel veri (ad, TCKN) ipucuna girmesin
 * diye başlık öncesi künye/taraf satırları (ilk başlıktan önceki metin) ATILIR.
 */

import type { TemplateSection } from "./petition-sections";

const KNOWN_HEADINGS = [
  "konu",
  "açıklamalar",
  "aciklamalar",
  "hukuki nedenler",
  "hukuki sebepler",
  "deliller",
  "hukuki deliller",
  "sonuç ve istem",
  "sonuc ve istem",
  "netice ve talep",
  "talep",
  "usule ilişkin itirazlar",
  "esasa ilişkin cevaplar",
  "tazminat talebi",
  "istem",
];

function stripNumbering(s: string): string {
  return s.replace(/^\s*(?:[0-9]{1,2}[-.)]|[A-ZÇĞİÖŞÜ][-.)]|[IVX]{1,4}[-.)])\s*/u, "").trim();
}

/** Mahkeme hitabı ve taraf/künye satırları başlık DEĞİLDİR (kişisel veri şablona girmez). */
const NOT_HEADING_RE = /(MAHKEMES[İI]|HÂK[İI]ML[İI][ĞG][İI]NE|DA[İI]RES[İI]|BAŞKANLI[ĞG]INA|MÜDÜRLÜ[ĞG]ÜNE|^DAVACI|^DAVALI|^VEK[İI]L[İI]|^ALACAKLI|^BORÇLU|^MÜŞTEK[İI]|^SANIK|^ŞÜPHEL[İI]|TCKN|T\.C\.|^ADRES)/u;

export function isHeadingParagraph(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (NOT_HEADING_RE.test(t.toLocaleUpperCase("tr-TR"))) return false;
  const core = stripNumbering(t).replace(/[:：]\s*$/u, "").trim();
  if (!core) return false;
  const lower = core.toLocaleLowerCase("tr-TR");
  if (KNOWN_HEADINGS.some((h) => lower === h || lower.startsWith(h + " ") || lower.startsWith(h + ":"))) return true;
  const letters = [...core].filter((c) => /\p{L}/u.test(c));
  if (letters.length < 3) return false;
  const upper = letters.filter((c) => c === c.toLocaleUpperCase("tr-TR") && c !== c.toLocaleLowerCase("tr-TR")).length;
  return upper / letters.length >= 0.8 && !/[.!?]$/.test(core);
}

export function paragraphsToTemplateSections(paragraphs: readonly string[]): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let current: { title: string; parts: string[] } | null = null;
  for (const raw of paragraphs) {
    const text = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (isHeadingParagraph(text)) {
      if (current) sections.push({ title: current.title, hint: current.parts.join("\n").slice(0, 2000) || undefined, required: sections.length === 0 });
      current = { title: stripNumbering(text).replace(/[:：]\s*$/u, "").trim().slice(0, 120), parts: [] };
      continue;
    }
    // İlk başlıktan önceki künye/taraf satırları atılır (kişisel veri şablona girmez).
    if (current) current.parts.push(text);
  }
  if (current) sections.push({ title: current.title, hint: current.parts.join("\n").slice(0, 2000) || undefined, required: sections.length === 0 });
  if (sections.length === 0) {
    const body = paragraphs.map((p) => (p ?? "").trim()).filter(Boolean).join("\n").slice(0, 2000);
    return [{ title: "İÇERİK", hint: body || undefined, required: true }];
  }
  // İlk bölüm zorunlu; "SONUÇ VE İSTEM" benzeri son bölüm de zorunlu.
  const last = sections[sections.length - 1];
  if (/istem|talep|netice|sonu[cç]/i.test(last.title)) last.required = true;
  return sections;
}

/** Ad → şablon anahtarı: "Bizim Cevap Dilekçemiz" → "BURO_BIZIM_CEVAP_DILEKCEMIZ". */
export function templateKeyFromName(name: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  let out = "";
  for (const ch of name.toLocaleLowerCase("tr-TR")) out += map[ch] ?? ch;
  const slug = out.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 48);
  return `BURO_${slug || "SABLON"}`;
}
