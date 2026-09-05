/**
 * MODÜL ERİŞİM GUARD'I (Faz 3) — plan `features.modules` zorlaması.
 *
 * `TenantStatusGuard`'dan SONRA koşar. Uç `@RequiresModule(x)` taşıyorsa büronun
 * planı (Subscription.planKey → PlanTier.featuresJson.modules) `x` içermeli;
 * yoksa 403 + hangi plana geçileceği. Aboneliği/planı olmayan kiracı
 * ENGELLENMEZ (Faz 0 kararıyla tutarlı: kayıt eksikliği erişim kararı değildir).
 * Plan modülleri 60 sn önbellekte (plan değişikliği en geç 1 dk'da etkili).
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { REQUIRES_MODULE_KEY, type PlanModule } from "../decorators/requires-module.decorator";
import type { AuthUser } from "../types";

const CACHE_TTL_MS = 60_000;

interface CachedModules {
  /** null = abonelik ya da plan yok → kısıt yok. */
  modules: string[] | null;
  planName: string | null;
  expiresAt: number;
}

export const MODULE_LABELS: Record<PlanModule, string> = {
  dosya: "Dosya yönetimi",
  sure: "Süre takibi",
  gorev: "Görevler",
  ai: "AI asistan",
  icra: "İcra takibi",
  finans: "Finans",
  faturalama: "Faturalama / e-Fatura",
  sso: "Kurumsal giriş (SSO)",
  "ozel-model": "Özel model eğitimi",
};

/** Saf karar: modül listesi verilmişse içeriyor mu? */
export function moduleAllowed(modules: string[] | null, required: string): boolean {
  if (modules === null) return true;
  return modules.includes(required);
}

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  private readonly cache = new Map<string, CachedModules>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlanModule | undefined>(REQUIRES_MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (request.path?.startsWith("/api/admin/")) return true;
    const user = request.user;
    if (!user?.tenantId) return true;

    const entry = await this.readModules(user.tenantId);
    if (moduleAllowed(entry.modules, required)) return true;
    throw new ForbiddenException(
      `"${MODULE_LABELS[required] ?? required}" modülü büronuzun planında (${entry.planName ?? "tanımsız"}) yer almıyor. ` +
        "Ayarlar → Abonelik ekranından planınızı yükseltebilir ya da platform ekibiyle iletişime geçebilirsiniz. Mevcut verileriniz korunur.",
    );
  }

  /** Testler / plan değişikliği sonrası anında etki için. */
  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  private async readModules(tenantId: string): Promise<CachedModules> {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > now) return cached;
    const sub = await this.prisma.client.subscription.findUnique({ where: { tenantId }, select: { planKey: true } });
    let entry: CachedModules = { modules: null, planName: null, expiresAt: now + CACHE_TTL_MS };
    if (sub) {
      const plan = await this.prisma.client.planTier.findUnique({ where: { key: sub.planKey }, select: { name: true, featuresJson: true } });
      if (plan) {
        let modules: string[] | null = null;
        try {
          const parsed = JSON.parse(plan.featuresJson) as { modules?: unknown };
          modules = Array.isArray(parsed.modules) ? parsed.modules.map(String) : null;
        } catch {
          modules = null;
        }
        entry = { modules, planName: plan.name, expiresAt: now + CACHE_TTL_MS };
      }
    }
    if (this.cache.size > 1_000) {
      for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
    }
    this.cache.set(tenantId, entry);
    return entry;
  }
}
