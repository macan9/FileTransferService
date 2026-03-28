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
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { Response } from 'express';
import { AppService } from './app.service';
import { SINGLE_FILE_SIZE_LIMIT_BYTES } from './file.constants';
import { HTTP_TRANSFER_RATE_LIMIT_BYTES_PER_SECOND } from './bandwidth.constants';
import {
  buildAttachmentContentDisposition,
  normalizeUploadedFilename,
} from './file-name.util';
import { RateLimitTransform } from './rate-limit.transform';
import { RateLimitedDiskStorage } from './rate-limited-storage';

const uploadDir = `${process.cwd()}\\uploads`;
const storage = new RateLimitedDiskStorage(
  uploadDir,
  HTTP_TRANSFER_RATE_LIMIT_BYTES_PER_SECOND,
);

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

  @Get('files/trash')
  async getTrashFiles() {
    return this.appService.getTrashFiles();
  }

  @Get('files/limits')
  async getFileLimits() {
    return this.appService.getUploadLimits();
  }

  @Get('files/:id/download')
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const fileRecord = await this.appService.getFileById(id);
    await this.appService.ensureFileExists(fileRecord.storagePath);
    const fileStat = await stat(fileRecord.storagePath);

    res.setHeader('Content-Type', fileRecord.mimeType);
    res.setHeader(
      'Content-Disposition',
      buildAttachmentContentDisposition(fileRecord.originalName),
    );
    res.setHeader('Content-Length', fileStat.size.toString());

    return createReadStream(fileRecord.storagePath)
      .pipe(new RateLimitTransform(HTTP_TRANSFER_RATE_LIMIT_BYTES_PER_SECOND))
      .pipe(res);
  }

  @Delete('files/trash/:id')
  async permanentlyDeleteTrashFile(@Param('id', ParseIntPipe) id: number) {
    return this.appService.permanentlyDeleteTrashFileById(id);
  }

  @Post('files/trash/:id/restore')
  async restoreTrashFile(@Param('id', ParseIntPipe) id: number) {
    return this.appService.restoreTrashFileById(id);
  }

  @Delete('files/trash')
  async emptyTrash() {
    return this.appService.emptyTrash();
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
        fileSize: SINGLE_FILE_SIZE_LIMIT_BYTES,
      },
      fileFilter: (_req, file, callback) => {
        if (!file.originalname) {
          callback(
            new BadRequestException(
              'Invalid file name, please choose the file again.',
            ),
            false,
          );
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
          maxSize: SINGLE_FILE_SIZE_LIMIT_BYTES,
        })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: 413,
        }),
    )
    file: Express.Multer.File,
  ) {
    const saved = await this.appService.createFileRecord(file);
    const originalName = normalizeUploadedFilename(saved.originalName);

    return {
      id: saved.id,
      originalName,
      filename: saved.filename,
      mimeType: saved.mimeType,
      size: saved.size,
      url: saved.url,
      createdAt: saved.createdAt,
    };
  }
}
