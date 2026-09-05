import { BadRequestException, Injectable } from "@nestjs/common";
import { diffStatuteArticles, type ParsedStatuteArticle } from "@nomosos/legal-core";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../platform-audit.service";
import type { PlatformAuthUser } from "../platform.types";

/**
 * PLATFORM MEVZUAT HAVUZU — havuza girişin TEK KAPISI.
 *
 * CaseLawPoolService ile aynı ilkeler:
 *  1. Biçimsiz kayıt REDDEDİLİR (kanun numarası + başlık + en az bir madde).
 *  2. Mevzuat kaydı kiracıdan GELEMEZ — yalnızca bu servis (onaylı
 *     legislation-ingest hattı) platform kaydı yazar. Büro kütüphanesi
 *     (Legislation, tenantId'li) bu kapıdan GEÇMEZ; kapsamları ayrıdır.
 *  3. Değişiklik eski madde sürümünü EZMEZ: sürüm zinciri (StatuteArticleVersion)
 *     effectiveFrom/effectiveTo ile korunur — "sorgu tarihinde yürürlükteki
 *     metin" sonradan deterministik yanıtlanabilir.
 *
 * SOURCE LINEAGE: her kanun kaydı kaynak konektör anahtarı + kalıcı adres +
 * (varsa) RG künyesi taşır.
 */

export interface StatuteImportResult {
  status: "EKLENDI" | "GUNCELLENDI" | "ATLANDI" | "REDDEDILDI";
  reason?: string;
  statuteId?: string;
  /** Sürüm farkı ayrıntısı (GUNCELLENDI'da). */
  diff?: { added: number; changed: number; removed: number; unchanged: number };
}

export interface ImportStatuteInput {
  mevzuatNo: string;
  mevzuatTur: number;
  tertip: number;
  title: string;
  /** Atıf kısaltmaları, virgülle ("TCK,Türk Ceza Kanunu"). */
  abbrs?: string;
  rgDate?: string | null;
  rgNo?: string | null;
  fullText: string;
  articles: readonly ParsedStatuteArticle[];
  sourceKey: string;
  sourceUrl?: string | null;
  /** Bu güncellemeyi doğuran değişikliğin RG künyesi (ilk girişte null). */
  changeRgDate?: string | null;
  changeRgNo?: string | null;
}

/** Kanun sayılan mevzuat türleri (mevzuat.gov.tr kodları). */
const STATUTE_TURS = new Set([1, 4, 19]);

/** Kanun kimlik doğrulaması — biçimsiz kayıt kuyruğa da giremez. */
function validateStatuteInput(input: ImportStatuteInput): string | null {
  if (!/^\d{1,5}$/.test(input.mevzuatNo)) return "Geçersiz kanun numarası.";
  if (!STATUTE_TURS.has(input.mevzuatTur)) return "Bu tür kanun havuzuna girmez (yalnız 1/4/19).";
  if (input.title.trim().length < 4) return "Başlık çok kısa.";
  if (input.fullText.trim().length < 500) return "Tam metin çok kısa (konsolide metin bekleniyor).";
  if (input.articles.length === 0) return "Metinden tek madde ayrıştırılamadı.";
  if (!input.sourceKey?.trim()) return "Kaynak anahtarı (sourceKey) zorunludur.";
  return null;
}

@Injectable()
export class LegislationPoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Kuyruk kaydının kanun havuzuna mı Legislation platform havuzuna mı gideceğini söyler. */
  isStatute(mevzuatTur: number): boolean {
    return STATUTE_TURS.has(mevzuatTur);
  }

  /**
   * KANUN İÇE AKTARIMI — Statute + madde sürümleri.
   *
   * Kanun zaten havuzdaysa metin karşılaştırılır (normalizeArticleText):
   *  - fark yok → ATLANDI (aynı sürüm ikinci kez işlenmez),
   *  - fark var → değişen maddeler için YENİ sürüm, eski sürüm effectiveTo ile
   *    kapatılır; hiçbir madde metni ezilmez.
   */
  async importStatute(user: PlatformAuthUser, input: ImportStatuteInput): Promise<StatuteImportResult> {
    const invalid = validateStatuteInput(input);
    if (invalid) {
      return { status: "REDDEDILDI", reason: invalid };
    }

    const existing = await this.prisma.client.statute.findUnique({
      where: { mevzuatNo_mevzuatTur: { mevzuatNo: input.mevzuatNo, mevzuatTur: input.mevzuatTur } },
      include: { articles: true },
    });

    // ---- İLK GİRİŞ: kanun + tüm maddeler v1 ----
    if (!existing) {
      const created = await this.prisma.client.statute.create({
        data: {
          mevzuatNo: input.mevzuatNo,
          mevzuatTur: input.mevzuatTur,
          tertip: input.tertip,
          title: input.title.trim(),
          abbrs: input.abbrs?.trim() || null,
          rgDate: input.rgDate ? new Date(`${input.rgDate}T00:00:00Z`) : null,
          rgNo: input.rgNo?.trim() || null,
          sourceKey: input.sourceKey,
          sourceUrl: input.sourceUrl ?? null,
          fullText: input.fullText,
          articles: {
            create: input.articles.map((a) => ({
              articleNo: a.articleNo,
              versionSeq: 1,
              text: a.text,
              effectiveFrom: input.rgDate ? new Date(`${input.rgDate}T00:00:00Z`) : null,
            })),
          },
        },
      });
      await this.audit.log({
        actor: { id: user.id, role: user.role, ip: user.ip },
        action: "LEGISLATION_POOL_STATUTE_CREATE",
        entity: "Statute",
        entityId: created.id,
        detail: `${input.title} (${input.mevzuatNo}) — ${input.articles.length} madde, kaynak: ${input.sourceKey}`,
      });
      return { status: "EKLENDI", statuteId: created.id };
    }

    // ---- SÜRÜM FARKI: normalize karşılaştırma ----
    const currentByNo = new Map(existing.articles.map((a) => [a.articleNo, a]));
    const currentParsed = existing.articles.map((a) => ({ articleNo: a.articleNo, text: a.text }));
    const diff = diffStatuteArticles(currentParsed, input.articles);

    if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
      return {
        status: "ATLANDI",
        statuteId: existing.id,
        reason: "Metin mevcut sürümle aynı.",
        diff: {
          added: 0,
          changed: 0,
          removed: 0,
          unchanged: diff.unchanged,
        },
      };
    }

    // SÜRÜM SINIRI TARİHİ: değişikliğin RG tarihi; yoksa kanunun RG tarihi;
    // o da yoksa TESPİT TARİHİ (bugün, UTC gün). Sınır ASLA null bırakılmaz:
    // aksi hâlde eski sürüm effectiveTo=null ile açık kalır, yeni sürüm de
    // effectiveFrom=null doğar ve iki sürüm birden "yürürlükte" görünür —
    // "sorgu tarihinde yürürlükteki metin" sorusu yanıtlanamaz olur.
    // Tespit tarihi bir YAKLAŞIKLIKTIR; denetim izine açıkça yazılır.
    const changeDate = input.changeRgDate ?? input.rgDate ?? null;
    const changeDateApproximated = changeDate === null;
    const changeDateObj = changeDate
      ? new Date(`${changeDate}T00:00:00Z`)
      : new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const nextSeqOf = (articleNo: string): number => {
      const versions = existing.articles.filter((a) => a.articleNo === articleNo);
      return versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.versionSeq)) + 1;
    };

    await this.prisma.client.$transaction(async (tx) => {
      // Değişen maddeler: eski sürümü kapat, yeni sürüm aç.
      for (const article of diff.changed) {
        const current = currentByNo.get(article.articleNo);
        if (current && current.effectiveTo === null) {
          await tx.statuteArticleVersion.update({
            where: { id: current.id },
            data: { effectiveTo: changeDateObj },
          });
        }
        await tx.statuteArticleVersion.create({
          data: {
            statuteId: existing.id,
            articleNo: article.articleNo,
            versionSeq: nextSeqOf(article.articleNo),
            text: article.text,
            effectiveFrom: changeDateObj,
            changeRgDate: changeDateObj,
            changeRgNo: input.changeRgNo?.trim() || null,
          },
        });
      }
      // Yeni maddeler.
      for (const article of diff.added) {
        await tx.statuteArticleVersion.create({
          data: {
            statuteId: existing.id,
            articleNo: article.articleNo,
            versionSeq: nextSeqOf(article.articleNo),
            text: article.text,
            effectiveFrom: changeDateObj,
            changeRgDate: changeDateObj,
            changeRgNo: input.changeRgNo?.trim() || null,
          },
        });
      }
      // Kaldırılan (mülga/ildırılan) maddeler: sürüm kapanır, metin kalır.
      for (const articleNo of diff.removed) {
        const current = currentByNo.get(articleNo);
        if (current && current.effectiveTo === null) {
          await tx.statuteArticleVersion.update({
            where: { id: current.id },
            data: { effectiveTo: changeDateObj },
          });
        }
      }
      await tx.statute.update({
        where: { id: existing.id },
        data: {
          fullText: input.fullText,
          title: input.title.trim(),
          ...(input.abbrs?.trim() ? { abbrs: input.abbrs.trim() } : {}),
          ...(input.rgDate && !existing.rgDate
            ? { rgDate: new Date(`${input.rgDate}T00:00:00Z`) }
            : {}),
          ...(input.rgNo && !existing.rgNo ? { rgNo: input.rgNo.trim() } : {}),
          sourceUrl: input.sourceUrl ?? existing.sourceUrl,
        },
      });
    });

    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "LEGISLATION_POOL_STATUTE_UPDATE",
      entity: "Statute",
      entityId: existing.id,
      detail:
        `${existing.title} (${existing.mevzuatNo}) sürüm güncellendi: ` +
        `${diff.added.length} yeni, ${diff.changed.length} değişen, ${diff.removed.length} kapanan madde` +
        `${input.changeRgDate ? ` (RG: ${input.changeRgDate}/${input.changeRgNo ?? "?"})` : ""}` +
        `${changeDateApproximated ? " — RG künyesi yok; sürüm sınırı TESPİT tarihiyle (yaklaşık) kuruldu" : ""}`,
    });

    return {
      status: "GUNCELLENDI",
      statuteId: existing.id,
      diff: {
        added: diff.added.length,
        changed: diff.changed.length,
        removed: diff.removed.length,
        unchanged: diff.unchanged,
      },
    };
  }

  /**
   * KANUN DIŞI MEVZUAT (yönetmelik/tebliğ/genelge...) — Legislation platform
   * kaydı (tenantId=null). Upsert anahtarı: kaynak adresi (sourceUrl).
   */
  async importLegislation(
    user: PlatformAuthUser,
    input: {
      docType: string;
      title: string;
      number?: string | null;
      year?: number | null;
      fullText?: string | null;
      sourceKey: string;
      sourceUrl?: string | null;
      rgDate?: string | null;
      rgNo?: string | null;
      versionNote?: string | null;
    },
  ): Promise<{ status: "EKLENDI" | "GUNCELLENDI"; id: string }> {
    if (input.title.trim().length < 4) {
      throw new BadRequestException("Mevzuat başlığı çok kısa.");
    }
    if (!input.sourceKey?.trim()) {
      throw new BadRequestException("Kaynak anahtarı (sourceKey) zorunludur.");
    }

    const existing = input.sourceUrl
      ? await this.prisma.client.legislation.findFirst({
          where: { tenantId: null, sourceUrl: input.sourceUrl },
        })
      : null;

    const fullText = input.fullText?.trim() ?? null;
    // Tam metin yoksa: varsa mevcut kaydın metni korunur, yoksa başlık başlangıç değeri olur.
    const finalFullText = fullText ?? existing?.fullText ?? input.title.trim();
    const versionChanged =
      existing !== null && fullText !== null && fullText !== existing.fullText;
    // YENİDEN ONAYDA ALAN KORUMASI: girdi boş geldi diye mevcut künye (RG
    // tarihi/sayısı, numara, yıl) SİLİNMEZ; yalnız dolu gelen değer yazılır.
    const number = input.number?.trim() || existing?.number || null;
    const year = input.year ?? existing?.year ?? null;
    const rgDate = input.rgDate ? new Date(`${input.rgDate}T00:00:00Z`) : (existing?.rgDate ?? null);
    const rgNo = input.rgNo?.trim() || existing?.rgNo || null;
    const data = {
      tenantId: null,
      docType: input.docType,
      title: input.title.trim(),
      number,
      year,
      rgDate,
      rgNo,
      sourceKey: input.sourceKey,
      sourceUrl: input.sourceUrl ?? existing?.sourceUrl ?? null,
      authorityLevel: 10,
      uploadedBy: null,
      fullText: finalFullText,
      preview: finalFullText.slice(0, 2000),
      ...(versionChanged
        ? { versionNote: input.versionNote?.trim() || `RG ${input.rgDate ?? "?"} güncellemesi` }
        : {}),
    };

    if (existing) {
      const updated = await this.prisma.client.legislation.update({ where: { id: existing.id }, data });
      await this.audit.log({
        actor: { id: user.id, role: user.role, ip: user.ip },
        action: "LEGISLATION_POOL_UPDATE",
        entity: "Legislation",
        entityId: updated.id,
        detail: `${updated.title} (kaynak: ${input.sourceKey})`,
      });
      return { status: "GUNCELLENDI", id: updated.id };
    }

    const created = await this.prisma.client.legislation.create({ data });
    await this.audit.log({
      actor: { id: user.id, role: user.role, ip: user.ip },
      action: "LEGISLATION_POOL_CREATE",
      entity: "Legislation",
      entityId: created.id,
      detail: `${created.title} (${created.docType}, kaynak: ${input.sourceKey})`,
    });
    return { status: "EKLENDI", id: created.id };
  }

  /** Havuz istatistiği — platform paneli için. */
  async stats() {
    const [statutes, articles, versions, platformLegislation] = await Promise.all([
      this.prisma.client.statute.count(),
      this.prisma.client.statuteArticleVersion.count(),
      this.prisma.client.statuteArticleVersion.count({ where: { effectiveTo: null } }),
      this.prisma.client.legislation.count({ where: { tenantId: null } }),
    ]);
    return {
      statutes,
      articles: versions,
      articleVersions: articles,
      platformLegislation,
    };
  }
}
