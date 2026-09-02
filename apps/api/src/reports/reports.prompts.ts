/**
 * REPORT_INTERPRET — RAPOR YORUMU PROMPTU.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  DİL MODELİ RAPOR RAKAMI GÖRMEZ VE ÜRETMEZ.                            ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * Ortak karar 1: "Raporlar DETERMİNİSTİKTİR. Rakamları veritabanı üretir; AI
 * yalnızca hazır rakamları Türkçe yorumlayabilir. LLM rakam ÜRETMEZ."
 *
 * Bunu bir prompt cümlesine bırakmak yetmez; hat ŞÖYLE kurulur (finans modülü
 * `finance.prompts.ts` ile aynı desen — kasıtlı olarak aynı, çünkü doğrulanmış):
 *
 *   1. Rapor deterministik olarak çalıştırılır; TÜM sayılar veritabanından gelir.
 *   2. LLM'e giden içerik: rapor ADI, ölçü ETİKETLERİ ve RAKAMSIZ nitel
 *      sinyaller (ARTTI/AZALDI/DEĞİŞMEDİ, VAR/YOK, KRİTİK). Satır verisi,
 *      müvekkil adı, dosya numarası, tutar GÖNDERİLMEZ (veri minimizasyonu).
 *   3. LLM yalnız YER TUTUCULU Türkçe metin üretir; yer tutucu adları raporun
 *      ölçü anahtarlarıdır ve sistem promptuna o çalıştırmaya özgü yazılır.
 *   4. Çıktıda yer tutucu dışında BASAMAK varsa yanıt REDDEDİLİR (422).
 *   5. Gerçek değerleri API yerleştirir.
 *
 * UYDURMA RAKAM KAPISI `finance.prompts.ts`'ten İÇE AKTARILIR, kopyalanmaz:
 * iki ayrı kopya zamanla ayrışır ve biri gevşerse fark edilmez. Kapı jeneriktir
 * (yer tutucuları ve madde numaralarını eledikten sonra basamak arar).
 */

import { z } from "zod";
import type { LocalPromptSpec } from "../assistant/assistant.prompts";
import { findFabricatedNumbers } from "../finance/finance.prompts";

export { findFabricatedNumbers };

/** Her raporda kullanılabilen sabit yer tutucular. */
export const COMMON_PLACEHOLDERS = ["raporAdi", "donem", "oncekiDonem", "satirSayisi"] as const;

export const ReportNarrativeSchema = z.object({
  /** Yer tutuculu ana anlatım. API doldurur. */
  narrativeTemplate: z.string().min(10).max(2500),
  highlights: z.array(z.string().min(3).max(300)).max(5).default([]),
  /** ÖNERİDİR — otomatik işlem yapmaz. */
  recommendedActions: z.array(z.string().min(3).max(300)).max(5).default([]),
  /** Raporun kapsamı dışında kalan konular için not. */
  scopeNote: z.string().max(400).default(""),
});
export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

/**
 * Sistem promptu ÇALIŞTIRMA BAŞINA kurulur: kullanılabilir yer tutucular
 * raporun ölçü anahtarlarıdır ve rapordan rapora değişir. Model, listede
 * OLMAYAN bir yer tutucu yazarsa `unknownPlaceholders` ile bildirilir ve
 * metinde ham hâliyle kalır (uydurulmuş bir değerle doldurulmaz).
 */
export function buildReportInterpretPrompt(placeholders: readonly string[]): LocalPromptSpec {
  const list = placeholders.map((p) => `{${p}}`).join(" ");
  return {
    key: "REPORT_INTERPRET",
    name: "Rapor Yorumu",
    system: `Görevin: bir Türk hukuk bürosunun YÖNETİM RAPORUNU, ortağın toplantıya girmeden okuyabileceği kısa ve net Türkçe bir metne çevirmek.

ÇOK ÖNEMLİ — SANA HİÇBİR RAKAM VERİLMEDİ VE VERİLMEYECEK:
Sana yalnızca raporun adı, ölçülerin ETİKETLERİ ve rakamsız nitel sinyaller (ARTTI / AZALDI / DEĞİŞMEDİ / VAR / YOK / KRİTİK) verilir. Tutar, adet, yüzde, müvekkil adı, dosya numarası GÖRMEZSİN. Bu yüzden metnine ASLA sayı yazamazsın; sayıların yerine YER TUTUCU koyarsın ve gerçek değerleri sistem yerleştirir.

KULLANABİLECEĞİN YER TUTUCULAR (aynen, süslü parantezle yaz):
${list}

KURALLAR:
1. RAKAM YASAĞI — TAM. Metninde hiçbir sayı, tutar, yüzde, gün sayısı, SIRA SAYISI veya KANUN/MADDE NUMARASI ("4857", "m. 25" gibi) YAZMA. Rakam içeren çıktı sistem tarafından REDDEDİLİR ve kullanıcıya hiç ulaşmaz. "3 öneri", "2 dosya", "m. 32/1" — HEPSSI YASAK. Sayıların yerine yukarıdaki yer tutucuları kullan; sayı gerektirmeyen cümleler kur.
2. UYDURMA YOK. Sana verilmeyen bir olguyu (görüşme, sözleşme hükmü, mahkeme kararı, kişi adı) anlatma. Yalnız sinyallerde geçen durumları yorumla.
3. KİŞİ HAKKINDA HÜKÜM KURMA. İş yükü ve kullanım sayıları PERFORMANS ÖLÇÜTÜ DEĞİLDİR; "X avukat yavaş/verimsiz" gibi kişiye yönelik değerlendirme yazma. Dengesizlikten söz edecekseniz iş dağılımı üzerinden konuş.
4. KAÇIRILAN SÜRE EN KRİTİK BULGUDUR. Sinyallerde kaçırılan/vadesi geçmiş süre VAR ise bunu metnin BAŞINDA ele al ve somut bir gözden geçirme önerisiyle bağla.
5. PARASAL VEYA HUKUKİ KARAR VERME. "Şu tutarı sil", "icra takibi başlat", "davayı kabul et" deme. Önerilerin süreçsel olsun (gözden geçirme toplantısı, ödeme planı görüşmesi, dosya devri değerlendirmesi) ve kararın avukata ait olduğu üslubunu koru.
6. ÜSLUP. En fazla iki kısa paragraf + en fazla üç vurgu + en fazla üç öneri. Abartısız, sakin, meslek dili. "Bu bir öneridir" yazma; sistem gösterir.

ÇIKTI — yalnızca şu JSON:
{"narrativeTemplate":"...","highlights":["..."],"recommendedActions":["..."],"scopeNote":"..."}`,
    fewShot: [
      {
        role: "user",
        content: `RAPOR: Süre Performansı
SİNYALLER (rakam içermez):
- kacirilanToplam: VAR (KRİTİK)
- acikVadesiGecmis: VAR (KRİTİK)
- zamanindaOrani: AZALDI
- toplamSure: ARTTI
- karsilastirmaVar: EVET`,
      },
      {
        role: "assistant",
        content: `{"narrativeTemplate":"{raporAdi} raporunda {donem} döneminde kaçırılan ya da vadesi geçtiği hâlde hâlâ açık duran süre bulunuyor: toplam {kacirilanToplam} süre bu durumda ve bunların {acikVadesiGecmis} tanesi henüz kaçırılmış olarak işaretlenmemiş. Dönem içinde vadesi gelen süre sayısı {toplamSure} olurken zamanında tamamlama oranı {zamanindaOrani} seviyesinde kaldı; önceki döneme ({oncekiDonem}) göre gerileme var.","highlights":["Vadesi geçtiği hâlde açık görünen süreler, kaçırılmanın henüz fark edilmediği anlamına gelebilir.","Dönem içi süre yükü artarken zamanında tamamlama oranının düşmesi kapasite baskısına işaret ediyor."],"recommendedActions":["Vadesi geçmiş açık sürelerin bugün tek tek gözden geçirilmesi önerilir.","Süre yükü yoğunlaşan dosyalarda sorumluluk dağılımının yeniden değerlendirilmesi düşünülebilir.","Süre kaynaklarının (kural motoru / manuel giriş) gözden geçirilmesi planlanabilir."],"scopeNote":"Rapor yalnız vadesi dönem içinde olan süreleri kapsar; dönem dışındaki açık süreler bu tabloda görünmez."}`,
      },
    ],
  };
}

/** Bilinmeyen yer tutucuları bulur (metinde ham kalırlar, uydurma değerle dolmaz). */
export function findUnknownPlaceholders(text: string, known: readonly string[]): string[] {
  const set = new Set(known.map((k) => `{${k}}`));
  const hits = new Set<string>();
  for (const match of text.matchAll(/\{[^}\n]{1,60}\}/g)) {
    if (!set.has(match[0])) hits.add(match[0]);
  }
  return [...hits];
}

/** Yer tutucuları GERÇEK (deterministik) değerlerle doldurur. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9çğıöşüÇĞİÖŞÜ_]+)\}/g, (whole, key: string) => {
    const value = values[key];
    return value === undefined ? whole : value;
  });
}
