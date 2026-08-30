/**
 * Adım 6 — GÖREV ÜRETİMİ şablonları.
 *
 * Şablonlar KURAL TABANLIDIR, AI değildir: belge sınıfı belliyse büronun o
 * belgede yapması gereken iş de bellidir. AI'ın katkısı yalnızca sınıfı ve
 * tespitleri sağlamaktır. Böylece "AI görev uydurdu" hâli mümkün olmaz.
 *
 * Üretilen her şablon bir ÖNERİDİR (DocumentActionProposal, status=BEKLIYOR);
 * onaylanmadan Task kaydı oluşmaz.
 */

import type { DocumentClass, TaskPriority } from "@nomosos/db";

export interface TaskTemplate {
  title: string;
  description: string;
  priority: TaskPriority;
  /** Öneri kartında gösterilecek gerekçe. */
  rationale: string;
}

const TEMPLATES: Partial<Record<DocumentClass, TaskTemplate[]>> = {
  BILIRKISI_RAPORU: [
    {
      title: "Bilirkişi raporuna itiraz dilekçesi hazırla",
      description:
        "Rapordaki tespitleri dosya delilleriyle karşılaştırın; itiraz edilecek hususları " +
        "maddeler hâlinde yazın. İtiraz süresi ayrıca Süre Motoru tarafından hesaplanır.",
      priority: "YUKSEK",
      rationale: "Bilirkişi raporu sınıfındaki belgeler kural olarak itiraz süresi başlatır.",
    },
  ],
  ARA_KARAR: [
    {
      title: "Ara kararın gereğini yerine getir",
      description:
        "Ara kararda büroya yüklenen edimleri (belge sunumu, beyan, avans yatırma) " +
        "listeleyip sorumlusuna dağıtın.",
      priority: "YUKSEK",
      rationale: "Ara kararlar taraflara doğrudan işlem yükü getirir.",
    },
  ],
  GEREKCELI_KARAR: [
    {
      title: "Gerekçeli kararı değerlendir; kanun yoluna başvuru kararı ver",
      description:
        "Hüküm fıkrasını ve gerekçeyi inceleyin; müvekkil lehine/aleyhine sonuçları " +
        "değerlendirip istinaf/temyiz kararını dosyaya not edin.",
      priority: "KRITIK",
      rationale: "Gerekçeli karar, kanun yolu süresini başlatan belgedir.",
    },
    {
      title: "Müvekkili karar hakkında bilgilendir",
      description: "Kararın sonucunu ve olası adımları müvekkile sade bir dille aktarın.",
      priority: "NORMAL",
      rationale: "Karar, müvekkile bildirilmesi gereken esaslı bir gelişmedir.",
    },
  ],
  TENSIP_ZAPTI: [
    {
      title: "Tensip zaptındaki ara kararların gereğini planla",
      description:
        "Tensipte sıralanan işlemleri (delil listesi, avans, adres bildirimi) görevlere bölün.",
      priority: "NORMAL",
      rationale: "Tensip zaptı, dosyanın açılışındaki işlem listesini belirler.",
    },
  ],
  TEBLIGAT: [
    {
      title: "Tebligatın gereğini incele ve süreyi kontrol et",
      description:
        "Tebliğ edilen evrakın türünü belirleyip başlattığı süreyi Süre Motoru ile doğrulayın.",
      priority: "YUKSEK",
      rationale: "Tebligat, süre başlangıcının en yaygın tetikleyicisidir.",
    },
  ],
  DURUSMA_TUTANAGI: [
    {
      title: "Duruşma tutanağını dosyaya işle",
      description:
        "Celsede verilen ara kararları safahata yazın; sonraki celseye kadar yapılacakları görevlere bölün.",
      priority: "NORMAL",
      rationale: "Tutanaktaki ara kararlar bir sonraki celseye kadar iş yükü doğurur.",
    },
  ],
  MUZEKKERE: [
    {
      title: "Müzekkere cevabını değerlendir",
      description: "Gelen cevabın dosyaya etkisini değerlendirip gerekiyorsa beyan hazırlayın.",
      priority: "NORMAL",
      rationale: "Müzekkere cevapları çoğunlukla beyan gerektirir.",
    },
  ],
  ICRA_EVRAKI: [
    {
      title: "İcra evrakını incele; itiraz/şikâyet süresini kontrol et",
      description:
        "Ödeme emri / haciz tutanağı türünü belirleyip İİK süresini Süre Motoru ile doğrulayın.",
      priority: "KRITIK",
      rationale: "İcra süreleri kısadır ve adli tatilde uzamaz.",
    },
  ],
  DILEKCE: [
    {
      title: "Karşı tarafın dilekçesini değerlendir",
      description:
        "Dilekçedeki iddia ve delilleri karşılayacak cevap/beyan taslağını planlayın. " +
        "Belge büronuza aitse bu görevi reddedebilirsiniz.",
      priority: "NORMAL",
      rationale: "Dosyaya giren dilekçeler cevap yükü doğurabilir.",
    },
  ],
};

/** Belge sınıfına karşılık gelen görev şablonları (yoksa boş dizi). */
export function templatesForClass(cls: DocumentClass): TaskTemplate[] {
  return TEMPLATES[cls] ?? [];
}

/** "İstenen belge" tespitinden üretilen görev şablonu. */
export function templateForRequestedDocument(quote: string): TaskTemplate {
  return {
    title: "İstenen belgeyi temin edip dosyaya sun",
    description: `Belgede sunulması istenen evrak: «${quote}»`,
    priority: "YUKSEK",
    rationale: "Belgede sunulması/getirtilmesi istenen bir evrak tespit edildi.",
  };
}
