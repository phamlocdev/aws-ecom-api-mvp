import { ApiProperty } from '@nestjs/swagger'
import { IsString, Matches, MinLength } from 'class-validator'

export class ResetManagedUserPasswordDto {
  @ApiProperty({ example: 'Temporary@123' })
  @IsString()
  @MinLength(8)
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/[0-9]/, { message: 'password must include a number' })
  password!: string
}
