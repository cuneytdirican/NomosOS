import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Uç noktayı JWT zorunluluğundan muaf tutar (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
