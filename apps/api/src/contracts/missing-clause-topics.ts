/**
 * "EKSİK HÜKÜM" BULGULARI İÇİN DETERMİNİSTİK KAPI.
 *
 * SORUN: bir hükmün YOKLUĞU alıntıyla kanıtlanamaz; bu yüzden eksik hüküm
 * bulguları `quote-guard`dan geçemez. Ama denetimsiz de bırakılamaz — model
 * "gizlilik hükmü yok" diyebilir, oysa sözleşmenin 9. maddesi baştan sona
 * gizliliği düzenliyordur.
 *
 * ÇÖZÜM: konu bazlı anahtar kelime taraması. Model bir konuyu "eksik" ilan
 * ediyorsa ve o konunun anahtar kelimeleri metinde GEÇİYORSA bulgu ELENİR.
 *
 * SINIRLARI AÇIKÇA BELİRTİLİR:
 *  • Bu bir HUKUKİ YETERLİLİK denetimi DEĞİLDİR. "Gizlilik" kelimesinin geçmesi,
 *    gizlilik hükmünün yeterli olduğunu göstermez — yalnızca "hiç yok" iddiasını
 *    çürütür. Eleme gerekçesi kullanıcıya gösterilir, avukat kararı verir.
 *  • Konu katalogda yoksa eleme YAPILMAZ (fail-open): tanımadığımız bir konuyu
 *    "var" sayıp bulguyu silmek, gerçek bir eksiği gizlemek olurdu.
 */

import { normalizeForQuoteMatch } from "./quote-guard";

export interface MissingClauseTopic {
  key: string;
  /** Modelin yazabileceği konu adları — eşleştirme bunlarla yapılır. */
  aliases: readonly string[];
  /** Metinde aranacak ifadeler; biri geçiyorsa konu "metinde var" sayılır. */
  keywords: readonly string[];
}

export const MISSING_CLAUSE_TOPICS: readonly MissingClauseTopic[] = [
  {
    key: "UYUSMAZLIK_COZUMU",
    aliases: ["uyuşmazlık", "uyusmazlik", "yetkili mahkeme", "yetki şartı", "tahkim", "ihtilaf"],
    keywords: ["yetkili mahkeme", "mahkemeleri ve icra", "uyuşmazlık", "tahkim", "hakem"],
  },
  {
    key: "GIZLILIK",
    aliases: ["gizlilik", "sır saklama", "confidentiality"],
    keywords: ["gizlilik", "gizli bilgi", "ifşa etmeme", "sır saklama"],
  },
  {
    key: "MUCBIR_SEBEP",
    aliases: ["mücbir sebep", "mucbir sebep", "force majeure", "olağanüstü hâl"],
    keywords: ["mücbir sebep", "force majeure", "beklenmeyen hâl"],
  },
  {
    key: "KVKK",
    aliases: ["kvkk", "kişisel veri", "kisisel veri", "veri koruma", "aydınlatma"],
    keywords: ["kişisel veri", "6698", "kvkk", "veri sorumlusu", "aydınlatma metni"],
  },
  {
    key: "FESIH",
    aliases: ["fesih", "fesih usulü", "sona erme", "sözleşmenin sona ermesi"],
    keywords: ["fesih", "sona erdir", "sona erme", "feshedebilir"],
  },
  {
    key: "TEBLIGAT",
    aliases: ["tebligat", "bildirim", "bildirim adresi", "adres"],
    keywords: ["tebligat", "bildirim adresi", "yazılı bildirim", "noter"],
  },
  {
    key: "DEVIR_TEMLIK",
    aliases: ["devir", "temlik", "devir ve temlik", "alt yüklenici"],
    keywords: ["devir", "temlik", "devredemez", "alt yüklenici"],
  },
  {
    key: "SORUMLULUK_SINIRI",
    aliases: ["sorumluluk", "sorumluluk sınırı", "tazminat", "sorumsuzluk"],
    keywords: ["sorumluluk", "tazminat", "zarar"],
  },
  {
    key: "CEZAI_SART",
    aliases: ["cezai şart", "ceza koşulu", "cezai sart"],
    keywords: ["cezai şart", "ceza koşulu"],
  },
  {
    key: "ODEME",
    aliases: ["ödeme", "bedel", "ücret", "fatura", "ödeme koşulları"],
    keywords: ["ödeme", "bedel", "fatura", "ücret"],
  },
  {
    key: "SURE_YENILEME",
    aliases: ["süre", "yürürlük", "yenileme", "süre ve yenileme"],
    keywords: ["yürürlük", "süre", "yenilen"],
  },
  {
    key: "FIKRI_MULKIYET",
    aliases: ["fikri mülkiyet", "telif", "eser sahipliği", "fikri haklar"],
    keywords: ["fikri", "telif", "eser sahibi", "mali haklar"],
  },
  {
    key: "REKABET_YASAGI",
    aliases: ["rekabet yasağı", "rekabet etmeme"],
    keywords: ["rekabet"],
  },
];

export interface MissingClauseCheck {
  /** Konunun anahtar kelimeleri metinde geçiyor mu. */
  presentInText: boolean;
  /** Eşleşen katalog konusu (yoksa `null` → eleme yapılmaz). */
  topicKey: string | null;
  /** Metinde bulunan ifade — kullanıcıya gerekçe olarak gösterilir. */
  matchedKeyword: string | null;
}

/**
 * Modelin bildirdiği "eksik" konusunun metinde gerçekten bulunmadığını denetler.
 *
 * @param topic      Modelin yazdığı serbest konu adı.
 * @param sourceText Sözleşme metni.
 */
export function checkMissingClaim(topic: string, sourceText: string): MissingClauseCheck {
  const needle = normalizeForQuoteMatch(topic);
  if (!needle) return { presentInText: false, topicKey: null, matchedKeyword: null };

  const entry = MISSING_CLAUSE_TOPICS.find((t) =>
    t.aliases.some((a) => {
      const alias = normalizeForQuoteMatch(a);
      return alias.length > 0 && (needle.includes(alias) || alias.includes(needle));
    }),
  );
  if (!entry) return { presentInText: false, topicKey: null, matchedKeyword: null };

  const haystack = normalizeForQuoteMatch(sourceText);
  for (const keyword of entry.keywords) {
    const k = normalizeForQuoteMatch(keyword);
    if (k.length > 0 && haystack.includes(k)) {
      return { presentInText: true, topicKey: entry.key, matchedKeyword: keyword };
    }
  }
  return { presentInText: false, topicKey: entry.key, matchedKeyword: null };
}
