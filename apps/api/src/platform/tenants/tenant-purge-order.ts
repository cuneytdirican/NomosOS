/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ VERİ İMHASI SİLME SIRASI — denetim bulgusu Ö-28 (spec dört-göz madde 1)  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Bir kiracının verisini kalıcı olarak silmek, tabloları RASTGELE sırayla
 * silmekle olmaz: yabancı anahtarlar çocuğu ebeveynden önce silmeyi zorunlu
 * kılar (Case → Client, Document → Case …). Prisma şemasında bu ilişkilerde
 * `onDelete: Cascade` YOKTUR; sıra yanlışsa transaction FK ihlaliyle düşer.
 *
 * Burası SAF topolojik sıralamadır: kenar `bagimli → bagimsiz` yönündedir
 * (A, B'ye FK ile bağlıysa A önce silinir). Döngü varsa (kendine referans veya
 * karşılıklı FK) kalan tablolar sonda, deterministik alfabetik sırada döner —
 * çağıran onları da dener ve hata alırsa transaction geri sarılır. Böylece
 * "yarım silinmiş kiracı" durumu OLUŞAMAZ.
 *
 * Sıra çalışma zamanında Postgres'in kendi FK kataloğundan okunur; kod bir
 * tablo listesini elle taşımaz (taşısaydı yeni bir migration onu bayatlatırdı).
 */
export interface ForeignKeyEdge {
  /** FK'yi TAŞIYAN tablo (çocuk) — önce silinir. */
  dependent: string;
  /** Referans verilen tablo (ebeveyn) — sonra silinir. */
  referenced: string;
}

/**
 * Kahn algoritması. Dönüş: silinme sırası (önce çocuklar).
 * Aynı seviyedeki tablolar alfabetik sıralanır — koşumlar arası determinizm.
 */
export function topologicalDeleteOrder(
  tables: readonly string[],
  edges: readonly ForeignKeyEdge[]
): string[] {
  const known = new Set(tables);
  /** Bir tablonun kaç BAĞIMLISI (çocuğu) kaldı — 0 olunca silinebilir. */
  const dependents = new Map<string, Set<string>>();
  for (const table of tables) dependents.set(table, new Set());

  for (const edge of edges) {
    if (!known.has(edge.dependent) || !known.has(edge.referenced)) continue;
    // Kendine referans (ör. parentId) sıralamayı etkilemez: aynı tabloyu
    // tek DELETE ifadesi zaten toptan siler.
    if (edge.dependent === edge.referenced) continue;
    dependents.get(edge.referenced)!.add(edge.dependent);
  }

  const order: string[] = [];
  const removed = new Set<string>();

  for (;;) {
    const ready = [...known]
      .filter((t) => !removed.has(t))
      .filter((t) => [...dependents.get(t)!].every((d) => removed.has(d)))
      .sort();
    if (ready.length === 0) break;
    for (const table of ready) {
      order.push(table);
      removed.add(table);
    }
  }

  // Döngüye takılan tablolar sona, alfabetik.
  const stuck = [...known].filter((t) => !removed.has(t)).sort();
  return [...order, ...stuck];
}
