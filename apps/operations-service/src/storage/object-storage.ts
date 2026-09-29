import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { OperationsConfig } from '../config.js';

/**
 * What the catalog needs from object storage, and nothing vendor-specific. The implementation
 * below speaks the S3 API, which both MinIO (local) and AWS S3 (production) implement, so moving
 * between them is configuration, not code.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** A time-limited URL that grants read access to exactly one object. */
  signedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Cheap reachability check for readiness reporting. */
  ping(): Promise<void>;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  /** Signs URLs for browsers; may use a different host than the one the service talks to. */
  private readonly signer: S3Client;

  constructor(private readonly config: OperationsConfig) {
    const base: S3ClientConfig = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    };
    this.client = new S3Client({
      ...base,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    });
    const publicEndpoint = config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT;
    this.signer = new S3Client({
      ...base,
      ...(publicEndpoint ? { endpoint: publicEndpoint } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Browsers must render the bytes as the validated image type, never sniff them as HTML.
        CacheControl: 'private, max-age=300',
        ContentDisposition: 'inline',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }

  signedReadUrl(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      {
        expiresIn: ttlSeconds,
      },
    );
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
  }
}
