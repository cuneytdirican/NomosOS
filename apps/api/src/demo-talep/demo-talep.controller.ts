import { Body, Controller, Ip, Post } from "@nestjs/common";
import type { z } from "zod";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { DemoTalepService, demoTalepSchema } from "./demo-talep.service";

/**
 * HERKESAÇIK DEMO TALEBİ UCU — tanıtım sitesi formu buraya yazar.
 * Kayıt DemoRequest tablosuna düşer; e-posta/webhook gönderilmez (kullanıcı
 * kararı — izleme platform panelindedir). Koruma ve gerekçe: service'te.
 */
@Controller("demo-talepleri")
export class DemoTalepController {
  constructor(private readonly demoTalep: DemoTalepService) {}

  /** POST /demo-talepleri — pazarlama formu (herkese açık). */
  @Post()
  @Public()
  create(@Ip() ip: string, @Body(new ZodValidationPipe(demoTalepSchema)) body: z.infer<typeof demoTalepSchema>) {
    return this.demoTalep.create(ip, body);
  }
}
