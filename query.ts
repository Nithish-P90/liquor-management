import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const v = await prisma.sale.findMany({ where: { paymentMode: 'VOID' }, select: { id: true, totalAmount: true, cashAmount: true, cardAmount: true, quantityBottles: true } });
  console.dir(v, {depth: null});
  await prisma.$disconnect()
}
main();
