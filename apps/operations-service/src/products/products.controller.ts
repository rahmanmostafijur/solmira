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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  MAX_IMAGE_BYTES,
  bulkProductStatusRequestSchema,
  createProductRequestSchema,
  createVariantRequestSchema,
  productListQuerySchema,
  reorderImagesRequestSchema,
  updateImageRequestSchema,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  uploadImageFieldsSchema,
  variantListQuerySchema,
  type BulkProductStatusRequest,
  type BulkProductStatusResult,
  type CreateProductRequest,
  type CreateVariantRequest,
  type Page,
  type ProductDetail,
  type ProductImage,
  type ProductListQuery,
  type ProductSummary,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  type Variant,
  type VariantListQuery,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  type TenantAuthContext,
} from '@solmira/service-kit';
import type { z } from 'zod';
import { uuidParam } from '@solmira/service-kit';
import type { UploadedFile as UploadedImageFile } from '../storage/image-validation.js';
import { ProductImagesService } from './product-images.service.js';
import { ProductsService } from './products.service.js';
import { VariantsService } from './variants.service.js';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(VariantsService) private readonly variants: VariantsService,
    @Inject(ProductImagesService) private readonly images: ProductImagesService,
  ) {}

  // ---- products -------------------------------------------------------------------------------

  @Get()
  @RequirePermission('products.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<Page<ProductSummary>> {
    return this.products.list(auth, query);
  }

  @Post()
  @RequirePermission('products.create')
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createProductRequestSchema)) body: CreateProductRequest,
  ): Promise<ProductDetail> {
    return this.products.create(auth, body);
  }

  @Post('bulk-status')
  @RequirePermission('products.update')
  @HttpCode(HttpStatus.OK)
  bulkStatus(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(bulkProductStatusRequestSchema)) body: BulkProductStatusRequest,
  ): Promise<BulkProductStatusResult> {
    return this.products.bulkStatus(auth, body);
  }

  @Get(':id')
  @RequirePermission('products.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<ProductDetail> {
    return this.products.get(auth, id);
  }

  @Patch(':id')
  @RequirePermission('products.update')
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodValidationPipe(updateProductRequestSchema)) body: UpdateProductRequest,
  ): Promise<ProductDetail> {
    return this.products.update(auth, id, body);
  }

  @Delete(':id')
  @RequirePermission('products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.products.archive(auth, id);
  }

  // ---- variants -------------------------------------------------------------------------------

  @Get(':productId/variants')
  @RequirePermission('products.read')
  listVariants(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Query(new ZodValidationPipe(variantListQuerySchema)) query: VariantListQuery,
  ): Promise<Page<Variant>> {
    return this.variants.list(auth, productId, query);
  }

  @Post(':productId/variants')
  @RequirePermission('products.create')
  createVariant(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Body(new ZodValidationPipe(createVariantRequestSchema)) body: CreateVariantRequest,
  ): Promise<Variant> {
    return this.variants.create(auth, productId, body);
  }

  @Patch(':productId/variants/:variantId')
  @RequirePermission('products.update')
  updateVariant(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Param('variantId', uuidParam) variantId: string,
    @Body(new ZodValidationPipe(updateVariantRequestSchema)) body: UpdateVariantRequest,
  ): Promise<Variant> {
    return this.variants.update(auth, productId, variantId, body);
  }

  @Delete(':productId/variants/:variantId')
  @RequirePermission('products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  archiveVariant(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Param('variantId', uuidParam) variantId: string,
  ): Promise<void> {
    return this.variants.archive(auth, productId, variantId);
  }

  // ---- images ---------------------------------------------------------------------------------

  @Get(':productId/images')
  @RequirePermission('products.read')
  listImages(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
  ): Promise<ProductImage[]> {
    return this.images.list(auth, productId);
  }

  /** multipart/form-data with a `file` part. Held in memory (max 5 MB), validated, then stored. */
  @Post(':productId/images')
  @RequirePermission('products.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 } }),
  )
  uploadImage(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body(new ZodValidationPipe(uploadImageFieldsSchema))
    fields: z.infer<typeof uploadImageFieldsSchema>,
  ): Promise<ProductImage> {
    return this.images.upload(auth, productId, file, fields.altText);
  }

  @Post(':productId/images/reorder')
  @RequirePermission('products.update')
  @HttpCode(HttpStatus.OK)
  reorderImages(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Body(new ZodValidationPipe(reorderImagesRequestSchema))
    body: z.infer<typeof reorderImagesRequestSchema>,
  ): Promise<ProductImage[]> {
    return this.images.reorder(auth, productId, body.imageIds);
  }

  @Patch(':productId/images/:imageId')
  @RequirePermission('products.update')
  updateImage(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Param('imageId', uuidParam) imageId: string,
    @Body(new ZodValidationPipe(updateImageRequestSchema))
    body: z.infer<typeof updateImageRequestSchema>,
  ): Promise<ProductImage> {
    return this.images.updateAltText(auth, productId, imageId, body.altText ?? null);
  }

  @Delete(':productId/images/:imageId')
  @RequirePermission('products.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('productId', uuidParam) productId: string,
    @Param('imageId', uuidParam) imageId: string,
  ): Promise<void> {
    return this.images.delete(auth, productId, imageId);
  }
}
