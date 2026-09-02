/**
 * GELEN MESAJ — DETERMİNİSTİK EŞLEŞTİRME ÖNCE, AI SONRA.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ SIRA ŞUDUR ve bu sıra kodun yapısıyla zorlanır:                          ║
 * ║                                                                          ║
 * ║   1. `decideDeterministicMatch` çalışır (kayıt eşleşmesi).               ║
 * ║   2. `deterministic.matched === true` ise fonksiyon AI'ya UĞRAMADAN      ║
 * ║      döner — `runAiMatch` çağrısı `if (!deterministic.matched && ...)`   ║
 * ║      koşulunun İÇİNDEDİR, dolayısıyla atlanabilir değil, ULAŞILAMAZDIR.  ║
 * ║   3. AI çalışmadığında `creditRunContext` hiçbir çağrı KAYDETMEZ;        ║
 * ║      `CreditService.settle` "sağlayıcı çağrısı yapılmadı" dalına düşer   ║
 * ║      ve rezervasyonun TAMAMINI iade eder. Yani deterministik eşleşmede   ║
 * ║      kredi harcanmaz — bu, yorum değil, ölçülebilir davranıştır.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * AI'ın yazabileceği tek şey ÖNERİDİR: `caseId` + `matchConfidence` dolar,
 * `matchStatus` BEKLIYOR kalır. `ESLESTI`/`ELLE_ESLESTI`'ye geçiş YALNIZCA
 * `confirmMatch` üzerinden, insan eliyle olur (Modül 19 iş kuralı 5).
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { scanPii } from "@nomosos/ai";
import type { InboundMessage, Prisma } from "@nomosos/db";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiRunnerService } from "../caselaw/ai-runner.service";
import { creditRunContext } from "../credits/credit-context";
import { paged, resolvePage } from "../common/pagination";
import { ROLE_SETS, assertRole } from "../common/roles";
import type { AuthUser } from "../common/types";
import { CommunicationService } from "./communication.service";
import {
  MessageCaseMatchOutputSchema,
  buildMessageCaseMatchMessages,
} from "./communication.prompts";
import {
  decideAiMatch,
  decideDeterministicMatch,
  normalizeEmail,
  normalizeFileNumber,
  normalizePhone,
  type CaseIndexRow,
  type ClientContactIndex,
  type DeterministicMatch,
} from "./inbound-match";
import type { CreateInboundInput, MatchInboundInput, SuggestInboundCaseInput } from "./communication.dto";

/** Eşleştirme adayı olarak taranacak azami müvekkil sayısı. */
const CLIENT_SCAN_LIMIT = 5000;
/** Modele verilecek azami dosya sayısı. */
const AI_CASE_LIMIT = 12;

export interface MatchOutcome {
  stage: "DETERMINISTIK" | "AI" | "YOK";
  clientId: string | null;
  caseId: string | null;
  confidence: number | null;
  matchStatus: "BEKLIYOR" | "ESLESTI" | "ELLE_ESLESTI" | "ESLESMEDI";
  reason: string;
  /** AI çağrıldı mı? Deterministik eşleşmede DAİMA false. */
  aiUsed: boolean;
  preselect?: boolean;
  rejectedBecause?: string;
}

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiRunnerService,
    private readonly communication: CommunicationService,
  ) {}

  /* ---------------------------------------------------------------- *
   * Okuma
   * ---------------------------------------------------------------- */

  async list(
    user: AuthUser,
    query: { matchStatus?: string; channel?: string; clientId?: string; caseId?: string; page?: string; limit?: string },
  ) {
    const page = resolvePage(query);
    // İ-18: Enum süzgeçleri DOĞRULANIR — geçersiz değer 422 döner, sessiz boş
    // liste değil. Kullanıcı yanlış değer gönderdiğinde neden boş sonuç aldığını
    // bilmelidir.
    const VALID_MATCH_STATUSES = ["BEKLIYOR", "ESLESTI", "ELLE_ESLESTI", "ESLESMEDI"] as const;
    const VALID_CHANNELS = ["EPOSTA", "SMS", "WHATSAPP", "TELEFON", "PORTAL", "YUZ_YUZE", "DIGER"] as const;
    if (query.matchStatus && !(VALID_MATCH_STATUSES as readonly string[]).includes(query.matchStatus)) {
      throw new BadRequestException(`Geçersiz eşleşme durumu: ${query.matchStatus}. Geçerli değerler: ${VALID_MATCH_STATUSES.join(", ")}.`);
    }
    if (query.channel && !(VALID_CHANNELS as readonly string[]).includes(query.channel)) {
      throw new BadRequestException(`Geçersiz kanal: ${query.channel}. Geçerli değerler: ${VALID_CHANNELS.join(", ")}.`);
    }

    const where: Prisma.InboundMessageWhereInput = {
      tenantId: user.tenantId,
      ...(query.matchStatus ? { matchStatus: query.matchStatus as never } : {}),
      ...(query.channel ? { channel: query.channel as never } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.caseId ? { caseId: query.caseId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.inboundMessage.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        skip: page.skip,
        take: page.take,
        include: {
          client: { select: { id: true, name: true } },
          case: { select: { id: true, title: true, fileNumber: true } },
        },
      }),
      this.prisma.client.inboundMessage.count({ where }),
    ]);
    return paged(items.map((m) => this.decorate(m)), total, page);
  }

  async detail(user: AuthUser, id: string) {
    return this.decorate(await this.require(user, id));
  }

  private async require(user: AuthUser, id: string): Promise<InboundMessage> {
    const found = await this.prisma.client.inboundMessage.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!found) throw new NotFoundException("Gelen mesaj bulunamadı.");
    return found;
  }

  /**
   * `caseId` dolu ama `matchStatus = BEKLIYOR` olan kayıt bir ÖNERİDİR.
   * Arayüzün bunu onaylanmış bağlantı sanmaması için zarf açıkça söyler.
   */
  private decorate<T extends InboundMessage>(message: T) {
    const isSuggestion = message.matchStatus === "BEKLIYOR" && message.caseId !== null;
    return {
      ...message,
      isSuggestion,
      confirmed: message.matchStatus === "ESLESTI" || message.matchStatus === "ELLE_ESLESTI",
      ...(isSuggestion
        ? {
            notice:
              "Bu dosya bağlantısı bir ÖNERİDİR ve henüz onaylanmamıştır. " +
              "Onaylamak için PATCH /inbound-messages/:id/match kullanın.",
          }
        : {}),
    };
  }

  /* ---------------------------------------------------------------- *
   * Kayıt
   * ---------------------------------------------------------------- */

  /**
   * Gelen mesajı kaydeder (webhook veya elle giriş) ve eşleştirmeyi çalıştırır.
   *
   * MÜKERRERLİK: şemada sağlayıcı mesaj kimliği için sütun yoktur (Faz 5
   * şeması), bu yüzden idempotency deterministik bir imzayla sağlanır:
   * aynı büro + kanal + gönderen + geliş anı + gövde birleşimi. Aynı webhook
   * iki kez düşerse ikinci çağrı MEVCUT kaydı döndürür, yenisini AÇMAZ
   * (Modül 19 iş kuralı 4 / kabul kriteri 2).
   */
  async create(user: AuthUser, input: CreateInboundInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "gelen mesaj kaydetme");
    const receivedAt = input.receivedAt ?? new Date();

    const duplicate = await this.prisma.client.inboundMessage.findFirst({
      where: {
        tenantId: user.tenantId,
        channel: input.channel,
        fromRef: input.fromRef,
        receivedAt,
        body: input.body,
      },
    });
    if (duplicate) {
      // Kredi kapısı `useAi` ile açılmış olabilir; çağrı yapılmadığından
      // rezervasyon settle aşamasında tamamen iade edilir.
      return {
        ...this.decorate(duplicate),
        duplicate: true,
        notice: "Bu mesaj daha önce kaydedilmiş; mükerrer kayıt oluşturulmadı.",
      };
    }

    // Portal mesajında müvekkil kimlik doğrulamasından geçmiştir; tahmin edilmez.
    const knownClientId = input.clientId ?? null;
    if (knownClientId) await this.communication.requireClient(user.tenantId, knownClientId);

    // --- ADIM 1: DETERMİNİSTİK ---------------------------------------------
    const deterministic = await this.runDeterministicMatch(
      user.tenantId,
      input.fromRef,
      `${input.subject ?? ""}\n${input.body}`,
      knownClientId,
    );

    // Dosya bulundu ama gönderen doğrulanamadıysa bu bir ÖNERİDİR: `caseId`
    // yazılır, `matchStatus` BEKLIYOR kalır ve güven "kesin" (1) değil
    // "ön seçili öneri" (0,8) olarak kaydedilir. Kesinlik iddiası ancak
    // gönderen de kayda oturduğunda yapılabilir (bkz. inbound-match.ts).
    const suggestionOnly = !deterministic.matched && deterministic.caseId !== null;

    let outcome: MatchOutcome = {
      stage: deterministic.matched ? "DETERMINISTIK" : "YOK",
      clientId: deterministic.clientId,
      caseId: deterministic.caseId,
      confidence: deterministic.matched ? deterministic.confidence : suggestionOnly ? 0.8 : null,
      matchStatus: deterministic.matched ? "ESLESTI" : "BEKLIYOR",
      reason: deterministic.reason,
      aiUsed: false,
      ...(suggestionOnly ? { preselect: true } : {}),
    };

    const created = await this.prisma.client.inboundMessage.create({
      data: {
        tenantId: user.tenantId,
        channel: input.channel,
        fromRef: input.fromRef,
        subject: input.subject ?? null,
        body: input.body,
        receivedAt,
        clientId: outcome.clientId,
        caseId: outcome.caseId,
        matchConfidence: outcome.confidence,
        matchStatus: outcome.matchStatus,
        // Deterministik eşleşme kayıt üzerinden doğrulanmıştır; "işleyen"
        // sistemdir, bir kullanıcının onayı DEĞİL. `processedBy` boş kalır.
        processedBy: null,
      },
    });

    // --- ADIM 2: AI — YALNIZCA deterministik ÇÖZEMEDİYSE --------------------
    // Deterministik katman zaten bir dosya ÖNERMİŞSE (esas numarası eşleşti ama
    // gönderen doğrulanamadı) AI'ya gitmenin bir kazanımı yoktur: aynı soruya
    // daha zayıf bir cevap üretir ve kredi harcar.
    if (suggestionOnly) {
      creditRunContext.discard();
      outcome.reason +=
        " Dosya önerisi metindeki esas numarasından üretildiği için AI önerisi istenmedi " +
        "(kredi harcanmadı).";
    } else if (!deterministic.matched && input.useAi) {
      outcome = await this.runAiMatch(user, created, deterministic, input.piiApproved);
    } else if (!deterministic.matched) {
      outcome.reason +=
        " AI önerisi istenmedi (`useAi: false`); mesaj elle eşleştirme için bekliyor.";
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INBOUND_MESSAGE_CREATE",
      entity: "InboundMessage",
      entityId: created.id,
      detail: `kanal=${input.channel} eslestirme=${outcome.stage} aiKullanildi=${outcome.aiUsed}`,
    });

    const fresh = await this.prisma.client.inboundMessage.findUniqueOrThrow({
      where: { id: created.id },
    });
    return { ...this.decorate(fresh), match: outcome };
  }

  /**
   * `POST /inbound-messages/:id/suggest-case` — avukatın açıkça istediği AI önerisi.
   *
   * Zaten deterministik olarak eşleşmiş bir mesajda ÇALIŞMAZ: kesin bilgiyi
   * tahminle değiştirmek ve bunun için kredi harcamak anlamsızdır.
   */
  async suggestCase(user: AuthUser, id: string, input: SuggestInboundCaseInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "gelen mesaj için dosya önerisi isteme");
    const message = await this.require(user, id);

    if (message.matchStatus === "ESLESTI" || message.matchStatus === "ELLE_ESLESTI") {
      // Kredi kapısı bu uçta açılmış olabilir; çağrı yapılmadan çıkıldığı için
      // rezervasyon iade edilir (settle → "sağlayıcı çağrısı yapılmadı").
      throw new ConflictException(
        "Bu mesaj zaten bir dosyaya bağlanmış durumda; AI önerisi istenmedi ve kredi harcanmadı. " +
          "Bağlantıyı değiştirmek için PATCH /inbound-messages/:id/match kullanın.",
      );
    }

    const deterministic = await this.runDeterministicMatch(
      user.tenantId,
      message.fromRef,
      `${message.subject ?? ""}\n${message.body}`,
    );
    if (deterministic.matched) {
      // Kayıt bu arada tamamlanmış olabilir (müvekkile telefon eklenmesi gibi).
      // Deterministik cevap varken AI'ya gidilmez.
      const updated = await this.prisma.client.inboundMessage.update({
        where: { id: message.id },
        data: {
          clientId: deterministic.clientId,
          caseId: deterministic.caseId,
          matchConfidence: deterministic.confidence,
          matchStatus: "ESLESTI",
        },
      });
      return {
        ...this.decorate(updated),
        match: {
          stage: "DETERMINISTIK" as const,
          clientId: deterministic.clientId,
          caseId: deterministic.caseId,
          confidence: deterministic.confidence,
          matchStatus: "ESLESTI" as const,
          reason: deterministic.reason,
          aiUsed: false,
        },
      };
    }

    const outcome = await this.runAiMatch(user, message, deterministic, input.piiApproved);
    const fresh = await this.prisma.client.inboundMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    return { ...this.decorate(fresh), match: outcome };
  }

  /**
   * İNSAN KARARI — dosya bağlantısını kesinleştirir veya reddeder.
   *
   * `ESLESTI`/`ELLE_ESLESTI` durumuna geçişin TEK yolu budur. AI ne kadar
   * emin olursa olsun bu uca uğramadan bir mesaj "eşleşmiş" sayılmaz.
   */
  async confirmMatch(user: AuthUser, id: string, input: MatchInboundInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "gelen mesajı dosyaya bağlama");
    const message = await this.require(user, id);

    if (input.matched === false) {
      const updated = await this.prisma.client.inboundMessage.update({
        where: { id: message.id },
        data: {
          matchStatus: "ESLESMEDI",
          caseId: null,
          matchConfidence: null,
          processedBy: user.userId,
        },
      });
      await this.audit.log({
        tenantId: user.tenantId,
        userId: user.userId,
        action: "INBOUND_MATCH_REJECT",
        entity: "InboundMessage",
        entityId: id,
      });
      return this.decorate(updated);
    }

    let clientId = input.clientId ?? message.clientId ?? null;
    if (clientId) await this.communication.requireClient(user.tenantId, clientId);
    if (input.caseId) {
      const kase = await this.communication.requireCase(
        user.tenantId,
        input.caseId,
        clientId ?? undefined,
      );
      clientId = clientId ?? kase.clientId;
    }

    const updated = await this.prisma.client.inboundMessage.update({
      where: { id: message.id },
      data: {
        clientId,
        caseId: input.caseId ?? message.caseId ?? null,
        // "ELLE_ESLESTI": bağlantıyı insan kurdu/onayladı. AI önerisinin
        // onaylanması da buraya düşer — kararın sahibi insandır.
        matchStatus: "ELLE_ESLESTI",
        processedBy: user.userId,
      },
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "INBOUND_MATCH_CONFIRM",
      entity: "InboundMessage",
      entityId: id,
      detail: `clientId=${clientId ?? "-"} caseId=${updated.caseId ?? "-"}`,
    });
    return this.decorate(updated);
  }

  /* ---------------------------------------------------------------- *
   * Eşleştirme katmanları
   * ---------------------------------------------------------------- */

  /**
   * Deterministik katman: kayıt okur, saf fonksiyona verir, kararı alır.
   *
   * Karşılaştırma verisi (e-posta/telefon) NORMALİZE edilerek indekse konur;
   * "+90 532..." ile "0532..." aynı anahtara iner.
   */
  private async runDeterministicMatch(
    tenantId: string,
    fromRef: string,
    text: string,
    knownClientId: string | null = null,
  ): Promise<DeterministicMatch> {
    const clients = await this.prisma.client.client.findMany({
      // Müvekkil zaten kesinse (portal oturumu) yalnız onun kayıtları taranır:
      // gönderen adresi başka bir müvekkilinkiyle çakışsa bile mesaj sahibini
      // değiştiremez.
      where: { tenantId, ...(knownClientId ? { id: knownClientId } : {}) },
      // İ-27: orderBy'suz take, veritabanının rasgele döndürdüğü 5000 satırı
      // okur — en son eklenen müvekkil hiç taranmayabiliyordu. En yeni önce;
      // yeni müvekkilin ilk mesajı en çok karışan senaryodur.
      orderBy: { createdAt: "desc" },
      take: CLIENT_SCAN_LIMIT,
      select: {
        id: true,
        email: true,
        phone: true,
        contacts: { select: { email: true, phone: true } },
      },
    });
    // Tavandan fazla müvekkil varsa eşleştirme KISMİDİR — bu bir taahhüt
    // değil, bir uyarıdır; avukat yine de elle eşleştirebilir.
    const clientScanCapped = clients.length >= CLIENT_SCAN_LIMIT;

    const clientIndex: ClientContactIndex[] = clients.map((c) => ({
      clientId: c.id,
      emails: [c.email, ...c.contacts.map((k) => k.email)]
        .map(normalizeEmail)
        .filter((v): v is string => v !== null),
      phones: [c.phone, ...c.contacts.map((k) => k.phone)]
        .map(normalizePhone)
        .filter((v): v is string => v !== null),
    }));

    const cases = await this.prisma.client.case.findMany({
      where: {
        tenantId,
        fileNumber: { not: null },
        ...(knownClientId ? { clientId: knownClientId } : {}),
      },
      select: { id: true, clientId: true, fileNumber: true },
    });
    const caseIndex: CaseIndexRow[] = cases.map((c) => ({
      caseId: c.id,
      clientId: c.clientId,
      fileNumber: normalizeFileNumber(c.fileNumber),
    }));

    const decision = decideDeterministicMatch({
      fromRef,
      text,
      clients: clientIndex,
      cases: caseIndex,
      // GÖNDEREN KİMLİĞİ KESİN Mİ? Yalnızca müvekkil dışarıdan (portal oturumu
      // gibi kimlik doğrulamalı bir kaynaktan) bildirildiğinde. Webhook/elle
      // girişte `fromRef` doğrulanmamış bir alandır ve tek başına kesinlik
      // üretemez (bkz. inbound-match.ts).
      senderVerified: knownClientId !== null,
    });

    // Müvekkil DIŞARIDAN kesin olarak bildirilmişse, gönderen adresi o
    // müvekkilin kaydıyla eşleşmese bile mesajın sahibi değişmez. Portal
    // kullanıcısının e-postası müvekkil kartındakinden farklı olabilir; bu,
    // mesajı sahipsiz bırakmak için bir sebep değildir.
    if (knownClientId && decision.clientId !== knownClientId) {
      return {
        ...decision,
        clientId: knownClientId,
        reason:
          "Müvekkil, kimliği doğrulanmış oturum üzerinden kesin olarak bilinmektedir. " +
          decision.reason,
      };
    }
    // İ-27: tarama tavafa takıldıysa kararar KISMİ TARAMA bilgisi eklenir —
    // "eşleşmedi" ile "aranamadı" farklı şeylerdir.
    if (clientScanCapped) {
      decision.reason += ` (Uyarı: büro müvekkillerinin yalnızca ilk ${CLIENT_SCAN_LIMIT} tanesi taranabildi.)`;
    }
    return decision;
  }

  /* ---------------------------------------------------------------- *
   * Portal köprüsü
   * ---------------------------------------------------------------- */

  /**
   * MÜVEKKİL PORTALINDAN GELEN MESAJ — tek yazma noktası.
   *
   * Portal, eskiden `inboundMessage.create` çağrısını kendi içinde yapıyordu ve
   * bu modülün üç kazanımını kullanmıyordu (denetim bulgusu 13):
   *   • mükerrerlik imzası (çift gönderimde ikinci kayıt açılmaz),
   *   • deterministik esas-no eşleştirmesi,
   *   • tek bir `InboundMessage` yazma noktası.
   *
   * `AuthUser` İSTEMEZ: çağıran bir büro kullanıcısı değil, kimliği doğrulanmış
   * bir müvekkildir. Bu yüzden `assertRole` çalıştırılmaz — ama `clientId`
   * çağırandan gelen bir TAHMİN değil, portal oturumunun kendisidir.
   *
   * AI HİÇ ÇAĞRILMAZ: müvekkilin yazdığı metin bu yoldan dış sağlayıcıya
   * çıkmaz ve kredi harcanmaz.
   */
  async createFromPortal(input: {
    tenantId: string;
    clientId: string;
    fromRef: string;
    subject: string | null;
    body: string;
    caseId: string | null;
  }) {
    const receivedAt = new Date();

    // MÜKERRERLİK: portal arayüzünde çift tıklama ya da yeniden gönderim,
    // avukatın gelen kutusunda iki kayıt açmamalıdır. Gönderim anı saniye
    // hassasiyetinde eşleşmeyeceği için pencere kullanılır (30 saniye).
    const duplicate = await this.prisma.client.inboundMessage.findFirst({
      where: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        channel: "PORTAL",
        fromRef: input.fromRef,
        body: input.body,
        receivedAt: { gte: new Date(receivedAt.getTime() - 30_000) },
      },
      select: { id: true, subject: true, body: true, receivedAt: true, caseId: true },
    });
    if (duplicate) return { ...duplicate, duplicate: true as const };

    const deterministic = await this.runDeterministicMatch(
      input.tenantId,
      input.fromRef,
      `${input.subject ?? ""}\n${input.body}`,
      input.clientId,
    );

    // Müvekkilin AÇIKÇA seçtiği dosya önceliklidir (yayınlanmış olduğu portal
    // tarafında doğrulanmıştır); seçmediyse deterministik öneri kullanılır.
    const caseId = input.caseId ?? deterministic.caseId;

    const created = await this.prisma.client.inboundMessage.create({
      data: {
        tenantId: input.tenantId,
        channel: "PORTAL",
        fromRef: input.fromRef,
        subject: input.subject,
        body: input.body,
        receivedAt,
        clientId: input.clientId,
        caseId,
        matchConfidence: caseId ? (input.caseId ? 0.9 : deterministic.confidence) : null,
        // MÜVEKKİLİN SEÇİMİ DE BİR ÖNERİDİR: eşleştirme kararı büro tarafındadır
        // (Modül 19 iş kuralı 5). `ESLESTI` YAZILMAZ.
        matchStatus: "BEKLIYOR",
        processedBy: null,
      },
      select: { id: true, subject: true, body: true, receivedAt: true, caseId: true },
    });

    return { ...created, duplicate: false as const };
  }

  /**
   * AI katmanı — `MESSAGE_CASE_MATCH`.
   *
   * ÖN KOŞUL: müvekkil biliniyor olmalıdır. Müvekkili belirsiz bir mesajda
   * modele büronun TÜM dosyalarını göstermek, hem KVKK açısından savunulamaz
   * hem de doğru cevabı üretmesi imkânsız bir sorudur.
   *
   * Sağlayıcı hatası mesajı düşürmez: kayıt zaten oluşmuştur, avukat elle
   * eşleştirir. Bu durumda kredi kaydı `discard()` ile düşürülür — çalışmayan
   * AI için ücret alınmaz.
   */
  private async runAiMatch(
    user: AuthUser,
    message: InboundMessage,
    deterministic: DeterministicMatch,
    piiApproved: boolean | undefined,
  ): Promise<MatchOutcome> {
    const clientId = deterministic.clientId ?? message.clientId;
    if (!clientId) {
      creditRunContext.discard();
      return {
        stage: "YOK",
        clientId: null,
        caseId: null,
        confidence: null,
        matchStatus: "BEKLIYOR",
        reason:
          deterministic.reason +
          " Gönderen hiçbir müvekkil kaydıyla eşleşmediği için AI önerisi İSTENMEDİ " +
          "(kredi harcanmadı): müvekkili bilinmeyen bir mesajda modele büronun tüm dosyaları " +
          "gösterilemez. Mesajı elle eşleştirin.",
        aiUsed: false,
      };
    }

    const cases = await this.prisma.client.case.findMany({
      where: {
        tenantId: user.tenantId,
        clientId,
        status: { notIn: ["KAPANDI", "ARSIV"] },
      },
      orderBy: { lastActivityAt: "desc" },
      take: AI_CASE_LIMIT,
      select: { id: true, fileNumber: true, courtName: true, type: true, subject: true, title: true },
    });

    if (cases.length === 0) {
      creditRunContext.discard();
      return {
        stage: "YOK",
        clientId,
        caseId: null,
        confidence: null,
        matchStatus: "BEKLIYOR",
        reason: `${deterministic.reason} Müvekkilin açık dosyası bulunmadığı için AI önerisi istenmedi.`,
        aiUsed: false,
      };
    }
    if (cases.length === 1) {
      // TEK DOSYA = SORU YOK. Modelin seçebileceği tek bir seçenek varken ona
      // sormak, kredi yakmaktan başka bir şey yapmaz. Yine de bu bir çıkarımdır
      // (mesaj gerçekten o dosyayla ilgili olmayabilir), bu yüzden ÖNERİ olarak
      // yazılır ve durum BEKLIYOR kalır.
      creditRunContext.discard();
      await this.prisma.client.inboundMessage.update({
        where: { id: message.id },
        data: { clientId, caseId: cases[0].id, matchConfidence: 0.8, matchStatus: "BEKLIYOR" },
      });
      return {
        stage: "DETERMINISTIK",
        clientId,
        caseId: cases[0].id,
        confidence: 0.8,
        matchStatus: "BEKLIYOR",
        preselect: true,
        reason:
          `${deterministic.reason} Müvekkilin tek bir açık dosyası bulunduğundan öneri ` +
          "AI'sız üretildi (kredi harcanmadı). Bağlantı yine de onayınızı bekliyor.",
        aiUsed: false,
      };
    }

    const refIndex = new Map<string, string>();
    const indexLines = cases.map((c, i) => {
      const ref = `dosya-${i + 1}`;
      refIndex.set(ref, c.id);
      return `[${ref}] ${[c.fileNumber, c.courtName, c.type, c.subject ?? c.title]
        .filter(Boolean)
        .join(" · ")}`;
    });

    const messageText = `${message.subject ? `${message.subject}\n` : ""}${message.body}`;

    let run;
    try {
      run = await this.ai.run({
        user,
        taskType: "MESSAGE_CASE_MATCH",
        outboundTexts: [messageText, indexLines.join("\n")],
        piiApproved,
        // Dosya listesi mahkeme adı, konu ve esas numarası taşır; müvekkilin
        // kim olduğu bu satırlardan çıkarılabilir. `scanPii` bu içerikte hiçbir
        // kalıp bulmaz (ad/unvan kalıba girmez), bu yüzden kalıpsız kapı
        // kullanılır: dış sağlayıcıya çıkış avukatın açık onayını ister.
        requireExternalConsent: {
          reason:
            `Bu işlem, gelen mesajın metnini ve müvekkilin ${cases.length} dosyasının ` +
            "künyesini (esas no, mahkeme, konu) DIŞ yapay zekâ sağlayıcısına gönderecektir. " +
            "Onaylıyorsanız isteği `piiApproved: true` ile tekrarlayın. Onaylamıyorsanız mesaj " +
            "kaydedilmiştir ve elle eşleştirilebilir.",
          preview: [messageText, ...indexLines].join("\n"),
        },
        schema: MessageCaseMatchOutputSchema,
        findingPaths: [],
        entity: "InboundMessage",
        entityId: message.id,
        maxTokens: 800,
        buildMessages: ([text, index]) =>
          buildMessageCaseMatchMessages({
            messageText: text,
            caseIndexLines: index.split("\n").filter(Boolean),
          }),
      });
    } catch (err) {
      // KVKK onay talebi (409) kullanıcıya sorulmalıdır — yutulamaz.
      if (err instanceof ConflictException) throw err;
      creditRunContext.discard();
      this.logger.warn(`MESSAGE_CASE_MATCH çalıştırılamadı: ${(err as Error).message}`);
      return {
        stage: "YOK",
        clientId,
        caseId: null,
        confidence: null,
        matchStatus: "BEKLIYOR",
        reason:
          "AI eşleştirme önerisi üretilemedi; mesaj kaydedildi ve elle eşleştirme bekliyor. " +
          "Bu koşu için kredi düşülmedi.",
        aiUsed: false,
      };
    }

    // Kabul kapısı: bilinmeyen referans / kaynaksız öneri / düşük güven elenir.
    // Model, KAPI'DAN GEÇMİŞ (maskeli olabilen) metni gördü; alıntı doğrulaması
    // da aynı metin üzerinde yapılmalıdır, yoksa maskelenmiş bir alıntı ham
    // metinde bulunamaz ve doğru öneri haksız yere elenirdi.
    const decision = decideAiMatch({
      caseRef: run.data.caseRef,
      confidence: run.data.confidence,
      reason: run.data.reason,
      sourceQuote: run.data.sourceQuote,
      refIndex,
      messageText: run.piiMasked ? scanPii(messageText).maskedText : messageText,
    });

    await this.prisma.client.inboundMessage.update({
      where: { id: message.id },
      data: {
        clientId,
        // ÖNERİ: `caseId` dolar ama `matchStatus` BEKLIYOR kalır. Bağlantıyı
        // insan onaylayana kadar bu kayıt "eşleşmiş" sayılmaz.
        caseId: decision.caseId,
        matchConfidence: decision.confidence,
        matchStatus: decision.caseId ? "BEKLIYOR" : "ESLESMEDI",
      },
    });

    return {
      stage: "AI",
      clientId,
      caseId: decision.caseId,
      confidence: decision.confidence,
      matchStatus: decision.caseId ? "BEKLIYOR" : "ESLESMEDI",
      preselect: decision.preselect,
      reason: decision.reason,
      rejectedBecause: decision.rejectedBecause,
      aiUsed: true,
    };
  }
}
