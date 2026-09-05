import { SetMetadata } from "@nestjs/common";

/**
 * PLAN MODÜLÜ KAPISI (Faz 3) — `PlanTier.featuresJson.modules` zorlaması.
 *
 * `@RequiresModule("icra")` taşıyan denetleyici/uç, büronun planında o modül
 * yoksa 403 döner (`ModuleAccessGuard`). Modül anahtarları seed ile aynıdır:
 * dosya, sure, gorev, ai, icra, finans, faturalama, sso, ozel-model.
 */
export const REQUIRES_MODULE_KEY = "nomosos:requiresModule";

export const PLAN_MODULES = ["dosya", "sure", "gorev", "ai", "icra", "finans", "faturalama", "sso", "ozel-model"] as const;
export type PlanModule = (typeof PLAN_MODULES)[number];

export const RequiresModule = (module: PlanModule) => SetMetadata(REQUIRES_MODULE_KEY, module);
