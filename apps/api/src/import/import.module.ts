import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";

/** FAZ 8E — veri göçü sihirbazı (dosya/duruşma CSV, belge ZIP). Belge yazımı DocumentsService hattından. */
@Module({
  imports: [DocumentsModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
