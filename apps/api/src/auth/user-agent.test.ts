import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./user-agent";

describe("parseUserAgent", () => {
  it("tarayıcılar + işletim sistemleri", () => {
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36").label).toBe("Chrome · Windows");
    expect(parseUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Edg/128.0").label).toBe("Edge · Windows");
    expect(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15").label).toBe("Safari · macOS");
    expect(parseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1").label).toBe("Safari · iPhone");
    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0").label).toBe("Firefox · Linux");
    expect(parseUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36").label).toBe("Chrome · Android");
  });

  it("mobil uygulama, curl, boş", () => {
    expect(parseUserAgent("okhttp/4.12.0")).toMatchObject({ kind: "mobil-uygulama", label: "NomosOS mobil (Android)" });
    expect(parseUserAgent("NomosOSMobile/1.0 CFNetwork/1498 Darwin/23.5.0")).toMatchObject({ kind: "mobil-uygulama", label: "NomosOS mobil (iOS)" });
    expect(parseUserAgent("curl/8.7.1")).toMatchObject({ kind: "diger", label: "curl" });
    expect(parseUserAgent("")).toMatchObject({ kind: "diger", label: "Bilinmeyen istemci" });
    expect(parseUserAgent(undefined).label).toBe("Bilinmeyen istemci");
  });
});
