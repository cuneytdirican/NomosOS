/**
 * HEPO KATALOĞU (Modül 28) — İSG + Çevre + Sağlık uyum hukuku.
 *
 * TEK KAYNAK: bu katalog hem web arayüzünü hem API'nin HepoObligation
 * katalog tohumlamasını (seed) besler. Sayısal bilgiler genel
 * bilgilendirmedir; ceza ve sürelerin dava tarihinde yürürlükte olan
 * metne göre doğrulanması avukatın sorumluluğundadır (içtihat teyit
 * zinciriyle aynı ilke).
 */

export type HepoTopic = "ISG" | "CEVRE" | "SAGLIK";

export const HEPO_TOPICS: readonly HepoTopic[] = ["ISG", "CEVRE", "SAGLIK"];

export const HEPO_TOPIC_LABELS: Record<HepoTopic, string> = {
  ISG: "İş Sağlığı ve Güvenliği",
  CEVRE: "Çevre",
  SAGLIK: "Sağlık Hukuku",
};

export type HepoPeriodicity =
  | "TEK SEFER"
  | "YILLIK"
  | "2 YILDA BİR"
  | "3 YILDA BİR"
  | "5 YILDA BİR"
  | "6 YILDA BİR";

export const HEPO_PERIODICITIES: readonly HepoPeriodicity[] = [
  "TEK SEFER",
  "YILLIK",
  "2 YILDA BİR",
  "3 YILDA BİR",
  "5 YILDA BİR",
  "6 YILDA BİR",
];

export interface HepoObligationDef {
  id: string;
  topic: HepoTopic;
  title: string;
  legalBasis: string;
  periodicity: HepoPeriodicity;
  responsible: string;
  summary: string;
  penaltyNote: string;
}

/** Yükümlülük kataloğu — HepoObligation tablosunun tohum verisi. */
export const HEPO_OBLIGATIONS: readonly HepoObligationDef[] = [
  {
    id: "risk-degerlendirme",
    topic: "ISG",
    title: "Risk değerlendirmesi",
    legalBasis: "6331 s.k. m.10",
    periodicity: "6 YILDA BİR",
    responsible: "İşveren + İSG profesyoneli",
    summary:
      "Her işyerinde tehlike sınıfına bakılmaksızın risk değerlendirmesi yapılır/yenilenir; yapı değişikliği, ölüm veya sürekli sakatlığa yol açan kaza hâllerinde yenileme süresi kısalır.",
    penaltyNote: "Yapılmaması idari para cezası ile yaptırımlıdır; ceza, çalışan sayısına ve tehlike sınıfına göre artar.",
  },
  {
    id: "isg-profesyonel",
    topic: "ISG",
    title: "İSG profesyoneli görevlendirme (İSG-Katip)",
    legalBasis: "6331 s.k. m.6",
    periodicity: "YILLIK",
    responsible: "İşveren",
    summary:
      "İş güvenliği uzmanı ve işyeri hekimi görevlendirmesi İSG-Katip üzerinden bildirilir; asgari görevlendirme süreleri çalışan sayısı ve tehlike sınıfına göre belirlenir.",
    penaltyNote: "Görevlendirmeme, eksik süre bildirimi ve danışman gösterme idari yaptırım konusudur.",
  },
  {
    id: "egitim",
    topic: "ISG",
    title: "İSG eğitimleri",
    legalBasis: "6331 s.k. m.17",
    periodicity: "YILLIK",
    responsible: "İşveren",
    summary:
      "Çalışanlara işe başlamadan önce ve düzenli aralıklarla İSG eğitimi verilir; eğitim kayıtları saklanır ve İSG-Katip'e bildirilir.",
    penaltyNote: "Eğitimsiz çalışan çalıştırma ceza nedenidir; kayıt eksikliği de yaptırımlıdır.",
  },
  {
    id: "acil-durum-plani",
    topic: "ISG",
    title: "Acil durum planı ve tatbikat",
    legalBasis: "6331 s.k. m.11-12 ve Acil Durum Yön.",
    periodicity: "2 YILDA BİR",
    responsible: "İşveren + İSG profesyoneli",
    summary:
      "Acil durum planı hazırlanır, söndürme/kurtarma/ilk yardım ekipleri kurulur; tahliye tatbikatları düzenlenir ve güncelleme periyodu izlenir.",
    penaltyNote: "Plansızlık ve tatbikatsızlık ayrı ayrı cezalandırılır.",
  },
  {
    id: "periyodik-muayene",
    topic: "ISG",
    title: "İş ekipmanı periyodik muayenesi",
    legalBasis: "6331 s.k. m.10; İş Ekipmanları Yön. Ek-3",
    periodicity: "YILLIK",
    responsible: "İşveren",
    summary:
      "Kaldırma araçları, basınçlı kaplar, elektrik tesisatı vb. ekipman periyodik kontrol edilir; raporlar saklanır.",
    penaltyNote: "Muayenesiz ekipman kullanımı ağır idari yaptırım ve kaza hâlinde tazminat sorumluluğu üretir.",
  },
  {
    id: "saglik-gozetimi",
    topic: "ISG",
    title: "Sağlık gözetimi (işe giriş + periyodik muayene)",
    legalBasis: "6331 s.k. m.14-15",
    periodicity: "YILLIK",
    responsible: "İşyeri hekimi",
    summary:
      "Çalışanlara işe giriş, iş değişikliği, işe dönüş ve periyodik sağlık muayenesi yapılır; işe uygunluk raporları dosyalanır.",
    penaltyNote: "Muayenesiz çalıştırma ceza nedenidir; kayıtlar 10 yıl saklanır.",
  },
  {
    id: "kaza-bildirim",
    topic: "ISG",
    title: "İş kazası bildirimi",
    legalBasis: "6331 s.k. m.14",
    periodicity: "TEK SEFER",
    responsible: "İşveren",
    summary:
      "İş kazası en geç 3 iş günü içinde SGK'ya bildirilir; ölüm hâlinde aynı gün ilgili birimlere ek bildirim yapılır. Bildirim ihmalinin ceza ve tazminat boyutu vardır.",
    penaltyNote: "Bildirim süresi aşımı idari yaptırım; gizlenen kaza hâlinde ceza artar.",
  },
  {
    id: "isg-kurulu",
    topic: "ISG",
    title: "İSG kurulu (50+ çalışan)",
    legalBasis: "6331 s.k. m.22",
    periodicity: "YILLIK",
    responsible: "İşveren",
    summary: "Elli ve üzeri çalışanı olan işyerlerinde kurul toplanır; kararlar izlenir ve uygulanır.",
    penaltyNote: "Kurulsuz çalıştırma idari para cezası ile yaptırımlıdır.",
  },
  {
    id: "ced",
    topic: "CEVRE",
    title: "ÇED raporu / ÇED gereklidir belgesi",
    legalBasis: "03.10.2023 tarihli ÇED Yönetmeliği",
    periodicity: "TEK SEFER",
    responsible: "Proje sahibi",
    summary:
      "ÇED kapsamındaki faaliyetler için halkın katılımı süreciyle ÇED raporu; kapsam dışı faaliyetler için ÇED gereklidir belgesi alınır.",
    penaltyNote: "ÇED'siz faaliyet durdurulabilir ve idari para cezası uygulanabilir.",
  },
  {
    id: "e-il",
    topic: "CEVRE",
    title: "Çevre izin/lisans (E-İZİN/E-İL)",
    legalBasis: "Çevre Kanunu m.8; Çevre İzin ve Lisans Yön.",
    periodicity: "5 YILDA BİR",
    responsible: "İşletme",
    summary:
      "Emisyon/deşaraj kapsamındaki işletmeler için izin/lisans ve düzenli ölçüm bildirimleri Çevre İzin ve Lisans Sistemi üzerinden yürütülür.",
    penaltyNote: "İzinsiz işletme faaliyet durdurma ile sonuçlanabilir.",
  },
  {
    id: "atik-yonetimi",
    topic: "CEVRE",
    title: "Atık yönetimi (tehlikeli atık beyanı)",
    legalBasis: "Çevre Kanunu; Atık Yönetmeliği",
    periodicity: "YILLIK",
    responsible: "İşletme",
    summary:
      "Tehlikeli atıklar atık beyan sistemi üzerinden beyan edilir, taşıyıcı ve bertaraf firma yetki belgeleri dosyalanır.",
    penaltyNote: "Beyansız taşıma/bertaraf çevre cezalarının en sık konusudur.",
  },
  {
    id: "hasta-haklari",
    topic: "SAGLIK",
    title: "Hasta hakları ve aydınlatma yükümlülüğü",
    legalBasis: "Hasta Hakları Yön.; KVKK",
    periodicity: "TEK SEFER",
    responsible: "Sağlık kuruluşu",
    summary:
      "Tıbbi müdahale onamı, aydınlatma ve kayıt talepleri protokollere bağlanır; sağlık verileri KVKK özel nitelikli kişisel veri rejimine tabidir.",
    penaltyNote: "Onamsız müdahale tazminat ve ceza sorumluluğu üretir.",
  },
  {
    id: "meslek-hastaligi",
    topic: "SAGLIK",
    title: "Meslek hastalığı bildirimi",
    legalBasis: "5510 s.k.; Sosyal Sigortalar Sağlık İşlemleri Yön.",
    periodicity: "TEK SEFER",
    responsible: "Sağlık hizmeti sunucusu",
    summary: "Meslek hastalığı şüphesi yetkili kuruma bildirilir; tespit süreci SGK ve sağlık kuruluşu ile yürütülür.",
    penaltyNote: "Bildirim ihmali kurum zararı ve ceza riski doğurur.",
  },
];

/** Müvekkil yükümlülük durumları — şerit denetimli değil; serbest güncelleme. */
export const HEPO_STATUSES = ["ACIK", "UYGUN", "UYGUN_DEGIL", "IHLAL"] as const;
export type HepoStatus = (typeof HEPO_STATUSES)[number];

export const HEPO_STATUS_LABELS: Record<HepoStatus, string> = {
  ACIK: "Açık",
  UYGUN: "Uygun",
  UYGUN_DEGIL: "Uygun değil",
  IHLAL: "İhlal",
};

export interface HepoDeadlineDef {
  id: string;
  title: string;
  basis: string;
  period: string;
  /** Hatırlatmanın kaç gün önce üretilmesi gerektiği. */
  remindBeforeDays: number;
}

/** Yasal süreler ve hatırlatma pencereleri — danışma amaçlı özet. */
export const HEPO_DEADLINES: readonly HepoDeadlineDef[] = [
  { id: "kaza-3-gun", title: "İş kazası bildirimi (SGK)", basis: "6331 m.14", period: "Kazadan itibaren 3 iş günü", remindBeforeDays: 0 },
  { id: "olum-ayni-gun", title: "Ölümlü kaza ihbarı (bulunduğu yer zabıtası, C.Savcısı, SGK)", basis: "6331 m.14", period: "Aynı gün", remindBeforeDays: 0 },
  { id: "atik-beyan-subat", title: "Yıllık tehlikeli atık beyanı", basis: "Atık Yön.", period: "Şubat (yıllık)", remindBeforeDays: 14 },
  { id: "egitim-yillik", title: "Yıllık İSG eğitim planı uygulanması", basis: "6331 m.17", period: "Yılda 1", remindBeforeDays: 30 },
  { id: "tatbikat-2-yil", title: "Acil durum tatbikatı", basis: "Acil Durum Yön.", period: "2 yılda 1", remindBeforeDays: 30 },
  { id: "risk-6-yil", title: "Risk değerlendirmesi yenileme", basis: "6331 m.10", period: "6 yılda 1 (ölüm/sakatlık hâlinde kısalır)", remindBeforeDays: 60 },
  { id: "olcum-bildirim", title: "Emisyon/deşaraj ölçüm bildirimi", basis: "E-İZİN lisansı", period: "Lisans periyodu", remindBeforeDays: 60 },
];

export interface HepoPenaltyDef {
  id: string;
  violation: string;
  law: string;
  fineBasis: string;
  aggravating: string[];
}

export const HEPO_PENALTIES: readonly HepoPenaltyDef[] = [
  {
    id: "risk-ceza",
    violation: "Risk değerlendirmesi yapmama",
    law: "6331 m.26",
    fineBasis: "Çalışan sayısı ve tehlike sınıfına göre kademeli asgari ceza",
    aggravating: ["Ölüm veya sürekli sakatlık hâli", "tekrar", "az tehlikeli sınıfta dahi yapılmaması"],
  },
  {
    id: "profesyonel-ceza",
    violation: "İSG profesyoneli görevlendirmeme",
    law: "6331 m.26",
    fineBasis: "Görevlendirilmeyen profesyonel başına çalışan sayısına göre artan ceza",
    aggravating: ["Danışman gösterme", "eksik süre bildirimi", "İSG-Katip'te fiilen çalışmama"],
  },
  {
    id: "egitim-ceza",
    violation: "İSG eğitimi vermeme",
    law: "6331 m.26",
    fineBasis: "Eğitimsiz çalışan başına ceza",
    aggravating: ["Kayıt tutmama", "sahte eğitim beyanı"],
  },
  {
    id: "cevre-genel",
    violation: "Çevreyi kirletme / izinsiz faaliyet",
    law: "Çevre Kanunu m.20",
    fineBasis: "Faaliyet türüne ve tonaj/yüzey ölçüsüne göre kademeli ceza",
    aggravating: ["Korunan alanda faaliyet", "tekrar", "atığın izinsiz bertarafı", "kalıcı hasar"],
  },
  {
    id: "atik-ceza",
    violation: "Tehlikeli atığı usulsüz taşıma/bertaraf",
    law: "Çevre Kanunu m.20; Atık Yön.",
    fineBasis: "Araç/ton bazında ceza",
    aggravating: ["Yetkisiz alıcı", "beyan dışı atık"],
  },
];

export interface HepoCaseGuideDef {
  id: string;
  caseType: string;
  burden: string;
  deadlines: string;
  strategy: string[];
}

export const HEPO_CASE_GUIDES: readonly HepoCaseGuideDef[] = [
  {
    id: "is-kazasi-maddi",
    caseType: "İş kazası — maddi tazminat (SSK/4/a ve BAĞ-KUR/4/b)",
    burden: "Zarar, illiyet bağı, kusur ve kazanın iş kazası niteliği davacıda; rapor ve bilirkişi merkezi rolde.",
    deadlines: "Zarar öğrendiği tarihten itibaren 2 yıl ve her hâlde 10 yıl (BMK m.72); zamanaşımı def'i sık kullanılır.",
    strategy: [
      "Dosya ön incelemesinde tahkikat dosyası, kaza tutanağı ve İSG-Katip kayıtları derhal istenir",
      "İşverenin 6331 yükümlülük ihlalleri (eğitim, ekipman muayenesi, koruyucu donanım) raporla sabitlenir",
      "Rücu davası (SGK) ve işçinin maddi-manevi tazminat davası ayrı takip edilir",
    ],
  },
  {
    id: "is-kazasi-manevi",
    caseType: "İş kazası — manevi tazminat",
    burden: "Ölüm/ağır yaralanma olgusu ve illiyet bağı; manevi zarar karineyle kabul edilir, miktar hâkimin takdirindedir.",
    deadlines: "BMK m.72 (2 yıl / 10 yıl).",
    strategy: [
      "Destekten yoksun kalma tazminatı için gelir ve yaş hesaplaması bilirkişiye yaktırılır",
      "Manevi tazminatta Türk mahkemesi emsal kararları dosyaya konur",
    ],
  },
  {
    id: "isg-ceza-itiraz",
    caseType: "İdari para cezasına itiraz (İSG ve çevre cezaları)",
    burden: "İdare cezanın unsurlarını ispat eder; yükümlülüğün yerine getirildiği dosya kayıtlarıyla gösterilir.",
    deadlines: "Tebligattan itibaren 15 gün idareye itiraz; ardından 30 gün içinde idare mahkemesi dava.",
    strategy: [
      "2577 s.k. m.28 yürütmenin durdurulması talebi değerlendirilir",
      "Yükümlülük kayıtları (eğitim tutanakları, muayene raporları, İSG-Katip çıktıları) itiraz ekinde sunulur",
    ],
  },
  {
    id: "cevre-dava",
    caseType: "Çevre mevzuatı ihlali — ceza ve işletme durdurma",
    burden: "Ölçüm raporları ve tutanaklar; usulsüzlüğün niteliği (emisyon/deşaraj/atık) ayrıştırılır.",
    deadlines: "İdari yaptırıma itiraz 15 gün; yargı yolu 30 gün.",
    strategy: [
      "Çevre izin/lisans kapsamı ve ölçüm raporlarının geçerliliği denetlenir",
      "Çevre mevzuatına uygunluğu gösterir kuruluş raporları dosya ekinde toplanır",
    ],
  },
];

export interface HepoChecklistDef {
  id: string;
  sector: string;
  items: string[];
}

export const HEPO_CHECKLISTS: readonly HepoChecklistDef[] = [
  {
    id: "imalat",
    sector: "İmalat / sanayi",
    items: [
      "İSG-Katip görevlendirme süreleri doğru beyan mı?",
      "Risk değerlendirmesi güncel mi; yapı değişikliği sonrası yenilenmiş mi?",
      "Periyodik muayene takvimi (kaldırma araçları, basınçlı kaplar) tam mı?",
      "Tehlikeli atık beyanı ve bertaraf firma yetki belgeleri dosyada mı?",
      "Çevre izin/lisans geçerlilik süresi izleniyor mu?",
    ],
  },
  {
    id: "insaat",
    sector: "İnşaat",
    items: [
      "Ağır ve çok tehlikeli sınıf önlemleri (çökme, düşme, enerji) planlandı mı?",
      "Alt işverenlerin İSG sorumlulukları sözleşmeye bağlandı mı?",
      "Şantiye acil durum planı ve tahliye tatbikatı yapıldı mı?",
      "Halat ve iskele periyodik muayeneleri raporlandı mı?",
    ],
  },
  {
    id: "saglik",
    sector: "Sağlık kuruluşu",
    items: [
      "Tıbbi müdahale onam formları mevzuata uygun mu?",
      "Sağlık verileri KVKK özel nitelikli veri rejimiyle işleniyor mu?",
      "Hasta hakları birimi ve şikâyet süreci işliyor mu?",
      "Tıbbi atık yönetimi (ayrıştırma, taşıma) belgeli mi?",
    ],
  },
  {
    id: "ofis",
    sector: "Ofis / hafif tehlike",
    items: [
      "Ergonomi ve ekran kullanım eğitimi verildi mi?",
      "Yangın söndürücü bakımı ve acil çıkış işaretlemesi güncel mi?",
      "Yıllık sağlık gözetimi planlandı mı?",
    ],
  },
];
