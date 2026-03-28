import { Injectable } from '@nestjs/common';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { ConnectedDevice } from './interfaces/connected-device.interface';

@Injectable()
export class SignalingService {
  private readonly usersBySocketId = new Map<string, ConnectedDevice>();
  private readonly socketIdByDeviceId = new Map<string, string>();

  registerDevice(socketId: string, payload: RegisterDeviceDto) {
    const existingSocketId = this.socketIdByDeviceId.get(payload.deviceId);
    const existingConnection =
      existingSocketId !== undefined
        ? this.usersBySocketId.get(existingSocketId)
        : undefined;

    if (existingConnection && existingSocketId && existingSocketId !== socketId) {
      this.usersBySocketId.delete(existingSocketId);
    }

    const device: ConnectedDevice = {
      socketId,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      platform: payload.platform,
      connectedAt: new Date().toISOString(),
    };

    this.usersBySocketId.set(socketId, device);
    this.socketIdByDeviceId.set(payload.deviceId, socketId);

    return {
      device,
      replacedSocketId:
        existingSocketId && existingSocketId !== socketId ? existingSocketId : null,
    };
  }

  unregisterSocket(socketId: string) {
    const device = this.usersBySocketId.get(socketId);

    if (!device) {
      return null;
    }

    this.usersBySocketId.delete(socketId);

    if (this.socketIdByDeviceId.get(device.deviceId) === socketId) {
      this.socketIdByDeviceId.delete(device.deviceId);
    }

    return device;
  }

  getDeviceBySocketId(socketId: string) {
    return this.usersBySocketId.get(socketId) ?? null;
  }

  getDeviceByDeviceId(deviceId: string) {
    const socketId = this.socketIdByDeviceId.get(deviceId);

    if (!socketId) {
      return null;
    }

    return this.usersBySocketId.get(socketId) ?? null;
  }

  getOnlineDevices() {
    return Array.from(this.usersBySocketId.values()).sort((left, right) =>
      left.connectedAt.localeCompare(right.connectedAt),
    );
  }
}
