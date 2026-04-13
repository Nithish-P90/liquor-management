const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.staff.create({
    data: {
      name: 'Admin',
      email: 'admin@mv.com',
      role: 'ADMIN',
      pin: '1006',
      active: true,
    }
  });
  console.log('Admin account created with PIN: 1006');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
