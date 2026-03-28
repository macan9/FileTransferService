import { IsNotEmpty, IsObject } from 'class-validator';
import { SignalTargetDto } from './signal-target.dto';

export class SendAnswerDto extends SignalTargetDto {
  @IsObject()
  @IsNotEmpty()
  answer!: Record<string, unknown>;
}
