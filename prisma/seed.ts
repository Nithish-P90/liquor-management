import { PrismaClient, Category } from '@prisma/client'
import { hash } from 'bcryptjs'

const prisma = new PrismaClient()

// Product seed data based on MV Physical Stock Sheet
// Format: [itemCode, name, category, sizes: [sizeMl, bottlesPerCase, mrp, sellingPrice]]
const products: [string, string, Category, [number, number, number, number][]][] = [
  // ─── BRANDY ────────────────────────────────────────────────────────────────
  ['B001', 'M H BRANDY', 'BRANDY', [[750,12,1050,1100],[375,24,525,550],[180,48,260,275],[90,96,140,150],[60,25,130,140]]],
  ['B002', 'MC BRANDY', 'BRANDY', [[750,12,820,860],[375,24,410,430],[180,48,200,210],[90,96,105,115]]],
  ['B003', 'O.C. BRANDY', 'BRANDY', [[750,12,380,400],[375,24,190,200],[180,48,95,105],[90,96,48,55]]],
  ['B004', 'O A BRANDY', 'BRANDY', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['B005', 'BEJOIS BRANDY', 'BRANDY', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],
  ['B006', 'MORPHIS BRANDY', 'BRANDY', [[750,12,1700,1800],[375,24,850,900],[180,48,420,450]]],
  ['B007', 'HONEY BEE BRANDY', 'BRANDY', [[750,12,820,860],[375,24,410,430],[180,48,200,210],[90,96,105,115]]],
  ['B008', 'COURIOR NEPOLIN BRANDY', 'BRANDY', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['B009', 'HONEY CUP BRANDY', 'BRANDY', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['B010', 'ROULETTE BRANDY', 'BRANDY', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],

  // ─── WHISKY ────────────────────────────────────────────────────────────────
  ['W001', 'M C WHISKY', 'WHISKY', [[750,12,1050,1100],[375,24,525,550],[180,48,260,275],[90,96,140,150]]],
  ['W002', 'BAGPIPER WHISKY', 'WHISKY', [[750,12,665,700],[375,24,332,350],[180,48,165,175],[90,96,83,90]]],
  ['W003', 'SIGNATURE WHISKY', 'WHISKY', [[750,12,1900,2000],[375,24,950,1000]]],
  ['W004', 'O T WHISKY', 'WHISKY', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['W005', 'DSP BLACK WHISKY', 'WHISKY', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],
  ['W006', 'O C WHISKY', 'WHISKY', [[750,12,380,400],[375,24,190,200],[180,48,95,105],[90,96,48,55]]],
  ['W007', 'R C WHISKY', 'WHISKY', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],
  ['W008', 'BLENDERS PRIDE WHISKY', 'WHISKY', [[750,12,1900,2000],[375,24,950,1000]]],
  ['W009', 'BANGALORE MALT WHISKY', 'WHISKY', [[750,12,820,860],[375,24,410,430]]],
  ['W010', 'ROYAL STAGE WHISKY', 'WHISKY', [[750,12,1050,1100],[375,24,525,550]]],
  ['W011', 'HAYWARDS WHISKY', 'WHISKY', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['W012', '8 PM WHISKY', 'WHISKY', [[750,12,665,700],[375,24,332,350],[180,48,165,175],[90,96,83,90]]],
  ['W013', 'IMPERIAL BLUE WHISKY', 'WHISKY', [[750,12,1050,1100],[375,24,525,550],[180,48,260,275]]],
  ['W014', 'BLACK DOG 8 YRS WHISKY', 'WHISKY', [[750,12,2580,2720],[375,24,1290,1360]]],
  ['W015', '100 PIPERS WHISKY', 'WHISKY', [[750,12,2580,2720],[375,24,1290,1360]]],
  ['W016', '8 PM BLUE WHISKY', 'WHISKY', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],
  ['W017', 'TEACHERS HIGH WHISKY', 'WHISKY', [[750,12,2580,2720],[375,24,1290,1360]]],
  ['W018', 'ANTIQUITY BLUE WHISKY', 'WHISKY', [[750,12,1900,2000],[375,24,950,1000]]],
  ['W019', 'VAT 69 WHISKY', 'WHISKY', [[750,12,1900,2000],[375,24,950,1000]]],
  ['W020', 'AFTER DARK WHISKY', 'WHISKY', [[750,12,665,700],[375,24,332,350]]],
  ['W021', 'CNB RED WHISKY', 'WHISKY', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['W022', 'ROYAL CHALLENGE WHISKY', 'WHISKY', [[750,12,1050,1100],[375,24,525,550],[180,48,260,275]]],

  // ─── RUM ───────────────────────────────────────────────────────────────────
  ['R001', 'HERCULES RUM', 'RUM', [[750,12,380,400],[375,24,190,200],[180,48,95,105],[90,96,48,55]]],
  ['R002', 'M C RUM', 'RUM', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],
  ['R003', 'OLD MONK RUM', 'RUM', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['R004', 'BAGPIPER RUM', 'RUM', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['R005', 'LEGACY RUM', 'RUM', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['R006', 'BANGALORE RUM', 'RUM', [[750,12,380,400],[375,24,190,200],[180,48,95,105]]],
  ['R007', 'AMRUT RUM', 'RUM', [[750,12,820,860],[375,24,410,430]]],
  ['R008', 'MC RUM CLASSIC', 'RUM', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['R009', 'BACARDI ORANGE APPLE LIME', 'RUM', [[750,12,1900,2000],[375,24,950,1000]]],
  ['R010', 'BLACK & WHITE 8 YRS', 'WHISKY', [[750,12,1900,2000],[375,24,950,1000]]],

  // ─── VODKA ─────────────────────────────────────────────────────────────────
  ['V001', 'SMIRNOFF VODKA', 'VODKA', [[750,12,1900,2000],[375,24,950,1000],[180,48,460,490]]],
  ['V002', 'ROMANOV VODKA', 'VODKA', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['V003', 'MUSCOVY VODKA', 'VODKA', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],
  ['V004', 'MUSCOVY LEMON VODKA', 'VODKA', [[750,12,665,700],[375,24,332,350]]],
  ['V005', 'MAGIC MOMENTS VODKA', 'VODKA', [[750,12,820,860],[375,24,410,430],[180,48,200,210]]],

  // ─── GIN ───────────────────────────────────────────────────────────────────
  ['G001', 'CARNIVAL GIN', 'GIN', [[750,12,665,700],[375,24,332,350],[180,48,165,175]]],

  // ─── WINE ──────────────────────────────────────────────────────────────────
  ['WN001', 'GONAS WINE', 'WINE', [[750,12,380,400],[375,24,190,200]]],
  ['WN002', 'MAGIC PORT WINE', 'WINE', [[750,12,380,400]]],
  ['WN003', 'SIDDUS WINE', 'WINE', [[750,12,380,400]]],
  ['WN004', 'VEGA WINE', 'WINE', [[750,12,380,400]]],
  ['WN005', 'TANGO RED WINE', 'WINE', [[750,12,380,400]]],

  // ─── PREMIX / RTD ──────────────────────────────────────────────────────────
  ['P001', 'BRO CODE', 'PREMIX', [[750,12,820,860],[375,24,410,430]]],
  ['P002', 'BACARDI BREEZER', 'PREMIX', [[330,24,165,180],[500,24,200,220]]],
  ['P003', 'BUZZ BALL', 'PREMIX', [[200,12,380,400]]],
  ['P004', 'FIREBALL CINNAMON WHISKY', 'PREMIX', [[750,12,1900,2000]]],
  ['P005', 'HUNTER', 'PREMIX', [[750,12,380,400],[375,24,190,200]]],
  ['P006', 'BACARDI COCKTAIL', 'PREMIX', [[375,24,410,430]]],

  // ─── BEER ──────────────────────────────────────────────────────────────────
  ['BR001', 'KINGFISHER PREMIUM BEER', 'BEER', [[650,12,205,220]]],
  ['BR002', 'KINGFISHER STRONG BEER', 'BEER', [[650,12,210,225]]],
  ['BR003', 'UB EXPORT PREMIUM LAGER', 'BEER', [[650,12,165,180]]],
  ['BR004', 'KNOCK OUT STRONG BEER', 'BEER', [[650,12,195,210]]],
  ['BR005', 'BUDWEISER MAGNUM BEER', 'BEER', [[650,12,260,275]]],
  ['BR006', 'BUDWEISER PREMIUM BEER', 'BEER', [[330,24,165,180]]],
  ['BR007', 'KINGFISHER ULTRA BEER', 'BEER', [[650,12,225,240]]],
  ['BR008', 'TUBORG STRONG PREMIUM BEER', 'BEER', [[650,12,210,225]]],
  ['BR009', 'TUBORG CLASSIC BEER', 'BEER', [[650,12,205,220],[330,24,130,145]]],
  ['BR010', 'POWERCOOL STRONG BEER', 'BEER', [[650,12,195,210],[330,24,115,128]]],
  ['BR011', 'RC BULLET BEER', 'BEER', [[650,12,195,210]]],
  ['BR012', 'CARLSBERG ELEPHANT STRONG BEER', 'BEER', [[650,12,265,280]]],
  ['BR013', 'SUNNY STRONG BEER', 'BEER', [[650,12,195,210]]],
  ['BR014', 'FOSTERS BEER', 'BEER', [[650,12,205,220]]],
  ['BR015', 'HEINEKEN BEER', 'BEER', [[650,12,280,295]]],
  ['BR016', 'ROYAL CHALLENGE STRONG PREMIUM BEER', 'BEER', [[650,12,210,225]]],
  ['BR017', 'KINGFISHER STRONG PREMIUM CAN', 'BEER', [[500,24,160,175]]],
  ['BR018', 'KINGFISHER WITT BEER', 'BEER', [[650,12,225,240]]],
  ['BR019', 'CORONA EXTRA BEER', 'BEER', [[330,24,230,250]]],

  // ─── BEVERAGES (non-alcoholic) ─────────────────────────────────────────────
  ['BV001', 'COOL DRINKS (PEPSI/COKE/SPRITE)', 'BEVERAGE', [[600,24,38,45],[500,24,32,40]]],
  ['BV002', 'SODA WATER', 'BEVERAGE', [[600,24,15,20]]],
  ['BV003', 'MINERAL WATER', 'BEVERAGE', [[1000,12,15,20],[500,24,10,15]]],
  ['BV004', 'RED BULL ENERGY DRINK', 'BEVERAGE', [[250,24,100,120]]],
]

async function main() {
  console.log('Seeding database...')

  // Create admin staff
  const adminHash = await hash('admin123', 10)
  const admin = await prisma.staff.upsert({
    where: { email: 'admin@mv.com' },
    update: {},
    create: {
      name: 'Admin',
      email: 'admin@mv.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      payrollType: 'SALARY',
      monthlySalary: 30000,
    },
  })
  console.log('✓ Admin staff created:', admin.email)

  // Create sample staff
  const staffHash = await hash('staff123', 10)
  await prisma.staff.upsert({
    where: { email: 'staff1@mv.com' },
    update: {},
    create: {
      name: 'Ravi Kumar',
      email: 'staff1@mv.com',
      passwordHash: staffHash,
      pin: '1234',
      role: 'CASHIER',
      payrollType: 'SALARY',
      monthlySalary: 15000,
    },
  })

  await prisma.staff.upsert({
    where: { email: 'staff2@mv.com' },
    update: {},
    create: {
      name: 'Suresh Babu',
      email: 'staff2@mv.com',
      passwordHash: staffHash,
      role: 'CLEANER',
      payrollType: 'DAILY',
      dailyWage: 600,
    },
  })
  console.log('✓ Staff created')

  // Create products
  let productCount = 0
  let sizeCount = 0

  for (const [itemCode, name, category, sizes] of products) {
    const product = await prisma.product.upsert({
      where: { itemCode },
      update: { name, category },
      create: { itemCode, name, category },
    })

    for (const [sizeMl, bottlesPerCase, mrp, sellingPrice] of sizes) {
      await prisma.productSize.upsert({
        where: { productId_sizeMl: { productId: product.id, sizeMl } },
        update: { mrp, sellingPrice, bottlesPerCase },
        create: {
          productId: product.id,
          sizeMl,
          bottlesPerCase,
          mrp,
          sellingPrice,
        },
      })
      sizeCount++
    }
    productCount++
  }

  console.log(`✓ ${productCount} products created with ${sizeCount} size variants`)

  // Seed default settings
  const defaults = [
    { key: 'variance_low_threshold', value: '2' },
    { key: 'variance_high_threshold', value: '5' },
    { key: 'low_stock_threshold', value: '6' },
    { key: 'shop_name', value: 'Mahavishnu Wines' },
    { key: 'license_id', value: '07458' },
    { key: 'owner_name', value: 'K-Munirathanam Naidu' },
  ]

  for (const s of defaults) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    })
  }
  console.log('✓ Default settings seeded')

  console.log('\n✅ Database seeded successfully!')
  console.log('\nLogin credentials:')
  console.log('  Admin: admin@mv.com / admin123')
  console.log('  Staff PIN: 1234 (Ravi Kumar)')
  console.log('  Admin: admin@mv.com (email/password login)')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
