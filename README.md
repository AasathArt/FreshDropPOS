# FreshDrop POS Pro V6 — Operations Expansion

Based on FreshDrop POS Pro V5. Adds an Operations Centre for shift opening/closing and cash reconciliation, expense tracking (electricity/CEB, water, rent and other expenses), staff records, salary/advance/loan transactions, customer records/search, printer labels and a printable KOT test, open-cart overview/filtering, and operations JSON export.

## Run locally

Serve this folder with a local web server because the POS uses JavaScript modules:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Important scope notes

- This remains a browser-local application. Different devices do not share data and there is no server database or multi-cashier synchronization.
- The new shift reconciliation estimates cash sales from the existing saved transaction data. Test it against your real receipt fields before relying on shift totals.
- Staff/customer management and expenses are operational records, but staff assignment is not yet wired into the original checkout flow.
- The open-order panel is an overview/filter of saved carts; merge/split bill actions are not yet integrated into the checkout/cart model.
- KOT test printing uses the browser print dialog. Automatic routing to multiple physical printers usually requires a local print bridge or backend and printer-specific setup.
- The POS backup function includes the new operations keys; the Operations Centre also provides a separate JSON export. Keep backup files outside the POS device.
- JavaScript syntax/static checks are not a substitute for end-to-end browser tests. Use sample data before live restaurant sales.
