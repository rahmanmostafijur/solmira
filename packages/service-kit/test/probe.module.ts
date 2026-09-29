import { Body, Controller, Get, Module, Post, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';
import { NotFoundError } from '../src/errors/app-error.js';
import { PlatformModule, type PlatformOptions } from '../src/platform.module.js';
import { ZodValidationPipe } from '../src/validation/zod-validation.pipe.js';

const createThingSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
});

/** Minimal controller that exercises the platform's error, validation and context behaviour. */
@Controller('probe')
class ProbeController {
  @Get('missing')
  missing(): never {
    throw new NotFoundError('Order not found');
  }

  @Get('crash')
  crash(): never {
    throw new Error(
      'connect ECONNREFUSED 10.1.2.3:5432 password authentication failed for "admin"',
    );
  }

  @Post('things')
  create(@Body(new ZodValidationPipe(createThingSchema)) body: z.infer<typeof createThingSchema>) {
    return body;
  }
}

@Module({})
export class ProbeModule {
  static register(platform: PlatformOptions): DynamicModule {
    return {
      module: ProbeModule,
      imports: [PlatformModule.forRoot(platform)],
      controllers: [ProbeController],
    };
  }
}
