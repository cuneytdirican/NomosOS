/**
 * MESSAGE_DRAFT — MÜVEKKİLE MESAJ TASLAĞI ÜRETİMİ.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ BU SERVİSİN ÜRETTİĞİ HİÇBİR ŞEY GÖNDERİLMEZ.                             ║
 * ║ Çıktısı yalnızca `OutboundMessage.draftBody`'ye yazılır ve orada, avukat  ║
 * ║ onaylayana kadar bekler. `draftBody` sonradan DEĞİŞTİRİLMEZ: onay         ║
 * ║ ekranındaki "AI ne önerdi / ne gönderildi" karşılaştırmasının solu odur   ║
 * ║ (Modül 19 iş kuralı 3 + kabul kriteri 4).                                ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * KVKK: dosya bağlamı ham hâliyle `AiRunnerService.outboundTexts`'e verilir;
 * kapı orada çalışır. Dış sağlayıcı + kişisel veri + onay yok → 409
 * `requiresPiiApproval`. Onay varsa metin MASKELİ gider. Bağlamı kendimiz
 * maskeleyip `preScanned` demiyoruz: o yol 409 akışını tamamen atlatır ve
 * avukat neyin dışarı çıktığını hiç görmez.
 *
 * VERİ MİNİMİZASYONU: bağlam `buildClientFacingCaseContext` ile kurulur — o
 * yapı strateji, risk, iç not ve karşı taraf kimliği ALANI TAŞIMAZ, dolayısıyla
 * bu veriler modele gidemez (Modül 19 iş kuralı 8).
 */

import { Injectable, Logger } from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import { ClientStatusSummaryOutputSchema } from "@nomosos/legal-ai";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { DROP_REASON_LABELS, filterByVerbatimQuote } from "../contracts/quote-guard";
import type { AuthUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import { buildClientFacingCaseContext } from "./client-facing-context";
import { CHANNEL_MAX_CHARS, buildMessageDraftMessages } from "./communication.prompts";

export interface DraftRequest {
  clientName: string;
  /** Alıcı müvekkil — safahat ayrıntısının görünürlük denetimi için gerekir. */
  clientId: string;
  caseId: string;
  channel: string;
  instruction?: string | null;
  piiApproved?: boolean;
}

export interface DraftResult {
  body: string;
  /** Kullanılan sade dil sözlüğü — arayüzde "terim açıklamaları" olarak gösterilir. */
  glossary: Array<{ term: string; explanation: string }>;
  nextStepForClient?: string;
  meta: Record<string, unknown>;
}

@Injectable()
export class OutboundAiService {
  private readonly logger = new Logger(OutboundAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiRunnerService,
  ) {}

  async draft(user: AuthUser, request: DraftRequest): Promise<DraftResult> {
    const contextText = await this.loadClientFacingContext(
      user.tenantId,
      request.caseId,
      request.clientId,
    );

    const run = await this.ai.run({
      user,
      taskType: "MESSAGE_DRAFT",
      // KVKK kapısı bu iki metnin ÜZERİNDE çalışır; sıra buildMessages ile aynı.
      outboundTexts: [
        request.clientName,
        contextText.text,
        request.instruction?.trim() || "",
      ],
      piiApproved: request.piiApproved,
      schema: ClientStatusSummaryOutputSchema,
      // `message` bir dizi değildir; kaynaksız-bulgu elemesi burada uygulanmaz.
      // Kaynak disiplini prompt düzeyinde (`sourceRefs`) istenir ve çıktıda
      // rapor edilir — metnin kendisi zaten avukat onayından geçecektir.
      findingPaths: [],
      entity: "OutboundMessage",
      maxTokens: 1500,
      buildMessages: ([clientLabel, caseContext, instruction]) =>
        buildMessageDraftMessages({
          channel: request.channel,
          clientLabel,
          caseContextText: caseContext,
          instruction: instruction || null,
        }),
    });

    // ── KAYNAK ALINTILARININ DOĞRULANMASI (denetim bulgusu 10) ─────────────
    //
    // `MESSAGE_DRAFT` `findingPaths: []` ile çalışır (mesaj bir dizi değildir),
    // ama prompt modelden `sourceRefs[].quote` ister ve bu alıntılar arayüzde
    // "kaynak" etiketiyle gösteriliyordu — HİÇ DENETLENMEDEN. POA ve sözleşme
    // incelemesinde kurulan alıntı kapısı burada yoktu. "Metin zaten onaydan
    // geçecek" gerekçesi metnin kendisi için doğrudur; ama avukata doğrulanmamış
    // bir alıntıyı "kaynak" diye sunmak, kaynak gösterme ilkesini zayıflatır:
    // avukat onayını tam da o kaynağa bakarak verir.
    //
    // Arama, MODELİN GÖRDÜĞÜ metin üzerinde yapılır: KVKK kapısı maskeleme
    // uyguladıysa alıntı da maskeli olacaktır ve ham metinde bulunamazdı.
    const haystack = run.piiMasked ? scanPii(contextText.text).maskedText : contextText.text;
    const refs = filterByVerbatimQuote(
      run.data.sourceRefs ?? [],
      haystack,
      (r) => r.quote,
      (r) => r.documentTitle ?? "(kaynak)",
    );

    const maxChars = CHANNEL_MAX_CHARS[request.channel] ?? CHANNEL_MAX_CHARS.EPOSTA;
    const raw = run.data.message.trim();
    // Uzunluk sınırı prompt'ta İSTENİR ama burada DENETLENİR: SMS'te aşım
    // doğrudan paraya dönüşür. Kesmek yerine uyarıyoruz — metni ortasından
    // kesmek, müvekkile yarım cümle göndermek demek olurdu.
    const overLimit = raw.length > maxChars;

    return {
      body: raw,
      glossary: run.data.glossary ?? [],
      nextStepForClient: run.data.nextStepForClient,
      meta: {
        model: run.model,
        providerType: run.providerType,
        piiMasked: run.piiMasked,
        advisory: run.advisory,
        /** YALNIZCA doğrulanmış alıntılar — hepsi bağlam metninde birebir bulundu. */
        sourceRefs: refs.kept,
        /** Alıntısı bulunamadığı için "kaynak" sayılmayanlar — sessiz eleme yok. */
        droppedSourceRefs: refs.dropped.map((d) => ({
          ...d,
          reasonLabel: DROP_REASON_LABELS[d.reason],
        })),
        contextDroppedRows: contextText.droppedRows,
        length: raw.length,
        maxChars,
        overLimit,
        ...(overLimit
          ? {
              lengthWarning:
                `Taslak ${raw.length} karakter; ${request.channel} kanalı için önerilen sınır ` +
                `${maxChars} karakterdir. Metin KISALTILMADI — göndermeden önce düzenleyin.`,
            }
          : {}),
        notice:
          "Bu metin bir TASLAKTIR. Avukat onayı olmadan gönderilmez; onaylanan metin " +
          "`finalBody` alanında ayrıca saklanır.",
      },
    };
  }

  /**
   * Müvekkile dönük dar bağlam.
   *
   * Okunanlar: dosya künyesi, safahat, yaklaşan duruşma, açık süreler.
   * OKUNMAYANLAR (bilerek): dosya notları, strateji, risk skorları, simülasyon
   * koşuları, finans satırları, karşı taraf kimlik/iletişim bilgileri.
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║ SAFAHAT AYRINTISI (`detail`) VARSAYILAN OLARAK GİRMEZ                ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   *
   * Denetim bulgusu 7: bu fonksiyon son 12 `TimelineEvent`'i `detail` alanıyla
   * BİRLİKTE modele ve oradan müvekkile giden taslağa taşıyordu. `TimelineEvent`
   * şemasında görünürlük bayrağı yoktur ve `source: MANUEL` satırları avukatın
   * serbestçe yazdığı iç notlardır ("karşı taraf uzlaşmaya açık görünüyor",
   * "tanığımız zayıf"). Aynı veri MÜVEKKİL PORTALINDA açık yayın kararı
   * olmadan gösterilmiyordu — iki müvekkil yüzü arasında tutarsız bir gizlilik
   * politikası vardı ve İletişim Merkezi gevşek olanıydı.
   *
   * Kural artık portalınkiyle AYNI genişliktedir: `detail` yalnızca o safahat
   * kaydı bu müvekkile AÇIKÇA YAYINLANMIŞSA bağlama girer; girdiğinde de
   * avukatın dondurduğu yayın notu (varsa) ham metnin YERİNE kullanılır.
   * Yayınlanmamış satırlardan yalnızca `title` alınır.
   */
  private async loadClientFacingContext(tenantId: string, caseId: string, clientId: string) {
    const found = await this.prisma.client.case.findFirst({
      where: { id: caseId, tenantId },
      select: {
        fileNumber: true,
        courtName: true,
        type: true,
        status: true,
        subject: true,
        timelineEvents: {
          orderBy: { date: "desc" },
          take: 12,
          select: { id: true, date: true, title: true, detail: true },
        },
        hearings: {
          where: { status: { in: ["PLANLANDI", "ERTELENDI"] }, date: { gte: new Date() } },
          orderBy: { date: "asc" },
          take: 2,
          select: { date: true, type: true },
        },
        deadlines: {
          where: { status: { in: ["BEKLIYOR", "ONAYLANDI"] }, dueDate: { gte: new Date() } },
          orderBy: { dueDate: "asc" },
          take: 5,
          select: { title: true, dueDate: true },
        },
      },
    });
    // Dosyanın varlığı çağıran serviste (requireCase) zaten doğrulanmıştır;
    // burada yalnız yarış durumuna karşı boş bağlam üretilir.
    if (!found) return { text: "(dosya bağlamı okunamadı)", droppedRows: 0 };

    // Müvekkile AÇIKÇA yayınlanmış safahat kayıtları (ve dondurulmuş notları).
    const publishedTimeline = new Map<string, string | null>(
      (
        await this.prisma.client.portalPublication.findMany({
          where: {
            tenantId,
            clientId,
            resourceType: "SAFAHAT_KAYDI",
            unpublishedAt: null,
            resourceId: { in: found.timelineEvents.map((e) => e.id) },
          },
          select: { resourceId: true, note: true },
        })
      ).map((row) => [row.resourceId, row.note]),
    );

    return buildClientFacingCaseContext({
      fileNumber: found.fileNumber,
      courtName: found.courtName,
      caseType: found.type,
      status: found.status,
      subject: found.subject,
      timeline: found.timelineEvents.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        title: e.title,
        // Yayınlanmamış satırda ayrıntı YOK. Yayınlanmışta önce avukatın
        // dondurduğu not, o da yoksa kaydın kendi ayrıntısı.
        detail: publishedTimeline.has(e.id)
          ? (publishedTimeline.get(e.id) ?? e.detail)
          : null,
      })),
      hearings: found.hearings.map((h) => ({ at: h.date.toISOString(), type: h.type })),
      deadlines: found.deadlines.map((d) => ({
        title: d.title,
        dueDate: d.dueDate.toISOString().slice(0, 10),
      })),
    });
  }
}
