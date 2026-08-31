import { describe, expect, it } from "vitest";
import {
  dayTag,
  deadlineOverdueKey,
  deadlineReminderKey,
  hearingReminderKey,
} from "./dedupe-key";

/**
 * DEDUPE ANAHTARI SÖZLEŞMESİ.
 *
 * Bu testler bir uygulama ayrıntısını değil, VERİTABANI KISITININ ANLAMINI
 * korur: `@@unique([tenantId, dedupeKey])`. Anahtar üretimi değişirse
 * idempotentlik sessizce kaybolur — üretilen anahtar farklılaşır, unique
 * kısıtı tetiklenmez ve aynı olay için ikinci bildirim yazılır. Bu yüzden
 * "aynı girdiyle aynı anahtar" ve "farklı olayda farklı anahtar" kilitlenir.
 */
describe("dedupeKey üretimi", () => {
  const deadlineId = "1f0b9d7a-0000-4000-8000-000000000001";
  const hearingId = "1f0b9d7a-0000-4000-8000-000000000002";
  const alice = "user-alice";
  const bob = "user-bob";
  const due = new Date("2026-09-15T00:00:00.000Z");
  const postponedDue = new Date("2026-10-30T00:00:00.000Z");

  it("aynı süre + aynı vade + aynı pencere + aynı alıcı için DEĞİŞMEZ anahtar üretir", () => {
    expect(deadlineReminderKey(deadlineId, 3, alice, due)).toBe(
      deadlineReminderKey(deadlineId, 3, alice, due)
    );
  });

  it("beklenen biçimi üretir: <TÜR>:<kaynak>:<vade>:<pencere>:<alıcı>", () => {
    expect(deadlineReminderKey(deadlineId, 7, alice, due)).toBe(
      `SURE_YAKLASIYOR:${deadlineId}:2026-09-15:7g:${alice}`
    );
  });

  it("7/3/1 pencereleri AYRI anahtar üretir — üçü de ayrı bildirimdir", () => {
    const keys = new Set([
      deadlineReminderKey(deadlineId, 7, alice, due),
      deadlineReminderKey(deadlineId, 3, alice, due),
      deadlineReminderKey(deadlineId, 1, alice, due),
    ]);
    expect(keys.size).toBe(3);
  });

  it("alıcı anahtarın parçasıdır: iki kişiye giden aynı olay çakışmaz", () => {
    // Alıcı anahtarda olmasaydı ikinci alıcının kaydı P2002 alıp DÜŞERDİ;
    // yani sahipsiz bir süre yalnız TEK yöneticiye bildirilirdi.
    expect(deadlineReminderKey(deadlineId, 3, alice, due)).not.toBe(
      deadlineReminderKey(deadlineId, 3, bob, due)
    );
  });

  it("yaklaşan ve geçmiş süre anahtarları çakışmaz", () => {
    expect(deadlineReminderKey(deadlineId, 1, alice, due)).not.toBe(
      deadlineOverdueKey(deadlineId, alice, due)
    );
  });

  /**
   * DENETİM BULGUSU 4 — VADE DEĞİŞİRSE ANAHTAR DA DEĞİŞMELİDİR.
   *
   * Duruşma tarafında bu davranış zaten test edilmişti ("ertelenirse anahtar
   * değişir"), sürede karşılığı YOKTU. Vade düzeltilen bir sürede eski
   * anahtar yazılı olduğu için `enqueue` P2002 alıyor, YENİ tarih için 7/3/1
   * hatırlatmalarının hiçbiri gitmiyor ve bu panelde hata olarak da
   * görünmüyordu (`skipped` sayısı "sistem çalışıyor" diye okunur).
   */
  it("süre vadesi değişirse anahtar DEĞİŞİR — yeni tarih için yeniden uyarılır", () => {
    expect(deadlineReminderKey(deadlineId, 7, alice, due)).not.toBe(
      deadlineReminderKey(deadlineId, 7, alice, postponedDue)
    );
    expect(deadlineOverdueKey(deadlineId, alice, due)).not.toBe(
      deadlineOverdueKey(deadlineId, alice, postponedDue)
    );
  });

  it("SURE_GECTI anahtarı İŞİN ÇALIŞTIĞI GÜNÜ taşımaz — vade başına tek seferliktir", () => {
    // Aynı vade için farklı günlerde çalışan iş AYNI anahtarı üretmeli ki
    // kaçırılmış süre her sabah yeniden bildirilmesin (alarm yorgunluğu).
    const key = deadlineOverdueKey(deadlineId, alice, due);
    expect(key).toBe(`SURE_GECTI:${deadlineId}:2026-09-15:ilk:${alice}`);
    // Anahtardaki tek tarih VADEDİR; koşu günü girerse idempotentlik biter.
    expect(key.match(/\d{4}-\d{2}-\d{2}/g)).toHaveLength(1);
  });

  it("duruşma anahtarı DURUŞMANIN gününü taşır, işin çalıştığı günü değil", () => {
    const day = new Date("2026-09-15T00:00:00.000Z");
    expect(hearingReminderKey(hearingId, day, alice)).toBe(
      `DURUSMA_YARIN:${hearingId}:2026-09-15:${alice}`
    );
  });

  it("duruşma ertelenirse anahtar değişir — yeni tarih için yeniden uyarılır", () => {
    const first = hearingReminderKey(hearingId, new Date("2026-09-15T00:00:00.000Z"), alice);
    const postponed = hearingReminderKey(hearingId, new Date("2026-10-02T00:00:00.000Z"), alice);
    expect(first).not.toBe(postponed);
  });

  it("aynı gün içinde saat farkı anahtarı DEĞİŞTİRMEZ (gün çözünürlüğü)", () => {
    // İş 18:00'de ve yeniden 18:05'te tetiklense de anahtar aynı kalmalı.
    const a = hearingReminderKey(hearingId, new Date("2026-09-15T00:00:00.000Z"), alice);
    const b = hearingReminderKey(hearingId, new Date("2026-09-15T21:30:00.000Z"), alice);
    expect(a).toBe(b);
  });

  it("dayTag UTC gün üretir; yerel saate göre kaymaz", () => {
    expect(dayTag(new Date("2026-09-15T23:59:59.999Z"))).toBe("2026-09-15");
    expect(dayTag(new Date("2026-09-16T00:00:00.000Z"))).toBe("2026-09-16");
  });
});
