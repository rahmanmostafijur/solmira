import { describe, expect, it } from 'vitest';
import { fieldMessages } from '../../test/support/field-messages.js';
import {
  productImageKey,
  sanitizeFilename,
  sniffImageType,
  validateImageUpload,
} from './image-validation.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const file = (originalname: string, buffer: Buffer, mimetype = 'image/jpeg') => ({
  originalname,
  buffer,
  mimetype,
  size: buffer.length,
});

describe('sniffImageType', () => {
  it('identifies JPEG, PNG and WebP by their signatures', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('rejects everything else, including SVG, HTML, PDF and executables', () => {
    for (const content of [
      '<svg onload="alert(1)"/>',
      '<!doctype html>',
      '%PDF-1.7',
      'MZ\x90\x00',
    ]) {
      expect(sniffImageType(Buffer.from(content))).toBeNull();
    }
  });
});

describe('validateImageUpload', () => {
  it('accepts a real image and trusts the content, not the declared MIME type', () => {
    expect(validateImageUpload(file('shoe.PNG', PNG, 'application/octet-stream'))).toMatchObject({
      contentType: 'image/png',
    });
  });

  it('rejects a script renamed to .jpg', () => {
    expect(
      fieldMessages(() =>
        validateImageUpload(file('shoe.jpg', Buffer.from('<script>alert(1)</script>'))),
      ),
    ).toMatch(/JPEG, PNG or WebP/);
  });

  it('rejects an extension that does not match the content', () => {
    expect(fieldMessages(() => validateImageUpload(file('shoe.png', JPEG)))).toMatch(
      /does not match/,
    );
    expect(fieldMessages(() => validateImageUpload(file('shoe.jpg.exe', JPEG)))).toMatch(
      /does not match/,
    );
  });

  it('rejects empty and oversized files', () => {
    expect(fieldMessages(() => validateImageUpload(undefined))).toMatch(/Choose an image/);
    expect(
      fieldMessages(() => validateImageUpload({ ...file('big.jpg', JPEG), size: 6 * 1024 * 1024 })),
    ).toMatch(/at most 5 MB/);
  });
});

describe('storage keys and names', () => {
  it('never use the client file name, and strip paths from the display name', () => {
    expect(productImageKey('org-1', 'prod-1', 'img-1')).toBe(
      'organizations/org-1/products/prod-1/img-1',
    );
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\me\\photo<1>.jpg')).toBe('photo_1_.jpg');
    expect(sanitizeFilename('...')).toBe('image');
  });
});
