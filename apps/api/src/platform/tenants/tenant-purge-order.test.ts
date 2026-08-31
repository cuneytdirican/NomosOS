import { describe, expect, it } from "vitest";
import { topologicalDeleteOrder } from "./tenant-purge-order";

/**
 * VERİ İMHASI SİLME SIRASI — denetim bulgusu Ö-28 regresyonu.
 * Çocuk tablolar ebeveynlerinden ÖNCE silinmelidir; aksi hâlde FK ihlali
 * transaction'ı düşürür ve kalıcı silme hiç tamamlanamaz.
 */
describe("topologicalDeleteOrder (denetim bulgusu Ö-28)", () => {
  const indexOf = (order: string[], table: string) => order.indexOf(table);

  it("çocuk tablo ebeveyninden önce silinir", () => {
    const order = topologicalDeleteOrder(
      ["Client", "Case", "Document"],
      [
        { dependent: "Case", referenced: "Client" },
        { dependent: "Document", referenced: "Case" },
      ]
    );
    expect(indexOf(order, "Document")).toBeLessThan(indexOf(order, "Case"));
    expect(indexOf(order, "Case")).toBeLessThan(indexOf(order, "Client"));
  });

  it("bilinmeyen tabloya giden kenarlar yok sayılır", () => {
    const order = topologicalDeleteOrder(
      ["Case"],
      [{ dependent: "Case", referenced: "Tenant" }]
    );
    expect(order).toEqual(["Case"]);
  });

  it("kendine referans (parentId) sıralamayı kilitlemez", () => {
    const order = topologicalDeleteOrder(
      ["CaseNote"],
      [{ dependent: "CaseNote", referenced: "CaseNote" }]
    );
    expect(order).toEqual(["CaseNote"]);
  });

  it("karşılıklı FK döngüsü tabloları DÜŞÜRMEZ, sona atar", () => {
    const order = topologicalDeleteOrder(
      ["A", "B", "C"],
      [
        { dependent: "A", referenced: "B" },
        { dependent: "B", referenced: "A" },
        { dependent: "C", referenced: "A" },
      ]
    );
    expect([...order].sort()).toEqual(["A", "B", "C"]);
    // Döngüye girmeyen C, döngüdekilerden ÖNCE gelir.
    expect(indexOf(order, "C")).toBeLessThan(indexOf(order, "A"));
  });

  it("aynı seviyedekiler alfabetik: koşumlar arası determinizm", () => {
    const first = topologicalDeleteOrder(["Zebra", "Alfa", "Mavi"], []);
    const second = topologicalDeleteOrder(["Mavi", "Zebra", "Alfa"], []);
    expect(first).toEqual(second);
    expect(first).toEqual(["Alfa", "Mavi", "Zebra"]);
  });

  it("her tablo TAM BİR KEZ döner (satır atlanmaz, iki kez silinmez)", () => {
    const tables = ["A", "B", "C", "D"];
    const order = topologicalDeleteOrder(tables, [
      { dependent: "B", referenced: "A" },
      { dependent: "C", referenced: "B" },
      { dependent: "D", referenced: "A" },
    ]);
    expect(order).toHaveLength(tables.length);
    expect(new Set(order).size).toBe(tables.length);
  });
});
