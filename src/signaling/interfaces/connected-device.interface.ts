export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  platform: string;
  socketId: string | null;
  status: 'online' | 'offline' | 'stale';
  lastHeartbeatAt: string;
  connectedAt: string;
  disconnectedAt: string | null;
}
