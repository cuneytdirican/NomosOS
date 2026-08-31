import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { approvalRoutingError } from "./platform-permission.guard";
import { isFourEyesAction, type AdminAction } from "../platform-permissions";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ YAPISAL DÖRT-GÖZ KONTROLÜ — denetim bulgusu K-11 regresyonu              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * K-11'in kökü şuydu: dört-göz kuralını ZORLAYAN hiçbir merkez yoktu.
 * `createPlan` `approvals.request` çağırmayı "unuttu" ve hiçbir şey uyarmadı;
 * panel ise aynı işlem için "ikinci imza gerekir" diyordu.
 *
 * İki kat test:
 *   1. `approvalRoutingError` saf birim testleri (guard'ın kararı),
 *   2. KAYNAK TARAMASI: repodaki HER platform ucunun beyanı matrisle tutarlı
 *      mı? Yeni bir uç yanlış dekoratörle eklendiği an bu test kırılır —
 *      guard'ın çalışma zamanı hatasını beklemeye gerek kalmaz.
 */
describe("approvalRoutingError (guard kararı)", () => {
  it("dört-göz aksiyon doğrudan yazma ucuna bağlanamaz", () => {
    const err = approvalRoutingError({ action: "payment.refund", mode: "write" });
    expect(err).toContain("dört-göz onayına tabidir");
    expect(err).toContain("@ApprovalWritePermission");
  });

  it("dört-göz aksiyon onay ucuna bağlanınca hata YOK", () => {
    expect(
      approvalRoutingError({ action: "payment.refund", mode: "write", viaApproval: true })
    ).toBeNull();
  });

  it("dört-göz OLMAYAN aksiyon onay beyanı taşıyamaz (bayat beyan)", () => {
    const err = approvalRoutingError({
      action: "system.settings",
      mode: "write",
      viaApproval: true,
    });
    expect(err).toContain("dört-göz DEĞİL");
  });

  it("normal yazma ucu sorunsuz geçer", () => {
    expect(approvalRoutingError({ action: "system.settings", mode: "write" })).toBeNull();
  });
});

/**
 * KAYNAK TARAMASI.
 *
 * Dekoratör satırlarını okur: `@WritePermission("x")` ve
 * `@ApprovalWritePermission("x")`. Nest bağlamı kurmadan, saf metin üzerinden
 * çalışır — bu test DB, DI ve HTTP gerektirmez.
 */
describe("platform uçlarının dört-göz beyanları (kaynak taraması)", () => {
  const apiSrc = path.resolve(process.cwd(), "src");

  const controllerFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...controllerFiles(full));
      else if (entry.name.endsWith(".controller.ts")) out.push(full);
    }
    return out;
  };

  const declarations = () => {
    const found: Array<{ file: string; action: AdminAction; viaApproval: boolean }> = [];
    for (const file of controllerFiles(apiSrc)) {
      const source = fs.readFileSync(file, "utf8");
      const pattern = /@(Approval)?WritePermission\(\s*"([^"]+)"\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        found.push({
          file: path.relative(apiSrc, file),
          action: match[2] as AdminAction,
          viaApproval: match[1] === "Approval",
        });
      }
    }
    return found;
  };

  it("taranan uç sayısı makul (tarama gerçekten çalışıyor)", () => {
    expect(declarations().length).toBeGreaterThan(20);
  });

  it("dört-göz aksiyonu taşıyan HİÇBİR uç doğrudan yazma yapmaz", () => {
    const violations = declarations()
      .filter((d) => isFourEyesAction(d.action) && !d.viaApproval)
      .map((d) => `${d.file}: @WritePermission("${d.action}")`);
    expect(
      violations,
      "Bu uçlar dört-göz bir işlemi TEK İMZAYLA uyguluyor olabilir:\n" +
        violations.join("\n")
    ).toEqual([]);
  });

  it("dört-göz OLMAYAN hiçbir uç onay beyanı taşımaz", () => {
    const stale = declarations()
      .filter((d) => d.viaApproval && !isFourEyesAction(d.action))
      .map((d) => `${d.file}: @ApprovalWritePermission("${d.action}")`);
    expect(stale, `Bayat onay beyanları:\n${stale.join("\n")}`).toEqual([]);
  });

  it("K-11'in somut vakası: plan oluşturma ucu onay yoluyla bağlıdır", () => {
    const plans = declarations().filter((d) => d.file.includes("subscriptions"));
    const create = plans.find((d) => d.action === "plan.catalog.price");
    expect(create, "POST /plans dört-göz beyanı taşımıyor").toBeTruthy();
    expect(create?.viaApproval).toBe(true);
  });
});
