import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service";

/**
 * Belge deposu modülü.
 *
 * @Global: depo, belge hattı dışında (dilekçe dışa aktarımı, UDF üretimi) da
 * kullanılacağı için tek bir S3 istemcisi paylaşılır; her modül kendi bağlantı
 * havuzunu açmaz.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
