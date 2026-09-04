/**
 * HEPO UYUM RAPORU (Modül 28 Faz 4) — müvekkil İSG/çevre/sağlık uyum fotoğrafı.
 *
 * DÖNEM YORUMU: bu bir ANLIK FOTOĞRAF raporudur. Referans an, dönemin SON
 * GÜNÜDÜR (`params.period.to`): "31.12.2026 itibarıyla uyum durumu". Dönem
 * içi değişim ölçülmez — HepoClientObligation geçmiş durumu tutmaz, bu
 * yüzden "dönem içinde kaç yükümlülük uyumlu hâle geldi" sorusu bu şemadan
 * DETERMİNİSTİK olarak üretilemez ve UYDURULMAZ.
 *
 * VADESİ GEÇMİŞ: dueDate < referans gün VE durum UYGUN değil. Yükümlülüğün
 * periyodik olması (yıllık eğitim gibi) "geç" sayılmayı değiştirmez: vadesi
 * geçmiş ve uyumlu işaretlenmemiş kayıt geç sayılır.
 */

import {
  countMetric,
  finishTable,
  intOf,
  ratioPercent,
  truncationWarning,
} from "../report-helpers";
import type { ReportBody, ReportBuilder, ReportCell, ReportTable } from "../report-types";

interface HepoRow {
  id: string;
  status: string;
  dueDate: Date | null;
  obligation: { topic: string; title: string; legalBasis: string };
  client: { id: string; name: string };
}

const DAY_MS = 86_400_000;

export const hepoUyumReport: ReportBuilder = async (ctx): Promise<ReportBody> => {
  const { user, prisma, params } = ctx;
  const tenantId = user.tenantId;
  const db = prisma.client;
  const referenceDay = params.period.to;

  const rows = (await db.hepoClientObligation.findMany({
    where: {
      tenantId,
      ...(params.clientId ? { clientId: params.clientId } : {}),
    },
    select: {
      id: true,
      status: true,
      dueDate: true,
      obligation: { select: { topic: true, title: true, legalBasis: true } },
      client: { select: { id: true, name: true } },
    },
    orderBy: { dueDate: "asc" },
  })) as HepoRow[];

  const withLate = rows.map((r) => ({
    ...r,
    late: r.dueDate !== null && r.dueDate.getTime() < referenceDay.getTime() && r.status !== "UYGUN",
  }));

  const total = withLate.length;
  const countBy = (status: string) => withLate.filter((r) => r.status === status).length;
  const uyumlu = countBy("UYGUN");
  const ihlal = countBy("IHLAL");
  const gecen = withLate.filter((r) => r.late).length;

  // ---- Müvekkil kırılımı -----------------------------------------------
  const byClient = new Map<string, { ad: string; uyumlu: number; acik: number; uygunDegil: number; ihlal: number; gecen: number }>();
  for (const r of withLate) {
    const cur =
      byClient.get(r.client.id) ??
      { ad: r.client.name, uyumlu: 0, acik: 0, uygunDegil: 0, ihlal: 0, gecen: 0 };
    if (r.status === "UYGUN") cur.uyumlu += 1;
    else if (r.status === "ACIK") cur.acik += 1;
    else if (r.status === "UYGUN_DEGIL") cur.uygunDegil += 1;
    else if (r.status === "IHLAL") cur.ihlal += 1;
    if (r.late) cur.gecen += 1;
    byClient.set(r.client.id, cur);
  }

  const clientTable = finishTable(
    {
      key: "muvekkil",
      title: "Müvekkil kırılımı",
      definition:
        "Referans günü itibarıyla her müvekkile atanmış yükümlülüklerin durum dağılımı. " +
        "Uyum oranı payda UYGUN durumuyla hesaplanır.",
      columns: [
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "toplam", label: "Yükümlülük", type: "number" },
        { key: "uyumlu", label: "Uyumlu", type: "number" },
        { key: "acik", label: "Açık", type: "number" },
        { key: "uygunDegil", label: "Uygun değil", type: "number" },
        { key: "ihlal", label: "İhlal", type: "number" },
        { key: "gecen", label: "Vadesi geçen", type: "number" },
        { key: "uyumOrani", label: "Uyum oranı (%)", type: "percent" },
      ],
    },
    [...byClient.entries()]
      .map(([id, c]) => ({
        // Adaş müvekkiller kimlik parçasıyla ayrılır (avukat kırılımıyla aynı kural).
        muvekkil:
          [...byClient.values()].filter((x) => x.ad === c.ad).length > 1
            ? `${c.ad} [${id.slice(0, 8)}]`
            : c.ad,
        toplam: c.uyumlu + c.acik + c.uygunDegil + c.ihlal,
        uyumlu: c.uyumlu,
        acik: c.acik,
        uygunDegil: c.uygunDegil,
        ihlal: c.ihlal,
        gecen: c.gecen,
        uyumOrani: ratioPercent(c.uyumlu, c.uyumlu + c.acik + c.uygunDegil + c.ihlal),
      }))
      .sort((a, b) => intOf(b.gecen) - intOf(a.gecen) || intOf(b.toplam) - intOf(a.toplam)),
    params.limit,
  );

  // ---- Konu (ISG/ÇEVRE/SAĞLIK) kırılımı ---------------------------------
  const TOPIC_LABELS: Record<string, string> = {
    ISG: "İş Sağlığı ve Güvenliği",
    CEVRE: "Çevre",
    SAGLIK: "Sağlık Hukuku",
  };
  const byTopic = new Map<string, { toplam: number; uyumlu: number; gecen: number }>();
  for (const r of withLate) {
    const cur = byTopic.get(r.obligation.topic) ?? { toplam: 0, uyumlu: 0, gecen: 0 };
    cur.toplam += 1;
    if (r.status === "UYGUN") cur.uyumlu += 1;
    if (r.late) cur.gecen += 1;
    byTopic.set(r.obligation.topic, cur);
  }

  const topicTable: ReportTable = finishTable(
    {
      key: "konu",
      title: "Konu kırılımı",
      definition: "Yükümlülüğün katalog konusuna göre (İSG / Çevre / Sağlık).",
      columns: [
        { key: "konu", label: "Konu", type: "text" },
        { key: "toplam", label: "Yükümlülük", type: "number" },
        { key: "uyumlu", label: "Uygun", type: "number" },
        { key: "gecen", label: "Vadesi geçen", type: "number" },
        { key: "uyumOrani", label: "Uyum oranı (%)", type: "percent" },
      ],
    },
    [...byTopic.entries()].map(([topic, c]) => ({
      konu: TOPIC_LABELS[topic] ?? topic,
      toplam: c.toplam,
      uyumlu: c.uyumlu,
      gecen: c.gecen,
      uyumOrani: ratioPercent(c.uyumlu, c.toplam),
    })),
    params.limit,
  );

  // ---- Vadesi geçenler (detay) ------------------------------------------
  const overdueRows: Record<string, ReportCell>[] = withLate
    .filter((r) => r.late)
    .map((r) => ({
      muvekkil: r.client.name,
      yukumluluk: r.obligation.title,
      dayanak: r.obligation.legalBasis,
      konu: TOPIC_LABELS[r.obligation.topic] ?? r.obligation.topic,
      durum: r.status,
      vade: (r.dueDate as Date).toISOString().slice(0, 10),
      gecGun: Math.max(
        0,
        Math.floor((referenceDay.getTime() - (r.dueDate as Date).getTime()) / DAY_MS),
      ),
    }));

  const overdueTable = finishTable(
    {
      key: "vadesi-gecen",
      title: "Vadesi geçen yükümlülükler",
      definition:
        "Vadesi referans günü geçmiş ve UYGUN olarak işaretlenmemiş yükümlülükler. " +
        "Periyodik yükümlülüklerde vade, atamada girilen tarihtir.",
      columns: [
        { key: "muvekkil", label: "Müvekkil", type: "text" },
        { key: "yukumluluk", label: "Yükümlülük", type: "text" },
        { key: "dayanak", label: "Dayanak", type: "text" },
        { key: "konu", label: "Konu", type: "text" },
        { key: "durum", label: "Durum", type: "text" },
        { key: "vade", label: "Vade", type: "date" },
        { key: "gecGun", label: "Gecikme (gün)", type: "number" },
      ],
    },
    overdueRows,
    params.limit,
  );

  const metrics = [
    countMetric("toplam", "Atanan yükümlülük", total, undefined),
    countMetric("uyumlu", "Uyumlu (UYGUN)", uyumlu, undefined, { higherIsBetter: true }),
    countMetric("gecen", "Vadesi geçen", gecen, undefined, { higherIsBetter: false, critical: true }),
    countMetric("ihlal", "İhlal", ihlal, undefined, { higherIsBetter: false, critical: true }),
  ];

  const warnings: string[] = [];
  for (const t of [clientTable, topicTable, overdueTable]) {
    const w = truncationWarning(t);
    if (w) warnings.push(w);
  }

  return { metrics, tables: [clientTable, topicTable, overdueTable], warnings };
};
