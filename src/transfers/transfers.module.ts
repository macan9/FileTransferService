import { Module } from '@nestjs/common';
import { SignalingModule } from '../signaling/signaling.module';
import { TransfersController } from './transfers.controller';

@Module({
  imports: [SignalingModule],
  controllers: [TransfersController],
})
export class TransfersModule {}
