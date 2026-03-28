import 'dotenv/config';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { access, unlink } from 'fs/promises';
import { constants } from 'fs';

const DEFAULT_FILE_RETENTION_DAYS = 7;
const DEFAULT_FILE_CLEANUP_CRON = '0 0 * * * *';

@Injectable()
export class AppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppService.name);
  private readonly prisma = new PrismaClient({
    adapter: new PrismaLibSql({
      url: process.env.DATABASE_URL ?? 'file:./dev.db',
    }),
  });

  constructor(
    private readonly configService: ConfigService,
  ) {}

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
    return this.prisma.fileRecord.create({
      data: {
        originalName: file.originalname,
        filename: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        storagePath: file.path,
        url: `/uploads/${file.filename}`,
      },
    });
  }

  async getFiles() {
    return this.prisma.fileRecord.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getFileById(id: number) {
    const fileRecord = await this.prisma.fileRecord.findUnique({
      where: { id },
    });

    if (!fileRecord) {
      throw new NotFoundException(`File with id ${id} not found`);
    }

    return fileRecord;
  }

  async ensureFileExists(storagePath: string) {
    try {
      await access(storagePath, constants.F_OK);
    } catch {
      throw new NotFoundException('File content does not exist on disk');
    }
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
