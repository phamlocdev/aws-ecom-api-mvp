import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsIn } from 'class-validator'
import { ALL_PERMISSIONS, Permission } from '../../../auth/permissions'

export class UpdateUserPermissionsDto {
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true })
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions!: Permission[]
}
