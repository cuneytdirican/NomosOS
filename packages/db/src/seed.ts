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
  SUPPORTED_HOLIDAY_YEARS,
  TR_HOLIDAYS_BY_YEAR,
  expandJudicialRecess,
  parseDateOnly,
} from "@nomosos/legal-core";
import { agentCatalogForSeed } from "@nomosos/shared";
import { buildJudicialCatalog, buildTaxOfficeCatalog } from "./judicial-catalog";

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

/**
 * F2 · E1 — AI ajan tanımları (@nomosos/shared agent-catalog'undan).
 * Katalog TEK KAYNAKtır: kod silinen ajanın satırı burada silinmez,
 * `active: false` yapılır (mezar taşı deseni).
 */
async function seedAgentDefinitions(): Promise<number> {
  const catalog = agentCatalogForSeed();
  const currentKeys = catalog.map((a) => a.agentKey);
  let created = 0;
  for (const agent of catalog) {
    const existing = await prisma.agentDefinition.findUnique({
      where: { agentKey: agent.agentKey },
    });
    if (existing) {
      await prisma.agentDefinition.update({
        where: { id: existing.id },
        data: {
          taskType: agent.taskTypes[0] ?? "CASE_CHAT",
          name: agent.name,
          description: agent.description,
          active: true,
        },
      });
      continue;
    }
    await prisma.agentDefinition.create({
      data: {
        agentKey: agent.agentKey,
        taskType: agent.taskTypes[0] ?? "CASE_CHAT",
        name: agent.name,
        description: agent.description,
        active: true,
      },
    });
    created += 1;
  }
  // Katalogdan çıkarılan ajanlar pasifleşir.
  await prisma.agentDefinition.updateMany({
    where: { agentKey: { notIn: currentKeys }, active: true },
    data: { active: false },
  });
  return created;
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
const OFFICIAL_HOLIDAYS: HolidaySeed[] = SUPPORTED_HOLIDAY_YEARS.flatMap((year) =>
  (TR_HOLIDAYS_BY_YEAR[year] ?? []).map((h) => ({
    date: parseDateOnly(h.date),
    name: h.name,
    type: "RESMI_TATIL" as const,
    isHalfDay: h.isHalfDay === true,
    isApproximate: h.isApproximate === true,
  })),
);

/**
 * Adli tatil: her yıl 20 Temmuz – 31 Ağustos (HMK m.102).
 *
 * DESTEKLENEN HER YIL İÇİN YAZILIR (denetim bulgusu K-04). Eskiden yalnız 2026
 * tohumlanıyordu; süre motorunun tatil penceresi TETİK YILINDAN açıldığı için
 * 2027 tetikli her hesapta sorgu boş dönüyor ve resmî tatiller tamamen yok
 * sayılıyordu.
 */
function judicialRecessDays(): HolidaySeed[] {
  return SUPPORTED_HOLIDAY_YEARS.flatMap((year) =>
    expandJudicialRecess(year).map((h) => ({
      date: new Date(h.date),
      name: h.name ?? "Adli tatil (20 Temmuz – 31 Ağustos)",
      type: "ADLI_TATIL" as const,
      isHalfDay: false,
      isApproximate: false,
    })),
  );
}

async function seedHolidays(): Promise<{ official: number; recess: number }> {
  const official = OFFICIAL_HOLIDAYS;
  const recess = judicialRecessDays();
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
 *
 * İKİ SUPER_ADMIN ZORUNLUDUR (MIN_ACTIVE_SUPER_ADMINS = 2).
 *
 * Tek SUPER_ADMIN'li bir kurulumda DÖRT-GÖZ İLKESİ FİİLEN ÇALIŞMAZ: talep eden
 * kendi talebini onaylayamadığı için askıya alma, iade, bakım kilidi, panel
 * personeli açma gibi işlemlerin HİÇBİRİ tamamlanamaz — ve bu, çalışır
 * sanılan bir kurulumda ilk gerçek olayda fark edilir. İkinci hesap tohumun
 * kendisinde açılır ki kural hem uygulanabilir hem de sınanabilir olsun.
 */
async function seedPlatformUsers(passwordHash: string): Promise<number> {
  const users: Array<{ email: string; fullName: string; role: "SUPER_ADMIN" | "ANALYST_READONLY" }> = [
    { email: "superadmin@nomosos.local", fullName: "Platform Süper Yönetici", role: "SUPER_ADMIN" },
    // Dört-göz onaylarının İKİNCİ İMZASI. Ayrı bir insanı temsil eder.
    { email: "superadmin2@nomosos.local", fullName: "Platform Süper Yönetici (2)", role: "SUPER_ADMIN" },
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
  // YALNIZCA yukarıdaki üç kayıt faturalanır; aşağıda açılan faturalanmamış
  // kayıtlar açıkta bırakılır.
  await prisma.timeEntry.updateMany({
    where: {
      tenantId: TENANT_ID,
      caseId,
      billable: true,
      invoiceId: null,
      date: { in: entries.map((e) => e.date) },
    },
    data: { invoiceId: invoice.id },
  });

  /**
   * FATURALANMAMIŞ ZAMAN KAYITLARI — tohumun eksiğiydi.
   *
   * Faz 3 tohumunda TÜM zaman kayıtları önceden faturalıydı; bu yüzden
   * "zaman kayıtlarından fatura üret" akışı tohumla açıldığında HİÇ
   * çalışmıyor, ekran boş görünüyordu ve çift-faturalama koruması ancak elle
   * kayıt açılarak sınanabiliyordu. Aşağıdaki iki kayıt açıkta bırakılır:
   *   120 dk = 2,00 sa × 4.500,00 =  9.000,00
   *    45 dk = 0,75 sa × 4.500,00 =  3.375,00
   *   ara toplam 12.375,00 · KDV %20 = 2.475,00 · genel toplam 14.850,00
   */
  const unbilled: Array<{ date: Date; minutes: number; description: string }> = [
    { date: utc(2026, 8, 26), minutes: 120, description: "İtiraz dilekçesi sonrası duruşma hazırlığı" },
    { date: utc(2026, 8, 28), minutes: 45, description: "Karşı taraf vekiliyle sulh görüşmesi" },
  ];
  for (const e of unbilled) {
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
        // invoiceId YOK — faturalanmayı bekliyor.
      },
    });
    entryCount += 1;
  }

  /**
   * FİNANS HAREKETLERİ — `FinancialEntry` tablosu tohumla tamamen boştu,
   * dolayısıyla müvekkil cari ekranı ve büro özeti sıfır görünüyordu.
   * Yansıtılabilir (isBillable) bir masraf ve bir harç açılır; ikisi de
   * faturasızdır, yani "masraf yansıtma" akışı tohumla denenebilir.
   */
  const financeMoves: Array<{
    type: "MASRAF" | "HARC";
    amount: string;
    date: Date;
    description: string;
    isBillable: boolean;
  }> = [
    {
      type: "HARC",
      amount: "2750.00",
      date: utc(2026, 8, 6),
      description: "Bilirkişi ücreti avansı (dosya harcı)",
      isBillable: true,
    },
    {
      type: "MASRAF",
      amount: "1480.00",
      date: utc(2026, 8, 13),
      description: "Tebligat ve posta masrafları",
      isBillable: true,
    },
  ];
  let financeEntryCount = 0;
  for (const m of financeMoves) {
    const existing = await prisma.financialEntry.findFirst({
      where: { tenantId: TENANT_ID, caseId, description: m.description },
    });
    if (existing) continue;
    await prisma.financialEntry.create({
      data: {
        tenantId: TENANT_ID,
        clientId,
        caseId,
        type: m.type,
        amount: m.amount,
        currency: "TRY",
        date: m.date,
        description: m.description,
        isBillable: m.isBillable,
      },
    });
    financeEntryCount += 1;
  }

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

  return { agreement, entryCount, invoiceCreated, paymentCount, financeEntryCount };
}

// ---------------------------------------------------------------------------
// Modül 26 — AI kredi sistemi (fiyat listesi, paketler, model maliyetleri)
// ---------------------------------------------------------------------------
//
// FİYATLAR PANELDEN DEĞİŞTİRİLEBİLİR. Bu yüzden seed "varsa DOKUNMA" mantığıyla
// çalışır: platform yöneticisinin panelden yaptığı fiyat düzeltmesi bir sonraki
// seed çalıştırmasında geri alınmaz. Yeni bir görev tipi eklendiğinde satırı
// oluşur, mevcut satırlar korunur.

type TaskCostSeed = { taskType: string; credits: number; isFree: boolean; description: string };

/**
 * docs/moduller/26-ai-kota-kredi-sistemi.md "Kredi Fiyat Listesi" tablosunun
 * TAMAMI + Faz 4'ün yeni görevleri.
 *
 * ÜCRETSİZ LİSTESİ KODA GÖMÜLMEZ (iş kuralı 3): kredi motoru bu satırların
 * `isFree` alanını okur. Ücretsiz olanlar ürünün can damarındaki yüksek hacimli
 * işlerdir — belge sınıflandırmayı krediye bağlarsak büro belge yüklemekten
 * kaçınır ve belge→otomatik aksiyon hattı ölür.
 */
const AI_TASK_COSTS: TaskCostSeed[] = [
  // ---- Ücretsiz (kredi tüketmez) ----
  { taskType: "DOCUMENT_CLASSIFY", credits: 0, isFree: true, description: "Belge sınıflandırma — yüksek hacim, değer döngüsünün girişi." },
  { taskType: "DOCUMENT_EXTRACT", credits: 0, isFree: true, description: "Belgeden yapılandırılmış veri çıkarma — belge hattı bütün olarak ücretsiz." },
  { taskType: "DEADLINE_DETECT", credits: 0, isFree: true, description: "Belgeden süre tespiti — süre kaçırmaya yol açabilecek hiçbir şey krediye bağlanmaz." },
  { taskType: "CITATION_VERIFY", credits: 0, isFree: true, description: "Atıf doğrulama — KAYIT ARAMASI, LLM çağrısı değil." },
  { taskType: "EMBEDDING", credits: 0, isFree: true, description: "Gömme / RAG indeksleme (embedTexts) — yüksek hacim, ucuz model yeterli." },
  {
    taskType: "CASELAW_SUMMARIZE",
    credits: 0,
    isFree: true,
    description:
      "Karar özeti. ÇİFT TAHSİLAT OLMASIN diye ücretsizdir: spec'te 'içtihat AI arama + özet' TEK KALEM 5 kredidir ve CASELAW_SEARCH üzerinden tahsil edilir.",
  },

  // ---- Kredili (muhakeme gerektiren, tek seferde yüksek değer) ----
  { taskType: "CASE_CHAT", credits: 2, isFree: false, description: "Dosya sohbeti — bir soru-cevap." },
  { taskType: "OFFICE_QUERY", credits: 3, isFree: false, description: "Büro geneli sorgu (veri minimizasyonlu plan)." },
  { taskType: "SMART_NOTE", credits: 3, isFree: false, description: "Akıllı not önerisi." },
  { taskType: "CLIENT_STATUS_SUMMARY", credits: 5, isFree: false, description: "Müvekkil durum özeti." },
  { taskType: "CASELAW_SEARCH", credits: 5, isFree: false, description: "İçtihat AI arama + özet (CASELAW_SUMMARIZE dahil, tek tahsilat)." },
  { taskType: "PETITION_SECTION_REWRITE", credits: 5, isFree: false, description: "Dilekçe bölümü yeniden yazımı." },
  { taskType: "ENFORCEMENT_ANALYSIS", credits: 10, isFree: false, description: "İcra Copilot komutu." },
  { taskType: "COLLECTION_LIKELIHOOD", credits: 15, isFree: false, description: "Tahsilat ihtimali — AI yalnız yorum yazar, skoru kural motoru üretir." },
  { taskType: "HEARING_PREP", credits: 15, isFree: false, description: "Duruşma hazırlık paketi." },
  { taskType: "RISK_ASSESS", credits: 15, isFree: false, description: "Dosya risk değerlendirmesi (Faz 4) — AI düzeltmesi ±25, bandı değiştirmez." },
  { taskType: "CASE_FULL_ANALYSIS", credits: 20, isFree: false, description: "Tam dosya analizi." },
  { taskType: "OPPONENT_SIMULATION", credits: 20, isFree: false, description: "Karşı taraf avukatı simülasyonu (Faz 4)." },
  { taskType: "EXPERT_REPORT_DIFF", credits: 20, isFree: false, description: "Bilirkişi raporu karşılaştırma (Faz 4)." },
  { taskType: "CONTRACT_REVIEW", credits: 20, isFree: false, description: "Sözleşme incelemesi (Faz 5)." },
  { taskType: "PETITION_DRAFT", credits: 25, isFree: false, description: "Dilekçe taslağı (tam)." },
  { taskType: "STRATEGY_BUILD", credits: 30, isFree: false, description: "Dava stratejisi oluşturma (Faz 4) — 9 halkalı zincir." },

  // ---- Faz 4'ün yeni görevleri ----
  { taskType: "JUDGE_SIMULATION", credits: 20, isFree: false, description: "Hakim gözüyle analiz (Faz 4)." },
  { taskType: "EVIDENCE_MATRIX", credits: 15, isFree: false, description: "İddia × delil matrisi önerisi (Faz 4)." },
  { taskType: "EVIDENCE_GAP", credits: 10, isFree: false, description: "Delil boşluğu tespiti (Faz 4)." },
  { taskType: "CONFLICT_INFERENCE", credits: 5, isFree: false, description: "Çıkar çatışması çıkarımı — tarama ağırlıklı deterministiktir, AI yalnız bağlı şirket çıkarımı ekler." },

  // ---- Faz 5'in yeni görevleri (Modül 19 — İletişim Merkezi) ----
  // NOT: POA_SCOPE_ANALYSIS (10) ve CONTRACT_REVIEW (20) zaten yukarıda tanımlı.
  {
    taskType: "MESSAGE_DRAFT",
    credits: 5,
    isFree: false,
    description:
      "Müvekkile mesaj taslağı (Modül 19). Taslak ÜRETİMİ ücretlidir, gönderim değil: onay akışı kredi tüketmez.",
  },
  {
    taskType: "MESSAGE_CASE_MATCH",
    credits: 2,
    isFree: false,
    description:
      "Gelen mesajı dosyayla eşleştirme (Modül 19). Ucuzdur çünkü çıktı tek bir {caseId, confidence, reason} önerisidir; kararı insan verir.",
  },

  // ---- Faz 6'nın yeni görevi (Modül 18 — Kurumsal Raporlama) ----
  {
    taskType: "REPORT_INTERPRET",
    credits: 5,
    isFree: false,
    description:
      "Rapor yorumu (Faz 6). Rapor DETERMİNİSTİK çalışır ve ücretsizdir; ücret yalnız " +
      "isteğe bağlı AI anlatımı içindir. LLM'e rakam gitmez (yalnız ölçü etiketleri ve " +
      "ARTTI/AZALDI gibi yönsüz sinyaller), bu yüzden CLIENT_STATUS_SUMMARY ile aynı bantta.",
  },

  // ---- Katalogda olup spec fiyat tablosunda GEÇMEYEN görevler ----
  // Satırı olmayan görev tipi kredi motorunda TANIMSIZ davranıştır (fail-open =
  // bedava AI, fail-closed = çalışmayan özellik). Bu yüzden makul bir başlangıç
  // fiyatıyla eklendiler; kesin fiyat bir İŞ KARARIDIR, panelden güncellenir.
  { taskType: "POA_SCOPE_ANALYSIS", credits: 10, isFree: false, description: "Vekaletname kapsam analizi (Modül 12). Fiyat tahminidir — panelden doğrulanmalı." },
  { taskType: "CLIENT_FINANCIAL_SUMMARY", credits: 5, isFree: false, description: "Müvekkil finans özeti (Modül 08). Fiyat tahminidir — panelden doğrulanmalı." },
  {
    taskType: "DAILY_PRIORITIZE",
    credits: 2,
    isFree: false,
    description:
      "Günlük öncelik listesi (Modül 18). DİKKAT: panel açılışında tetiklenirse hızla kredi yakar — çağrı sıklığı uygulama katmanında günde bir ile sınırlanmalı.",
  },
];

async function seedAiTaskCosts(): Promise<number> {
  let created = 0;
  for (const c of AI_TASK_COSTS) {
    const existing = await prisma.aiTaskCost.findUnique({ where: { taskType: c.taskType } });
    if (existing) continue; // Panelden değiştirilmiş fiyatı EZME.
    await prisma.aiTaskCost.create({ data: c });
    created += 1;
  }
  return created;
}

/**
 * Ek kredi paketleri: 500 · 2.000 · 10.000 (docs/moduller/26).
 *
 * FİYAT BİR İŞ KARARIDIR ve bu dosyada sabitlenmemiştir — buradaki TL değerleri
 * TEMSİLİDİR, platform panelinden güncellenir. Uyulan tek kural spec'ten gelir:
 * paket birim fiyatı, dahil kotanın örtük birim fiyatından EN AZ %20 yüksek
 * olmalı (dahil kota aboneliğin değer önerisi kalsın, ek paket "aşım" fiyatı olsun).
 * Buradaki kademeli iskonto (0,80 → 0,70 → 0,60 TL/kredi) o kuralı bozmayacak
 * biçimde seçilmiştir.
 */
const CREDIT_PACKAGES = [
  { key: "EK_500", credits: 500, price: "400.00", currency: "TRY" },
  { key: "EK_2000", credits: 2000, price: "1400.00", currency: "TRY" },
  { key: "EK_10000", credits: 10000, price: "6000.00", currency: "TRY" },
];

async function seedCreditPackages(): Promise<number> {
  let created = 0;
  for (const p of CREDIT_PACKAGES) {
    const existing = await prisma.creditPackage.findUnique({ where: { key: p.key } });
    if (existing) continue;
    await prisma.creditPackage.create({ data: p });
    created += 1;
  }
  return created;
}

/**
 * İÇ MALİYET tablosu — kullanıcıya GÖSTERİLMEZ, marj raporunun girdisidir.
 *
 * DİKKAT: sağlayıcı fiyatları sık değişir. Anthropic satırları güncel liste
 * fiyatlarıdır; OpenAI/Gemini satırları YAKLAŞIKTIR ve PANELDEN DOĞRULANMALIDIR
 * (/api/admin/v1/model-prices). Fiyat değişikliği geriye dönük uygulanmaz:
 * yeni fiyat YENİ bir effectiveFrom satırı olarak eklenir, eski satır korunur
 * (iş kuralı 10) — bu yüzden unique anahtar (provider, model, effectiveFrom).
 */
const MODEL_PRICE_EFFECTIVE_FROM = utc(2026, 1, 1);

const MODEL_PRICES: Array<{
  providerType: Prisma.ModelPriceUncheckedCreateInput["providerType"];
  model: string;
  inputPricePer1M: string;
  outputPricePer1M: string;
}> = [
  // Anthropic — liste fiyatları (USD / 1M token)
  { providerType: "ANTHROPIC", model: "claude-opus-5", inputPricePer1M: "5.0000", outputPricePer1M: "25.0000" },
  { providerType: "ANTHROPIC", model: "claude-sonnet-5", inputPricePer1M: "2.0000", outputPricePer1M: "10.0000" },
  { providerType: "ANTHROPIC", model: "claude-sonnet-4-6", inputPricePer1M: "3.0000", outputPricePer1M: "15.0000" },
  { providerType: "ANTHROPIC", model: "claude-haiku-4-5", inputPricePer1M: "1.0000", outputPricePer1M: "5.0000" },
  // OpenAI uyumlu — YAKLAŞIK, panelden doğrulanmalı
  { providerType: "OPENAI_COMPAT", model: "gpt-4o", inputPricePer1M: "2.5000", outputPricePer1M: "10.0000" },
  { providerType: "OPENAI_COMPAT", model: "gpt-4o-mini", inputPricePer1M: "0.1500", outputPricePer1M: "0.6000" },
  { providerType: "OPENAI_COMPAT", model: "text-embedding-3-small", inputPricePer1M: "0.0200", outputPricePer1M: "0.0000" },
  // Gemini — YAKLAŞIK, panelden doğrulanmalı
  { providerType: "GEMINI", model: "gemini-2.0-flash", inputPricePer1M: "0.1000", outputPricePer1M: "0.4000" },
  { providerType: "GEMINI", model: "gemini-1.5-pro", inputPricePer1M: "1.2500", outputPricePer1M: "5.0000" },
  // Yerel çalıştırma — sağlayıcıya ödenen bedel YOKTUR (donanım gideri ayrı kalem).
  { providerType: "OLLAMA", model: "llama3.1:8b", inputPricePer1M: "0.0000", outputPricePer1M: "0.0000" },
];

async function seedModelPrices(): Promise<number> {
  let created = 0;
  for (const p of MODEL_PRICES) {
    const existing = await prisma.modelPrice.findUnique({
      where: {
        providerType_model_effectiveFrom: {
          providerType: p.providerType,
          model: p.model,
          effectiveFrom: MODEL_PRICE_EFFECTIVE_FROM,
        },
      },
    });
    if (existing) continue;
    await prisma.modelPrice.create({ data: { ...p, currency: "USD", effectiveFrom: MODEL_PRICE_EFFECTIVE_FROM } });
    created += 1;
  }
  return created;
}

/** İçinde bulunulan ayın ilk günü ve ertesi ayın ilk günü (UTC gün başı). */
function currentPeriod(): { periodStart: Date; periodEnd: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(y, m, 1)),
    periodEnd: new Date(Date.UTC(y, m + 1, 1)), // dönem sonu DIŞLAYICI
  };
}

/**
 * Demo tenant cüzdanı — Solo planı kotası (500 kredi / 200 belge).
 *
 * IDEMPOTENT ve VERİ KORUYUCU: cüzdan varsa tüketim alanları SIFIRLANMAZ.
 * Seed'in `includedConsumed`/`purchasedCredits` alanlarını ezmesi, hareket
 * defteri (CreditTransaction) ile cüzdan bakiyesi arasındaki mutabakatı bozar.
 */
async function seedCreditWallet(): Promise<boolean> {
  const existing = await prisma.creditWallet.findUnique({ where: { tenantId: TENANT_ID } });
  if (existing) return false;
  const { periodStart, periodEnd } = currentPeriod();
  await prisma.creditWallet.create({
    data: {
      tenantId: TENANT_ID,
      periodStart,
      periodEnd,
      includedCredits: 500,
      documentQuota: 200,
    },
  });
  // Dönem başı tahsisi hareket defterine de yazılır; mutabakat testi bunu bekler.
  await prisma.creditTransaction.create({
    data: {
      tenantId: TENANT_ID,
      type: "TAHSIS",
      amount: 500,
      balanceAfter: 500,
      note: "Dönem başı dahil kota tahsisi (Solo planı — 500 kredi). Dahil kota DEVRETMEZ.",
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Faz 4 — delil matrisi, bilirkişi, risk demo verisi
// ---------------------------------------------------------------------------

/**
 * İddia × delil matrisi + risk skoru seti.
 *
 * DİKKAT: buradaki hiçbir kayıt AI çıktısı DEĞİLDİR; hepsi "avukat girmiş"
 * kabul edilir. AI önerileri ürün akışında ayrı bir onay adımından geçer.
 */
async function seedEvidenceMatrix(caseId: string, userId: string) {
  const claims: Array<{ side: "BIZ" | "KARSI_TARAF"; text: string; status: "ACIK" | "DESTEKLENIYOR" | "ZAYIF" | "CURUTULDU" }> = [
    { side: "BIZ", text: "Taraflar arasında 14.02.2025 tarihli yazılı çerçeve sözleşme kurulmuştur.", status: "DESTEKLENIYOR" },
    { side: "BIZ", text: "Müvekkil edimini tam ve zamanında ifa etmiş, teslim tutanakla belgelenmiştir.", status: "DESTEKLENIYOR" },
    { side: "BIZ", text: "Davalı, muaccel hale gelen 1.240.000 TL bedeli ödememiştir.", status: "ACIK" },
    { side: "KARSI_TARAF", text: "Teslim edilen mal ayıplıdır; bu nedenle bedelden indirim gerekir.", status: "ZAYIF" },
  ];

  const claimRecords: Array<{ id: string; text: string }> = [];
  let claimCount = 0;
  for (const [i, c] of claims.entries()) {
    let rec = await prisma.claim.findFirst({ where: { caseId, text: c.text } });
    if (!rec) {
      rec = await prisma.claim.create({
        data: { tenantId: TENANT_ID, caseId, side: c.side, text: c.text, status: c.status, orderIndex: i, createdBy: userId },
      });
      claimCount += 1;
    }
    claimRecords.push({ id: rec.id, text: rec.text });
  }

  const evidences: Array<Omit<Prisma.EvidenceUncheckedCreateInput, "tenantId" | "caseId" | "createdBy">> = [
    { type: "BELGE", title: "14.02.2025 tarihli çerçeve sözleşme (ıslak imzalı)", status: "SUNULDU", obtainedAt: utc(2026, 1, 20) },
    { type: "BELGE", title: "18.03.2025 tarihli teslim tutanağı", description: "Karşı taraf yetkilisinin kaşe ve imzasını taşır.", status: "SUNULDU", obtainedAt: utc(2026, 1, 20) },
    { type: "BELGE", title: "Fatura ve cari hesap ekstresi (2025/1-2025/9)", status: "SUNULDU", obtainedAt: utc(2026, 2, 4) },
    { type: "TANIK", title: "Teslim sırasında hazır bulunan depo sorumlusu", witnessName: "Hasan Yıldırım", description: "Malın ayıpsız teslim alındığına ilişkin beyan.", status: "PLANLANAN" },
    { type: "BILIRKISI", title: "Ticari defterler üzerinde bilirkişi incelemesi", description: "Cari hesap mutabakatının teyidi için talep edilecek.", status: "PLANLANAN" },
  ];

  const evidenceRecords: Array<{ id: string; title: string }> = [];
  let evidenceCount = 0;
  for (const e of evidences) {
    let rec = await prisma.evidence.findFirst({ where: { caseId, title: e.title as string } });
    if (!rec) {
      rec = await prisma.evidence.create({ data: { ...e, tenantId: TENANT_ID, caseId, createdBy: userId } });
      evidenceCount += 1;
    }
    evidenceRecords.push({ id: rec.id, title: rec.title });
  }

  // Matris hücreleri: [iddia sırası, delil sırası, güç(1-5), not]
  const cells: Array<[number, number, number, string]> = [
    [0, 0, 5, "Sözleşmenin kuruluşunu doğrudan ispatlar."],
    [1, 1, 5, "İfanın gerçekleştiğini doğrudan ispatlar."],
    [1, 3, 3, "Tanık beyanı tutanağı destekler; tek başına yeterli değildir."],
    [2, 2, 4, "Muacceliyet ve bakiye alacağı gösterir."],
    [2, 4, 3, "Bilirkişi incelemesi bakiyeyi teyit edecektir."],
    [3, 1, 4, "KARŞI DELİL: ayıpsız teslim, ayıp iddiasını zayıflatır."],
  ];
  let linkCount = 0;
  for (const [ci, ei, strength, note] of cells) {
    const claim = claimRecords[ci];
    const evidence = evidenceRecords[ei];
    const existing = await prisma.claimEvidenceLink.findUnique({
      where: { claimId_evidenceId: { claimId: claim.id, evidenceId: evidence.id } },
    });
    if (existing) continue;
    await prisma.claimEvidenceLink.create({
      data: { tenantId: TENANT_ID, claimId: claim.id, evidenceId: evidence.id, strength, note, createdBy: userId },
    });
    linkCount += 1;
  }

  // Hukuki dayanaklar — atıf METNİ; doğrulama caselaw modülünde kayıt üzerinden yapılır.
  const bases: Array<[number, string, string]> = [
    [0, "TBK m.1", "Sözleşmenin kurulması — karşılıklı ve birbirine uygun irade beyanı."],
    [2, "TBK m.117", "Temerrüt ve muacceliyet."],
    [3, "TTK m.23/c", "Ticari satımda ayıp ihbarı süresi — süresinde ihbar yoksa ayıp iddiası dinlenmez."],
  ];
  let basisCount = 0;
  for (const [ci, reference, note] of bases) {
    const claim = claimRecords[ci];
    const existing = await prisma.claimLegalBasis.findFirst({ where: { claimId: claim.id, reference } });
    if (existing) continue;
    await prisma.claimLegalBasis.create({ data: { tenantId: TENANT_ID, claimId: claim.id, reference, note } });
    basisCount += 1;
  }

  return { claimCount, evidenceCount, linkCount, basisCount };
}

/** Bilirkişi kaydı + rapor (c5 — ayıplı hammadde dosyası; ara kararla heyet atanmıştı). */
async function seedExpert(caseId: string, userId: string) {
  const fullName = "Prof. Dr. Serkan Aydın";
  let expert = await prisma.expert.findFirst({ where: { tenantId: TENANT_ID, fullName } });
  let expertCreated = false;
  if (!expert) {
    expert = await prisma.expert.create({
      data: {
        tenantId: TENANT_ID,
        fullName,
        specialty: "Kimya Mühendisliği — polimer hammadde analizi",
        institution: "Bursa Bilirkişilik Bölge Kurulu",
        note: "[DEMO VERİ] Önceki dosyada teknik analizi güçlü, zarar hesabında yüzeysel kalmıştı.",
      },
    });
    expertCreated = true;
  }

  let reportCreated = false;
  let report = await prisma.expertReport.findFirst({ where: { caseId, reportType: "ASIL" } });
  if (!report) {
    report = await prisma.expertReport.create({
      data: {
        tenantId: TENANT_ID,
        caseId,
        expertId: expert.id,
        reportType: "ASIL",
        receivedAt: utc(2026, 4, 14),
        // TEBLİĞ tarihi itiraz süresini tetikler; sürenin kendisi deterministik
        // motorda hesaplanır (HMK m.281 — 2 hafta), burada saklanmaz.
        servedAt: utc(2026, 4, 21),
        summary: "[DEMO VERİ] Hammadde numunelerinde standart dışı nem oranı tespit edilmiş; ayıp iddiası kısmen doğrulanmıştır.",
        conclusionText:
          "Dava konusu partide ayıp bulunduğu, ancak zararın davacının talep ettiği tutarın altında kaldığı kanaatine varılmıştır.",
        createdBy: userId,
      },
    });
    reportCreated = true;
  }

  let objectionCreated = false;
  const objectionExists = await prisma.expertObjection.findFirst({ where: { expertReportId: report.id } });
  if (!objectionExists) {
    await prisma.expertObjection.create({
      data: {
        tenantId: TENANT_ID,
        expertReportId: report.id,
        points: JSON.stringify([
          { no: 1, topic: "Numune seçimi", summary: "Numuneler yalnız tek partiden alınmış; temsil kabiliyeti tartışmalıdır." },
          { no: 2, topic: "Zarar hesabı yöntemi", summary: "Kâr kaybı kalemi hiç değerlendirilmemiştir." },
          { no: 3, topic: "Ek rapor talebi", summary: "Aynı heyetten ek rapor alınması talep edilmektedir." },
        ]),
        status: "SUNULDU",
        createdBy: userId,
      },
    });
    objectionCreated = true;
  }

  return { expertCreated, reportCreated, objectionCreated };
}

/**
 * Risk skoru seti — 7 alt boyut + GENEL bileşke (8 satır).
 *
 * HİBRİT: `score` deterministik kural sinyallerinden gelir, `aiAdjustment` yalnız
 * sınırlı bir düzeltmedir ve BANDI DEĞİŞTİRMEZ. Demo veride bant, kural tabanıyla
 * (score - aiAdjustment) tutarlı seçilmiştir: <40 DUSUK, 40-69 ORTA, >=70 YUKSEK.
 */
async function seedRiskScores(caseId: string, userId: string) {
  const rows: Array<{
    dimension: Prisma.RiskScoreUncheckedCreateInput["dimension"];
    score: number;
    band: "DUSUK" | "ORTA" | "YUKSEK";
    aiAdjustment: number;
    signals: Array<{ key: string; label: string; weight: number; value: number; contribution: number }>;
    commentary: string;
  }> = [
    {
      dimension: "HUKUKI",
      score: 34,
      band: "DUSUK",
      aiAdjustment: -4,
      signals: [
        { key: "YAZILI_SOZLESME", label: "Yazılı sözleşme mevcut", weight: 25, value: 1, contribution: -25 },
        { key: "TESLIM_TUTANAGI", label: "İfa tutanakla belgeli", weight: 15, value: 1, contribution: -15 },
      ],
      commentary: "[DEMO VERİ] Sözleşmesel dayanak güçlü; ayıp savunmasının süresinde ihbar edilmemesi lehimize.",
    },
    {
      dimension: "SURE",
      score: 22,
      band: "DUSUK",
      aiAdjustment: 0,
      signals: [
        { key: "GECIKMIS_SURE_YOK", label: "Gecikmiş süre kaydı yok", weight: 30, value: 0, contribution: 0 },
        { key: "YAKLASAN_SURE", label: "14 gün içinde dolan süre sayısı", weight: 10, value: 1, contribution: 10 },
      ],
      commentary: "[DEMO VERİ] Yaklaşan tek süre takipte; risk düşük.",
    },
    {
      dimension: "DELIL",
      score: 48,
      band: "ORTA",
      aiAdjustment: 6,
      signals: [
        { key: "DESTEKSIZ_IDDIA", label: "Delilsiz iddia sayısı", weight: 20, value: 1, contribution: 20 },
        { key: "TOPLANMAMIS_DELIL", label: "PLANLANAN durumundaki delil sayısı", weight: 12, value: 2, contribution: 24 },
      ],
      commentary: "[DEMO VERİ] Tanık ve bilirkişi delili henüz toplanmadı; matriste iki boşluk var.",
    },
    {
      dimension: "TAHSILAT",
      score: 61,
      band: "ORTA",
      aiAdjustment: 5,
      signals: [
        { key: "BORCLU_MALVARLIGI", label: "Tespit edilen malvarlığı yetersiz", weight: 30, value: 1, contribution: 30 },
        { key: "GECMIS_ODEME", label: "Kısmi ödeme geçmişi var", weight: 15, value: 1, contribution: -15 },
      ],
      commentary: "[DEMO VERİ] Karar alınsa dahi tahsilat riski orta; malvarlığı araştırması genişletilmeli.",
    },
    {
      dimension: "USUL",
      score: 26,
      band: "DUSUK",
      aiAdjustment: -2,
      signals: [{ key: "GOREV_YETKI", label: "Görev/yetki itirazı riski", weight: 25, value: 0, contribution: 0 }],
      commentary: "[DEMO VERİ] Görev ve yetki tartışmasız; usuli risk düşük.",
    },
    {
      dimension: "ICTIHAT",
      score: 41,
      band: "ORTA",
      aiAdjustment: 3,
      signals: [{ key: "AYKIRI_ICTIHAT", label: "Aleyhe içtihat sayısı", weight: 20, value: 1, contribution: 20 }],
      commentary: "[DEMO VERİ] Ayıp ihbarı süresine ilişkin aleyhe bir daire kararı mevcut; ayırt edilebilir.",
    },
    {
      dimension: "KARSI_TARAF",
      score: 55,
      band: "ORTA",
      aiAdjustment: 4,
      signals: [{ key: "AKTIF_SAVUNMA", label: "Karşı taraf aktif ve vekille temsil ediliyor", weight: 20, value: 1, contribution: 20 }],
      commentary: "[DEMO VERİ] Karşı taraf her aşamada dilekçe veriyor; uzayan yargılama beklenmeli.",
    },
    {
      dimension: "GENEL",
      score: 44,
      band: "ORTA",
      aiAdjustment: 2,
      signals: [{ key: "AGIRLIKLI_BILESKE", label: "Boyut skorlarının ağırlıklı ortalaması", weight: 100, value: 44, contribution: 44 }],
      commentary: "[DEMO VERİ] Esas yönünden güçlü, tahsilat ve delil yönünden izlenmesi gereken dosya.",
    },
  ];

  let scoreCount = 0;
  let historyCount = 0;
  for (const r of rows) {
    const signalsJson = JSON.stringify(r.signals);
    const existing = await prisma.riskScore.findUnique({
      where: { caseId_dimension: { caseId, dimension: r.dimension } },
    });
    if (existing) continue;
    await prisma.riskScore.create({
      data: {
        tenantId: TENANT_ID,
        caseId,
        dimension: r.dimension,
        score: r.score,
        band: r.band,
        ruleSignalsJson: signalsJson,
        aiAdjustment: r.aiAdjustment,
        aiCommentary: r.commentary,
        computedBy: userId,
      },
    });
    scoreCount += 1;
    // Append-only seride ilk nokta — risk eğrisinin başlangıcı.
    await prisma.riskScoreHistory.create({
      data: {
        tenantId: TENANT_ID,
        caseId,
        dimension: r.dimension,
        score: r.score,
        band: r.band,
        ruleSignalsJson: signalsJson,
        aiAdjustment: r.aiAdjustment,
        computedAt: utcDaysAgo(1),
      },
    });
    historyCount += 1;
  }
  return { scoreCount, historyCount };
}

// ---------------------------------------------------------------------------
// Faz 5 — Portal · İletişim merkezi · Vekaletname · Sözleşme
// ---------------------------------------------------------------------------
//
// DEMO VERİSİ UYARISI: buradaki belge kayıtlarının S3/MinIO'da GERÇEK NESNESİ
// YOKTUR — yalnız üstveridir (storageKey "demo/..." ön ekiyle işaretli).
// Portal indirme ucu bu kayıtlar için 404 döner; amaç yayın (PortalPublication)
// akışının uçtan uca sınanabilmesidir, dosya indirmenin değil.

/** Vekaletname özel yetki maddesi — scopeItemsJson içindeki tek eleman. */
type PoaScopeItem = { code: string; label: string; present: boolean };

/**
 * Genel dava vekaletnamesinin standart yetki seti. Backfill'de kullanılır:
 * tipi boş kalmış eski kayıtlar HMK m.74 dışındaki özel yetkiler YOK sayılarak
 * doldurulur — eksik yetkiyi "var" saymak usul riski doğururdu, tersi doğurmaz.
 */
const GENEL_DAVA_SCOPE: PoaScopeItem[] = [
  { code: "AHZU_KABZ", label: "Ahzu kabz", present: false },
  { code: "SULH", label: "Sulh ve ibra", present: false },
  { code: "FERAGAT", label: "Davadan feragat", present: false },
  { code: "KABUL", label: "Davayı kabul", present: false },
  { code: "TEMYIZ_ISTINAF", label: "İstinaf / temyiz", present: true },
  { code: "ARABULUCULUK", label: "Arabuluculuk görüşmelerine katılma", present: true },
];

/** Sistem mesaj şablonu tohumu (tenantId = null). */
type MessageTemplateSeed = Omit<
  Prisma.MessageTemplateUncheckedCreateInput,
  "id" | "tenantId" | "isSystem" | "createdAt" | "updatedAt"
>;

/**
 * 5 SİSTEM ŞABLONU. Yer tutucular {{camelCase}} biçimindedir; şablon çözücü
 * çözemediği değişken bırakırsa taslak ONAYA DÜŞMEZ (Modül 19, iş kuralı 9).
 * Metinler bilinçli olarak SONUÇ TAAHHÜDÜ İÇERMEZ ("kazanacağız" yok).
 */
const SYSTEM_MESSAGE_TEMPLATES: MessageTemplateSeed[] = [
  {
    key: "SISTEM_DURUSMA_HATIRLATMA",
    name: "Duruşma hatırlatma",
    channel: "EPOSTA",
    subject: "{{dosyaNo}} sayılı dosyanızda duruşma hatırlatması",
    body:
      "Sayın {{muvekkilAdi}},\n\n" +
      "{{mahkemeAdi}} nezdinde görülen {{dosyaNo}} sayılı dosyanızın duruşması " +
      "{{durusmaTarihi}} tarihinde saat {{durusmaSaati}} itibarıyla yapılacaktır.\n\n" +
      "Duruşmada hazır bulunmanız gerekip gerekmediği konusunda ayrıca " +
      "bilgilendirileceksiniz.\n\nSaygılarımızla,\n{{buroAdi}}",
  },
  {
    key: "SISTEM_DOSYA_DURUM_BILGILENDIRME",
    name: "Dosya durum bilgilendirme",
    channel: "EPOSTA",
    subject: "{{dosyaNo}} sayılı dosyanızda güncel durum",
    body:
      "Sayın {{muvekkilAdi}},\n\n" +
      "{{dosyaNo}} sayılı dosyanızdaki güncel durum aşağıdadır:\n\n{{durumOzeti}}\n\n" +
      "Bir sonraki adım: {{sonrakiAdim}}\n\n" +
      "Sorularınız için bize ulaşabilirsiniz.\n\nSaygılarımızla,\n{{buroAdi}}",
  },
  {
    key: "SISTEM_ODEME_HATIRLATMA",
    name: "Ödeme hatırlatma",
    channel: "EPOSTA",
    subject: "{{faturaNo}} numaralı faturanız hakkında",
    body:
      "Sayın {{muvekkilAdi}},\n\n" +
      "{{faturaNo}} numaralı, {{faturaTutari}} tutarındaki faturanızın vade tarihi " +
      "{{vadeTarihi}}'dir. Ödemenizi henüz tespit edemedik.\n\n" +
      "Ödemeyi gerçekleştirdiyseniz bu bildirimi dikkate almayınız.\n\n" +
      "Saygılarımızla,\n{{buroAdi}}",
  },
  {
    key: "SISTEM_BELGE_TALEBI",
    name: "Belge talebi",
    channel: "EPOSTA",
    subject: "{{dosyaNo}} sayılı dosyanız için belge talebi",
    body:
      "Sayın {{muvekkilAdi}},\n\n" +
      "{{dosyaNo}} sayılı dosyanızın yürütülebilmesi için aşağıdaki belgelere " +
      "ihtiyacımız bulunmaktadır:\n\n{{belgeListesi}}\n\n" +
      "Belgeleri {{sonTeslimTarihi}} tarihine kadar müvekkil portalı üzerinden " +
      "yükleyebilir veya büromuza iletebilirsiniz.\n\nSaygılarımızla,\n{{buroAdi}}",
  },
  {
    key: "SISTEM_KARAR_BILGILENDIRME",
    name: "Karar bilgilendirme",
    channel: "EPOSTA",
    subject: "{{dosyaNo}} sayılı dosyanızda karar verildi",
    body:
      "Sayın {{muvekkilAdi}},\n\n" +
      "{{mahkemeAdi}} {{dosyaNo}} sayılı dosyanızda {{kararTarihi}} tarihinde karar " +
      "verilmiştir. Kararın özeti: {{kararOzeti}}\n\n" +
      "Kanun yoluna başvuru süresi gerekçeli kararın tebliğinden itibaren " +
      "işlemeye başlar; değerlendirmemizi ayrıca paylaşacağız.\n\n" +
      "Saygılarımızla,\n{{buroAdi}}",
  },
];

async function seedMessageTemplates(): Promise<number> {
  let created = 0;
  for (const t of SYSTEM_MESSAGE_TEMPLATES) {
    // tenantId NULL olduğu için @@unique([tenantId, key]) Postgres'te ETKİSİZDİR
    // (NULL'lar birbirine eşit sayılmaz) — bu yüzden findFirst ile korunuyoruz.
    const existing = await prisma.messageTemplate.findFirst({ where: { tenantId: null, key: t.key } });
    if (existing) continue;
    await prisma.messageTemplate.create({ data: { ...t, tenantId: null, isSystem: true } });
    created += 1;
  }
  return created;
}

async function ensureDocument(
  caseId: string,
  name: string,
  data: Omit<Prisma.DocumentUncheckedCreateInput, "id" | "tenantId" | "caseId" | "name">,
) {
  const existing = await prisma.document.findFirst({ where: { tenantId: TENANT_ID, caseId, name } });
  if (existing) return existing;
  return prisma.document.create({ data: { ...data, tenantId: TENANT_ID, caseId, name } });
}

/**
 * Müvekkil portalı tohumu: 1 portal kullanıcısı + 1 dosya ve 2 belge yayını.
 *
 * YAYIN LİSTESİ ALLOW-LIST'TİR: burada yayınlanmayan hiçbir kayıt portalda
 * görünmez. Dosyanın 3 safahat kaydı, 2 süresi, görevleri ve risk skorları
 * BİLEREK yayınlanmadı — portal sorgusunun sızdırmadığı bu veriyle sınanır.
 */
async function seedPortal(clientId: string, caseId: string, publisherId: string, passwordHash: string) {
  const email = "portal@demo.nomosos.local";
  let portalUser = await prisma.portalUser.findFirst({ where: { tenantId: TENANT_ID, email } });
  const portalUserCreated = !portalUser;
  if (!portalUser) {
    portalUser = await prisma.portalUser.create({
      data: {
        tenantId: TENANT_ID,
        clientId,
        email,
        passwordHash,
        fullName: "Ayşe Yılmaz (ABC Holding Hukuk Müşaviri)",
        isActive: true,
        invitedBy: publisherId,
        invitedAt: utcDaysAgo(20),
        activatedAt: utcDaysAgo(19),
      },
    });
  }

  const doc1 = await ensureDocument(caseId, "Bilirkişi Raporu (12.08.2026)", {
    class: "BILIRKISI_RAPORU",
    classSource: "MANUEL",
    mimeType: "application/pdf",
    sizeBytes: 412_336,
    storageKey: `demo/${TENANT_ID}/faz5/bilirkisi-raporu.pdf`,
    uploadedBy: publisherId,
    aiSummary: "[DEMO VERİ] Alacak miktarı bakımından kısmen lehe, faiz başlangıcı bakımından aleyhe tespitler içerir.",
    source: "SISTEM",
    pageCount: 24,
  });
  const doc2 = await ensureDocument(caseId, "Sözleşme Sureti (Ticari Alım-Satım)", {
    class: "SOZLESME",
    classSource: "MANUEL",
    mimeType: "application/pdf",
    sizeBytes: 128_904,
    storageKey: `demo/${TENANT_ID}/faz5/sozlesme-sureti.pdf`,
    uploadedBy: publisherId,
    aiSummary: "[DEMO VERİ] Taraflar, bedel, teslim ve gecikme cezası maddelerini içeren çerçeve sözleşme.",
    source: "MANUEL",
    pageCount: 9,
  });

  const publications: Array<{
    resourceType: Prisma.PortalPublicationUncheckedCreateInput["resourceType"];
    resourceId: string;
    note: string;
  }> = [
    {
      resourceType: "DOSYA",
      resourceId: caseId,
      note: "Dosya müvekkile açıldı. Alt kaynaklar ayrıca yayınlanmadıkça görünmez.",
    },
    { resourceType: "BELGE", resourceId: doc1.id, note: "Bilirkişi raporu müvekkille paylaşıldı." },
    { resourceType: "BELGE", resourceId: doc2.id, note: "Sözleşme sureti müvekkille paylaşıldı." },
  ];

  let publicationCount = 0;
  for (const p of publications) {
    const existing = await prisma.portalPublication.findUnique({
      where: {
        tenantId_resourceType_resourceId_clientId: {
          tenantId: TENANT_ID,
          resourceType: p.resourceType,
          resourceId: p.resourceId,
          clientId,
        },
      },
    });
    if (existing) continue;
    await prisma.portalPublication.create({
      data: {
        tenantId: TENANT_ID,
        clientId,
        resourceType: p.resourceType,
        resourceId: p.resourceId,
        publishedBy: publisherId,
        publishedAt: utcDaysAgo(3),
        note: p.note,
      },
    });
    publicationCount += 1;
  }

  return { portalUserCreated, publicationCount, documentIds: [doc1.id, doc2.id] };
}

/**
 * Vekaletname tohumu + Faz 5 alanlarının geriye dönük doldurulması.
 *
 * Backfill ÖNCE çalışır: yeni eklenen kayıtların tipi zaten dolu olduğu için
 * onlara dokunmaz, yalnız `type` alanı boş kalmış ESKİ kayıtları tamamlar.
 */
async function seedPowerOfAttorneys(
  abcClientId: string,
  abcCaseId: string,
  mehmetClientId: string,
  mehmetCaseId: string,
) {
  const backfill = await prisma.powerOfAttorney.updateMany({
    where: { tenantId: TENANT_ID, type: null },
    data: { type: "GENEL", scopeItemsJson: JSON.stringify(GENEL_DAVA_SCOPE) },
  });

  const seeds: Array<{
    clientId: string;
    caseId: string;
    number: string;
    data: Omit<Prisma.PowerOfAttorneyUncheckedCreateInput, "id" | "tenantId" | "clientId" | "caseId" | "number">;
  }> = [
    {
      clientId: abcClientId,
      caseId: abcCaseId,
      number: "08921",
      data: {
        notary: "Beyoğlu 14. Noterliği",
        issuedAt: utc(2026, 3, 5),
        scope: "Genel dava vekaletnamesi — istinaf/temyiz ve arabuluculuk yetkilerini içerir.",
        type: "GENEL",
        scopeItemsJson: JSON.stringify([
          { code: "AHZU_KABZ", label: "Ahzu kabz", present: true },
          { code: "SULH", label: "Sulh ve ibra", present: true },
          { code: "FERAGAT", label: "Davadan feragat", present: false },
          { code: "KABUL", label: "Davayı kabul", present: false },
          { code: "TEMYIZ_ISTINAF", label: "İstinaf / temyiz", present: true },
          { code: "ARABULUCULUK", label: "Arabuluculuk görüşmelerine katılma", present: true },
          { code: "SIRKET_TEMSIL", label: "Şirket temsili", present: true },
        ] satisfies PoaScopeItem[]),
        isActive: true,
      },
    },
    {
      clientId: mehmetClientId,
      caseId: mehmetCaseId,
      number: "14205",
      data: {
        notary: "Çankaya 3. Noterliği",
        issuedAt: utc(2026, 1, 22),
        expiresAt: utc(2027, 1, 22),
        scope: "İş hukuku uyuşmazlıkları için düzenlenmiş vekaletname.",
        // KAPSAM ANALİZİ İÇİN BİLİNÇLİ EKSİK: sulh ve feragat yetkisi YOK.
        // POA_SCOPE_ANALYSIS demosu bu kayıtta YETERSIZ üretebilmelidir.
        type: "OZEL",
        scopeItemsJson: JSON.stringify([
          { code: "AHZU_KABZ", label: "Ahzu kabz", present: true },
          { code: "SULH", label: "Sulh ve ibra", present: false },
          { code: "FERAGAT", label: "Davadan feragat", present: false },
          { code: "TEMYIZ_ISTINAF", label: "İstinaf / temyiz", present: true },
          { code: "ARABULUCULUK", label: "Arabuluculuk görüşmelerine katılma", present: true },
        ] satisfies PoaScopeItem[]),
        isActive: true,
      },
    },
  ];

  let created = 0;
  for (const s of seeds) {
    const existing = await prisma.powerOfAttorney.findFirst({
      where: { tenantId: TENANT_ID, clientId: s.clientId, number: s.number },
    });
    if (existing) continue;
    await prisma.powerOfAttorney.create({
      data: { ...s.data, tenantId: TENANT_ID, clientId: s.clientId, caseId: s.caseId, number: s.number },
    });
    created += 1;
  }

  return { created, backfilled: backfill.count };
}

/**
 * Sözleşme tohumu: 1 vekalet ücret sözleşmesi + 1 (immutable) sürüm.
 * `currentVersionId` sürüm yazıldıktan SONRA işaretlenir.
 */
async function seedContracts(clientId: string, caseId: string, userId: string) {
  const title = "ABC Holding — Vekalet Ücret Sözleşmesi (2026)";
  const existing = await prisma.contract.findFirst({ where: { tenantId: TENANT_ID, title } });
  if (existing) return { contractCreated: false, versionCreated: false };

  const contract = await prisma.contract.create({
    data: {
      tenantId: TENANT_ID,
      clientId,
      caseId,
      title,
      type: "VEKALET_UCRET",
      status: "YURURLUKTE",
      effectiveFrom: utc(2026, 3, 1),
      effectiveTo: utc(2027, 2, 28),
      renewalNoticeDays: 30,
      autoRenew: true,
      createdBy: userId,
    },
  });

  const version = await prisma.contractVersion.create({
    data: {
      contractId: contract.id,
      versionNo: 1,
      createdBy: userId,
      changeNote: "İlk sürüm — taraflarca imzalanan metin.",
      contentText: [
        "VEKALET ÜCRET SÖZLEŞMESİ",
        "",
        "Madde 1 — Taraflar: Bir tarafta Demo Hukuk Bürosu (Vekil), diğer tarafta",
        "ABC Holding A.Ş. (Müvekkil) arasında aşağıdaki şartlarla akdedilmiştir.",
        "",
        "Madde 2 — Konu: İstanbul 12. Asliye Ticaret Mahkemesi'nin 2026/145 esas",
        "sayılı alacak davasının takibi ve sonuçlandırılması.",
        "",
        "Madde 3 — Ücret: Peşin ücret 150.000,00 TL olup, dava değerinin %10'u",
        "oranında başarı primi tahsilat gerçekleştikçe hak edilir. Tutarlara KDV",
        "dahil değildir.",
        "",
        "Madde 4 — Masraflar: Harç, tebligat, bilirkişi ve keşif masrafları",
        "Müvekkil'e aittir; avans olarak talep edilebilir.",
        "",
        "Madde 5 — Süre ve Yenileme: Sözleşme 01.03.2026 tarihinde yürürlüğe girer,",
        "31.03.2027 [sic: 28.02.2027] tarihine kadar geçerlidir. Taraflardan biri",
        "sona erme tarihinden en az 30 gün önce yazılı fesih ihbarında bulunmazsa",
        "sözleşme aynı şartlarla bir yıl uzar.",
        "",
        "Madde 6 — Uyuşmazlık: İstanbul Mahkemeleri ve İcra Daireleri yetkilidir.",
        "",
        "[DEMO VERİ] Bu metin örnek amaçlıdır; hukuki tavsiye niteliği taşımaz.",
      ].join("\n"),
    },
  });

  await prisma.contract.update({ where: { id: contract.id }, data: { currentVersionId: version.id } });
  return { contractCreated: true, versionCreated: true };
}

/**
 * İletişim geçmişi tohumu — 2 kayıt (bir gelen, bir giden).
 * Giden kayıt İNSAN ONAYINDAN GEÇMİŞ bir mesajın izidir; onaysız giden mesaj
 * tohumda BİLEREK YOKTUR (approvedBy dolmadan gönderim yapılamaz).
 */
async function seedCommunications(clientId: string, caseId: string, userId: string) {
  const seeds: Array<Omit<Prisma.CommunicationLogUncheckedCreateInput, "id" | "tenantId" | "createdAt">> = [
    {
      clientId,
      caseId,
      direction: "GELEN",
      channel: "EPOSTA",
      subject: "Bilirkişi raporu hakkında",
      body:
        "Merhaba, bilirkişi raporunun tarafımıza tebliğ edildiğini öğrendik. " +
        "İtiraz süreci ve tahmini takvim hakkında bilgi alabilir miyiz?",
      contactRef: "ayse@abcholding.example",
      occurredAt: utcDaysAgo(4),
      recordedBy: null,
    },
    {
      clientId,
      caseId,
      direction: "GIDEN",
      channel: "TELEFON",
      subject: "Bilirkişi raporu — bilgilendirme görüşmesi",
      body:
        "Müvekkil yetkilisi arandı. Rapordaki lehe/aleyhe tespitler ve iki haftalık " +
        "itiraz süresi anlatıldı; itiraz dilekçesinin taslak aşamasında olduğu bildirildi. " +
        "Sonuç taahhüdünde bulunulmadı.",
      contactRef: "+90 532 000 00 01",
      occurredAt: utcDaysAgo(3),
      recordedBy: userId,
    },
  ];

  let created = 0;
  for (const s of seeds) {
    const existing = await prisma.communicationLog.findFirst({
      where: { tenantId: TENANT_ID, clientId, direction: s.direction, occurredAt: s.occurredAt as Date },
    });
    if (existing) continue;
    await prisma.communicationLog.create({ data: { ...s, tenantId: TENANT_ID } });
    created += 1;
  }
  return created;
}

// ---------------------------------------------------------------------------
// Faz 6) Zamanlanmış iş tanımları + kayıtlı rapor tohumu
// ---------------------------------------------------------------------------

/**
 * Zamanlanmış iş TANIMLARI (docs/06-yol-haritasi.md, Faz 6).
 *
 * Bunlar yalnız TANIMDIR — işi çalıştıran kod Zamanlı-iş modülündedir.
 * Cron ifadeleri gece/sabah bantlarına YAYILMIŞTIR: ağır sayım işleri (kota
 * anlık görüntüsü, abonelik ve kredi dönem yenileme) mesai dışına, kullanıcıya
 * bildirim üreten işler ise insanın okuyacağı saate konumlandırılmıştır.
 * Süre hatırlatması sabah 07:00'de (gün başlarken), duruşma hatırlatması
 * 18:00'de (ertesi gün için hazırlık) çalışır.
 *
 * Her iş İDEMPOTENT olmak zorundadır: aynı gün iki kez tetiklenirse ikinci
 * çalıştırma çift kayıt/çift bildirim ÜRETMEZ (bildirimlerde koruma
 * NotificationOutbox.@@unique([tenantId, dedupeKey]) ile veritabanındadır).
 */
const SCHEDULED_JOBS: Array<{ key: string; name: string; cronExpression: string }> = [
  {
    key: "usage-snapshot-daily",
    name: "Günlük kullanım/kota anlık görüntüsü",
    cronExpression: "0 2 * * *",
  },
  {
    key: "deadline-reminder-daily",
    name: "Yaklaşan ve geçen süre hatırlatmaları",
    cronExpression: "0 7 * * *",
  },
  {
    key: "hearing-reminder-daily",
    name: "Ertesi gün duruşma hatırlatmaları",
    cronExpression: "0 18 * * *",
  },
  {
    key: "subscription-renewal-daily",
    name: "Abonelik dönem yenileme denetimi",
    cronExpression: "0 3 * * *",
  },
  {
    key: "credit-period-renewal-daily",
    name: "Kredi dönemi yenileme ve kota sıfırlama",
    cronExpression: "0 1 * * *",
  },
];

/**
 * İş tanımlarını yazar. IDEMPOTENT: kayıt varsa DOKUNULMAZ — çalışma zamanı
 * alanları (lastRunAt/lastStatus) ve operatörün panelden yaptığı
 * isEnabled/cron değişiklikleri seed tarafından EZİLMEZ.
 */
async function seedScheduledJobs(): Promise<number> {
  let created = 0;
  for (const j of SCHEDULED_JOBS) {
    const existing = await prisma.scheduledJob.findUnique({ where: { key: j.key } });
    if (existing) continue;
    await prisma.scheduledJob.create({ data: j });
    created += 1;
  }
  return created;
}

/**
 * Örnek kayıtlı raporlar — büro genelinde görünür (BURO), panele sabitli.
 *
 * paramsJson yalnız FİLTREDİR, sonuç DEĞİLDİR: rapor her açıldığında rakamlar
 * veritabanından yeniden hesaplanır. Dönem alanlarında kapanış gününün DAHİL
 * olup olmadığı açıkça yazılır (`donemBitisDahil`) — "ayın son günü sayıldı mı"
 * belirsizliği rapor rakamını sessizce kaydırmasın.
 */
async function seedSavedReports(createdBy: string): Promise<number> {
  const seeds: Array<{
    name: string;
    reportKey: string;
    params: Record<string, unknown>;
    isPinned: boolean;
  }> = [
    {
      name: "Büro geneli aylık özet",
      reportKey: "buro-aylik-ozet",
      params: { donem: "GECEN_AY", donemBitisDahil: true, kirilim: "AY" },
      isPinned: true,
    },
    {
      name: "Avukat iş yükü",
      reportKey: "avukat-is-yuku",
      // Roller sunucuda ayrıca denetlenir; burada yalnız filtre tarif edilir.
      params: { donem: "SON_30_GUN", donemBitisDahil: true, roller: ["AVUKAT", "PARTNER"] },
      isPinned: true,
    },
    {
      name: "Tahsilat yaşlandırma",
      reportKey: "tahsilat-yaslandirma",
      // Yaşlandırma kovaları GÜN bazlıdır ve üst sınır HARİÇTİR (0-30, 31-60, ...).
      params: { referansTarih: "BUGUN", kovalarGun: [30, 60, 90], sadeceAcik: true },
      isPinned: false,
    },
  ];

  let created = 0;
  for (const s of seeds) {
    const existing = await prisma.savedReport.findFirst({
      where: { tenantId: TENANT_ID, reportKey: s.reportKey, name: s.name },
    });
    if (existing) continue;
    await prisma.savedReport.create({
      data: {
        tenantId: TENANT_ID,
        name: s.name,
        reportKey: s.reportKey,
        paramsJson: JSON.stringify(s.params),
        scope: "BURO",
        createdBy,
        isPinned: s.isPinned,
      },
    });
    created += 1;
  }
  return created;
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

  /**
   * SEKRETER ve STAJYER — ROL MATRİSİNİN SINANABİLİR OLMASI İÇİN.
   *
   * Tohumda yalnız PARTNER ve AVUKAT vardı; oysa finans/faturalama/icra rol
   * matrisinin ASIL kısıtları bu iki role bakar:
   *   SEKRETER → okur, zaman kaydı ve tahsilat girer; fatura KESEMEZ,
   *              finans hareketi (cari) AÇAMAZ.
   *   STAJYER  → finans/faturalama/icra verisinin HİÇBİRİNİ göremez.
   * İki hesap olmadan bu kapılar ne elle ne de duman testiyle sınanabiliyordu;
   * "beyaz liste" olduğu iddia edilen matris fiilen doğrulanmamış kalıyordu.
   */
  await prisma.user.upsert({
    where: { email: "sekreter@demo.nomosos.local" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "sekreter@demo.nomosos.local",
      passwordHash,
      fullName: "Demo Sekreter",
      role: "SEKRETER",
    },
  });

  await prisma.user.upsert({
    where: { email: "stajyer@demo.nomosos.local" },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "stajyer@demo.nomosos.local",
      passwordHash,
      fullName: "Demo Stajyer",
      role: "STAJYER",
    },
  });

  const retiredRules = await retireRemovedSystemRules();
  const ruleCount = await seedDeadlineRules();
  const holidayCounts = await seedHolidays();
  const templateCount = await seedPetitionTemplates();
  const caseLawCount = await seedCaseLaw();
  const agentCount = await seedAgentDefinitions();
  void agentCount; // tohum sayısı; özet çıktısında kullanılmıyor

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

  // ---- Modül 26: AI kredi sistemi ----------------------------------------

  const taskCostCount = await seedAiTaskCosts();
  const packageCount = await seedCreditPackages();
  const modelPriceCount = await seedModelPrices();
  const walletCreated = await seedCreditWallet();

  // ---- Faz 4: delil / bilirkişi / risk ------------------------------------
  //
  // Matris ve risk seti c1'e (ticari alacak davası) bağlanır — derdest dosya,
  // iddia/delil örgüsü en zengin olan. Bilirkişi raporu c5'e bağlanır: ara
  // kararla kimya mühendisi bilirkişi atanan dosya ODUR; raporu başka dosyaya
  // koymak safahatla çelişirdi.

  const matrix = await seedEvidenceMatrix(c1.record.id, avukat.id);
  const expert = await seedExpert(c5.record.id, partner.id);
  const risk = await seedRiskScores(c1.record.id, partner.id);

  // ---- Faz 5: portal / iletişim / vekaletname / sözleşme -------------------
  //
  // Portal ABC Holding'e (tüzel müvekkil) bağlanır: yayın kontrolü tüzel kişide
  // en anlamlı olan senaryodur (birden çok yetkili, birden çok dosya). Yayın
  // YALNIZ c1 için yapılır — ABC'nin ikinci dosyası (c2, icra) BİLEREK
  // yayınlanmaz: "yayınlanmamış kaynak portalda görünmez" kuralı böyle sınanır.

  const messageTemplateCount = await seedMessageTemplates();
  const portal = await seedPortal(abc.id, c1.record.id, avukat.id, passwordHash);
  const poa = await seedPowerOfAttorneys(abc.id, c1.record.id, mehmet.id, c3.record.id);
  const contract = await seedContracts(abc.id, c1.record.id, partner.id);
  const commCount = await seedCommunications(abc.id, c1.record.id, avukat.id);
  const scheduledJobCount = await seedScheduledJobs();
  const savedReportCount = await seedSavedReports(partner.id);

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

  // ── Yargı organları + noterler (referans katalog — listeden seçim) ────────
  const { bodies: judicialBodies, notaries } = buildJudicialCatalog();
  let bodyAdded = 0;
  let notaryAdded = 0;
  for (const b of judicialBodies) {
    const exists = await prisma.judicialBody.findUnique({
      where: { type_name: { type: b.type, name: b.name } },
      select: { id: true },
    });
    if (!exists) {
      await prisma.judicialBody.create({ data: b });
      bodyAdded++;
    }
  }
  for (const n of notaries) {
    const exists = await prisma.notaryOffice.findUnique({ where: { name: n.name }, select: { id: true } });
    if (!exists) {
      await prisma.notaryOffice.create({ data: n });
      notaryAdded++;
    }
  }
  // ── Müvekkil segment kataloğu (D7/M3 — kiracı bazlı yönetilen liste) ──────
  const segmentLabels = ["Kurumsal", "Bireysel", "Kamu", "STK"];
  let segmentAdded = 0;
  for (const [i, label] of segmentLabels.entries()) {
    const exists = await prisma.clientSegment.findUnique({
      where: { tenantId_label: { tenantId: TENANT_ID, label } },
      select: { id: true },
    });
    if (!exists) {
      await prisma.clientSegment.create({
        data: { tenantId: TENANT_ID, label, sortOrder: i },
      });
      segmentAdded++;
    }
  }

  // ── Vergi daireleri (D7 — müvekkil kartında listeden seçim) ────────────────
  // TEMSİLÎ liste: her il için merkez dairesi + büyük şehirlerde gerçek adlı
  // büyük mükellefler daireleri. Tam resmî liste SYNC kaynağı ister; katalog
  // panelden büyür ( JudicialBody ile aynı SEED→SYNC→MANUAL hiyerarşisi).
  const taxOffices = buildTaxOfficeCatalog();
  let taxAdded = 0;
  for (const t of taxOffices) {
    const exists = await prisma.taxOffice.findUnique({ where: { name: t.name }, select: { id: true } });
    if (!exists) {
      await prisma.taxOffice.create({ data: t });
      taxAdded++;
    }
  }
  console.log(
    `Yargı organı: ${judicialBodies.length} (eklenen: ${bodyAdded}) | Noter: ${notaries.length} (eklenen: ${notaryAdded}) | Vergi dairesi: ${taxOffices.length} (eklenen: ${taxAdded}, TEMSİLİ) | Segment: ${segmentLabels.length} (eklenen: ${segmentAdded}) — katalog yaklaşık sayılardır; panelden düzenlenebilir.`,
  );

  console.log("Seed tamamlandı.");  console.log(
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
    unbilledTimeEntryTotal,
    financialEntryTotal,
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
    prisma.timeEntry.count({ where: { tenantId: TENANT_ID, invoiceId: null, billable: true } }),
    prisma.financialEntry.count({ where: { tenantId: TENANT_ID } }),
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
    `Ücret sözleşmesi: ${feeAgreementTotal} | Zaman kaydı: ${timeEntryTotal} (eklenen ${finance.entryCount}, ` +
      `FATURALANMAMIŞ ${unbilledTimeEntryTotal}) | Finans hareketi: ${financialEntryTotal} ` +
      `(eklenen ${finance.financeEntryCount}) | Fatura: ${invoiceTotal} (satır ${invoiceLineTotal}, ` +
      `yeni: ${finance.invoiceCreated}) | Ödeme: ${paymentTotal} (eklenen ${finance.paymentCount})`,
  );
  console.log(
    `Plan: ${planTotal} (eklenen ${planCount}) | Platform kullanıcısı: ${platformUserTotal} (eklenen ${platformUserCount}) | ` +
      `Abonelik: ${subscriptionTotal} (yeni: ${subscriptionCreated}) | Kullanım fotoğrafı: ${usageTotal} (eklenen ${usageCount})`,
  );
  const [
    taskCostTotal,
    freeTaskCostTotal,
    packageTotal,
    modelPriceTotal,
    walletTotal,
    creditTxTotal,
    claimTotal,
    evidenceTotal,
    linkTotal,
    basisTotal,
    expertTotal,
    expertReportTotal,
    objectionTotal,
    riskScoreTotal,
    riskHistoryTotal,
  ] = await Promise.all([
    prisma.aiTaskCost.count(),
    prisma.aiTaskCost.count({ where: { isFree: true } }),
    prisma.creditPackage.count(),
    prisma.modelPrice.count(),
    prisma.creditWallet.count({ where: { tenantId: TENANT_ID } }),
    prisma.creditTransaction.count({ where: { tenantId: TENANT_ID } }),
    prisma.claim.count({ where: { tenantId: TENANT_ID } }),
    prisma.evidence.count({ where: { tenantId: TENANT_ID } }),
    prisma.claimEvidenceLink.count({ where: { tenantId: TENANT_ID } }),
    prisma.claimLegalBasis.count({ where: { tenantId: TENANT_ID } }),
    prisma.expert.count({ where: { tenantId: TENANT_ID } }),
    prisma.expertReport.count({ where: { tenantId: TENANT_ID } }),
    prisma.expertObjection.count({ where: { tenantId: TENANT_ID } }),
    prisma.riskScore.count({ where: { tenantId: TENANT_ID } }),
    prisma.riskScoreHistory.count({ where: { tenantId: TENANT_ID } }),
  ]);

  console.log(
    `AI görev fiyatı: ${taskCostTotal} (eklenen ${taskCostCount}, ÜCRETSİZ ${freeTaskCostTotal}) | ` +
      `Kredi paketi: ${packageTotal} (eklenen ${packageCount}) | Model fiyatı: ${modelPriceTotal} (eklenen ${modelPriceCount}) | ` +
      `Cüzdan: ${walletTotal} (yeni: ${walletCreated}) | Kredi hareketi: ${creditTxTotal}`,
  );
  console.log(
    `İddia: ${claimTotal} (eklenen ${matrix.claimCount}) | Delil: ${evidenceTotal} (eklenen ${matrix.evidenceCount}) | ` +
      `Matris bağı: ${linkTotal} (eklenen ${matrix.linkCount}) | Hukuki dayanak: ${basisTotal} (eklenen ${matrix.basisCount})`,
  );
  console.log(
    `Bilirkişi: ${expertTotal} (yeni: ${expert.expertCreated}) | Rapor: ${expertReportTotal} (yeni: ${expert.reportCreated}) | ` +
      `İtiraz: ${objectionTotal} (yeni: ${expert.objectionCreated}) | ` +
      `Risk skoru: ${riskScoreTotal} (eklenen ${risk.scoreCount}) | Risk geçmişi: ${riskHistoryTotal} (eklenen ${risk.historyCount})`,
  );
  const [
    portalUserTotal,
    publicationTotal,
    messageTemplateTotal,
    systemMessageTemplateTotal,
    communicationTotal,
    outboundTotal,
    inboundTotal,
    poaTotal,
    poaTypedTotal,
    poaScopeCheckTotal,
    contractTotal,
    contractVersionTotal,
    signatureRequestTotal,
    documentTotal,
  ] = await Promise.all([
    prisma.portalUser.count({ where: { tenantId: TENANT_ID } }),
    prisma.portalPublication.count({ where: { tenantId: TENANT_ID, unpublishedAt: null } }),
    prisma.messageTemplate.count(),
    prisma.messageTemplate.count({ where: { tenantId: null } }),
    prisma.communicationLog.count({ where: { tenantId: TENANT_ID } }),
    prisma.outboundMessage.count({ where: { tenantId: TENANT_ID } }),
    prisma.inboundMessage.count({ where: { tenantId: TENANT_ID } }),
    prisma.powerOfAttorney.count({ where: { tenantId: TENANT_ID } }),
    prisma.powerOfAttorney.count({ where: { tenantId: TENANT_ID, type: { not: null } } }),
    prisma.poaScopeCheck.count({ where: { tenantId: TENANT_ID } }),
    prisma.contract.count({ where: { tenantId: TENANT_ID } }),
    prisma.contractVersion.count(),
    prisma.signatureRequest.count({ where: { tenantId: TENANT_ID } }),
    prisma.document.count({ where: { tenantId: TENANT_ID } }),
  ]);

  console.log(
    `Portal kullanıcısı: ${portalUserTotal} (yeni: ${portal.portalUserCreated}) | ` +
      `YAYINDA kaynak: ${publicationTotal} (eklenen ${portal.publicationCount}) | Belge: ${documentTotal}`,
  );
  console.log(
    `Mesaj şablonu: ${messageTemplateTotal} (sistem ${systemMessageTemplateTotal}, eklenen ${messageTemplateCount}) | ` +
      `İletişim kaydı: ${communicationTotal} (eklenen ${commCount}) | ` +
      `Giden mesaj: ${outboundTotal} | Gelen mesaj: ${inboundTotal}`,
  );
  console.log(
    `Vekaletname: ${poaTotal} (eklenen ${poa.created}, tipi doldurulan eski kayıt ${poa.backfilled}, ` +
      `tipli ${poaTypedTotal}) | Kapsam analizi: ${poaScopeCheckTotal} | ` +
      `Sözleşme: ${contractTotal} (yeni: ${contract.contractCreated}) | Sürüm: ${contractVersionTotal} | ` +
      `İmza talebi: ${signatureRequestTotal}`,
  );
  const [scheduledJobTotal, savedReportTotal] = await Promise.all([
    prisma.scheduledJob.count(),
    prisma.savedReport.count({ where: { tenantId: TENANT_ID } }),
  ]);

  console.log(
    `Zamanlanmış iş tanımı: ${scheduledJobTotal} (yeni: ${scheduledJobCount}) | ` +
      `Kayıtlı rapor: ${savedReportTotal} (yeni: ${savedReportCount})`,
  );
  console.log(
    "NOT: Faz 6 işleri yalnız TANIM olarak tohumlanır — çalıştırıcı (BullMQ) " +
      "Zamanlı-iş modülündedir; seed hiçbir işi TETİKLEMEZ.",
  );

  console.log(
    "NOT: kredi fiyatları ve paket TL değerleri TEMSİLİDİR — iş kararıdır, platform panelinden güncellenir. " +
      "OpenAI/Gemini model fiyatları YAKLAŞIKTIR ve doğrulanmalıdır.",
  );
  console.log(
    "NOT: Faz 5 demo belgelerinin MinIO'da gerçek nesnesi YOKTUR (storageKey 'demo/...'); " +
      "portal yayın akışı sınanabilir, indirme sınanamaz.",
  );

  console.log(
    "Giriş: partner@demo.nomosos.local / Demo1234!  " +
      "(rol matrisi denemesi için: avukat@ · sekreter@ · stajyer@demo.nomosos.local)",
  );
  console.log(
    "Platform girişi: superadmin@nomosos.local / Demo1234!  " +
      "(dört-göz ikinci imzası: superadmin2@nomosos.local · yatırımcı: analist@nomosos.local)",
  );
  console.log(
    "Portal girişi (AYRI KİMLİK — büro/platform uçlarında GEÇERSİZ): " +
      "portal@demo.nomosos.local / Demo1234!  (ABC Holding A.Ş.)",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
