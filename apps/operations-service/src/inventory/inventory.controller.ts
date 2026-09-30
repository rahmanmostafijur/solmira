import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adjustStockRequestSchema,
  inventoryLevelListQuerySchema,
  inventoryMovementListQuerySchema,
  reservationListQuerySchema,
  reserveStockRequestSchema,
  transferStockRequestSchema,
  updateInventoryLevelRequestSchema,
  type AdjustStockRequest,
  type InventoryLevel,
  type InventoryLevelListQuery,
  type InventoryMovement,
  type InventoryMovementListQuery,
  type Page,
  type ReservationListQuery,
  type ReserveStockRequest,
  type StockReservation,
  type StockTransferResult,
  type TransferStockRequest,
  type UpdateInventoryLevelRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { uuidParam } from '../common/pipes.js';
import { InventoryLevelsService } from './inventory-levels.service.js';
import { ReservationsService } from './reservations.service.js';
import { StockService } from './stock.service.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryLevelsService) private readonly levels: InventoryLevelsService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
  ) {}

  // ---- levels and ledger ----------------------------------------------------------------------

  @Get('levels')
  @RequirePermission('inventory.read')
  listLevels(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(inventoryLevelListQuerySchema)) query: InventoryLevelListQuery,
  ): Promise<Page<InventoryLevel>> {
    return this.levels.list(auth, query);
  }

  @Get('levels/:id')
  @RequirePermission('inventory.read')
  getLevel(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<InventoryLevel> {
    return this.levels.get(auth, id);
  }

  @Patch('levels/:id')
  @RequirePermission('inventory.adjust')
  updateLevel(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateInventoryLevelRequestSchema))
    body: UpdateInventoryLevelRequest,
  ): Promise<InventoryLevel> {
    return this.levels.updateReorderPoint(auth, id, body);
  }

  @Get('movements')
  @RequirePermission('inventory.read')
  listMovements(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(inventoryMovementListQuerySchema))
    query: InventoryMovementListQuery,
  ): Promise<Page<InventoryMovement>> {
    return this.levels.movements(auth, query);
  }

  // ---- stock changes --------------------------------------------------------------------------

  @Post('adjustments')
  @RequirePermission('inventory.adjust')
  adjust(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(adjustStockRequestSchema)) body: AdjustStockRequest,
  ): Promise<InventoryLevel> {
    return this.stock.adjust(auth, body);
  }

  @Post('transfers')
  @RequirePermission('inventory.adjust')
  transfer(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(transferStockRequestSchema)) body: TransferStockRequest,
  ): Promise<StockTransferResult> {
    return this.stock.transfer(auth, body);
  }

  // ---- reservations ---------------------------------------------------------------------------

  @Get('reservations')
  @RequirePermission('inventory.read')
  listReservations(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(reservationListQuerySchema)) query: ReservationListQuery,
  ): Promise<Page<StockReservation>> {
    return this.reservations.list(auth, query);
  }

  @Post('reservations')
  @RequirePermission('inventory.reserve')
  reserve(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(reserveStockRequestSchema)) body: ReserveStockRequest,
  ): Promise<StockReservation[]> {
    return this.reservations.reserve(auth, body);
  }

  @Post('reservations/:id/release')
  @RequirePermission('inventory.reserve')
  @HttpCode(HttpStatus.OK)
  release(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<StockReservation> {
    return this.reservations.release(auth, id);
  }
}
