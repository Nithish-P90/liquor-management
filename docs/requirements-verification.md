# End-to-End Requirements Verification

## Purpose

This document translates the bar's operating model into a verifiable software scope for the existing `liquor-management` application.

It is written for a Karnataka liquor outlet where:

- the owner controls all liquor inventory and liquor revenue
- the cashier may sell low-value non-liquor items such as cigarettes, snacks, and glasses
- the customer must receive one combined bill
- the owner's and cashier's tallies must remain separate
- cashier reimbursement must be calculated exactly from valid misc-item sales
- fraud opportunities such as bogus item scans, inflated misc billing, void abuse, and stock manipulation must be tightly controlled

## Important Reality Check

No software can honestly guarantee `100 percent` accuracy in the real world, because physical stock handling, barcode labels, network failures, hardware faults, and human actions can all introduce risk.

What we can build is a `high-assurance` system with:

- transactional writes
- immutable audit trails
- strict role controls
- barcode-first selling
- shift locking
- reconciliation workflows
- variance alerts
- approval gates
- evidence capture for exceptions

That is the correct path to achieving `practical near-zero accounting leakage`.

## Your Required Business Model

### 1. Dual-Entity Sale Model

Every checkout may contain two economic buckets:

- `Owner bucket`: liquor items and any owner-controlled inventory
- `Cashier bucket`: cigarettes, snacks, cups, glasses, and other petty resale items owned by the cashier

Customer experience:

- one bill
- one payment collection flow
- one checkout operator

Back-office accounting:

- separate ledger totals for owner and cashier items
- separate inventory depletion rules
- separate settlement calculation
- cashier payable computed from approved cashier-bucket sales only

### 2. Cashier Reimbursement Rule

The system must compute:

- `gross bill total`
- `owner share`
- `cashier share`
- `net amount due to owner after reimbursable cashier goods`

Formula:

- `gross bill = owner items + cashier items`
- `cashier reimbursement payable = validated cashier item total`
- `owner net collectible = gross bill - cashier reimbursement payable`

This calculation must be visible in:

- bill printout
- daily closing
- cashier settlement
- owner daybook
- audit reports

## Required Modules

## 1. Liquor Inventory Management

Required capabilities:

- product master with KSBCL item code, name, category, size, barcode, MRP, selling price
- case and bottle tracking
- opening stock entry
- indent entry and supplier receipt capture
- daily sales deduction
- adjustment handling for breakage, returns, theft write-off, and corrections
- closing stock entry
- daily reconciliation of expected vs physical stock
- severity-based variance reporting
- locked sessions after closing approval

Current repo status:

- `Implemented in data model and core logic`
- evidence: `prisma/schema.prisma`, `lib/stock.ts`, `lib/reconciliation.ts`, `lib/rollover.ts`

Gaps:

- operational UI screens are mostly scaffolded
- no completed transaction entry flow for live selling from POS yet
- no complete approval workflow UI for stock adjustments and day close

## 2. Misc Inventory for Cashier-Owned Goods

Required capabilities:

- separate item master for cigarettes, snacks, cups, glasses, and similar low-value items
- barcode support for misc items
- unit-based stock
- purchases or opening quantity for cashier-owned goods
- sales ledger by item, cashier, date, and bill
- shrinkage/shortage reporting
- settlement report showing what the owner owes the cashier

Current repo status:

- `Partially modeled`
- evidence: `MiscItem` and `MiscSale` models in `prisma/schema.prisma`

Gaps:

- no stock-on-hand table for misc items yet
- no intake or adjustment workflow for misc goods
- no fraud-proof settlement logic tying misc sales to a combined bill

## 3. Unified POS With Split Accounting

This is the most important requirement in your brief.

The POS must support one cart but two ledgers.

Required checkout design:

- one barcode-scanning cart
- automatic item classification into `OWNER` or `CASHIER`
- visible split summary before payment
- payment mode capture
- printed or digital bill with both sections
- posting into separate ledgers after checkout commit

Minimum standard POS features required:

- barcode scanner input support
- camera barcode fallback
- quick item search
- quantity edit
- item hold and resume
- bill void with reason
- refund or return workflow
- split payment modes
- discount control with approval
- pending bill or credit sale
- reprint bill
- cashier shift open/close
- customer name or phone on optional bills
- end-of-day Z report

Current repo status:

- `Partially modeled but not operational`
- evidence: `Sale`, `PendingBill`, `PaymentMode`, `ScanMethod`, `/app/(app)/pos/page.tsx`

Gaps:

- POS screen is still scaffolded
- bill header and bill-line model is missing, so combined owner-plus-cashier billing is not yet represented correctly
- current `Sale` and `MiscSale` records are separate but not tied to one unified bill transaction
- no anti-fraud approval rules for misc overbilling, suspicious voids, or manual price overrides

## 4. Accounting and Cash Control

Required capabilities:

- owner liquor sales ledger
- cashier misc sales ledger
- combined collections ledger
- cashier reimbursement payable ledger
- daily cash book
- payment-mode summary
- expenses entry
- bank deposit tracking
- credit sales and settlement
- pending bill aging
- day-close statement
- month-end export

Current repo status:

- `Partially implemented in schema`
- evidence: `CashRecord`, `Expenditure`, `BankTransaction`, `PendingBill`

Gaps:

- no finalized settlement engine for cashier reimbursement
- no day-close workflow that blocks closure until stock and cash are reconciled
- no voucher-style accounting journal entries yet

## 5. Facial Attendance

Required capabilities:

- staff enrollment with multiple face samples
- threshold-based matching
- check-in and check-out logging
- late arrival reporting
- attendance dashboard
- manual fallback with audit note
- device capture log

Current repo status:

- `Well-modeled at database level, UI pending`
- evidence: `FaceProfile`, `FaceSample`, `AttendanceLog`, `/app/(app)/attendance/page.tsx`

Gaps:

- no live face capture or recognition flow in the app yet
- no liveness detection or anti-spoofing controls
- no supervisor approval flow for manual override attendance

## 6. Audit and Anti-Fraud Controls

Required controls:

- every bill must have a unique immutable bill number
- every line item must retain barcode, price, quantity, operator, and timestamp
- manual item addition must be flagged
- manual price override must require reason and optional supervisor PIN
- voids must require reason and supervisor approval after threshold
- cashier misc-item reimbursement must only be based on settled, non-voided, stock-backed sales
- suspicious patterns must trigger alerts

Examples of suspicious patterns:

- misc sales volume far above typical daily average
- repeated misc scans followed by voids
- high manual-entry ratio for barcode-enabled items
- same cashier repeatedly selling items without stock deduction trail
- mismatch between cashier misc sales and opening-plus-purchase-less-closing quantity

Current repo status:

- `Some audit fields exist, but the fraud-control layer is incomplete`
- evidence: `overrideReason`, `isManualOverride`, `isVoided`, `voidReason`

Gaps:

- no bill-level immutable ledger record
- no anomaly detection jobs
- no supervisor workflow
- no shift-based exception reporting

## Data Integrity Requirements

To keep the system extremely precise, the following rules are mandatory:

1. Every checkout must be committed in a single database transaction.
2. A combined bill must write:
   - bill header
   - bill line items
   - owner sale rows
   - cashier sale rows
   - payment rows
   - stock deductions
   - audit log row
3. If any one write fails, the full checkout must fail.
4. Stock must never go negative without an approved override event.
5. Closed inventory sessions must be immutable except through an auditable correction workflow.
6. Attendance edits must preserve original clock data.
7. Deletions should be logical, not physical, for financial records.
8. Decimal money handling must remain decimal in storage and calculation paths.
9. Bills, settlements, and day-close records must be idempotent to prevent duplicate posting.
10. Timezone handling must be fixed to the outlet's local business day.

## Recommended Data Model Changes

The current schema is a strong foundation, but your dual-entity billing model needs several structural additions.

Required additions:

- `Bill`
  - bill number
  - outlet business date
  - operator
  - status
  - gross total
  - owner total
  - cashier total
  - net owner collectible
  - void metadata

- `BillLine`
  - bill id
  - entity owner type: `OWNER` or `CASHIER`
  - source item type: `LIQUOR` or `MISC`
  - source item id
  - barcode snapshot
  - item name snapshot
  - quantity
  - unit price
  - line total
  - manual-entry flags

- `PaymentAllocation`
  - bill id
  - mode
  - amount

- `CashierSettlement`
  - cashier
  - business date or shift
  - approved misc sales total
  - deductions
  - reimbursable amount
  - paid amount
  - paid at
  - paid by

- `MiscInventoryLedger`
  - opening
  - inward
  - sale
  - adjustment
  - closing

- `AuditEvent`
  - actor
  - event type
  - entity
  - entity id
  - before snapshot
  - after snapshot
  - reason

Without these tables, the system cannot fully and safely represent your combined-bill but split-tally requirement.

## End-to-End Verification of Your Build Criteria

### Covered Today

- liquor product master
- liquor sizes and barcodes
- indent and receipt data model
- liquor stock calculation engine
- variance recording
- staff and role records
- face profile and attendance data model
- misc item and misc sale data model
- cash, expense, and bank record models
- product CRUD API foundation

### Not Yet Covered End to End

- live barcode POS checkout
- unified bill for liquor plus cashier items
- cashier reimbursement engine
- misc inventory stock ledger
- robust fraud detection
- bill reprint, refunds, and settlement workflows
- day-close enforcement workflow
- live facial recognition attendance flow
- supervisor approval and exception management
- operational dashboards and reports

## Acceptance Criteria for Production Readiness

The software should not be called production-ready until all of the following are true:

1. A single mixed bill can be created with liquor and misc items in one checkout.
2. The bill stores separate owner and cashier subtotals.
3. Cashier reimbursement can be computed exactly from approved misc line items.
4. Misc items cannot be reimbursed unless stock exists or an approved override is recorded.
5. Liquor stock movement is fully traceable from opening to closing.
6. Physical closing stock can be entered and reconciled daily.
7. Variances produce alerts and require resolution notes.
8. Manual overrides, voids, and discounts are fully audited.
9. Day close cannot finish while critical mismatches remain unresolved.
10. Attendance supports face-based logging and manual fallback with audit trail.
11. Reports can reproduce any day’s bills, collections, stock movement, and settlements exactly.
12. Backups, restore drills, and export capability are proven.

## Recommended Build Sequence

To reduce risk, implementation should happen in this order:

1. `Bill`, `BillLine`, `PaymentAllocation`, `CashierSettlement`, and `AuditEvent` schema additions
2. unified POS transaction engine with barcode-first flow
3. misc inventory ledger and cashier reimbursement logic
4. day-close and reconciliation lock workflow
5. dashboards and audit reports
6. facial attendance capture and verification

## Final Verification Statement

Your business brief is coherent and buildable, but the current repository is `not yet end-to-end compliant` with the required operating model.

Best current assessment:

- `Foundation strength`: good
- `Data model coverage`: moderate
- `Operational UI readiness`: low to moderate
- `POS readiness`: low
- `Fraud-control readiness`: low
- `Attendance readiness`: low to moderate
- `Production readiness for your exact workflow`: not yet ready

The repo already contains enough groundwork to continue efficiently, but your most important rule, `one bill with separate owner and cashier tallies and exact cashier reimbursement`, still needs dedicated schema, transaction, and reporting work before this can be safely deployed in a live bar.
