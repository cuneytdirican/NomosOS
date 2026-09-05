/**
 * FAZ 7 SÖZLEŞME TESTLERİ — büro yönetimi + belge + mobil/portal.
 *
 * 7A (belge): sürüm zinciri ayrı kayıt + supersededAt; paylaşım jetonu yalnız özet;
 * kamusal uç @Public + 302; IMAP parolası mühürlü ve yanıta dönmez; eşleme deterministik.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf-8");
}

describe("Faz 7A: belge sürümü / klasör / paylaşım", () => {
  it("şema: Document.folderPath/versionNo/rootDocumentId/supersededAt + DocumentShareLink.tokenHash @unique", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toMatch(/model Document \{[^}]*folderPath/s);
    expect(schema).toMatch(/model Document \{[^}]*supersededAt/s);
    expect(schema).toMatch(/model DocumentShareLink \{[^}]*tokenHash\s+String\s+@unique/s);
    expect(schema).not.toMatch(/model DocumentShareLink \{[^}]*\btoken\s+String/s);
    expect(() => read("..", "..", "packages", "db", "prisma", "migrations", "20260929100000_faz7a_belge_surum_klasor_paylasim", "migration.sql")).not.toThrow();
  });

  it("liste varsayılan yalnız güncel sürümü döner; klasör yolu normalize edilir", () => {
    const s = read("src", "documents", "documents.service.ts");
    expect(s).toContain('if (params.versions !== "all") where.supersededAt = null;');
    expect(s).toContain("normalizeFolderPath(input.folderPath)");
    expect(read("src", "documents", "documents.dto.ts")).toContain("export function normalizeFolderPath");
  });

  it("sabit yollar :id'den önce (folders, shares/:shareId); kamusal uç @Public + 302 + no-store", () => {
    const c = read("src", "documents", "documents.controller.ts");
    expect(c.indexOf('@Get("folders")')).toBeLessThan(c.indexOf('@Get(":id")'));
    expect(c.indexOf('@Delete("shares/:shareId")')).toBeLessThan(c.indexOf('@Delete(":id")'));
    const p = read("src", "documents", "public-share.controller.ts");
    expect(p).toContain("@Public()");
    expect(p).toContain('@Controller("public/paylasim")');
    expect(p).toContain("res.redirect(302, url)");
    expect(p).toContain('"Cache-Control", "no-store"');
  });

  it("paylaşım: jeton 256 bit, DB'de SHA-256; her erişim denetime düşer; iptal/süre/sayı kapıları", () => {
    const s = read("src", "documents", "document-extras.service.ts");
    expect(s).toContain('randomBytes(32).toString("base64url")');
    expect(s).toContain("tokenHash: hashShareToken(token)");
    expect(s).toContain('action: "DOCUMENT_SHARE_ACCESS"');
    expect(s).toContain("GoneException");
    expect(s).toContain("downloads: { lt: row.maxDownloads }");
  });
});

describe("Faz 7A: e-posta ile belge girişi (IMAP)", () => {
  it("parola AES-GCM mühürlü, serialize parola taşımaz; iş 5 dk; adaptör arayüzü DI ile", () => {
    const s = read("src", "mail-ingest", "mail-ingest.service.ts");
    expect(s).toContain("encryptSecret(input.password)");
    expect(s).toContain("decryptSecret(row.passwordEnc)");
    expect(s).not.toMatch(/passwordEnc: row\.passwordEnc/);
    expect(s).toContain("@Inject(IMAP_CLIENT)");
    const job = read("src", "scheduler", "jobs", "eposta-belge-girisi.job.ts");
    expect(job).toContain('readonly defaultCron = "*/5 * * * *"');
    expect(read("src", "scheduler", "scheduler.constants.ts")).toContain('EPOSTA_BELGE_GIRISI: "eposta-belge-girisi-5dk"');
    expect(read("src", "scheduler", "job-registry.service.ts")).toContain("EpostaBelgeGirisiJob");
    expect(read("src", "app.module.ts")).toContain("MailIngestModule");
  });

  it("eşleme deterministik: çakışan numara → triyaj; ekler yükleme doğrulamasından geçer; tur başına sınır", () => {
    const s = read("src", "mail-ingest", "mail-ingest.service.ts");
    expect(s).toContain("if (hits.length > 1)");
    expect(s).toContain("validateUpload(att.fileName, att.contentType)");
    expect(s).toContain('source: "EPOSTA"');
    const imap = read("src", "mail-ingest", "imap-client.ts");
    expect(imap).toContain("MAX_MESSAGES_PER_SYNC = 25");
    expect(imap).toContain("MAX_ATTACHMENT_BYTES");
  });

  it("paylaşılan rota sabitleri", () => {
    const routes = read("..", "..", "packages", "shared", "src", "api-routes.ts");
    expect(routes).toContain("MAIL_INGEST_ROUTES");
    expect(routes).toContain("/public/paylasim/");
    expect(routes).toContain("/documents/folders");
  });
});

describe("Faz 7B: global arama + Türkçe sıralama", () => {
  it("göç: ICU collation zorunlu (yoksa DURUR) + trigram dizinleri", () => {
    const m = read("..", "..", "packages", "db", "prisma", "migrations", "20260929110000_faz7b_arama_tr_collation", "migration.sql");
    expect(m).toContain("RAISE EXCEPTION");
    expect(m).toContain('COLLATE "tr-TR-x-icu"');
    for (const idx of ["Case_title_trgm", "Client_name_trgm", "Task_title_trgm", "Deadline_title_trgm"]) expect(m).toContain(idx);
  });

  it("arama: görünürlük süzgeçleri her grupta; kısa sorgu sorgu atmaz; İ/ı varyantı", () => {
    const s = read("src", "search", "search.service.ts");
    expect(s).toContain("caseVisibilityWhere(user)");
    expect(s).toContain("relatedCaseVisibilityWhere(user, { optionalCase: true })");
    expect(s).toContain("if (query.length < 2)");
    expect(s).toContain("export function queryVariants");
    expect(s).toContain("supersededAt: null");
    expect(read("src", "app.module.ts")).toContain("SearchModule");
    expect(read("..", "..", "packages", "shared", "src", "api-routes.ts")).toContain("SEARCH_ROUTES");
  });

  it("web: Ctrl+K paleti düzen başlığında; klavye gezinme", () => {
    const l = read("..", "web", "src", "app", "app", "layout.tsx");
    expect(l).toContain("<CommandPalette shortcuts={paletteShortcuts} />");
    const c = read("..", "web", "src", "components", "command-palette.tsx");
    expect(c).toContain('e.key.toLowerCase() === "k"');
    expect(c).toContain('"ArrowDown"');
    expect(c).toContain('api<{ groups: SearchGroup[] }>("/search"');
  });
});

describe("Faz 7C: iş akışı + rol matrisi + toplu işlem", () => {
  it("göç + şema: User.extraPermissions, Task.workflowKey, WorkflowTemplate @@unique([tenantId,key])", () => {
    const m = read("..", "..", "packages", "db", "prisma", "migrations", "20260929120000_faz7c_is_akisi_yetki_toplu", "migration.sql");
    expect(m).toContain('"extraPermissions" TEXT[]');
    expect(m).toContain('"workflowKey" TEXT');
    expect(m).toContain("REFRESH VERSION");
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toMatch(/model WorkflowTemplate \{[^}]*@@unique\(\[tenantId, key\]\)/s);
  });

  it("rol matrisi: guard extraPermissions okur; assertRole hasRole üzerinden; yetki değişimi oturumları düşürür", () => {
    const g = read("src", "common", "guards", "jwt-auth.guard.ts");
    expect(g).toContain("extraPermissions: true");
    expect(g).toContain("permissions: record.extraPermissions");
    const r = read("src", "common", "roles.ts");
    expect(r).toContain("if (!hasRole(user, roles)) {");
    expect(r).toContain("export const PERMISSION_KEYS");
    const u = read("src", "users", "users.service.ts");
    expect(u).toContain("extraPermissions: input.permissions, sessionsValidFrom: new Date()");
  });

  it("şablonlar: sistem şablonları kodda (≥5), uygulama tür uyumu + atama sırası + workflowKey", () => {
    const t = read("src", "workflow", "workflow-templates.ts");
    expect((t.match(/key: "SYS_/g) ?? []).length).toBeGreaterThanOrEqual(5);
    const s = read("src", "workflow", "workflow.service.ts");
    expect(s).toContain("template.caseType !== c.type");
    expect(s).toContain("input.assigneeId ?? c.responsibleUserId ?? user.userId");
    expect(s).toContain("workflowKey: template.key");
    expect(read("src", "app.module.ts")).toContain("WorkflowModule");
  });

  it("toplu işlem döngüdür (kapılar korunur); review-queue/workload/bulk sabit yolları :id'den önce", () => {
    const c = read("src", "tasks", "tasks.controller.ts");
    expect(c.indexOf('@Get("review-queue")')).toBeLessThan(c.indexOf('@Get(":id")'));
    expect(c.indexOf('@Post("bulk")')).toBeLessThan(c.indexOf('@Get(":id")'));
    const s = read("src", "tasks", "tasks.service.ts");
    expect(s).toContain("await this.updateStatus(user, id, input.status as TaskStatus, input.note)");
    expect(s).toContain('action: "TASK_BULK"');
    expect(read("..", "..", "packages", "shared", "src", "api-routes.ts")).toContain("WORKFLOW_ROUTES");
  });
});

describe("Faz 7D: büro dilekçe şablonu + eklenti UDF köprüsü", () => {
  it("şablon CRUD yalnız büro şablonlarına; içe aktarma deterministik (AI yok), künye atılır", () => {
    const s = read("src", "petitions", "petitions.service.ts");
    expect(s).toContain("async createTemplate(");
    expect(s).toContain("async importTemplate(");
    expect(s).toContain("sistem şablonları silinemez");
    expect(s).toContain("readUdf(file.buffer)");
    const imp = read("src", "petitions", "petition-template-import.ts");
    expect(imp).toContain("export function paragraphsToTemplateSections");
    expect(imp).not.toMatch(/runTask|llm|openai/i);
    const c = read("src", "petitions", "petitions.controller.ts");
    expect(c).toContain('@Post("import")');
    expect(c).toContain('@Delete(":id")');
  });

  it("eklenti köprüsü: hazır dilekçe listesi + UDF (UyapTokenGuard); gönderim kullanıcıya ait", () => {
    const c = read("src", "uyap", "uyap.controller.ts");
    expect(c).toContain('@Get("petitions/ready")');
    expect(c).toContain('@Post("petitions/:id/udf")');
    const s = read("src", "uyap", "uyap.service.ts");
    expect(s).toContain("this.petitions.exportUdf(actor, petitionId");
    expect(s).toContain('action: "UYAP_PETITION_UDF"');
    const manifest = read("..", "uyap-extension", "manifest.json");
    expect(manifest).toContain('"optional_permissions": ["downloads"]');
    expect(manifest).not.toMatch(/"permissions": \[[^\]]*"downloads"/);
    const sw = read("..", "uyap-extension", "src", "background", "service-worker.ts");
    expect(sw).toContain('chrome.permissions.contains({ permissions: ["downloads"] })');
    expect(sw).toContain("saveAs: true");
    const popup = read("..", "uyap-extension", "src", "popup", "popup.ts");
    expect(popup).toContain('chrome.permissions.request({ permissions: ["downloads"] })');
  });

  it("finans matrisi: canFinance rol matrisini tanır; rota sabitleri", () => {
    expect(read("src", "finance", "finance-access.ts")).toContain('user.permissions.includes("FINANS")');
    expect(read("..", "..", "packages", "shared", "src", "api-routes.ts")).toContain("PETITION_TEMPLATE_ROUTES");
  });
});

describe("Faz 7E: mobil — kamera ile belge yükleme, uygulama içi görüntüleme, EAS", () => {
  it("bağımlılıklar + izin eklentisi + eas.json profilleri", () => {
    const pkg = read("..", "mobile", "package.json");
    for (const dep of ["expo-image-picker", "expo-document-picker", "expo-web-browser"]) expect(pkg).toContain(`"${dep}"`);
    const app = read("..", "mobile", "app.json");
    expect(app).toContain("expo-image-picker");
    expect(app).toContain("cameraPermission");
    expect(app).toContain("android.permission.CAMERA");
    const eas = read("..", "mobile", "eas.json");
    for (const prof of ["development", "preview", "production"]) expect(eas).toContain(`"${prof}"`);
    expect(eas).toContain("EXPO_PUBLIC_API_URL");
  });

  it("yazma envanteri güncel (7. yazma: belge yükleme); ekran + rota kayıtlı; belge uygulama içinde açılır", () => {
    const ep = read("..", "mobile", "src", "api", "endpoints.ts");
    expect(ep).toContain("7. belge yükleme (Faz 7E)");
    expect(ep).toContain("export async function uploadDocument");
    expect(read("..", "mobile", "src", "api", "client.ts")).toContain("export async function apiUpload");
    expect(() => read("..", "mobile", "app", "belge", "yukle.tsx")).not.toThrow();
    expect(read("..", "mobile", "app", "_layout.tsx")).toContain('name="belge/yukle"');
    const dosya = read("..", "mobile", "app", "dosya", "[id].tsx");
    expect(dosya).toContain("WebBrowser.openBrowserAsync");
    expect(dosya).toContain('pathname: "/belge/yukle"');
    expect(dosya).not.toContain('what="Dilekçe üretimi, belge yükleme');
  });
});

describe("Faz 7F: portal — yapılacaklar, müvekkil yüklemesi, rıza kayıtları, müvekkil durum özeti", () => {
  it("şema + göç: PortalTodo, PortalConsent (ekleme-yalnız, textHash), enum'lar", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("model PortalTodo");
    expect(schema).toMatch(/model PortalConsent \{[^}]*textHash/s);
    expect(schema).toContain("enum PortalConsentKind");
    const m = read("..", "..", "packages", "db", "prisma", "migrations", "20260929130000_faz7f_portal_yapilacak_riza", "migration.sql");
    expect(m).toContain('CREATE TABLE "PortalConsent"');
    expect(m).toContain('CREATE TABLE "PortalTodo"');
  });

  it("portal uçları: clientId oturumdan; yükleme yayında dosyaya, 25 MB, otomatik yayın sahiplik doğrulanmış; rıza IP/UA izi", () => {
    const c = read("src", "portal", "portal.controller.ts");
    expect(c).toContain('@Post("documents")');
    expect(c).toContain('@Get("todos")');
    expect(c).toContain('@Post("consents")');
    expect(c).not.toMatch(/@Query\("clientId"\)/);
    const s = read("src", "portal", "portal.service.ts");
    expect(s).toContain('await this.publications.assertPublished(user, "DOSYA", input.caseId);');
    expect(s).toContain("25 * 1024 * 1024");
    expect(s).toContain("ownershipVerified: true");
    expect(s).toContain('source: "PORTAL"');
    const cs = read("src", "portal", "portal-consent.service.ts");
    expect(cs).toContain("PORTAL_CONSENT_TEXTS");
    expect(cs).toContain("Aydınlatma metni bir bilgilendirmedir; geri çekilemez.");
    const ts = read("src", "portal", "portal-todo.service.ts");
    expect(ts).toContain("visibleCaseIds(user)");
  });

  it("CLIENT_STATUS_SUMMARY ucu: kredi düşer, sade bağlam, mesaj kaydı açmaz; portal web sayfaları + nav", () => {
    const c = read("src", "communication", "communication.controller.ts");
    expect(c).toContain('@Post("client-status-summary")');
    expect(c).toContain('@AiCredits("CLIENT_STATUS_SUMMARY"');
    const o = read("src", "communication", "outbound.service.ts");
    expect(o).toContain("async clientStatusSummary(");
    expect(o).toContain("this.ai.draft(user,");
    const nav = read("..", "portal", "src", "lib", "nav.ts");
    expect(nav).toContain('"/yapilacaklar"');
    expect(nav).toContain('"/rizalar"');
    expect(() => read("..", "portal", "src", "app", "(portal)", "yapilacaklar", "page.tsx")).not.toThrow();
    expect(() => read("..", "portal", "src", "app", "(portal)", "rizalar", "page.tsx")).not.toThrow();
    expect(read("..", "portal", "src", "app", "(portal)", "belgelerim", "page.tsx")).toContain("function UploadForm");
    expect(read("..", "..", "packages", "shared", "src", "api-routes.ts")).toContain("PORTAL_TODO_ROUTES");
  });
});

describe("Faz 7G: dosya detayı sekmeleri + kapanış kontrol listesi", () => {
  it("şema/göç: Case.closingChecklistJson + archiveBoxNo, Evidence.witnessInfoJson", () => {
    const schema = read("..", "..", "packages", "db", "prisma", "schema.prisma");
    expect(schema).toContain("closingChecklistJson String?");
    expect(schema).toContain("archiveBoxNo         String?");
    expect(schema).toContain("witnessInfoJson String?");
    const m = read("..", "..", "packages", "db", "prisma", "migrations", "20260929140000_faz7g_dosya_sekmeleri_kapanis", "migration.sql");
    expect(m).toContain('"archiveBoxNo"');
  });

  it("kapanış listesi: sistem kalemleri veriden, manuel kalemler kim/ne zaman; cases.controller'a dokunulmadı", () => {
    const s = read("src", "cases", "case-closing.service.ts");
    expect(s).toContain("MANUAL_CLOSING_ITEMS");
    expect(s).toContain("readyToClose: autoOk && manualOk");
    expect(s).toContain('action: "CASE_CLOSING_CHECKLIST"');
    const c = read("src", "cases", "case-closing.controller.ts");
    expect(c).toContain('@Get(":caseId/closing-checklist")');
    expect(c).toContain('@Put(":caseId/closing-checklist")');
    expect(read("src", "cases", "cases.module.ts")).toContain("CaseClosingController");
    expect(read("src", "cases", "cases.controller.ts")).not.toContain("closing-checklist");
  });

  it("tanık ayrıntıları JSON; web sekmeleri (tanık/harç/vekâlet/finans/kapanış) dosya detayında", () => {
    expect(read("src", "evidence", "evidence.dto.ts")).toContain("witnessInfoSchema");
    expect(read("src", "evidence", "evidence.service.ts")).toContain("parseWitnessInfo(e.witnessInfoJson)");
    const page = read("..", "web", "src", "app", "app", "dosyalar", "[id]", "page.tsx");
    for (const key of ["taniklar", "harclar", "vekaletname", "finans", "kapanis"]) expect(page).toContain(`{ key: "${key}"`);
    const tabs = read("..", "web", "src", "app", "app", "_components", "case-tabs-faz7.tsx");
    expect(tabs).toContain("calculateDavaHarci");
    expect(tabs).toContain("export function ClosingTab");
    expect(read("..", "..", "packages", "shared", "src", "api-routes.ts")).toContain("CASE_TABS_ROUTES");
  });
});
