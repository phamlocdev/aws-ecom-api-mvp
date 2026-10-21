import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { ALL_PERMISSIONS, Permission } from '../../../auth/permissions'
import { Role } from '../../../auth/roles.enum'

export class CreateManagedUserDto {
  @ApiProperty({ example: 'manager' })
  @IsString()
  username!: string

  @ApiProperty({ example: 'manager@example.com' })
  @IsEmail()
  email!: string

  @ApiProperty({ example: 'Manager@123' })
  @IsString()
  @MinLength(8)
  password!: string

  @ApiPropertyOptional({ example: 'Store Manager' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiProperty({ enum: [Role.CUSTOMER, Role.MANAGER, Role.ADMIN] })
  @IsIn([Role.CUSTOMER, Role.MANAGER, Role.ADMIN])
  group!: Role

  @ApiPropertyOptional({ enum: ALL_PERMISSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true })
  permissions?: Permission[]
}
