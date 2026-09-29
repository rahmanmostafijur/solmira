'use client';

import {
  IMAGE_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_PRODUCT,
  type ProductImage,
} from '@solmira/contracts';
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import {
  useDeleteImage,
  useProductImages,
  useReorderImages,
  useUpdateImage,
  useUploadImage,
} from '@/lib/catalog-queries';

const ACCEPT = Object.keys(IMAGE_FORMATS).join(',');

interface Upload {
  readonly key: string;
  readonly file: File;
  readonly preview: string;
  progress: number;
  error?: string;
  controller: AbortController;
}

/** Checks the browser can do cheaply; the server re-checks everything from the file's bytes. */
export function precheckImage(file: File): string | null {
  if (!(file.type in IMAGE_FORMATS)) return `${file.name}: use a JPEG, PNG or WebP image`;
  if (file.size > MAX_IMAGE_BYTES)
    return `${file.name}: images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB`;
  if (file.size === 0) return `${file.name}: the file is empty`;
  return null;
}

/** A rejected upload names its reason (wrong type, too large) rather than a generic summary. */
function uploadErrorText(error: unknown): string {
  if (error instanceof ApiError && error.details.length > 0)
    return error.details.map((issue) => issue.message).join(' ');
  return describeError(error);
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function AltTextEditor({
  image,
  onSave,
  disabled,
}: {
  image: ProductImage;
  onSave: (altText: string | null) => Promise<void>;
  disabled: boolean;
}) {
  const [value, setValue] = useState(image.altText ?? '');
  const changed = value.trim() !== (image.altText ?? '');
  return (
    <form
      className="flex gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value.trim() || null);
      }}
    >
      <input
        aria-label={`Alt text for ${image.originalFilename}`}
        placeholder="Describe the image"
        maxLength={250}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-xs"
      />
      {changed && (
        <Button type="submit" size="sm" variant="secondary">
          Save
        </Button>
      )}
    </form>
  );
}

export function ImagesPanel({
  organizationId,
  productId,
  canEdit,
}: {
  organizationId: string;
  productId: string;
  canEdit: boolean;
}) {
  const notify = useToast();
  const images = useProductImages(organizationId, productId);
  const upload = useUploadImage(organizationId, productId);
  const reorder = useReorderImages(organizationId, productId);
  const updateImage = useUpdateImage(organizationId, productId);
  const remove = useDeleteImage(organizationId, productId);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<ProductImage | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());
  const refreshedFor = useRef(new Set<string>());

  const list = images.data ?? [];
  const busy = reorder.isPending || remove.isPending;

  // Release object URLs of previews when the panel goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const current = previews.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patchUpload = (key: string, patch: Partial<Upload>) =>
    setUploads((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );

  const finish = (item: Upload) => {
    URL.revokeObjectURL(item.preview);
    previews.current.delete(item.preview);
    setUploads((current) => current.filter((entry) => entry.key !== item.key));
  };

  const start = (item: Upload) => {
    // Sequential, so images keep the order they were chosen in.
    queue.current = queue.current.then(async () => {
      if (item.controller.signal.aborted) return finish(item);
      try {
        await upload.mutateAsync({
          file: item.file,
          signal: item.controller.signal,
          onProgress: (progress) => patchUpload(item.key, { progress }),
        });
        finish(item);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return finish(item);
        patchUpload(item.key, { error: uploadErrorText(error) });
      }
    });
  };

  const addFiles = (files: FileList | File[]) => {
    const chosen = [...files];
    const room = MAX_IMAGES_PER_PRODUCT - list.length - uploads.filter((u) => !u.error).length;
    const issues: string[] = [];
    const accepted: Upload[] = [];
    for (const file of chosen) {
      const problem = precheckImage(file);
      if (problem) issues.push(problem);
      else if (accepted.length >= room)
        issues.push(`${file.name}: a product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
      else {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        accepted.push({
          key: `${file.name}-${crypto.randomUUID()}`,
          file,
          preview,
          progress: 0,
          controller: new AbortController(),
        });
      }
    }
    setProblems(issues);
    setUploads((current) => [...current, ...accepted]);
    accepted.forEach(start);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (canEdit && event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  };

  const saveOrder = async (ids: string[]) => {
    try {
      await reorder.mutateAsync(ids);
    } catch (error) {
      notify(describeError(error), 'error');
    }
  };

  const saveAlt = async (image: ProductImage, altText: string | null) => {
    try {
      await updateImage.mutateAsync({ id: image.id, altText });
      notify('Alt text saved');
    } catch (error) {
      notify(describeError(error), 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify('Image deleted');
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Panel
      title="Images"
      description={`JPEG, PNG or WebP, up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB each and ${MAX_IMAGES_PER_PRODUCT} per product. The first image is the primary one.`}
    >
      <div className="space-y-4 p-4">
        {canEdit && (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${dragging ? 'border-accent bg-accent-soft' : 'border-line'}`}
          >
            <ImagePlus aria-hidden className="size-6 text-ink-muted" />
            <p className="text-ink-muted">Drop images here, or</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={list.length >= MAX_IMAGES_PER_PRODUCT}
            >
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              aria-label="Upload product images"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        )}

        {problems.length > 0 && (
          <Alert tone="warning" title="Some files were not uploaded">
            <ul className="list-disc pl-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}

        {uploads.length > 0 && (
          <ul className="space-y-2" aria-label="Uploads in progress">
            {uploads.map((item) => (
              <li
                key={item.key}
                className="flex items-center gap-3 rounded-md border border-line p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img src={item.preview} alt="" className="size-12 rounded object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">{item.file.name}</p>
                  {item.error ? (
                    <p className="text-xs text-danger">{item.error}</p>
                  ) : (
                    <progress
                      className="h-1.5 w-full accent-accent"
                      value={Math.round(item.progress * 100)}
                      max={100}
                      aria-label={`Uploading ${item.file.name}`}
                    />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={
                    item.error ? `Dismiss ${item.file.name}` : `Cancel upload of ${item.file.name}`
                  }
                  onClick={() => (item.error ? finish(item) : item.controller.abort())}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {images.isPending ? (
          <LoadingRows label="Loading images" />
        ) : images.isError ? (
          <Alert tone="error">{describeError(images.error)}</Alert>
        ) : list.length === 0 ? (
          <EmptyState
            title="No images yet"
            description={
              canEdit ? 'Upload a photo to show this product in lists and orders.' : undefined
            }
          />
        ) : (
          <ol
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Product images in display order"
          >
            {list.map((image, index) => (
              <li key={image.id} className="overflow-hidden rounded-lg border border-line">
                <div className="relative aspect-square bg-canvas">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage; not for the image optimizer */}
                  <img
                    src={image.url}
                    alt={image.altText ?? ''}
                    loading="lazy"
                    // A signed URL that expired while the page stayed open: fetch fresh ones,
                    // once per image, so a genuinely missing file cannot cause a refetch loop.
                    onError={() => {
                      if (refreshedFor.current.has(image.id)) return;
                      refreshedFor.current.add(image.id);
                      void images.refetch();
                    }}
                    className="size-full object-contain"
                  />
                  {image.isPrimary && (
                    <span className="absolute top-2 left-2">
                      <Badge tone="accent">Primary</Badge>
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-xs text-ink-muted" title={image.originalFilename}>
                    {image.originalFilename} · {Math.ceil(image.fileSize / 1024)} KB
                  </p>
                  {canEdit ? (
                    <>
                      <AltTextEditor
                        image={image}
                        disabled={updateImage.isPending}
                        onSave={(altText) => saveAlt(image, altText)}
                      />
                      <div className="flex flex-wrap gap-1">
                        {!image.isPrimary && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => void saveOrder(move(list, index, 0).map((i) => i.id))}
                          >
                            <Star aria-hidden className="size-3.5" /> Make primary
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Move earlier"
                          disabled={busy || index === 0}
                          onClick={() =>
                            void saveOrder(move(list, index, index - 1).map((i) => i.id))
                          }
                        >
                          <ArrowLeft aria-hidden className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Move later"
                          disabled={busy || index === list.length - 1}
                          onClick={() =>
                            void saveOrder(move(list, index, index + 1).map((i) => i.id))
                          }
                        >
                          <ArrowRight aria-hidden className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${image.originalFilename}`}
                          disabled={busy}
                          onClick={() => setDeleting(image)}
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    image.altText && <p className="text-xs">{image.altText}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this image?"
        description="The file is removed from storage. This cannot be undone."
        confirmLabel="Delete image"
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </Panel>
  );
}
