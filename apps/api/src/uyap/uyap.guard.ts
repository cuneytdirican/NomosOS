/**
 * UYAP eklenti token guard'ı — Authorization: Bearer nxt_...
 *
 * Kiracı JWT'sinden TAMAMEN BAĞIMSIZdır: eklenti tarayıcıda çalışır ve NomosOS
 * web oturumuna erişemez. Kimlik, eşleştirme koduyla alınan extension token'dan
 * kurulur. Controller @Public() ile kiracı JwtAuthGuard zincirini atlar; yerine
 * bu guard çalışır ve `request.uyapToken` nesnesini kurar.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "./uyap.tokens";

export interface UyapTokenIdentity {
  tokenId: string;
  tenantId: string;
  userId: string;
}

export interface UyapTokenRequest extends Request {
  uyapToken?: UyapTokenIdentity;
}

const UNAUTHORIZED_MESSAGE =
  "Eklenti oturumu geçersiz veya süresi dolmuş. Lütfen yeniden eşleştirin.";

@Injectable()
export class UyapTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UyapTokenRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token.startsWith("nxt_")) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    const record = await this.prisma.client.uyapExtensionToken.findUnique({
      where: { accessTokenHash: hashToken(token) },
    });
    // İptal edilmiş / süresi dolmuş jeton = oturum yok.
    if (!record || record.revokedAt !== null || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    request.uyapToken = {
      tokenId: record.id,
      tenantId: record.tenantId,
      userId: record.userId,
    };
    // lastUsedAt async güncellenir — yanıt yolunu bekletmez.
    void this.prisma.client.uyapExtensionToken
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
    return true;
  }
}
