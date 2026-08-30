/** Strateji düğümlerinin ağaç/sözleşme dönüşümleri (saf fonksiyonlar). */

import { createHash } from "node:crypto";
import type { StrategyNode, StrategyNodeType } from "@nomosos/db";
import { CHAIN_BY_KEY, STRATEGY_CHAIN, type StrategyChainKey } from "./strategy.chain";

export const NODE_TYPE_LABELS: Record<StrategyNodeType, string> = {
  KARSI_ARGUMAN: "Karşı taraf argümanı",
  BIZIM_ARGUMAN: "Bizim argümanımız",
  DELIL: "Delil",
  HUKUKI_DAYANAK: "Hukuki dayanak",
  ZAYIF_NOKTA: "Zayıf nokta",
  KARSI_CEVAP: "Bizim cevabımız",
  SENARYO: "Alternatif senaryo",
  RISK: "Risk",
};

export interface StrategyTreeNode {
  id: string;
  parentId: string | null;
  nodeType: StrategyNodeType;
  nodeTypeLabel: string;
  content: string;
  strength: number | null;
  sourceRef: string | null;
  orderIndex: number;
  createdAt: Date;
  children: StrategyTreeNode[];
}

/**
 * Düz düğüm listesini ağaca çevirir.
 *
 * Kök olmayan ama üstü listede bulunmayan düğümler (yarım kalmış silme, elle
 * müdahale) KÖKE alınır — kayıt gizlenmez. Döngü tespit edilirse döngüyü kapatan
 * düğüm yine köke alınır; sonsuz özyineleme oluşmaz.
 */
export function buildNodeTree(nodes: readonly StrategyNode[]): StrategyTreeNode[] {
  const byId = new Map<string, StrategyTreeNode>();
  for (const n of nodes) {
    byId.set(n.id, {
      id: n.id,
      parentId: n.parentId,
      nodeType: n.nodeType,
      nodeTypeLabel: NODE_TYPE_LABELS[n.nodeType],
      content: n.content,
      strength: n.strength,
      sourceRef: n.sourceRef,
      orderIndex: n.orderIndex,
      createdAt: n.createdAt,
      children: [],
    });
  }

  const roots: StrategyTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || createsCycle(node, parent, byId)) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const sort = (list: StrategyTreeNode[]): void => {
    list.sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.getTime() - b.createdAt.getTime());
    for (const item of list) sort(item.children);
  };
  sort(roots);
  return roots;
}

function createsCycle(
  node: StrategyTreeNode,
  parent: StrategyTreeNode,
  byId: Map<string, StrategyTreeNode>,
): boolean {
  let cursor: StrategyTreeNode | undefined = parent;
  let guard = 0;
  while (cursor && guard < 1000) {
    if (cursor.id === node.id) return true;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    guard += 1;
  }
  return guard >= 1000;
}

/** Zincir halkalarına göre gruplanmış özet — UI'daki 9 başlık için. */
export function summarizeChain(nodes: readonly StrategyNode[]) {
  const counts = new Map<StrategyNodeType, number>();
  for (const n of nodes) counts.set(n.nodeType, (counts.get(n.nodeType) ?? 0) + 1);
  return STRATEGY_CHAIN.map((link) => ({
    link: link.key,
    order: link.order,
    label: link.label,
    nodeType: link.nodeType,
    nodeCount: counts.get(link.nodeType) ?? 0,
  }));
}

/** Ağacın LLM'e verilecek düz metin özeti (yeniden üretim bağlamı). */
export function treeToText(nodes: readonly StrategyNode[], maxNodes = 60): string {
  if (nodes.length === 0) return "(strateji ağacı boş)";
  const ordered = [...nodes]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .slice(0, maxNodes);
  return ordered
    .map((n) => {
      const strength = n.strength ? ` [güç ${n.strength}/5]` : "";
      const ref = n.sourceRef ? ` (kaynak: ${n.sourceRef})` : "";
      return `- ${NODE_TYPE_LABELS[n.nodeType]}${strength}: ${n.content}${ref}`;
    })
    .join("\n");
}

/**
 * Ağacın İÇERİK PARMAK İZİ.
 *
 * NEDEN: "yayınlanmamış elle değişiklik var mı?" sorusu zaman damgasıyla
 * cevaplanamaz — AI koşusu önce sürümü dondurur, sonra düğümleri yazar, bu
 * yüzden düğümler DAİMA sürümden birkaç milisaniye yenidir ve zaman
 * karşılaştırması her koşudan sonra yanlışlıkla "değişiklik var" derdi.
 * Parmak izi düğümlerin İÇERİĞİNE bakar: sıra, kimlik ve zaman etkisizdir.
 */
export function fingerprintNodes(
  items: readonly {
    nodeType: StrategyNodeType;
    content: string;
    strength: number | null;
    sourceRef: string | null;
  }[],
): string {
  const lines = items
    .map((n) => `${n.nodeType}|${n.content.trim()}|${n.strength ?? ""}|${n.sourceRef ?? ""}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

/** Halka anahtarını DB düğüm türüne çevirir. */
export function nodeTypeOfLink(link: StrategyChainKey): StrategyNodeType {
  return CHAIN_BY_KEY[link].nodeType;
}
