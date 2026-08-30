/** Simülasyon modülü Zod GİRDİ şemaları — modül yereli (ortak karar 4). */

import { z } from "zod";
import { SIMULATION_MODE_KEYS } from "./simulation.modes";

const MODE_VALUES = SIMULATION_MODE_KEYS as [string, ...string[]];

export const runSimulationSchema = z.object({
  mode: z.enum(MODE_VALUES, {
    errorMap: () => ({
      message: `Geçersiz simülasyon modu. Geçerli değerler: ${SIMULATION_MODE_KEYS.join(", ")}.`,
    }),
  }),
  /** Avukatın modu daraltan özel sorusu. */
  question: z
    .string()
    .trim()
    .max(1000, "Soru en fazla 1000 karakter olabilir.")
    .optional(),
  /** KARSI_DILEKCE_ZAYIFLIK için ZORUNLU: incelenecek karşı taraf belgesi. */
  documentId: z.string().uuid("Belge geçerli bir kayıt kimliği olmalıdır.").optional(),
  /** KARSI_TARAF_AVUKATI için üretilecek argüman sayısı (varsayılan 7). */
  argumentCount: z
    .number()
    .int("Argüman sayısı tam sayı olmalıdır.")
    .min(3, "Argüman sayısı 3-12 arasında olmalıdır.")
    .max(12, "Argüman sayısı 3-12 arasında olmalıdır.")
    .optional(),
  /** KVKK 409 akışının ikinci turu. */
  piiApproved: z.boolean().optional(),
});
export type RunSimulationInput = z.infer<typeof runSimulationSchema>;
