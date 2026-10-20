import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

type BodySchema = NonNullable<
  Extract<Parameters<typeof ApiBody>[0], { schema?: unknown }>['schema']
>;

/** Documents a request body from the same zod schema that validates it, so the two cannot drift. */
export function ApiZodBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({
    schema: z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as BodySchema,
  });
}
