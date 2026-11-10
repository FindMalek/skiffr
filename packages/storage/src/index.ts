export interface StorageConfig {
  endpoint?: string
  region: string
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
  /** `pr-<n>/` on previews, so a closed PR's uploads can be deleted together. */
  prefix: string
}

export interface Storage {
  bucket: string
  prefix: string
  put(key: string, data: Blob | ArrayBuffer, type: string): Promise<void>
  /** A short-lived url to read a private object. */
  url(key: string): string
}

/** Any S3 API (Garage, R2, AWS, MinIO) through Bun's built-in client; null when no bucket is configured. */
export function createStorage(config: StorageConfig): Storage | null {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix } = config
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  const client = new Bun.S3Client({ endpoint, region, bucket, accessKeyId, secretAccessKey })
  return {
    bucket,
    prefix,
    async put(key, data, type) {
      await client.write(key, data, { type })
    },
    url(key) {
      return client.presign(key, { expiresIn: 3600 })
    },
  }
}
