/**
 * FAZ 7C — SİSTEM İŞ AKIŞI ŞABLONLARI (dava türü → görev zinciri).
 *
 * Kodda tutulur: her büroda aynıdır, sürümle değişir. Büro kendi şablonunu DB'de yazar.
 * `offsetDays` başlangıç tarihinden (varsayılan bugün) itibaren gün; `role` yalnız
 * İPUCU (atama yine kullanıcı seçimi / dosya sorumlusudur — tahmin yok).
 *
 * Süreler HUKUKİ SÜRE DEĞİLDİR; büro içi çalışma planıdır. Yasal süreler kural
 * motorundan (deadlines) gelir; bu zincir onları hatırlatır, hesaplamaz.
 */

import { z } from "zod";

export const workflowItemSchema = z.object({
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(["DUSUK", "NORMAL", "YUKSEK", "KRITIK"]).default("NORMAL"),
  /** Başlangıçtan itibaren gün (0 = başlangıç günü). */
  offsetDays: z.number().int().min(0).max(3650).default(0),
  /** Rol ipucu: AVUKAT | STAJYER | SEKRETER | PARTNER — atama değil, görünür öneri. */
  roleHint: z.enum(["ADMIN", "PARTNER", "AVUKAT", "STAJYER", "SEKRETER"]).nullable().optional(),
  /** true → görev kontrolcü ister (KONTROLDE adımı). */
  needsReview: z.boolean().default(false),
});
export type WorkflowItem = z.infer<typeof workflowItemSchema>;

export const workflowTemplateSchema = z.object({
  key: z.string().trim().regex(/^[A-Z0-9_]{3,60}$/, "Anahtar BÜYÜK harf, rakam ve alt çizgi içermelidir (3–60)."),
  name: z.string().trim().min(3).max(200),
  caseType: z.enum(["DAVA", "ICRA", "ARABULUCULUK", "CEZA", "DANISMANLIK"]).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  items: z.array(workflowItemSchema).min(1).max(60),
  isActive: z.boolean().default(true),
});
export type WorkflowTemplateInput = z.infer<typeof workflowTemplateSchema>;

export const applyWorkflowSchema = z.object({
  caseId: z.string().uuid(),
  /** Verilmezse dosya sorumlusu, o da yoksa uygulayan kullanıcı. */
  assigneeId: z.string().uuid().nullable().optional(),
  reviewerId: z.string().uuid().nullable().optional(),
  /** ISO tarih; verilmezse bugün. */
  startDate: z.coerce.date().optional(),
  /** Zincirden çıkarılacak adım sıraları (0 tabanlı). */
  skip: z.array(z.number().int().min(0)).max(60).optional(),
});
export type ApplyWorkflowInput = z.infer<typeof applyWorkflowSchema>;

export interface SystemWorkflowTemplate {
  key: string;
  name: string;
  caseType: "DAVA" | "ICRA" | "ARABULUCULUK" | "CEZA" | "DANISMANLIK" | null;
  description: string;
  items: WorkflowItem[];
}

export const SYSTEM_WORKFLOW_TEMPLATES: SystemWorkflowTemplate[] = [
  {
    key: "SYS_DAVA_ACILIS",
    name: "Dava açılışı (hukuk)",
    caseType: "DAVA",
    description: "Vekâlet kontrolünden dava dilekçesi ve harç yatırmaya kadar büro içi açılış zinciri.",
    items: [
      { title: "Vekâletname ve yetki kontrolü", description: "Vekâletname kapsamı bu dava türünü kapsıyor mu? Eksikse müvekkilden yeni vekâlet.", priority: "YUKSEK", offsetDays: 0, roleHint: "SEKRETER", needsReview: false },
      { title: "Müvekkil belgeleri ve delil listesi", description: "Sözleşme, yazışma, fatura, tanık listesi — delil sekmesine işlenir.", priority: "NORMAL", offsetDays: 2, roleHint: "STAJYER", needsReview: false },
      { title: "Arabuluculuk / dava şartı kontrolü", description: "Zorunlu arabuluculuk kapsamında mı? Son tutanak var mı?", priority: "KRITIK", offsetDays: 2, roleHint: "AVUKAT", needsReview: false },
      { title: "Dava dilekçesi taslağı", description: "Dilekçe stüdyosunda taslak; kaynaklar ve atıflar doğrulanır.", priority: "YUKSEK", offsetDays: 5, roleHint: "AVUKAT", needsReview: true },
      { title: "Harç ve gider avansı hesabı", description: "Harç tarifesinden nispi/maktu harç + gider avansı; müvekkile bildirim.", priority: "NORMAL", offsetDays: 6, roleHint: "SEKRETER", needsReview: false },
      { title: "UYAP'tan dava açılışı ve dosya numarası", description: "Dilekçe UDF ile UYAP'a; esas numarası dosyaya işlenir.", priority: "KRITIK", offsetDays: 8, roleHint: "AVUKAT", needsReview: false },
      { title: "Tensip zaptı takibi", description: "Tensip tebliğinde süreler (cevap, ön inceleme) kural motorundan açılır.", priority: "NORMAL", offsetDays: 21, roleHint: "STAJYER", needsReview: false },
    ],
  },
  {
    key: "SYS_ICRA_TAKIP",
    name: "İlamsız icra takibi başlatma",
    caseType: "ICRA",
    description: "Takip talebinden ödeme emri tebliğine ve itiraz süresinin izlenmesine kadar.",
    items: [
      { title: "Alacak belgeleri ve borçlu bilgileri", description: "Fatura/sözleşme/senet; borçlu kimlik-adres teyidi (MERNİS/ticaret sicili).", priority: "YUKSEK", offsetDays: 0, roleHint: "SEKRETER", needsReview: false },
      { title: "Faiz türü ve tutar hesabı", description: "Asıl alacak + işlemiş faiz (yasal/avans) — bakiye ekranı ile teyit.", priority: "YUKSEK", offsetDays: 1, roleHint: "AVUKAT", needsReview: true },
      { title: "Takip talebi (UYAP)", description: "Takip talebi ve ödeme emri UYAP'tan; dosya numarası icra dosyasına işlenir.", priority: "KRITIK", offsetDays: 2, roleHint: "AVUKAT", needsReview: false },
      { title: "Ödeme emri tebliğ takibi", description: "Tebliğ tarihi tebligat sekmesine; itiraz süresi (İİK 62) otomatik açılır.", priority: "NORMAL", offsetDays: 10, roleHint: "STAJYER", needsReview: false },
      { title: "İtiraz yoksa haciz talebi", description: "Kesinleşme sonrası haciz talebi; haciz sonrası satış isteme süresi (İİK 106) izlenir.", priority: "YUKSEK", offsetDays: 20, roleHint: "AVUKAT", needsReview: false },
    ],
  },
  {
    key: "SYS_ARABULUCULUK",
    name: "Arabuluculuk süreci",
    caseType: "ARABULUCULUK",
    description: "Başvurudan son tutanağa kadar; anlaşmazlık hâlinde dava zincirine köprü.",
    items: [
      { title: "Arabuluculuk başvurusu", description: "Yetkili büroya başvuru; başvuru tarihi zamanaşımı durması için dosyaya işlenir.", priority: "YUKSEK", offsetDays: 0, roleHint: "AVUKAT", needsReview: false },
      { title: "Müvekkil bilgilendirme ve teklif çerçevesi", description: "Kabul edilebilir aralık ve yetki sınırı yazılı alınır.", priority: "NORMAL", offsetDays: 3, roleHint: "AVUKAT", needsReview: false },
      { title: "Toplantı hazırlığı", description: "Belgeler, hesap tablosu, karşı taraf profili.", priority: "NORMAL", offsetDays: 7, roleHint: "STAJYER", needsReview: false },
      { title: "Son tutanak ve sonuç işleme", description: "Anlaşma → ilam niteliği/icra edilebilirlik şerhi; anlaşmazlık → dava zinciri.", priority: "KRITIK", offsetDays: 21, roleHint: "AVUKAT", needsReview: true },
    ],
  },
  {
    key: "SYS_CEZA_SORUSTURMA",
    name: "Ceza — soruşturma evresi",
    caseType: "CEZA",
    description: "Şüpheli/müşteki vekilliğinde soruşturma dosyası takibi.",
    items: [
      { title: "Vekâlet/CMK görevlendirme ve dosya inceleme talebi", description: "Kısıtlama kararı var mı? Dosya örneği talebi.", priority: "KRITIK", offsetDays: 0, roleHint: "AVUKAT", needsReview: false },
      { title: "İfade / sorgu hazırlığı", description: "Müvekkil görüşmesi; susma hakkı ve savunma stratejisi.", priority: "KRITIK", offsetDays: 1, roleHint: "AVUKAT", needsReview: false },
      { title: "Delil toplama talebi ve tanık listesi", description: "Lehe delillerin toplanması talebi savcılığa.", priority: "YUKSEK", offsetDays: 5, roleHint: "AVUKAT", needsReview: true },
      { title: "Kovuşturmaya yer olmadığına / iddianame takibi", description: "KYOK → itiraz süresi (CMK 173); iddianame → tensip/duruşma zinciri.", priority: "NORMAL", offsetDays: 30, roleHint: "STAJYER", needsReview: false },
    ],
  },
  {
    key: "SYS_DOSYA_KAPANIS",
    name: "Dosya kapanış kontrol listesi",
    caseType: null,
    description: "Her dosya türü için kapanış: tahsilat, iade, vekâlet, arşiv.",
    items: [
      { title: "Kesinleşme ve icra edilebilirlik kontrolü", description: "Karar kesinleşti mi? İcra gerekiyor mu?", priority: "YUKSEK", offsetDays: 0, roleHint: "AVUKAT", needsReview: false },
      { title: "Vekâlet ücreti ve masraf mutabakatı", description: "Karşı vekâlet ücreti, gider avansı iadesi, müvekkil bakiyesi; fatura kesimi.", priority: "YUKSEK", offsetDays: 3, roleHint: "PARTNER", needsReview: true },
      { title: "Müvekkile kapanış bilgilendirmesi", description: "Sonuç, tahsilat durumu, belgelerin iadesi; portal yayını.", priority: "NORMAL", offsetDays: 5, roleHint: "SEKRETER", needsReview: false },
      { title: "Belge iadesi ve arşivleme", description: "Asıl belgeler tutanakla iade; dosya arşiv kutusu numarası; KVKK saklama süresi.", priority: "NORMAL", offsetDays: 10, roleHint: "SEKRETER", needsReview: false },
    ],
  },
];
