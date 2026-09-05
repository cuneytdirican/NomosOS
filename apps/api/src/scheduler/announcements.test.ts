import { describe, expect, it } from "vitest";
import { announcementTargetsTenant } from "./notifications.service";

describe("announcementTargetsTenant", () => {
  it("TUM herkese; PLAN_BAZLI planKeys; TENANT_BAZLI tenantIds; bozuk JSON görünmez", () => {
    expect(announcementTargetsTenant({ audience: "TUM", targetJson: null }, "t1", "PRO")).toBe(true);
    expect(announcementTargetsTenant({ audience: "PLAN_BAZLI", targetJson: JSON.stringify({ planKeys: ["PRO"] }) }, "t1", "PRO")).toBe(true);
    expect(announcementTargetsTenant({ audience: "PLAN_BAZLI", targetJson: JSON.stringify({ planKeys: ["PRO"] }) }, "t1", "STARTER")).toBe(false);
    expect(announcementTargetsTenant({ audience: "PLAN_BAZLI", targetJson: JSON.stringify({ planKeys: ["PRO"] }) }, "t1", null)).toBe(false);
    expect(announcementTargetsTenant({ audience: "TENANT_BAZLI", targetJson: JSON.stringify({ tenantIds: ["t1"] }) }, "t1", null)).toBe(true);
    expect(announcementTargetsTenant({ audience: "TENANT_BAZLI", targetJson: JSON.stringify({ tenantIds: ["t2"] }) }, "t1", null)).toBe(false);
    expect(announcementTargetsTenant({ audience: "TENANT_BAZLI", targetJson: "{bozuk" }, "t1", null)).toBe(false);
    expect(announcementTargetsTenant({ audience: "TENANT_BAZLI", targetJson: null }, "t1", null)).toBe(false);
  });
});
