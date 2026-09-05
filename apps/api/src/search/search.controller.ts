import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { AuthUser } from "../common/types";
import { SearchService } from "./search.service";

/** FAZ 7B — GET /search?q=&limit= (Ctrl+K). */
@Controller("search")
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(@CurrentUser() user: AuthUser, @Query("q") q?: string, @Query("limit") limit?: string) {
    return this.search.search(user, q ?? "", Number(limit) || 5);
  }
}
