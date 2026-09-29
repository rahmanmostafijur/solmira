import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * Validates and narrows a request part with a zod schema: `@Body(new ZodValidationPipe(schema))`.
 * `z.object` strips unknown keys, which is also the mass-assignment defence: a client cannot
 * smuggle `organizationId` or `role` into a payload the schema does not declare.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
