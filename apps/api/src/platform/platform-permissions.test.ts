import { describe, expect, it } from "vitest";
import * as path from "node:path";
import {
  ADMIN_ROLES,
  ACTION_LABELS,
  FOUR_EYES_ACTIONS,
  PERMISSION_MATRIX,
  isFourEyesAction,
  needsFourEyes,
  requiresApproval,
  type AdminAction,
} from "./platform-permissions";
import {
  APPROVAL_ACTIONS,
  APPROVAL_LABELS,
  APPROVAL_REQUIRED_PERMISSION,
  type ApprovalActionKey,
} from "./approvals/approval-actions";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ YETKİ MATRİSİ VE DÖRT-GÖZ KATALOĞU — K-11, Ö-28, Ö-32 regresyonları      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
describe("dört-göz kataloğu tek kaynaktan türer (denetim bulgusu K-11)", () => {
  it("katalog matristen türetilir: elle yazılmış ikinci liste YOKTUR", () => {
    const derived = (Object.keys(PERMISSION_MATRIX) as AdminAction[]).filter((action) =>
      ADMIN_ROLES.some((role) => PERMISSION_MATRIX[action][role] === "four_eyes")
    );
    expect([...FOUR_EYES_ACTIONS].sort()).toEqual(derived.sort());
  });

  it("matriste four_eyes olan HER aksiyon katalogdadır (ve tersi)", () => {
    for (const action of Object.keys(PERMISSION_MATRIX) as AdminAction[]) {
      const anyFourEyes = ADMIN_ROLES.some(
        (role) => PERMISSION_MATRIX[action][role] === "four_eyes"
      );
      expect(isFourEyesAction(action)).toBe(anyFourEyes);
    }
  });

  it("`platform_user.manage` ve `plan.catalog.write` artık çelişmiyor", () => {
    // K-11'in tam çekirdeği: bu iki aksiyon ELLE YAZILMIŞ listede dört-gözdü
    // ama matriste "full"du; panel rozet gösteriyor, API tek imzayla
    // uyguluyordu. Dört-göz olan alt işlemler kendi satırlarına taşındı.
    expect(isFourEyesAction("platform_user.manage")).toBe(false);
    expect(isFourEyesAction("plan.catalog.write")).toBe(false);
    expect(isFourEyesAction("platform_user.create")).toBe(true);
    expect(isFourEyesAction("platform_user.credential_reset")).toBe(true);
    expect(isFourEyesAction("plan.catalog.price")).toBe(true);
  });

  it("rozet kararı ile yaptırım kararı AYNI kaynaktan gelir", () => {
    for (const action of Object.keys(PERMISSION_MATRIX) as AdminAction[]) {
      for (const role of ADMIN_ROLES) {
        // Panel `needsFourEyes` ile rozet gösterir; API `requiresApproval` ile
        // uygular. Rozet gösterilen HER durumda API'nin de onay istemesi
        // gerekir: `needsFourEyes` true iken aksiyon katalogda olmalıdır.
        if (needsFourEyes(role, action)) {
          expect(isFourEyesAction(action) || requiresApproval(role, action)).toBe(true);
        }
      }
    }
  });
});

describe("onay kataloğu spec'in 8 maddesini kapsar (denetim bulgusu Ö-28)", () => {
  it("her onay işlemi, matriste dört-göz olan bir yetkiye bağlıdır", () => {
    for (const [approvalAction, permission] of Object.entries(APPROVAL_REQUIRED_PERMISSION)) {
      expect(
        isFourEyesAction(permission as AdminAction),
        `${approvalAction} → ${permission} matriste dört-göz DEĞİL`
      ).toBe(true);
    }
  });

  it("spec §Roller listesinin 8 maddesinin tamamı katalogda vardır", () => {
    // docs/moduller/25-sistem-yonetim-paneli.md §Roller "Dört-göz ilkesi" 1–8.
    const specItems: Array<[string, ApprovalActionKey]> = [
      ["1. Tenant kalıcı silme / veri imhası", APPROVAL_ACTIONS.TENANT_DELETE],
      ["2. Tenant askıya alma", APPROVAL_ACTIONS.TENANT_SUSPEND],
      ["3. İade", APPROVAL_ACTIONS.PAYMENT_REFUND],
      ["4. Özel fiyat / manuel indirim", APPROVAL_ACTIONS.PLAN_PRICE_CHANGE],
      ["5. Destek erişim penceresi açma", APPROVAL_ACTIONS.SUPPORT_ACCESS_GRANT],
      ["6a. Bakım modu tam kilidi", APPROVAL_ACTIONS.SYSTEM_MAINTENANCE_LOCK],
      ["6b. Platform geneli flag", APPROVAL_ACTIONS.FEATURE_FLAG_GLOBAL],
      ["7. SUPER_ADMIN atama / düşürme", APPROVAL_ACTIONS.PLATFORM_USER_SUPER_ADMIN],
      ["8. PlatformAuditLog dışa aktarımı", APPROVAL_ACTIONS.AUDIT_EXPORT],
    ];
    for (const [label, action] of specItems) {
      expect(APPROVAL_REQUIRED_PERMISSION[action], `${label} katalogda yok`).toBeTruthy();
      expect(APPROVAL_LABELS[action], `${label} etiketi yok`).toBeTruthy();
    }
  });
});

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ İKİZ MATRİS AYRIŞMASI — denetim bulgusu Ö-32                             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * `apps/admin/src/lib/rbac.ts` ile bu dosya birbirinin "BİREBİR ikizi" olduğunu
 * ilan ediyor ama ayrışmalarını yakalayan hiçbir şey yoktu; denetimde 235
 * hücreden biri (credits.tenant.view / SUPPORT_AGENT) elle karşılaştırılarak
 * bulundu. Bu test o karşılaştırmayı MEKANİK hâle getirir.
 *
 * İstemci dosyası TS tipi olarak değil, ÇALIŞMA ZAMANINDA dinamik import ile
 * okunur: `apps/api` derlemesinin `rootDir` sınırı dışına statik bir bağ
 * kurulamaz (kurulsaydı `nest build` kırılırdı).
 */
describe("istemci/sunucu yetki matrisi ikizleri (denetim bulgusu Ö-32)", () => {
  const loadAdminRbac = async () => {
    const file = path.resolve(process.cwd(), "../admin/src/lib/rbac.ts");
    return (await import(/* @vite-ignore */ file)) as {
      PERMISSION_MATRIX: Record<string, Record<string, string>>;
      ACTION_LABELS: Record<string, string>;
      FOUR_EYES_ACTIONS: readonly string[];
      ADMIN_ROLES: readonly string[];
    };
  };

  it("iki matris AYNI aksiyon kümesini taşır", async () => {
    const admin = await loadAdminRbac();
    expect(Object.keys(admin.PERMISSION_MATRIX).sort()).toEqual(
      Object.keys(PERMISSION_MATRIX).sort()
    );
    expect([...admin.ADMIN_ROLES].sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it("235 hücrenin HEPSİ birebir eşittir", async () => {
    const admin = await loadAdminRbac();
    const drift: string[] = [];
    for (const action of Object.keys(PERMISSION_MATRIX) as AdminAction[]) {
      for (const role of ADMIN_ROLES) {
        const server = PERMISSION_MATRIX[action][role];
        const client = admin.PERMISSION_MATRIX[action]?.[role];
        if (server !== client) {
          drift.push(`${action} / ${role}: sunucu="${server}" istemci="${client}"`);
        }
      }
    }
    expect(drift, `İkiz matrisler ayrışmış:\n${drift.join("\n")}`).toEqual([]);
  });

  it("dört-göz katalogları da aynıdır (ikisi de matristen türer)", async () => {
    const admin = await loadAdminRbac();
    expect([...admin.FOUR_EYES_ACTIONS].sort()).toEqual([...FOUR_EYES_ACTIONS].sort());
  });

  it("etiket sözlükleri aynı anahtarları taşır", async () => {
    const admin = await loadAdminRbac();
    expect(Object.keys(admin.ACTION_LABELS).sort()).toEqual(Object.keys(ACTION_LABELS).sort());
  });
});
