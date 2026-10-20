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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createWarehouseRequestSchema,
  updateWarehouseRequestSchema,
  warehouseListQuerySchema,
  type CreateWarehouseRequest,
  type Page,
  type UpdateWarehouseRequest,
  type Warehouse,
  type WarehouseListQuery,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import type { Request } from 'express';
import { bearerTokenOf } from '../common/bearer.js';
import { uuidParam } from '@solmira/service-kit';
import { WarehousesService } from './warehouses.service.js';

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(@Inject(WarehousesService) private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermission('warehouses.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(warehouseListQuerySchema)) query: WarehouseListQuery,
  ): Promise<Page<Warehouse>> {
    return this.warehouses.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('warehouses.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<Warehouse> {
    return this.warehouses.get(auth, id);
  }

  @Post()
  @RequirePermission('warehouses.create')
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Req() request: Request,
    @Body(new ZodValidationPipe(createWarehouseRequestSchema)) body: CreateWarehouseRequest,
  ): Promise<Warehouse> {
    return this.warehouses.create(auth, body, bearerTokenOf(request));
  }

  @Patch(':id')
  @RequirePermission('warehouses.update')
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Req() request: Request,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateWarehouseRequestSchema)) body: UpdateWarehouseRequest,
  ): Promise<Warehouse> {
    return this.warehouses.update(auth, id, body, bearerTokenOf(request));
  }

  @Delete(':id')
  @RequirePermission('warehouses.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(
    @CurrentAuth() auth: TenantAuthContext,
    @Req() request: Request,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.warehouses.deactivate(auth, id, bearerTokenOf(request));
  }
}
