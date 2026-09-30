/**
 * Integration event envelope and the identity events emitted in phase 2. Events are written to
 * the producing service's outbox in the same transaction as the change; the relay that publishes
 * them to RabbitMQ arrives with the event backbone in phase 7.
 */
export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  readonly eventId: string;
  readonly type: TType;
  readonly version: number;
  readonly occurredAt: string;
  readonly organizationId: string | null;
  readonly actorId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly payload: TPayload;
}

export interface IdentityEventPayloads {
  'user.registered': { userId: string };
  'user.logged_in': { userId: string; sessionId: string };
  'user.logged_out': { userId: string; sessionId: string };
  'user.password_reset': { userId: string };
  'user.email_verified': { userId: string };
  'session.revoked': {
    userId: string;
    sessionId: string;
    reason:
      'logout' | 'user_request' | 'refresh_token_reuse' | 'password_reset' | 'account_disabled';
  };
  'organization.created': { organizationId: string; name: string; ownerUserId: string };
  'organization.updated': { organizationId: string; fields: string[] };
  'member.invited': { invitationId: string; email: string; role: string };
  'member.joined': { memberId: string; userId: string; role: string };
  'member.role_changed': { memberId: string; userId: string; fromRole: string; toRole: string };
  'member.status_changed': { memberId: string; userId: string; status: string };
  'member.removed': { memberId: string; userId: string };
}

export type IdentityEventType = keyof IdentityEventPayloads;

/**
 * Catalog master-data events (operations-service). Recorded in the outbox in the same
 * transaction as the change; inventory, analytics and audit consume them from phase 7.
 */
export interface CatalogEventPayloads {
  'category.created': { categoryId: string; name: string; parentId: string | null };
  'category.updated': { categoryId: string; fields: string[] };
  'category.deleted': { categoryId: string };
  'product.created': { productId: string; name: string; status: string };
  'product.updated': { productId: string; fields: string[] };
  'product.status_changed': { productId: string; fromStatus: string; toStatus: string };
  'variant.created': { productId: string; variantId: string; sku: string };
  'variant.updated': { productId: string; variantId: string; fields: string[] };
  'variant.status_changed': {
    productId: string;
    variantId: string;
    fromStatus: string;
    toStatus: string;
  };
  'product_image.added': { productId: string; imageId: string };
  'product_image.removed': { productId: string; imageId: string };
  'supplier.created': { supplierId: string; companyName: string };
  'supplier.updated': { supplierId: string; fields: string[] };
  'supplier.status_changed': { supplierId: string; fromStatus: string; toStatus: string };
  'warehouse.created': { warehouseId: string; code: string };
  'warehouse.updated': { warehouseId: string; fields: string[] };
  'warehouse.status_changed': { warehouseId: string; fromStatus: string; toStatus: string };
}

export type CatalogEventType = keyof CatalogEventPayloads;

/**
 * Inventory events (operations-service), recorded in the same transaction as the ledger rows
 * they describe. Quantities are whole units; `*After` values are the balances after the change.
 */
export interface InventoryEventPayloads {
  'inventory.adjusted': {
    inventoryLevelId: string;
    warehouseId: string;
    variantId: string;
    reason: string;
    quantityChange: number;
    onHandAfter: number;
  };
  'inventory.transferred': {
    transferId: string;
    variantId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
  };
  'inventory.reserved': {
    reference: string;
    reservations: {
      reservationId: string;
      warehouseId: string;
      variantId: string;
      quantity: number;
    }[];
  };
  'inventory.released': {
    reservationId: string;
    warehouseId: string;
    variantId: string;
    quantity: number;
  };
  /** Emitted when available stock falls to or below the reorder point (on the crossing only). */
  'inventory.low_stock': {
    inventoryLevelId: string;
    warehouseId: string;
    variantId: string;
    available: number;
    reorderPoint: number;
  };
}

export type InventoryEventType = keyof InventoryEventPayloads;

/** Purchasing events (operations-service); totals are minor units in the order's currency. */
export interface PurchasingEventPayloads {
  'purchase_order.created': { purchaseOrderId: string; number: string; supplierId: string };
  'purchase_order.updated': { purchaseOrderId: string; fields: string[] };
  'purchase_order.submitted': {
    purchaseOrderId: string;
    number: string;
    total: number;
    currency: string;
  };
  'purchase_order.approved': { purchaseOrderId: string; number: string; approvedBy: string };
  'purchase_order.cancelled': {
    purchaseOrderId: string;
    number: string;
    fromStatus: string;
    reason: string;
  };
  'purchase_order.partially_received': {
    purchaseOrderId: string;
    number: string;
    receiptId: string;
  };
  'purchase_order.received': { purchaseOrderId: string; number: string; receiptId: string };
  /** Stock that arrived through a purchase receipt; one event per receipt. */
  'inventory.received': {
    receiptId: string;
    purchaseOrderId: string;
    warehouseId: string;
    lines: { variantId: string; quantity: number; inventoryLevelId: string }[];
  };
}

/** Everything operations-service writes to its outbox. */
export type OperationsEventPayloads = CatalogEventPayloads &
  InventoryEventPayloads &
  PurchasingEventPayloads;
export type OperationsEventType = keyof OperationsEventPayloads;
