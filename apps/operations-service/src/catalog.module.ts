import { Module } from '@nestjs/common';
import { CategoriesController } from './categories/categories.controller.js';
import { CategoriesService } from './categories/categories.service.js';
import { MemberDirectoryService } from './members/member-directory.service.js';
import { ProductImagesService } from './products/product-images.service.js';
import { ProductsController } from './products/products.controller.js';
import { ProductsService } from './products/products.service.js';
import { VariantsService } from './products/variants.service.js';
import { SuppliersController } from './suppliers/suppliers.controller.js';
import { SuppliersService } from './suppliers/suppliers.service.js';
import { WarehousesController } from './warehouses/warehouses.controller.js';
import { WarehousesService } from './warehouses/warehouses.service.js';

/** Operational master data: catalog, suppliers and warehouses. Inventory builds on it. */
@Module({
  controllers: [
    CategoriesController,
    ProductsController,
    SuppliersController,
    WarehousesController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    VariantsService,
    ProductImagesService,
    SuppliersService,
    WarehousesService,
    MemberDirectoryService,
  ],
})
export class CatalogModule {}
