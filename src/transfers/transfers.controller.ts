import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SignalingService } from '../signaling/signaling.service';
import { UpdateTransferRecordDto } from './dto/update-transfer-record.dto';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly signalingService: SignalingService) {}

  @Get()
  getTransfers(
    @Query('deviceId') deviceId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeHidden') includeHidden?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const pageNumber = this.parsePositiveInteger(page, 1);
    const pageSizeNumber = this.parsePositiveInteger(pageSize, 20);

    return this.signalingService.queryTransferRecords({
      deviceId,
      sessionId,
      status,
      dateFrom,
      dateTo,
      page: pageNumber,
      pageSize: Math.min(pageSizeNumber, 100),
      includeHidden: includeHidden === 'true',
      includeDeleted: includeDeleted === 'true',
    });
  }

  @Get(':id')
  getTransferById(@Param('id') id: string) {
    const transfer = this.signalingService.getTransferRecordByIdOrTransferId(id);

    if (!transfer) {
      throw new BadRequestException(`Transfer ${id} does not exist`);
    }

    return transfer;
  }

  @Patch(':id')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  updateTransferById(
    @Param('id') id: string,
    @Body() body: UpdateTransferRecordDto,
  ) {
    const transfer = this.signalingService.updateTransferRecordVisibility(
      id,
      body.action,
    );

    if (!transfer) {
      throw new BadRequestException(`Transfer ${id} does not exist`);
    }

    return {
      success: true,
      transfer,
    };
  }

  @Delete(':id')
  deleteTransferById(@Param('id') id: string) {
    const transfer = this.signalingService.deleteTransferRecord(id);

    if (!transfer) {
      throw new BadRequestException(`Transfer ${id} does not exist`);
    }

    return {
      success: true,
      transfer,
    };
  }

  private parsePositiveInteger(rawValue: string | undefined, fallback: number) {
    if (!rawValue) {
      return fallback;
    }

    const parsed = Number(rawValue);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(
        `Invalid positive integer query parameter: ${rawValue}`,
      );
    }

    return parsed;
  }
}
