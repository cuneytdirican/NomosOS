/**
 * KİRACI MODEL EĞİTİM İŞLERİ — izolasyon ve lisans kapısı testleri
 * (kullanıcı tanımlı model eğitimi, gereksinim 2).
 *
 * Korunan taahhütler:
 *  1. allowBYOLLM kapalı → 403 (lisans kapısı) — iş açılamaz, manifest inmez.
 *  2. Başka kiracının providerConfig'i ile iş açılamaz (403; kimlik sızdırmaz).
 *  3. Manifest yalnız KENDİ kiracısının ONAYLANMIŞ örneklerini sorgular.
 *  4. Liste/durum yalnız kendi kiracısının işlerini görür (tenantId süzgeci).
 *  5. Yetkisiz rol (AVUKAT) yazma uçlarından döner.
 */

import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { TenantFineTuneService } from "./tenant-fine-tune.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PlatformAiService } from "../ai/platform-ai.service";
import type { AuthUser } from "../common/types";

const ADMIN_A = { userId: "u-a", tenantId: "buro-A", role: "ADMIN" } as AuthUser;
const AVUKAT_A = { userId: "u-av", tenantId: "buro-A", role: "AVUKAT" } as AuthUser;

interface Harness {
  svc: TenantFineTuneService;
  sampleWhere: () => unknown[];
  jobWhere: () => unknown[];
  created: () => Record<string, unknown>[];
}

function harness(opts: { byo?: boolean; providerOwner?: string | null; approved?: number; job?: Record<string, unknown> | null }): Harness {
  const sampleWheres: unknown[] = [];
  const jobWheres: unknown[] = [];
  const created: Record<string, unknown>[] = [];
  const approved = opts.approved ?? 3;
  const client = {
    aiProviderConfig: {
      findFirst: vi.fn(async ({ where }: { where: { tenantId: string } }) =>
        opts.providerOwner === where.tenantId
          ? { id: "pc-1", name: "Büro vLLM", type: "OPENAI_COMPAT", defaultModel: "llama-3", origin: "TANIMLI" }
          : null,
      ),
    },
    aiTrainingSample: {
      groupBy: vi.fn(async ({ where }: { where: unknown }) => {
        sampleWheres.push(where);
        return approved > 0 ? [{ taskType: "DOCUMENT_CLASSIFY", _count: { _all: approved } }] : [];
      }),
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        sampleWheres.push(where);
        return [{ inputJson: "{}", outputJson: "{}", taskType: "DOCUMENT_CLASSIFY", kind: "ONAY" }];
      }),
    },
    fineTuneJob: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        jobWheres.push(where);
        return [];
      }),
      findFirst: vi.fn(async ({ where }: { where: unknown }) => {
        jobWheres.push(where);
        return opts.job ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "ft-1", ...data };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "ft-1", ...data })),
    },
  };
  const prisma = { client } as unknown as PrismaService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const platformAi = { byoAllowed: vi.fn(async () => opts.byo ?? true) } as unknown as PlatformAiService;
  return {
    svc: new TenantFineTuneService(prisma, audit, platformAi),
    sampleWhere: () => sampleWheres,
    jobWhere: () => jobWheres,
    created: () => created,
  };
}

describe("TenantFineTuneService — lisans kapısı", () => {
  it("allowBYOLLM kapalıysa iş açılamaz (403) ve liste licensed=false döner", async () => {
    const h = harness({ byo: false, providerOwner: "buro-A" });
    await expect(h.svc.create(ADMIN_A, { name: "deneme işi", providerConfigId: "pc-1" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const list = await h.svc.list(ADMIN_A);
    expect(list.licensed).toBe(false);
    expect(list.licenseMessage).toContain("kapsamıyor");
    expect(h.created()).toHaveLength(0);
  });

  it("AVUKAT rolü iş açamaz (ROLE_SETS.ONAY)", async () => {
    const h = harness({ providerOwner: "buro-A" });
    await expect(h.svc.create(AVUKAT_A, { name: "deneme işi", providerConfigId: "pc-1" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("TenantFineTuneService — kiracı izolasyonu", () => {
  it("başka büronun sağlayıcısıyla iş açılamaz (403)", async () => {
    const h = harness({ providerOwner: "buro-B" });
    await expect(h.svc.create(ADMIN_A, { name: "deneme işi", providerConfigId: "pc-1" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.created()).toHaveLength(0);
  });

  it("kendi sağlayıcısıyla iş açılır; anlık görüntü KENDİ havuzundan, tenantId dolu", async () => {
    const h = harness({ providerOwner: "buro-A", approved: 5 });
    const job = await h.svc.create(ADMIN_A, { name: "belge sınıflandırıcı", providerConfigId: "pc-1" });
    expect(job).toMatchObject({ tenantId: "buro-A", providerConfigId: "pc-1", sampleCount: 5, status: "HAZIRLANDI" });
    expect(String(h.created()[0].provider)).toContain("Büro vLLM");
    expect(h.created()[0].baseModel).toBe("llama-3");
    // Havuz sorgusu kiracı süzgeçli.
    expect(h.sampleWhere()[0]).toMatchObject({ tenantId: "buro-A", exportStatus: "ONAYLANDI" });
  });

  it("manifest yalnız KENDİ kiracısının ONAYLANMIŞ örneklerini sorgular", async () => {
    const h = harness({
      providerOwner: "buro-A",
      job: { id: "ft-1", tenantId: "buro-A", name: "x", status: "HAZIRLANDI", resultModelName: null, note: null },
    });
    const res = await h.svc.manifest(ADMIN_A, "ft-1");
    expect(res.count).toBe(1);
    const where = h.sampleWhere().find((w) => (w as { exportStatus?: string }).exportStatus === "ONAYLANDI");
    expect(where).toMatchObject({ tenantId: "buro-A", exportStatus: "ONAYLANDI" });
    // İş sorgusu da kiracı süzgeçli.
    expect(h.jobWhere()[0]).toMatchObject({ id: "ft-1", tenantId: "buro-A" });
  });

  it("başka kiracının işi görünmez (404) — manifest ve durum", async () => {
    const h = harness({ providerOwner: "buro-A", job: null });
    await expect(h.svc.manifest(ADMIN_A, "ft-baska")).rejects.toThrow(/bulunamadı/);
    await expect(h.svc.setStatus(ADMIN_A, "ft-baska", { status: "GONDERILDI" })).rejects.toThrow(/bulunamadı/);
  });

  it("boş kendi havuzu ile iş açılamaz (başka büronun örneği sayılmaz)", async () => {
    const h = harness({ providerOwner: "buro-A", approved: 0 });
    await expect(h.svc.create(ADMIN_A, { name: "deneme işi", providerConfigId: "pc-1" })).rejects.toThrow(
      /ONAYLANMIŞ eğitim örneği yok/,
    );
  });
});
