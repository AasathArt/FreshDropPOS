# Fresh Drop POS — Redesigned & Hardened Edition

A responsive, browser-based point-of-sale system for Fresh Drop Juice Bar.

## What's improved
- Redesigned responsive interface for laptop, tablet, and mobile.
- Improved contrast, touch targets, spacing, and modal layout.
- Stable table IDs and quantity-aware cart lines.
- Daily business-date rollover and historical sale cost snapshots.
- Stock deduction is planned/validated before applying it.
- Soft-deleted menu items remain available to existing carts and historical records.
- Admin PIN flow, idle lock, backup export/import, and browser-storage status.
- Service-worker cache version updated and URLs made relative for project subpaths.
- PWA manifest paths made relative for GitHub Pages project hosting.

## Run locally
Because `app.js` uses JavaScript modules, run this through a local web server rather than opening `index.html` directly. For example, from this folder:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Important data warning
This is still a **single-browser, localStorage-based POS**, not a multi-device server/database. Export backups regularly and store them somewhere outside the POS device. Browser storage can still be lost if the browser profile/device is damaged or cleared. The admin PIN is a local deterrent, not server-grade security.

## Before live use
Test with sample data first: create an order, checkout, confirm stock deduction, print/export a receipt, close a day, restore a backup, and verify that historical revenue/cost/profit remain unchanged after editing menu recipes and ingredient prices. Keep the previous ZIP and a separate backup until the new version is validated in your actual environment.
