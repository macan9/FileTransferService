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

const DEFAULT_TRASH_RETENTION_DAYS = 30;
const DEFAULT_TRASH_CLEANUP_CRON = '0 0 * * * *';
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
      `Trash cleanup ${
        this.isTrashCleanupEnabled() ? 'enabled' : 'disabled'
      }, cron="${this.getTrashCleanupCronExpression()}", retentionDays=${this.getTrashRetentionDays()}`,
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
        trashList: 'GET /files/trash',
        download: 'GET /files/:id/download',
        delete: 'DELETE /files/:id',
        permanentlyDeleteTrashItem: 'DELETE /files/trash/:id',
        restoreTrashItem: 'POST /files/trash/:id/restore',
        emptyTrash: 'DELETE /files/trash',
        onlineUsers: 'GET /signaling/online-users',
        websocket: 'WS /signaling',
        webrtcDemo: 'GET /webrtc-test.html',
      },
      trashCleanup: {
        enabled: this.isTrashCleanupEnabled(),
        cron: this.getTrashCleanupCronExpression(),
        retentionDays: this.getTrashRetentionDays(),
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
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return records.map((record) => this.serializeFileRecord(record));
  }

  async getTrashFiles() {
    const records = await this.prisma.fileRecord.findMany({
      where: {
        deletedAt: {
          not: null,
        },
      },
      orderBy: {
        deletedAt: 'desc',
      },
    });

    return records.map((record) => this.serializeFileRecord(record));
  }

  async getFileById(id: number) {
    const fileRecord = await this.prisma.fileRecord.findUnique({
      where: { id },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File with id ${id} not found`);
    }

    if (fileRecord.deletedAt) {
      throw new NotFoundException(`File with id ${id} not found`);
    }

    return this.serializeFileRecord(fileRecord);
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

    const deletedAt = new Date();
    const deletedRecord = await this.prisma.fileRecord.update({
      where: { id },
      data: {
        deletedAt,
      },
    });

    return {
      ...this.serializeFileRecord(deletedRecord),
      message: 'File moved to trash.',
      deleted: true,
    };
  }

  async permanentlyDeleteTrashFileById(id: number) {
    const fileRecord = await this.getTrashFileById(id);
    await this.removePhysicalFile(fileRecord.storagePath);

    await this.prisma.fileRecord.delete({
      where: { id },
    });

    return {
      id: fileRecord.id,
      originalName: fileRecord.originalName,
      filename: fileRecord.filename,
      permanentlyDeleted: true,
    };
  }

  async restoreTrashFileById(id: number) {
    const fileRecord = await this.getTrashFileById(id);
    await this.ensureFileExists(fileRecord.storagePath);

    const restoredRecord = await this.prisma.fileRecord.update({
      where: { id },
      data: {
        deletedAt: null,
      },
    });

    return {
      ...this.serializeFileRecord(restoredRecord),
      restored: true,
      message: 'File restored from trash.',
    };
  }

  async emptyTrash() {
    const trashFiles = await this.prisma.fileRecord.findMany({
      where: {
        deletedAt: {
          not: null,
        },
      },
      orderBy: {
        deletedAt: 'asc',
      },
    });

    if (trashFiles.length === 0) {
      return {
        cleared: true,
        deletedCount: 0,
      };
    }

    let deletedCount = 0;

    for (const trashFile of trashFiles) {
      try {
        await this.removePhysicalFile(trashFile.storagePath);
        await this.prisma.fileRecord.delete({
          where: { id: trashFile.id },
        });
        deletedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to permanently delete trash file id=${trashFile.id}, filename=${trashFile.filename}: ${message}`,
        );
      }
    }

    return {
      cleared: true,
      deletedCount,
      totalCount: trashFiles.length,
    };
  }

  @Cron(process.env.FILE_TRASH_CLEANUP_CRON ?? process.env.FILE_CLEANUP_CRON ?? DEFAULT_TRASH_CLEANUP_CRON)
  async cleanExpiredTrashFiles() {
    if (!this.isTrashCleanupEnabled()) {
      return;
    }

    const retentionDays = this.getTrashRetentionDays();

    if (retentionDays <= 0) {
      this.logger.warn('Trash cleanup skipped because retentionDays <= 0');
      return;
    }

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const expiredFiles = await this.prisma.fileRecord.findMany({
      where: {
        deletedAt: {
          not: null,
          lt: cutoffDate,
        },
      },
      orderBy: {
        deletedAt: 'asc',
      },
    });

    if (expiredFiles.length === 0) {
      this.logger.debug('Trash cleanup found no expired files');
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
      `Trash cleanup finished. Removed ${deletedCount}/${expiredFiles.length} expired file(s)`,
    );
  }

  private async getTrashFileById(id: number) {
    const fileRecord = await this.prisma.fileRecord.findUnique({
      where: { id },
    });

    if (!fileRecord || !fileRecord.deletedAt) {
      throw new NotFoundException(`Trash file with id ${id} not found`);
    }

    return this.serializeFileRecord(fileRecord);
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

  private serializeFileRecord<T extends { originalName: string; id: number }>(
    record: T,
  ) {
    return {
      ...record,
      originalName: normalizeUploadedFilename(record.originalName),
      url: `/files/${record.id}/download`,
    };
  }

  private isTrashCleanupEnabled() {
    const rawValue =
      this.configService.get<string>('FILE_TRASH_CLEANUP_ENABLED') ??
      this.configService.get<string>('FILE_CLEANUP_ENABLED');

    if (!rawValue) {
      return true;
    }

    return rawValue.toLowerCase() !== 'false';
  }

  private getTrashRetentionDays() {
    const rawValue =
      this.configService.get<string>('FILE_TRASH_RETENTION_DAYS') ??
      this.configService.get<string>('FILE_RETENTION_DAYS');
    const retentionDays = Number(rawValue ?? DEFAULT_TRASH_RETENTION_DAYS);

    if (!Number.isFinite(retentionDays)) {
      return DEFAULT_TRASH_RETENTION_DAYS;
    }

    return retentionDays;
  }

  private getTrashCleanupCronExpression() {
    return (
      this.configService.get<string>('FILE_TRASH_CLEANUP_CRON') ??
      this.configService.get<string>('FILE_CLEANUP_CRON') ??
      DEFAULT_TRASH_CLEANUP_CRON
    );
  }
}
