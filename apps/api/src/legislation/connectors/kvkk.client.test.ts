/**
 * KVKK İSTEMCİ TESTLERİ — liste ayrıştırıcı + künye çıkarımı.
 * HTML biçimi kvkk.gov.tr'den (tarayıcı üzerinden) birebir doğrulanmıştır.
 */

import { describe, expect, it } from "vitest";
import { extractKvkkDecisionMeta, parseKvkkDecisionList } from "./kvkk.client";

const LIST_HTML = [
  "<html><body>",
  '<div class="members__item d-flex justify-content-between">',
  '<div class="members__item-meta w-100">',
  "<h2>Köy Tüzel Kişiliklerinin Veri Sorumluları Siciline Kayıt Yükümlülüğünden İstisna Tutulması Hakkında Karar</h2>",
  '<a href="https://www.kvkk.gov.tr/Icerik/7791/2023-2135" target="_blank" class="read-more">Devamını Gör</a>',
  "</div></div>",
  '<div class="members__item d-flex justify-content-between">',
  '<div class="members__item-meta w-100">',
  "<h4>Sadakat Kart Üyeliği Bulunan Bir Kişinin Cep Telefonu Numarasının Paylaşılması</h4>",
  '<a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260813-3.pdf" class="read-more">Devamını Gör</a>',
  "</div></div>",
  "</body></html>",
].join("\n");

describe("parseKvkkDecisionList", () => {
  it("karar başlıkları ve bağlantıları ayrıştırılır; PDF işaretlenir", () => {
    const items = parseKvkkDecisionList(LIST_HTML);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: expect.stringContaining("Köy Tüzel Kişiliklerinin"),
      url: "https://www.kvkk.gov.tr/Icerik/7791/2023-2135",
      isPdf: false,
    });
    expect(items[1].isPdf).toBe(true);
    expect(items[1].url).toContain("resmigazete");
  });

  it("mükerrer bağlantı tek kayıt olur; bozuk sayfa boş döner", () => {
    const dup = parseKvkkDecisionList(
      LIST_HTML.replace('href="https://www.kvkk.gov.tr', 'href="https://www.kvkk.gov.tr').replace(
        "Köy Tüzel Kişiliklerinin Veri Sorumluları",
        "Köy Tüzel Kişiliklerinin Veri Sorumluları",
      ),
    );
    expect(dup).toHaveLength(2);
    expect(parseKvkkDecisionList("<html>bozuk</html>")).toEqual([]);
  });
});

describe("extractKvkkDecisionMeta", () => {
  it("karar tarihi ve karar no çıkarılır (doğrulanmış sayfa biçimi)", () => {
    const meta = extractKvkkDecisionMeta(
      "Karar Tarihi : 14/12/2023 Karar No : 2023/2135 Konu Özeti : ...",
    );
    expect(meta).toEqual({ kararTarihi: "14/12/2023", kararNo: "2023/2135" });
  });

  it("künye yoksa boş döner (sessiz varsayım yok)", () => {
    expect(extractKvkkDecisionMeta("İçerik yok")).toEqual({});
  });
});
