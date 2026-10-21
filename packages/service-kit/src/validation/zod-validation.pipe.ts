import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { parseRequestPart, type ValidationTarget } from './field-issues.js';

/**
 * Validates and narrows a request part with a zod schema: `@Body(new ZodValidationPipe(schema))`.
 * `z.object` strips unknown keys, which is also the mass-assignment defence: a client cannot
 * smuggle `organizationId` or `role` into a payload the schema does not declare.
 * Errors name the field as the client sent it: a body path, a query parameter or a path parameter.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown, metadata?: ArgumentMetadata): z.output<S> {
    return parseRequestPart(this.schema, value, targetOf(metadata));
  }
}

function targetOf(metadata: ArgumentMetadata | undefined): ValidationTarget {
  const part = metadata?.type === 'query' || metadata?.type === 'param' ? metadata.type : 'body';
  return metadata?.data ? { part, name: metadata.data } : { part };
}
