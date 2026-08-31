/**
 * İLETİŞİM MERKEZİ PROMPTLARI — MESSAGE_DRAFT ve MESSAGE_CASE_MATCH.
 *
 * NEDEN packages/legal-ai'DE DEĞİL: bu faz için dosya sahipliği
 * `apps/api/src/communication/**` ile sınırlıdır. Sözleşme aynıdır — her iki
 * prompt da legal-ai'nin `buildMessages()` fonksiyonuyla kurulur, dolayısıyla
 * NOMOSOS_SYSTEM_CORE_PROMPT (uydurma yasağı, kaynak zorunluluğu, süre hesabı
 * yasağı, "çıktı öneridir") her çağrının başında durur. Ham prompt YOKTUR.
 *
 * MESSAGE_DRAFT, CLIENT_STATUS_SUMMARY'nin prompt'unu YENİDEN KULLANIR
 * (görev tanımı: "CLIENT_STATUS_SUMMARY mantığıyla"). Kopyalanmaz: müvekkile
 * nasıl yazılacağına dair kurallar tek yerde kalmalıdır, yoksa iki metin zamanla
 * ayrışır ve "kazanacağız deme" yasağı bir tarafta unutulur.
 */

import {
  buildMessages,
  clientStatusSummaryPrompt,
  type LlmMessage,
  type PromptSpec,
} from "@nomosos/legal-ai";
import { z } from "zod";

/* -------------------------------------------------------------------------- *
 * MESSAGE_DRAFT
 * -------------------------------------------------------------------------- */

/** Kanal başına metin uzunluğu sınırı — SMS 160 karakterlik parçalarla ücretlenir. */
export const CHANNEL_MAX_CHARS: Record<string, number> = {
  SMS: 320,
  WHATSAPP: 900,
  EPOSTA: 1800,
  PORTAL: 1800,
};

/**
 * Göreve eklenen SERT YASAKLAR.
 *
 * Çekirdek prompt ve CLIENT_STATUS_SUMMARY kuralları zaten sonuç taahhüdünü
 * yasaklıyor; burada YASAK YİNELENİR ve örneklenir. Sebebi biçimsel değil:
 * müvekkile giden metin, büronun mesleki sorumluluk taahhüdüne dönüşebilecek
 * TEK dışa dönük AI çıktısıdır. "Davayı kazanacağız" cümlesi bir kez
 * gönderildiğinde geri alınamaz.
 */
export const MESSAGE_DRAFT_SYSTEM_SUFFIX = `Bu metin MÜVEKKİLE gönderilecek bir mesaj taslağıdır ve avukatın onayından sonra kaydı tutularak iletilecektir.

MUTLAK YASAKLAR:
- SONUÇ TAAHHÜDÜ: "davayı kazanacağız", "kesinlikle lehimize sonuçlanır", "endişelenmeyin, sorun yok", "en geç şu tarihte biter" gibi ifadeler YASAKTIR. Belirsizliği dürüstçe yaz.
- SÜRE/TARİH ARİTMETİĞİ: "yaklaşık 3 ay sürer", "iki hafta içinde biter" gibi tahmin YASAKTIR. Yalnızca bağlamda VERİLEN tarihleri aktar.
- TUTAR UYDURMA: bağlamda geçmeyen hiçbir para tutarını yazma.
- İÇ BİLGİ: dosya stratejisi, risk değerlendirmesi, büro içi notlar ve karşı taraf hakkındaki kimlik/iletişim bilgileri bu metne GİRMEZ. Sana verilmedilerse zaten yoklar; kendiliğinden ekleme.
- HUKUKİ JARGON: "derdest", "tefhim", "ıslah", "def'i", "muacceliyet", "tensip", "bila tebliğ" gibi terimleri kullanma. Zorunluysa aynı cümlede sade Türkçe karşılığını ver ve glossary alanına ekle.

ÜSLUP: Saygılı, sakin, kısa cümleli. Müvekkili telaşlandırma, ama gerçeği de yumuşatıp yanıltma.
UZUNLUK: message alanı en fazla {MAX_CHARS} karakter olmalıdır.`;

export interface MessageDraftPromptInput {
  channel: string;
  /** Müvekkilin görünen adı (KVKK kapısından geçmiş hâliyle). */
  clientLabel: string;
  /** Dar, müvekkile dönük dosya bağlamı (client-facing-context.ts). */
  caseContextText: string;
  /** Avukatın taslağa dair özel talimatı (varsa) — KVKK kapısından geçer. */
  instruction?: string | null;
}

/**
 * MESSAGE_DRAFT mesaj zinciri.
 *
 * Metinler KAPI'DAN GEÇMİŞ hâlleriyle verilmelidir; sıra `outboundTexts` ile
 * birebir aynıdır (AiRunnerService maskeli diziyi aynı sırada geri verir).
 */
export function buildMessageDraftMessages(input: MessageDraftPromptInput): LlmMessage[] {
  const maxChars = CHANNEL_MAX_CHARS[input.channel] ?? CHANNEL_MAX_CHARS.EPOSTA;
  const user =
    `HEDEF KANAL: ${input.channel}\n` +
    `MÜVEKKİL: ${input.clientLabel}\n` +
    (input.instruction?.trim() ? `AVUKATIN TALİMATI: ${input.instruction.trim()}\n` : "") +
    `DOSYA BAĞLAMI:\n${input.caseContextText}`;

  return buildMessages(clientStatusSummaryPrompt, user, {
    systemSuffix: MESSAGE_DRAFT_SYSTEM_SUFFIX.replace("{MAX_CHARS}", String(maxChars)),
  });
}

/* -------------------------------------------------------------------------- *
 * MESSAGE_CASE_MATCH
 * -------------------------------------------------------------------------- */

/**
 * Eşleştirme çıktısı.
 *
 * `sourceQuote` ZORUNLUDUR (null değil, opsiyonel de olsa kapıda aranır):
 * `decideAiMatch`, alıntının mesaj metninde GERÇEKTEN geçtiğini doğrular ve
 * geçmiyorsa öneriyi atar. Böylece "bence bu dosyayla ilgili" tipi dayanaksız
 * öneri kayda giremez.
 */
export const MessageCaseMatchOutputSchema = z.object({
  /** Verilen indeksteki referans (ör. "dosya-2") veya eşleşme yoksa null. */
  caseRef: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  /** Mesaj metninden BİREBİR alıntı — kararın dayanağı. */
  sourceQuote: z.string().optional(),
});
export type MessageCaseMatchOutput = z.infer<typeof MessageCaseMatchOutputSchema>;

const MESSAGE_CASE_MATCH_SYSTEM = `Sen bir Türk hukuk bürosunun sekreteryasında çalışan, gelen mesajları doğru dosyaya yönlendirmekle görevli asistansın.

Sana (a) müvekkilden gelen bir mesajın metni ve (b) bu müvekkile ait AÇIK DOSYALARIN kısa listesi verilir. Görevin: mesajın HANGİ dosyayla ilgili olduğunu belirlemek.

KURALLAR:
1. YALNIZCA VERİLEN LİSTEDEN SEÇ. Listede olmayan bir dosya referansı ÜRETME. Referansı listede yazıldığı gibi (ör. "dosya-2") aynen kullan.
2. DAYANAK ZORUNLU. sourceQuote alanına, kararını dayandırdığın cümleyi MESAJ METNİNDEN BİREBİR kopyala. Kendi cümleni yazma, özetleme, kısaltma. Alıntın metinde bulunamazsa önerin sistem tarafından ELENİR.
3. EMİN DEĞİLSEN DÜŞÜK GÜVEN VER. confidence 0 ile 1 arasındadır. Mesaj hangi dosyayla ilgili olduğunu belli etmiyorsa (ör. "merhaba, bir gelişme var mı?") caseRef alanına null yaz ve nedenini reason'da açıkla. Tahmin yürütmek, bilmediğini söylemekten kötüdür.
4. TEK BİR MÜVEKKİLİN BİRDEN ÇOK DOSYASI VARSA ayırt edici ipuçlarını ara: esas numarası, mahkeme adı, karşı taraf, konu (işe iade / kira / icra), tutar. Hiçbiri yoksa null dön.
5. KARAR SENİN DEĞİL. Çıktın bir ÖNERİDİR; dosyayı sisteme bağlayan işlem avukatın/sekreterin onayıdır.

ÇIKTI — yalnızca şu JSON:
{"caseRef":"dosya-2"veya null,"confidence":0.0-1.0,"reason":"...","sourceQuote":"..."}`;

const MESSAGE_CASE_MATCH_FEW_SHOT: readonly LlmMessage[] = [
  {
    role: "user",
    content: `GELEN MESAJ:
Merhaba, kiracının tahliyesi konusunda icra dairesinden bir evrak geldi, ne yapmam gerekiyor?

MÜVEKKİLİN AÇIK DOSYALARI:
[dosya-1] 2026/145 · İstanbul 12. İş Mahkemesi · İş davası · İşe iade istemi
[dosya-2] 2026/88 · İstanbul 4. İcra Dairesi · İcra takibi · Kira alacağı ve tahliye`,
  },
  {
    role: "assistant",
    content: `{"caseRef":"dosya-2","confidence":0.92,"reason":"Mesaj kiracı tahliyesi ve icra dairesinden gelen evraktan söz ediyor; müvekkilin yalnızca bir icra/tahliye dosyası bulunuyor.","sourceQuote":"kiracının tahliyesi konusunda icra dairesinden bir evrak geldi"}`,
  },
  {
    role: "user",
    content: `GELEN MESAJ:
Merhaba avukat bey, bir gelişme oldu mu acaba?

MÜVEKKİLİN AÇIK DOSYALARI:
[dosya-1] 2026/145 · İstanbul 12. İş Mahkemesi · İş davası · İşe iade istemi
[dosya-2] 2026/88 · İstanbul 4. İcra Dairesi · İcra takibi · Kira alacağı ve tahliye`,
  },
  {
    role: "assistant",
    content: `{"caseRef":null,"confidence":0.0,"reason":"Mesaj hiçbir dosyaya işaret eden ipucu içermiyor; müvekkilin iki açık dosyası olduğundan tahmin yürütmek yanlış dosyaya bağlama riski taşır.","sourceQuote":"bir gelişme oldu mu acaba"}`,
  },
];

export const messageCaseMatchPrompt: PromptSpec = {
  taskType: "MESSAGE_CASE_MATCH",
  name: "Gelen Mesaj — Dosya Eşleştirme",
  system: MESSAGE_CASE_MATCH_SYSTEM,
  fewShot: MESSAGE_CASE_MATCH_FEW_SHOT,
  expectsJson: true,
};

export interface MessageCaseMatchPromptInput {
  /** Mesaj metni (KVKK kapısından geçmiş). */
  messageText: string;
  /** `[dosya-1] 2026/145 · ...` biçiminde satırlar (KVKK kapısından geçmiş). */
  caseIndexLines: readonly string[];
}

export function buildMessageCaseMatchMessages(input: MessageCaseMatchPromptInput): LlmMessage[] {
  return buildMessages(
    messageCaseMatchPrompt,
    `GELEN MESAJ:\n${input.messageText}\n\nMÜVEKKİLİN AÇIK DOSYALARI:\n${input.caseIndexLines.join("\n")}`,
  );
}
