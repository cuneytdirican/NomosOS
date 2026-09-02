import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { StorageModule } from "../storage/storage.module";
import { DiskQuotaModule } from "../disk-quota/disk-quota.module";

@Module({
  imports: [StorageModule, DiskQuotaModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
