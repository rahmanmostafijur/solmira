import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/** A real, decodable PNG of the given size (solid colour), built without fixtures on disk. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('product images (real MinIO over the S3 API)', () => {
  let t: TestApp;
  let manager: Actor;
  let productId: string;
  const image = png(4, 4);

  const upload = (
    actor: Actor,
    product: string,
    file: Buffer,
    filename: string,
    fields: Record<string, string> = {},
  ) => {
    let call = t.http().post(`/api/v1/products/${product}/images`).set(actor.auth);
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return call.attach('file', file, filename);
  };

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.actor(newOrganizationId(), 'MANAGER');
    productId = (
      await t
        .http()
        .post('/api/v1/products')
        .set(manager.auth)
        .send({ name: 'Photographed', basePrice: 100, currency: 'USD' })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('stores an upload privately and serves it only through a short-lived signed URL', async () => {
    const response = await upload(manager, productId, image, 'Front View.PNG', {
      altText: 'Front view',
    }).expect(201);
    const body = response.body;
    expect(body).toMatchObject({
      contentType: 'image/png',
      fileSize: image.length,
      altText: 'Front view',
      isPrimary: true,
      sortOrder: 0,
      originalFilename: 'Front View.PNG',
    });
    expect(body).not.toHaveProperty('objectKey');
    expect(new Date(body.urlExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const signed = await fetch(body.url);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await signed.arrayBuffer()).equals(image)).toBe(true);

    const unsigned = new URL(body.url);
    unsigned.search = '';
    expect((await fetch(unsigned)).status).toBe(403);
  });

  it('keeps the object under the organization and product prefix, with a generated name', async () => {
    const { rows } = await t.db.query(
      'select organization_id, object_key from product_images where product_id = $1',
      [productId],
    );
    const [row] = rows;
    expect(row.object_key).toMatch(
      new RegExp(`^organizations/${manager.organizationId}/products/${productId}/[0-9a-f-]{36}$`),
    );
    expect(row.object_key).not.toContain('Front');
  });

  it('rejects files whose bytes are not an allowed image, whatever their name or declared type', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const asSvg = await upload(manager, productId, svg, 'logo.svg').expect(400);
    expect(asSvg.body.error.code).toBe('VALIDATION_FAILED');
    await upload(manager, productId, svg, 'disguised.png').expect(400);
    await upload(manager, productId, Buffer.from('MZ\x90\x00 not an image'), 'setup.jpg').expect(
      400,
    );
    await upload(manager, productId, image, 'mismatch.jpg').expect(400);
  });

  it('rejects an oversized file and a request with no file', async () => {
    const tooBig = Buffer.concat([image, Buffer.alloc(5 * 1024 * 1024)]);
    const oversized = await upload(manager, productId, tooBig, 'huge.png');
    expect(oversized.status).toBe(413);
    const missing = await t
      .http()
      .post(`/api/v1/products/${productId}/images`)
      .set(manager.auth)
      .field('altText', 'nothing')
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('reorders images, which moves the primary image, and requires every image to be named', async () => {
    const second = (await upload(manager, productId, png(2, 2), 'side.png').expect(201)).body;
    const third = (await upload(manager, productId, png(3, 3), 'back.png').expect(201)).body;
    const current = (
      await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200)
    ).body;
    expect(current.map((i: { id: string }) => i.id).slice(1)).toEqual([second.id, third.id]);

    const reordered = await t
      .http()
      .post(`/api/v1/products/${productId}/images/reorder`)
      .set(manager.auth)
      .send({ imageIds: [third.id, current[0].id, second.id] })
      .expect(200);
    expect(
      reordered.body.map((i: { id: string; isPrimary: boolean }) => [i.id, i.isPrimary]),
    ).toEqual([
      [third.id, true],
      [current[0].id, false],
      [second.id, false],
    ]);

    await t
      .http()
      .post(`/api/v1/products/${productId}/images/reorder`)
      .set(manager.auth)
      .send({ imageIds: [third.id] })
      .expect(400);
    await t
      .http()
      .post(`/api/v1/products/${productId}/images/reorder`)
      .set(manager.auth)
      .send({ imageIds: [third.id, third.id] })
      .expect(400);
  });

  it('updates and clears alt text', async () => {
    const [first] = (
      await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200)
    ).body;
    const updated = await t
      .http()
      .patch(`/api/v1/products/${productId}/images/${first.id}`)
      .set(manager.auth)
      .send({ altText: 'Back view' })
      .expect(200);
    expect(updated.body.altText).toBe('Back view');
    const cleared = await t
      .http()
      .patch(`/api/v1/products/${productId}/images/${first.id}`)
      .set(manager.auth)
      .send({ altText: null })
      .expect(200);
    expect(cleared.body.altText).toBeNull();
  });

  it('deletes the metadata and the stored object', async () => {
    const [first] = (
      await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200)
    ).body;
    await t
      .http()
      .delete(`/api/v1/products/${productId}/images/${first.id}`)
      .set(manager.auth)
      .expect(204);
    const remaining = (
      await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200)
    ).body;
    expect(remaining.map((i: { id: string }) => i.id)).not.toContain(first.id);
    expect(remaining[0].isPrimary).toBe(true);
    expect((await fetch(first.url)).status).toBe(404);
    await t
      .http()
      .delete(`/api/v1/products/${productId}/images/${first.id}`)
      .set(manager.auth)
      .expect(404);
  });

  it('isolates images between organizations', async () => {
    const other = await t.actor(newOrganizationId(), 'OWNER');
    const [own] = (
      await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200)
    ).body;
    await t.http().get(`/api/v1/products/${productId}/images`).set(other.auth).expect(404);
    await upload(other, productId, image, 'intruder.png').expect(404);
    await t
      .http()
      .patch(`/api/v1/products/${productId}/images/${own.id}`)
      .set(other.auth)
      .send({ altText: 'Hijacked' })
      .expect(404);
    await t
      .http()
      .delete(`/api/v1/products/${productId}/images/${own.id}`)
      .set(other.auth)
      .expect(404);
    await t
      .http()
      .post(`/api/v1/products/${productId}/images/reorder`)
      .set(other.auth)
      .send({ imageIds: [own.id] })
      .expect(404);

    const otherProduct = (
      await t
        .http()
        .post('/api/v1/products')
        .set(other.auth)
        .send({ name: 'Theirs', basePrice: 1, currency: 'USD' })
        .expect(201)
    ).body.id;
    await t
      .http()
      .patch(`/api/v1/products/${otherProduct}/images/${own.id}`)
      .set(other.auth)
      .send({ altText: 'Hijacked' })
      .expect(404);
    expect(
      (await t.http().get(`/api/v1/products/${productId}/images`).set(manager.auth).expect(200))
        .body[0].altText,
    ).not.toBe('Hijacked');
  });

  it('forbids image changes to read-only roles', async () => {
    const viewer = await t.actor(manager.organizationId, 'VIEWER');
    await t.http().get(`/api/v1/products/${productId}/images`).set(viewer.auth).expect(200);
    await upload(viewer, productId, image, 'viewer.png').expect(403);
  });

  it('returns 404 for a missing product or image', async () => {
    const missing = '0192f000-0000-7000-8000-000000000000';
    await upload(manager, missing, image, 'ghost.png').expect(404);
    await t
      .http()
      .patch(`/api/v1/products/${productId}/images/${missing}`)
      .set(manager.auth)
      .send({ altText: 'x' })
      .expect(404);
  });
});
