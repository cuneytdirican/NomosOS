/**
 * Dilekçe UDF çıktısının depolanması.
 *
 * TERCİH VE GEREKÇE (görev notu 5): Genel `StorageService` başka bir ajanın
 * sahiplik alanındadır (apps/api/src/storage/**); ona bağımlı olmamak için bu
 * modül @aws-sdk/client-s3'ü DOĞRUDAN, kendi içinde ve dar bir yüzeyle kullanır
 * (tek nesne yazma + ön-imzalı indirme bağlantısı). Böylece dilekçe modülü tek
 * başına derlenir ve çalışır; ileride ortak StorageService hazır olduğunda bu
 * sınıfın gövdesi ona devredilebilir, dışa bakan sözleşme (exportUdf'in dönüşü)
 * değişmez.
 *
 * S3 YAPILANDIRILMAMIŞSA: hata verilmez; UDF baytları base64 olarak döner.
 * Böylece depolamasız bir ortamda (test, yerel geliştirme) dilekçe dışa aktarımı
 * çalışmaya devam eder ve kullanıcı neden bağlantı yerine gömülü dosya aldığını
 * yanıttaki `storage` alanından görür.
 */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sanitizeExternalError } from "../common/errors";

/** UYAP Doküman Formatı için kullanılan MIME tipi. */
export const UDF_MIME_TYPE = "application/vnd.uyap.udf";

export interface StoredExport {
  /** "S3" → downloadUrl dolu · "INLINE" → base64Content dolu. */
  storage: "S3" | "INLINE";
  storageKey?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  base64Content?: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  note?: string;
}

const DEFAULT_TTL_SECONDS = 900;
/**
 * Ön-imzalı UDF bağlantısının TAVAN ömrü.
 *
 * Belge indirmede TTL 300 sn'ye sabitken dilekçe dışa aktarımında 24 saate
 * kadar çıkılabiliyordu. Bu bağlantı kimlik doğrulaması İSTEMEZ ve dosya
 * müvekkilin gerçek TCKN/adres bilgisini taşır; ömrü kısa olmalıdır.
 */
const MAX_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 60;

function clampTtl(ttlSeconds: number | undefined): number {
  const value = Math.floor(ttlSeconds ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, value));
}

/** Üretimde base64 dalı KAPALIDIR (yanıtı şişirir ve günlüklere düşebilir). */
function inlineFallbackAllowed(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

@Injectable()
export class PetitionExportStorage {
  private readonly logger = new Logger(PetitionExportStorage.name);
  private resolved?: { client: S3Client; bucket: string } | null;

  /**
   * İstemci İLK KULLANIMDA kurulur (ConfigService'e bağımlılık yok).
   *
   * Gerekçe: yapılandırmayı yapıcıda okumak, ConfigModule'ün .env'i process.env'e
   * yüklemesinden ÖNCE örneklenme ihtimaline açıktır; ayrıca depolama hiç
   * kullanılmayan isteklerde boş yere istemci kurulur. `null` = yapılandırılmamış.
   */
  private resolve(): { client: S3Client; bucket: string } | null {
    if (this.resolved !== undefined) return this.resolved;

    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const bucket = process.env.S3_BUCKET;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      this.resolved = null;
      return null;
    }

    this.resolved = {
      bucket,
      client: new S3Client({
        endpoint,
        region: process.env.S3_REGION ?? "us-east-1",
        credentials: { accessKeyId, secretAccessKey },
        // MinIO sanal-host adresleme desteklemez; yol tabanlı erişim şarttır.
        forcePathStyle: true,
      }),
    };
    return this.resolved;
  }

  get isConfigured(): boolean {
    return this.resolve() !== null;
  }

  /**
   * Baytları yazar ve ön-imzalı indirme bağlantısı döner.
   * Depolama yapılandırılmamışsa veya yazma başarısızsa base64'e düşer.
   */
  async store(params: {
    key: string;
    fileName: string;
    bytes: Uint8Array;
    expiresInSeconds?: number;
  }): Promise<StoredExport> {
    const base = {
      fileName: params.fileName,
      sizeBytes: params.bytes.byteLength,
      mimeType: UDF_MIME_TYPE,
    };

    const s3 = this.resolve();
    if (!s3) {
      if (!inlineFallbackAllowed()) {
        throw new ServiceUnavailableException(
          "Belge deposu (S3/MinIO) yapılandırılmadığı için dilekçe dışa aktarılamıyor. " +
            "S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET tanımlayın.",
        );
      }
      return {
        ...base,
        storage: "INLINE",
        base64Content: Buffer.from(params.bytes).toString("base64"),
        note:
          "Belge deposu (S3/MinIO) yapılandırılmadığı için dosya bağlantı yerine base64 " +
          "olarak döndürüldü. S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET tanımlayın.",
      };
    }

    const ttl = clampTtl(params.expiresInSeconds);
    try {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: params.key,
          Body: Buffer.from(params.bytes),
          ContentType: UDF_MIME_TYPE,
          ContentDisposition: `attachment; filename="${params.fileName}"`,
        }),
      );
      const downloadUrl = await getSignedUrl(
        s3.client,
        new GetObjectCommand({ Bucket: s3.bucket, Key: params.key }),
        { expiresIn: ttl },
      );
      return {
        ...base,
        storage: "S3",
        storageKey: params.key,
        downloadUrl,
        expiresInSeconds: ttl,
      };
    } catch (err) {
      // Ham depo hatası MinIO adresini, kova adını ve ağ ayrıntısını taşır;
      // istemciye yalnızca korelasyon kimliği gider.
      const safe = sanitizeExternalError(this.logger, "UDF belge deposuna yazılamadı", err);
      if (!inlineFallbackAllowed()) {
        throw new ServiceUnavailableException(safe.message);
      }
      return {
        ...base,
        storage: "INLINE",
        base64Content: Buffer.from(params.bytes).toString("base64"),
        note: `${safe.message} Dosya base64 olarak döndürüldü.`,
      };
    }
  }
}
