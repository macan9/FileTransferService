import { IsNotEmpty, IsObject } from 'class-validator';
import { SignalTargetDto } from './signal-target.dto';

export class SendOfferDto extends SignalTargetDto {
  @IsObject()
  @IsNotEmpty()
  offer!: Record<string, unknown>;
}
