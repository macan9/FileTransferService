import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class FailTransferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transferId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  errorMessage?: string;
}
