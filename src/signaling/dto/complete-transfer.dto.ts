import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompleteTransferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transferId!: string;
}
