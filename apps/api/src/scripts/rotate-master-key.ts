/**
 * MASTER_ENCRYPTION_KEY ROTASYONU (Faz 4) — tüm şifreli sütunları eski anahtarla çözüp
 * yeni anahtarla yeniden şifreler.
 *
 * KULLANIM (api konteyneri içinde ya da geliştirme makinesinde, DATABASE_URL tanımlı):
 *   OLD_MASTER_ENCRYPTION_KEY=<eski hex> NEW_MASTER_ENCRYPTION_KEY=<yeni hex> \
 *     node dist/scripts/rotate-master-key.js            # gerçek koşu
 *   … --dry-run                                          # yalnız sayar, yazmaz
 *
 * SIRA (kesintisiz):
 *   1. Yeni anahtarı üret (openssl rand -hex 32), kasaya koy.
 *   2. Yedek al (scripts/prod-backup.sh) — geri dönüş noktası.
 *   3. Bu betiği --dry-run ile çalıştır: satır sayıları ve çözülemeyenler görünür.
 *   4. Gerçek koşu: satırlar tek transaction'da güncellenir; biri çözülemezse HİÇBİRİ yazılmaz.
 *   5. .env.prod.local içinde MASTER_ENCRYPTION_KEY = yeni; `docker compose up -d api`.
 *   Eski anahtarı 30 gün sakla (yedeklerdeki veriler onunla şifreli).
 *
 * KAPSAM: AiProviderConfig.encryptedApiKey/headersJson, PlatformAiProvider.encryptedApiKey/
 * headersJson, Tenant.ssoClientSecret, User.twoFactorSecret, EInvoiceSettings.credentialsEncrypted,
 * WebhookEndpoint.encryptedSecret. Platform 2FA (PLATFORM_2FA_ENCRYPTION_KEY) AYRI anahtardır;
 * bu betik ona DOKUNMAZ.
 */

import { PrismaClient } from "@nomosos/db";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@nomosos/ai";

export interface RotationTarget {
  model: string;
  idField: string;
  fields: string[];
}

export const ROTATION_TARGETS: RotationTarget[] = [
  { model: "aiProviderConfig", idField: "id", fields: ["encryptedApiKey", "headersJson"] },
  { model: "platformAiProvider", idField: "id", fields: ["encryptedApiKey", "headersJson"] },
  { model: "tenant", idField: "id", fields: ["ssoClientSecret"] },
  { model: "user", idField: "id", fields: ["twoFactorSecret"] },
  { model: "eInvoiceSettings", idField: "id", fields: ["credentialsEncrypted"] },
  { model: "webhookEndpoint", idField: "id", fields: ["encryptedSecret"] },
];

export interface RotationPlanRow {
  model: string;
  id: string;
  data: Record<string, string>;
}

/** Saf: bir satırın şifreli alanlarını yeni anahtara taşır; çözülemeyen alan hata verir. */
export function rotateRow(row: Record<string, unknown>, fields: string[], oldKey: string, newKey: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const f of fields) {
    const v = row[f];
    if (typeof v !== "string" || !v) continue;
    if (!isEncryptedSecret(v)) continue;
    const plain = decryptSecret(v, oldKey);
    data[f] = encryptSecret(plain, newKey);
  }
  return data;
}

export async function planRotation(prisma: PrismaClient, oldKey: string, newKey: string, targets = ROTATION_TARGETS): Promise<{ rows: RotationPlanRow[]; errors: string[] }> {
  const rows: RotationPlanRow[] = [];
  const errors: string[] = [];
  for (const t of targets) {
    const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<Record<string, unknown>[]> }>)[t.model];
    if (!delegate) {
      errors.push(`${t.model}: model bulunamadı (şema değişmiş olabilir).`);
      continue;
    }
    const select: Record<string, boolean> = { [t.idField]: true };
    for (const f of t.fields) select[f] = true;
    const list = await delegate.findMany({ select });
    for (const row of list) {
      try {
        const data = rotateRow(row, t.fields, oldKey, newKey);
        if (Object.keys(data).length > 0) rows.push({ model: t.model, id: String(row[t.idField]), data });
      } catch (err) {
        errors.push(`${t.model}/${String(row[t.idField])}: ${(err as Error).message}`);
      }
    }
  }
  return { rows, errors };
}

async function main(): Promise<void> {
  const oldKey = process.env.OLD_MASTER_ENCRYPTION_KEY?.trim();
  const newKey = process.env.NEW_MASTER_ENCRYPTION_KEY?.trim();
  const dryRun = process.argv.includes("--dry-run");
  if (!oldKey || !newKey) {
    console.error("OLD_MASTER_ENCRYPTION_KEY ve NEW_MASTER_ENCRYPTION_KEY zorunlu (64 hex).");
    process.exit(2);
  }
  if (!/^[0-9a-f]{64}$/i.test(newKey)) {
    console.error("NEW_MASTER_ENCRYPTION_KEY 32 bayt hex (64 karakter) olmalı.");
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const plan = await planRotation(prisma, oldKey, newKey);
    const byModel = plan.rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.model]: (acc[r.model] ?? 0) + 1 }), {});
    console.log(`Rotasyon planı: ${plan.rows.length} satır — ${JSON.stringify(byModel)}`);
    if (plan.errors.length > 0) {
      console.error(`ÇÖZÜLEMEYEN ${plan.errors.length} satır (eski anahtar yanlış ya da veri bozuk):`);
      for (const e of plan.errors.slice(0, 20)) console.error("  - " + e);
      console.error("Hiçbir satır yazılmadı.");
      process.exit(1);
    }
    if (dryRun) {
      console.log("--dry-run: yazma yapılmadı.");
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const r of plan.rows) {
        const delegate = (tx as unknown as Record<string, { update: (a: unknown) => Promise<unknown> }>)[r.model];
        await delegate.update({ where: { id: r.id }, data: r.data });
      }
    });
    console.log(`Tamamlandı: ${plan.rows.length} satır yeni anahtarla şifrelendi. Şimdi MASTER_ENCRYPTION_KEY'i güncelleyip api'yi yeniden başlatın.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
