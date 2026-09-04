/**
 * /ai/chat PROMPT SÖZLEŞMESİ — G6 sınıfı bulgunun regresyon testi.
 *
 * `/ai/chat` ucu (genel Asistan sayfası) eskiden 3 cümlelik YEREL bir sistem
 * promptu kullanıyordu: legal-ai'deki 11 kurallı çekirdek sözleşme
 * (tarafsızlık, uydurma yasağı, atıf disiplini, veri/talimat ayrımı) bu uca
 * hiç ulaşmıyordu; prompts.test.ts + assistant.prompts.test.ts sözleşmeleri de
 * bu dördüncü promptu kapsamıyordu. Bu test promptun `composeSystemPrompt`
 * (çekirdek + görev) üzerinden kurulmasını kilitler.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = readFileSync(join(process.cwd(), "src", "ai", "ai.service.ts"), "utf-8");

describe("/ai/chat sistem promptu çekirdek sözleşmeye bağlı", () => {
  it("SYSTEM_PROMPT composeSystemPrompt ile kurulur (yerel özet DEĞİL)", () => {
    expect(SERVICE).toContain("const SYSTEM_PROMPT = composeSystemPrompt(");
  });

  it("legal-ai çekirdek promptu içe aktarılır", () => {
    expect(SERVICE).toMatch(/from "@nomosos\/legal-ai"/);
    expect(SERVICE).toContain("composeSystemPrompt");
  });

  it("SYSTEM_PROMPT iletilmesi: mesaj zinciri SYSTEM_PROMPT ile başlar", () => {
    // chat() içinde sistem mesajı bu sabitten gelir — dinamik kurulmuş olsa
    // bile isim korunmalı ki çekirdek sözleşme fiilen uca ulaşmaya devam etsin.
    const chat = SERVICE.slice(SERVICE.indexOf("async chat("));
    expect(chat.slice(0, 20000)).toContain("SYSTEM_PROMPT");
  });
});
