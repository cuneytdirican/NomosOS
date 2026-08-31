import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";

/**
 * SAĞLIK UÇLARI.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU UÇLAR HİÇBİR İŞ KURALINA TABİ DEĞİLDİR — ne bakım kilidine, ne        ║
 * ║ abonelik durumuna, ne kimliğe. Süreç ayakta mı, onu söylerler.           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Denetim bulgusu K-02: `TenantStatusGuard` bakım tam kilidini `@Public()`
 * kontrolünden ÖNCE uyguluyordu ve `/health` de 503 dönüyordu. Dağıtımdaki
 * healthcheck bunu `unhealthy` sayıyor, `web` ve `admin` servisleri
 * `depends_on: service_healthy` taşıdığı için kilidi kapatabilecek tek arayüz
 * (admin paneli) bir daha ayağa kalkmıyordu. Guard'daki sıra düzeltildi;
 * buradaki `/health/live` ise İKİNCİ savunma katmanıdır: guard'a hiçbir yeni
 * iş kuralı eklenmese bile dağıtım katmanı bu uca bağlanmalıdır.
 */
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): { status: string; time: string } {
    return { status: "ok", time: new Date().toISOString() };
  }

  /**
   * LIVENESS — süreç ayakta mı?
   *
   * Konteyner healthcheck'i bu uca bakar. Yanıt hiçbir veritabanı/Redis
   * çağrısı yapmaz ve hiçbir iş kuralına bakmaz: bir kiracının aboneliği ya da
   * bakım kilidi, sürecin canlı olup olmadığıyla ilgili DEĞİLDİR. Bir
   * bağımlılığın sağlığı gerekiyorsa readiness ayrı bir uçta ölçülmelidir.
   */
  @Public()
  @Get("live")
  live(): { status: string; time: string } {
    return { status: "ok", time: new Date().toISOString() };
  }
}
