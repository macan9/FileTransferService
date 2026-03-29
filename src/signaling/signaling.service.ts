import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConnectionRequest } from './interfaces/connection-request.interface';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { ConnectedDevice } from './interfaces/connected-device.interface';
import { Session } from './interfaces/session.interface';
import {
  TransferRecord,
  TransferRecordStatus,
} from './interfaces/transfer-record.interface';

const DEVICE_HEARTBEAT_TIMEOUT_MS = 30_000;
const CONNECTION_REQUEST_TIMEOUT_MS = 60_000;

@Injectable()
export class SignalingService {
  private readonly devicesByDeviceId = new Map<string, ConnectedDevice>();
  private readonly deviceIdBySocketId = new Map<string, string>();
  private readonly socketIdByDeviceId = new Map<string, string>();
  private readonly requestsByRequestId = new Map<string, ConnectionRequest>();
  private readonly sessionsBySessionId = new Map<string, Session>();
  private readonly activeSessionIdByPairKey = new Map<string, string>();
  private readonly transferRecordsByTransferId = new Map<string, TransferRecord>();

  registerDevice(socketId: string, payload: RegisterDeviceDto) {
    const now = new Date().toISOString();
    const existingSocketId = this.socketIdByDeviceId.get(payload.deviceId);

    if (existingSocketId && existingSocketId !== socketId) {
      this.deviceIdBySocketId.delete(existingSocketId);
    }

    const device: ConnectedDevice = {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      platform: payload.platform,
      socketId,
      status: 'online',
      lastHeartbeatAt: now,
      connectedAt: now,
      disconnectedAt: null,
    };

    this.devicesByDeviceId.set(payload.deviceId, device);
    this.deviceIdBySocketId.set(socketId, payload.deviceId);
    this.socketIdByDeviceId.set(payload.deviceId, socketId);

    return {
      device,
      replacedSocketId:
        existingSocketId && existingSocketId !== socketId ? existingSocketId : null,
    };
  }

  unregisterSocket(socketId: string) {
    const deviceId = this.deviceIdBySocketId.get(socketId);

    if (!deviceId) {
      return null;
    }

    this.deviceIdBySocketId.delete(socketId);
    const device = this.devicesByDeviceId.get(deviceId);

    if (!device) {
      return null;
    }

    if (this.socketIdByDeviceId.get(device.deviceId) === socketId) {
      this.socketIdByDeviceId.delete(device.deviceId);
    }

    const disconnectedDevice: ConnectedDevice = {
      ...device,
      socketId: null,
      status: 'offline',
      disconnectedAt: new Date().toISOString(),
    };

    this.devicesByDeviceId.set(device.deviceId, disconnectedDevice);

    return disconnectedDevice;
  }

  getDeviceBySocketId(socketId: string) {
    const deviceId = this.deviceIdBySocketId.get(socketId);

    if (!deviceId) {
      return null;
    }

    return this.devicesByDeviceId.get(deviceId) ?? null;
  }

  getRegisteredDeviceByDeviceId(deviceId: string) {
    return this.devicesByDeviceId.get(deviceId) ?? null;
  }

  getDeviceByDeviceId(deviceId: string) {
    const device = this.getRegisteredDeviceByDeviceId(deviceId);

    if (!device || device.status !== 'online') {
      return null;
    }

    return device.socketId
      ? {
          ...device,
          socketId: device.socketId,
        }
      : null;
  }

  getOnlineDevices() {
    return this.getDevicesByStatus('online');
  }

  getRegisteredDevices() {
    return Array.from(this.devicesByDeviceId.values()).sort((left, right) =>
      left.deviceName.localeCompare(right.deviceName),
    );
  }

  refreshHeartbeat(socketId: string) {
    const device = this.getDeviceBySocketId(socketId);

    if (!device) {
      return null;
    }

    const heartbeatAt = new Date().toISOString();
    const refreshedDevice: ConnectedDevice = {
      ...device,
      socketId,
      status: 'online',
      lastHeartbeatAt: heartbeatAt,
      disconnectedAt: null,
    };

    this.devicesByDeviceId.set(refreshedDevice.deviceId, refreshedDevice);
    this.deviceIdBySocketId.set(socketId, refreshedDevice.deviceId);
    this.socketIdByDeviceId.set(refreshedDevice.deviceId, socketId);

    return refreshedDevice;
  }

  pruneExpiredDevices(referenceTime = new Date()) {
    const staleDevices: ConnectedDevice[] = [];

    for (const device of this.devicesByDeviceId.values()) {
      if (device.status !== 'online' || !device.socketId) {
        continue;
      }

      const heartbeatAgeMs =
        referenceTime.getTime() - new Date(device.lastHeartbeatAt).getTime();

      if (heartbeatAgeMs < DEVICE_HEARTBEAT_TIMEOUT_MS) {
        continue;
      }

      const staleDevice: ConnectedDevice = {
        ...device,
        status: 'stale',
      };

      this.devicesByDeviceId.set(staleDevice.deviceId, staleDevice);
      staleDevices.push(staleDevice);
    }

    return staleDevices;
  }

  getHeartbeatTimeoutMs() {
    return DEVICE_HEARTBEAT_TIMEOUT_MS;
  }

  createConnectionRequest(fromDeviceId: string, toDeviceId: string, message?: string) {
    const createdAt = new Date().toISOString();
    const request: ConnectionRequest = {
      id: randomUUID(),
      requestId: randomUUID(),
      fromDeviceId,
      toDeviceId,
      status: 'pending',
      message: message?.trim() ? message.trim() : null,
      createdAt,
      respondedAt: null,
      expiredAt: new Date(
        new Date(createdAt).getTime() + CONNECTION_REQUEST_TIMEOUT_MS,
      ).toISOString(),
    };

    this.requestsByRequestId.set(request.requestId, request);

    return request;
  }

  getConnectionRequestByRequestId(requestId: string) {
    return this.requestsByRequestId.get(requestId) ?? null;
  }

  getConnectionRequests() {
    return Array.from(this.requestsByRequestId.values()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  respondConnectionRequest(
    requestId: string,
    status: 'accepted' | 'rejected',
  ) {
    const request = this.getConnectionRequestByRequestId(requestId);

    if (!request || request.status !== 'pending') {
      return null;
    }

    const updatedRequest: ConnectionRequest = {
      ...request,
      status,
      respondedAt: new Date().toISOString(),
    };

    this.requestsByRequestId.set(requestId, updatedRequest);

    return updatedRequest;
  }

  cancelConnectionRequest(requestId: string) {
    const request = this.getConnectionRequestByRequestId(requestId);

    if (!request || request.status !== 'pending') {
      return null;
    }

    const updatedRequest: ConnectionRequest = {
      ...request,
      status: 'cancelled',
      respondedAt: new Date().toISOString(),
    };

    this.requestsByRequestId.set(requestId, updatedRequest);

    return updatedRequest;
  }

  expireConnectionRequests(referenceTime = new Date()) {
    const expiredRequests: ConnectionRequest[] = [];

    for (const request of this.requestsByRequestId.values()) {
      if (request.status !== 'pending' || !request.expiredAt) {
        continue;
      }

      if (new Date(request.expiredAt).getTime() > referenceTime.getTime()) {
        continue;
      }

      const expiredRequest: ConnectionRequest = {
        ...request,
        status: 'expired',
      };

      this.requestsByRequestId.set(request.requestId, expiredRequest);
      expiredRequests.push(expiredRequest);
    }

    return expiredRequests;
  }

  getConnectionRequestTimeoutMs() {
    return CONNECTION_REQUEST_TIMEOUT_MS;
  }

  getSessionBySessionId(sessionId: string) {
    return this.sessionsBySessionId.get(sessionId) ?? null;
  }

  getSessions() {
    return Array.from(this.sessionsBySessionId.values()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  getOrCreateSession(
    deviceAId: string,
    deviceBId: string,
    createdByDeviceId: string,
  ) {
    const pairKey = this.getDevicePairKey(deviceAId, deviceBId);
    const existingSessionId = this.activeSessionIdByPairKey.get(pairKey);

    if (existingSessionId) {
      const existingSession =
        this.sessionsBySessionId.get(existingSessionId) ?? null;

      if (
        existingSession &&
        (existingSession.status === 'connecting' ||
          existingSession.status === 'active')
      ) {
        return {
          session: existingSession,
          created: false,
        };
      }

      this.activeSessionIdByPairKey.delete(pairKey);
    }

    const [normalizedDeviceAId, normalizedDeviceBId] = [deviceAId, deviceBId].sort();
    const createdAt = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      sessionId: randomUUID(),
      deviceAId: normalizedDeviceAId,
      deviceBId: normalizedDeviceBId,
      status: 'connecting',
      createdByDeviceId,
      createdAt,
      connectedAt: null,
      closedAt: null,
      closeReason: null,
    };

    this.sessionsBySessionId.set(session.sessionId, session);
    this.activeSessionIdByPairKey.set(pairKey, session.sessionId);

    return {
      session,
      created: true,
    };
  }

  markSessionActive(sessionId: string) {
    const session = this.getSessionBySessionId(sessionId);

    if (!session || session.status === 'closed' || session.status === 'failed') {
      return null;
    }

    if (session.status === 'active') {
      return session;
    }

    const updatedSession: Session = {
      ...session,
      status: 'active',
      connectedAt: session.connectedAt ?? new Date().toISOString(),
      closedAt: null,
      closeReason: null,
    };

    this.sessionsBySessionId.set(sessionId, updatedSession);

    return updatedSession;
  }

  closeSession(sessionId: string, closeReason?: string) {
    const session = this.getSessionBySessionId(sessionId);

    if (!session || session.status === 'closed' || session.status === 'failed') {
      return null;
    }

    const updatedSession: Session = {
      ...session,
      status: 'closed',
      closedAt: new Date().toISOString(),
      closeReason: closeReason?.trim() ? closeReason.trim() : null,
    };

    this.sessionsBySessionId.set(sessionId, updatedSession);
    this.activeSessionIdByPairKey.delete(
      this.getDevicePairKey(session.deviceAId, session.deviceBId),
    );

    return updatedSession;
  }

  failSessionsForDevice(deviceId: string, closeReason: string) {
    const failedSessions: Session[] = [];

    for (const session of this.sessionsBySessionId.values()) {
      if (
        session.status !== 'connecting' &&
        session.status !== 'active'
      ) {
        continue;
      }

      if (session.deviceAId !== deviceId && session.deviceBId !== deviceId) {
        continue;
      }

      const failedSession: Session = {
        ...session,
        status: 'failed',
        closedAt: new Date().toISOString(),
        closeReason,
      };

      this.sessionsBySessionId.set(session.sessionId, failedSession);
      this.activeSessionIdByPairKey.delete(
        this.getDevicePairKey(session.deviceAId, session.deviceBId),
      );
      failedSessions.push(failedSession);
    }

    return failedSessions;
  }

  findSessionByDevices(deviceAId: string, deviceBId: string) {
    const sessionId = this.activeSessionIdByPairKey.get(
      this.getDevicePairKey(deviceAId, deviceBId),
    );

    if (!sessionId) {
      return null;
    }

    return this.sessionsBySessionId.get(sessionId) ?? null;
  }

  createTransferRecord(input: {
    sessionId: string;
    senderDeviceId: string;
    receiverDeviceId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }) {
    const createdAt = new Date().toISOString();
    const transfer: TransferRecord = {
      id: randomUUID(),
      transferId: randomUUID(),
      sessionId: input.sessionId,
      senderDeviceId: input.senderDeviceId,
      receiverDeviceId: input.receiverDeviceId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      direction: `${input.senderDeviceId}->${input.receiverDeviceId}`,
      status: 'pending',
      errorMessage: null,
      createdAt,
      startedAt: null,
      completedAt: null,
      hiddenAt: null,
      deletedAt: null,
    };

    this.transferRecordsByTransferId.set(transfer.transferId, transfer);

    return transfer;
  }

  getTransferRecordByTransferId(transferId: string) {
    return this.transferRecordsByTransferId.get(transferId) ?? null;
  }

  getTransferRecordByIdOrTransferId(idOrTransferId: string) {
    for (const transfer of this.transferRecordsByTransferId.values()) {
      if (transfer.id === idOrTransferId || transfer.transferId === idOrTransferId) {
        return transfer;
      }
    }

    return null;
  }

  queryTransferRecords({
    deviceId,
    sessionId,
    status,
    dateFrom,
    dateTo,
    page,
    pageSize,
    includeHidden,
    includeDeleted,
  }: {
    deviceId?: string;
    sessionId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
    pageSize: number;
    includeHidden: boolean;
    includeDeleted: boolean;
  }) {
    let records = Array.from(this.transferRecordsByTransferId.values()).sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );

    if (!includeHidden) {
      records = records.filter((record) => record.hiddenAt === null);
    }

    if (!includeDeleted) {
      records = records.filter((record) => record.deletedAt === null);
    }

    if (deviceId) {
      records = records.filter(
        (record) =>
          record.senderDeviceId === deviceId || record.receiverDeviceId === deviceId,
      );
    }

    if (sessionId) {
      records = records.filter((record) => record.sessionId === sessionId);
    }

    if (status) {
      records = records.filter((record) => record.status === status);
    }

    if (dateFrom) {
      records = records.filter((record) => record.createdAt >= dateFrom);
    }

    if (dateTo) {
      records = records.filter((record) => record.createdAt <= dateTo);
    }

    const total = records.length;
    const startIndex = (page - 1) * pageSize;
    const items = records.slice(startIndex, startIndex + pageSize);

    return {
      total,
      page,
      pageSize,
      items,
    };
  }

  markTransferStatus(
    transferId: string,
    status: TransferRecordStatus,
    options?: {
      errorMessage?: string | null;
      startedAt?: string | null;
      completedAt?: string | null;
    },
  ) {
    const transfer = this.getTransferRecordByTransferId(transferId);

    if (!transfer || transfer.deletedAt) {
      return null;
    }

    if (!this.isAllowedTransferTransition(transfer.status, status)) {
      return null;
    }

    const updatedTransfer: TransferRecord = {
      ...transfer,
      status,
      errorMessage:
        options?.errorMessage !== undefined ? options.errorMessage : transfer.errorMessage,
      startedAt:
        options?.startedAt !== undefined ? options.startedAt : transfer.startedAt,
      completedAt:
        options?.completedAt !== undefined ? options.completedAt : transfer.completedAt,
    };

    this.transferRecordsByTransferId.set(transfer.transferId, updatedTransfer);

    return updatedTransfer;
  }

  updateTransferRecordVisibility(idOrTransferId: string, action: 'hide' | 'restore') {
    const transfer = this.getTransferRecordByIdOrTransferId(idOrTransferId);

    if (!transfer) {
      return null;
    }

    const updatedTransfer: TransferRecord = {
      ...transfer,
      hiddenAt: action === 'hide' ? new Date().toISOString() : null,
    };

    this.transferRecordsByTransferId.set(updatedTransfer.transferId, updatedTransfer);

    return updatedTransfer;
  }

  deleteTransferRecord(idOrTransferId: string) {
    const transfer = this.getTransferRecordByIdOrTransferId(idOrTransferId);

    if (!transfer) {
      return null;
    }

    const updatedTransfer: TransferRecord = {
      ...transfer,
      deletedAt: new Date().toISOString(),
    };

    this.transferRecordsByTransferId.set(updatedTransfer.transferId, updatedTransfer);

    return updatedTransfer;
  }

  private getDevicesByStatus(status: ConnectedDevice['status']) {
    return this.getRegisteredDevices().filter((device) => device.status === status);
  }

  private getDevicePairKey(deviceAId: string, deviceBId: string) {
    return [deviceAId, deviceBId].sort().join('::');
  }

  private isAllowedTransferTransition(
    currentStatus: TransferRecordStatus,
    nextStatus: TransferRecordStatus,
  ) {
    const allowedTransitions: Record<TransferRecordStatus, TransferRecordStatus[]> = {
      pending: ['sending', 'receiving', 'failed', 'cancelled'],
      sending: ['receiving', 'failed', 'cancelled'],
      sent: [],
      receiving: ['received', 'failed', 'cancelled'],
      received: ['sent'],
      failed: [],
      cancelled: [],
    };

    return allowedTransitions[currentStatus].includes(nextStatus);
  }
}
