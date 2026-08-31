"use client";

/**
 * Müvekkil kartı → PORTAL sekmesi (Modül 10).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PORTAL EN DAR YETKİLİ YÜZEYDİR (ortak karar 2).                          ║
 * ║ Görünürlük bir AÇIK YAYIN LİSTESİDİR (allow-list): varsayılan olarak      ║
 * ║ HİÇBİR ŞEY görünmez; yalnız burada anahtarı açtığınız kayıt müvekkile     ║
 * ║ çıkar. Bu yüzden ekran "neyi gizleyeceğinizi" değil, "neyi açtığınızı"    ║
 * ║ gösterir — kapalı bir anahtar, kaydın portalda olmadığının kanıtıdır.     ║
 * ║                                                                          ║
 * ║ "TÜMÜNÜ YAYINLA" DÜĞMESİ BİLEREK YOKTUR (sunucudaki toplu uç bile yalnız  ║
 * ║ tek tek seçilmiş id'leri kabul eder): böyle bir kısayol, avukatın hiç     ║
 * ║ görmediği belgeleri tek tıkla müvekkile açardı.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Yayın adayları `GET /portal-admin/publishable` ucundan gelir; "yayında mı"
 * bilgisini de o uç üretir. İstemci belge/duruşma listelerini ayrıca çekip
 * eşleştirmeye ÇALIŞMAZ — tek kaynak sunucudur.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CopyOnceField,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Spinner,
  Switch,
  Tabs,
} from "@/components/ui";
import { FeatureUnavailable } from "@/components/ai-ui";
import { errText } from "@/lib/faz2";
import {
  PORTAL_RESOURCE_TYPE_LABELS,
  fmtDate,
  fmtDateTime,
  labelOf,
} from "@/lib/labels";
import {
  invitePortalUser,
  isFeatureMissing,
  listPortalUsers,
  listPublications,
  listPublishable,
  publishResource,
  setPortalUserActive,
  unpublishResource,
} from "../_lib/faz5";
import type {
  PortalInviteResult,
  PortalPublicationItem,
  PortalPublishable,
  PortalResourceType,
  PortalUserItem,
} from "../_lib/faz5-types";

type Notify = (text: string, tone?: "success" | "error" | "info") => void;

/**
 * Yayın yönetiminde gösterilen kaynak türleri.
 *
 * MESAJ ve ODEME kasten YOKTUR: mesaj görünürlüğü İletişim Merkezi'nin onay
 * akışına, ödeme ise fatura kaydına bağlıdır; burada ikinci bir anahtar
 * açmak aynı kararın iki farklı yerden verilmesi olurdu.
 */
const PUBLISHABLE_TYPES: PortalResourceType[] = [
  "DOSYA",
  "BELGE",
  "DURUSMA",
  "SAFAHAT_KAYDI",
  "FATURA",
];

export function PortalTab({
  clientId,
  clientName,
  onNotify,
}: {
  clientId: string;
  clientName: string;
  onNotify: Notify;
}) {
  const [users, setUsers] = useState<PortalUserItem[]>([]);
  const [publications, setPublications] = useState<PortalPublicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMissing(false);
    const [u, p] = await Promise.allSettled([
      listPortalUsers(clientId),
      listPublications(clientId),
    ]);

    setUsers(u.status === "fulfilled" ? u.value : []);
    setPublications(p.status === "fulfilled" ? p.value : []);

    if (u.status === "rejected" && p.status === "rejected") {
      if (isFeatureMissing(u.reason) && isFeatureMissing(p.reason)) setMissing(true);
      else setError(errText(u.reason, "Portal bilgileri yüklenemedi."));
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Yayında olan kayıt sayısı — türe göre sekme rozetleri. */
  const publishedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of publications) {
      if (p.unpublishedAt) continue;
      counts[p.resourceType] = (counts[p.resourceType] ?? 0) + 1;
    }
    return counts;
  }, [publications]);

  const totalPublished = Object.values(publishedCounts).reduce((a, b) => a + b, 0);

  if (loading) return <Spinner label="Portal bilgileri yükleniyor…" />;
  if (missing) {
    return (
      <FeatureUnavailable
        title="Müvekkil portalı henüz hazır değil"
        detail="Portal uçları yayına alındığında bu sekme otomatik olarak çalışacak. O ana kadar müvekkile hiçbir kayıt açılmaz."
        onRetry={() => void load()}
      />
    );
  }

  const activeUsers = users.filter((u) => u.isActive).length;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}

      {/* İlke açıklaması — ekranın en önemli cümlesi */}
      <div className="rounded-xl border border-slate-900 bg-slate-900 px-5 py-4 text-white">
        <p className="text-sm font-semibold">
          Müvekkil yalnızca burada açtığınız kayıtları görür.
        </p>
        <p className="mt-1.5 text-xs leading-5 text-slate-300">
          Portal varsayılan olarak BOŞTUR. Dosya notları, strateji, risk skorları, iç görevler ve
          diğer müvekkillerin verisi portala hiçbir koşulda çıkmaz — bu ekrandan da açılamaz.
          Yayından kaldırdığınız kayıt müvekkilin ekranından anında düşer.
        </p>
        <p className="mt-2 text-xs font-medium text-amber-300">
          Şu anda {totalPublished} kayıt bu müvekkile açık.
        </p>
      </div>

      {/* Portal kullanıcıları */}
      <Card
        title={`Portal Kullanıcıları (${activeUsers} aktif / ${users.length})`}
        action={
          <Button size="sm" variant="gold" onClick={() => setInviteOpen(true)}>
            + Davet gönder
          </Button>
        }
      >
        {users.length === 0 ? (
          <EmptyState message="Bu müvekkil için portal hesabı yok. Davet göndererek erişim açabilirsiniz." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {u.fullName}
                    <span className="ml-2 text-xs font-normal text-slate-500">{u.email}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {u.activatedAt
                      ? `Aktif · son giriş: ${u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}`
                      : `Davet gönderildi: ${u.invitedAt ? fmtDate(u.invitedAt) : "—"} · henüz giriş yapılmadı`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={u.isActive ? "green" : "gray"}>
                    {u.isActive ? "Erişim açık" : "Askıya alındı"}
                  </Badge>
                  <Switch
                    checked={u.isActive}
                    tone="green"
                    label={`${u.fullName} portal erişimi`}
                    onChange={async (next) => {
                      try {
                        await setPortalUserActive(u.id, next);
                        onNotify(
                          next ? "Portal erişimi açıldı." : "Portal erişimi askıya alındı.",
                          next ? "success" : "info",
                        );
                        await load();
                      } catch (err) {
                        onNotify(errText(err, "Portal erişimi değiştirilemedi."), "error");
                      }
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[11px] leading-5 text-slate-400">
          Vekalet ilişkisi sona erdiğinde (azil / istifa) portal erişimi kapatılmalıdır; askıya
          alınan hesabın açık oturumları da anında geçersizleşir.
        </p>
      </Card>

      {/* Yayın yönetimi */}
      <PublicationManager
        clientId={clientId}
        publishedCounts={publishedCounts}
        onNotify={onNotify}
        onChanged={load}
      />

      <InviteModal
        open={inviteOpen}
        clientId={clientId}
        clientName={clientName}
        onClose={() => setInviteOpen(false)}
        onInvited={async () => {
          onNotify("Portal daveti oluşturuldu.", "success");
          await load();
        }}
      />
    </div>
  );
}

// ---------- Yayın yönetimi ----------

function PublicationManager({
  clientId,
  publishedCounts,
  onNotify,
  onChanged,
}: {
  clientId: string;
  publishedCounts: Record<string, number>;
  onNotify: Notify;
  onChanged: () => void | Promise<void>;
}) {
  const [type, setType] = useState<PortalResourceType>("DOSYA");
  const [rows, setRows] = useState<PortalPublishable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPublishable(clientId, type));
    } catch (err) {
      setError(errText(err, "Yayın adayları yüklenemedi."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clientId, type]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Anahtarı çevirir.
   *
   * Kapatma, yayın KAYDININ id'sini ister; `publishable` satırı kaynak id'sini
   * verir. Bu yüzden kapatmadan önce ilgili yayın kaydı aranır — bulunamazsa
   * sessizce başarılı görünmek yerine hata bildirilir.
   */
  async function toggle(row: PortalPublishable, next: boolean) {
    setBusyId(row.id);
    try {
      if (next) {
        await publishResource({ clientId, resourceType: type, resourceId: row.id });
        onNotify("Kayıt müvekkil portalında yayına alındı.", "success");
      } else {
        const current = (await listPublications(clientId, type)).find(
          (p) => p.resourceId === row.id && !p.unpublishedAt,
        );
        if (!current) {
          onNotify("Bu kaydın açık bir yayını bulunamadı; liste tazelendi.", "info");
        } else {
          await unpublishResource(current.id);
          onNotify("Kayıt portaldan kaldırıldı.", "info");
        }
      }
      await load();
      await onChanged();
    } catch (err) {
      onNotify(errText(err, "Yayın durumu değiştirilemedi."), "error");
    } finally {
      setBusyId(null);
    }
  }

  const tabs = PUBLISHABLE_TYPES.map((t) => ({
    key: t,
    label: labelOf(PORTAL_RESOURCE_TYPE_LABELS, t),
    count: publishedCounts[t] ?? 0,
  }));

  return (
    <Card title="Yayın Yönetimi">
      <p className="text-xs leading-5 text-slate-600">
        Aşağıdaki anahtarlar müvekkilin portalda NE GÖRECEĞİNİ belirler. Kapalı anahtar =
        müvekkil o kaydı görmez. Sekme rozetleri o türde kaç kaydın açık olduğunu gösterir.
      </p>

      <div className="mt-4">
        <Tabs
          tabs={tabs}
          active={type}
          onChange={(k) => setType(k)}
          ariaLabel="Yayınlanabilir kaynak türleri"
        />
      </div>

      <div className="mt-4">
        {error ? (
          <ErrorBox message={error} />
        ) : loading ? (
          <Spinner label="Kayıtlar yükleniyor…" />
        ) : rows.length === 0 ? (
          <EmptyState
            message={`Bu müvekkilde yayınlanabilir ${labelOf(
              PORTAL_RESOURCE_TYPE_LABELS,
              type,
            ).toLocaleLowerCase("tr-TR")} kaydı yok.`}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">{r.label}</p>
                  {r.at && <p className="text-[11px] text-slate-400">{fmtDate(r.at)}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={`text-xs font-medium ${
                      r.isPublished ? "text-emerald-700" : "text-slate-400"
                    }`}
                  >
                    {r.isPublished ? "Portalda açık" : "Kapalı"}
                  </span>
                  <Switch
                    checked={r.isPublished}
                    busy={busyId === r.id}
                    label={`${r.label} kaydını portalda yayınla`}
                    onChange={(next) => void toggle(r, next)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {type !== "DOSYA" && (
        <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">
          Alt kayıtlar bağlı oldukları DOSYA ile birlikte anlam kazanır. Bir belgeyi açtığınızda
          müvekkilin onu bağlamıyla görebilmesi için ilgili dosyayı da yayına almanız gerekir.
        </p>
      )}
    </Card>
  );
}

// ---------- Davet ----------

function InviteModal({
  open,
  clientId,
  clientName,
  onClose,
  onInvited,
}: {
  open: boolean;
  clientId: string;
  clientName: string;
  onClose: () => void;
  onInvited: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PortalInviteResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setError(null);
    setResult(null);
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await invitePortalUser(clientId, email);
      setResult(res);
      await onInvited();
    } catch (err) {
      setError(errText(err, "Davet oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={`${clientName} — portal daveti`} onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          {result.token ? (
            <CopyOnceField
              label={`Davet jetonu — ${result.email}`}
              value={result.token}
              warning="Bu jeton bir daha gösterilmeyecek: veritabanında yalnızca özeti saklanır. Müvekkilinize güvenli bir kanaldan iletin; kaybolursa yeni davet oluşturun."
            />
          ) : null}
          {result.token ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
              <strong>Bağlantıyı şu biçimde gönderin:</strong>{" "}
              <code className="rounded bg-white px-1">
                {"{portal adresi}"}/davet#{"{jeton}"}
              </code>
              . Jetonun <strong>“#” işaretinden sonra</strong> gelmesi bir ayrıntı değildir:
              “#” sonrası sunucuya hiç gönderilmez, hiçbir erişim günlüğüne ve tarayıcı
              geçmişi paylaşımına yazılmaz. Jeton adresin yol kısmına yazılırsa,
              günlükleri okuyabilen biri müvekkilin hesabını kendi belirlediği parolayla
              açabilir.
            </p>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              Davet oluşturuldu; jeton yanıtta dönmedi. Sunucu bağlantıyı doğrudan müvekkilin
              e-posta adresine göndermiş olabilir.
            </p>
          )}
          {result.expiresAt && (
            <p className="text-xs text-slate-500">
              Davetin son geçerlilik tarihi: {fmtDateTime(result.expiresAt)}
            </p>
          )}
          {result.note && (
            <p className="text-[11px] leading-5 text-slate-400">{result.note}</p>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Kapat</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            Davet ettiğiniz kişi portala giriş yapabilir; ancak <strong>hiçbir şey görmez</strong>{" "}
            — yayın anahtarlarını açana kadar portal onun için boştur. Ad soyad bilgisini müvekkil
            daveti kabul ederken kendisi girer.
          </p>
          <Field label="E-posta" hint="Portal girişinde kullanıcı adı olarak kullanılır.">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Oluşturuluyor…" : "Davet oluştur"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
