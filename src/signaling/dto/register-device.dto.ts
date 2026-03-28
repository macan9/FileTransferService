import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  platform!: string;
}
