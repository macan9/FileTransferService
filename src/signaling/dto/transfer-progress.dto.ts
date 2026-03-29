import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class TransferProgressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transferId!: string;

  @IsString()
  @IsIn(['sending', 'receiving'])
  status!: 'sending' | 'receiving';
}
