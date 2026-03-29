import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelConnectionRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  requestId!: string;
}
