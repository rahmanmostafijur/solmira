import { ZodValidationPipe } from './zod-validation.pipe.js';
import { z } from 'zod';

/** Path ids must be UUIDs: malformed ids are a 400, never a database error. */
export const uuidParam = new ZodValidationPipe(z.uuid());
