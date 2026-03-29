export type TransferRecordStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'receiving'
  | 'received'
  | 'failed'
  | 'cancelled';

export interface TransferRecord {
  id: string;
  transferId: string;
  sessionId: string;
  senderDeviceId: string;
  receiverDeviceId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  direction: string;
  status: TransferRecordStatus;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  hiddenAt: string | null;
  deletedAt: string | null;
}
