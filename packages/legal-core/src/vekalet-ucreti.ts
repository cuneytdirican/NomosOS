/**
 * AAÜT VEKALET ÜCRETİ HESABI (rakip analizi — D7).
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║ VERİ SÖZLEŞMESİ: BU MOTOR TARİFE RAKAMI UYDURMAZ.                       ║
 * ║                                                                        ║
 * ║ AAÜT ("Serbest Meslek Mensuplarınca Tarifenin Uygulanmasına İlişkin    ║
 * ║ Asgari Ücret Tarifesi") her yıl Resmî Gazete ile yayımlanır. NomosOS  ║
 * ║ tarife RAKAMLARINI içermez; büro yıllık tarifeyi (VekaletTarife) RG'den ║
 * ║ okuyup girer. Motor, GİRİLEN tarifeden hesaplar. Yanlış girilen yıl   ║
 * ║ sorumluluğu da kullanıcıya aittir — hesabın her adımı gösterilir.      ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * HESAP KURALLARI (AAÜT m.1-2 yapısı):
 *  - MAKTU: kademelidir — dava değerinin her kademesi için o kademenin ücreti
 *    TOPLANIR (vergi dilimi gibi; kalan tutar son kademe limitine kadar düşülür).
 *  - TEKRAR DİLİMİ: eşik üzeri her tam birim için ek ücret (birimin tam
 *    katları için; kısmi birim YUVARLANMAZ — tarife metni "her ... lirası için"
 *    der, tam kat esas alınır).
 *  - NİSPİ: dava değerinin yüzde oranı; AAÜT m.2/4 uyarınca hesaplanan nispi
 *    ücret, aynı davaya maktu tarifeden düşecek ücretten AZ OLAMAZ → motor
 *    ikisini de hesaplar ve BÜYÜĞÜNÜ önerir (kullanıcı hangisinin uygulandığını görür).
 *  - KDV: serbest meslek faaliyeti KDV'ye tabidir; tarife satırındaki oran uygulanır.
 *  - PARA: tüm hesap KURUŞ cinsinden string/BigInt ile yapılır; JS float ASLA
 *    kullanılmaz (repo para disiplini).
 */

/** Para değerleri her yerde KURUŞ cinsinden string'tir ("150000" = 1.500,00 TL). */
export type Kurus = string;

/** AAÜT m.1 kademeli maktu dilimi. */
export interface MaktuKademe {
  /** Bu kademenin ÜST SINIRI (kuruş). Son kademede null → üst sınır yok. */
  limitKurus: Kurus | null;
  /** Bu kademeden düşen tutar için istenen ücret (kuruş). */
  ucretKurus: Kurus;
}

/** AAÜT m.1 son cümlesi: "eşik üzerindeki her birim için" tekrarlı dilim. */
export interface MaktuTekrar {
  esikKurus: Kurus;
  birimKurus: Kurus;
  ucretKurus: Kurus;
}

export interface VekaletTarifeVerisi {
  kademeler: readonly MaktuKademe[];
  tekrar?: MaktuTekrar | null;
  /** Nispi oran yüzde ("16.50" = %16,5). */
  nispiOranYuzde: string;
  /** KDV yüzde ("20" = %20). */
  kdvOrani: string;
}

export interface VekaletUcretSonucu {
  /** Maktu ücret (kuruş, KDV hariç). */
  maktuKurus: string;
  /** Nispi ücret (kuruş, KDV hariç) — asgari kuralı uygulanmadan ham hesap. */
  nispiKurus: string;
  /** AAÜT m.2/4: maktu ile nispi'den BÜYÜK olanı (KDV hariç). */
  onerilenBrutKurus: string;
  /** Uygulanan rejim — kullanıcıya gösterilir. */
  rejim: "MAKTU" | "NISPI";
  kdvKurus: string;
  /** Ödenecek toplam (brut + KDV, kuruş). */
  toplamKurus: string;
  /** Hesabın her adımı — ekranda gösterilir (süre motorundaki "iz" deseni). */
  iz: string[];
}

/* ------------------------------------------------------------------ *
 * Kuruş aritmetiği — BigInt tabanlı, float yok.
 * ------------------------------------------------------------------ */

function toKurus(value: Kurus): bigint {
  const n = BigInt(value);
  if (n < 0n) throw new Error(`Negatif kuruş değeri: ${value}`);
  return n;
}

export function kurusToBigInt(value: Kurus): bigint {
  return toKurus(value);
}

export function bigintToKurus(value: bigint): Kurus {
  return value.toString();
}

/** Yüzde uygula: kuruş * yüzdeler/100, aşağı yuvarla (mükellef lehine değil —
 * tarife hesabında aşağı yuvarlama standarttır; tam kuruş kalır). */
function yuzdeUygula(kurus: bigint, yuzde: string): bigint {
  // Oran "16.50" gibi iki ondalıklı; BigInt'e çevirmek için 100 ile ölçekle.
  const [tam, ondalik = ""] = yuzde.split(".");
  const olcekli = BigInt(tam + ondalik.padEnd(2, "0"));
  return (kurus * olcekli) / 10000n;
}

/* ------------------------------------------------------------------ *
 * Motor
 * ------------------------------------------------------------------ */

/** Maktu hesap: kademeler toplanır + tekrar dilimi eklenir. */
export function hesaplaMaktu(davaDegeriKurus: Kurus, tarife: VekaletTarifeVerisi): { toplam: bigint; iz: string[] } {
  const deger = toKurus(davaDegeriKurus);
  const iz: string[] = [];

  // Sıra doğrulaması HESAPTAN ÖNCE yapılır: ilk kademeler tükendiğinde hatalı
  // son kademeye hiç uğranmadan hesap bitebilirdi — bozuk tarife sessiz
  // doğruya benzer sonuç üretirdi.
  let kontrolLimit = 0n;
  for (let i = 0; i < tarife.kademeler.length; i++) {
    const kademe = tarife.kademeler[i];
    const limit = kademe.limitKurus === null ? null : toKurus(kademe.limitKurus);
    if (limit !== null) {
      if (limit <= kontrolLimit) {
        throw new Error(`Kademe limitleri artan sırada olmalı (kademe ${i + 1}).`);
      }
      kontrolLimit = limit;
    }
  }

  let kalan = deger;
  let oncekiLimit = 0n;
  let toplam = 0n;

  for (let i = 0; i < tarife.kademeler.length; i++) {
    const kademe = tarife.kademeler[i];
    const limit = kademe.limitKurus === null ? null : toKurus(kademe.limitKurus);
    // Bu kademeye düşen kısım: min(kalan, limit - oncekiLimit)
    const kademePayi = limit === null ? kalan : (kalan < limit - oncekiLimit ? kalan : limit - oncekiLimit);
    if (kademePayi > 0n) {
      toplam += toKurus(kademe.ucretKurus);
      iz.push(
        `Kademe ${i + 1}: ${oncekiLimit / 100n} TL üzeri ${kademePayi / 100n} TL için ${toKurus(kademe.ucretKurus) / 100n} TL.`,
      );
      kalan -= kademePayi;
    }
    if (limit !== null) oncekiLimit = limit;
    if (kalan <= 0n) break;
  }

  if (kalan > 0n && tarife.tekrar) {
    const t = tarife.tekrar;
    const esik = toKurus(t.esikKurus);
    const birim = toKurus(t.birimKurus);
    const tekrarPayi = deger > esik ? deger - esik : 0n;
    const birimSayisi = tekrarPayi / birim; // tam kat — kısmi birim sayılmaz
    if (birimSayisi > 0n) {
      const tekrarUcreti = birimSayisi * toKurus(t.ucretKurus);
      toplam += tekrarUcreti;
      iz.push(
        `Tekrar dilimi: eşik (${esik / 100n} TL) üzeri ${birimSayisi} birim × ${toKurus(t.ucretKurus) / 100n} TL = ${tekrarUcreti / 100n} TL.`,
      );
    }
  }

  // AAÜT m.3: tarife ücreti PEŞİN alınır — dava değeri 0 ya da hesaplanan
  // maktu 0 olsa bile İLK KADEME ücreti asgari olarak uygulanır
  // (sözleşmeyle daha az ücret kararlaştırılamaz).
  if (toplam === 0n && tarife.kademeler.length > 0) {
    toplam = toKurus(tarife.kademeler[0].ucretKurus);
    iz.push(
      `Dava değeri kademelerin altında: AAÜT m.3 uyarınca ilk kademe ücreti (${toplam / 100n} TL) asgari olarak uygulandı.`,
    );
  }

  return { toplam, iz };
}

/** Nispi hesap (AAÜT m.2): dava değerinin yüzde oranı. */
export function hesaplaNispi(davaDegeriKurus: Kurus, tarife: VekaletTarifeVerisi): bigint {
  return yuzdeUygula(toKurus(davaDegeriKurus), tarife.nispiOranYuzde);
}

/** Tam hesap: maktu vs nispi (büyüğü önerilir), KDV dahil toplam. */
export function hesaplaVekaletUcreti(davaDegeriKurus: Kurus, tarife: VekaletTarifeVerisi): VekaletUcretSonucu {
  const maktu = hesaplaMaktu(davaDegeriKurus, tarife);
  const nispi = hesaplaNispi(davaDegeriKurus, tarife);
  const maktuB = maktu.toplam;
  const nispiB = nispi;

  // AAÜT m.2/4: nispi ücret, aynı dava için maktu tarifeden düşecek ücretten az olamaz.
  const rejim: "MAKTU" | "NISPI" = nispiB > maktuB ? "NISPI" : "MAKTU";
  const brut = rejim === "NISPI" ? nispiB : maktuB;
  const kdv = yuzdeUygula(brut, tarife.kdvOrani);

  const iz = [...maktu.iz];
  iz.push(
    `Nispi hesap: ${toKurus(davaDegeriKurus) / 100n} TL × %${tarife.nispiOranYuzde} = ${nispiB / 100n} TL.`,
  );
  iz.push(
    rejim === "NISPI"
      ? "AAÜT m.2/4: nispi ücret maktu ücretten yüksek; NİSPİ uygulandı."
      : "AAÜT m.2/4: nispi ücret maktu ücretten düşük olamaz; MAKTU uygulandı.",
  );
  iz.push(`KDV (%${tarife.kdvOrani}): ${kdv / 100n} TL.`);

  return {
    maktuKurus: maktuB.toString(),
    nispiKurus: nispiB.toString(),
    onerilenBrutKurus: brut.toString(),
    rejim,
    kdvKurus: kdv.toString(),
    toplamKurus: (brut + kdv).toString(),
    iz,
  };
}
