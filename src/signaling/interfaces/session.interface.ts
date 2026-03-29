export type SessionStatus = 'connecting' | 'active' | 'closed' | 'failed';

export interface Session {
  id: string;
  sessionId: string;
  deviceAId: string;
  deviceBId: string;
  status: SessionStatus;
  createdByDeviceId: string;
  createdAt: string;
  connectedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}
