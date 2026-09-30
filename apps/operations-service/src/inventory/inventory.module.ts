import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryLevelsService } from './inventory-levels.service.js';
import { ReservationsService } from './reservations.service.js';
import { StockService } from './stock.service.js';

/**
 * Stock levels, the movement ledger, transfers and reservations (phase 4). Shares the operations
 * database and transaction boundary with the catalog, so order confirmation (phase 6) can reserve
 * stock atomically through the exported ReservationsService.
 */
@Module({
  controllers: [InventoryController],
  providers: [InventoryLevelsService, StockService, ReservationsService],
  exports: [ReservationsService],
})
export class InventoryModule {}
