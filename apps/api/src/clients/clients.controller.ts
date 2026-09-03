import { Body, BadRequestException, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { createClientSchema, type CreateClientInput } from "@nomosos/shared";
import { ClientsService } from "./clients.service";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { importCsvSchema, duplicateCheckSchema, mergeClientSchema, type MergeClientInput, type DuplicateCheckInput } from "./clients.dto";
import type { AuthUser } from "../common/types";
import {
  createContactSchema,
  updateClientSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateClientInput,
  type UpdateContactInput,
} from "./clients.dto";

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("category") category?: string,
    @Query("isActive") isActive?: string
  ) {
    return this.clientsService.list(user.tenantId, { q, page, limit, category, isActive });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput) {
    return this.clientsService.create(user, body);
  }

  /**
   * A1 (rakip analizi) — CSV içe aktarma.
   * Gövde: { csv: "ad;e-posta;tckn..." } — metin, dosya DEĞİL.
   * Mükerrer kontrolü create() ile aynı hattan geçer.
   */
  /**
   * D6-B — MÜKERRER TESPİTİ (kaydı engellemez; avukata uyarı).
   * Tam TCKN/VKN eşleşmesi create'te 409 ile engeller — bu uç AD BENZERLİĞİ
   * ve e-posta/telefon eşleşmelerini ÖNCESİNDEN gösterir.
   */
  @Post("duplicate-check")
  duplicateCheck(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(duplicateCheckSchema)) body: DuplicateCheckInput
  ) {
    return this.clientsService.duplicateCheck(user, body);
  }

  @Post("import")
  importCsv(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(importCsvSchema)) body: { csv: string }) {
    return this.clientsService.importCsv(user, body.csv);
  }

  @Get(":id")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clientsService.detail(user.tenantId, id);
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput
  ) {
    return this.clientsService.update(user, id, body);
  }

  /**
   * KVKK: ham TCKN yalnızca bu uçtan, HUKUKİ rollere ve denetim kaydıyla verilir.
   * Liste/detay yanıtlarında sadece `tcknMasked` bulunur.
   */
  @Get(":id/tckn")
  revealTckn(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clientsService.revealTckn(user, id);
  }

  @Get(":id/contacts")
  listContacts(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clientsService.listContacts(user.tenantId, id);
  }

  /**
   * KVKK m.11 — müvekkil bazlı TAM dışa aktarma (F2 · A1).
   *
   * Veri özne talebine yanıt olarak avukat başlatır; rol kapısı ve denetim
   * kaydı serviste (bkz. `exportClientData`). Politika matrisi:
   * docs/kvkk-politika-matrisi.md.
   */
  @Get(":id/export")
  exportData(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.clientsService.exportClientData(user, id);
  }

  /**
   * D6 — BİRLEŞTİRME ÖNGÖRÜSÜ: taşınacak kayıt sayıları (Modül 01 kural 10:
   * onay diyaloğunda sayılar GÖSTERİLİR). Yalnız ADMIN/PARTNER.
   */
  @Get(":id/merge-preview")
  mergePreview(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Query("source") sourceId: string
  ) {
    if (!sourceId) throw new BadRequestException("source sorgu parametresi zorunludur.");
    return this.clientsService.mergePreview(user, id, sourceId);
  }

  /**
   * D6 — MÜKERRER KAYIT BİRLEŞTİRME (Modül 01 kural 10). GERİ ALINAMAZ:
   * kaynak kartın tüm kayıtları bu karta taşınır, kaynak kart PASİFLEŞİR
   * (silinmez). Yalnız ADMIN/PARTNER.
   */
  @Post(":id/merge")
  merge(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mergeClientSchema)) body: MergeClientInput
  ) {
    return this.clientsService.merge(user, id, body.sourceClientId);
  }

  @Post(":id/contacts")
  createContact(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput
  ) {
    return this.clientsService.createContact(user, id, body);
  }

  @Patch(":id/contacts/:contactId")
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("contactId") contactId: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactInput
  ) {
    return this.clientsService.updateContact(user, id, contactId, body);
  }

  @Delete(":id/contacts/:contactId")
  removeContact(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Param("contactId") contactId: string
  ) {
    return this.clientsService.removeContact(user, id, contactId);
  }
}
