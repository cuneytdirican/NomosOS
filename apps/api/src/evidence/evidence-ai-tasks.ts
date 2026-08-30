/**
 * DELİL MODÜLÜNÜN AI GÖREV TİPLERİ.
 *
 * KÖPRÜ KALDIRILDI: `EVIDENCE_MATRIX` ve `EVIDENCE_GAP` artık
 * `packages/shared/src/ai-task-types.ts` kataloğunda tanımlıdır, dolayısıyla
 * `as unknown as AiTaskType` dönüşümüne gerek kalmamıştır.
 *
 * KATALOĞA GİRMENİN GÖRÜNÜR SONUCU: bu iki görev artık **Ayarlar → AI
 * Sağlayıcı** ekranındaki "görev tipi → model" tablosunda satır üretir. Önce
 * üretmiyordu; çağrılar `AiRunnerService.resolveRoute` yedek yoluna düşüyor ve
 * tenant bu iki ajanı ayrı bir modele yönlendiremiyordu.
 */

import type { AiTaskType } from "@nomosos/shared";

/** İddia/delil matrisi ÖNERİSİ üreten ajan. */
export const EVIDENCE_MATRIX_TASK: AiTaskType = "EVIDENCE_MATRIX";

/** Delil boşluğu (desteksiz/zayıf iddia) analizi üreten ajan. */
export const EVIDENCE_GAP_TASK: AiTaskType = "EVIDENCE_GAP";
