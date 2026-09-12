import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, features } from "@/lib/env";
import { query } from "@/lib/db/client";

/**
 * Object storage for uploaded PDFs and cached scrape payloads.
 *
 * Render instances have ephemeral filesystems, so nothing is ever written to
 * local disk. Production is Neon object storage over its S3-compatible API;
 * the server hands out presigned URLs and never proxies file bytes.
 *
 * Bucket layout:
 *   products/<productId>/sources/<uuid>.pdf   uploaded files, original bytes
 *   products/<productId>/cache/<sha256>.json  cached scrape payloads
 *   products/<productId>/exports/<runId>.csv  lead exports
 *
 * When no S3 credentials are configured the driver falls back to a Postgres
 * table so local development works without a second vendor. The fallback
 * proxies bytes through the app and is explicitly not the production path.
 */

export const PRESIGN_TTL_SECONDS = 15 * 60;

export type PresignedUpload = {
  url: string;
  objectKey: string;
  bucket: string;
  /** Headers the browser must send on the PUT. */
  headers: Record<string, string>;
  /** True when the client must PUT directly to storage; false for the fallback. */
  direct: boolean;
  expiresInSeconds: number;
};

export interface StorageDriver {
  readonly name: string;
  readonly bucket: string;
  presignUpload(objectKey: string, mimeType: string): Promise<PresignedUpload>;
  presignDownload(objectKey: string): Promise<string>;
  put(objectKey: string, body: Buffer, mimeType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer | undefined>;
  deletePrefix(prefix: string): Promise<number>;
}

// --- S3-compatible driver (Neon object storage) ---------------------------

class S3Driver implements StorageDriver {
  readonly name = "neon-object-storage";
  readonly bucket: string;
  private client: S3Client;

  constructor() {
    this.bucket = env.storageBucket!;
    this.client = new S3Client({
      region: env.storageRegion,
      endpoint: env.storageEndpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.storageAccessKeyId!,
        secretAccessKey: env.storageSecretAccessKey!,
      },
    });
  }

  async presignUpload(objectKey: string, mimeType: string): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: mimeType }),
      { expiresIn: PRESIGN_TTL_SECONDS }
    );
    return {
      url,
      objectKey,
      bucket: this.bucket,
      headers: { "content-type": mimeType },
      direct: true,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    };
  }

  async presignDownload(objectKey: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  }

  async put(objectKey: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: body, ContentType: mimeType })
    );
  }

  async get(objectKey: string): Promise<Buffer | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey })
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : undefined;
    } catch {
      return undefined;
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token })
      );
      const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key);
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } })
        );
        deleted += keys.length;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}

// --- Postgres fallback driver (development only) --------------------------

class PostgresDriver implements StorageDriver {
  readonly name = "postgres-fallback";
  readonly bucket = "local";

  async presignUpload(objectKey: string, mimeType: string): Promise<PresignedUpload> {
    // No presigning without S3: the client PUTs to our own route instead.
    return {
      url: `${env.appUrl}/api/storage/${encodeURIComponent(objectKey)}`,
      objectKey,
      bucket: this.bucket,
      headers: { "content-type": mimeType },
      direct: false,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    };
  }

  async presignDownload(objectKey: string): Promise<string> {
    return `${env.appUrl}/api/storage/${encodeURIComponent(objectKey)}`;
  }

  async put(objectKey: string, body: Buffer, mimeType: string): Promise<void> {
    await query(
      `insert into storage_objects (object_key, bucket, mime_type, size_bytes, body)
       values ($1, $2, $3, $4, $5)
       on conflict (object_key) do update set
         body = excluded.body, mime_type = excluded.mime_type, size_bytes = excluded.size_bytes`,
      [objectKey, this.bucket, mimeType, body.byteLength, body]
    );
  }

  async get(objectKey: string): Promise<Buffer | undefined> {
    const rows = await query<{ body: Buffer }>(
      `select body from storage_objects where object_key = $1`,
      [objectKey]
    );
    return rows[0]?.body;
  }

  async deletePrefix(prefix: string): Promise<number> {
    const rows = await query<{ object_key: string }>(
      `delete from storage_objects where object_key like $1 returning object_key`,
      [`${prefix}%`]
    );
    return rows.length;
  }
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (!driver) driver = features.storage ? new S3Driver() : new PostgresDriver();
  return driver;
}

export function sourceObjectKey(productId: string, id: string, filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `products/${productId}/sources/${id}${ext.toLowerCase()}`;
}
