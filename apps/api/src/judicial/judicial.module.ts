import { Module } from "@nestjs/common";
import { JudicialController } from "./judicial.controller";
import { PlatformJudicialController } from "./platform-judicial.controller";
import { JudicialService } from "./judicial.service";
import { PlatformModule } from "../platform/platform.module";

/** fetch ile uyumlu en küçük imza — testte değiştirilebilir. */
export type JudicialSyncFetch = (url: string) => Promise<unknown>;

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Kaynak ${res.status} döndürdü.`);
  }
  return (await res.json()) as unknown;
}

@Module({
  imports: [PlatformModule],
  controllers: [JudicialController, PlatformJudicialController],
  providers: [
    JudicialService,
    { provide: "JUDICIAL_SYNC_FETCH", useFactory: () => defaultFetchJson },
  ],
  exports: [JudicialService],
})
export class JudicialModule {}
