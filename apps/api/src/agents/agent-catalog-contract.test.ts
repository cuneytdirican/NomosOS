/**
 * İ-62 SÖZLEŞME TESTİ — ajan kataloğu ↔ AI_TASK_TYPES birebirliği.
 *
 * AGENT_CATALOG "tek kaynak"tır: bir görev tipi katalogda yoksa koşu izi
 * `GENEL` ajanı altına düşer ve iz KAYBOLMAZ ama ajan sorumluluğu belirsizleşir.
 * Bu test:
 *   1. AI_TASK_TYPES'taki her tipin katalogda en az bir ajanı olduğunu,
 *   2. hiçbir tipin İKİ ajana bağlanmadığını (sahiplik belirsizliği),
 *   3. katalogda AI_TASK_TYPES DIŞINDA görev tipi olmadığını (yazım hatası
 *      sessizce GENEL'e düşmez) kanıtlar.
 */
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG, AI_TASK_TYPES } from "@nomosos/shared";

describe("İ-62: ajan kataloğu ↔ görev tipleri birebirliği", () => {
  const taskAgents = new Map<string, string[]>();
  for (const agent of AGENT_CATALOG) {
    for (const t of agent.taskTypes) {
      const owners = taskAgents.get(t) ?? [];
      owners.push(agent.agentKey);
      taskAgents.set(t, owners);
    }
  }

  it("her görev tipinin BİR ajanı vardır (sahipsiz ya da çok sahipli yok)", () => {
    const ownerless = AI_TASK_TYPES.filter((t) => !taskAgents.has(t));
    const multiOwner = [...taskAgents.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([t, owners]) => `${t} → ${owners.join(", ")}`);
    expect(
      ownerless,
      `Ajanı olmayan görev tipleri: ${ownerless.join(", ")} — izleri GENEL altına düşer, sahiplik belirsizleşir.`,
    ).toEqual([]);
    expect(
      multiOwner,
      `Birden çok ajana bağlı görev tipleri: ${multiOwner.join(" | ")}`,
    ).toEqual([]);
  });

  it("katalog AI_TASK_TYPES DIŞINDA görev tipi içermiyor (yazım hatası yakalanır)", () => {
    const known = new Set<string>(AI_TASK_TYPES);
    const unknown = [...taskAgents.keys()].filter((t) => !known.has(t));
    expect(
      unknown,
      `Katalogda tanımsız görev tipleri: ${unknown.join(", ")} — bunlar AI_TASK_TYPES'a hiç girmez.`,
    ).toEqual([]);
  });
});
