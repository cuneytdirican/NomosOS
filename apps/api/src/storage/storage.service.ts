import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageUnavailable } from "../common/errors";

/**
 * S3 uyumlu nesne deposu (yerelde MinIO).
 *
 * TASARIM KARARLARI
 * -----------------
 * 1. `forcePathStyle: true` ZORUNLUDUR. MinIO sanal-host adreslemesini
 *    (`https://bucket.host/...`) desteklemez; bu bayrak olmadan her istek
 *    çözülemeyen bir DNS adına gider.
 * 2. Ham dosyaya doğrudan HTTP erişimi YOKTUR. Okuma/yazma yalnızca süreli
 *    ön-imzalı URL ile veya sunucu içi buffer okuması ile yapılır
 *    (Modül 06, iş kuralı 1 — müvekkil sırrı + KVKK).
 * 3. NESNE ANAHTARI TENANT ÖNEKLİDİR: `${tenantId}/${caseId ?? "genel"}/${documentId}-${ad}`.
 *    Anahtarın ilk bileşeni büro kimliğidir; başka bir büronun anahtarını tahmin
 *    etmek bile tek başına yetmez, çünkü indirme ucu Document kaydını daima
 *    `tenantId` süzgeciyle arar (bkz. DocumentsService.download).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly bucket: string;

  constructor() {
    // İ-15: KODDA GÖMÜLÜ KİMLİK VARSAYANI YALNIZ GELİŞTİRME ORTAMI İÇİNDİR
    // (yerel MinIO). ÜRETİMDE (NODE_ENV=production) S3 kimlikleri zorunludur:
    // gömülü varsayınla açılırsa "nomosos/nomosos-gizli-123" gibi bilinen
    // kimliklerle çalışır, gerçek bir üretim kovasına kimlikbilgisiz yazma
    // hatasını gizlerdi. Açılışta düşürmek, yanlış yapılandırmayı ilk saniyede
    // belli eder — belge yükleme ucu "ayakta ama yazamıyor" durumunda kalmaz.
    if (process.env.NODE_ENV === "production") {
      const required = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const;
      const missing = required.filter((key) => !(process.env[key] ?? "").trim());
      if (missing.length > 0) {
        throw new Error(
          `Üretim ortamında S3 yapılandırması eksik: ${missing.join(", ")}. ` +
            "Gömülü geliştirme varsayılanları üretimde KULLANILMAZ.",
        );
      }
    }
    const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
    this.bucket = process.env.S3_BUCKET ?? "nomosos-belgeler";
    this.client = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      // MinIO için şart; AWS S3'te de zararsızdır.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "nomosos",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "nomosos-gizli-123",
      },
    });
  }

  /** Uygulama açılışında kova yoksa oluşturulur; hata uygulamayı DÜŞÜRMEZ. */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (err) {
      this.logger.warn(
        `Belge deposu hazırlanamadı (${this.bucket}): ${(err as Error).message}. ` +
          "Belge yükleme uçları çalışmayacaktır; MinIO ayakta mı kontrol edin."
      );
    }
  }

  /** Kova var mı? Yoksa oluşturur. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Yok veya erişilemiyor — oluşturmayı dene.
    }
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Belge kovası oluşturuldu: ${this.bucket}`);
    } catch (err) {
      const message = (err as Error).message;
      // Yarış koşulunda başka bir örnek oluşturmuş olabilir.
      if (/BucketAlreadyOwnedByYou|BucketAlreadyExists/i.test(message)) return;
      throw err;
    }
  }

  /**
   * Nesne anahtarı üretir: `${tenantId}/${caseId ?? "genel"}/${documentId}-${güvenliAd}`.
   * Dosya adı, yol ayracı ve Türkçe karakterlerden arındırılır (S3 anahtarında
   * `../` veya kodlanmamış UTF-8 sorun çıkarır).
   */
  buildObjectKey(params: {
    tenantId: string;
    caseId?: string | null;
    documentId: string;
    fileName: string;
  }): string {
    const folder = params.caseId ?? "genel";
    return `${params.tenantId}/${folder}/${params.documentId}-${safeFileName(params.fileName)}`;
  }

  async putObject(key: string, buffer: Buffer, mime?: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mime ?? "application/octet-stream",
        })
      );
    } catch (err) {
      // Ham hata MinIO adresini, kova adını ve ağ ayrıntısını (ECONNREFUSED
      // 10.x.x.x:9000) istemciye sızdırıyordu; artık yalnızca korelasyon kimliği.
      throw storageUnavailable(this.logger, "Belge depoya yazılamadı", err);
    }
  }

  /** Süreli indirme bağlantısı (varsayılan 300 sn). */
  async getPresignedDownloadUrl(
    key: string,
    ttlSeconds = 300,
    downloadName?: string
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${safeFileName(downloadName)}"`
        : undefined,
    });
    try {
      return await getSignedUrl(this.client, command, { expiresIn: clampTtl(ttlSeconds) });
    } catch (err) {
      throw storageUnavailable(this.logger, "İndirme bağlantısı üretilemedi", err);
    }
  }

  /** Süreli yükleme bağlantısı (tarayıcıdan doğrudan yükleme senaryosu). */
  async getPresignedUploadUrl(key: string, ttlSeconds = 300, mime?: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mime ?? "application/octet-stream",
    });
    try {
      return await getSignedUrl(this.client, command, { expiresIn: clampTtl(ttlSeconds) });
    } catch (err) {
      throw storageUnavailable(this.logger, "Yükleme bağlantısı üretilemedi", err);
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      // Silme, DB kaydının silinmesini bloklamamalı; yetim nesne loglanır.
      this.logger.warn(`Depo nesnesi silinemedi (${key}): ${(err as Error).message}`);
    }
  }

  /** Nesneyi sunucu belleğine okur (OCR / metin çıkarma hattı için). */
  async getObjectBuffer(key: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const body = result.Body;
      if (!body) {
        throw new Error("Nesne gövdesi boş döndü.");
      }
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err) {
      throw storageUnavailable(this.logger, "Belge depodan okunamadı", err);
    }
  }
}

/** Ön-imzalı URL ömrü: 30 sn – 1 saat arası. */
function clampTtl(ttlSeconds: number): number {
  return Math.min(3600, Math.max(30, Math.floor(ttlSeconds) || 300));
}

const TR_MAP: Record<string, string> = {
  ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I",
  ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
};

/**
 * Dosya adını nesne anahtarında ve Content-Disposition başlığında kullanılabilir
 * hale getirir: yol ayraçları düşer, Türkçe harfler ASCII'ye indirilir,
 * kalan güvensiz karakterler `_` olur.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "belge";
  const ascii = base.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => TR_MAP[ch] ?? ch);
  const cleaned = ascii.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");
  const trimmed = cleaned.slice(0, 120);
  return trimmed.length > 0 ? trimmed : "belge";
}
