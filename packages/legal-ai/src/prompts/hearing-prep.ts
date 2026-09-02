/** HEARING_PREP — Duruşma Hazırlık Ajanı: 9 SABİT bölümlü paket. */

import type { LlmMessage, PromptSpec } from "../types";
import { HEARING_PREP_SECTION_KEYS, HEARING_PREP_SECTION_TITLES } from "../schemas";
import { buildMessages } from "./system-core";

const SECTION_BLOCK = HEARING_PREP_SECTION_KEYS.map(
  (k) => `- ${k} — ${HEARING_PREP_SECTION_TITLES[k]}`,
).join("\n");

export const HEARING_PREP_SYSTEM = `Görevin: yarınki/bugünkü duruşma için avukatın adliye koridorunda tek sayfada okuyabileceği bir HAZIRLIK PAKETİ üretmek.

PAKET SÖZLEŞMESİ — 9 bölüm SABİTTİR. Bölüm ekleyemez, çıkaramaz, anahtar adını değiştiremezsin. Kullanıcı arayüzü ve yazdırma şablonu tam olarak bu anahtarlara kodludur:
${SECTION_BLOCK}

KURALLAR:
1. Her bölüm YALNIZCA sana verilen dosya bağlamına dayanır. Bağlamda o bölüm için veri yoksa uydurma: content alanına "Bağlamda bu bölüm için veri bulunmuyor." yaz ve noData=true yap. Boş bölüm dürüsttür, uydurulmuş bölüm tehlikelidir.
2. Her bölümde sourceRefs doldur (belge adı + sayfa/paragraf, safahat kaydı veya süre kaydı). Kaynaksız bölüm içeriği avukata "teyitsiz" olarak gösterilir.
3. case_summary: 5-8 cümle; taraflar, talep, yargılamanın geldiği aşama. Hukuki nitelendirme yaparken temkinli ol.
4. recent_events: son 90 günün gelişmeleri, TERS KRONOLOJİK maddeler; her maddede tarih.
5. missing_evidence: yalnızca bağlamdaki delil listesi ile iddialar arasındaki AÇIK boşlukları yaz; "belki şu da lazımdır" tarzı spekülasyon yapma.
6. questions_to_ask: tanık/bilirkişi bazlı, duruşmada sorulabilecek somut sorular; her soru bir iddiaya veya çelişkiye bağlansın.
7. points_to_raise: usule ve esasa ilişkin, o celsede ileri sürülmesi gereken hususlar (süre tutum, ıslah, zamanaşımı def'i, ara karar talebi vb.) — yalnızca dosyanın verisi destekliyorsa.
8. deadlines: bağlamda verilen AÇIK süre kayıtlarını aktar. Süre HESAPLAMA; kayıtlarda ne yazıyorsa onu yaz.
9. İçtihat/mevzuat atfını yalnızca bağlamda geçiyorsa kullan; künye UYDURMA. Attığın her künye Teyit Ajanı'ndan geçecektir.
10. TARAFSIZLIK. Paket bir "kazanacağız" brifingi değil, duruşmanın GERÇEK manzarasıdır. Karşı tarafın en güçlü argümanını (opponent_last_statement) aynı titizlikle işle; müvekkil aleyhine celsede çıkabilecek bir zayıflık varsa missing_evidence ve points_to_raise bölümlerinde açıkça belirt.
11. Paket bilgilendiricidir; hiçbir bölüm otomatik olarak dilekçeye veya dosya kaydına dönüşmez.

ÇIKTI — yalnızca şu JSON (9 anahtarın hepsi bulunmak zorunda):
{"sections":{"case_summary":{"content":"...","bullets":["..."],"sourceRefs":[{"documentTitle":"...","page":1,"quote":"..."}],"noData":false}, "recent_events":{...}, "opponent_last_statement":{...}, "last_decision":{...}, "missing_evidence":{...}, "questions_to_ask":{...}, "points_to_raise":{...}, "deadlines":{...}, "previous_minutes":{...}}}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `DURUŞMA: 14.10.2026 10:30 · İstanbul 12. İş Mahkemesi · Tip: DURUSMA · Konu: Bilirkişi raporunun değerlendirilmesi
DOSYA BAĞLAMI:
[DOSYA] 2026/145 · İşe iade istemi · Davacı: A.Y. · Davalı: XYZ Lojistik A.Ş.
[SAFAHAT] 2026-08-12 Ara karar: rapora karşı beyan için iki haftalık kesin süre.
[SAFAHAT] 2026-08-26 Davacı vekilince rapora itiraz dilekçesi sunuldu.
[BELGE] Bilirkişi Raporu (05.08.2026) s.7: "feshin geçerli nedene dayandığı ispatlanamamıştır"
[SÜRE] Açık süre yok.
[DELİL] Davalının savunmasına dayanak tutanak dosyaya sunulmamıştır.`,
  },
  {
    role: "assistant",
    content: `{"sections":{"case_summary":{"content":"Dava, davacı A.Y. tarafından davalı XYZ Lojistik A.Ş. aleyhine açılmış işe iade istemli bir iş davasıdır. Yargılama bilirkişi incelemesi aşamasını tamamlamıştır. 05.08.2026 havale tarihli bilirkişi raporunda feshin geçerli nedene dayandığının ispatlanamadığı belirtilmiştir. Rapora karşı davacı vekili 26.08.2026 tarihinde beyanda bulunmuştur. Celse, raporun değerlendirilmesi ve rapora yönelik itirazların karara bağlanması için beklenmektedir.","bullets":[],"sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":7,"quote":"feshin geçerli nedene dayandığı ispatlanamamıştır"}],"noData":false},"recent_events":{"content":"","bullets":["26.08.2026 — Davacı vekilince bilirkişi raporuna itiraz dilekçesi sunuldu.","12.08.2026 — Ara kararla rapora karşı beyan için iki haftalık kesin süre verildi."],"sourceRefs":[{"documentTitle":"Safahat"}],"noData":false},"opponent_last_statement":{"content":"Bağlamda bu bölüm için veri bulunmuyor.","bullets":[],"sourceRefs":[],"noData":true},"last_decision":{"content":"12.08.2026 tarihli ara kararla taraflara bilirkişi raporuna karşı beyan için iki haftalık kesin süre verilmiştir.","bullets":[],"sourceRefs":[{"documentTitle":"Safahat"}],"noData":false},"missing_evidence":{"content":"","bullets":["Davalının fesih savunmasına dayanak gösterdiği tutanak dosyaya sunulmamıştır; celsede sunulması için süre talebine karşı beyanda bulunulabilir."],"sourceRefs":[{"documentTitle":"Delil listesi"}],"noData":false},"questions_to_ask":{"content":"","bullets":["Bilirkişiye: raporun 7. sayfasındaki ispat değerlendirmesi hangi belgelere dayandırılmıştır?","Davalı tanığına: savunmada anılan tutanağın düzenlendiği tarihte olay yerinde bulunup bulunmadığı."],"sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":7}],"noData":false},"points_to_raise":{"content":"","bullets":["Davalının sunmadığı tutanak yönünden ispat yükünün davalıda olduğunun tutanağa geçirilmesi.","Rapordaki ispat değerlendirmesine dayanılarak esas hakkında beyan hakkının saklı tutulması."],"sourceRefs":[{"documentTitle":"Bilirkişi Raporu","page":7}],"noData":false},"deadlines":{"content":"Duruşma günü itibarıyla dosyada açık (onaylanmış) süre kaydı bulunmamaktadır.","bullets":[],"sourceRefs":[{"documentTitle":"Süre kayıtları"}],"noData":false},"previous_minutes":{"content":"Bağlamda önceki celse tutanağı bulunmuyor.","bullets":[],"sourceRefs":[],"noData":true}}}`,
  },
];

export const hearingPrepPrompt: PromptSpec = {
  taskType: "HEARING_PREP",
  name: "Duruşma Hazırlık",
  system: HEARING_PREP_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface HearingPrepPromptInput {
  hearingDate: string;
  courtName: string;
  hearingType?: string;
  purpose?: string;
  /** case-context.ts ile kurulmuş, token bütçesine sığdırılmış bağlam metni. */
  caseContextText: string;
}

export function buildHearingPrepMessages(input: HearingPrepPromptInput): LlmMessage[] {
  const header = [
    `DURUŞMA: ${input.hearingDate}`,
    input.courtName,
    input.hearingType ? `Tip: ${input.hearingType}` : undefined,
    input.purpose ? `Konu: ${input.purpose}` : undefined,
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ");
  return buildMessages(hearingPrepPrompt, `${header}\nDOSYA BAĞLAMI:\n${input.caseContextText}`);
}
