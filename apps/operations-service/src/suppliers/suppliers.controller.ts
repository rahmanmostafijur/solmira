import {
  Body,
  Controller,
  Delete,
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
  createSupplierRequestSchema,
  productListQuerySchema,
  supplierListQuerySchema,
  updateSupplierRequestSchema,
  type CreateSupplierRequest,
  type Page,
  type ProductListQuery,
  type ProductSummary,
  type Supplier,
  type SupplierListQuery,
  type UpdateSupplierRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { uuidParam } from '@solmira/service-kit';
import { ProductsService } from '../products/products.service.js';
import { SuppliersService } from './suppliers.service.js';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  @Get()
  @RequirePermission('suppliers.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(supplierListQuerySchema)) query: SupplierListQuery,
  ): Promise<Page<Supplier>> {
    return this.suppliers.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('suppliers.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<Supplier> {
    return this.suppliers.get(auth, id);
  }

  /** The supplier's products, through the same filtered, paginated product list. */
  @Get(':id/products')
  @RequirePermission('suppliers.read', 'products.read')
  async listProducts(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<Page<ProductSummary>> {
    await this.suppliers.get(auth, id);
    return this.products.list(auth, { ...query, supplierId: id });
  }

  @Post()
  @RequirePermission('suppliers.create')
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createSupplierRequestSchema)) body: CreateSupplierRequest,
  ): Promise<Supplier> {
    return this.suppliers.create(auth, body);
  }

  @Patch(':id')
  @RequirePermission('suppliers.update')
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateSupplierRequestSchema)) body: UpdateSupplierRequest,
  ): Promise<Supplier> {
    return this.suppliers.update(auth, id, body);
  }

  @Delete(':id')
  @RequirePermission('suppliers.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.suppliers.deactivate(auth, id);
  }
}
