# FreshDrop POS V8.1 — Windows Desktop

Run: `npm install` then `npm start`. Build installer: `npm run dist:win`.

## What's new in V8.1
- New sidebar navigation (top scroll bar on small screens): Sell / Cash / People / Kitchen / Reports / System, with live badges (open orders, shift LIVE).
- Operations split into one screen per tool: Dining floor, Open orders, Shift, Expenses, Staff, Salary/advances/loans, Customers, KOT/printers, Customer & expense reports.
- Staff can use Floor, Open orders, Shift, Customers; money screens stay admin-only.
- New: charge from floor/open orders, KOT prints only NEW items, KOT split per printer by menu category, bill photos on expenses, backdated expenses, staff edit, payroll hints, per-waiter sales, customer visits/spend, CSV exports.

## Bugs fixed
- Data was lost on every restart (random localhost port). Now a fixed port + single instance. NOTE: data from earlier V8 alpha runs cannot be recovered.
- Merge/split of orders was overwritten by the cart screen (could duplicate items). Now one shared data path.
- Receipt print, KOT print, stock edit, add ingredient, rename, bulk price: used window.open/prompt, which Electron blocks. Replaced.
- Voiding a mixed cash+card sale corrupted drawer totals.
- Waiter assignment was not backed up/restored, never cleared after payment, and not saved on receipts.
- html2pdf now bundled locally (works offline). Service worker now caches operations.js.
- Close Day warns if a shift is still open.

## Still not done (be honest with customers)
localStorage only (no SQLite), single device, no silent printer routing (you pick the printer in the print dialog), no licensing. Test every flow with sample data and your real printers before live sales.
