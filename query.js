const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const v = await prisma.sale.findMany({ where: { paymentMode: 'VOID' }, select: { id: true, totalAmount: true, cashAmount: true, cardAmount: true, quantityBottles: true } });
  console.log(JSON.stringify(v, null, 2));
  await prisma.$disconnect()
}
main();
