import { IMAGE_FORMATS, MAX_IMAGE_BYTES, type ImageContentType } from '@solmira/contracts';
import { ValidationError } from '@solmira/service-kit';

export interface UploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export interface ValidatedImage {
  readonly contentType: ImageContentType;
  readonly originalFilename: string;
  readonly body: Buffer;
}

/**
 * The file's real type, from its first bytes. The browser-supplied MIME type and the file name
 * are attacker-controlled; the signature is what the bytes actually are.
 */
export function sniffImageType(bytes: Buffer): ImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * The name is kept only as display metadata, never as part of a storage key: strip any path,
 * control characters and anything outside a conservative alphabet, and bound the length.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || 'image';
}

function extensionOf(name: string): string {
  const match = /\.[^.]+$/.exec(name.toLowerCase());
  return match ? match[0] : '';
}

export function validateImageUpload(file: UploadedFile | undefined): ValidatedImage {
  const invalid = (message: string) => new ValidationError([{ path: 'file', message }]);
  if (!file || file.size === 0) throw invalid('Choose an image to upload');
  if (file.size > MAX_IMAGE_BYTES)
    throw invalid(`Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);

  const contentType = sniffImageType(file.buffer);
  if (!contentType) throw invalid('Upload a JPEG, PNG or WebP image');

  // The extension must agree with the content, so a renamed file cannot masquerade as another type.
  const extension = extensionOf(file.originalname);
  if (!(IMAGE_FORMATS[contentType] as readonly string[]).includes(extension)) {
    throw invalid('The file extension does not match its content');
  }
  return { contentType, originalFilename: sanitizeFilename(file.originalname), body: file.buffer };
}

/** Keys are generated server-side only: organizations/{org}/products/{product}/{uuid}. */
export function productImageKey(
  organizationId: string,
  productId: string,
  imageId: string,
): string {
  return `organizations/${organizationId}/products/${productId}/${imageId}`;
}
