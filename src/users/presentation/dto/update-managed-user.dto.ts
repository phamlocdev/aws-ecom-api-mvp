import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString } from 'class-validator'
import { UserAccountStatus } from '../../domain/user.entity'

export class UpdateManagedUserDto {
  @ApiPropertyOptional({ example: 'manager@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string

  @ApiPropertyOptional({ example: 'Store Manager' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'DELETED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL', 'DELETED'])
  status?: UserAccountStatus
}
