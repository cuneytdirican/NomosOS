import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { LoginInput } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser, JwtPayload } from "../common/types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService
  ) {}

  async login(input: LoginInput) {
    const user = await this.prisma.client.user.findUnique({ where: { email: input.email } });
    if (!user || !user.isActive) {
      // Başarısız denemeler de denetlenir (denetim bulgusu 19). Kullanıcı
      // bulunamadığında tenantId bilinmediğinden kayıt atlanır; mesaj her iki
      // hâlde de aynıdır (hesap sayımını engellemek için).
      if (user) {
        await this.logFailedLogin(user.tenantId, user.id, input.email, "hesap pasif");
      }
      throw new UnauthorizedException("E-posta veya şifre hatalı.");
    }
    const passwordOk = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      await this.logFailedLogin(user.tenantId, user.id, input.email, "hatalı şifre");
      throw new UnauthorizedException("E-posta veya şifre hatalı.");
    }

    const payload: JwtPayload = { sub: user.id, tenantId: user.tenantId, role: user.role };
    const accessToken = await this.jwtService.signAsync(payload);

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entity: "User",
      entityId: user.id,
      detail: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  /** Başarısız giriş denemesini denetim günlüğüne yazar. */
  private async logFailedLogin(
    tenantId: string,
    userId: string,
    email: string,
    reason: string
  ): Promise<void> {
    await this.audit.log({
      tenantId,
      userId,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: userId,
      detail: `${email} — ${reason}`,
    });
  }

  async me(authUser: AuthUser) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: authUser.userId, tenantId: authUser.tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        fullName: true,
        role: true,
        barNumber: true,
        isActive: true,
        tenant: { select: { id: true, name: true } },
      },
    });
    if (!user) {
      throw new NotFoundException("Kullanıcı bulunamadı.");
    }
    return user;
  }
}
