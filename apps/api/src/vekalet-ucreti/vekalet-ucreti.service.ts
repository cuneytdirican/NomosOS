/**
 * D7 — AAÜT VEKALET ÜCRETİ HESABI (rakip analizi).
 *
 * Hesap motoru packages/legal-core'tadır (vekalet-ucreti.ts); bu modül yalnız
 * TARİFE SAKLAMA ve uç yönetimidir.
 *
 * VERİ SÖZLEŞMESİ: tarife rakamları büronun GİRİŞİDİR (RG'den, yılda bir);
 * sistem rakam uydurmaz. Tarife girilmemiş yıl için hesap 404 döner ve
 * kullanıcıdan tarife girmesi istenir — varsayın yok.
 */

import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
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

@Injectable()
export class VekaletUcretiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** POST /vekalet-ucreti/hesapla — dava değerine göre hesap + görünür iz. */
  async hesapla(user: AuthUser, davaDegeri: string, yil: number) {
    const tarife = await this.prisma.client.vekaletTarife.findUnique({
      where: { tenantId_yil: { tenantId: user.tenantId, yil } },
    });
    if (!tarife) {
      throw new NotFoundException(
        `${yil} yılı için AAÜT tarifesi girilmemiş. Ayarlar → Vekalet Ücreti Tarifesi'nden ` +
          "yılın tarife rakamlarını Resmî Gazete'den girin; motor girilen tarifeden hesaplar.",
      );
    }
    const sonuc = hesaplaVekaletUcreti(davaDegeri as Kurus, tarifeVerisine(tarife));
    return {
      yil,
      davaDegeriKurus: davaDegeri,
      ...sonuc,
      // Hesap ÖNERİDİR; sözleşme ve tahsilat avukatın kararındadır.
      not: "Hesap, girilen tarife üzerinden yapılmıştır; sonuç bilgilendirme amaçlıdır.",
    };
  }

  /** GET /vekalet-ucreti/tarife/:yil — tarife okuma. */
  async tarifeGetir(tenantId: string, yil: number) {
    const row = await this.prisma.client.vekaletTarife.findUnique({
      where: { tenantId_yil: { tenantId, yil } },
    });
    if (!row) throw new NotFoundException(`${yil} yılı tarifesı girilmemiş.`);
    return { ...tarifeVerisine(row), yil };
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
