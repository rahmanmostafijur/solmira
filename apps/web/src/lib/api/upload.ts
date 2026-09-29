import { API_PREFIX, CLIENT_HEADER, type ProductImage } from '@solmira/contracts';
import { refreshSession, sessionStore } from '../auth/session-store';
import { toApiError } from './client';

export interface UploadOptions {
  readonly altText?: string;
  /** Fraction of the request body sent so far, 0..1. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

interface RawResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * XMLHttpRequest rather than fetch: browsers report upload progress only through
 * `xhr.upload.onprogress`. Authentication mirrors the fetch client: the in-memory access token,
 * one refresh and one retry on 401.
 */
export async function uploadProductImage(
  productId: string,
  file: File,
  options: UploadOptions = {},
): Promise<ProductImage> {
  const url = `${API_PREFIX}/products/${productId}/images`;
  const form = () => {
    const data = new FormData();
    if (options.altText) data.append('altText', options.altText);
    data.append('file', file);
    return data;
  };

  let response = await send(url, form(), sessionStore.getSnapshot().session?.accessToken, options);
  if (response.status === 401) {
    const session = await refreshSession();
    sessionStore.set(session);
    if (session) response = await send(url, form(), session.accessToken, options);
  }
  if (response.status >= 200 && response.status < 300) return response.body as ProductImage;
  throw toApiError(response.status, response.body);
}

function send(
  url: string,
  body: FormData,
  token: string | null | undefined,
  { onProgress, signal }: UploadOptions,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader(CLIENT_HEADER, 'web');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let parsed: unknown;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        parsed = undefined;
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
