import {
  BadRequestException,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { CancelConnectionRequestDto } from './dto/cancel-connection-request.dto';
import { CancelTransferDto } from './dto/cancel-transfer.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CompleteTransferDto } from './dto/complete-transfer.dto';
import { CreateConnectionRequestDto } from './dto/create-connection-request.dto';
import { FailTransferDto } from './dto/fail-transfer.dto';
import { HeartbeatDeviceDto } from './dto/heartbeat-device.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { RespondConnectionRequestDto } from './dto/respond-connection-request.dto';
import { StartTransferDto } from './dto/start-transfer.dto';
import { TransferProgressDto } from './dto/transfer-progress.dto';
import { ConnectionRequest } from './interfaces/connection-request.interface';
import { Session } from './interfaces/session.interface';
import { SendAnswerDto } from './dto/send-answer.dto';
import { SendCandidateDto } from './dto/send-candidate.dto';
import { SendOfferDto } from './dto/send-offer.dto';
import { ConnectedDevice } from './interfaces/connected-device.interface';
import { SignalingService } from './signaling.service';
import { TransferRecord } from './interfaces/transfer-record.interface';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/signaling',
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private static readonly HEARTBEAT_CHECK_INTERVAL_MS = 15_000;

  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SignalingGateway.name);

  constructor(private readonly signalingService: SignalingService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Socket connected: ${client.id}`);
    client.emit('server:welcome', {
      socketId: client.id,
      message: 'Connected to signaling server',
      registerEvent: 'client:register',
      heartbeatEvent: 'client:heartbeat',
      connectionRequestEvents: {
        create: 'client:connection-request',
        respond: 'client:connection-request:respond',
        cancel: 'client:connection-request:cancel',
      },
      sessionEvents: {
        close: 'client:session:close',
        updated: 'server:session-updated',
      },
      transferEvents: {
        start: 'client:transfer-start',
        progress: 'client:transfer-progress',
        complete: 'client:transfer-complete',
        failed: 'client:transfer-failed',
        cancel: 'client:transfer-cancel',
        updated: 'server:transfer-updated',
      },
      onlineListEvent: 'server:online-list',
      heartbeatTimeoutMs: this.signalingService.getHeartbeatTimeoutMs(),
      connectionRequestTimeoutMs: this.signalingService.getConnectionRequestTimeoutMs(),
      rtcEvents: {
        offer: 'client:offer',
        answer: 'client:answer',
        candidate: 'client:candidate',
      },
    });
  }

  handleDisconnect(client: Socket) {
    const disconnectedDevice = this.signalingService.unregisterSocket(client.id);

    if (!disconnectedDevice) {
      this.logger.log(`Socket disconnected before registration: ${client.id}`);
      return;
    }

    this.logger.log(
      `Device offline: deviceId=${disconnectedDevice.deviceId}, socketId=${client.id}`,
    );

    this.emitSessionUpdates(
      this.signalingService.failSessionsForDevice(
        disconnectedDevice.deviceId,
        'Device disconnected',
      ),
    );
    this.server.emit('server:user-offline', disconnectedDevice);
    this.emitOnlineList();
  }

  @SubscribeMessage('client:register')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RegisterDeviceDto,
  ) {
    const { device, replacedSocketId } = this.signalingService.registerDevice(
      client.id,
      payload,
    );

    this.logger.log(
      `Device registered: deviceId=${device.deviceId}, socketId=${client.id}, platform=${device.platform}`,
    );

    if (replacedSocketId) {
      const previousSocket = this.server.sockets.sockets.get(replacedSocketId);
      previousSocket?.emit('server:force-disconnect', {
        reason: 'Device connected from another session',
        deviceId: device.deviceId,
      });
      previousSocket?.disconnect(true);
    }

    client.emit('server:registered', {
      success: true,
      user: device,
    });

    client.broadcast.emit('server:user-online', device);
    this.emitOnlineList();

    return {
      success: true,
      user: device,
      onlineUsers: this.signalingService.getOnlineDevices(),
    };
  }

  @SubscribeMessage('client:heartbeat')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() _payload: HeartbeatDeviceDto,
  ) {
    const device = this.signalingService.refreshHeartbeat(client.id);

    if (!device) {
      throw new BadRequestException(
        'Current socket is not registered. Please send client:register first.',
      );
    }

    return {
      success: true,
      user: device,
      serverTime: new Date().toISOString(),
    };
  }

  @SubscribeMessage('client:connection-request')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleCreateConnectionRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CreateConnectionRequestDto,
  ) {
    const sender = this.requireRegisteredDevice(client.id);
    const target = this.signalingService.getDeviceByDeviceId(payload.toDeviceId);

    if (!target) {
      throw new BadRequestException(
        `Target device ${payload.toDeviceId} is not online`,
      );
    }

    if (sender.deviceId === target.deviceId) {
      throw new BadRequestException('Cannot create a connection request to self.');
    }

    const request = this.signalingService.createConnectionRequest(
      sender.deviceId,
      target.deviceId,
      payload.message,
    );

    this.server.to(target.socketId!).emit('server:connection-request', request);
    client.emit('server:connection-request-updated', request);

    return {
      success: true,
      request,
    };
  }

  @SubscribeMessage('client:connection-request:respond')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleRespondConnectionRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RespondConnectionRequestDto,
  ) {
    const responder = this.requireRegisteredDevice(client.id);
    const request = this.signalingService.getConnectionRequestByRequestId(
      payload.requestId,
    );

    if (!request) {
      throw new BadRequestException(
        `Connection request ${payload.requestId} does not exist`,
      );
    }

    if (request.toDeviceId !== responder.deviceId) {
      throw new BadRequestException(
        'Only the target device can respond to this connection request.',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Connection request ${payload.requestId} is already ${request.status}`,
      );
    }

    const updatedRequest = this.signalingService.respondConnectionRequest(
      payload.requestId,
      payload.status,
    );

    if (!updatedRequest) {
      throw new BadRequestException(
        `Connection request ${payload.requestId} is no longer pending`,
      );
    }

    this.emitConnectionRequestUpdate(updatedRequest);
    if (updatedRequest.status === 'accepted') {
      const { session } = this.signalingService.getOrCreateSession(
        updatedRequest.fromDeviceId,
        updatedRequest.toDeviceId,
        responder.deviceId,
      );
      this.emitSessionUpdate(session);
    }

    return {
      success: true,
      request: updatedRequest,
    };
  }

  @SubscribeMessage('client:connection-request:cancel')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleCancelConnectionRequest(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CancelConnectionRequestDto,
  ) {
    const requester = this.requireRegisteredDevice(client.id);
    const request = this.signalingService.getConnectionRequestByRequestId(
      payload.requestId,
    );

    if (!request) {
      throw new BadRequestException(
        `Connection request ${payload.requestId} does not exist`,
      );
    }

    if (request.fromDeviceId !== requester.deviceId) {
      throw new BadRequestException(
        'Only the source device can cancel this connection request.',
      );
    }

    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Connection request ${payload.requestId} is already ${request.status}`,
      );
    }

    const updatedRequest = this.signalingService.cancelConnectionRequest(
      payload.requestId,
    );

    if (!updatedRequest) {
      throw new BadRequestException(
        `Connection request ${payload.requestId} is no longer pending`,
      );
    }

    this.emitConnectionRequestUpdate(updatedRequest);

    return {
      success: true,
      request: updatedRequest,
    };
  }

  @SubscribeMessage('client:session:close')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleCloseSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CloseSessionDto,
  ) {
    const requester = this.requireRegisteredDevice(client.id);
    const session = this.signalingService.getSessionBySessionId(payload.sessionId);

    if (!session) {
      throw new BadRequestException(`Session ${payload.sessionId} does not exist`);
    }

    if (
      session.deviceAId !== requester.deviceId &&
      session.deviceBId !== requester.deviceId
    ) {
      throw new BadRequestException(
        'Only a session participant can close this session.',
      );
    }

    const updatedSession = this.signalingService.closeSession(
      payload.sessionId,
      payload.closeReason ?? 'Closed by participant',
    );

    if (!updatedSession) {
      throw new BadRequestException(
        `Session ${payload.sessionId} is already ${session.status}`,
      );
    }

    this.emitSessionUpdate(updatedSession);

    return {
      success: true,
      session: updatedSession,
    };
  }

  @SubscribeMessage('client:offer')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendOfferDto,
  ) {
    return this.forwardSignal({
      client,
      targetDeviceId: payload.targetDeviceId,
      eventName: 'server:offer',
      ackEvent: 'server:offer-sent',
      content: {
        offer: payload.offer,
      },
    });
  }

  @SubscribeMessage('client:answer')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendAnswerDto,
  ) {
    const response = this.forwardSignal({
      client,
      targetDeviceId: payload.targetDeviceId,
      eventName: 'server:answer',
      ackEvent: 'server:answer-sent',
      content: {
        answer: payload.answer,
      },
    });

    const sender = this.requireRegisteredDevice(client.id);
    const session = this.signalingService.findSessionByDevices(
      sender.deviceId,
      payload.targetDeviceId,
    );

    if (session) {
      const activeSession = this.signalingService.markSessionActive(session.sessionId);
      activeSession && this.emitSessionUpdate(activeSession);
      return {
        ...response,
        session: activeSession,
      };
    }

    return response;
  }

  @SubscribeMessage('client:candidate')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendCandidateDto,
  ) {
    return this.forwardSignal({
      client,
      targetDeviceId: payload.targetDeviceId,
      eventName: 'server:candidate',
      ackEvent: 'server:candidate-sent',
      content: {
        candidate: payload.candidate,
      },
    });
  }

  @SubscribeMessage('client:transfer-start')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleTransferStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StartTransferDto,
  ) {
    const sender = this.requireRegisteredDevice(client.id);
    const session = this.requireActiveSessionParticipant(payload.sessionId, sender.deviceId);

    if (payload.receiverDeviceId === sender.deviceId) {
      throw new BadRequestException('Cannot send a file to the same device.');
    }

    if (
      session.deviceAId !== payload.receiverDeviceId &&
      session.deviceBId !== payload.receiverDeviceId
    ) {
      throw new BadRequestException(
        'Receiver device is not a participant of the selected session.',
      );
    }

    const transfer = this.signalingService.createTransferRecord({
      sessionId: session.sessionId,
      senderDeviceId: sender.deviceId,
      receiverDeviceId: payload.receiverDeviceId,
      fileName: payload.fileName,
      fileSize: payload.fileSize,
      mimeType: payload.mimeType,
    });

    this.emitTransferUpdate(transfer);

    return {
      success: true,
      transfer,
    };
  }

  @SubscribeMessage('client:transfer-progress')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleTransferProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TransferProgressDto,
  ) {
    const actor = this.requireRegisteredDevice(client.id);
    const transfer = this.requireTransferParticipant(payload.transferId, actor.deviceId);

    const nextStatus =
      payload.status === 'sending'
        ? this.requireSender(actor.deviceId, transfer)
        : this.requireReceiver(actor.deviceId, transfer);

    const updatedTransfer = this.signalingService.markTransferStatus(
      transfer.transferId,
      nextStatus,
      {
        startedAt: transfer.startedAt ?? new Date().toISOString(),
      },
    );

    if (!updatedTransfer) {
      throw new BadRequestException(
        `Transfer ${payload.transferId} cannot move to ${payload.status}`,
      );
    }

    this.emitTransferUpdate(updatedTransfer);

    return {
      success: true,
      transfer: updatedTransfer,
    };
  }

  @SubscribeMessage('client:transfer-complete')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleTransferComplete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CompleteTransferDto,
  ) {
    const actor = this.requireRegisteredDevice(client.id);
    const transfer = this.requireTransferParticipant(payload.transferId, actor.deviceId);

    const nextStatus =
      actor.deviceId === transfer.receiverDeviceId ? 'received' : 'sent';

    if (nextStatus === 'sent' && transfer.status !== 'received') {
      throw new BadRequestException(
        'Sender can mark transfer as sent only after receiver confirmed receipt.',
      );
    }

    const updatedTransfer = this.signalingService.markTransferStatus(
      transfer.transferId,
      nextStatus,
      {
        completedAt: new Date().toISOString(),
        errorMessage: null,
      },
    );

    if (!updatedTransfer) {
      throw new BadRequestException(
        `Transfer ${payload.transferId} cannot be completed by this device`,
      );
    }

    this.emitTransferUpdate(updatedTransfer);

    return {
      success: true,
      transfer: updatedTransfer,
    };
  }

  @SubscribeMessage('client:transfer-failed')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleTransferFailed(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: FailTransferDto,
  ) {
    const actor = this.requireRegisteredDevice(client.id);
    const transfer = this.requireTransferParticipant(payload.transferId, actor.deviceId);
    const updatedTransfer = this.signalingService.markTransferStatus(
      transfer.transferId,
      'failed',
      {
        errorMessage: payload.errorMessage?.trim() || 'Transfer failed',
        completedAt: new Date().toISOString(),
      },
    );

    if (!updatedTransfer) {
      throw new BadRequestException(`Transfer ${payload.transferId} cannot fail now`);
    }

    this.emitTransferUpdate(updatedTransfer);

    return {
      success: true,
      transfer: updatedTransfer,
    };
  }

  @SubscribeMessage('client:transfer-cancel')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  handleTransferCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CancelTransferDto,
  ) {
    const actor = this.requireRegisteredDevice(client.id);
    const transfer = this.requireTransferParticipant(payload.transferId, actor.deviceId);
    const updatedTransfer = this.signalingService.markTransferStatus(
      transfer.transferId,
      'cancelled',
      {
        errorMessage: payload.errorMessage?.trim() || 'Transfer cancelled',
        completedAt: new Date().toISOString(),
      },
    );

    if (!updatedTransfer) {
      throw new BadRequestException(
        `Transfer ${payload.transferId} cannot be cancelled now`,
      );
    }

    this.emitTransferUpdate(updatedTransfer);

    return {
      success: true,
      transfer: updatedTransfer,
    };
  }

  private emitOnlineList() {
    const users = this.signalingService.getOnlineDevices();
    this.server.emit('server:online-list', {
      total: users.length,
      users,
    });
  }

  @Interval(SignalingGateway.HEARTBEAT_CHECK_INTERVAL_MS)
  handleHeartbeatTimeouts() {
    if (!this.server) {
      return;
    }

    const expiredDevices = this.signalingService.pruneExpiredDevices();

    if (expiredDevices.length === 0) {
      return;
    }

    for (const device of expiredDevices) {
      this.logger.warn(
        `Device heartbeat timeout: deviceId=${device.deviceId}, lastHeartbeatAt=${device.lastHeartbeatAt}`,
      );
      this.server.emit('server:user-stale', device);
    }

    this.emitOnlineList();
  }

  @Interval(SignalingGateway.HEARTBEAT_CHECK_INTERVAL_MS)
  handleConnectionRequestTimeouts() {
    if (!this.server) {
      return;
    }

    const expiredRequests = this.signalingService.expireConnectionRequests();

    if (expiredRequests.length === 0) {
      return;
    }

    for (const request of expiredRequests) {
      this.logger.warn(
        `Connection request expired: requestId=${request.requestId}, from=${request.fromDeviceId}, to=${request.toDeviceId}`,
      );
      this.emitConnectionRequestUpdate(request);
    }
  }

  private forwardSignal({
    client,
    targetDeviceId,
    eventName,
    ackEvent,
    content,
  }: {
    client: Socket;
    targetDeviceId: string;
    eventName: 'server:offer' | 'server:answer' | 'server:candidate';
    ackEvent:
      | 'server:offer-sent'
      | 'server:answer-sent'
      | 'server:candidate-sent';
    content: Record<string, unknown>;
  }) {
    const sender = this.requireRegisteredDevice(client.id);
    const target = this.signalingService.getDeviceByDeviceId(targetDeviceId);

    if (!target) {
      throw new BadRequestException(
        `Target device ${targetDeviceId} is not online`,
      );
    }

    this.server.to(target.socketId).emit(eventName, {
      from: this.toPeer(sender),
      to: this.toPeer(target),
      ...content,
    });

    this.logger.log(
      `Signal forwarded: type=${eventName}, from=${sender.deviceId}, to=${target.deviceId}`,
    );

    return {
      success: true,
      event: ackEvent,
      fromDeviceId: sender.deviceId,
      targetDeviceId: target.deviceId,
    };
  }

  private requireRegisteredDevice(socketId: string) {
    const device = this.signalingService.getDeviceBySocketId(socketId);

    if (!device) {
      throw new BadRequestException(
        'Current socket is not registered. Please send client:register first.',
      );
    }

    return device;
  }

  private toPeer(device: ConnectedDevice) {
    return {
      socketId: device.socketId,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
    };
  }

  private emitConnectionRequestUpdate(request: ConnectionRequest) {
    const fromDevice = this.signalingService.getRegisteredDeviceByDeviceId(
      request.fromDeviceId,
    );
    const toDevice = this.signalingService.getRegisteredDeviceByDeviceId(
      request.toDeviceId,
    );

    fromDevice?.socketId &&
      this.server
        .to(fromDevice.socketId)
        .emit('server:connection-request-updated', request);

    toDevice?.socketId &&
      this.server
        .to(toDevice.socketId)
        .emit('server:connection-request-updated', request);
  }

  private emitSessionUpdates(sessions: Session[]) {
    for (const session of sessions) {
      this.emitSessionUpdate(session);
    }
  }

  private emitSessionUpdate(session: Session) {
    const deviceA = this.signalingService.getRegisteredDeviceByDeviceId(
      session.deviceAId,
    );
    const deviceB = this.signalingService.getRegisteredDeviceByDeviceId(
      session.deviceBId,
    );

    deviceA?.socketId &&
      this.server.to(deviceA.socketId).emit('server:session-updated', session);
    deviceB?.socketId &&
      this.server.to(deviceB.socketId).emit('server:session-updated', session);
  }

  private emitTransferUpdate(transfer: TransferRecord) {
    const sender = this.signalingService.getRegisteredDeviceByDeviceId(
      transfer.senderDeviceId,
    );
    const receiver = this.signalingService.getRegisteredDeviceByDeviceId(
      transfer.receiverDeviceId,
    );

    sender?.socketId &&
      this.server.to(sender.socketId).emit('server:transfer-updated', transfer);
    receiver?.socketId &&
      this.server.to(receiver.socketId).emit('server:transfer-updated', transfer);
  }

  private requireActiveSessionParticipant(sessionId: string, deviceId: string) {
    const session = this.signalingService.getSessionBySessionId(sessionId);

    if (!session) {
      throw new BadRequestException(`Session ${sessionId} does not exist`);
    }

    if (session.status !== 'active') {
      throw new BadRequestException(
        `Session ${sessionId} is not active. Current status: ${session.status}`,
      );
    }

    if (session.deviceAId !== deviceId && session.deviceBId !== deviceId) {
      throw new BadRequestException('Current device is not a participant of this session.');
    }

    return session;
  }

  private requireTransferParticipant(transferId: string, deviceId: string) {
    const transfer = this.signalingService.getTransferRecordByTransferId(transferId);

    if (!transfer) {
      throw new BadRequestException(`Transfer ${transferId} does not exist`);
    }

    if (
      transfer.senderDeviceId !== deviceId &&
      transfer.receiverDeviceId !== deviceId
    ) {
      throw new BadRequestException('Current device is not a participant of this transfer.');
    }

    return transfer;
  }

  private requireSender(deviceId: string, transfer: TransferRecord) {
    if (transfer.senderDeviceId !== deviceId) {
      throw new BadRequestException('Only the sender can report sending progress.');
    }

    return 'sending' as const;
  }

  private requireReceiver(deviceId: string, transfer: TransferRecord) {
    if (transfer.receiverDeviceId !== deviceId) {
      throw new BadRequestException('Only the receiver can report receiving progress.');
    }

    return 'receiving' as const;
  }
}
