import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { caseVisibilityWhere, seesAllCases } from "../case-visibility";
import type { AuthUser } from "../types";

/**
 * GİZLİ DOSYA KAPISI — global guard (JwtAuthGuard ve TenantStatusGuard'dan SONRA).
 *
 * İstek bir dosyaya işaret ediyorsa (rota parametresi `:caseId`, `/cases/:id`,
 * sorgu `?caseId=`, gövde `caseId`) ve kullanıcı o dosyayı göremiyorsa 404.
 * 404 bilinçlidir: 403 "böyle bir dosya var ama sana kapalı" demektir, gizli
 * dosyanın varlığı bile sızdırılmaz.
 *
 * Neden guard: 47 dosyadaki 51 `case` sorgusunu tek tek değiştirmek yerine
 * kesişen bir nokta. ADMIN/PARTNER için veritabanına HİÇ gidilmez. Diğer roller
 * için istek başına en çok BİR indeksli sorgu (id + tenantId + görünürlük).
 *
 * Kapsam dışı: platform paneli (`/api/admin/**`), @Public uçlar (user yok),
 * dosyaya işaret etmeyen istekler.
 */
@Injectable()
export class CaseAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) return true; // @Public ya da platform paneli
    if (request.path?.startsWith("/api/admin/")) return true;
    if (seesAllCases(user)) return true;

    const caseId = extractCaseId(request);
    if (!caseId) return true;

    const visible = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId: user.tenantId, ...caseVisibilityWhere(user) },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException("Dosya bulunamadı.");
    }
    return true;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** İstekten dosya kimliğini çıkarır; dosya işaret etmiyorsa null. */
export function extractCaseId(request: {
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  path?: string;
}): string | null {
  const params = request.params ?? {};
  if (typeof params.caseId === "string" && UUID_RE.test(params.caseId)) return params.caseId;
  // /api/v1/cases/:id ve alt yolları — dosyanın kendisi.
  if (typeof params.id === "string" && UUID_RE.test(params.id) && /^\/api\/v1\/cases\/[^/]+/.test(request.path ?? "")) {
    return params.id;
  }
  const q = request.query?.caseId;
  if (typeof q === "string" && UUID_RE.test(q)) return q;
  const body = request.body as { caseId?: unknown } | null | undefined;
  if (body && typeof body === "object" && typeof body.caseId === "string" && UUID_RE.test(body.caseId)) {
    return body.caseId;
  }
  return null;
}
