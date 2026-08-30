/**
 * PETITION_DRAFT — Dilekçe Taslağı.
 *
 * Halüsinasyon savunması burada en kritiktir: uydurma esas/karar numarası
 * içeren bir dilekçenin mahkemeye gitmesi geri dönüşü olmayan güven kaybıdır.
 * Bu yüzden emsal atfı YALNIZCA bağlamdaki "onaylı emsaller" listesinden
 * yapılabilir; liste yetersizse model numara uydurmak yerine
 * [EMSAL ÖNERİSİ: ...] işaretçisi bırakır.
 */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

/** Metne bırakılan, UI'da sarı rozetle gösterilen emsal boşluğu işaretçisi. */
export const PRECEDENT_PLACEHOLDER_PREFIX = "[EMSAL ÖNERİSİ:";

/** Metindeki [EMSAL ÖNERİSİ: ...] işaretçilerini çıkarır. */
export function extractPrecedentPlaceholders(text: string): string[] {
  const out: string[] = [];
  const re = /\[EMSAL ÖNERİSİ:\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

export const PETITION_DRAFT_SYSTEM = `Sen Türk hukukunda deneyimli bir avukatın dilekçe kalemisin. Görevin, verilen dosya bağlamından ve bölüm iskeletinden dilekçe TASLAĞI üretmek.

KURALLAR:
1. OLGU UYDURMA. Yalnızca sana verilen bağlamdaki taraf, olay, tarih, tutar ve delilleri kullan. Bağlamda olmayan bir olayı yazma; eksik kalan yeri missingContextNotes'a not düş ve metinde "[BAĞLAMDA EKSİK: ...]" işaretçisi bırak.
2. EMSAL ATFI — EN SIKI KURAL. İçtihat künyesini (esas/karar no) YALNIZCA bağlamdaki "ONAYLI EMSALLER" listesinden alabilirsin. Listede uygun karar yoksa numara UYDURMA; metne şu işaretçiyi bırak: "${PRECEDENT_PLACEHOLDER_PREFIX} ... konusunda emsal karar aranmalı]" ve aynı ifadeyi precedentSuggestions dizisine ekle. Hafızandan "muhtemelen böyle bir karar vardır" diyerek künye üretmek yasaktır; ürettiğin her künye Teyit Ajanı'ndan geçecek, doğrulanamayan atıf dilekçeyi HAZIR statüsüne geçmekten bloklayacaktır.
3. MEVZUAT ATFI. Madde numarasını yalnızca emin olduğun ve bağlamda/şablonda geçen hükümler için yaz. Emin değilsen madde numarası vermeden hükmün adını yaz ("İş Kanunu'nun geçerli fesih nedenlerine ilişkin hükümleri").
4. İSKELETE SADIK KAL. Çıktıyı verilen bölüm iskeletindeki key ve sıra ile üret; bölüm ekleme/çıkarma.
5. ÜSLUP. Resmî dilekçe Türkçesi: "Sayın Mahkemenize", "arz ve talep ederiz". Şablonun style_note'u varsa ona uy. Abartılı sıfatlardan ve karşı tarafa yönelik kişisel ifadelerden kaçın.
6. SONUÇ VE İSTEM bölümünü taleplerle SINIRLI ve numaralı yaz; bağlamdaki taleplerin dışına çıkma.
7. citations dizisine metinde geçen TÜM içtihat ve mevzuat atıflarını normalize ederek koy (teyit hattı bu listeyi kullanır).
8. Bu bir TASLAKTIR; nihai sorumluluk avukattadır. Hiçbir cümlede mahkeme kararının sonucunu garanti etme.

ÇIKTI — yalnızca şu JSON:
{"sections":[{"key":"...","title":"...","content":"...","origin":"AI"}],"citations":[{"kind":"ICTIHAT|MEVZUAT","raw":"...","source":"YARGITAY","esasNo":"2023/4512","kararNo":"2023/9981"}],"precedentSuggestions":["..."],"missingContextNotes":["..."]}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DİLEKÇE TİPİ: CEVAP
BÖLÜM İSKELETİ: ["baslik_taraflar","davaya_cevaplarimiz","hukuki_sebepler","deliller","sonuc_ve_istem"]
ÜSLUP NOTU: Resmî, kısa cümleli büro üslubu.
ONAYLI EMSALLER: (bu dosyaya bağlı onaylı emsal bulunmamaktadır)
DOSYA BAĞLAMI:
[DOSYA] İstanbul 12. İş Mahkemesi 2026/145 · İşe iade istemi
[TARAF] Davacı: A.Y. · Davalı (müvekkil): XYZ Lojistik A.Ş.
[OLAY] 12.01.2026 fesih bildirimi; performans gerekçesi gösterilmiştir.
[DELİL] Fesih bildirimi, performans değerlendirme formları, SGK kayıtları.`,
  },
  {
    role: "assistant",
    content: `{"sections":[{"key":"baslik_taraflar","title":"BAŞLIK / TARAFLAR","content":"İSTANBUL 12. İŞ MAHKEMESİ SAYIN HAKİMLİĞİ'NE\\n\\nDOSYA NO: 2026/145 E.\\nDAVALI: XYZ Lojistik A.Ş.\\nDAVACI: A.Y.\\nKONU: Davaya cevaplarımızın sunulmasıdır.","origin":"AI"},{"key":"davaya_cevaplarimiz","title":"DAVAYA CEVAPLARIMIZ","content":"Davacının iş sözleşmesi, 12.01.2026 tarihli fesih bildirimiyle ve performans yetersizliği gerekçesiyle feshedilmiştir. Fesih, dosyaya sunulan performans değerlendirme formlarıyla belgelenmiştir. Davacının aksi yöndeki iddiaları dosya kapsamıyla bağdaşmamaktadır.","origin":"AI"},{"key":"hukuki_sebepler","title":"HUKUKİ SEBEPLER","content":"İş Kanunu'nun geçerli nedenle fesih ve ispat yüküne ilişkin hükümleri ile ilgili sair mevzuat. ${PRECEDENT_PLACEHOLDER_PREFIX} performansa dayalı geçerli fesihte savunma alınması ve objektif ölçüt kullanımı konusunda Yargıtay 9. HD emsali aranmalı]","origin":"AI"},{"key":"deliller","title":"DELİLLER","content":"1- 12.01.2026 tarihli fesih bildirimi\\n2- Performans değerlendirme formları\\n3- SGK hizmet dökümü\\n4- Sair yasal deliller","origin":"AI"},{"key":"sonuc_ve_istem","title":"SONUÇ VE İSTEM","content":"Yukarıda arz edilen nedenlerle;\\n1- Haksız ve dayanaksız davanın REDDİNE,\\n2- Yargılama giderleri ile vekâlet ücretinin davacı üzerinde bırakılmasına,\\nkarar verilmesini Sayın Mahkemenizden saygıyla arz ve talep ederiz.","origin":"AI"}],"citations":[],"precedentSuggestions":["Performansa dayalı geçerli fesihte savunma alınması ve objektif ölçüt kullanımı konusunda Yargıtay 9. HD emsali aranmalı"],"missingContextNotes":["Davacının savunmasının alınıp alınmadığına dair belge bağlamda yok; fesih usulü bölümü bu belge eklendikten sonra güçlendirilmelidir."]}`,
  },
];

export const petitionDraftPrompt: PromptSpec = {
  taskType: "PETITION_DRAFT",
  name: "Dilekçe Taslağı",
  system: PETITION_DRAFT_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface PetitionDraftPromptInput {
  petitionType: string;
  /** Şablon bölüm anahtarları (sıra korunur). */
  sectionSkeleton: readonly string[];
  styleNote?: string;
  /** Dosyaya bağlı, statüsü ACCEPTED olan emsaller. Boşsa model künye uyduramaz. */
  approvedPrecedents?: readonly string[];
  caseContextText: string;
}

export function buildPetitionDraftMessages(input: PetitionDraftPromptInput): LlmMessage[] {
  const precedents =
    input.approvedPrecedents && input.approvedPrecedents.length > 0
      ? input.approvedPrecedents.map((p) => `- ${p}`).join("\n")
      : "(bu dosyaya bağlı onaylı emsal bulunmamaktadır)";

  const parts = [
    `DİLEKÇE TİPİ: ${input.petitionType}`,
    `BÖLÜM İSKELETİ: ${JSON.stringify(input.sectionSkeleton)}`,
    input.styleNote ? `ÜSLUP NOTU: ${input.styleNote}` : undefined,
    `ONAYLI EMSALLER:\n${precedents}`,
    `DOSYA BAĞLAMI:\n${input.caseContextText}`,
  ].filter((v): v is string => Boolean(v));

  return buildMessages(petitionDraftPrompt, parts.join("\n"));
}
