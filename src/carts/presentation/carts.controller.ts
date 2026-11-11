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
import { CurrentUser } from '../../auth/current-user.decorator'
import { AuthenticatedUser } from '../../auth/auth.types'
import { Cart, CartDetails } from '../domain/cart.entity'
import { CreateCartUseCase } from '../application/create-cart.use-case'
import { FindAllCartsUseCase } from '../application/find-all-carts.use-case'
import { FindOneCartUseCase } from '../application/find-one-cart.use-case'
import { AddCartItemUseCase } from '../application/add-cart-item.use-case'
import { UpdateCartItemUseCase } from '../application/update-cart-item.use-case'
import { RemoveCartItemUseCase } from '../application/remove-cart-item.use-case'
import { CreateCartDto } from './dto/create-cart.dto'
import { CartDetailsResponseDto, CartResponseDto } from './dto/cart-response.dto'
import { UpdateCartItemDto } from './dto/update-cart-item.dto'
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto'

@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(
    @Inject(CreateCartUseCase) private readonly createCartUseCase: CreateCartUseCase,
    @Inject(FindAllCartsUseCase) private readonly findAllCartsUseCase: FindAllCartsUseCase,
    @Inject(FindOneCartUseCase) private readonly findOneCartUseCase: FindOneCartUseCase,
    @Inject(AddCartItemUseCase) private readonly addCartItemUseCase: AddCartItemUseCase,
    @Inject(UpdateCartItemUseCase) private readonly updateCartItemUseCase: UpdateCartItemUseCase,
    @Inject(RemoveCartItemUseCase) private readonly removeCartItemUseCase: RemoveCartItemUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a cart for the authenticated customer' })
  @ApiCreatedResponse({ type: CartResponseDto })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCartDto,
  ): Promise<Cart> {
    return this.createCartUseCase.execute(user, { ttlDays: dto.ttlDays })
  }

  @Get()
  @ApiOperation({ summary: 'List carts for the authenticated customer' })
  @ApiOkResponse({ type: CartResponseDto, isArray: true })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Cart[]> {
    return this.findAllCartsUseCase.execute(user)
  }

  @Get(':cartId')
  @ApiOperation({ summary: 'Get one cart with its items' })
  @ApiParam({ name: 'cartId', format: 'uuid' })
  @ApiOkResponse({ type: CartDetailsResponseDto })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
  ): Promise<CartDetails> {
    return this.findOneCartUseCase.execute(user, cartId)
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
    return this.addCartItemUseCase.execute(user, cartId, {
      productId: dto.productId,
      quantity: dto.quantity,
    })
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
    return this.updateCartItemUseCase.execute(user, cartId, productId, dto.quantity)
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
    await this.removeCartItemUseCase.execute(user, cartId, productId)
  }
}
