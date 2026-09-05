import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { DocumentExtrasService } from "./document-extras.service";

/**
 * FAZ 7A — kamusal paylaşım bağlantısı: GET /api/v1/public/paylasim/:token
 *
 * Kimliksizdir (@Public); koruma jetonun kendisi (256 bit), süre ve indirme sayısıdır.
 * 302 ile 5 dk geçerli imzalı depo adresine yönlendirir; depo adresi kalıcı paylaşılmaz.
 * Global oran sınırı (IP) bu ucu da kapsar.
 */
@Public()
@Controller("public/paylasim")
export class PublicShareController {
  constructor(private readonly extras: DocumentExtrasService) {}

  @Get(":token")
  async resolve(@Param("token") token: string, @Res() res: Response) {
    const { url } = await this.extras.resolvePublic(token);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  }
}
