import { BadRequestException } from "@nestjs/common";

/** Sayfa başına varsayılan kayıt sayısı. */
export const DEFAULT_PAGE_SIZE = 50;

/** Sayfa başına üst sınır — tek istekle tüm tabloyu çekmeyi engeller. */
export const MAX_PAGE_SIZE = 200;

/** Serbest metin süzgeçleri için üst sınır (karakter). */
export const MAX_QUERY_LENGTH = 100;

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

/**
 * `page` / `limit` sorgu parametrelerini güvenli sınırlara oturtur.
 *
 * Sayfalamasız `findMany` çağrıları, birkaç bin dosyalı bir büroda tek istekte
 * tüm tabloyu (üstelik iç içe ilişkilerle) döndürüyordu (denetim bulgusu 9).
 */
export function resolvePage(
  params: { page?: string; limit?: string },
  defaultLimit: number = DEFAULT_PAGE_SIZE
): PageParams {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.limit) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/** Standart sayfalama zarfı — tüm liste uçları aynı biçimi döndürür. */
export function paged<T>(items: T[], total: number, page: PageParams) {
  return {
    items,
    total,
    page: page.page,
    limit: page.limit,
    totalPages: Math.max(1, Math.ceil(total / page.limit)),
  };
}

/**
 * Serbest metin süzgecini kırpar.
 *
 * `contains` süzgeçleri indekssiz `ILIKE '%…%'` taramasına dönüştüğü için
 * 100 KB'lık bir `q` kolay bir kaynak tüketim yüzeyi oluşturuyordu
 * (denetim bulgusu 21).
 */
export function normalizeQuery(q: string | undefined): string | undefined {
  if (q === undefined) return undefined;
  const trimmed = q.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new BadRequestException(
      `Arama metni en fazla ${MAX_QUERY_LENGTH} karakter olabilir.`
    );
  }
  return trimmed;
}
