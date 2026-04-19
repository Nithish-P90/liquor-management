import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runValidations() {
  console.log('--- Starting Prisma Validation ---');
  let errors = 0;

  try {
    // 1. Staff & Attendance
    console.log('1. Testing Staff & Attendance...');
    const staff = await prisma.staff.create({
      data: {
        name: 'Test Validation Staff',
        email: 'testval@example.com',
        pin: '123456',
        role: 'CASHIER',
      }
    });
    
    await prisma.attendanceLog.create({
      data: {
        staffId: staff.id,
        date: new Date(),
        checkIn: new Date(),
        status: 'PRESENT'
      }
    });

    // 2. Product & ProductSize creation
    console.log('2. Testing Product & ProductSize...');
    const product = await prisma.product.create({
      data: {
        itemCode: 'VAL-1234',
        name: 'Validation Liquor',
        category: 'WHISKY'
      }
    });

    const productSize = await prisma.productSize.create({
      data: {
        productId: product.id,
        sizeMl: 750,
        bottlesPerCase: 12,
        barcode: 'VAL-BARCODE-750',
        mrp: 1000,
        sellingPrice: 950
      }
    });

    // 3. Inventory/Stock logic
    console.log('3. Testing Inventory/Stock Session...');
    const session = await prisma.inventorySession.create({
      data: {
        periodStart: new Date(),
        periodEnd: new Date(),
        staffId: staff.id
      }
    });

    await prisma.stockEntry.create({
      data: {
        sessionId: session.id,
        productSizeId: productSize.id,
        entryType: 'OPENING',
        cases: 5,
        bottles: 6,
        totalBottles: 66, // 5 * 12 + 6
      }
    });

    // 4. Liquor Sales
    console.log('4. Testing Liquor Sales...');
    await prisma.sale.create({
      data: {
        saleDate: new Date(),
        saleTime: new Date(),
        staffId: staff.id,
        productSizeId: productSize.id,
        quantityBottles: 2,
        sellingPrice: 950,
        totalAmount: 1900,
        paymentMode: 'CASH',
        scanMethod: 'MANUAL'
      }
    });

    // 5. Bank Transactions
    console.log('5. Testing Bank Transactions...');
    await prisma.bankTransaction.create({
      data: {
        txDate: new Date(),
        txType: 'DEPOSIT',
        amount: 5000,
        notes: 'Validation Deposit'
      }
    });

    // 6. Expenses (Expenditure)
    console.log('6. Testing Expenses...');
    await prisma.expenditure.create({
      data: {
        expDate: new Date(),
        particulars: 'Validation Expense',
        category: 'TEA',
        amount: 50
      }
    });

    console.log('--- All validations completed successfully! ---');

  } catch (error) {
    console.error('Validation Error encountered:', error);
    errors++;
  } finally {
    console.log('Cleaning up validation data...');
    try {
      // Clean up in reverse order to respect foreign constraints
      await prisma.expenditure.deleteMany({ where: { particulars: 'Validation Expense' } });
      await prisma.bankTransaction.deleteMany({ where: { notes: 'Validation Deposit' } });
      
      const testStaff = await prisma.staff.findUnique({ where: { email: 'testval@example.com' } });
      if (testStaff) {
        await prisma.sale.deleteMany({ where: { staffId: testStaff.id } });
        await prisma.stockEntry.deleteMany({ where: { session: { staffId: testStaff.id } } });
        await prisma.inventorySession.deleteMany({ where: { staffId: testStaff.id } });
        await prisma.attendanceLog.deleteMany({ where: { staffId: testStaff.id } });
      }

      await prisma.productSize.deleteMany({ where: { barcode: 'VAL-BARCODE-750' } });
      await prisma.product.deleteMany({ where: { itemCode: 'VAL-1234' } });
      
      if (testStaff) {
        await prisma.staff.delete({ where: { id: testStaff.id } });
      }
    } catch (cleanupError) {
      console.error('Cleanup Error:', cleanupError);
    }
    
    await prisma.$disconnect();
  }
}

runValidations();
