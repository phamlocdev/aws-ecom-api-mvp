import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger'
import { CurrentUser } from '../auth/current-user.decorator'
import { AuthenticatedUser } from '../auth/auth.types'
import { CartsService } from './carts.service'
import { CreateCartDto } from './dto/create-cart.dto'
import { CartDetailsResponseDto, CartResponseDto } from './dto/cart-response.dto'
import { UpdateCartItemDto } from './dto/update-cart-item.dto'
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto'
import { Cart, CartDetails } from './cart.types'

@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(@Inject(CartsService) private readonly cartsService: CartsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a cart for the authenticated customer' })
  @ApiCreatedResponse({ type: CartResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartDto,
  ): Promise<Cart> {
    return this.cartsService.create(user, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List carts for the authenticated customer' })
  @ApiOkResponse({ type: CartResponseDto, isArray: true })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Cart[]> {
    return this.cartsService.findAllForCustomer(user)
  }

  @Get(':cartId')
  @ApiOperation({ summary: 'Get one cart with its items' })
  @ApiParam({ name: 'cartId', format: 'uuid' })
  @ApiOkResponse({ type: CartDetailsResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
  ): Promise<CartDetails> {
    return this.cartsService.findOneForCustomer(user, cartId)
  }

  @Post(':cartId/items')
  @ApiOperation({ summary: 'Add or replace an item in a cart' })
  @ApiParam({ name: 'cartId', format: 'uuid' })
  @ApiOkResponse({ type: CartDetailsResponseDto })
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Body() dto: UpsertCartItemDto,
  ): Promise<CartDetails> {
    return this.cartsService.addItem(user, cartId, dto)
  }

  @Patch(':cartId/items/:productId')
  @ApiOperation({ summary: 'Update quantity for a cart item' })
  @ApiOkResponse({ type: CartDetailsResponseDto })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDetails> {
    return this.cartsService.updateItem(user, cartId, productId, dto)
  }

  @Delete(':cartId/items/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an item from a cart' })
  @ApiNoContentResponse({ description: 'Cart item removed.' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Param('productId') productId: string,
  ): Promise<void> {
    await this.cartsService.removeItem(user, cartId, productId)
  }
}
