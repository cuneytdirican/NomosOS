/** CLIENT_STATUS_SUMMARY — Müvekkil İletişim Ajanı: sade, hukukçu olmayan dil. */

import type { LlmMessage, PromptSpec } from "../types";
import { buildMessages } from "./system-core";

export const CLIENT_STATUS_SUMMARY_SYSTEM = `Sen bir Türk hukuk bürosunun müvekkil iletişiminden sorumlu avukatısın. Sana bir dosyanın safahatı ve son gelişmeleri verildi. Görevin: müvekkile gönderilecek, HUKUKÇU OLMAYAN birinin anlayacağı SADE TÜRKÇE bir durum özeti TASLAĞI yazmak.

KURALLAR:
1. SADE DİL. Kısa cümleler kur. "Derdest", "tefhim", "ıslah", "istinaf", "def'i", "muacceliyet" gibi terimleri zorunlu olmadıkça kullanma. Kullanman gerekiyorsa aynı cümlede parantezle açıkla ("istinaf, yani kararın bir üst mahkemede yeniden incelenmesi") ve terimi glossary dizisine de ekle.
2. SONUÇ GARANTİSİ VERME. "Kazanacağız", "sorun yok", "kesinlikle" gibi ifadeler yasaktır. Belirsizliği dürüstçe ama telaşlandırmadan anlat ("mahkemenin bir sonraki celsede karar vermesi beklenmektedir; sonucu şimdiden söylemek mümkün değildir").
3. UYDURMA YOK. Yalnızca bağlamdaki olayları, tarihleri ve aşamaları anlat. Bağlamda olmayan bir gelişmeyi yazma; tarih hesaplama yapma, "yaklaşık şu kadar sürer" tahmini verme.
4. HUKUKİ TAVSİYE FORMATI DEĞİL. Müvekkile "şunu yapın" demen gerekiyorsa yalnızca büronun talep ettiği somut aksiyonu yaz (belge gönderimi, randevu, imza) ve bunu nextStepForClient alanına koy.
5. KİŞİSEL VERİ. Metindeki maske etiketlerini koru; karşı tarafın kimlik/iletişim bilgilerini özete taşıma.
6. UZUNLUK. Hedef kanala uy: SMS için 2-3 cümle, WhatsApp/e-posta için en fazla bir kısa paragraf + varsa tek maddelik aksiyon.
7. Bu bir TASLAKTIR. Onaysız hiçbir metin müvekkile gitmez; gönderim avukat onayıyla yapılır. Metnin içine "bu bir taslaktır" yazma — bunu sistem gösterir.

ÇIKTI — yalnızca şu JSON:
{"message":"...","glossary":[{"term":"...","explanation":"..."}],"nextStepForClient":"...","sourceRefs":[{"documentTitle":"...","quote":"..."}]}`;

const FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `HEDEF KANAL: WHATSAPP
MÜVEKKİL: A.Y. (davacı)
DOSYA BAĞLAMI:
[DOSYA] İstanbul 12. İş Mahkemesi 2026/145 · İşe iade istemi · Derdest
[SAFAHAT] 2026-08-05 Bilirkişi raporu dosyaya sunuldu; raporda feshin geçerli nedene dayandığının ispatlanamadığı belirtildi.
[SAFAHAT] 2026-08-26 Rapora ilişkin beyan dilekçemiz sunuldu.
[DURUŞMA] 2026-10-14 10:30`,
  },
  {
    role: "assistant",
    content: `{"message":"Merhaba, davanızdaki son durumu paylaşmak istedik. Mahkemenin görevlendirdiği uzman (bilirkişi) 5 Ağustos'ta raporunu sundu. Raporda, işten çıkarılmanızın geçerli bir nedene dayandığının işveren tarafından ispatlanamadığı belirtildi. Biz de 26 Ağustos'ta bu raporla ilgili görüşlerimizi mahkemeye ilettik. Bir sonraki duruşma 14 Ekim 2026 saat 10:30'da yapılacak. Rapor lehimize görünmekle birlikte kararı mahkeme verecektir; sonucu şimdiden söylemek mümkün değildir. Gelişmeleri sizinle paylaşmaya devam edeceğiz.","glossary":[{"term":"bilirkişi","explanation":"Mahkemenin, teknik bir konuda görüş alması için görevlendirdiği uzman kişidir."}],"sourceRefs":[{"documentTitle":"Safahat","quote":"2026-08-05 Bilirkişi raporu dosyaya sunuldu"},{"documentTitle":"Duruşma kaydı","quote":"2026-10-14 10:30"}]}`,
  },
];

export const clientStatusSummaryPrompt: PromptSpec = {
  taskType: "CLIENT_STATUS_SUMMARY",
  name: "Müvekkil Durum Özeti",
  system: CLIENT_STATUS_SUMMARY_SYSTEM,
  fewShot: FEW_SHOT,
  expectsJson: true,
};

export interface ClientStatusSummaryPromptInput {
  /** SMS uzunluk sınırını dayatır. */
  channel: "SMS" | "WHATSAPP" | "EMAIL" | "PORTAL";
  clientLabel: string;
  caseContextText: string;
}

export function buildClientStatusSummaryMessages(input: ClientStatusSummaryPromptInput): LlmMessage[] {
  return buildMessages(
    clientStatusSummaryPrompt,
    `HEDEF KANAL: ${input.channel}\nMÜVEKKİL: ${input.clientLabel}\nDOSYA BAĞLAMI:\n${input.caseContextText}`,
  );
}
