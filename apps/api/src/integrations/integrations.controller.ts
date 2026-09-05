/**
 * `/integrations/*` — API anahtarları + webhook'lar (Enterprise++). ADMIN/PARTNER.
 *
 *   GET    /integrations/api-keys            · POST /integrations/api-keys { name, scopes[], expiresAt? }
 *   DELETE /integrations/api-keys/:id        (iptal)
 *   GET    /integrations/webhooks            · POST /integrations/webhooks { url, events[], description? }
 *   PATCH  /integrations/webhooks/:id        · DELETE /integrations/webhooks/:id
 *   POST   /integrations/webhooks/:id/test   · GET /integrations/webhooks/:id/deliveries
 *   GET    /integrations/events              (olay kataloğu)
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthUser } from "../common/types";
import { ApiKeysService } from "./api-keys.service";
import { WebhooksService } from "./webhooks.service";

const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.string().min(3).max(40)).min(1).max(20),
  expiresAt: z.string().nullable().optional(),
});
const createWebhookSchema = z.object({
  url: z.string().trim().url("Geçerli bir adres girin.").max(500),
  events: z.array(z.string().min(3).max(60)).min(1).max(50),
  description: z.string().trim().max(200).optional(),
});
const updateWebhookSchema = z
  .object({
    url: z.string().trim().url().max(500).optional(),
    events: z.array(z.string().min(3).max(60)).min(1).max(50).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Güncellenecek en az bir alan gönderin.");

@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get("events")
  events() {
    return { items: this.webhooks.events() };
  }

  @Get("api-keys")
  listKeys(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(user);
  }

  @Post("api-keys")
  @HttpCode(201)
  createKey(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createKeySchema)) body: z.infer<typeof createKeySchema>) {
    return this.apiKeys.create(user, body);
  }

  @Delete("api-keys/:id")
  revokeKey(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.apiKeys.revoke(user, id);
  }

  @Get("webhooks")
  listWebhooks(@CurrentUser() user: AuthUser) {
    return this.webhooks.list(user);
  }

  @Post("webhooks")
  @HttpCode(201)
  createWebhook(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createWebhookSchema)) body: z.infer<typeof createWebhookSchema>) {
    return this.webhooks.create(user, body);
  }

  @Patch("webhooks/:id")
  updateWebhook(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWebhookSchema)) body: z.infer<typeof updateWebhookSchema>,
  ) {
    return this.webhooks.update(user, id, body);
  }

  @Delete("webhooks/:id")
  removeWebhook(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.webhooks.remove(user, id);
  }

  @Post("webhooks/:id/test")
  @HttpCode(200)
  testWebhook(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.webhooks.enqueueTest(user, id);
  }

  @Get("webhooks/:id/deliveries")
  deliveries(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.webhooks.deliveries(user, id);
  }
}
