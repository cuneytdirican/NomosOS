/**
 * STRATEJİ ZİNCİRİ — 9 halka (Modül 15).
 *
 * Zincir spec'te şöyledir:
 *   karşı taraf argümanları → bizim argümanlarımız → deliller → hukuki dayanak →
 *   zayıf noktalar → karşı tarafın bunlara karşı kullanabileceği argümanlar →
 *   bizim cevaplarımız → alternatif senaryolar → risk özeti
 *
 * NEDEN YEREL ŞEMA (ortak karar 4)?
 * `@nomosos/legal-ai`'deki `StrategyBuildOutputSchema` düğüm türlerini
 * HEDEF/ARGUMAN/DAYANAK/RISK/AKSIYON olarak tanımlar; bu küme ne 9 halkalı
 * zinciri ne de veritabanındaki `StrategyNodeType` enum'unu karşılar. Şema
 * ile DB enum'u ayrışırsa düğümler kaydedilirken "en yakın türe" eşlenir ve
 * zincirin hangi halkasından geldiği kaybolur. Bu yüzden ÇIKTI ŞEMASI burada,
 * DB sözleşmesiyle birebir tanımlanır.
 *
 * PROMPT YİNE legal-ai'DENDİR: mesajlar `strategyBuildPrompt` (PromptSpec)
 * üzerinden `buildMessages` ile kurulur; böylece NOMOSOS_SYSTEM_CORE_PROMPT
 * (uydurma yasağı, kaynak zorunluluğu, atıf disiplini, "çıktı öneridir")
 * her çağrının başında durur. Ham prompt YAZILMAZ; yalnızca çıktı sözleşmesini
 * anlatan bir `systemSuffix` eklenir. Paketteki few-shot örneği eski düğüm
 * türlerini öğrettiği için bilinçli olarak DEVRE DIŞI bırakılır ve yerine
 * zincire uygun kompakt bir örnek eklenir.
 */

import { z } from "zod";
import type { StrategyNodeType } from "@nomosos/db";
import { buildMessages, strategyBuildPrompt, type LlmMessage } from "@nomosos/legal-ai";

/** Zincirin halka anahtarları — çıktı şemasının `link` alanı bu kümedendir. */
export const STRATEGY_CHAIN_KEYS = [
  "KARSI_ARGUMAN",
  "BIZIM_ARGUMAN",
  "DELIL",
  "HUKUKI_DAYANAK",
  "ZAYIF_NOKTA",
  "KARSI_TARAFIN_KULLANACAGI",
  "BIZIM_CEVABIMIZ",
  "ALTERNATIF_SENARYO",
  "RISK_OZETI",
] as const;

export type StrategyChainKey = (typeof STRATEGY_CHAIN_KEYS)[number];

export interface StrategyChainLink {
  key: StrategyChainKey;
  /** Zincirdeki sıra (1-9) — düğüm sıralaması ve UI grup başlıkları bunu kullanır. */
  order: number;
  label: string;
  /** Veritabanı düğüm türü. */
  nodeType: StrategyNodeType;
  /** Modele verilen tanım. */
  description: string;
  /**
   * Bu halkanın düğümleri hangi halkanın altına asılır? (`parentKey` boşsa
   * sunucu bu halkayı kullanarak ağacı toparlar.)
   */
  parentLink?: StrategyChainKey;
}

/**
 * Halka 1 ve 6'nın DB türü aynıdır (`KARSI_ARGUMAN`) — ikisi de karşı tarafın
 * argümanıdır. Ayrım ağaçtaki YERİDİR: 1 kökte durur, 6 bir ZAYIF_NOKTA
 * düğümünün altındadır. Bu yüzden zincir halkası `link`, DB türü `nodeType`
 * olarak AYRI tutulur; halka bilgisi `StrategyVersion.treeJson` içinde saklanır.
 */
export const STRATEGY_CHAIN: readonly StrategyChainLink[] = [
  {
    key: "KARSI_ARGUMAN",
    order: 1,
    label: "Karşı tarafın argümanları",
    nodeType: "KARSI_ARGUMAN",
    description:
      "Karşı tarafın dosyada ileri sürdüğü veya sürebileceği iddialar. Her biri dilekçe/beyan/safahat kaydına dayanmalıdır.",
  },
  {
    key: "BIZIM_ARGUMAN",
    order: 2,
    label: "Bizim argümanlarımız",
    nodeType: "BIZIM_ARGUMAN",
    description:
      "Karşı tarafın iddiasına cevap veren veya kendi talebimizi taşıyan hukuki iddialarımız. `parentKey` ile cevap verdiği karşı argümana bağlanır.",
    parentLink: "KARSI_ARGUMAN",
  },
  {
    key: "DELIL",
    order: 3,
    label: "Deliller",
    nodeType: "DELIL",
    description:
      "Argümanı taşıyan somut delil (belge, tanık, bilirkişi, keşif). Dosyada BULUNMAYAN delil uydurulamaz; eksikse bunu zayıf nokta olarak yaz.",
    parentLink: "BIZIM_ARGUMAN",
  },
  {
    key: "HUKUKI_DAYANAK",
    order: 4,
    label: "Hukuki dayanak",
    nodeType: "HUKUKI_DAYANAK",
    description:
      "Argümanın mevzuat/içtihat dayanağı. İçtihat künyesi YALNIZCA bağlamda verilen onaylı emsallerden alınır.",
    parentLink: "BIZIM_ARGUMAN",
  },
  {
    key: "ZAYIF_NOKTA",
    order: 5,
    label: "Zayıf noktalarımız",
    nodeType: "ZAYIF_NOKTA",
    description:
      "Kendi konumumuzun açıkları: eksik delil, tartışmalı tarih, usulî risk. Tek taraflı iyimser ağaç kurma.",
    parentLink: "BIZIM_ARGUMAN",
  },
  {
    key: "KARSI_TARAFIN_KULLANACAGI",
    order: 6,
    label: "Karşı tarafın bu zayıflığa karşı kullanabileceği argüman",
    nodeType: "KARSI_ARGUMAN",
    description:
      "Zayıf noktamızı gören karşı vekilin kuracağı argüman. `parentKey` ilgili ZAYIF_NOKTA düğümüdür.",
    parentLink: "ZAYIF_NOKTA",
  },
  {
    key: "BIZIM_CEVABIMIZ",
    order: 7,
    label: "Bizim cevabımız",
    nodeType: "KARSI_CEVAP",
    description:
      "6. halkadaki argümana karşı verilecek somut cevap. Dosyada dayanak yoksa 'dayanak yok, delil toplanmalı' de.",
    parentLink: "KARSI_TARAFIN_KULLANACAGI",
  },
  {
    key: "ALTERNATIF_SENARYO",
    order: 8,
    label: "Alternatif senaryolar",
    nodeType: "SENARYO",
    description:
      "Sulh, arabuluculuk ve davaya devam seçenekleri; her biri için dosyadaki verilerden çıkan somut sonuç ve maliyet beklentisi. Rakam UYDURMA; dosyada tutar yoksa 'tutar dosyada yok' yaz.",
  },
  {
    key: "RISK_OZETI",
    order: 9,
    label: "Risk özeti",
    nodeType: "RISK",
    description:
      "Stratejinin bütününe ilişkin risk tespitleri. Olasılık YÜZDESİ verme, sonuç tahmini yapma; somut zayıflığı tarif et.",
  },
];

export const CHAIN_BY_KEY: Record<StrategyChainKey, StrategyChainLink> = Object.fromEntries(
  STRATEGY_CHAIN.map((l) => [l.key, l]),
) as Record<StrategyChainKey, StrategyChainLink>;

/* ------------------------------------------------------------------ *
 * Çıktı şeması (yerel — ortak karar 4)
 * ------------------------------------------------------------------ */

export const StrategyChainNodeSchema = z.object({
  /** Kararlı, kısa slug: versiyon diff'i bu anahtara dayanır. */
  key: z.string().min(1).max(80),
  /** Üst düğümün `key` değeri. Kök halkalarda boş bırakılır. */
  parentKey: z.string().min(1).max(80).optional(),
  link: z.enum(STRATEGY_CHAIN_KEYS),
  content: z.string().min(1).max(4000),
  /** Argüman gücü 1-5 (1 = çok zayıf). */
  strength: z.number().int().min(1).max(5).optional(),
  /** Dayanak izi: "DOC:<id>" | "CASELAW:<id>" | "MEVZUAT:TBK m.112" | serbest metin. */
  sourceRef: z.string().max(500).optional(),
  /** Metinde geçen ham atıf künyeleri — kayıt üzerinden doğrulanır. */
  citations: z.array(z.string().max(300)).default([]),
});
export type StrategyChainNodeOutput = z.infer<typeof StrategyChainNodeSchema>;

export const StrategyChainOutputSchema = z.object({
  nodes: z.array(StrategyChainNodeSchema).default([]),
  summary: z.string().max(4000).optional(),
});
export type StrategyChainOutput = z.infer<typeof StrategyChainOutputSchema>;

/* ------------------------------------------------------------------ *
 * Mesaj kurulumu
 * ------------------------------------------------------------------ */

const CHAIN_BLOCK = STRATEGY_CHAIN.map(
  (l) => `${l.order}. ${l.key} — ${l.label}: ${l.description}`,
).join("\n");

const CHAIN_SUFFIX = `Bu koşuda ÇIKTI SÖZLEŞMESİ AŞAĞIDAKİDİR ve yukarıdaki genel şemanın YERİNE geçer.

Strateji, DOKUZ HALKALI bir zincirdir. Her düğüm tam olarak bir halkaya aittir:

${CHAIN_BLOCK}

EK KURALLAR:
a) DÜZ LİSTE döndür; hiyerarşiyi \`parentKey\` ile kur (üst düğümün \`key\` değeri). Var olmayan bir anahtara bağlama.
b) \`key\` kısa, kararlı ve benzersiz bir slug olsun (ör. "kt_zamanasimi_defi"). Versiyon karşılaştırması bu anahtara dayanır.
c) DOKUZ HALKANIN HEPSİNDE en az bir düğüm bulunmalıdır. Bir halka için dosyada veri yoksa o halkada tek bir düğüm üret ve içeriğine AÇIKÇA "Bağlamda bu halkayı dolduracak veri yok" yaz — halkayı boş bırakma, veri uydurma.
d) HER DÜĞÜMDE kaynak zorunludur: \`sourceRef\` (ör. "DOC:<belge id>" veya "Cevap Dilekçesi s.3") ya da \`citations\`. Kaynaksız düğümler sunucuda ELENİR ve avukata "kaynaksız üretildiği için elendi" olarak gösterilir; kaynaksız yazmak yazmamakla aynıdır.
e) \`citations\` YALNIZCA bağlamdaki ONAYLI EMSALLER listesinden veya belgelerden alınır. Künye UYDURMA — ürettiğin her künye kayıt üzerinden aranacak, bulunamayan "doğrulanmadı" olarak işaretlenecektir.
f) \`strength\` 1-5 arası tam sayıdır ve yalnızca argüman düğümlerinde (2. ve 6. halka) anlamlıdır.
g) Sonuç tahmini, kazanma olasılığı yüzdesi veya garanti verme.

ÇIKTI — yalnızca şu JSON:
{"nodes":[{"key":"kt_zamanasimi","parentKey":null,"link":"KARSI_ARGUMAN","content":"...","strength":4,"sourceRef":"Cevap Dilekçesi s.3","citations":[]}],"summary":"..."}

ÖRNEK (kısaltılmış, iki halka):
{"nodes":[{"key":"kt_zamanasimi","link":"KARSI_ARGUMAN","content":"Davalı, alacağın on yıllık zamanaşımına uğradığını cevap dilekçesinde ileri sürmüştür.","strength":4,"sourceRef":"Cevap Dilekçesi s.3 ¶2","citations":[]},{"key":"biz_islah_kesilme","parentKey":"kt_zamanasimi","link":"BIZIM_ARGUMAN","content":"Zamanaşımı, dava tarihinde kesilmiştir; ıslahla artırılan kısım yönünden ayrıca değerlendirme gerekir.","strength":3,"sourceRef":"Safahat: 02.06.2026 ıslah dilekçesi","citations":[]}],"summary":"..."}`;

export interface StrategyBuildMessagesInput {
  caseContextText: string;
  approvedPrecedents: readonly string[];
  /** Yeniden üretimde mevcut ağacın özeti (diff bağlamı). */
  existingStrategySummary?: string;
  /** Delil matrisi satırları (Claim/Evidence varsa). */
  evidenceLines?: readonly string[];
  /** Avukatın ek yönlendirmesi. */
  instruction?: string;
}

/**
 * Mesaj zinciri — `strategyBuildPrompt` üzerinden, çekirdek sistem promptuyla.
 * Few-shot KAPALI: paketteki örnek eski düğüm türlerini öğretir (bkz. dosya başı).
 */
export function buildStrategyChainMessages(input: StrategyBuildMessagesInput): LlmMessage[] {
  const precedents =
    input.approvedPrecedents.length > 0
      ? input.approvedPrecedents.map((p) => `- ${p}`).join("\n")
      : "(yok — künye uydurma, emsal boşluğunu zayıf nokta olarak yaz)";

  const parts = [
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
    `ONAYLI EMSALLER:\n${precedents}`,
    input.evidenceLines && input.evidenceLines.length > 0
      ? `İDDİA–DELİL MATRİSİ:\n${input.evidenceLines.map((l) => `- ${l}`).join("\n")}`
      : undefined,
    input.existingStrategySummary
      ? `MEVCUT STRATEJİ (yeniden üretiliyor):\n${input.existingStrategySummary}`
      : undefined,
    input.instruction ? `AVUKATIN EK YÖNLENDİRMESİ:\n${input.instruction}` : undefined,
  ].filter((v): v is string => Boolean(v));

  return buildMessages(strategyBuildPrompt, parts.join("\n\n"), {
    includeFewShot: false,
    systemSuffix: CHAIN_SUFFIX,
  });
}
