import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SignalTargetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  targetDeviceId!: string;
}
