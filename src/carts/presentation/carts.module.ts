import { Module } from '@nestjs/common'
import { CartsController } from './carts.controller'
import { CreateCartUseCase } from '../application/create-cart.use-case'
import { FindAllCartsUseCase } from '../application/find-all-carts.use-case'
import { FindOneCartUseCase } from '../application/find-one-cart.use-case'
import { AddCartItemUseCase } from '../application/add-cart-item.use-case'
import { UpdateCartItemUseCase } from '../application/update-cart-item.use-case'
import { RemoveCartItemUseCase } from '../application/remove-cart-item.use-case'
import { GetOwnedCartUseCase } from '../application/get-owned-cart.use-case'
import { GetCartItemsUseCase } from '../application/get-cart-items.use-case'
import { MarkCartExpiredUseCase } from '../application/mark-cart-expired.use-case'
import { CART_REPOSITORY } from '../domain/cart.repository.port'
import { DynamoDbCartRepository } from '../infrastructure/dynamodb-cart.repository'

@Module({
  controllers: [CartsController],
  providers: [
    CreateCartUseCase,
    FindAllCartsUseCase,
    FindOneCartUseCase,
    AddCartItemUseCase,
    UpdateCartItemUseCase,
    RemoveCartItemUseCase,
    GetOwnedCartUseCase,
    GetCartItemsUseCase,
    MarkCartExpiredUseCase,
    { provide: CART_REPOSITORY, useClass: DynamoDbCartRepository },
  ],
  exports: [GetOwnedCartUseCase, GetCartItemsUseCase, MarkCartExpiredUseCase],
})
export class CartsModule {}
