import { Body, Controller, Inject, Post, Req } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { AuthenticatedRequest } from '../auth/auth.types'
import { Role } from '../auth/roles.enum'
import { Roles } from '../auth/roles.decorator'
import { PresignUploadRequestDto, PresignUploadResponseDto } from './dto/presign-upload.dto'
import { UploadService } from './upload.service'

@ApiTags('upload')
@Controller('upload')
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploadService: UploadService) {}

  @Post('presign')
  @Roles(Role.CUSTOMER, Role.MANAGER, Role.ADMIN)
  @ApiOperation({ summary: 'Create direct-to-S3 upload policies' })
  @ApiOkResponse({ type: PresignUploadResponseDto })
  @ApiBadRequestResponse({ description: 'The upload request is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required.' })
  @ApiForbiddenResponse({ description: 'The authenticated user cannot upload for this target.' })
  presign(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PresignUploadRequestDto,
  ): Promise<PresignUploadResponseDto> {
    return this.uploadService.createPresignedUploadPolicies(dto, request.user!)
  }
}
