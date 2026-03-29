export type ConnectionRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface ConnectionRequest {
  id: string;
  requestId: string;
  fromDeviceId: string;
  toDeviceId: string;
  status: ConnectionRequestStatus;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  expiredAt: string | null;
}
