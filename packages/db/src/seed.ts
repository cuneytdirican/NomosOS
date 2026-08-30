/**
 * NomosOS demo/sistem verisi.
 *
 * İçerik:
 *  1) Kiracı + kullanıcılar
 *  2) Sistem süre kuralları (DeadlineRule, tenantId = null)
 *  3) 2026 resmi tatilleri + adli tatil (Holiday)
 *  4) Demo müvekkiller, dosyalar, taraflar, safahat, duruşma, süre, görev, not, karar
 *
 * Seed IDEMPOTENT'tir: kayıt varsa atlanır, silme yapılmaz.
 * Çalıştırma: pnpm --filter @nomosos/db seed
 */
import { PrismaClient, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import {
  SYSTEM_DEADLINE_RULES,
  TR_HOLIDAYS_2026,
  expandJudicialRecess,
  parseDateOnly,
} from "@nomosos/legal-core";

const prisma = new PrismaClient();

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

/** UTC gün başı — @db.Date alanları için kayma yaşamamak adına. */
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Bugünden n gün sonrası (saat 10:00 UTC — duruşma saati gibi görünsün). */
function inDays(n: number, hour = 10): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

// ---------------------------------------------------------------------------
// 1) Sistem süre kuralları
// ---------------------------------------------------------------------------

/**
 * TEK KAYNAK: kural listesi `@nomosos/legal-core` içindeki
 * `SYSTEM_DEADLINE_RULES`'tan gelir. Eskiden bu dosyada elle tutulan kopya,
 * iki tarafın sessizce ayrışmasına açıktı (denetim bulgusu 14) — kopya
 * kaldırılmıştır. Kural değişikliği yalnızca legal-core'da yapılır.
 */
/**
 * Kural setinden ÇIKARILMIŞ sistem kurallarını pasifleştirir.
 *
 * Faz 1 hukuki denetiminde bazı anahtarlar yeniden adlandırıldı veya ikiye
 * bölündü (ör. `IIK_ISTIHKAK` → `IIK_ISTIHKAK_ITIRAZ` 3 gün + `IIK_ISTIHKAK_DAVA`
 * 7 gün). Eski satır veritabanında `isActive: true` kalırsa, YANLIŞ SÜREYİ
 * taşıyan kural kullanıcıya seçenek olarak sunulmaya devam eder — düzeltmenin
 * bütün anlamı kaybolur. Silinmez (mevcut Deadline kayıtları `ruleKey` ile
 * bu satırlara atıf yapıyor olabilir), pasifleştirilir: `resolveByKey`
 * yalnızca `isActive: true` kuralları çözer.
 */
async function retireRemovedSystemRules(): Promise<number> {
  const currentKeys = SYSTEM_DEADLINE_RULES.map((r) => r.key);
  const { count } = await prisma.deadlineRule.updateMany({
    where: { tenantId: null, isActive: true, key: { notIn: currentKeys } },
    data: { isActive: false },
  });
  return count;
}

async function seedDeadlineRules(): Promise<number> {
  let created = 0;
  for (const r of SYSTEM_DEADLINE_RULES) {
    // tenantId null olduğu için compound unique ile upsert yapılamaz; findFirst kullanılır.
    const existing = await prisma.deadlineRule.findFirst({
      where: { tenantId: null, key: r.key },
    });
    if (existing) {
      // Faz 1 denetim düzeltmeleri: mevcut satırların süre/dayanak/rejim
      // alanlarını tek kaynakla hizala (eski hatalı değerler kalmasın).
      await prisma.deadlineRule.update({
        where: { id: existing.id },
        data: {
          name: r.name,
          description: r.description,
          durationValue: r.durationValue,
          durationUnit: r.durationUnit as Prisma.DeadlineRuleCreateInput["durationUnit"],
          legalBasis: r.legalBasis,
          caseTypes: r.caseTypes,
          judicialRecessApplies: r.judicialRecessApplies,
          recessRule: (r.recessRule ?? "HMK_104") as Prisma.DeadlineRuleCreateInput["recessRule"],
          procedureCode: (r.procedureCode ?? "HMK") as Prisma.DeadlineRuleCreateInput["procedureCode"],
        },
      });
      continue;
    }
    await prisma.deadlineRule.create({
      data: {
        tenantId: null,
        key: r.key,
        name: r.name,
        description: r.description,
        durationValue: r.durationValue,
        durationUnit: r.durationUnit as Prisma.DeadlineRuleCreateInput["durationUnit"],
        legalBasis: r.legalBasis,
        caseTypes: r.caseTypes,
        // Adli tatil rejimi ARTIK VERİTABANINDA: motor bu değerleri kuraldan
        // okur, kullanıcı istek gövdesinden değil (denetim bulgusu 3).
        judicialRecessApplies: r.judicialRecessApplies,
        recessRule: (r.recessRule ?? "HMK_104") as Prisma.DeadlineRuleCreateInput["recessRule"],
        procedureCode: (r.procedureCode ?? "HMK") as Prisma.DeadlineRuleCreateInput["procedureCode"],
        isActive: true,
        isSystem: true,
      },
    });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// 2) 2026 tatilleri
// ---------------------------------------------------------------------------

type HolidaySeed = {
  date: Date;
  name: string;
  type: "RESMI_TATIL" | "ADLI_TATIL";
  isHalfDay: boolean;
  isApproximate: boolean;
};

/**
 * TEK KAYNAK: 2026 tatil takvimi `@nomosos/legal-core`'dan gelir.
 *
 * Arife (yarım gün) satırları `isHalfDay: true` taşır. 2429 s.K. m.2/A uyarınca
 * bu günlerde saat 13.00'e kadar mesai vardır; motor onları çalışılmayan gün
 * SAYMAZ, yalnızca "işlemi 13.00'ten önce tamamlayınız" uyarısı üretir
 * (denetim bulgusu 1).
 */
const OFFICIAL_HOLIDAYS_2026: HolidaySeed[] = TR_HOLIDAYS_2026.map((h) => ({
  date: parseDateOnly(h.date),
  name: h.name,
  type: "RESMI_TATIL" as const,
  isHalfDay: h.isHalfDay === true,
  isApproximate: h.isApproximate === true,
}));

/** Adli tatil: her yıl 20 Temmuz – 31 Ağustos (HMK m.102). */
function judicialRecess2026(): HolidaySeed[] {
  return expandJudicialRecess(2026).map((h) => ({
    date: new Date(h.date),
    name: h.name ?? "Adli tatil (20 Temmuz – 31 Ağustos)",
    type: "ADLI_TATIL" as const,
    isHalfDay: false,
    isApproximate: false,
  }));
}

async function seedHolidays(): Promise<{ official: number; recess: number }> {
  const official = OFFICIAL_HOLIDAYS_2026;
  const recess = judicialRecess2026();
  for (const h of [...official, ...recess]) {
    await prisma.holiday.upsert({
      where: { date_type_name: { date: h.date, type: h.type, name: h.name } },
      update: { isHalfDay: h.isHalfDay, isApproximate: h.isApproximate },
      create: {
        date: h.date,
        name: h.name,
        type: h.type,
        year: h.date.getUTCFullYear(),
        isHalfDay: h.isHalfDay,
        isApproximate: h.isApproximate,
      },
    });
  }
  return { official: official.length, recess: recess.length };
}

// ---------------------------------------------------------------------------
// 3) Demo veri yardımcıları (hepsi "varsa atla" mantığıyla)
// ---------------------------------------------------------------------------

async function ensureClient(
  name: string,
  data: Omit<Prisma.ClientUncheckedCreateInput, "tenantId" | "name" | "id">,
  contacts: Prisma.ClientContactCreateWithoutClientInput[] = [],
) {
  const existing = await prisma.client.findFirst({ where: { tenantId: TENANT_ID, name } });
  if (existing) {
    // Faz 1 alanları (category/referenceCode) eski kayıtlarda boş olabilir — tamamla.
    return prisma.client.update({
      where: { id: existing.id },
      data: { category: data.category, referenceCode: data.referenceCode },
    });
  }
  return prisma.client.create({
    data: {
      ...data,
      tenantId: TENANT_ID,
      name,
      contacts: contacts.length ? { create: contacts } : undefined,
    },
  });
}

async function ensureCase(
  title: string,
  data: Omit<Prisma.CaseUncheckedCreateInput, "tenantId" | "title" | "id">,
  parties: Prisma.CasePartyCreateWithoutCaseInput[],
  timeline: Array<{ title: string; detail?: string; date: Date; source?: string }>,
) {
  const existing = await prisma.case.findFirst({ where: { tenantId: TENANT_ID, title } });
  if (existing) return { record: existing, isNew: false as const };
  const record = await prisma.case.create({
    data: {
      ...data,
      tenantId: TENANT_ID,
      title,
      parties: { create: parties },
      timelineEvents: {
        create: timeline.map((t) => ({
          tenantId: TENANT_ID,
          title: t.title,
          detail: t.detail,
          date: t.date,
          source: t.source ?? "MANUEL",
        })),
      },
    },
  });
  return { record, isNew: true as const };
}

async function ensureHearing(caseId: string, data: Omit<Prisma.HearingUncheckedCreateInput, "tenantId" | "caseId">) {
  const existing = await prisma.hearing.findFirst({ where: { caseId, date: data.date as Date } });
  if (existing) return existing;
  return prisma.hearing.create({ data: { ...data, tenantId: TENANT_ID, caseId } });
}

async function ensureDeadline(
  caseId: string,
  title: string,
  data: Omit<Prisma.DeadlineUncheckedCreateInput, "tenantId" | "caseId" | "title">,
) {
  const existing = await prisma.deadline.findFirst({ where: { caseId, title } });
  if (existing) return existing;
  return prisma.deadline.create({ data: { ...data, tenantId: TENANT_ID, caseId, title } });
}

async function ensureTask(
  caseId: string,
  title: string,
  data: Omit<Prisma.TaskUncheckedCreateInput, "tenantId" | "caseId" | "title">,
) {
  const existing = await prisma.task.findFirst({ where: { caseId, title } });
  if (existing) return existing;
  return prisma.task.create({ data: { ...data, tenantId: TENANT_ID, caseId, title } });
}

async function ensureNote(caseId: string, userId: string, content: string, isPinned = false) {
  const existing = await prisma.caseNote.findFirst({ where: { caseId, content } });
  if (existing) return existing;
  return prisma.caseNote.create({ data: { tenantId: TENANT_ID, caseId, userId, content, isPinned } });
}

async function ensureDecision(
  caseId: string,
  data: Omit<Prisma.CaseDecisionUncheckedCreateInput, "tenantId" | "caseId">,
) {
  const existing = await prisma.caseDecision.findFirst({
    where: { caseId, type: data.type as Prisma.CaseDecisionUncheckedCreateInput["type"], date: data.date as Date },
  });
  if (existing) return existing;
  return prisma.caseDecision.create({ data: { ...data, tenantId: TENANT_ID, caseId } });
}

// ---------------------------------------------------------------------------
// Faz 2 — Sistem dilekçe şablonları
// ---------------------------------------------------------------------------

/**
 * Bölüm başlıkları packages/udf `PETITION_SECTION_TITLES` ile BİREBİR aynıdır.
 * (Paket bağımlılığı eklemek yerine sabit kopyalanmıştır; başlık değişirse iki
 * yerde birden güncellenmelidir.)
 */
const SEC = {
  subject: "KONU",
  explanations: "AÇIKLAMALAR",
  legalGrounds: "HUKUKİ SEBEPLER",
  evidence: "DELİLLER",
  request: "SONUÇ VE İSTEM",
  attachments: "EKLER",
} as const;

type TemplateSection = { title: string; hint: string; required: boolean };

interface PetitionTemplateSeed {
  key: string;
  name: string;
  petitionType: Prisma.PetitionTemplateUncheckedCreateInput["petitionType"];
  sections: TemplateSection[];
}

/** Standart beş bölüm; ipuçları dilekçe türüne göre özelleştirilir. */
function standardSections(hints: Partial<Record<keyof typeof SEC, string>>): TemplateSection[] {
  return [
    { title: SEC.subject, hint: hints.subject ?? "Talebin tek cümlelik özeti.", required: true },
    {
      title: SEC.explanations,
      hint: hints.explanations ?? "Maddi vakıalar tarih sırasıyla; her iddia dosyadaki bir belgeye dayanmalıdır.",
      required: true,
    },
    {
      title: SEC.legalGrounds,
      hint: hints.legalGrounds ?? "Yalnızca doğrulanmış madde referansları yazılır; uydurma madde YASAKTIR.",
      required: true,
    },
    { title: SEC.evidence, hint: hints.evidence ?? "Dosyadaki belgeler, tanık, bilirkişi, keşif vb.", required: true },
    { title: SEC.request, hint: hints.request ?? "Mahkemeden istenen hüküm ve yargılama giderleri/vekalet ücreti.", required: true },
  ];
}

const SYSTEM_PETITION_TEMPLATES: PetitionTemplateSeed[] = [
  {
    key: "SISTEM_DAVA_DILEKCESI",
    name: "Dava Dilekçesi (HMK m.119)",
    petitionType: "DAVA_DILEKCESI",
    sections: standardSections({
      subject: "Dava konusu ve talep edilen miktar/hak (HMK m.119/1-d, ğ).",
      explanations: "Vakıalar tarih sırasıyla; taraflar arasındaki ilişki, uyuşmazlığın doğuşu ve zarar.",
      request: "Davanın kabulü ile talebin hüküm altına alınması, yargılama gideri ve vekalet ücreti.",
    }),
  },
  {
    key: "SISTEM_CEVAP_DILEKCESI",
    name: "Cevap Dilekçesi (HMK m.129)",
    petitionType: "CEVAP",
    sections: [
      { title: SEC.subject, hint: "Davaya cevaplarımızın sunulmasıdır.", required: true },
      {
        title: "USULE İLİŞKİN İTİRAZLARIMIZ",
        hint: "Görev, yetki, derdestlik, husumet, zamanaşımı gibi ilk itirazlar (HMK m.116) — SÜRESİNDE ileri sürülmelidir.",
        required: false,
      },
      {
        title: SEC.explanations,
        hint: "Davacının iddiaları sırasıyla ele alınır; kabul edilen ve inkâr edilen vakıalar ayrı ayrı belirtilir.",
        required: true,
      },
      { title: SEC.legalGrounds, hint: "Yalnızca doğrulanmış madde referansları.", required: true },
      { title: SEC.evidence, hint: "Karşı delillerimiz ve delil başlangıcı niteliğindeki belgeler.", required: true },
      { title: SEC.request, hint: "Davanın reddine, yargılama gideri ve vekalet ücretinin karşı tarafa yükletilmesine.", required: true },
    ],
  },
  {
    key: "SISTEM_ISTINAF_DILEKCESI",
    name: "İstinaf Başvuru Dilekçesi (HMK m.342)",
    petitionType: "ISTINAF",
    sections: [
      { title: SEC.subject, hint: "İlk derece kararının kaldırılması istemi; karar esas/karar no ve tebliğ tarihi.", required: true },
      {
        title: "İSTİNAF SEBEPLERİMİZ",
        hint: "Her sebep ayrı başlık altında; kararın hangi kısmına, hangi gerekçeyle itiraz edildiği (HMK m.342/1-e).",
        required: true,
      },
      { title: SEC.explanations, hint: "Yerel mahkeme kararındaki maddi ve hukuki hataların açıklanması.", required: true },
      { title: SEC.legalGrounds, hint: "İhlal edildiği ileri sürülen madde referansları.", required: true },
      { title: SEC.evidence, hint: "Dosya kapsamı ve istinaf aşamasında ileri sürülebilen deliller (HMK m.357 sınırı).", required: true },
      { title: SEC.request, hint: "Kararın kaldırılarak davanın kabulü/reddi; yeniden yargılama talebi.", required: true },
    ],
  },
  {
    key: "SISTEM_BILIRKISI_ITIRAZ",
    name: "Bilirkişi Raporuna İtiraz Dilekçesi (HMK m.281)",
    petitionType: "BILIRKISI_ITIRAZ",
    sections: [
      { title: SEC.subject, hint: "Bilirkişi raporuna itirazlarımızın sunulması; rapor tarihi ve tebliğ tarihi.", required: true },
      {
        title: "İTİRAZLARIMIZ",
        hint: "Rapordaki her hatalı tespit için: rapor sayfası/paragrafı + itiraz gerekçesi (SAYFA REFERANSI ZORUNLU).",
        required: true,
      },
      { title: SEC.explanations, hint: "Raporun eksik incelemeye dayandığı yönler ve doğru hesap yöntemi.", required: true },
      { title: SEC.legalGrounds, hint: "HMK m.281 ve uyuşmazlığa özgü maddeler.", required: true },
      { title: SEC.evidence, hint: "Dosyadaki belgeler, ek belge ve varsa uzman görüşü (HMK m.293).", required: true },
      { title: SEC.request, hint: "Ek rapor alınması veya yeni bilirkişi heyeti oluşturulması talebi.", required: true },
    ],
  },
  {
    key: "SISTEM_ICRA_TAKIP_TALEBI",
    name: "İcra Takip Talebi Ekli Dilekçe (İİK m.58)",
    petitionType: "ICRA_TAKIP_TALEBI",
    sections: [
      { title: SEC.subject, hint: "Takip konusu alacak, dayanağı ve takip yolu (ilamlı/ilamsız).", required: true },
      { title: SEC.explanations, hint: "Alacağın doğumu, muacceliyet tarihi ve borçlunun temerrüdü.", required: true },
      { title: "ALACAK KALEMLERİ", hint: "Asıl alacak, işlemiş faiz, faiz oranı ve başlangıç tarihi ayrı ayrı.", required: true },
      { title: SEC.legalGrounds, hint: "İİK ve alacağın kaynağına ilişkin maddeler. ADLİ TATİL İİK süreleri için durmaz.", required: true },
      { title: SEC.evidence, hint: "Senet/fatura/sözleşme, ihtarname ve tebliğ belgeleri.", required: true },
      { title: SEC.request, hint: "Takibin başlatılması ve ödeme/icra emri gönderilmesi.", required: true },
    ],
  },
  {
    key: "SISTEM_DELIL_LISTESI",
    name: "Delil Listesi (HMK m.140/5)",
    petitionType: "DELIL_LISTESI",
    sections: [
      { title: SEC.subject, hint: "Delil listemizin sunulmasıdır; iki haftalık kesin süreye dikkat.", required: true },
      { title: SEC.evidence, hint: "Her delil numaralandırılır; belge delilleri dosya adıyla eşleştirilir.", required: true },
      {
        title: "TOPLANMASI İSTENEN DELİLLER",
        hint: "Müzekkere yazılacak kurumlar, tanık ad/adres bilgileri, bilirkişi ve keşif talepleri.",
        required: false,
      },
      { title: SEC.attachments, hint: "Sunulan belgelerin dizin listesi.", required: false },
      { title: SEC.request, hint: "Delillerimizin kabulü ve toplanması talebi.", required: true },
    ],
  },
];

/**
 * Sistem dilekçe şablonlarını ekler.
 *
 * DİKKAT: `tenantId` null olduğu için @@unique([tenantId, key]) üzerinden `upsert`
 * YAPILAMAZ (Postgres'te NULL eşitliği kurulmaz, Prisma compound unique'e null kabul
 * etmez). DeadlineRule'daki gibi findFirst + create/update deseni kullanılır.
 */
async function seedPetitionTemplates(): Promise<number> {
  let created = 0;
  for (const t of SYSTEM_PETITION_TEMPLATES) {
    const sectionsJson = JSON.stringify(t.sections);
    const existing = await prisma.petitionTemplate.findFirst({
      where: { tenantId: null, key: t.key },
    });
    if (existing) {
      await prisma.petitionTemplate.update({
        where: { id: existing.id },
        data: { name: t.name, petitionType: t.petitionType, sectionsJson, isSystem: true },
      });
      continue;
    }
    await prisma.petitionTemplate.create({
      data: { tenantId: null, key: t.key, name: t.name, petitionType: t.petitionType, sectionsJson, isSystem: true },
    });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Faz 2 — Örnek içtihat kayıtları (kiracıdan bağımsız ortak havuz)
// ---------------------------------------------------------------------------

/**
 * UYARI: Aşağıdaki kararlar GERÇEK DEĞİLDİR; arayüz ve arama akışını denemek için
 * üretilmiş demo kayıtlardır. Gerçek sanılmamaları için summary alanı "[DEMO VERİ]"
 * ön ekiyle başlar ve sourceAdapter = "SEED_DEMO" olarak işaretlenir. Üretim
 * ortamında içtihat havuzu gerçek adaptörlerle doldurulmalıdır.
 */
const DEMO_CASE_LAW = [
  {
    court: "Yargıtay 9. Hukuk Dairesi",
    chamber: "9. HD",
    caseNumber: "2024/9001",
    decisionNumber: "2024/9101",
    decisionDate: utc(2024, 3, 14),
    summary:
      "[DEMO VERİ] Fazla çalışma iddiasının ispatında işyeri kayıtları ile tanık beyanlarının birlikte değerlendirilmesi; hesaplamadan makul indirim yapılması gereğine ilişkin örnek karar özeti.",
    fullText:
      "[DEMO VERİ — GERÇEK KARAR DEĞİLDİR] Bu metin, NomosOS içtihat arama ve atıf doğrulama akışını denemek için üretilmiş örnek içeriktir. Dilekçede kaynak olarak KULLANILMAMALIDIR.",
  },
  {
    court: "Yargıtay 11. Hukuk Dairesi",
    chamber: "11. HD",
    caseNumber: "2023/7742",
    decisionNumber: "2023/7810",
    decisionDate: utc(2023, 11, 2),
    summary:
      "[DEMO VERİ] Ayıplı mal teslimi nedeniyle tazminat talebinde ihbar külfetinin yerine getirilmesi ve zararın bilirkişi incelemesiyle belirlenmesine ilişkin örnek karar özeti.",
    fullText:
      "[DEMO VERİ — GERÇEK KARAR DEĞİLDİR] Bu metin, NomosOS içtihat arama ve atıf doğrulama akışını denemek için üretilmiş örnek içeriktir. Dilekçede kaynak olarak KULLANILMAMALIDIR.",
  },
  {
    court: "İstanbul Bölge Adliye Mahkemesi 12. Hukuk Dairesi",
    chamber: "12. HD",
    caseNumber: "2025/1188",
    decisionNumber: "2025/1345",
    decisionDate: utc(2025, 5, 21),
    summary:
      "[DEMO VERİ] İtirazın iptali davasında icra inkâr tazminatına hükmedilebilmesi için alacağın likit olması koşuluna ilişkin örnek karar özeti.",
    fullText:
      "[DEMO VERİ — GERÇEK KARAR DEĞİLDİR] Bu metin, NomosOS içtihat arama ve atıf doğrulama akışını denemek için üretilmiş örnek içeriktir. Dilekçede kaynak olarak KULLANILMAMALIDIR.",
  },
];

async function seedCaseLaw(): Promise<number> {
  let created = 0;
  for (const d of DEMO_CASE_LAW) {
    const existing = await prisma.caseLawDocument.findUnique({
      where: {
        court_caseNumber_decisionNumber: {
          court: d.court,
          caseNumber: d.caseNumber,
          decisionNumber: d.decisionNumber,
        },
      },
    });
    if (existing) continue;
    await prisma.caseLawDocument.create({ data: { ...d, sourceAdapter: "SEED_DEMO" } });
    created += 1;
  }
  return created;
}

/** Dosyanın nextHearingAt / lastActivityAt alanlarını mevcut verilerden türetir. */
async function refreshCaseDenormals(caseId: string) {
  const next = await prisma.hearing.findFirst({
    where: { caseId, status: "PLANLANDI", date: { gte: new Date() } },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const lastEvent = await prisma.timelineEvent.findFirst({
    where: { caseId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  await prisma.case.update({
    where: { id: caseId },
    data: { nextHearingAt: next?.date ?? null, lastActivityAt: lastEvent?.date ?? new Date() },
  });
}

// ---------------------------------------------------------------------------
// Faz 3 — İcra / Finans / Platform demo verisi
// ---------------------------------------------------------------------------
//
// PARA: tutarlar STRING olarak verilir; Prisma bunları Decimal(18,2) olarak
// saklar. JS number ile tutar yazılmaz (float yuvarlama hatası).

/** Bugünden n gün önce, UTC gün başı (@db.Date alanları için). */
function utcDaysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

const PLAN_TIERS: Array<{
  key: string;
  name: string;
  monthlyPricePerUser: string | null;
  maxUsers: number | null;
  features: Record<string, unknown>;
}> = [
  {
    key: "SOLO",
    name: "Solo",
    monthlyPricePerUser: "1500.00",
    maxUsers: 2,
    features: { aiCallQuota: 1000, storageGb: 10, modules: ["dosya", "sure", "gorev", "ai"] },
  },
  {
    key: "BURO",
    name: "Büro",
    monthlyPricePerUser: "1200.00",
    maxUsers: 25,
    features: {
      aiCallQuota: 10000,
      storageGb: 200,
      modules: ["dosya", "sure", "gorev", "ai", "icra", "finans", "faturalama"],
    },
  },
  {
    key: "ENTERPRISE",
    name: "Kurumsal",
    monthlyPricePerUser: "950.00",
    maxUsers: null,
    features: {
      aiCallQuota: null,
      storageGb: null,
      modules: ["dosya", "sure", "gorev", "ai", "icra", "finans", "faturalama", "sso", "ozel-model"],
    },
  },
];

async function seedPlanTiers(): Promise<number> {
  let created = 0;
  for (const p of PLAN_TIERS) {
    const existing = await prisma.planTier.findUnique({ where: { key: p.key } });
    if (existing) continue;
    await prisma.planTier.create({
      data: {
        key: p.key,
        name: p.name,
        monthlyPricePerUser: p.monthlyPricePerUser,
        maxUsers: p.maxUsers,
        featuresJson: JSON.stringify(p.features),
        isActive: true,
      },
    });
    created += 1;
  }
  return created;
}

/**
 * Platform yöneticileri — tenant User tablosundan TAMAMEN ayrıdır.
 * Bu hesaplar yalnız /api/admin/v1 uçlarında geçerlidir.
 */
async function seedPlatformUsers(passwordHash: string): Promise<number> {
  const users: Array<{ email: string; fullName: string; role: "SUPER_ADMIN" | "ANALYST_READONLY" }> = [
    { email: "superadmin@nomosos.local", fullName: "Platform Süper Yönetici", role: "SUPER_ADMIN" },
    { email: "analist@nomosos.local", fullName: "Platform Analisti", role: "ANALYST_READONLY" },
  ];
  let created = 0;
  for (const u of users) {
    const existing = await prisma.platformUser.findUnique({ where: { email: u.email } });
    if (existing) continue;
    await prisma.platformUser.create({
      data: { email: u.email, passwordHash, fullName: u.fullName, role: u.role, isActive: true },
    });
    created += 1;
  }
  return created;
}

async function seedSubscription(): Promise<boolean> {
  const existing = await prisma.subscription.findUnique({ where: { tenantId: TENANT_ID } });
  if (existing) return false;
  const start = utcDaysAgo(10);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  await prisma.subscription.create({
    data: {
      tenantId: TENANT_ID,
      planKey: "BURO",
      status: "ACTIVE",
      seats: 5,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      note: "Demo kiracı — el ile açıldı.",
    },
  });
  return true;
}

/** Son 14 günün kullanım fotoğrafları (gerçekçi, artan). */
async function seedUsageSnapshots(): Promise<number> {
  let created = 0;
  for (let i = 13; i >= 0; i -= 1) {
    const date = utcDaysAgo(i);
    const step = 13 - i; // 0..13
    const existing = await prisma.usageSnapshot.findUnique({
      where: { tenantId_date: { tenantId: TENANT_ID, date } },
    });
    if (existing) continue;
    await prisma.usageSnapshot.create({
      data: {
        tenantId: TENANT_ID,
        date,
        activeUsers: 2 + (step % 3),
        caseCount: 5,
        documentCount: 12 + step * 2,
        aiCallCount: 18 + step * 4,
        aiInputTokens: 24_000 + step * 5_200,
        aiOutputTokens: 6_500 + step * 1_400,
        // DİKKAT: BigInt — API'de JSON'a çevrilirken Number()/String() gerekir.
        storageBytes: BigInt(1_200_000_000 + step * 45_000_000),
      },
    });
    created += 1;
  }
  return created;
}

/** İcra dosyası + safahat + malvarlığı + tahsilat (mevcut ICRA tipli Case'e). */
async function seedEnforcement(caseId: string, userId: string) {
  let file = await prisma.enforcementFile.findUnique({ where: { caseId } });
  if (!file) {
    file = await prisma.enforcementFile.create({
      data: {
        tenantId: TENANT_ID,
        caseId,
        officeName: "İstanbul 9. İcra Dairesi",
        fileNumber: "2026/8842",
        trackingType: "ILAMSIZ",
        stage: "ITIRAZ",
        principalAmount: "347500.00",
        interestRate: "48.00",
        currency: "TRY",
        requestDate: utc(2026, 6, 3),
        paymentOrderServedAt: utc(2026, 6, 18),
        objectionDate: utc(2026, 6, 24),
        debtorInfo: "Yıldız Lojistik Ltd. Şti. — Vergi no 5556667778, Tuzla/İstanbul",
      },
    });
  }

  const actions: Array<Prisma.EnforcementActionUncheckedCreateInput> = [
    {
      tenantId: TENANT_ID,
      enforcementFileId: file.id,
      type: "TAKIP_TALEBI",
      date: utc(2026, 6, 3),
      description: "İlamsız takip talebi verildi; asıl alacak 347.500,00 TL.",
      amount: "347500.00",
      createdBy: userId,
    },
    {
      tenantId: TENANT_ID,
      enforcementFileId: file.id,
      type: "ODEME_EMRI",
      date: utc(2026, 6, 18),
      description: "Ödeme emri borçluya elden tebliğ edildi.",
      resultNote: "Tebliğ tarihi itiraz süresinin başlangıcıdır (İİK m.62 — 7 gün).",
      createdBy: userId,
    },
    {
      tenantId: TENANT_ID,
      enforcementFileId: file.id,
      type: "ITIRAZ",
      date: utc(2026, 6, 24),
      description: "Borçlu borca ve faize itiraz etti; takip durdu.",
      resultNote: "İtirazın kaldırılması / itirazın iptali yolu değerlendirilecek.",
      createdBy: userId,
    },
  ];
  let actionCount = 0;
  for (const a of actions) {
    const existing = await prisma.enforcementAction.findFirst({
      where: { enforcementFileId: file.id, type: a.type as never, date: a.date as Date },
    });
    if (existing) continue;
    await prisma.enforcementAction.create({ data: a });
    actionCount += 1;
  }

  const assets: Array<Prisma.AssetRecordUncheckedCreateInput> = [
    {
      tenantId: TENANT_ID,
      enforcementFileId: file.id,
      assetType: "BANKA_HESABI",
      description: "X Bankası ticari hesap (IBAN ...**** 4471)",
      estimatedValue: "82000.00",
      status: "TESPIT_EDILDI",
      discoveredAt: utc(2026, 7, 2),
      note: "UYAP banka sorgusu — bakiye anlık, haciz sonrası teyit edilecek.",
    },
    {
      tenantId: TENANT_ID,
      enforcementFileId: file.id,
      assetType: "ARAC",
      description: "2019 model çekici (plaka 34 *** 12)",
      estimatedValue: "1450000.00",
      status: "HACZEDILDI",
      discoveredAt: utc(2026, 7, 9),
      note: "Trafik siciline haciz şerhi işlendi.",
    },
  ];
  let assetCount = 0;
  for (const a of assets) {
    const existing = await prisma.assetRecord.findFirst({
      where: { enforcementFileId: file.id, description: a.description },
    });
    if (existing) continue;
    await prisma.assetRecord.create({ data: a });
    assetCount += 1;
  }

  let collectionCount = 0;
  const collectionExists = await prisma.collectionRecord.findFirst({
    where: { enforcementFileId: file.id, date: utc(2026, 8, 12) },
  });
  if (!collectionExists) {
    await prisma.collectionRecord.create({
      data: {
        tenantId: TENANT_ID,
        enforcementFileId: file.id,
        amount: "42000.00",
        date: utc(2026, 8, 12),
        method: "BANKA",
        note: "Banka hesabı haczinden gelen kısmi tahsilat.",
        createdBy: userId,
      },
    });
    collectionCount = 1;
  }

  return { file, actionCount, assetCount, collectionCount };
}

/** Ücret sözleşmesi + zaman kayıtları + fatura (2 satır) + tahsilat. */
async function seedFinance(clientId: string, caseId: string, userId: string) {
  // --- Ücret sözleşmesi (saatlik, KDV %20) --------------------------------
  let agreement = await prisma.feeAgreement.findFirst({ where: { tenantId: TENANT_ID, clientId, caseId } });
  if (!agreement) {
    agreement = await prisma.feeAgreement.create({
      data: {
        tenantId: TENANT_ID,
        clientId,
        caseId,
        type: "SAATLIK",
        hourlyRate: "4500.00",
        currency: "TRY",
        vatRate: "20.00",
        startDate: utc(2026, 3, 1),
        terms: "Saatlik 4.500,00 TL + KDV. Masraflar ayrıca yansıtılır.",
        status: "AKTIF",
      },
    });
  }

  // --- Zaman kayıtları: 180 + 90 + 180 = 450 dk = 7,50 saat ---------------
  const entries: Array<{ date: Date; minutes: number; description: string }> = [
    { date: utc(2026, 8, 4), minutes: 180, description: "Bilirkişi raporunun incelenmesi ve itiraz notlarının çıkarılması" },
    { date: utc(2026, 8, 11), minutes: 90, description: "Müvekkil toplantısı — strateji görüşmesi" },
    { date: utc(2026, 8, 19), minutes: 180, description: "Bilirkişi raporuna itiraz dilekçesinin kaleme alınması" },
  ];
  let entryCount = 0;
  for (const e of entries) {
    const existing = await prisma.timeEntry.findFirst({
      where: { tenantId: TENANT_ID, caseId, date: e.date, description: e.description },
    });
    if (existing) continue;
    await prisma.timeEntry.create({
      data: {
        tenantId: TENANT_ID,
        userId,
        caseId,
        clientId,
        date: e.date,
        minutes: e.minutes,
        description: e.description,
        billable: true,
        hourlyRate: "4500.00",
      },
    });
    entryCount += 1;
  }

  // --- Fatura: 7,50 sa × 4.500 = 33.750 + 6.250 masraf = 40.000 net -------
  //     KDV %20 = 8.000 · Genel toplam = 48.000 (tamamı Decimal aritmetiği)
  const invoiceNo = "NOM2026-000001";
  let invoice = await prisma.invoice.findFirst({ where: { tenantId: TENANT_ID, invoiceNo } });
  let invoiceCreated = false;
  if (!invoice) {
    invoice = await prisma.invoice.create({
      data: {
        tenantId: TENANT_ID,
        clientId,
        invoiceNo,
        issueDate: utc(2026, 8, 25),
        dueDate: utc(2026, 9, 24),
        subtotal: "40000.00",
        vatAmount: "8000.00",
        total: "48000.00",
        currency: "TRY",
        status: "KISMI_ODENDI",
        eInvoiceStatus: "YOK", // Entegratör yapılandırılmamış (NoopEInvoiceAdapter)
        note: "Ağustos 2026 vekâlet ücreti ve masraf yansıtması.",
        createdBy: userId,
        lines: {
          create: [
            {
              description: "Vekâlet ücreti — Ağustos 2026 (7,50 saat × 4.500,00 TL)",
              quantity: "7.50",
              unitPrice: "4500.00",
              vatRate: "20.00",
              lineTotal: "33750.00",
              sourceType: "TIME_ENTRY",
            },
            {
              description: "Dosya masrafları yansıtması (harç, bilirkişi avansı)",
              quantity: "1.00",
              unitPrice: "6250.00",
              vatRate: "20.00",
              lineTotal: "6250.00",
              sourceType: "EXPENSE",
            },
          ],
        },
      },
    });
    invoiceCreated = true;
  }

  // Faturalanan zaman kayıtlarını işaretle (invoiceId SKALER alandır).
  await prisma.timeEntry.updateMany({
    where: { tenantId: TENANT_ID, caseId, billable: true, invoiceId: null },
    data: { invoiceId: invoice.id },
  });

  let paymentCount = 0;
  const paymentExists = await prisma.payment.findFirst({
    where: { tenantId: TENANT_ID, invoiceId: invoice.id, reference: "DEK-2026-0001" },
  });
  if (!paymentExists) {
    await prisma.payment.create({
      data: {
        tenantId: TENANT_ID,
        invoiceId: invoice.id,
        clientId,
        amount: "20000.00",
        date: utc(2026, 8, 28),
        method: "HAVALE",
        reference: "DEK-2026-0001",
        note: "Kısmi ödeme.",
        createdBy: userId,
      },
    });
    paymentCount = 1;
  }

  return { agreement, entryCount, invoiceCreated, paymentCount };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: { id: TENANT_ID, name: "Demo Hukuk Bürosu" },
  });

  const passwordHash = await bcrypt.hash("Demo1234!", 10);

  const partner = await prisma.user.upsert({
    where: { email: "partner@demo.nomosos.local" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "partner@demo.nomosos.local",
      passwordHash,
      fullName: "Av. Demo Partner",
      role: "PARTNER",
      barNumber: "34/12345",
    },
  });

  const avukat = await prisma.user.upsert({
    where: { email: "avukat@demo.nomosos.local" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "avukat@demo.nomosos.local",
      passwordHash,
      fullName: "Av. Demo Avukat",
      role: "AVUKAT",
      barNumber: "34/67890",
    },
  });

  const retiredRules = await retireRemovedSystemRules();
  const ruleCount = await seedDeadlineRules();
  const holidayCounts = await seedHolidays();
  const templateCount = await seedPetitionTemplates();
  const caseLawCount = await seedCaseLaw();

  // ---- Müvekkiller -------------------------------------------------------

  const abc = await ensureClient(
    "ABC Holding A.Ş.",
    {
      type: "TUZEL_KISI",
      taxNumber: "1234567890",
      taxOffice: "Büyük Mükellefler",
      email: "hukuk@abcholding.example",
      phone: "+90 212 000 00 00",
      address: "Maslak Mah. Büyükdere Cad. No:1, Sarıyer/İstanbul",
      category: "Kurumsal",
      referenceCode: "MV-2026-001",
      notes: "Aylık danışmanlık sözleşmesi mevcut.",
    },
    [
      { fullName: "Ayşe Yılmaz", title: "Hukuk Müşaviri", email: "ayse@abcholding.example", phone: "+90 532 000 00 01" },
      { fullName: "Kemal Aksoy", title: "Mali İşler Direktörü", email: "kemal@abcholding.example" },
    ],
  );

  const deniz = await ensureClient(
    "Deniz Tekstil Sanayi ve Ticaret A.Ş.",
    {
      type: "TUZEL_KISI",
      taxNumber: "9876543210",
      taxOffice: "Bursa Kurumlar",
      email: "info@deniztekstil.example",
      phone: "+90 224 000 00 00",
      address: "Organize Sanayi Bölgesi 4. Cad. No:12, Nilüfer/Bursa",
      category: "Kurumsal",
      referenceCode: "MV-2026-002",
      iban: "TR000000000000000000000000",
    },
    [{ fullName: "Selin Kara", title: "Genel Müdür Yardımcısı", email: "selin@deniztekstil.example" }],
  );

  const mehmet = await ensureClient("Mehmet Demir", {
    type: "GERCEK_KISI",
    tckn: "11111111110",
    email: "mehmet.demir@example.com",
    phone: "+90 555 000 00 02",
    address: "Çankaya/Ankara",
    category: "Bireysel",
    referenceCode: "MV-2026-003",
    notes: "İş hukuku ve ceza dosyası birlikte yürüyor.",
  });

  // ---- Dosya 1: Alacak davası (DERDEST) ---------------------------------

  const c1 = await ensureCase(
    "ABC Holding / XYZ İnşaat — Alacak davası",
    {
      clientId: abc.id,
      responsibleUserId: avukat.id,
      type: "DAVA",
      status: "DERDEST",
      courtName: "İstanbul 12. Asliye Ticaret Mahkemesi",
      fileNumber: "2026/145",
      judgeName: "Hâkim A. Yıldırım",
      subject: "Sözleşmeden kaynaklanan alacak",
      amount: "1250000.00",
      openedAt: utc(2026, 3, 10),
    },
    [
      { role: "DAVACI", name: "ABC Holding A.Ş.", isClient: true },
      { role: "DAVALI", name: "XYZ İnşaat Ltd. Şti.", lawyerName: "Av. Karşı Vekil" },
    ],
    [
      { title: "Dava açıldı", detail: "Dava dilekçesi ve delil listesi sunuldu.", date: utc(2026, 3, 10) },
      { title: "Ön inceleme duruşması yapıldı", detail: "Tahkikata geçildi.", date: utc(2026, 5, 12) },
      { title: "Bilirkişi incelemesine karar verildi", detail: "Mali müşavir bilirkişi atandı.", date: utc(2026, 8, 24) },
    ],
  );
  await ensureHearing(c1.record.id, { type: "DURUSMA", status: "PLANLANDI", date: inDays(12), courtroom: "3. Salon" });
  await ensureHearing(c1.record.id, {
    type: "ON_INCELEME",
    status: "YAPILDI",
    date: utc(2026, 5, 12),
    courtroom: "3. Salon",
    note: "Tahkikat aşamasına geçildi; delil listesi kesinleşti.",
    preparedAt: utc(2026, 5, 11),
    prepSummary: "Sözleşme ve fatura asılları hazırlandı.",
  });
  await ensureDeadline(c1.record.id, "Bilirkişi raporuna itiraz süresi", {
    ownerId: avukat.id,
    dueDate: inDays(5, 17),
    source: "KURAL",
    status: "ONAYLANDI",
    legalBasis: "HMK m.281 — 2 hafta",
    computeNote: "Tebliğ tarihinden itibaren 2 hafta; hafta sonu/tatil kaydırması uygulandı.",
    ruleKey: "HMK_BILIRKISI_ITIRAZ",
    triggerDate: inDays(-9),
    serviceMethod: "ETEBLIGAT",
  });
  await ensureDeadline(c1.record.id, "Delil listesi tamamlama süresi", {
    ownerId: avukat.id,
    dueDate: inDays(20, 17),
    source: "MANUEL",
    status: "ONAYLANDI",
    legalBasis: "HMK m.140/5 — 2 hafta",
  });
  await ensureTask(c1.record.id, "Bilirkişi raporuna itiraz dilekçesi taslağı", {
    assigneeId: avukat.id,
    reviewerId: partner.id,
    status: "DEVAM_EDIYOR",
    priority: "YUKSEK",
    dueDate: inDays(3, 17),
    description: "Rapordaki hesaplama hatası ve eksik inceleme yönünden itiraz noktaları çıkarılacak.",
  });
  await ensureTask(c1.record.id, "Duruşma öncesi müvekkil bilgilendirmesi", {
    assigneeId: avukat.id,
    status: "ACIK",
    priority: "NORMAL",
    dueDate: inDays(10, 17),
  });
  await ensureNote(c1.record.id, avukat.id, "Karşı taraf sulh görüşmesine açık; 900.000 TL civarı teklif sinyali verdi.", true);
  await ensureNote(c1.record.id, partner.id, "Bilirkişi raporu müvekkil lehine; itirazda faiz başlangıcına odaklanalım.");
  await ensureDecision(c1.record.id, {
    type: "ARA_KARAR",
    date: utc(2026, 8, 24),
    summary: "Dosyanın mali müşavir bilirkişiye tevdiine, 30 gün süre verilmesine karar verildi.",
  });

  // ---- Dosya 2: İcra takibi (ICRADA) -------------------------------------

  const c2 = await ensureCase(
    "ABC Holding / Yıldız Lojistik — İlamsız icra takibi",
    {
      clientId: abc.id,
      responsibleUserId: avukat.id,
      type: "ICRA",
      status: "ICRADA",
      courtName: "İstanbul 9. İcra Dairesi",
      fileNumber: "2026/8842 E.",
      subject: "Fatura alacağının tahsili",
      amount: "347500.00",
      openedAt: utc(2026, 6, 3),
    },
    [
      { role: "ALACAKLI", name: "ABC Holding A.Ş.", isClient: true },
      { role: "BORCLU", name: "Yıldız Lojistik Ltd. Şti." },
    ],
    [
      { title: "Takip talebi verildi", date: utc(2026, 6, 3) },
      { title: "Ödeme emri tebliğ edildi", detail: "Borçluya elden tebligat yapıldı.", date: utc(2026, 6, 18) },
      { title: "Borçlu itirazı geldi — takip durdu", date: utc(2026, 6, 24) },
    ],
  );
  await ensureHearing(c2.record.id, {
    type: "DURUSMA",
    status: "PLANLANDI",
    date: inDays(26),
    courtroom: "İcra Mahkemesi 1. Salon",
    note: "İtirazın kaldırılması talebi duruşması.",
  });
  await ensureDeadline(c2.record.id, "İtirazın iptali davası açma süresi", {
    ownerId: partner.id,
    dueDate: utc(2027, 6, 24),
    source: "KURAL",
    status: "ONAYLANDI",
    legalBasis: "İİK m.67 — 1 yıl",
    computeNote: "İtirazın tebliği (24.06.2026) + 1 yıl.",
    ruleKey: "IIK_ITIRAZIN_IPTALI",
    triggerDate: utc(2026, 6, 24),
    serviceMethod: "POSTA",
  });
  await ensureTask(c2.record.id, "İtirazın kaldırılması dilekçesi hazırlanması", {
    assigneeId: avukat.id,
    reviewerId: partner.id,
    status: "ACIK",
    priority: "KRITIK",
    dueDate: inDays(2, 17),
  });
  await ensureNote(c2.record.id, avukat.id, "Borçlunun banka hesaplarına haciz için UYAP sorgusu tekrarlanacak.");

  // ---- Dosya 3: İşe iade davası (DERDEST) --------------------------------

  const c3 = await ensureCase(
    "Mehmet Demir / Öz Metal San. A.Ş. — İşe iade davası",
    {
      clientId: mehmet.id,
      responsibleUserId: avukat.id,
      type: "DAVA",
      status: "DERDEST",
      courtName: "Ankara 7. İş Mahkemesi",
      fileNumber: "2026/512",
      subject: "Feshin geçersizliği ve işe iade",
      amount: "285000.00",
      openedAt: utc(2026, 4, 2),
    },
    [
      { role: "DAVACI", name: "Mehmet Demir", isClient: true },
      { role: "DAVALI", name: "Öz Metal Sanayi A.Ş.", lawyerName: "Av. B. Şahin" },
    ],
    [
      { title: "Arabuluculuk son tutanağı düzenlendi", detail: "Anlaşma sağlanamadı.", date: utc(2026, 3, 25) },
      { title: "Dava açıldı", date: utc(2026, 4, 2) },
      { title: "Tanık listesi sunuldu", date: utc(2026, 7, 8) },
    ],
  );
  await ensureHearing(c3.record.id, {
    type: "DURUSMA",
    status: "PLANLANDI",
    date: inDays(4),
    courtroom: "2. Salon",
    note: "Tanık dinlenecek.",
  });
  await ensureDeadline(c3.record.id, "Tanık delil avansı yatırma süresi", {
    ownerId: avukat.id,
    dueDate: inDays(1, 17),
    source: "MANUEL",
    status: "ONAYLANDI",
    legalBasis: "HMK m.324 — 2 hafta",
  });
  await ensureDeadline(c3.record.id, "Cevaba cevap dilekçesi süresi", {
    ownerId: avukat.id,
    dueDate: inDays(-30, 17),
    source: "KURAL",
    status: "TAMAMLANDI",
    legalBasis: "HMK m.136 — 2 hafta",
    ruleKey: "HMK_CEVABA_CEVAP",
    triggerDate: inDays(-44),
    serviceMethod: "ETEBLIGAT",
  });
  await ensureTask(c3.record.id, "Tanıkların duruşmaya hazırlanması", {
    assigneeId: avukat.id,
    status: "DEVAM_EDIYOR",
    priority: "YUKSEK",
    dueDate: inDays(3, 17),
  });
  await ensureNote(c3.record.id, avukat.id, "Müvekkilin SGK hizmet dökümü ve bordroları dosyaya girdi.", true);

  // ---- Dosya 4: Ceza dosyası (ACIK) --------------------------------------

  const c4 = await ensureCase(
    "Mehmet Demir — Taksirle yaralama (trafik)",
    {
      clientId: mehmet.id,
      responsibleUserId: partner.id,
      type: "CEZA",
      status: "ACIK",
      courtName: "Ankara 12. Asliye Ceza Mahkemesi",
      fileNumber: "2026/331",
      subject: "TCK m.89 — taksirle yaralama",
      openedAt: utc(2026, 7, 14),
    },
    [
      { role: "SANIK", name: "Mehmet Demir", isClient: true },
      { role: "MUSTEKI", name: "Hasan Öztürk", lawyerName: "Av. C. Erdem" },
    ],
    [
      { title: "İddianame kabul edildi", date: utc(2026, 7, 14) },
      { title: "Tensip zaptı düzenlendi", detail: "Bilirkişi kusur raporu istendi.", date: utc(2026, 7, 18) },
    ],
  );
  await ensureHearing(c4.record.id, {
    type: "DURUSMA",
    status: "PLANLANDI",
    date: inDays(33),
    courtroom: "5. Salon",
  });
  await ensureDeadline(c4.record.id, "Kusur raporuna itiraz süresi", {
    ownerId: partner.id,
    dueDate: inDays(9, 17),
    source: "AI_ONERISI",
    status: "BEKLIYOR",
    legalBasis: "CMK m.67 — bilirkişi raporuna itiraz",
    computeNote: "AI önerisi — avukat onayı bekliyor.",
  });
  await ensureTask(c4.record.id, "Kaza tespit tutanağı ve kamera kayıtlarının temini", {
    assigneeId: avukat.id,
    reviewerId: partner.id,
    status: "ACIK",
    priority: "NORMAL",
    dueDate: inDays(14, 17),
  });
  await ensureNote(c4.record.id, partner.id, "Uzlaştırma bürosuna sevk ihtimali değerlendirilecek.");

  // ---- Dosya 5: İstinaf aşamasındaki dosya (ISTINAF) ---------------------

  const c5 = await ensureCase(
    "Deniz Tekstil / Kaya Kimya — Ayıplı mal / sözleşmeye aykırılık",
    {
      clientId: deniz.id,
      responsibleUserId: partner.id,
      type: "DAVA",
      status: "ISTINAF",
      courtName: "Bursa Bölge Adliye Mahkemesi 5. Hukuk Dairesi",
      fileNumber: "2026/1187",
      subject: "Ayıplı hammadde nedeniyle tazminat",
      amount: "2150000.00",
      openedAt: utc(2025, 9, 15),
    },
    [
      { role: "DAVACI", name: "Deniz Tekstil Sanayi ve Ticaret A.Ş.", isClient: true },
      { role: "DAVALI", name: "Kaya Kimya A.Ş.", lawyerName: "Av. D. Toprak" },
    ],
    [
      { title: "Dava açıldı", date: utc(2025, 9, 15) },
      { title: "Kısmen kabul kararı verildi", date: utc(2026, 6, 30) },
      { title: "Gerekçeli karar tebliğ edildi", detail: "E-tebligat.", date: utc(2026, 8, 20) },
      { title: "İstinaf dilekçesi sunuldu", date: utc(2026, 8, 28) },
    ],
  );
  await ensureHearing(c5.record.id, {
    type: "DURUSMA",
    status: "YAPILDI",
    date: utc(2026, 6, 30),
    courtroom: "1. Salon",
    note: "Karar duruşması — davanın kısmen kabulüne karar verildi.",
    preparedAt: utc(2026, 6, 29),
    prepSummary: "Bilirkişi raporu ve zarar hesabı özeti hazırlandı.",
  });
  await ensureDeadline(c5.record.id, "İstinaf başvuru süresi", {
    ownerId: partner.id,
    dueDate: utc(2026, 9, 3),
    source: "KURAL",
    status: "TAMAMLANDI",
    legalBasis: "HMK m.345 — 2 hafta",
    computeNote: "Gerekçeli karar tebliği 20.08.2026 + 2 hafta = 03.09.2026.",
    ruleKey: "HMK_ISTINAF",
    triggerDate: utc(2026, 8, 20),
    serviceMethod: "ETEBLIGAT",
  });
  await ensureDeadline(c5.record.id, "İstinaf dilekçesine cevap süresi (karşı taraf)", {
    ownerId: partner.id,
    dueDate: inDays(13, 17),
    source: "KURAL",
    status: "ONAYLANDI",
    legalBasis: "HMK m.347 — 2 hafta",
    ruleKey: "HMK_ISTINAFA_CEVAP",
    triggerDate: inDays(-1),
    serviceMethod: "ETEBLIGAT",
  });
  await ensureTask(c5.record.id, "İstinaf harç ve masraflarının yatırılması", {
    assigneeId: avukat.id,
    status: "TAMAMLANDI",
    priority: "KRITIK",
    dueDate: utc(2026, 8, 29),
  });
  await ensureTask(c5.record.id, "İstinaf dilekçesinin müvekkile raporlanması", {
    assigneeId: partner.id,
    status: "ONAY_BEKLIYOR",
    priority: "NORMAL",
    dueDate: inDays(6, 17),
  });
  await ensureNote(c5.record.id, partner.id, "Reddedilen kısım için istinaf sebepleri: faiz türü ve zarar hesabı yöntemi.", true);
  await ensureDecision(c5.record.id, {
    type: "GEREKCELI_KARAR",
    date: utc(2026, 6, 30),
    summary: "Davanın kısmen kabulüne, 1.180.000 TL tazminatın dava tarihinden itibaren faiziyle tahsiline.",
    outcome: "Kısmen kabul",
  });
  await ensureDecision(c5.record.id, {
    type: "ARA_KARAR",
    date: utc(2026, 2, 11),
    summary: "Ayıp incelemesi için kimya mühendisi bilirkişi atanmasına karar verildi.",
  });

  const cases = [c1, c2, c3, c4, c5];
  for (const c of cases) await refreshCaseDenormals(c.record.id);

  // ---- Faz 3: İcra / Finans / Platform -----------------------------------

  const enforcement = await seedEnforcement(c2.record.id, avukat.id);
  const finance = await seedFinance(abc.id, c1.record.id, avukat.id);
  const planCount = await seedPlanTiers();
  const platformUserCount = await seedPlatformUsers(passwordHash);
  const subscriptionCreated = await seedSubscription();
  const usageCount = await seedUsageSnapshots();

  // ---- Özet --------------------------------------------------------------

  const [
    ruleTotal,
    holidayTotal,
    clientTotal,
    caseTotal,
    hearingTotal,
    deadlineTotal,
    taskTotal,
    noteTotal,
    decisionTotal,
    templateTotal,
    caseLawTotal,
  ] =
    await Promise.all([
      prisma.deadlineRule.count(),
      prisma.holiday.count(),
      prisma.client.count({ where: { tenantId: TENANT_ID } }),
      prisma.case.count({ where: { tenantId: TENANT_ID } }),
      prisma.hearing.count({ where: { tenantId: TENANT_ID } }),
      prisma.deadline.count({ where: { tenantId: TENANT_ID } }),
      prisma.task.count({ where: { tenantId: TENANT_ID } }),
      prisma.caseNote.count({ where: { tenantId: TENANT_ID } }),
      prisma.caseDecision.count({ where: { tenantId: TENANT_ID } }),
      prisma.petitionTemplate.count({ where: { tenantId: null } }),
      prisma.caseLawDocument.count(),
    ]);

  console.log("Seed tamamlandı.");
  console.log(
    `Süre kuralı: ${ruleTotal} (eklenen: ${ruleCount}, pasifleştirilen eski kural: ${retiredRules}) | ` +
      `Tatil: ${holidayTotal} (resmi ${holidayCounts.official}, adli tatil ${holidayCounts.recess} gün)`,
  );
  console.log(
    `Müvekkil: ${clientTotal} | Dosya: ${caseTotal} | Duruşma: ${hearingTotal} | ` +
      `Süre: ${deadlineTotal} | Görev: ${taskTotal} | Not: ${noteTotal} | Karar: ${decisionTotal}`,
  );
  console.log(
    `Sistem dilekçe şablonu: ${templateTotal} (eklenen: ${templateCount}) | ` +
      `İçtihat kaydı: ${caseLawTotal} (eklenen: ${caseLawCount}) — örnek kayıtlar "[DEMO VERİ]" işaretlidir.`,
  );

  const [
    enforcementTotal,
    enforcementActionTotal,
    assetTotal,
    collectionTotal,
    feeAgreementTotal,
    timeEntryTotal,
    invoiceTotal,
    invoiceLineTotal,
    paymentTotal,
    planTotal,
    platformUserTotal,
    subscriptionTotal,
    usageTotal,
  ] = await Promise.all([
    prisma.enforcementFile.count({ where: { tenantId: TENANT_ID } }),
    prisma.enforcementAction.count({ where: { tenantId: TENANT_ID } }),
    prisma.assetRecord.count({ where: { tenantId: TENANT_ID } }),
    prisma.collectionRecord.count({ where: { tenantId: TENANT_ID } }),
    prisma.feeAgreement.count({ where: { tenantId: TENANT_ID } }),
    prisma.timeEntry.count({ where: { tenantId: TENANT_ID } }),
    prisma.invoice.count({ where: { tenantId: TENANT_ID } }),
    prisma.invoiceLine.count(),
    prisma.payment.count({ where: { tenantId: TENANT_ID } }),
    prisma.planTier.count(),
    prisma.platformUser.count(),
    prisma.subscription.count(),
    prisma.usageSnapshot.count({ where: { tenantId: TENANT_ID } }),
  ]);

  console.log(
    `İcra dosyası: ${enforcementTotal} | Safahat: ${enforcementActionTotal} (eklenen ${enforcement.actionCount}) | ` +
      `Malvarlığı: ${assetTotal} (eklenen ${enforcement.assetCount}) | Tahsilat: ${collectionTotal} (eklenen ${enforcement.collectionCount})`,
  );
  console.log(
    `Ücret sözleşmesi: ${feeAgreementTotal} | Zaman kaydı: ${timeEntryTotal} (eklenen ${finance.entryCount}) | ` +
      `Fatura: ${invoiceTotal} (satır ${invoiceLineTotal}, yeni: ${finance.invoiceCreated}) | Ödeme: ${paymentTotal} (eklenen ${finance.paymentCount})`,
  );
  console.log(
    `Plan: ${planTotal} (eklenen ${planCount}) | Platform kullanıcısı: ${platformUserTotal} (eklenen ${platformUserCount}) | ` +
      `Abonelik: ${subscriptionTotal} (yeni: ${subscriptionCreated}) | Kullanım fotoğrafı: ${usageTotal} (eklenen ${usageCount})`,
  );
  console.log("Giriş: partner@demo.nomosos.local / Demo1234!  (veya avukat@demo.nomosos.local)");
  console.log("Platform girişi: superadmin@nomosos.local / Demo1234!  (veya analist@nomosos.local — ANALYST_READONLY)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
