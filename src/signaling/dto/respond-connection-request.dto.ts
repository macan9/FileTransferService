import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RespondConnectionRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  requestId!: string;

  @IsString()
  @IsIn(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected';
}
