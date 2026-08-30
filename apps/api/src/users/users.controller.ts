import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";

/**
 * Büro kullanıcı listesi — `/api/v1/users`
 *
 * NEDEN VAR: Onay kuyruğunda GOREV önerisi, dosyanın sorumlu avukatı atanmamışsa
 * `assigneeId` ZORUNLUDUR (proposals.service.ts). Arayüzde sorumlu seçici
 * olmadığı için o öneriler daima 400 alıyordu ve kullanıcının kuyruğu
 * temizlemesinin tek yolu reddetmekti.
 *
 * VERİ MİNİMİZASYONU: yalnızca atama için gereken alanlar döner (kimlik, ad,
 * rol). E-posta, baro sicili ve diğer kişisel alanlar BU UÇTAN DÖNMEZ.
 * Her sorgu `tenantId` süzgeçlidir.
 */
@Controller("users")
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.client.user.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: 500,
    });
  }
}
