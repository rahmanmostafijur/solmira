'use client';

import type {
  BulkProductStatusRequest,
  BulkProductStatusResult,
  Category,
  CreateCategoryRequest,
  CreateProductRequest,
  CreateSupplierRequest,
  CreateVariantRequest,
  CreateWarehouseRequest,
  Page,
  ProductDetail,
  ProductImage,
  ProductListQuery,
  ProductSummary,
  Supplier,
  SupplierListQuery,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UpdateSupplierRequest,
  UpdateVariantRequest,
  UpdateWarehouseRequest,
  Variant,
  Warehouse,
  WarehouseListQuery,
} from '@solmira/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uploadProductImage, type UploadOptions } from './api/upload';
import { api } from './auth/session-store';
import { toApiQuery } from './list-params';

/** Largest page the API serves; used for pick lists such as category and supplier selects. */
export const PICK_LIST_SIZE = 100;
/** Signed image URLs live 5 minutes on the server; refresh well before they expire. */
const IMAGE_URL_REFRESH_MS = 4 * 60_000;

/**
 * Every catalog key starts with ['org', organizationId, 'catalog']: data of one organization is
 * never served while another is active, and one invalidation refreshes everything a write can
 * affect (lists, counts, detail pages).
 */
export const catalogKeys = {
  all: (org: string) => ['org', org, 'catalog'] as const,
  products: (org: string, query: object) => ['org', org, 'catalog', 'products', query] as const,
  product: (org: string, id: string) => ['org', org, 'catalog', 'product', id] as const,
  variants: (org: string, id: string) =>
    ['org', org, 'catalog', 'product', id, 'variants'] as const,
  images: (org: string, id: string) => ['org', org, 'catalog', 'product', id, 'images'] as const,
  categories: (org: string) => ['org', org, 'catalog', 'categories'] as const,
  suppliers: (org: string, query: object) => ['org', org, 'catalog', 'suppliers', query] as const,
  supplier: (org: string, id: string) => ['org', org, 'catalog', 'supplier', id] as const,
  warehouses: (org: string, query: object) => ['org', org, 'catalog', 'warehouses', query] as const,
  warehouse: (org: string, id: string) => ['org', org, 'catalog', 'warehouse', id] as const,
};

/** A catalog write that refreshes the organization's catalog cache when it succeeds. */
function useCatalogMutation<TInput, TResult>(
  org: string,
  run: (input: TInput) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => client.invalidateQueries({ queryKey: catalogKeys.all(org) }),
  });
}

const json = (method: 'POST' | 'PATCH', body: unknown) => ({ method, body }) as const;

// ---- products -----------------------------------------------------------------------------------

export const useProducts = (org: string, query: Partial<ProductListQuery>) =>
  useQuery({
    queryKey: catalogKeys.products(org, query),
    queryFn: ({ signal }) =>
      api<Page<ProductSummary>>(`/products?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
  });

export const useProduct = (org: string, id: string, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.product(org, id),
    queryFn: ({ signal }) => api<ProductDetail>(`/products/${id}`, { signal }),
    enabled,
  });

export const useCreateProduct = (org: string) =>
  useCatalogMutation(org, (body: CreateProductRequest) =>
    api<ProductDetail>('/products', json('POST', body)),
  );

export const useUpdateProduct = (org: string, id: string) =>
  useCatalogMutation(org, (body: UpdateProductRequest) =>
    api<ProductDetail>(`/products/${id}`, json('PATCH', body)),
  );

export const useBulkProductStatus = (org: string) =>
  useCatalogMutation(org, (body: BulkProductStatusRequest) =>
    api<BulkProductStatusResult>('/products/bulk-status', json('POST', body)),
  );

// ---- variants -----------------------------------------------------------------------------------

export const useVariants = (org: string, productId: string, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.variants(org, productId),
    queryFn: ({ signal }) =>
      api<Page<Variant>>(`/products/${productId}/variants?pageSize=${PICK_LIST_SIZE}`, { signal }),
    enabled,
  });

export const useCreateVariant = (org: string, productId: string) =>
  useCatalogMutation(org, (body: CreateVariantRequest) =>
    api<Variant>(`/products/${productId}/variants`, json('POST', body)),
  );

export const useUpdateVariant = (org: string, productId: string) =>
  useCatalogMutation(org, ({ id, change }: { id: string; change: UpdateVariantRequest }) =>
    api<Variant>(`/products/${productId}/variants/${id}`, json('PATCH', change)),
  );

// ---- images -------------------------------------------------------------------------------------

export const useProductImages = (org: string, productId: string) =>
  useQuery({
    queryKey: catalogKeys.images(org, productId),
    queryFn: ({ signal }) => api<ProductImage[]>(`/products/${productId}/images`, { signal }),
    staleTime: IMAGE_URL_REFRESH_MS / 2,
    refetchInterval: IMAGE_URL_REFRESH_MS,
  });

export const useUploadImage = (org: string, productId: string) =>
  useCatalogMutation(org, ({ file, ...options }: UploadOptions & { file: File }) =>
    uploadProductImage(productId, file, options),
  );

export const useReorderImages = (org: string, productId: string) =>
  useCatalogMutation(org, (imageIds: string[]) =>
    api<ProductImage[]>(`/products/${productId}/images/reorder`, json('POST', { imageIds })),
  );

export const useUpdateImage = (org: string, productId: string) =>
  useCatalogMutation(org, ({ id, altText }: { id: string; altText: string | null }) =>
    api<ProductImage>(`/products/${productId}/images/${id}`, json('PATCH', { altText })),
  );

export const useDeleteImage = (org: string, productId: string) =>
  useCatalogMutation(org, (id: string) =>
    api<void>(`/products/${productId}/images/${id}`, { method: 'DELETE' }),
  );

// ---- categories ---------------------------------------------------------------------------------

export const useCategories = (org: string, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.categories(org),
    queryFn: ({ signal }) =>
      api<Page<Category>>(`/categories?pageSize=${PICK_LIST_SIZE}`, { signal }),
    enabled,
  });

export const useCreateCategory = (org: string) =>
  useCatalogMutation(org, (body: CreateCategoryRequest) =>
    api<Category>('/categories', json('POST', body)),
  );

export const useUpdateCategory = (org: string) =>
  useCatalogMutation(org, ({ id, change }: { id: string; change: UpdateCategoryRequest }) =>
    api<Category>(`/categories/${id}`, json('PATCH', change)),
  );

export const useDeleteCategory = (org: string) =>
  useCatalogMutation(org, (id: string) => api<void>(`/categories/${id}`, { method: 'DELETE' }));

// ---- suppliers ----------------------------------------------------------------------------------

export const useSuppliers = (org: string, query: Partial<SupplierListQuery>, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.suppliers(org, query),
    queryFn: ({ signal }) => api<Page<Supplier>>(`/suppliers?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useSupplier = (org: string, id: string, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.supplier(org, id),
    queryFn: ({ signal }) => api<Supplier>(`/suppliers/${id}`, { signal }),
    enabled,
  });

export const useCreateSupplier = (org: string) =>
  useCatalogMutation(org, (body: CreateSupplierRequest) =>
    api<Supplier>('/suppliers', json('POST', body)),
  );

export const useUpdateSupplier = (org: string, id: string) =>
  useCatalogMutation(org, (body: UpdateSupplierRequest) =>
    api<Supplier>(`/suppliers/${id}`, json('PATCH', body)),
  );

// ---- warehouses ---------------------------------------------------------------------------------

export const useWarehouses = (org: string, query: Partial<WarehouseListQuery>, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.warehouses(org, query),
    queryFn: ({ signal }) => api<Page<Warehouse>>(`/warehouses?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useWarehouse = (org: string, id: string) =>
  useQuery({
    queryKey: catalogKeys.warehouse(org, id),
    queryFn: ({ signal }) => api<Warehouse>(`/warehouses/${id}`, { signal }),
  });

export const useCreateWarehouse = (org: string) =>
  useCatalogMutation(org, (body: CreateWarehouseRequest) =>
    api<Warehouse>('/warehouses', json('POST', body)),
  );

export const useUpdateWarehouse = (org: string, id: string) =>
  useCatalogMutation(org, (body: UpdateWarehouseRequest) =>
    api<Warehouse>(`/warehouses/${id}`, json('PATCH', body)),
  );
