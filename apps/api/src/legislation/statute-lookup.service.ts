import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { Statute, StatuteArticleVersion } from "@nomosos/db";

/**
 * STATUTE ARAMA — atıf teyidinin mevzuat kolonu.
 *
 * citation-patterns'tan gelen statuteRef biçimleriyle çalışır:
 *   "HMK" (kısaltma) · "İş Kanunu" (ad) · "4857 sayılı" (numara) ·
 *   "Türk Borçlar Kanunu" (tam ad)
 *
 * DETERMİNİSTİKTİR: benzerlik/anlam araması YOKTUR. Eşleşme sırası:
 *   1. kanun numarası ("4857")
 *   2. kısaltma listesi (Statute.abbrs)
 *   3. tam ad eşleşmesi (büyük/küçük harf duyarsız)
 *   4. tekil içerme eşleşmesi (birden çok eşleşme = belirsiz = bulunamadı)
 *
 * Madde araması: "25/2" → madde "25" (fıkra/bend soneki atıf teyidi için
 * taşınmaz; madde metni fıkraları içerir).
 */

export interface StatuteArticleLookup {
  statute: Statute;
  article: StatuteArticleVersion | null;
}

/** Karşılaştırma için Türkçe küçük harf normalizasyonu. */
function trNorm(value: string): string {
  return value
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .trim();
}

@Injectable()
export class StatuteLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atıfın kanununu ve (varsa) maddenin GÜNCEL sürümünü bulur.
   * Kanun bulunamazsa null; kanun bulunur ama madde yoksa article: null.
   */
  async findArticle(statuteRef: string, articleNo: string): Promise<StatuteArticleLookup | null> {
    const statute = await this.findStatute(statuteRef);
    if (!statute) return null;

    const baseArticleNo = articleNo.split("/")[0]?.trim() ?? articleNo.trim();
    if (!/^\d{1,4}$/.test(baseArticleNo)) return { statute, article: null };

    // Güncel sürüm = en yüksek versionSeq (effectiveTo null olması beklenir ama
    // kapanmamış sürüm koşulu ARANMAZ — veri tutarlılığı havuz kapısının işidir).
    const article = await this.prisma.client.statuteArticleVersion.findFirst({
      where: { statuteId: statute.id, articleNo: baseArticleNo },
      orderBy: { versionSeq: "desc" },
    });
    return { statute, article: article ?? null };
  }

  /** statuteRef → Statute (kısaltma/ad/numara eşleşmesi). */
  async findStatute(statuteRef: string): Promise<Statute | null> {
    const ref = trNorm(statuteRef.replace(/\s*sayılı\s*$/i, "").trim());
    if (!ref) return null;

    // 1. Kanun numarası ("4857").
    const noMatch = /^(\d{3,5})$/.exec(ref);
    if (noMatch) {
      return this.prisma.client.statute.findFirst({
        where: { mevzuatNo: noMatch[1] },
        orderBy: { mevzuatTur: "asc" },
      });
    }

    const statutes = await this.prisma.client.statute.findMany();
    if (statutes.length === 0) return null;

    // 2. Kısaltma listesi (Statute.abbrs, virgülle ayrılmış).
    const byAbbr = statutes.filter((s) =>
      (s.abbrs ?? "")
        .split(",")
        .map((a) => trNorm(a))
        .filter(Boolean)
        .includes(ref),
    );
    if (byAbbr.length === 1) return byAbbr[0];

    // 3. Tam ad eşleşmesi.
    const byTitle = statutes.filter((s) => trNorm(s.title) === ref);
    if (byTitle.length === 1) return byTitle[0];

    // 4. Tekil içerme ("İş Kanunu" ⊂ "4857 sayılı İş Kanunu" başlık farkları için).
    const byContains = statutes.filter(
      (s) => trNorm(s.title).includes(ref) || ref.includes(trNorm(s.title)),
    );
    if (byContains.length === 1) return byContains[0];

    return null;
  }
}
