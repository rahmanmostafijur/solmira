import 'reflect-metadata';
import { bootstrapService, loadConfig, runService } from '@solmira/service-kit';
import { AppModule } from './app.module.js';
import { SERVICE_NAME, envSchema } from './config.js';

await runService(async () => {
  const config = loadConfig(envSchema);
  await bootstrapService(AppModule.register(config), {
    serviceName: SERVICE_NAME,
    port: config.PORT,
    nodeEnv: config.NODE_ENV,
    docs: {
      title: 'Solmira Audit API',
      description: 'Audit trail search and entity history.',
    },
  });
});
