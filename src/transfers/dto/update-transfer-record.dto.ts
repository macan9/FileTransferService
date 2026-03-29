import { IsIn, IsString } from 'class-validator';

export class UpdateTransferRecordDto {
  @IsString()
  @IsIn(['hide', 'restore'])
  action!: 'hide' | 'restore';
}
