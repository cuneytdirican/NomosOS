import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@nomosos/db";
import type { CreateClientInput } from "@nomosos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/types";
import { assertRole, ROLE_SETS } from "../common/roles";
import { normalizeQuery, paged, resolvePage } from "../common/pagination";
import type { CreateContactInput, UpdateClientInput, UpdateContactInput } from "./clients.dto";

/**
 * Müvekkil yanıtlarında okunan alanlar.
 *
 * `tckn` buradan OKUNUR ama YANITA KONMAZ: `maskClient` ham değeri çıkarır ve
 * yerine `tcknMasked` koyar. Ham değer yalnızca `GET /clients/:id/tckn`
 * ucundan, rol kontrolü ve denetim kaydıyla verilir (bkz. `revealTckn`).
 */
const CLIENT_PUBLIC_SELECT = {
  id: true,
  tenantId: true,
  type: true,
  name: true,
  tckn: true,
  taxNumber: true,
  taxOffice: true,
  email: true,
  phone: true,
  address: true,
  iban: true,
  notes: true,
  category: true,
  referenceCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientSelect;

/** KVKK: sunucu tarafında maskelenmiş TCKN — 12345678901 → 123******01 */
export function maskTckn(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length < 6) return "•".repeat(v.length);
  return `${v.slice(0, 3)}${"*".repeat(Math.max(0, v.length - 5))}${v.slice(-2)}`;
}

/**
 * Ham TCKN'yi yanıttan ÇIKARIR ve yerine maskelenmiş değeri koyar.
 *
 * Maskeleme sunucuda yapılır: istemcide maskelemek yalnızca kozmetiktir,
 * `curl` ile ham değer zaten alınabiliyordu (denetim bulgusu 6).
 */
function maskClient<T extends { tckn?: string | null }>(
  client: T
): Omit<T, "tckn"> & { tcknMasked: string | null } {
  const { tckn, ...rest } = client;
  return { ...rest, tcknMasked: maskTckn(tckn) };
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async list(
    tenantId: string,
    params: { q?: string; page?: string; limit?: string; category?: string; isActive?: string }
  ) {
    // Entegrasyon notu (C ajani): bu uc kendi tavanini (100) elle hesapliyordu;
    // diger tum liste uclari `resolvePage` kullaniyor. Istemci `MAX_PAGE_SIZE`
    // (200) varsayarken sunucu sessizce 100'e kirpiyordu.
    const pageParams = resolvePage(params, 20);

    const where: Prisma.ClientWhereInput = { tenantId };
    const q = normalizeQuery(params.q);
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { referenceCode: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ];
    }
    if (params.category) {
      where.category = params.category;
    }
    if (params.isActive === "true" || params.isActive === "false") {
      where.isActive = params.isActive === "true";
    }

    const [items, total] = await Promise.all([
      this.prisma.client.client.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pageParams.skip,
        take: pageParams.take,
        select: { ...CLIENT_PUBLIC_SELECT, _count: { select: { cases: true, contacts: true } } },
      }),
      this.prisma.client.client.count({ where }),
    ]);

    return paged(items.map(maskClient), total, pageParams);
  }

  async create(user: AuthUser, input: CreateClientInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkil kaydı oluşturma");
    const client = await this.prisma.client.client.create({
      data: { tenantId: user.tenantId, ...input },
      select: CLIENT_PUBLIC_SELECT,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CREATE",
      entity: "Client",
      entityId: client.id,
      detail: client.name,
    });
    return maskClient(client);
  }

  async detail(tenantId: string, id: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId },
      select: {
        ...CLIENT_PUBLIC_SELECT,
        contacts: { orderBy: { fullName: "asc" } },
        cases: {
          orderBy: { openedAt: "desc" },
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            courtName: true,
            fileNumber: true,
            openedAt: true,
            nextHearingAt: true,
            lastActivityAt: true,
            _count: { select: { hearings: true, deadlines: true, tasks: true, documents: true } },
          },
        },
        financialEntries: { orderBy: { date: "desc" }, take: 10 },
      },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }
    return maskClient(client);
  }

  /**
   * GET /clients/:id/tckn — HAM TCKN.
   *
   * KVKK: TCKN özel nitelikli olmayan ancak kimliği doğrudan belirleyen bir
   * kişisel veridir. Ham değer yalnızca bu uçtan, HUKUKİ rollere, ve HER
   * ÇAĞRIDA DENETİM KAYDI düşülerek verilir.
   *
   * Önceden `tckn` her liste/detay yanıtında açık dönüyor, maskeleme yalnızca
   * tarayıcıda yapılıyordu; "Göster" düğmesi hiçbir rol kontrolüne bağlı
   * değildi ve API'ye gitmediği için denetim izi bırakmıyordu — maskeleme
   * fiilen kozmetikti (denetim bulgusu 6).
   */
  async revealTckn(user: AuthUser, id: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "müvekkil TCKN bilgisini görüntüleme");
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, name: true, tckn: true },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_TCKN_REVEAL",
      entity: "Client",
      entityId: client.id,
      detail: `${client.name} — TCKN görüntülendi`,
    });
    return { id: client.id, tckn: client.tckn };
  }

  /** PATCH /clients/:id */
  async update(user: AuthUser, id: string, input: UpdateClientInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "müvekkil bilgisi güncelleme");
    const existing = await this.requireClient(user.tenantId, id);

    // MÜVEKKİL PASİFLEŞTİRİLİRSE PORTAL ERİŞİMİ DE KESİLİR (denetim bulgusu K-12).
    //
    // `Client.isActive=false` "bu müvekkille çalışmıyoruz" demektir; portal
    // hesabı `PortalPublication` allow-list'indeki dosya, belge ve faturayı
    // görmeye devam ederse bayrak anlamsız kalır. Aynı kanca `poa.revoke()`
    // içinde de vardır — iki yol da erişim kesmelidir.
    const deactivating = input.isActive === false && existing.isActive;

    const { updated, suspendedPortalUsers } = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.client.update({
        where: { id: existing.id },
        data: input as Prisma.ClientUncheckedUpdateInput,
        select: CLIENT_PUBLIC_SELECT,
      });
      if (!deactivating) return { updated: row, suspendedPortalUsers: 0 };
      const portal = await tx.portalUser.updateMany({
        where: { tenantId: user.tenantId, clientId: existing.id, isActive: true },
        data: { isActive: false, sessionsValidFrom: new Date() },
      });
      return { updated: row, suspendedPortalUsers: portal.count };
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_UPDATE",
      entity: "Client",
      entityId: id,
      detail:
        `${updated.name} — güncellenen alanlar: ${Object.keys(input).join(", ")}` +
        (suspendedPortalUsers > 0 ? ` · portal_askiya_alinan=${suspendedPortalUsers}` : ""),
    });
    return { ...maskClient(updated), suspendedPortalUsers };
  }

  async listContacts(tenantId: string, clientId: string) {
    await this.requireClient(tenantId, clientId);
    return this.prisma.client.clientContact.findMany({
      where: { clientId },
      orderBy: { fullName: "asc" },
    });
  }

  /** POST /clients/:id/contacts */
  async createContact(user: AuthUser, clientId: string, input: CreateContactInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "ilgili kişi ekleme");
    await this.requireClient(user.tenantId, clientId);

    const contact = await this.prisma.client.clientContact.create({
      data: { clientId, ...input } as Prisma.ClientContactUncheckedCreateInput,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_CREATE",
      entity: "ClientContact",
      entityId: contact.id,
      detail: contact.fullName,
    });
    return contact;
  }

  /** PATCH /clients/:id/contacts/:contactId */
  async updateContact(user: AuthUser, clientId: string, contactId: string, input: UpdateContactInput) {
    assertRole(user, ROLE_SETS.OPERASYON, "ilgili kişi güncelleme");
    await this.requireContact(user.tenantId, clientId, contactId);

    const contact = await this.prisma.client.clientContact.update({
      where: { id: contactId },
      data: input as Prisma.ClientContactUncheckedUpdateInput,
    });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_UPDATE",
      entity: "ClientContact",
      entityId: contactId,
      detail: contact.fullName,
    });
    return contact;
  }

  /** DELETE /clients/:id/contacts/:contactId */
  async removeContact(user: AuthUser, clientId: string, contactId: string) {
    assertRole(user, ROLE_SETS.HUKUKI, "ilgili kişi silme");
    const contact = await this.requireContact(user.tenantId, clientId, contactId);

    await this.prisma.client.clientContact.delete({ where: { id: contactId } });
    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.userId,
      action: "CLIENT_CONTACT_DELETE",
      entity: "ClientContact",
      entityId: contactId,
      detail: contact.fullName,
    });
    return { ok: true, id: contactId };
  }

  private async requireClient(tenantId: string, id: string) {
    const client = await this.prisma.client.client.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!client) {
      throw new NotFoundException("Müvekkil bulunamadı.");
    }
    return client;
  }

  private async requireContact(tenantId: string, clientId: string, contactId: string) {
    await this.requireClient(tenantId, clientId);
    const contact = await this.prisma.client.clientContact.findFirst({
      where: { id: contactId, clientId },
      select: { id: true, fullName: true },
    });
    if (!contact) {
      throw new NotFoundException("İlgili kişi kaydı bulunamadı.");
    }
    return contact;
  }
}
