import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

bootstrap();
