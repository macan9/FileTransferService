import { BadRequestException } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import { normalizeUploadedFilename } from './file-name.util';
import { RateLimitTransform } from './rate-limit.transform';

type FileCallback = (
  error?: Error | null,
  info?: Partial<Express.Multer.File>,
) => void;

export class RateLimitedDiskStorage implements StorageEngine {
  constructor(
    private readonly destination: string,
    private readonly bytesPerSecond: number,
  ) {}

  _handleFile(
    _req: Request,
    file: Express.Multer.File & { stream: NodeJS.ReadableStream },
    callback: FileCallback,
  ) {
    void this.storeFile(file, callback);
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File & { path?: string },
    callback: (error: Error | null) => void,
  ) {
    if (!file.path) {
      callback(null);
      return;
    }

    void unlink(file.path)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      })
      .then(() => callback(null))
      .catch((error: Error) => callback(error));
  }

  private async storeFile(
    file: Express.Multer.File & { stream: NodeJS.ReadableStream },
    callback: FileCallback,
  ) {
    try {
      await mkdir(this.destination, { recursive: true });

      if (!file.originalname) {
        throw new BadRequestException('Invalid file name');
      }

      const normalizedOriginalName = normalizeUploadedFilename(file.originalname);
      const extension = extname(normalizedOriginalName);
      const filename = `${Date.now()}-${randomUUID()}${extension}`;
      const storagePath = resolve(this.destination, filename);
      const rateLimitTransform = new RateLimitTransform(this.bytesPerSecond);
      const output = createWriteStream(storagePath);

      await pipeline(file.stream, rateLimitTransform, output);

      callback(null, {
        destination: this.destination,
        filename,
        path: storagePath,
        size: output.bytesWritten,
      });
    } catch (error) {
      callback(error as Error);
    }
  }
}
