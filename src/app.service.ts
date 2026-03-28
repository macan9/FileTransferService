import 'dotenv/config';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { access, readdir, stat, unlink } from 'fs/promises';
import { constants } from 'fs';
import { resolve } from 'path';
import {
  SINGLE_FILE_SIZE_LIMIT_BYTES,
  UPLOADS_TOTAL_SIZE_LIMIT_BYTES,
} from './file.constants';
import { HTTP_TRANSFER_RATE_LIMIT_BYTES_PER_SECOND } from './bandwidth.constants';
import { normalizeUploadedFilename } from './file-name.util';

const DEFAULT_FILE_RETENTION_DAYS = 7;
const DEFAULT_FILE_CLEANUP_CRON = '0 0 * * * *';
const uploadDir = resolve(process.cwd(), 'uploads');

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);
  private readonly prisma = new PrismaClient({
    adapter: new PrismaLibSql({
      url: process.env.DATABASE_URL ?? 'file:./dev.db',
    }),
  });

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log(
      `Expired file cleanup ${
        this.isCleanupEnabled() ? 'enabled' : 'disabled'
      }, cron="${this.getCleanupCronExpression()}", retentionDays=${this.getRetentionDays()}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  getHello() {
    return {
      message: 'File transfer service is running',
      endpoints: {
        upload: 'POST /files/upload',
        httpUploadDemo: 'GET /http-upload.html',
        list: 'GET /files',
        download: 'GET /files/:id/download',
        delete: 'DELETE /files/:id',
        onlineUsers: 'GET /signaling/online-users',
        websocket: 'WS /signaling',
        webrtcDemo: 'GET /webrtc-test.html',
      },
      cleanup: {
        enabled: this.isCleanupEnabled(),
        cron: this.getCleanupCronExpression(),
        retentionDays: this.getRetentionDays(),
      },
    };
  }

  async createFileRecord(file: Express.Multer.File) {
    if (file.size > SINGLE_FILE_SIZE_LIMIT_BYTES) {
      await this.removePhysicalFile(file.path);
      throw new PayloadTooLargeException(
        'Single file size must not exceed 200 MB.',
      );
    }

    const uploadsSize = await this.getUploadsDirectorySize();

    if (uploadsSize > UPLOADS_TOTAL_SIZE_LIMIT_BYTES) {
      await this.removePhysicalFile(file.path);
      throw new PayloadTooLargeException(
        'Server storage limit reached, please free up space and try again.',
      );
    }

    try {
      const created = await this.prisma.fileRecord.create({
        data: {
          originalName: normalizeUploadedFilename(file.originalname),
          filename: file.filename,
          mimeType: file.mimetype,
          size: file.size,
          storagePath: file.path,
          url: '',
        },
      });

      return this.prisma.fileRecord.update({
        where: { id: created.id },
        data: {
          url: `/files/${created.id}/download`,
        },
      });
    } catch (error) {
      await this.removePhysicalFile(file.path);
      throw error;
    }
  }

  async getFiles() {
    const records = await this.prisma.fileRecord.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return records.map((record) => ({
      ...record,
      originalName: normalizeUploadedFilename(record.originalName),
      url: `/files/${record.id}/download`,
    }));
  }

  async getFileById(id: number) {
    const fileRecord = await this.prisma.fileRecord.findUnique({
      where: { id },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File with id ${id} not found`);
    }

    return {
      ...fileRecord,
      originalName: normalizeUploadedFilename(fileRecord.originalName),
    };
  }

  async ensureFileExists(storagePath: string) {
    try {
      await access(storagePath, constants.F_OK);
    } catch {
      throw new NotFoundException('File content does not exist on disk');
    }
  }

  async getUploadLimits() {
    const currentUsageBytes = await this.getUploadsDirectorySize();

    return {
      singleFileLimitBytes: SINGLE_FILE_SIZE_LIMIT_BYTES,
      totalUploadsLimitBytes: UPLOADS_TOTAL_SIZE_LIMIT_BYTES,
      currentUsageBytes,
      remainingBytes: Math.max(
        UPLOADS_TOTAL_SIZE_LIMIT_BYTES - currentUsageBytes,
        0,
      ),
      transferRateLimitBytesPerSecond: HTTP_TRANSFER_RATE_LIMIT_BYTES_PER_SECOND,
    };
  }

  async deleteFileById(id: number) {
    const fileRecord = await this.getFileById(id);
    await this.removePhysicalFile(fileRecord.storagePath);

    await this.prisma.fileRecord.delete({
      where: { id },
    });

    return {
      id: fileRecord.id,
      filename: fileRecord.filename,
      deleted: true,
    };
  }

  @Cron(process.env.FILE_CLEANUP_CRON ?? DEFAULT_FILE_CLEANUP_CRON)
  async cleanExpiredFiles() {
    if (!this.isCleanupEnabled()) {
      return;
    }

    const retentionDays = this.getRetentionDays();

    if (retentionDays <= 0) {
      this.logger.warn('Expired file cleanup skipped because retentionDays <= 0');
      return;
    }

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expiredFiles = await this.prisma.fileRecord.findMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (expiredFiles.length === 0) {
      this.logger.debug('Expired file cleanup found no expired files');
      return;
    }

    let deletedCount = 0;

    for (const expiredFile of expiredFiles) {
      try {
        await this.removePhysicalFile(expiredFile.storagePath);
        await this.prisma.fileRecord.delete({
          where: { id: expiredFile.id },
        });
        deletedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to clean expired file id=${expiredFile.id}, filename=${expiredFile.filename}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Expired file cleanup finished. Removed ${deletedCount}/${expiredFiles.length} expired file(s)`,
    );
  }

  private async removePhysicalFile(storagePath: string) {
    try {
      await unlink(storagePath);
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw fileError;
      }
    }
  }

  private async getUploadsDirectorySize() {
    try {
      const entries = await readdir(uploadDir, { withFileTypes: true });
      let totalSize = 0;

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const entryPath = resolve(uploadDir, entry.name);
        const entryStat = await stat(entryPath);
        totalSize += entryStat.size;
      }

      return totalSize;
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code === 'ENOENT') {
        return 0;
      }

      throw new BadRequestException(
        'Unable to inspect server storage usage, please try again later.',
      );
    }
  }

  private isCleanupEnabled() {
    const rawValue = this.configService.get<string>('FILE_CLEANUP_ENABLED');

    if (!rawValue) {
      return true;
    }

    return rawValue.toLowerCase() !== 'false';
  }

  private getRetentionDays() {
    const rawValue = this.configService.get<string>('FILE_RETENTION_DAYS');
    const retentionDays = Number(rawValue ?? DEFAULT_FILE_RETENTION_DAYS);

    if (!Number.isFinite(retentionDays)) {
      return DEFAULT_FILE_RETENTION_DAYS;
    }

    return retentionDays;
  }

  private getCleanupCronExpression() {
    return (
      this.configService.get<string>('FILE_CLEANUP_CRON') ?? DEFAULT_FILE_CLEANUP_CRON
    );
  }
}
