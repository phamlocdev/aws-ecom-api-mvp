import { ProductStatus } from '../products/domain/product-status.enum'
import { stableUuid } from './script-helpers'

export type SeedCategory = {
  categoryId: string
  name: string
  description: string
}

export type SeedProduct = {
  productId: string
  categoryId: string
  name: string
  description: string
  price: number
  currency: 'VND'
  status: ProductStatus
  seedKey: string
}

type CategoryDefinition = {
  categoryId: string
  name: string
  description: string
  products: Array<{
    slug: string
    name: string
    description: string
    price: number
  }>
}

const categoryDefinitions: CategoryDefinition[] = [
  {
    categoryId: 'electronics',
    name: 'Electronics',
    description: 'Audio, mobile, and desktop accessories.',
    products: [
      {
        slug: 'oversell-headphones',
        name: 'Flash Sale Headphones',
        description: 'Noise cancelling wireless headphones for oversell testing.',
        price: 1899000,
      },
      {
        slug: 'mechanical-keyboard',
        name: 'Mechanical Keyboard',
        description: 'Compact hot swap keyboard with tactile switches.',
        price: 1599000,
      },
      {
        slug: 'usb-c-hub',
        name: 'USB-C Hub',
        description: 'Seven port hub with HDMI and Ethernet.',
        price: 899000,
      },
      {
        slug: 'portable-monitor',
        name: 'Portable Monitor',
        description: 'Fifteen inch USB-C monitor for hybrid work.',
        price: 3299000,
      },
      {
        slug: 'webcam-pro',
        name: 'Webcam Pro',
        description: 'Full HD webcam with stereo microphones.',
        price: 1299000,
      },
      {
        slug: 'gaming-mouse',
        name: 'Gaming Mouse',
        description: 'Wireless gaming mouse with low latency sensor.',
        price: 999000,
      },
      {
        slug: 'desk-speakers',
        name: 'Desk Speakers',
        description: 'Powered bookshelf speakers for desks.',
        price: 2099000,
      },
      {
        slug: 'wireless-charger',
        name: 'Wireless Charger',
        description: 'Fast charging pad for phones and earbuds.',
        price: 499000,
      },
      {
        slug: 'bluetooth-tracker',
        name: 'Bluetooth Tracker',
        description: 'Compact tracker for bags and keys.',
        price: 349000,
      },
      {
        slug: 'smart-plug',
        name: 'Smart Plug',
        description: 'Wi-Fi smart plug with energy monitoring.',
        price: 279000,
      },
    ],
  },
  {
    categoryId: 'home-living',
    name: 'Home Living',
    description: 'Functional pieces for daily home use.',
    products: [
      {
        slug: 'linen-sheet-set',
        name: 'Linen Sheet Set',
        description: 'Breathable four piece linen bedding set.',
        price: 2499000,
      },
      {
        slug: 'ceramic-lamp',
        name: 'Ceramic Lamp',
        description: 'Desk lamp with soft warm light.',
        price: 1199000,
      },
      {
        slug: 'storage-baskets',
        name: 'Storage Baskets',
        description: 'Set of woven baskets for shelves.',
        price: 699000,
      },
      {
        slug: 'wall-mirror',
        name: 'Wall Mirror',
        description: 'Round mirror with matte black frame.',
        price: 1899000,
      },
      {
        slug: 'aroma-diffuser',
        name: 'Aroma Diffuser',
        description: 'Ultrasonic diffuser with timer presets.',
        price: 749000,
      },
      {
        slug: 'throw-blanket',
        name: 'Throw Blanket',
        description: 'Soft cotton blanket for sofa and bed.',
        price: 599000,
      },
      {
        slug: 'shoe-rack',
        name: 'Shoe Rack',
        description: 'Slim steel rack for entryway storage.',
        price: 899000,
      },
      {
        slug: 'laundry-hamper',
        name: 'Laundry Hamper',
        description: 'Foldable hamper with dual compartments.',
        price: 459000,
      },
      {
        slug: 'glass-vase',
        name: 'Glass Vase',
        description: 'Clear vase for fresh and dried flowers.',
        price: 329000,
      },
      {
        slug: 'bath-mat',
        name: 'Bath Mat',
        description: 'Quick dry bath mat with anti slip base.',
        price: 269000,
      },
    ],
  },
  {
    categoryId: 'fashion',
    name: 'Fashion',
    description: 'Everyday clothing and accessories.',
    products: [
      {
        slug: 'canvas-tote',
        name: 'Canvas Tote',
        description: 'Durable tote bag with inside pocket.',
        price: 429000,
      },
      {
        slug: 'denim-jacket',
        name: 'Denim Jacket',
        description: 'Classic mid wash denim jacket.',
        price: 1299000,
      },
      {
        slug: 'oversized-tee',
        name: 'Oversized Tee',
        description: 'Heavyweight cotton tee for daily wear.',
        price: 329000,
      },
      {
        slug: 'leather-belt',
        name: 'Leather Belt',
        description: 'Full grain leather belt with matte buckle.',
        price: 459000,
      },
      {
        slug: 'running-cap',
        name: 'Running Cap',
        description: 'Lightweight cap with breathable mesh.',
        price: 249000,
      },
      {
        slug: 'weekender-bag',
        name: 'Weekender Bag',
        description: 'Carryall duffel bag for short trips.',
        price: 999000,
      },
      {
        slug: 'ankle-socks-pack',
        name: 'Ankle Socks Pack',
        description: 'Five pack of cushioned ankle socks.',
        price: 179000,
      },
      {
        slug: 'hooded-parka',
        name: 'Hooded Parka',
        description: 'Water resistant parka for light rain.',
        price: 1899000,
      },
      {
        slug: 'crossbody-bag',
        name: 'Crossbody Bag',
        description: 'Compact bag for phone and essentials.',
        price: 559000,
      },
      {
        slug: 'slim-wallet',
        name: 'Slim Wallet',
        description: 'Minimal wallet with RFID lining.',
        price: 399000,
      },
    ],
  },
  {
    categoryId: 'beauty',
    name: 'Beauty',
    description: 'Skin, body, and grooming essentials.',
    products: [
      {
        slug: 'gel-cleanser',
        name: 'Gel Cleanser',
        description: 'Daily cleanser for combination skin.',
        price: 269000,
      },
      {
        slug: 'vitamin-c-serum',
        name: 'Vitamin C Serum',
        description: 'Brightening serum for morning routine.',
        price: 499000,
      },
      {
        slug: 'sunscreen-spf50',
        name: 'Sunscreen SPF50',
        description: 'Lightweight sunscreen with no white cast.',
        price: 349000,
      },
      {
        slug: 'body-lotion',
        name: 'Body Lotion',
        description: 'Hydrating lotion with oat extract.',
        price: 289000,
      },
      {
        slug: 'hair-mask',
        name: 'Hair Mask',
        description: 'Repair mask for dry and damaged hair.',
        price: 379000,
      },
      {
        slug: 'lip-balm',
        name: 'Lip Balm',
        description: 'Moisturizing balm with natural wax.',
        price: 119000,
      },
      {
        slug: 'cleansing-oil',
        name: 'Cleansing Oil',
        description: 'Makeup remover for waterproof products.',
        price: 399000,
      },
      {
        slug: 'hand-cream',
        name: 'Hand Cream',
        description: 'Fast absorbing hand cream for daily use.',
        price: 149000,
      },
      {
        slug: 'beard-trimmer',
        name: 'Beard Trimmer',
        description: 'Cordless trimmer with precision guard.',
        price: 899000,
      },
      {
        slug: 'facial-toner',
        name: 'Facial Toner',
        description: 'Balancing toner with low irritation formula.',
        price: 259000,
      },
    ],
  },
  {
    categoryId: 'sports-outdoors',
    name: 'Sports Outdoors',
    description: 'Gear for training and outdoor routines.',
    products: [
      {
        slug: 'yoga-mat',
        name: 'Yoga Mat',
        description: 'Non slip mat with dense cushioning.',
        price: 599000,
      },
      {
        slug: 'resistance-bands',
        name: 'Resistance Bands',
        description: 'Five band set for mobility and strength.',
        price: 259000,
      },
      {
        slug: 'insulated-bottle',
        name: 'Insulated Bottle',
        description: 'One liter bottle that keeps drinks cold.',
        price: 429000,
      },
      {
        slug: 'camping-chair',
        name: 'Camping Chair',
        description: 'Foldable chair with cup holder.',
        price: 799000,
      },
      {
        slug: 'hiking-poles',
        name: 'Hiking Poles',
        description: 'Adjustable poles with cork grips.',
        price: 1099000,
      },
      {
        slug: 'jump-rope',
        name: 'Jump Rope',
        description: 'Speed rope with bearing handles.',
        price: 199000,
      },
      {
        slug: 'gym-duffel',
        name: 'Gym Duffel',
        description: 'Training bag with wet compartment.',
        price: 699000,
      },
      {
        slug: 'foam-roller',
        name: 'Foam Roller',
        description: 'Textured roller for post workout recovery.',
        price: 349000,
      },
      {
        slug: 'headlamp',
        name: 'Headlamp',
        description: 'Rechargeable headlamp for running and hiking.',
        price: 459000,
      },
      {
        slug: 'picnic-blanket',
        name: 'Picnic Blanket',
        description: 'Water resistant picnic blanket for parks.',
        price: 379000,
      },
    ],
  },
  {
    categoryId: 'books-stationery',
    name: 'Books Stationery',
    description: 'Planning, note taking, and reading accessories.',
    products: [
      {
        slug: 'daily-planner',
        name: 'Daily Planner',
        description: 'Undated planner for tasks and goals.',
        price: 249000,
      },
      {
        slug: 'fountain-pen',
        name: 'Fountain Pen',
        description: 'Metal fountain pen with fine nib.',
        price: 529000,
      },
      {
        slug: 'dot-grid-notebook',
        name: 'Dot Grid Notebook',
        description: 'A5 notebook for sketches and notes.',
        price: 149000,
      },
      {
        slug: 'book-light',
        name: 'Book Light',
        description: 'Clip on reading light with warm LEDs.',
        price: 219000,
      },
      {
        slug: 'desk-organizer',
        name: 'Desk Organizer',
        description: 'Wood organizer for pens and cards.',
        price: 319000,
      },
      {
        slug: 'sticky-notes-set',
        name: 'Sticky Notes Set',
        description: 'Color coded notes and page flags.',
        price: 99000,
      },
      {
        slug: 'reading-journal',
        name: 'Reading Journal',
        description: 'Track books, quotes, and reviews.',
        price: 179000,
      },
      {
        slug: 'gel-pen-pack',
        name: 'Gel Pen Pack',
        description: 'Smooth ink pens in assorted colors.',
        price: 129000,
      },
      {
        slug: 'laptop-stand',
        name: 'Laptop Stand',
        description: 'Foldable stand for ergonomic writing setup.',
        price: 459000,
      },
      {
        slug: 'document-folder',
        name: 'Document Folder',
        description: 'Expandable folder for papers and receipts.',
        price: 139000,
      },
    ],
  },
  {
    categoryId: 'kitchen-dining',
    name: 'Kitchen Dining',
    description: 'Prep tools and tableware for home cooking.',
    products: [
      {
        slug: 'chef-knife',
        name: 'Chef Knife',
        description: 'Eight inch stainless steel knife.',
        price: 899000,
      },
      {
        slug: 'cutting-board',
        name: 'Cutting Board',
        description: 'Large bamboo board for prep work.',
        price: 349000,
      },
      {
        slug: 'coffee-scale',
        name: 'Coffee Scale',
        description: 'Precision scale for pour over brewing.',
        price: 559000,
      },
      {
        slug: 'glass-food-box',
        name: 'Glass Food Box',
        description: 'Leak resistant storage container set.',
        price: 399000,
      },
      {
        slug: 'cast-iron-pan',
        name: 'Cast Iron Pan',
        description: 'Pre seasoned skillet for stovetop use.',
        price: 1099000,
      },
      {
        slug: 'tea-kettle',
        name: 'Tea Kettle',
        description: 'Gooseneck kettle for manual brewing.',
        price: 799000,
      },
      {
        slug: 'ceramic-bowl-set',
        name: 'Ceramic Bowl Set',
        description: 'Four piece bowl set for soup and rice.',
        price: 459000,
      },
      {
        slug: 'apron',
        name: 'Kitchen Apron',
        description: 'Cotton apron with front pockets.',
        price: 239000,
      },
      {
        slug: 'spice-rack',
        name: 'Spice Rack',
        description: 'Countertop rack with twelve jars.',
        price: 699000,
      },
      {
        slug: 'salad-spinner',
        name: 'Salad Spinner',
        description: 'Large spinner for greens and herbs.',
        price: 379000,
      },
    ],
  },
  {
    categoryId: 'pets',
    name: 'Pets',
    description: 'Daily supplies for cats and dogs.',
    products: [
      {
        slug: 'pet-bed',
        name: 'Pet Bed',
        description: 'Washable bed with raised bolsters.',
        price: 799000,
      },
      {
        slug: 'slow-feeder',
        name: 'Slow Feeder',
        description: 'Bowl designed to reduce fast eating.',
        price: 229000,
      },
      {
        slug: 'cat-scratcher',
        name: 'Cat Scratcher',
        description: 'Corrugated lounge scratcher.',
        price: 319000,
      },
      {
        slug: 'leash-set',
        name: 'Leash Set',
        description: 'Matching harness and leash set.',
        price: 499000,
      },
      {
        slug: 'travel-carrier',
        name: 'Travel Carrier',
        description: 'Soft sided carrier for vet visits.',
        price: 899000,
      },
      {
        slug: 'treat-pouch',
        name: 'Treat Pouch',
        description: 'Training pouch with clip and zipper.',
        price: 179000,
      },
      {
        slug: 'water-fountain',
        name: 'Water Fountain',
        description: 'Filtered fountain for cats and small dogs.',
        price: 649000,
      },
      {
        slug: 'grooming-brush',
        name: 'Grooming Brush',
        description: 'Deshedding brush for long coats.',
        price: 249000,
      },
      {
        slug: 'litter-mat',
        name: 'Litter Mat',
        description: 'Double layer mat for tracking control.',
        price: 289000,
      },
      {
        slug: 'pet-toy-pack',
        name: 'Pet Toy Pack',
        description: 'Mixed toy bundle for daily play.',
        price: 219000,
      },
    ],
  },
  {
    categoryId: 'office',
    name: 'Office',
    description: 'Workspace gear for focus and comfort.',
    products: [
      {
        slug: 'ergonomic-chair',
        name: 'Ergonomic Chair',
        description: 'Adjustable mesh chair with lumbar support.',
        price: 4299000,
      },
      {
        slug: 'monitor-arm',
        name: 'Monitor Arm',
        description: 'Gas spring arm for ultrawide monitors.',
        price: 1599000,
      },
      {
        slug: 'desk-mat',
        name: 'Desk Mat',
        description: 'Large desk mat for keyboard and mouse.',
        price: 349000,
      },
      {
        slug: 'cable-organizer',
        name: 'Cable Organizer',
        description: 'Under desk tray with cable ties.',
        price: 289000,
      },
      {
        slug: 'whiteboard',
        name: 'Whiteboard',
        description: 'Magnetic whiteboard for weekly planning.',
        price: 749000,
      },
      {
        slug: 'foot-rest',
        name: 'Foot Rest',
        description: 'Adjustable foot rest for seated work.',
        price: 429000,
      },
      {
        slug: 'usb-microphone',
        name: 'USB Microphone',
        description: 'Podcast microphone with desk stand.',
        price: 1899000,
      },
      {
        slug: 'desk-fan',
        name: 'Desk Fan',
        description: 'Quiet USB desk fan with three speeds.',
        price: 329000,
      },
      {
        slug: 'label-maker',
        name: 'Label Maker',
        description: 'Portable label maker for office storage.',
        price: 1099000,
      },
      {
        slug: 'document-scanner',
        name: 'Document Scanner',
        description: 'Compact scanner for receipts and notes.',
        price: 2699000,
      },
    ],
  },
  {
    categoryId: 'toys-games',
    name: 'Toys Games',
    description: 'Family play and hobby items.',
    products: [
      {
        slug: 'board-game',
        name: 'Strategy Board Game',
        description: 'Ninety minute strategy game for four players.',
        price: 999000,
      },
      {
        slug: 'puzzle-1000',
        name: 'Puzzle 1000 Pieces',
        description: 'Landscape puzzle with matte finish.',
        price: 279000,
      },
      {
        slug: 'building-blocks',
        name: 'Building Blocks',
        description: 'Creative block set for ages six and up.',
        price: 699000,
      },
      {
        slug: 'card-game',
        name: 'Party Card Game',
        description: 'Fast paced card game for groups.',
        price: 249000,
      },
      {
        slug: 'rc-car',
        name: 'RC Car',
        description: 'Rechargeable remote control car.',
        price: 1299000,
      },
      {
        slug: 'paint-by-numbers',
        name: 'Paint by Numbers Kit',
        description: 'Beginner kit with canvas and brushes.',
        price: 319000,
      },
      {
        slug: 'chess-set',
        name: 'Wood Chess Set',
        description: 'Portable folding chess board.',
        price: 559000,
      },
      {
        slug: 'yo-yo',
        name: 'Metal Yo-Yo',
        description: 'Responsive yo-yo for basic tricks.',
        price: 199000,
      },
      {
        slug: 'mini-drone',
        name: 'Mini Drone',
        description: 'Indoor drone with propeller guards.',
        price: 1499000,
      },
      {
        slug: 'craft-beads',
        name: 'Craft Beads Set',
        description: 'Colorful bead set for hobby projects.',
        price: 189000,
      },
    ],
  },
]

export const overSellProductSeedKey = 'electronics:oversell-headphones'
export const overSellProductId = stableUuid(`seed-product:${overSellProductSeedKey}`)

export function buildSeedCategories(): SeedCategory[] {
  return categoryDefinitions.map(({ categoryId, name, description }) => ({
    categoryId,
    name,
    description,
  }))
}

export function buildSeedProducts(): SeedProduct[] {
  return categoryDefinitions.flatMap((category) =>
    category.products.map((product) => {
      const seedKey = `${category.categoryId}:${product.slug}`

      return {
        productId: stableUuid(`seed-product:${seedKey}`),
        categoryId: category.categoryId,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: 'VND' as const,
        status: ProductStatus.ACTIVE,
        seedKey,
      }
    }),
  )
}

export function getInventoryQuantity(productIndex: number): number {
  if (productIndex === 0) {
    return 2
  }

  const mod = productIndex % 10
  if (mod === 0) {
    return 0
  }
  if (mod <= 2) {
    return mod + 1
  }
  if (mod <= 5) {
    return 5 + mod
  }
  return 20 + mod * 3
}
