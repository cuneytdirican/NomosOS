import { Module } from "@nestjs/common";
import { SupportTicketsController } from "./support-tickets.controller";
import { SupportTicketsService } from "./support-tickets.service";

/** FAZ 8C — destek talepleri (kiracı tarafı). Platform tarafı PlatformModule içinde. */
@Module({
  controllers: [SupportTicketsController],
  providers: [SupportTicketsService],
  exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
