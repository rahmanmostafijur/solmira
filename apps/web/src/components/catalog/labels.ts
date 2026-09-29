import {
  PRODUCT_STATUS_TRANSITIONS,
  VARIANT_STATUS_TRANSITIONS,
  type CategoryStatus,
  type PaymentTerms,
  type ProductStatus,
  type SupplierStatus,
  type TaxCategory,
  type VariantStatus,
  type WarehouseStatus,
} from '@solmira/contracts';
import type { BadgeTone } from '@/components/ui/badge';

interface StatusLabel {
  readonly label: string;
  readonly tone: BadgeTone;
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, StatusLabel> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'ok' },
  INACTIVE: { label: 'Inactive', tone: 'warn' },
  ARCHIVED: { label: 'Archived', tone: 'danger' },
};

export const VARIANT_STATUS_LABELS: Record<VariantStatus, StatusLabel> = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  INACTIVE: { label: 'Inactive', tone: 'warn' },
  ARCHIVED: { label: 'Archived', tone: 'danger' },
};

export const PARTNER_STATUS_LABELS: Record<SupplierStatus | WarehouseStatus, StatusLabel> = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};

export const CATEGORY_STATUS_LABELS: Record<CategoryStatus, StatusLabel> = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  PREPAID: 'Prepaid',
  COD: 'Cash on delivery',
  NET_15: 'Net 15 days',
  NET_30: 'Net 30 days',
  NET_45: 'Net 45 days',
  NET_60: 'Net 60 days',
  NET_90: 'Net 90 days',
};

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  STANDARD: 'Standard rate',
  REDUCED: 'Reduced rate',
  ZERO: 'Zero rate',
  EXEMPT: 'Exempt',
};

export interface StatusAction<S extends string> {
  readonly to: S;
  readonly label: string;
  readonly destructive: boolean;
}

const ACTION_VERBS: Record<string, string> = {
  ACTIVE: 'Activate',
  INACTIVE: 'Deactivate',
  ARCHIVED: 'Archive',
};

/** The buttons a status allows, straight from the shared transition table the API enforces. */
export function productStatusActions(from: ProductStatus): StatusAction<ProductStatus>[] {
  return PRODUCT_STATUS_TRANSITIONS[from].map((to) => ({
    to,
    label: from === 'ARCHIVED' ? 'Restore' : (ACTION_VERBS[to] ?? to),
    destructive: to === 'ARCHIVED',
  }));
}

export function variantStatusActions(from: VariantStatus): StatusAction<VariantStatus>[] {
  return VARIANT_STATUS_TRANSITIONS[from].map((to) => ({
    to,
    label: from === 'ARCHIVED' ? 'Restore' : (ACTION_VERBS[to] ?? to),
    destructive: to === 'ARCHIVED',
  }));
}

export function formatDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
