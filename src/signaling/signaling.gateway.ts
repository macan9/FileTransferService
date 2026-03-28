import {
  BadRequestException,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
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
import { RegisterDeviceDto } from './dto/register-device.dto';
import { SendAnswerDto } from './dto/send-answer.dto';
import { SendCandidateDto } from './dto/send-candidate.dto';
import { SendOfferDto } from './dto/send-offer.dto';
import { ConnectedDevice } from './interfaces/connected-device.interface';
import { SignalingService } from './signaling.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/signaling',
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
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
      onlineListEvent: 'server:online-list',
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
    return this.forwardSignal({
      client,
      targetDeviceId: payload.targetDeviceId,
      eventName: 'server:answer',
      ackEvent: 'server:answer-sent',
      content: {
        answer: payload.answer,
      },
    });
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

  private emitOnlineList() {
    const users = this.signalingService.getOnlineDevices();
    this.server.emit('server:online-list', {
      total: users.length,
      users,
    });
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
}
