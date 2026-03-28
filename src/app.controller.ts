import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { AppService } from './app.service';

const uploadDir = resolve(process.cwd(), 'uploads');

const storage = diskStorage({
  destination: (_req, _file, callback) => {
    mkdirSync(uploadDir, { recursive: true });
    callback(null, uploadDir);
  },
  filename: (_req, file, callback) => {
    const extension = extname(file.originalname);
    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  },
});

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Get('files')
  async getFiles() {
    return this.appService.getFiles();
  }

  @Get('files/:id/download')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const fileRecord = await this.appService.getFileById(id);
    await this.appService.ensureFileExists(fileRecord.storagePath);

    return res.download(fileRecord.storagePath, fileRecord.originalName);
  }

  @Delete('files/:id')
  async deleteFile(@Param('id', ParseIntPipe) id: number) {
    return this.appService.deleteFileById(id);
  }

  @Post('files/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage,
      limits: {
        fileSize: 20 * 1024 * 1024,
      },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname) {
          callback(new BadRequestException('Invalid file name'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({
          maxSize: 20 * 1024 * 1024,
        })
        .build({
          fileIsRequired: true,
        }),
    )
    file: Express.Multer.File,
  ) {
    const saved = await this.appService.createFileRecord(file);

    return {
      id: saved.id,
      originalName: saved.originalName,
      filename: saved.filename,
      mimeType: saved.mimeType,
      size: saved.size,
      url: saved.url,
      createdAt: saved.createdAt,
    };
  }
}
