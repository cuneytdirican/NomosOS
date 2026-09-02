/**
 * YARGI ORGANLARI — büro tarafı okuma uçları.
 *
 * GET /judicial/iller    — il listesi (kademeli seçim için)
 * GET /judicial/bodies   — mahkeme + icra dairesi kataloğu (type/category/il/q süzgeçli)
 * GET /judicial/notaries — noterlik kataloğu (il/q süzgeçli)
 *
 * Bu bir REFERANS katalogdur: büronun kendi verisi değildir, her kimliği
 * doğrulanmış kullanıcı okuyabilir (dosya açarken mahkeme seçmek sekreterin de
 * işidir).
 */

import { Controller, Get, Query } from "@nestjs/common";
import { JudicialService } from "./judicial.service";

@Controller("judicial")
export class JudicialController {
  constructor(private readonly judicial: JudicialService) {}

  @Get("iller")
  iller() {
    return this.judicial.listIller();
  }

  @Get("bodies")
  bodies(
    @Query("type") type?: string,
    @Query("category") category?: string,
    @Query("il") il?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    return this.judicial.listBodies({
      type,
      category,
      il,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("notaries")
  notaries(
    @Query("il") il?: string,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    return this.judicial.listNotaries({
      il,
      q,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
