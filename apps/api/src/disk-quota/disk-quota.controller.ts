/**
 * DİSK KOTASI uçları — kiracı tarafı.
 *
 * GET  /disk-quota           — büronun kota durumu (dahil/satın alınan/kullanılan)
 * GET  /disk-quota/packages  — satılabilir ek disk paketleri
 * POST /disk-quota/purchase  — paket satın alma (fatura + kota artışı)
 *
 * PLATFORM tarafı dört-göz düzeltmesi platform-disk.controller'dadır.
 */

import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { DiskQuotaService } from "./disk-quota.service";

const purchaseSchema = z.object({
  packageKey: z.string().trim().min(3).max(40),
});
export type PurchaseDiskInput = z.infer<typeof purchaseSchema>;

@Controller("disk-quota")
export class DiskQuotaController {
  constructor(private readonly diskQuota: DiskQuotaService) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.diskQuota.status(user);
  }

  @Get("packages")
  packages() {
    return this.diskQuota.listPackages();
  }

  @Post("purchase")
  purchase(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(purchaseSchema)) body: PurchaseDiskInput,
  ) {
    return this.diskQuota.purchase(user, body.packageKey);
  }
}
