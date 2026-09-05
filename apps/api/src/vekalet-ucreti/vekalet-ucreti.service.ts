/**
 * D7 — AAÜT VEKALET ÜCRETİ HESABI (rakip analizi).
 *
 * Hesap motoru packages/legal-core'tadır (vekalet-ucreti.ts); bu modül yalnız
 * TARİFE SAKLAMA ve uç yönetimidir.
 *
 * VERİ SÖZLEŞMESİ: tarife rakamları GİRİŞTİR; sistem rakam uydurmaz.
 * Öncelik (açılış öncesi hazır veri planı, Aşama 2):
 *   1. Büronun kendi tarifesi (VekaletTarife, tenant kapsamlı) — her zaman önce.
 *   2. PLATFORM tarifesi (PlatformVekaletTarife) — platform görevlisinin o yıl
 *      için Resmî Gazete'den girdiği resmî tarife; büro girmediyse bu kullanılır
 *      ve yanıtta `tarifeKaynagi: "PLATFORM"` + RG künyesi görünür.
 *   3. İkisi de yoksa 404 — "tarife girilmemiş" yalnız gerçekten yoksa kalır.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PlatformAuditService } from "../platform/platform-audit.service";
import type { PlatformAuthUser } from "../platform/platform.types";
import { assertRole, ROLE_SETS } from "../common/roles";
import type { AuthUser } from "../common/types";
import {
  hesaplaVekaletUcreti,
  type Kurus,
  type MaktuKademe,
  type MaktuTekrar,
  type VekaletTarifeVerisi,
} from "@nomosos/legal-core";

export interface TarifeKaydi {
  yil: number;
  kademeler: MaktuKademe[];
  tekrar: MaktuTekrar | null;
  nispiOranYuzde: string;
  kdvOrani: string;
}

function tarifeVerisine(row: {
  maktuKademelerJson: string;
  maktuTekrarJson: string | null;
  nispiOranYuzde: Prisma.Decimal;
  kdvOrani: Prisma.Decimal;
}): VekaletTarifeVerisi {
  const kademeler = JSON.parse(row.maktuKademelerJson) as MaktuKademe[];
  const tekrar = row.maktuTekrarJson ? (JSON.parse(row.maktuTekrarJson) as MaktuTekrar) : null;
  return {
    kademeler,
    tekrar,
    nispiOranYuzde: row.nispiOranYuzde.toString(),
    kdvOrani: row.kdvOrani.toString(),
  };
}

export type TarifeKaynagi = "BURO" | "PLATFORM";

interface CozumlenmisTarife {
  veri: VekaletTarifeVerisi;
  kaynak: TarifeKaynagi;
  /** Platform tarifesinde: Resmî Gazete künyesi (kaynak gösterimi). */
  rgKunye: string | null;
}

@Injectable()
export class VekaletUcretiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformAudit: PlatformAuditService,
  ) {}

  /**
   * Yılın tarifesini çözer: büro kaydı > platform kaydı > null.
   * Büro kaydı platform kaydını HER ZAMAN ezer (büro, RG'yi kendi okuyup
   * girdiyse onun sorumluluğu ve tercihi geçerlidir).
   */
  async tarifeCoz(tenantId: string, yil: number): Promise<CozumlenmisTarife | null> {
    const own = await this.prisma.client.vekaletTarife.findUnique({
      where: { tenantId_yil: { tenantId, yil } },
    });
    if (own) return { veri: tarifeVerisine(own), kaynak: "BURO", rgKunye: null };
    const platform = await this.prisma.client.platformVekaletTarife.findUnique({ where: { yil } });
    if (platform) return { veri: tarifeVerisine(platform), kaynak: "PLATFORM", rgKunye: platform.rgKunye };
    return null;
  }

  /** POST /vekalet-ucreti/hesapla — dava değerine göre hesap + görünür iz. */
  async hesapla(user: AuthUser, davaDegeri: string, yil: number) {
    const tarife = await this.tarifeCoz(user.tenantId, yil);
    if (!tarife) {
      throw new NotFoundException(
        `${yil} yılı için AAÜT tarifesi bulunamadı: büronuz girmemiş ve platform varsayılanı da ` +
          "henüz yayımlanmamış. Ayarlar → Vekalet Ücreti Tarifesi'nden yılın tarife rakamlarını " +
          "Resmî Gazete'den girin; motor girilen tarifeden hesaplar.",
      );
    }
    const sonuc = hesaplaVekaletUcreti(davaDegeri as Kurus, tarife.veri);
    return {
      yil,
      davaDegeriKurus: davaDegeri,
      ...sonuc,
      tarifeKaynagi: tarife.kaynak,
      rgKunye: tarife.rgKunye,
      // Hesap ÖNERİDİR; sözleşme ve tahsilat avukatın kararındadır.
      not:
        tarife.kaynak === "PLATFORM"
          ? `Hesap, platformun Resmî Gazete'den girdiği ${yil} resmî tarifesi üzerinden yapılmıştır` +
            `${tarife.rgKunye ? ` (${tarife.rgKunye})` : ""}; sonuç bilgilendirme amaçlıdır. ` +
            "Büronuz kendi tarifesini girerse o kullanılır."
          : "Hesap, büronuzun girdiği tarife üzerinden yapılmıştır; sonuç bilgilendirme amaçlıdır.",
    };
  }

  /** GET /vekalet-ucreti/tarife/:yil — tarife okuma (büro > platform). */
  async tarifeGetir(tenantId: string, yil: number) {
    const tarife = await this.tarifeCoz(tenantId, yil);
    if (!tarife) throw new NotFoundException(`${yil} yılı tarifesi girilmemiş (büro ve platform).`);
    return { ...tarife.veri, yil, kaynak: tarife.kaynak, rgKunye: tarife.rgKunye };
  }

  // ------------------------------------------------------------------ //
  // PLATFORM TARİFESİ — platform görevlisi RG'den girer (Aşama 2)
  // ------------------------------------------------------------------ //

  async platformTarifeListe() {
    const rows = await this.prisma.client.platformVekaletTarife.findMany({ orderBy: { yil: "desc" } });
    return rows.map((r) => ({ ...tarifeVerisine(r), yil: r.yil, rgKunye: r.rgKunye, updatedAt: r.updatedAt }));
  }

  async platformTarifeKaydet(actor: PlatformAuthUser, kayit: TarifeKaydi & { rgKunye: string }) {
    if (kayit.kademeler.length === 0) {
      throw new NotFoundException("En az bir maktu kademe girilmelidir.");
    }
    const row = await this.prisma.client.platformVekaletTarife.upsert({
      where: { yil: kayit.yil },
      create: {
        yil: kayit.yil,
        maktuKademelerJson: JSON.stringify(kayit.kademeler),
        maktuTekrarJson: kayit.tekrar ? JSON.stringify(kayit.tekrar) : null,
        nispiOranYuzde: kayit.nispiOranYuzde,
        kdvOrani: kayit.kdvOrani,
        rgKunye: kayit.rgKunye,
        updatedBy: actor.id,
      },
      update: {
        maktuKademelerJson: JSON.stringify(kayit.kademeler),
        maktuTekrarJson: kayit.tekrar ? JSON.stringify(kayit.tekrar) : null,
        nispiOranYuzde: kayit.nispiOranYuzde,
        kdvOrani: kayit.kdvOrani,
        rgKunye: kayit.rgKunye,
        updatedBy: actor.id,
      },
    });
    await this.platformAudit.log({
      actor: { id: actor.id, role: actor.role, ip: actor.ip },
      action: "PLATFORM_AAUT_TARIFE_KAYDET",
      entity: "PlatformVekaletTarife",
      entityId: row.id,
      detail: `yıl=${kayit.yil} kademe=${kayit.kademeler.length} nispi=%${kayit.nispiOranYuzde} RG=${kayit.rgKunye}`,
    });
    return { ...tarifeVerisine(row), yil: row.yil, rgKunye: row.rgKunye };
  }

  /** Yıl başı işi: o yılın platform tarifesi var mı? */
  async platformTarifeVarMi(yil: number): Promise<{ var: boolean; rgKunye: string | null }> {
    const row = await this.prisma.client.platformVekaletTarife.findUnique({ where: { yil }, select: { rgKunye: true } });
    return { var: row !== null, rgKunye: row?.rgKunye ?? null };
  }

  /** PUT /vekalet-ucreti/tarife/:yil — tarife upsert (ADMIN/PARTNER). */
  async tarifeKaydet(user: AuthUser, kayit: TarifeKaydi) {
    assertRole(user, ROLE_SETS.ONAY, "vekalet ücreti tarifesi kaydetme");

    // Kademelerin artan sırası MOTORDA doğrulanır; burada yalnız biçim.
    if (kayit.kademeler.length === 0) {
      throw new NotFoundException("En az bir maktu kademe girilmelidir.");
    }

    const row = await this.prisma.client.vekaletTarife.upsert({
      where: { tenantId_yil: { tenantId: user.tenantId, yil: kayit.yil } },
      create: {
        tenantId: user.tenantId,
        yil: kayit.yil,
        maktuKademelerJson: JSON.stringify(kayit.kademeler),
        maktuTekrarJson: kayit.tekrar ? JSON.stringify(kayit.tekrar) : null,
        nispiOranYuzde: kayit.nispiOranYuzde,
        kdvOrani: kayit.kdvOrani,
      },
      update: {
        maktuKademelerJson: JSON.stringify(kayit.kademeler),
        maktuTekrarJson: kayit.tekrar ? JSON.stringify(kayit.tekrar) : null,
        nispiOranYuzde: kayit.nispiOranYuzde,
        kdvOrani: kayit.kdvOrani,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "VEKALET_TARIFE_KAYDET",
      entity: "VekaletTarife",
      entityId: row.id,
      detail: `yıl=${kayit.yil} kademe=${kayit.kademeler.length} nispi=%${kayit.nispiOranYuzde}`,
    });

    return { ...tarifeVerisine(row), yil: row.yil };
  }
}
