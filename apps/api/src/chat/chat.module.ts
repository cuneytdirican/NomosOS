import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatEventsService } from "./chat-events.service";
import { StorageModule } from "../storage/storage.module";
import { DiskQuotaModule } from "../disk-quota/disk-quota.module";

@Module({
  imports: [StorageModule, DiskQuotaModule],
  controllers: [ChatController],
  providers: [ChatService, ChatEventsService],
  exports: [ChatService, ChatEventsService],
})
export class ChatModule {}
