/**
 * UYAP "İcra Dosyası" ekranı parser'ı (Faz 6).
 *
 * İcra dosya ekranı yapısal olarak "Dosya Detay" ile aynı iskeleti taşır (künye + taraflar);
 * ek olarak takip türü, takip tarihi, alacak tutarı ve dosya aşaması künyede yer alır.
 * Bu parser genel dosya detay parser'ını çalıştırır, sonra icra alanlarını ekler.
 *
 * Eşleşme kuralı (dar kapsam, yanlış pozitif istemeyiz):
 *  - dosya detay imzası tutmalı, VE
 *  - künyede icra'ya özgü bir etiket bulunmalı ("Takip Türü" / "Alacak Tutarı" / "Takip Tarihi")
 *    YA DA birim adı "İcra" içermeli.
 *
 * Tutar okuma: "12.500,00 TL" → "12500.00" (ondalık nokta, iki hane). Okunamayan alan null.
 */

import { failure, labelValue, queryFirst, readLabelValueMap, signatureMessage, success, verifySignature } from "./base";
import { SELECTORS_V1 as DETAY_SELECTORS, dosyaDetayParser } from "./dosya-detay";
import { normalizeTr, parseTrDate, parseTrNumber } from "../../lib/text";
import type { PageContext, PageSignature, ParseResult, UyapParser } from "../../types/parser";
import type { UyapDosyaDetay, UyapIcraDosya } from "../../types/uyap";

export const ICRA_LABELS = {
  takipTuru: ["Takip Türü", "Takip Tipi", "Takip Yolu", "Takip Şekli"],
  takipTarihi: ["Takip Tarihi", "Takip Talebi Tarihi", "Takip Başlangıç Tarihi"],
  alacakTutari: ["Alacak Tutarı", "Takip Çıkışı", "Asıl Alacak", "Toplam Alacak", "Takip Tutarı"],
  asama: ["Dosya Aşaması", "Aşama", "Takip Aşaması", "Son İşlem"],
  borclu: ["Borçlu", "Borçlu Adı"],
  alacakli: ["Alacaklı", "Alacaklı Adı"],
} as const;

const SIGNATURE: PageSignature = {
  kind: "ICRA_DOSYA",
  selectorVersion: DETAY_SELECTORS.version,
  urlHints: [/icra/i, /takip/i, /dosya[_-]?detay/i],
  requiredNodes: [
    { field: "dosyaBilgiPaneli", selectors: [...DETAY_SELECTORS.bilgiPanel], expected: "Dosya künyesi paneli" },
    { field: "taraflarTablosu", selectors: [...DETAY_SELECTORS.taraflarTable], expected: "Taraflar tablosu" },
  ],
};

function readInfo(ctx: PageContext): Map<string, string> {
  return readLabelValueMap(ctx.doc, [...DETAY_SELECTORS.bilgiSatir], [...DETAY_SELECTORS.bilgiEtiket], [...DETAY_SELECTORS.bilgiDeger]);
}

/** "12.500,00 TL" → "12500.00"; okunamazsa null. */
export function parseTrMoney(input: string | null | undefined): string | null {
  const value = parseTrNumber(input);
  if (value === null || value < 0) return null;
  return value.toFixed(2);
}

function isIcraPage(info: Map<string, string>, birim: string | null): boolean {
  if (birim && normalizeTr(birim).includes("icra")) return true;
  return (
    labelValue(info, ICRA_LABELS.takipTuru) !== null ||
    labelValue(info, ICRA_LABELS.alacakTutari) !== null ||
    labelValue(info, ICRA_LABELS.takipTarihi) !== null
  );
}

/** Taraflar listesinden rolü "Borçlu"/"Alacaklı" olan ilk tarafın adı (künyede yoksa). */
function partyByRole(detay: UyapDosyaDetay, roleKey: "borclu" | "alacakli"): string | null {
  const wanted = roleKey === "borclu" ? "borclu" : "alacakli";
  const hit = detay.taraflar.find((t) => normalizeTr(t.rol).includes(wanted));
  return hit ? hit.ad : null;
}

export const icraDosyaParser: UyapParser<UyapDosyaDetay> = {
  kind: "ICRA_DOSYA",
  selectorVersion: DETAY_SELECTORS.version,

  matches(ctx: PageContext): boolean {
    if (!dosyaDetayParser.matches(ctx)) return false;
    if (queryFirst(ctx.doc, [...DETAY_SELECTORS.bilgiPanel]) === null) return false;
    const info = readInfo(ctx);
    if (info.size === 0) return false;
    const birim = labelValue(info, ["Birim Adı", "Birim", "İcra Dairesi", "İcra Müdürlüğü", "Yargı Birimi"]);
    return isIcraPage(info, birim);
  },

  parse(ctx: PageContext): ParseResult<UyapDosyaDetay> {
    const signature = verifySignature(ctx, SIGNATURE);
    if (!signature.ok) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", signatureMessage("ICRA_DOSYA"), signature.issues);
    }
    const base = dosyaDetayParser.parse(ctx);
    if (!base.ok) return base;

    const info = readInfo(ctx);
    if (!isIcraPage(info, base.data.birim)) {
      return failure(ctx, SIGNATURE, "PAGE_SIGNATURE_MISMATCH", "Sayfa bir icra dosyası ekranı gibi görünmüyor (takip alanları yok).", []);
    }

    const takipTarihiText = labelValue(info, ICRA_LABELS.takipTarihi);
    const icra: UyapIcraDosya = {
      takipTuru: labelValue(info, ICRA_LABELS.takipTuru),
      takipTarihi: parseTrDate(takipTarihiText) ?? base.data.acilisTarihi,
      alacakTutari: parseTrMoney(labelValue(info, ICRA_LABELS.alacakTutari)),
      asama: labelValue(info, ICRA_LABELS.asama),
      borclu: labelValue(info, ICRA_LABELS.borclu) ?? partyByRole(base.data, "borclu"),
      alacakli: labelValue(info, ICRA_LABELS.alacakli) ?? partyByRole(base.data, "alacakli"),
    };

    const detay: UyapDosyaDetay = { ...base.data, icra };
    return success<UyapDosyaDetay>(ctx, SIGNATURE, detay, [...base.warnings]);
  },
};
