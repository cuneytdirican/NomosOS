/**
 * Rapor anahtarı → builder eşlemesi.
 *
 * Katalog (metadata) ile builder (hesap) AYRI dosyalardadır: katalog `GET
 * /reports/catalog` için serileştirilebilir saf veridir ve testte builder'ları
 * (dolayısıyla Prisma'yı) yüklemeden okunabilir. `report-registry.test.ts`
 * ikisinin ayrışmadığını doğrular.
 */

import { aiKullanimReport } from "./builders/ai-kullanim.report";
import { avukatIsYukuReport } from "./builders/avukat-is-yuku.report";
import { buroOzetReport } from "./builders/buro-ozet.report";
import { dosyaDurumDagilimiReport } from "./builders/dosya-durum-dagilimi.report";
import { durusmaTakvimiReport } from "./builders/durusma-takvimi.report";
import { icraTahsilatReport } from "./builders/icra-tahsilat.report";
import { karlilikReport } from "./builders/karlilik.report";
import { surePerformansiReport } from "./builders/sure-performansi.report";
import { tahsilatYaslandirmaReport } from "./builders/tahsilat-yaslandirma.report";
import type { ReportBuilder } from "./report-types";

export const REPORT_BUILDERS: Record<string, ReportBuilder> = {
  "buro-ozet": buroOzetReport,
  "avukat-is-yuku": avukatIsYukuReport,
  "dosya-durum-dagilimi": dosyaDurumDagilimiReport,
  "sure-performansi": surePerformansiReport,
  "tahsilat-yaslandirma": tahsilatYaslandirmaReport,
  karlilik: karlilikReport,
  "icra-tahsilat": icraTahsilatReport,
  "ai-kullanim": aiKullanimReport,
  "durusma-takvimi": durusmaTakvimiReport,
};
