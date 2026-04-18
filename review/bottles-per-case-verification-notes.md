# Bottles Per Case Verification Notes

## What this sheet is
- File: `review/bottles-per-case-physical-sheet.csv`
- Generated from: `prisma/seed.ts`
- Source comment in code says this seed is based on the MV Physical Stock Sheet.

## What I understood from your request
- You want to verify how many bottles are in a case for each product/category.
- You want that list in a separate editable file so you can compare with physical stock sheet and adjust.

## Source of truth in app
- Database field: `ProductSize.bottlesPerCase` in `prisma/schema.prisma`
- Runtime inventory uses DB `bottlesPerCase` values.
- Indent parser has fallback defaults by size in `lib/pdf-parser.ts` (used when explicit values are missing in PDF text).

## Important
- Editing this CSV alone does not change live database values.
- To apply changes in app data, update through product APIs/UI import or run a DB update script/migration.

## Suggested review flow
1. Open `review/bottles-per-case-physical-sheet.csv`.
2. Compare against physical stock sheet.
3. Mark corrections in this CSV.
4. I can then generate a bulk update CSV or script to apply the corrected values safely.
