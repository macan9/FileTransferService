import { Controller, Get } from '@nestjs/common';
import { SignalingService } from './signaling.service';

@Controller('signaling')
export class SignalingController {
  constructor(private readonly signalingService: SignalingService) {}

  @Get('online-users')
  getOnlineUsers() {
    const users = this.signalingService.getOnlineDevices();

    return {
      total: users.length,
      users,
    };
  }
}
