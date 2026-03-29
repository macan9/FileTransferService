import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class StartTransferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  receiverDeviceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @IsInt()
  @Min(0)
  fileSize!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  mimeType!: string;
}
