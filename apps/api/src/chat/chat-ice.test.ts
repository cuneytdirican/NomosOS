/**
 * ICE SUNUCU YAPILANDIRMASI TESTLERİ (D5 / 5-C — TURN hazırlığı).
 *
 * Varsayılan davranış BİREBİR korunur: ortam boşsa genel Google STUN.
 * TURN yalnız TAM kimlikle (URL + kullanıcı + parola) devreye girer.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_STUN_URLS, resolveIceConfig } from "./chat-ice";

describe("resolveIceConfig", () => {
  it("ortam boşsa varsayılan genel STUN döner (mevcut davranış)", () => {
    const cfg = resolveIceConfig({});
    expect(cfg.iceServers).toEqual([{ urls: DEFAULT_STUN_URLS }]);
    expect(cfg.turnEnabled).toBe(false);
  });

  it("STUN_URLS listesi virgülle ayrılır ve boş girişler elenir", () => {
    const cfg = resolveIceConfig({ STUN_URLS: "stun:stun.ornek.local:3478 , ,stun:ikinci:19302" });
    expect(cfg.iceServers[0].urls).toEqual(["stun:stun.ornek.local:3478", "stun:ikinci:19302"]);
    expect(cfg.turnEnabled).toBe(false);
  });

  it("TURN yalnız TAM kimlikle devreye girer", () => {
    const cfg = resolveIceConfig({
      TURN_URLS: "turn:turn.ornek.local:3478?transport=udp,turns:turn.ornek.local:5349",
      TURN_USERNAME: "nomosos",
      TURN_CREDENTIAL: "gizli",
    });
    expect(cfg.turnEnabled).toBe(true);
    expect(cfg.iceServers).toHaveLength(2);
    expect(cfg.iceServers[1]).toEqual({
      urls: ["turn:turn.ornek.local:3478?transport=udp", "turns:turn.ornek.local:5349"],
      username: "nomosos",
      credential: "gizli",
    });
  });

  it("eksik TURN kimliğiyle TURN YOK SAYILIR — arama kırılmaz", () => {
    // URL var, kullanıcı adı yok.
    const a = resolveIceConfig({ TURN_URLS: "turn:turn.ornek.local:3478" });
    expect(a.turnEnabled).toBe(false);
    expect(a.iceServers).toHaveLength(1);
    // URL + kullanıcı adı var, parola yok.
    const b = resolveIceConfig({
      TURN_URLS: "turn:turn.ornek.local:3478",
      TURN_USERNAME: "nomosos",
    });
    expect(b.turnEnabled).toBe(false);
    expect(b.iceServers).toHaveLength(1);
  });

  it("yalnız TURN kimlikleri (URL'siz) yok sayılır", () => {
    const cfg = resolveIceConfig({ TURN_USERNAME: "nomosos", TURN_CREDENTIAL: "gizli" });
    expect(cfg.turnEnabled).toBe(false);
    expect(cfg.iceServers).toHaveLength(1);
  });
});
