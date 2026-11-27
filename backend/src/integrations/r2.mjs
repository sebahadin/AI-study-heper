import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DocumentError } from '../documents/errors.mjs';
import { readBoundedBody } from './bounded-body.mjs';

const unavailable = () => new DocumentError(503, 'storage_unavailable', 'File storage is temporarily unavailable.');

export class R2Storage {
  constructor({ accountId, bucket, accessKeyId, secretAccessKey }, { client, signer = getSignedUrl } = {}) {
    this.configuration = { accountId, bucket, accessKeyId, secretAccessKey };
    this.client = client;
    this.signer = signer;
  }

  configuredClient() {
    const { accountId, bucket, accessKeyId, secretAccessKey } = this.configuration;
    if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !bucket || !accessKeyId || !secretAccessKey) { throw unavailable(); }
    this.client ||= new S3Client({
      region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey }, maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return this.client;
  }

  async signUpload(key, byteCount, expiresIn) {
    try {
      return await this.signer(this.configuredClient(), new PutObjectCommand({
        Bucket: this.configuration.bucket, Key: key, ContentType: 'application/pdf', ContentLength: byteCount,
      }), { expiresIn, signableHeaders: new Set(['content-type', 'content-length']) });
    } catch { throw unavailable(); }
  }

  async signDownload(key, expiresIn) {
    try {
      return await this.signer(this.configuredClient(), new GetObjectCommand({
        Bucket: this.configuration.bucket, Key: key,
      }), { expiresIn });
    } catch { throw unavailable(); }
  }

  async download(key, { maxBytes, expectedBytes }) {
    try {
      const result = await this.configuredClient().send(
        new GetObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
      if (result.ContentLength > maxBytes || result.ContentLength !== expectedBytes) {
        result.Body?.destroy?.();
        throw new DocumentError(
          result.ContentLength > maxBytes ? 413 : 422,
          result.ContentLength > maxBytes ? 'pdf_too_large' : 'upload_size_mismatch',
          'The uploaded file does not match the allowed size.',
        );
      }
      const data = await readBoundedBody(result.Body, maxBytes);
      if (data.length !== expectedBytes) {
        throw new DocumentError(422, 'upload_size_mismatch', 'The uploaded file does not match its declared size.');
      }
      return data;
    } catch (error) {
      if (error instanceof DocumentError) { throw error; }
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
        throw new DocumentError(409, 'upload_not_found', 'Finish uploading the file before confirming it.');
      }
      throw unavailable();
    }
  }

  async putValidated(key, data) {
    try {
      await this.configuredClient().send(new PutObjectCommand({
        Bucket: this.configuration.bucket, Key: key, Body: data,
        ContentType: 'application/pdf', ContentLength: data.length,
      }), { abortSignal: AbortSignal.timeout(20000) });
    } catch { throw unavailable(); }
  }

  async list(prefix) {
    try {
      const objects = [];
      let continuation;
      do {
        const result = await this.configuredClient().send(new ListObjectsV2Command({
          Bucket: this.configuration.bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: continuation,
        }), { abortSignal: AbortSignal.timeout(10000) });
        objects.push(...(result.Contents || []).map(object => ({ key: object.Key, modifiedAt: object.LastModified })));
        continuation = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (result.IsTruncated && !continuation) { throw unavailable(); }
      } while (continuation);
      return objects;
    } catch { throw unavailable(); }
  }

  async remove(key) {
    try {
      await this.configuredClient().send(
        new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(10000) },
      );
    } catch { throw unavailable(); }
  }
}
