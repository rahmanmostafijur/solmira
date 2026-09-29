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
  categoryListQuerySchema,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  type Category,
  type CategoryListQuery,
  type CreateCategoryRequest,
  type Page,
  type UpdateCategoryRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { uuidParam } from '../common/pipes.js';
import { CategoriesService } from './categories.service.js';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(@Inject(CategoriesService) private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('categories.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(categoryListQuerySchema)) query: CategoryListQuery,
  ): Promise<Page<Category>> {
    return this.categories.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('categories.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<Category> {
    return this.categories.get(auth, id);
  }

  @Post()
  @RequirePermission('categories.create')
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createCategoryRequestSchema)) body: CreateCategoryRequest,
  ): Promise<Category> {
    return this.categories.create(auth, body);
  }

  @Patch(':id')
  @RequirePermission('categories.update')
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateCategoryRequestSchema)) body: UpdateCategoryRequest,
  ): Promise<Category> {
    return this.categories.update(auth, id, body);
  }

  @Delete(':id')
  @RequirePermission('categories.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.categories.delete(auth, id);
  }
}
