import { IsNotEmpty, IsObject } from 'class-validator';
import { SignalTargetDto } from './signal-target.dto';

export class SendCandidateDto extends SignalTargetDto {
  @IsObject()
  @IsNotEmpty()
  candidate!: Record<string, unknown>;
}
