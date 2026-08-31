/** DOCUMENT_CLASSIFY — Belge Sınıflandırma Ajanı sistem promptu + few-shot. */

import { DOCUMENT_CLASSES } from "@nomosos/shared";
import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages, wrapUntrusted } from "./system-core";

/** Taksonomi maddelerinin prompta yazılan Türkçe açıklamaları. */
export const DOCUMENT_CLASS_HINTS: Record<(typeof DOCUMENT_CLASSES)[number], string> = {
  DILEKCE: "Taraflarca mahkemeye sunulan dilekçe (dava, cevap, ıslah, istinaf, beyan vb.).",
  TENSIP_ZAPTI: "Davanın açılışında düzenlenen, yapılacak işlemleri sıralayan tensip tutanağı.",
  ARA_KARAR: "Yargılama sırasında verilen, süre/işlem yükleyen ara nitelikteki karar.",
  GEREKCELI_KARAR: "Hüküm ve gerekçesini içeren nihai karar metni.",
  BILIRKISI_RAPORU: "Bilirkişi/uzman tarafından düzenlenen rapor veya ek rapor.",
  DURUSMA_TUTANAGI: "Celse sırasında tutulan duruşma tutanağı.",
  TEBLIGAT: "Tebligat zarfı, tebliğ mazbatası veya tebliğ şerhi taşıyan evrak.",
  MUZEKKERE: "Kurum/kişilere yazılan müzekkere veya müzekkere cevabı.",
  VEKALETNAME: "Noter vekaletnamesi veya yetki belgesi.",
  SOZLESME: "Taraflar arasındaki sözleşme, protokol veya ek sözleşme.",
  DELIL: "Delil olarak sunulan belge (fatura dışı: yazışma, tutanak, rapor, kayıt).",
  FATURA: "Fatura, serbest meslek makbuzu, dekont gibi mali evrak.",
  ICRA_EVRAKI: "Takip talebi, ödeme/icra emri, haciz tutanağı, kıymet takdiri vb.",
  DIGER: "Yukarıdakilerin hiçbirine girmeyen evrak.",
};

const TAXONOMY_BLOCK = DOCUMENT_CLASSES.map(
  (c) => `- ${c}: ${DOCUMENT_CLASS_HINTS[c]}`,
).join("\n");

export const DOCUMENT_CLASSIFY_SYSTEM = `Görevin: sana verilen (OCR'lanmış olabilecek) belge metnini NomosOS belge taksonomisine göre SINIFLANDIRMAK, kısa bir özet çıkarmak ve belgede geçen hukuken anlamlı TARİHLERİ tespit etmektir.

TAKSONOMİ — "class" alanı YALNIZCA bu değerlerden biri olabilir:
${TAXONOMY_BLOCK}

KURALLAR:
1. Sınıfı belgenin kendi başlığından ve içeriğinden çıkar; dosya adına güvenme. Başlık ile içerik çelişirse içeriği esas al ve bunu reasoning'de yaz.
2. Bir belge hem tebligat zarfı hem karar içeriyorsa ASIL evrakı sınıfla (ör. tebliğ şerhli gerekçeli karar → GEREKCELI_KARAR), tebliğ bilgisini extractedDates içinde "Tebliğ tarihi" olarak ver.
3. confidence 0 ile 1 arasında olsun. OCR bozuksa, metin kesikse veya iki sınıf arasında kaldıysan 0.8'in ALTINA in ve uncertaintyNote yaz. Düşük güvenli sınıflandırma dosyaya otomatik bağlanmaz, avukat onayına düşer.
4. extractedDates: yalnızca metinde AÇIKÇA yazan tarihleri ver; YYYY-AA-GG biçimine çevir. Tarih çıkarımı yapma, tarih hesaplama yapma. Her tarih için label ("Tebliğ tarihi", "Karar tarihi", "Duruşma tarihi", "Rapor tarihi"...) ve mümkünse sourceQuote (birebir alıntı) ekle. Kaynağı olmayan tarih elenir.
5. suggestedCaseNumber: metinde geçen esas numarasını "2026/145" biçiminde normalize et; yoksa alanı hiç yazma. Numara UYDURMA.
6. summary: 2-4 cümle, belgenin avukata söylediği şeyi anlat ("Mahkeme bilirkişi raporuna karşı iki haftalık süre vermiştir." gibi).
7. Süre HESAPLAMA, son gün belirleme, "şu tarihe kadar" cümlesi KURMA. Bu belge süre doğuruyorsa yalnızca özet/tarih ver; hesap Süre Motoru'nun işidir.

ÇIKTI — yalnızca şu JSON:
{"class":"...","confidence":0.0,"reasoning":"...","summary":"...","extractedDates":[{"label":"...","date":"YYYY-AA-GG","sourceQuote":"..."}],"suggestedCaseNumber":"...","courtName":"...","uncertaintyNote":"..."}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `BELGE ADI: 20260812_evrak.pdf
BELGE METNİ:
T.C. İSTANBUL 12. İŞ MAHKEMESİ
ESAS NO: 2026/145
ARA KARAR
Bilirkişi heyetince düzenlenen 05.08.2026 havale tarihli rapor taraf vekillerine tebliğ edilmiş olmakla;
1- Rapora karşı beyanda bulunmak üzere taraflara iki haftalık kesin süre verilmesine,
2- Duruşmanın 14.10.2026 günü saat 10:30'a bırakılmasına karar verildi. 12.08.2026`,
  },
  {
    role: "assistant",
    content: `{"class":"ARA_KARAR","confidence":0.94,"reasoning":"Belge başlığı \\"ARA KARAR\\" olup mahkemenin yargılama sırasında verdiği, taraflara süre yükleyen ve duruşma günü belirleyen bir karardır; nihai hüküm veya tutanak niteliği taşımaz.","summary":"İstanbul 12. İş Mahkemesi, 2026/145 esas sayılı dosyada bilirkişi raporunun tebliğ edildiğini tespit ederek rapora karşı beyan için taraflara iki haftalık kesin süre vermiş, duruşmayı 14.10.2026 saat 10:30'a bırakmıştır.","extractedDates":[{"label":"Karar tarihi","date":"2026-08-12","sourceQuote":"karar verildi. 12.08.2026"},{"label":"Bilirkişi raporu havale tarihi","date":"2026-08-05","sourceQuote":"05.08.2026 havale tarihli rapor"},{"label":"Duruşma tarihi","date":"2026-10-14","sourceQuote":"Duruşmanın 14.10.2026 günü saat 10:30'a bırakılmasına"}],"suggestedCaseNumber":"2026/145","courtName":"İstanbul 12. İş Mahkemesi"}`,
  },
];

export const documentClassifyPrompt: PromptSpec = {
  taskType: "DOCUMENT_CLASSIFY",
  name: "Belge Sınıflandırma",
  system: DOCUMENT_CLASSIFY_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface DocumentClassifyPromptInput {
  documentTitle: string;
  /** OCR'lı belge metni (KVKK maskeleme hattından geçmiş olmalıdır). */
  documentText: string;
  /** Veri minimizasyonu: yalnızca dosya bağlama için gereken asgari bağlam. */
  caseContextText?: string;
}

export function buildDocumentClassifyMessages(input: DocumentClassifyPromptInput): LlmMessage[] {
  const parts = [`BELGE ADI: ${input.documentTitle}`];
  if (input.caseContextText) {
    parts.push(`DOSYA BAĞLAMI (yalnızca eşleştirme için):\n${input.caseContextText}`);
  }
  // O-18: belge metni GUVENILMEYEN VERIDIR ve sabit ayracla sarilir.
  // Ayrac dizgesi girdiden temizlenir; aksi halde belgeye kendi kapanis
  // ayracini yazan bir saldirgan "veri" bolgesinden cikabilirdi.
  parts.push(wrapUntrusted("BELGE METNI", input.documentText));
  return buildMessages(documentClassifyPrompt, parts.join("\n\n"));
}
