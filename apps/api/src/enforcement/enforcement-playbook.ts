/**
 * AŞAMA BAZLI İŞLEM KATALOĞU — Copilot'un "uydurma madde" yazmasını engelleyen kapı.
 *
 * SORUN: "Bu aşamada ne yapabilirim?" sorusuna serbest bırakılan bir dil modeli,
 * İİK madde numarasını çok kolay uydurur ve avukat yanlış madde numarasıyla
 * dilekçe yazar. Ürün ilkesi açık: "kaynak gösterme zorunlu, uydurma yasak."
 *
 * ÇÖZÜM: yapılabilecek işlemler ve dayanakları BURADA, insan tarafından yazılmış
 * bir katalogda durur. Copilot bu katalogla birlikte çağrılır ve görevi
 * ÖNCELİKLENDİRMEKTİR — yeni madde numarası üretmek değil. Katalogda olmayan bir
 * dayanağı model yazarsa, çıktı guard'ı kaynaksız bulgu olarak eleyebilir ve
 * avukat listeyi buradaki dayanaklarla karşılaştırabilir.
 *
 * `needsVerification: true` olan maddeler, mevzuat değişikliği nedeniyle süresi
 * veya kapsamı tartışmalı olabilecek hükümlerdir; metinde bu açıkça yazılır.
 * Emin olunmayan yerde numara UYDURULMAZ, "teyit ediniz" denir.
 */

import type { EnforcementStage } from "@nomosos/db";

export interface PlaybookItem {
  title: string;
  /** Mevzuat dayanağı — insan tarafından girilmiştir, model üretmez. */
  legalBasis: string;
  detail: string;
  /** Hükmün güncel hâli/süresi teyit gerektiriyor mu? */
  needsVerification?: boolean;
}

export const STAGE_PLAYBOOK: Record<EnforcementStage, readonly PlaybookItem[]> = {
  TAKIP_TALEBI: [
    {
      title: "Ödeme emrinin düzenlenip borçluya tebliğe çıkarılmasını takip et",
      legalBasis: "İİK m.60 — ödeme emri",
      detail:
        "Takip talebi üzerine icra dairesi ödeme emri düzenler. Tebligatın çıkıp çıkmadığı ve " +
        "tebliğ tarihi, sonraki bütün sürelerin çapasıdır.",
    },
    {
      title: "Borçlunun adres/tebligat bilgilerini doğrula",
      legalBasis: "Tebligat Kanunu (usulsüz tebligat riski)",
      detail:
        "Usulsüz tebligat, itiraz süresini işletmez ve kesinleşmeyi geçersiz kılabilir; adres " +
        "kaydını takip başlamadan teyit ediniz.",
    },
  ],
  ODEME_EMRI_TEBLIG: [
    {
      title: "İtiraz süresini izle",
      legalBasis: "İİK m.62 — 7 gün (kambiyo takibinde İİK m.168/5 — 5 gün)",
      detail:
        "Süre, ödeme emrinin tebliğinden işler. Takip tipi kambiyo ise süre 7 değil 5 gündür; " +
        "yanlış süre doğrudan hak kaybıdır. Gün hesabı Süre Motoru'ndan alınır.",
    },
    {
      title: "Mal beyanında bulunulup bulunulmadığını kontrol et",
      legalBasis: "İİK m.74 — mal beyanı (7 gün)",
      detail:
        "Borçlu süresinde mal beyanında bulunmazsa İİK'nın öngördüğü yaptırımlar gündeme gelebilir.",
    },
    {
      title: "Süre dolduğunda kesinleşmeyi işaretle ve haciz hazırlığına geç",
      legalBasis: "İİK m.78 — haciz isteme",
      detail:
        "İtiraz gelmeden süre dolarsa takip kesinleşir. Kesinleşmeyi SİSTEM DEĞİL AVUKAT işaretler.",
    },
  ],
  ITIRAZ: [
    {
      title: "İtirazın kaldırılması yoluna (icra mahkemesi) başvurmayı değerlendir",
      legalBasis: "İİK m.68 vd. — itirazın kaldırılması",
      detail:
        "Elinizde İİK m.68'de sayılan nitelikte bir belge varsa itirazın kaldırılması yolu, " +
        "itirazın iptali davasından daha hızlı sonuç verir.",
    },
    {
      title: "İtirazın iptali davası açma süresini izle",
      legalBasis: "İİK m.67 — 1 yıl",
      detail:
        "İtirazın tebliğinden itibaren bir yıllık süre içinde dava açılmazsa takip düşer. " +
        "Son gün Süre Motoru'ndan alınır.",
    },
    {
      title: "Kambiyo takibinde itirazın icra mahkemesinde incelenmesini takip et",
      legalBasis: "İİK m.169-170 — kambiyo takibinde itiraz incelemesi",
      detail:
        "Kambiyo senetlerine mahsus takipte itiraz, satış dışındaki işlemleri kendiliğinden " +
        "durdurmaz; usul ilamsız takipten farklıdır.",
      needsVerification: true,
    },
  ],
  ITIRAZIN_KALDIRILMASI: [
    {
      title: "Karar sonucunu dosyaya işle ve takibe devam/duraklama kararını ver",
      legalBasis: "İİK m.68-70 — itirazın kaldırılması kararının sonuçları",
      detail:
        "Talep kabul edilirse takip kaldığı yerden yürür; reddedilirse dosya yeniden itiraz " +
        "aşamasındadır ve itirazın iptali davası yolu değerlendirilmelidir.",
    },
    {
      title: "İnkâr tazminatı taleplerini değerlendir",
      legalBasis: "İİK m.67/2 ve m.68/7 — icra inkâr tazminatı",
      detail: "Şartları oluşmuşsa tazminat talebi ayrıca ileri sürülmelidir.",
      needsVerification: true,
    },
  ],
  KESINLESME: [
    {
      title: "Haciz talebinde bulun",
      legalBasis: "İİK m.78 — haciz isteme süresi (ödeme emrinin tebliğinden itibaren bir yıl)",
      detail:
        "Haciz isteme hakkı süreye tabidir; süre geçerse takip dosyası işlemden kaldırılır ve " +
        "yenileme gerekir. Son günü Süre Motoru'ndan teyit ediniz.",
    },
    {
      title: "Borçlunun malvarlığı sorgularını yap ve sonuçlarını dosyaya işle",
      legalBasis: "İİK m.85 vd. — haczi kabil mallar",
      detail:
        "Tapu, trafik, banka, SGK ve alacak sorgularının sonuçları (bulunamadı sonucu dâhil) " +
        "malvarlığı kaydı olarak girilmelidir; tahsilat skorunun temel girdisidir.",
    },
    {
      title: "Üçüncü kişideki hak ve alacaklar için haciz ihbarnamesi gönder",
      legalBasis: "İİK m.89 — haciz ihbarnamesi",
      detail:
        "Banka ve üçüncü kişilerdeki alacaklar için 89/1-2-3 ihbarnamelerinin süreleri ayrıca izlenir.",
    },
  ],
  HACIZ: [
    {
      title: "Haciz tutanağını ve haczedilen kalemleri dosyaya işle",
      legalBasis: "İİK m.102 — haciz tutanağı",
      detail:
        "Haczedilen her kalem malvarlığı kaydı olarak HACZEDILDI durumuna alınmalıdır; satış " +
        "aşamasına geçiş bu kayda bağlıdır.",
    },
    {
      title: "Kıymet takdirini talep et ve raporu incele",
      legalBasis: "İİK m.128 — kıymet takdiri",
      detail:
        "Kıymet takdirine itiraz süresi ayrıca işler; rapor tebliğ edildiğinde süreyi Süre " +
        "Motoru'na girin.",
    },
    {
      title: "Satış talebi süresini izle",
      legalBasis: "İİK m.106 — satış isteme süresi",
      detail:
        "7343 sayılı Kanun değişikliği sonrası taşınır ve taşınmazda satış isteme süresi bir " +
        "yıl olarak uygulanmaktadır; süreyi ve dosyanızın tarihine göre hangi metnin geçerli " +
        "olduğunu MUTLAKA teyit ediniz.",
      needsVerification: true,
    },
    {
      title: "Maaş haczinde kesinti oranını ve sırasını kontrol et",
      legalBasis: "İİK m.83 — kısmen haczi caiz olan şeyler",
      detail: "Maaş ve ücretlerde haczedilebilir kısım sınırlıdır; nafaka alacakları önceliklidir.",
    },
  ],
  SATIS: [
    {
      title: "Satış ilanının usulüne uygun tebliğini kontrol et",
      legalBasis: "İİK m.126-127 — satış ilanı ve tebliği",
      detail:
        "İlanın ilgililere tebliğ edilmemesi, ihalenin feshi sebebidir; tebligat parçalarını " +
        "dosyaya işleyiniz.",
    },
    {
      title: "İhale sonucunu ve ihalenin feshi süresini izle",
      legalBasis: "İİK m.134 — ihalenin feshi (7 gün)",
      detail: "Süre, ihale tarihinden/öğrenmeden işler; son gün Süre Motoru'ndan alınır.",
    },
  ],
  TAHSILAT: [
    {
      title: "Paranın paylaştırılmasını ve sıra cetvelini takip et",
      legalBasis: "İİK m.138 vd. — paranın paylaştırılması, sıra cetveli",
      detail:
        "Birden çok alacaklı varsa sıra cetveline itiraz süreleri ayrıca izlenir.",
    },
    {
      title: "Tahsil harcını ve vekâlet ücretini dosyaya işle",
      legalBasis: "Harçlar Kanunu — tahsil harcı",
      detail:
        "Haricen tahsilatta da tahsil harcı doğar; harç ödenmeden dosya kapatılmamalıdır.",
    },
    {
      title: "Kalan bakiye için hacze devam edilip edilmeyeceğine karar ver",
      legalBasis: "İİK m.78 — haciz isteme",
      detail: "Kısmi tahsilatta dosya kapanmaz; bakiye için takip sürer.",
    },
  ],
  ACIZ_VESIKASI: [
    {
      title: "Aciz vesikasının hukuki sonuçlarını müvekkile bildir",
      legalBasis: "İİK m.143 — aciz vesikası",
      detail:
        "Aciz vesikası, borcun ödenmediğini belgeler ve borçlunun sonradan mal edinmesi hâlinde " +
        "yeni takip imkânı sağlar; zamanaşımı ve faiz sonuçları ayrıca değerlendirilmelidir.",
      needsVerification: true,
    },
    {
      title: "Borçlunun yeni malvarlığı için periyodik sorgu planla",
      legalBasis: "İİK m.143 — sonradan iktisap edilen mallar",
      detail: "Dosya kapansa dahi periyodik malvarlığı sorgusu tahsilat imkânı yaratabilir.",
    },
  ],
  KAPANDI: [
    {
      title: "Dosyayı arşivle ve müvekkil bilgilendirmesini tamamla",
      legalBasis: "Büro içi süreç",
      detail: "Kapanmış dosyada icra işlemi yapılmaz; yeni takip için yeni dosya açılır.",
    },
  ],
};

/** Katalogu Copilot bağlamına uygun etiketli satırlara çevirir. */
export function buildPlaybookLines(stage: EnforcementStage): string {
  const items = STAGE_PLAYBOOK[stage] ?? [];
  const header =
    "[KATALOG] Aşağıdaki işlem listesi ve mevzuat dayanakları BÜRO TARAFINDAN doğrulanmıştır. " +
    "Öncelik sıralaması yaparken bu listeden seç; listede olmayan bir madde numarası YAZMA, " +
    "gerekiyorsa hükmün adını yaz.";
  if (items.length === 0) return `${header}\n[KATALOG] Bu aşama için kayıtlı işlem yok.`;
  return [
    header,
    ...items.map(
      (i) =>
        `[KATALOG] ${i.title} — ${i.legalBasis}. ${i.detail}` +
        (i.needsVerification ? " (DAYANAK TEYİT GEREKTİRİR)" : ""),
    ),
  ].join("\n");
}
