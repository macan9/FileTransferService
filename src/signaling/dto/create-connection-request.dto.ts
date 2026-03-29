import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConnectionRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  toDeviceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
