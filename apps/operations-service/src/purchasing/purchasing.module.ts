import { Module } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseOrdersController, SupplierPurchasingController } from './purchasing.controller.js';
import { ReceivingService } from './receiving.service.js';

/**
 * Purchase orders, approval and receiving (phase 5). Receiving adds stock through the inventory
 * ledger in the same transaction as the receipt, which is why purchasing lives in
 * operations-service next to inventory rather than in a service of its own.
 */
@Module({
  controllers: [PurchaseOrdersController, SupplierPurchasingController],
  providers: [PurchaseOrdersService, ReceivingService],
})
export class PurchasingModule {}
