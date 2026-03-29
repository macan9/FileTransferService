import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  closeReason?: string;
}
