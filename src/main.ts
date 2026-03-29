import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const uploadDir = resolve(process.cwd(), 'uploads');
  const publicDir = resolve(process.cwd(), 'public');

  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useStaticAssets(uploadDir, {
    prefix: '/uploads/',
  });

  app.useStaticAssets(publicDir);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  console.log(`File transfer service started at http://localhost:${port}`);
}

bootstrap().catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    const port = Number(process.env.PORT ?? 3000);
    console.error(
      `Port ${port} is already in use. Stop the existing process or set a different PORT before starting the service again.`,
    );
    process.exit(1);
  }

  console.error('Failed to start file transfer service.', error);
  process.exit(1);
});
