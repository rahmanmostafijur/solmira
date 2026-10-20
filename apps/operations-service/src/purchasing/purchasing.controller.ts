import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  IDEMPOTENCY_KEY_HEADER,
  addPurchaseOrderItemRequestSchema,
  cancelPurchaseOrderRequestSchema,
  createPurchaseOrderRequestSchema,
  idempotencyKeySchema,
  purchaseOrderListQuerySchema,
  receivePurchaseOrderRequestSchema,
  updatePurchaseOrderItemRequestSchema,
  updatePurchaseOrderRequestSchema,
  type CancelPurchaseOrderRequest,
  type CreatePurchaseOrder,
  type Page,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderListQuery,
  type PurchaseOrderSummary,
  type PurchaseReceipt,
  type PurchaseReceiptResult,
  type ReceivePurchaseOrderRequest,
  type SupplierPurchasingSummary,
  type UpdatePurchaseOrderItemRequest,
  type UpdatePurchaseOrderRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ValidationError,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import type { Response } from 'express';
import { uuidParam } from '@solmira/service-kit';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { ReceivingService } from './receiving.service.js';

function idempotencyKeyOf(value: string | undefined): string {
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success)
    throw new ValidationError([
      { path: 'Idempotency-Key', message: parsed.error.issues[0]?.message ?? 'Invalid key' },
    ]);
  return parsed.data;
}

/**
 * Workflow steps are explicit actions (submit, approve, cancel, receipts), not status fields in a
 * PATCH: each has its own permission, its own rules and its own event, and the URL says what the
 * caller intends.
 */
@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(ReceivingService) private readonly receiving: ReceivingService,
  ) {}

  @Get()
  @RequirePermission('purchase_orders.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema)) query: PurchaseOrderListQuery,
  ): Promise<Page<PurchaseOrderSummary>> {
    return this.orders.list(auth, query);
  }

  @Post()
  @RequirePermission('purchase_orders.create')
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createPurchaseOrderRequestSchema)) body: CreatePurchaseOrder,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('purchase_orders.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.get(auth, id);
  }

  @Patch(':id')
  @RequirePermission('purchase_orders.update')
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderRequestSchema)) body: UpdatePurchaseOrderRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.update(auth, id, body);
  }

  // ---- lines (drafts only) --------------------------------------------------------------------

  @Post(':id/items')
  @RequirePermission('purchase_orders.update')
  addItem(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(addPurchaseOrderItemRequestSchema)) body: PurchaseOrderLine,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.addItem(auth, id, body);
  }

  @Patch(':id/items/:itemId')
  @RequirePermission('purchase_orders.update')
  updateItem(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Param('itemId', uuidParam) itemId: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderItemRequestSchema))
    body: UpdatePurchaseOrderItemRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.updateItem(auth, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @RequirePermission('purchase_orders.update')
  removeItem(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Param('itemId', uuidParam) itemId: string,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.removeItem(auth, id, itemId);
  }

  // ---- workflow -------------------------------------------------------------------------------

  @Post(':id/submit')
  @RequirePermission('purchase_orders.submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.submit(auth, id);
  }

  @Post(':id/approve')
  @RequirePermission('purchase_orders.approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.approve(auth, id);
  }

  @Post(':id/cancel')
  @RequirePermission('purchase_orders.cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(cancelPurchaseOrderRequestSchema)) body: CancelPurchaseOrderRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.orders.cancel(auth, id, body);
  }

  // ---- receiving ------------------------------------------------------------------------------

  @Get(':id/receipts')
  @RequirePermission('purchase_orders.read')
  listReceipts(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<PurchaseReceipt[]> {
    return this.receiving.listReceipts(auth, id);
  }

  /** 201 for a new receipt, 200 when the Idempotency-Key replays one that already exists. */
  @Post(':id/receipts')
  @RequirePermission('purchase_orders.receive')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async receive(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(receivePurchaseOrderRequestSchema))
    body: ReceivePurchaseOrderRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PurchaseReceiptResult> {
    const result = await this.receiving.receive(auth, id, body, idempotencyKeyOf(key));
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }
}

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SupplierPurchasingController {
  constructor(@Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService) {}

  @Get(':id/purchasing-summary')
  @RequirePermission('suppliers.read', 'purchase_orders.read')
  summary(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<SupplierPurchasingSummary> {
    return this.orders.supplierSummary(auth, id);
  }
}
