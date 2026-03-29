import { Controller, Get } from '@nestjs/common';
import { SignalingService } from './signaling.service';

@Controller('signaling')
export class SignalingController {
  constructor(private readonly signalingService: SignalingService) {}

  @Get('devices')
  getDevices() {
    const users = this.signalingService.getRegisteredDevices();

    return {
      total: users.length,
      users,
    };
  }

  @Get('connection-requests')
  getConnectionRequests() {
    const requests = this.signalingService.getConnectionRequests();

    return {
      total: requests.length,
      requests,
    };
  }

  @Get('sessions')
  getSessions() {
    const sessions = this.signalingService.getSessions();

    return {
      total: sessions.length,
      sessions,
    };
  }

  @Get('online-users')
  getOnlineUsers() {
    const users = this.signalingService.getOnlineDevices();

    return {
      total: users.length,
      users,
    };
  }
}
