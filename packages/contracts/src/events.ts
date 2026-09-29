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
