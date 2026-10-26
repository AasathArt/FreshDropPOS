// operations.js — FreshDrop POS V8.1
// Floor, open orders, shifts, expenses, staff, payroll, customers, KOT printing and reports.
// All live order data is read/modified through window.FDPOS (set up in app.js) so the
// two files can never overwrite each other's carts.
const $ = id => document.getElementById(id);
const FD = () => window.FDPOS;

/* ============================== storage ============================== */
const KEY = {
  shifts: 'fdpos_ops_shifts', expenses: 'fdpos_ops_expenses', staff: 'fdpos_ops_staff',
  payments: 'fdpos_ops_staff_payments', customers: 'fdpos_ops_customers', printers: 'fdpos_ops_printers',
  bills: 'fdpos_ops_bills', meta: 'fdpos_order_meta'
};
const LISTS = ['shifts', 'expenses', 'staff', 'payments', 'customers'];
function load(k) {
  const isList = LISTS.includes(k);
  try {
    const v = JSON.parse(localStorage.getItem(KEY[k]) || 'null');
    if (isList) return Array.isArray(v) ? v : [];
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return isList ? [] : {}; }
}
function save(k, v) {
  try { localStorage.setItem(KEY[k], JSON.stringify(v)); return true; }
  catch { toast('Could not save — browser storage may be full. Take a backup (Admin) and free some space.', true); return false; }
}

/* ============================== helpers ============================== */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'LKR ' + (Number(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
// date-only strings are local dates (new Date('2026-10-25') would be UTC and can shift a day)
const when = v => { if (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); } return new Date(v); };
const monthOf = v => ym(when(v));
const monthLabel = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
const sum = (arr, f) => arr.reduce((n, x) => n + (Number(f(x)) || 0), 0);
const activeStaff = () => load('staff').filter(s => !s.removed);
const staffName = id => load('staff').find(s => s.id === id)?.name || 'Removed staff';
const admin = () => !!FD()?.isAdmin();

function toast(msg, isErr = false) {
  let wrap = $('toastWrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; wrap.className = 'toast-wrap'; wrap.setAttribute('aria-live', 'polite'); document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), isErr ? 6500 : 3200);
}
const needAdmin = () => FD().requireAdmin();
const table = (heads, rows, numCols = []) =>
  `<div class="table-wrap"><table class="ops-table"><thead><tr>${heads.map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const empty = msg => `<p class="ops-empty">${msg}</p>`;
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const csvCell = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');

/* ============================== sections ============================== */
const SECTIONS = {
  floor:     { kicker: 'SELL',   title: 'Dining floor & live order tools', desc: 'Tap a table to see its order, assign a waiter, print a KOT, charge, merge or split.' },
  open:      { kicker: 'SELL',   title: 'Open order overview', desc: 'Every unpaid order right now. Filter by type or waiter, then open or charge it.' },
  shift:     { kicker: 'CASH',   title: 'Shift open / close', desc: 'Open the till with a starting float and close it with a cash count. Shows excess or short.' },
  expenses:  { kicker: 'CASH',   title: 'Expenses', desc: 'Electricity, water, rent and other bills — with the bill photo if you have one.' },
  staff:     { kicker: 'PEOPLE', title: 'Staff management', desc: 'Your team, their roles and monthly salary.' },
  payroll:   { kicker: 'PEOPLE', title: 'Staff salary, advances & loans', desc: 'Pay salaries, give advances or loans, and record repayments.' },
  customers: { kicker: 'PEOPLE', title: 'Customer records', desc: 'Saved customers with visits and spending taken from your real receipts.' },
  printers:  { kicker: 'KITCHEN', title: 'KOT / printer setup', desc: 'Name your printers and choose which menu categories print where.' },
  reports:   { kicker: 'REPORTS', title: 'Customer & expense reports', desc: 'Sales, expenses, staff pay, top customers and sales per waiter for any period.' }
};
let section = 'floor';
function showSection(name) {
  if (!SECTIONS[name]) name = 'floor';
  section = name;
  document.querySelectorAll('.ops-section').forEach(el => el.classList.toggle('is-active', el.dataset.opsSection === name));
  const m = SECTIONS[name];
  $('opsKicker').textContent = m.kicker; $('opsTitle').textContent = m.title; $('opsDesc').textContent = m.desc;
  ({ floor: renderFloor, open: renderOpen, shift: renderShift, expenses: renderExpenses, staff: renderStaff,
     payroll: renderPayroll, customers: renderCustomers, printers: renderPrinters, reports: renderReports }[name])();
  updateBadges();
}

/* ============================== orders (carts) ============================== */
const carts = () => FD().getCarts();
const tablesList = () => FD().getTables();
const qtyOf = l => Number(l.qty || l.quantity || 1);
const totalOf = c => sum(c, l => Number(l.price || 0) * qtyOf(l));
const labelOf = k => k === 'takeaway' ? 'Takeaway' : (tablesList().find(t => t.id === k)?.name || k);
const isOpen = k => Array.isArray(carts()[k]) && carts()[k].length > 0;
const openKeys = () => Object.keys(carts()).filter(isOpen);
const lineKey = l => l.id + '|' + l.price;
const readMeta = () => load('meta');
function pruneMeta() {
  const m = readMeta(); let changed = false;
  Object.keys(m).forEach(k => { if (!isOpen(k)) { delete m[k]; changed = true; } });
  if (changed) save('meta', m);
}
function ageText(cart) {
  const ts = cart.map(l => Number(l.timestamp)).filter(Boolean);
  if (!ts.length) return '';
  const mins = Math.max(0, Math.round((Date.now() - Math.min(...ts)) / 60000));
  return mins < 1 ? 'just now' : mins < 60 ? mins + ' min' : Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm';
}
function allOrderKeys() { return [...tablesList().map(t => t.id), 'takeaway']; }

/* ---- floor ---- */
let selKey = null;
function renderFloor() {
  pruneMeta();
  if (!selKey || !allOrderKeys().includes(selKey)) selKey = openKeys()[0] || null;
  renderFloorPlan();
  renderFloorDetail();
}
function renderFloorPlan() {
  const meta = readMeta();
  const btn = k => {
    const c = isOpen(k) ? carts()[k] : null;
    const cls = ['floor-table', c ? 'occupied' : '', k === selKey ? 'selected' : ''].join(' ').trim();
    const body = c
      ? `<span class="ft-amt">${money(totalOf(c))}</span><span class="ft-meta">${meta[k]?.waiterName ? '👤 ' + esc(meta[k].waiterName) + ' · ' : ''}${esc(ageText(c))}</span>`
      : '<span class="ft-free">Free</span>';
    return `<button type="button" class="${cls}" data-floor-key="${esc(k)}"><span class="ft-name">${k === 'takeaway' ? '🛍️ ' : ''}${esc(labelOf(k))}</span>${body}</button>`;
  };
  $('floorPlan').innerHTML = allOrderKeys().map(btn).join('');
}
function waiterOptions(selectedId) {
  const staff = activeStaff();
  const isW = s => /waiter|server/i.test(s.role);
  const opt = s => `<option value="${esc(s.id)}" ${s.id === selectedId ? 'selected' : ''}>${esc(s.name)}${isW(s) ? '' : ' (' + esc(s.role) + ')'}</option>`;
  return '<option value="">— Unassigned —</option>' + staff.filter(isW).map(opt).join('') + staff.filter(s => !isW(s)).map(opt).join('');
}
function renderFloorDetail() {
  const box = $('floorDetail');
  if (!selKey) { box.innerHTML = '<h3>Order details</h3>' + empty('No open orders. Add items from the <b>New order</b> screen and the table shows up here.'); return; }
  const cart = isOpen(selKey) ? carts()[selKey] : null;
  const name = esc(labelOf(selKey));
  if (!cart) {
    box.innerHTML = `<div class="detail-head"><div><h3>${name}</h3><span class="chip chip-green">Free</span></div></div>
      <p class="ops-help">Nothing ordered yet.</p><div class="ops-actions"><button class="btn btn-primary" type="button" data-act="open">Start an order here</button></div>`;
    return;
  }
  const meta = readMeta()[selKey] || {};
  const lines = cart.map(l => `<div><span>${esc(l.name)} × ${qtyOf(l)}</span><span>${money(Number(l.price) * qtyOf(l))}</span></div>`).join('');
  const targets = allOrderKeys().filter(k => k !== selKey).map(k => `<option value="${esc(k)}">${esc(labelOf(k))} — ${isOpen(k) ? money(totalOf(carts()[k])) : 'free'}</option>`).join('');
  const splitOpts = cart.map((l, i) => `<option value="${i}">${esc(l.name)} × ${qtyOf(l)}</option>`).join('');
  box.innerHTML = `
    <div class="detail-head"><div><h3>${name}</h3><span class="chip chip-amber">Open · ${esc(ageText(cart))}</span></div>
      <div class="ops-actions" style="margin:0"><button class="btn btn-outline btn-sm" type="button" data-act="open">Open in orders</button><button class="btn btn-primary btn-sm" type="button" data-act="charge">💳 Charge</button></div></div>
    <div class="detail-lines">${lines}<div class="tot"><span>Total</span><span>${money(totalOf(cart))}</span></div></div>
    <div class="ops-inline"><label>Waiter<select id="floorWaiter">${waiterOptions(meta.waiterId)}</select></label><button class="btn btn-outline" type="button" data-act="assign">Assign</button></div>
    ${activeStaff().length ? '' : '<p class="ops-help">No staff yet — add your team in People → Staff management.</p>'}
    <div class="detail-block"><b>Kitchen ticket</b>
      <div class="ops-actions" style="margin-top:8px"><button class="btn btn-primary" type="button" data-act="kot-new">🖨️ Print new items</button><button class="btn btn-outline" type="button" data-act="kot-full">Reprint full order</button></div></div>
    <details class="detail-block"><summary>Move, merge or split this bill</summary>
      <div class="ops-inline"><label>Move everything to<select id="floorTarget">${targets}</select></label><button class="btn btn-outline" type="button" data-act="merge">Merge into it</button></div>
      <div class="ops-inline"><label>Item<select id="floorSplitLine">${splitOpts}</select></label><label>Qty to move<input id="floorSplitQty" type="number" min="1" step="1" value="1"></label><button class="btn btn-outline" type="button" data-act="split">Move qty to target</button></div>
      <p class="ops-help">Split moves part of this order to the table chosen above (it can be a free table).</p></details>`;
}
function mergeKot(m, from, to) { // add the "already printed" counts of one order into another
  const a = m[from]?.kot || {}; if (!Object.keys(a).length) return;
  m[to] = m[to] || {}; m[to].kot = m[to].kot || {};
  Object.entries(a).forEach(([k, v]) => { m[to].kot[k] = (m[to].kot[k] || 0) + v; });
}
function mergeOrders(source, target) {
  const c = carts();
  if (!isOpen(source) || source === target) return;
  if (!Array.isArray(c[target])) c[target] = [];
  c[source].forEach(l => {
    const same = c[target].find(x => x.id === l.id && x.price === l.price);
    if (same) { same.qty = qtyOf(same) + qtyOf(l); const t = Math.min(Number(same.timestamp) || Infinity, Number(l.timestamp) || Infinity); if (Number.isFinite(t)) same.timestamp = t; }
    else c[target].push({ ...l });
  });
  c[source] = [];
  const m = readMeta();
  mergeKot(m, source, target);
  if (m[source]?.waiterId && !m[target]?.waiterId) { m[target] = { ...(m[target] || {}), waiterId: m[source].waiterId, waiterName: m[source].waiterName }; }
  delete m[source];
  save('meta', m);
  FD().commitCarts();
}
function splitOrder(source, target, idx, qty) {
  const c = carts(), line = (c[source] || [])[idx];
  if (!line) return false;
  const have = qtyOf(line);
  if (!Number.isInteger(qty) || qty < 1 || qty > have) return false;
  if (!Array.isArray(c[target])) c[target] = [];
  const moved = { ...line, qty };
  const m = readMeta(), k = lineKey(line);
  const printed = Number(m[source]?.kot?.[k] || 0), remaining = have - qty;
  if (have === qty) c[source].splice(idx, 1); else line.qty = remaining;
  const movedPrinted = Math.max(0, printed - remaining);
  if (m[source]?.kot) { if (remaining > 0) m[source].kot[k] = Math.min(printed, remaining); else delete m[source].kot[k]; }
  if (movedPrinted) { m[target] = m[target] || {}; m[target].kot = m[target].kot || {}; m[target].kot[k] = (m[target].kot[k] || 0) + movedPrinted; }
  const same = c[target].find(x => x.id === moved.id && x.price === moved.price);
  if (same) same.qty = qtyOf(same) + qty; else c[target].push(moved);
  save('meta', m);
  FD().commitCarts();
  return true;
}
function bindFloor() {
  $('floorPlan').addEventListener('click', e => {
    const b = e.target.closest('[data-floor-key]'); if (!b) return;
    selKey = b.dataset.floorKey; renderFloorPlan(); renderFloorDetail();
  });
  $('floorDetail').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b || !selKey) return;
    const act = b.dataset.act, key = selKey;
    if (act === 'open') FD().openTable(key);
    else if (act === 'charge') { FD().openTable(key); setTimeout(() => FD().checkoutNow(), 60); }
    else if (act === 'assign') {
      if (!isOpen(key)) return toast('This order is empty.', true);
      const id = $('floorWaiter').value, st = load('staff').find(s => s.id === id), m = readMeta();
      m[key] = { ...(m[key] || {}), waiterId: st?.id || null, waiterName: st?.name || null };
      if (!st) { delete m[key].waiterId; delete m[key].waiterName; }
      save('meta', m);
      toast(st ? `${st.name} assigned to ${labelOf(key)}` : 'Waiter cleared');
      renderFloor(); updateBadges();
    }
    else if (act === 'kot-new') printKot(key, false);
    else if (act === 'kot-full') printKot(key, true);
    else if (act === 'merge') {
      const target = $('floorTarget').value;
      if (!target) return;
      if (!confirm(`Move everything from ${labelOf(key)} into ${labelOf(target)}?`)) return;
      mergeOrders(key, target); selKey = target;
      toast(`Merged into ${labelOf(target)}`); renderFloor(); updateBadges();
    }
    else if (act === 'split') {
      const target = $('floorTarget').value, idx = Number($('floorSplitLine').value), qty = Number($('floorSplitQty').value);
      if (!target) return;
      if (!splitOrder(key, target, idx, qty)) return toast('Enter a quantity between 1 and the item quantity.', true);
      toast(`Moved ${qty} to ${labelOf(target)}`); renderFloor(); updateBadges();
    }
  });
}

/* ---- KOT printing (one ticket per printer station, only NEW items by default) ---- */
const STATION_NAME = { kitchen1: 'Kitchen printer 1', kitchen2: 'Kitchen printer 2', cashier: 'Cashier printer' };
const delay = ms => new Promise(r => setTimeout(r, ms));
function stationOf(line) {
  const item = FD().getMenu().find(m => m.id === line.id);
  return (load('printers').routes || {})[item?.category] || 'kitchen1';
}
function ticketHtml({ title, no, label, waiter, printer, lines, footer, extra }) {
  return `<h2>FRESH DROP — ${esc(title)}</h2><div class="line"></div>
    <p class="big">${esc(label)}</p><p>${esc(no)} · ${new Date().toLocaleString()}</p>
    <p>Waiter: ${esc(waiter || 'Unassigned')}</p><p>Printer: ${esc(printer)}</p>${extra ? `<p><b>${esc(extra)}</b></p>` : ''}
    <div class="line"></div>${lines.map(l => `<p class="big">${l.qty} × ${esc(l.name)}</p>`).join('')}
    <div class="line"></div><p>${esc(footer || '')}</p>`;
}
async function printKot(key, full) {
  const cart = carts()[key] || [];
  if (!cart.length) return toast('This order is empty.', true);
  const m = readMeta(), printed = m[key]?.kot || {};
  const lines = cart.map(l => ({ ...l, qty: qtyOf(l) - (full ? 0 : Number(printed[lineKey(l)] || 0)) })).filter(l => l.qty > 0);
  if (!lines.length) return toast('Everything is already printed. Use “Reprint full order” to print again.', true);
  const groups = {};
  lines.forEach(l => { (groups[stationOf(l)] = groups[stationOf(l)] || []).push(l); });
  const stations = Object.keys(groups);
  const pr = load('printers');
  pr.kotSeq = (Number(pr.kotSeq) || 0) + 1; save('printers', pr);
  const no = 'KOT-' + String(pr.kotSeq).padStart(4, '0');
  const reprint = !full && Object.keys(printed).length > 0;
  const done = [];
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i], pname = pr[st] || STATION_NAME[st];
    if (stations.length > 1 && !confirm(`Ticket ${i + 1} of ${stations.length}: ${pname}\n\nPress OK, then choose that printer in the print dialog.`)) break;
    FD().printHTML(ticketHtml({ title: 'KOT', no, label: labelOf(key), waiter: m[key]?.waiterName, printer: pname, lines: groups[st], footer: pr.footer, extra: full ? 'FULL REPRINT' : reprint ? 'ADDITIONAL ITEMS' : '' }), no);
    done.push(...groups[st]);
    await delay(800);
  }
  if (!done.length) return;
  const meta = readMeta(); meta[key] = meta[key] || {}; meta[key].kot = meta[key].kot || {};
  done.forEach(l => { const src = cart.find(c => c.id === l.id && c.price === l.price); meta[key].kot[lineKey(l)] = qtyOf(src || l); });
  save('meta', meta);
}

/* ---- open orders ---- */
function renderOpen() {
  pruneMeta();
  const sel = $('openOrderStaff'), old = sel.value;
  sel.innerHTML = '<option value="">Anyone</option><option value="__none">Unassigned</option>' + activeStaff().map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === old) ? old : '';
  const meta = readMeta(), type = $('openOrderType').value, who = sel.value;
  const rows = openKeys().map(k => ({ k, cart: carts()[k], type: k === 'takeaway' ? 'takeaway' : 'dining', w: meta[k] || {} }))
    .filter(o => (type === 'all' || o.type === type) && (!who || (who === '__none' ? !o.w.waiterId : o.w.waiterId === who)));
  const total = sum(rows, o => totalOf(o.cart));
  $('openSummary').innerHTML = rows.length ? `<b>${rows.length}</b> open order${rows.length > 1 ? 's' : ''} · <b>${money(total)}</b> waiting to be charged` : 'No open orders match these filters.';
  $('openOrderList').innerHTML = rows.length ? table(['Order', 'Waiter', 'Items', 'Open for', 'Total', ''],
    rows.map(o => `<tr><td><b>${esc(labelOf(o.k))}</b> <span class="chip ${o.type === 'takeaway' ? 'chip-blue' : ''}">${o.type}</span></td>
      <td>${o.w.waiterName ? esc(o.w.waiterName) : '<span class="ops-help">Unassigned</span>'}</td><td>${sum(o.cart, qtyOf)}</td><td>${esc(ageText(o.cart))}</td>
      <td class="num"><b>${money(totalOf(o.cart))}</b></td>
      <td class="num"><button class="btn btn-small btn-sm" data-act="open" data-key="${esc(o.k)}">Open</button> <button class="btn btn-small btn-sm" data-act="kot" data-key="${esc(o.k)}">KOT</button> <button class="btn btn-primary btn-sm" data-act="charge" data-key="${esc(o.k)}">Charge</button></td></tr>`), [2, 4, 5]) : '';
}
function bindOpen() {
  $('openOrderType').addEventListener('change', renderOpen);
  $('openOrderStaff').addEventListener('change', renderOpen);
  $('openOrderList').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const k = b.dataset.key;
    if (b.dataset.act === 'open') FD().openTable(k);
    else if (b.dataset.act === 'charge') { FD().openTable(k); setTimeout(() => FD().checkoutNow(), 60); }
    else if (b.dataset.act === 'kot') printKot(k, false);
  });
}

/* ============================== shift ============================== */
const openShift = () => load('shifts').find(s => !s.closedAt);
function shiftFigures(s) {
  const from = new Date(s.openedAt).getTime(), to = s.closedAt ? new Date(s.closedAt).getTime() : Infinity;
  const inRange = t => { const x = new Date(t).getTime(); return x >= from && x <= to; };
  let cash = 0, card = 0, other = 0;
  FD().getReceipts().filter(r => !r.voided && inRange(r.date)).forEach(r => {
    if (r.splitPayments) { cash += Number(r.splitPayments.cash) || 0; card += Number(r.splitPayments.card) || 0; return; }
    const pm = r.paymentMethod || 'cash';
    if (pm === 'cash') cash += Number(r.total) || 0; else if (pm === 'card') card += Number(r.total) || 0; else if (pm !== 'complimentary') other += Number(r.total) || 0;
  });
  const cashExp = sum(load('expenses').filter(e => e.payment === 'Cash' && inRange(e.createdAt || e.date)), e => e.amount);
  const pays = load('payments').filter(p => p.from === 'drawer' && inRange(p.date));
  const out = sum(pays.filter(p => p.type !== 'Loan repayment'), p => p.amount), inn = sum(pays.filter(p => p.type === 'Loan repayment'), p => p.amount);
  const expected = Math.round(((Number(s.opening) || 0) + cash - cashExp - out + inn) * 100) / 100;
  return { cash, card, other, cashExp, out, inn, expected };
}
const resultChip = d => d === 0 ? '<span class="chip chip-green">Balanced</span>' : d > 0 ? `<span class="chip chip-blue">Excess ${money(d)}</span>` : `<span class="chip chip-red">Short ${money(-d)}</span>`;
function renderShift() {
  const s = openShift(), banner = $('shiftBanner');
  $('shiftOpenBox').hidden = !!s; $('shiftCloseBox').hidden = !s;
  if (s) {
    banner.className = 'shift-banner is-open';
    banner.innerHTML = `<span class="shift-dot"></span><div><b>Shift open — ${esc(s.staff)}</b><small>Since ${new Date(s.openedAt).toLocaleString()} · opening cash ${money(s.opening)}</small></div>`;
    const f = shiftFigures(s);
    $('shiftLive').innerHTML = `<div class="kv"><span>Opening cash</span><span>${money(s.opening)}</span><span>+ Cash sales</span><span>${money(f.cash)}</span><span>− Cash expenses</span><span>${money(f.cashExp)}</span><span>− Staff pay from drawer</span><span>${money(f.out)}</span><span>+ Loan repayments received</span><span>${money(f.inn)}</span><span class="kv-total">Expected cash in drawer</span><span class="kv-total">${money(f.expected)}</span></div><p class="ops-help">Card ${money(f.card)} · other ${money(f.other)} — not counted in the drawer.</p>`;
  } else {
    banner.className = 'shift-banner is-closed';
    banner.innerHTML = '<span class="shift-dot"></span><div><b>No shift open</b><small>Open a shift before taking cash, so the drawer can be checked at the end.</small></div>';
    const inp = $('shiftOpening');
    if (!inp.dataset.touched) inp.value = Number(FD().getSettings()?.cashFloat) || 0;
    $('shiftStaff').value = $('shiftStaff').value || '';
  }
  const hist = load('shifts').filter(x => x.closedAt).reverse().slice(0, 10);
  $('shiftHistory').innerHTML = hist.length ? table(['Cashier', 'Shift', 'Expected', 'Counted', 'Result'], hist.map(x =>
    `<tr><td><b>${esc(x.staff)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ''}</td><td>${new Date(x.openedAt).toLocaleDateString()}<small>${new Date(x.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → ${new Date(x.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td><td class="num">${money(x.expected)}</td><td class="num">${money(x.counted)}</td><td>${resultChip(Math.round((x.difference || 0) * 100) / 100)}</td></tr>`), [2, 3]) : empty('No closed shifts yet.');
}
function bindShift() {
  $('shiftOpening').addEventListener('input', e => { e.target.dataset.touched = '1'; });
  $('openShiftBtn').addEventListener('click', () => {
    if (openShift()) return toast('A shift is already open.', true);
    const staff = $('shiftStaff').value.trim(), opening = Number($('shiftOpening').value);
    if (!staff) return toast('Enter the cashier’s name.', true);
    if (!Number.isFinite(opening) || opening < 0) return toast('Enter a valid opening cash amount.', true);
    const a = load('shifts'); a.push({ id: uid(), staff, opening, openedAt: new Date().toISOString() });
    if (!save('shifts', a)) return;
    $('shiftOpening').dataset.touched = ''; toast('Shift opened'); renderShift(); updateBadges();
  });
  $('closeShiftBtn').addEventListener('click', () => {
    const a = load('shifts'), s = a.find(x => !x.closedAt);
    if (!s) return toast('No open shift.', true);
    const raw = $('shiftCounted').value.trim(), counted = Number(raw);
    if (raw === '' || !Number.isFinite(counted) || counted < 0) { $('shiftCounted').focus(); return toast('Count the drawer and type the amount first.', true); }
    const f = shiftFigures(s), diff = Math.round((counted - f.expected) * 100) / 100;
    if (diff !== 0 && !confirm(`Drawer is ${diff < 0 ? 'SHORT' : 'OVER'} by ${money(Math.abs(diff))}.\nExpected ${money(f.expected)}, counted ${money(counted)}.\n\nClose the shift anyway?`)) return;
    Object.assign(s, { closedAt: new Date().toISOString(), cashSales: f.cash, cardSales: f.card, otherSales: f.other, cashExpenses: f.cashExp, drawerOut: f.out, drawerIn: f.inn, expected: f.expected, counted, difference: diff, note: $('shiftNote').value.trim() });
    if (!save('shifts', a)) return;
    $('shiftCounted').value = ''; $('shiftNote').value = '';
    toast(diff === 0 ? 'Shift closed — cash balanced ✅' : `Shift closed — ${diff < 0 ? 'short' : 'excess'} ${money(Math.abs(diff))}`, diff < 0);
    renderShift(); updateBadges();
  });
}

/* ============================== expenses ============================== */
const EXPENSE_TYPES = ['CEB / Electricity', 'Water bill', 'Rent', 'Internet / Phone', 'Supplies', 'Repairs', 'Transport', 'Other'];
function compressImage(file, max = 1000, q = 0.6) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Could not read the file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('That file is not a usable image'));
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function renderExpenses() {
  if (!$('expenseDate').value) $('expenseDate').value = ymd(new Date());
  if (!$('expenseMonth').value) $('expenseMonth').value = ym(new Date());
  const ft = $('expenseFilterType'), oldT = ft.value;
  const types = [...new Set([...EXPENSE_TYPES, ...load('expenses').map(e => e.type)])];
  ft.innerHTML = '<option value="">All types</option>' + types.map(t => `<option ${t === oldT ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const month = $('expenseMonth').value, bills = load('bills');
  const list = load('expenses').filter(e => (!month || monthOf(e.date) === month) && (!ft.value || e.type === ft.value)).sort((a, b) => when(b.date) - when(a.date));
  $('expenseTotal').innerHTML = `<b>${month ? monthLabel(month) : 'All time'}</b>${ft.value ? ' · ' + esc(ft.value) : ''}: <b>${money(sum(list, e => e.amount))}</b> in ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`;
  $('expenseList').innerHTML = list.length ? table(['Date', 'Expense', 'Paid by', 'Amount', ''], list.map(e =>
    `<tr><td>${when(e.date).toLocaleDateString()}</td><td>${bills[e.id] ? `<img class="bill-thumb" src="${bills[e.id]}" alt="Bill" data-bill="${esc(e.id)}">` : ''}<b>${esc(e.type)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ''}</td><td>${esc(e.payment)}</td><td class="num"><b>${money(e.amount)}</b></td><td class="num"><button class="btn btn-link-danger btn-sm" data-del="${esc(e.id)}" data-admin-only>Delete</button></td></tr>`), [3, 4]) : empty('No expenses for this selection.');
}
function bindExpenses() {
  $('expenseMonth').addEventListener('change', renderExpenses);
  $('expenseFilterType').addEventListener('change', renderExpenses);
  $('expenseForm').addEventListener('submit', async e => {
    e.preventDefault();
    const amount = Number($('expenseAmount').value), date = $('expenseDate').value;
    if (!(amount > 0)) return toast('Enter a positive amount.', true);
    if (!date) return toast('Pick the bill date.', true);
    const exp = { id: uid(), type: $('expenseType').value, amount, payment: $('expensePayment').value, note: $('expenseNote').value.trim(), date, createdAt: new Date().toISOString() };
    const file = $('expenseBill').files[0];
    let billNote = '';
    if (file) {
      try { const bills = load('bills'); bills[exp.id] = await compressImage(file); if (!save('bills', bills)) billNote = ' (bill photo could not be stored)'; }
      catch (err) { billNote = ' (bill photo skipped: ' + err.message + ')'; }
    }
    const a = load('expenses'); a.push(exp);
    if (!save('expenses', a)) return;
    e.target.reset(); $('expenseDate').value = ymd(new Date());
    toast('Expense recorded' + billNote, !!billNote); renderExpenses();
  });
  $('expenseList').addEventListener('click', e => {
    const img = e.target.closest('[data-bill]');
    if (img) { const v = document.createElement('div'); v.className = 'bill-view'; v.innerHTML = `<img src="${img.src}" alt="Bill">`; v.onclick = () => v.remove(); document.body.appendChild(v); return; }
    const d = e.target.closest('[data-del]'); if (!d || !needAdmin()) return;
    if (!confirm('Delete this expense? This cannot be undone.')) return;
    save('expenses', load('expenses').filter(x => x.id !== d.dataset.del));
    const bills = load('bills'); if (bills[d.dataset.del]) { delete bills[d.dataset.del]; save('bills', bills); }
    toast('Expense deleted'); renderExpenses();
  });
}

/* ============================== staff ============================== */
function staffStats(id, month = ym(new Date())) {
  const p = load('payments').filter(x => x.staffId === id), mo = x => x.month || monthOf(x.date);
  const loan = sum(p.filter(x => x.type === 'Loan issued'), x => x.amount) - sum(p.filter(x => x.type === 'Loan repayment'), x => x.amount);
  return {
    paid: sum(p.filter(x => x.type === 'Salary payment' && mo(x) === month), x => x.amount),
    adv: sum(p.filter(x => x.type === 'Advance' && mo(x) === month), x => x.amount),
    loan: Math.max(0, loan)
  };
}
function renderStaff() {
  const list = activeStaff();
  $('staffList').innerHTML = list.length ? `<div class="ops-list">${list.map(s => {
    const st = staffStats(s.id);
    return `<div class="ops-row"><div><b>${esc(s.name)}</b> <span class="chip chip-blue">${esc(s.role)}</span><small>${esc(s.phone || 'No phone')} · Salary ${money(s.salary)}</small><small>This month: paid ${money(st.paid)} · advances ${money(st.adv)} · loan balance ${money(st.loan)}</small></div>
      <div class="row-actions"><button class="btn btn-small btn-sm" data-edit="${esc(s.id)}">Edit</button><button class="btn btn-link-danger btn-sm" data-del="${esc(s.id)}">Remove</button></div></div>`;
  }).join('')}</div>` : empty('No staff yet. Add your first team member on the left.');
  fillStaffSelects();
}
function resetStaffForm() { $('staffForm').reset(); $('staffEditId').value = ''; $('staffFormTitle').textContent = 'Add staff member'; $('staffSubmit').textContent = 'Add staff'; $('staffCancel').hidden = true; }
function bindStaff() {
  $('staffForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!needAdmin()) return;
    const name = $('staffName').value.trim(), salary = Number($('staffSalary').value) || 0, editId = $('staffEditId').value;
    if (!name) return toast('Enter a name.', true);
    if (salary < 0) return toast('Salary cannot be negative.', true);
    const a = load('staff');
    if (a.some(s => !s.removed && s.id !== editId && s.name.toLowerCase() === name.toLowerCase())) return toast('A staff member with that name already exists.', true);
    const data = { name, role: $('staffRole').value, phone: $('staffPhone').value.trim(), salary };
    if (editId) Object.assign(a.find(s => s.id === editId) || {}, data); else a.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
    if (!save('staff', a)) return;
    toast(editId ? 'Staff updated' : 'Staff added'); resetStaffForm(); renderStaff();
  });
  $('staffCancel').addEventListener('click', resetStaffForm);
  $('staffList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const s = load('staff').find(x => x.id === ed.dataset.edit); if (!s) return;
      $('staffEditId').value = s.id; $('staffName').value = s.name; $('staffRole').value = s.role; $('staffPhone').value = s.phone || ''; $('staffSalary').value = s.salary || 0;
      $('staffFormTitle').textContent = 'Edit staff member'; $('staffSubmit').textContent = 'Save changes'; $('staffCancel').hidden = false; $('staffName').focus();
    } else if (del) {
      if (!needAdmin() || !confirm('Remove this staff member? Their payment history is kept.')) return;
      const a = load('staff'), s = a.find(x => x.id === del.dataset.del); if (s) s.removed = true;
      save('staff', a);
      const m = readMeta(); let ch = false; Object.values(m).forEach(v => { if (v.waiterId === del.dataset.del) { delete v.waiterId; delete v.waiterName; ch = true; } }); if (ch) save('meta', m);
      toast('Staff removed'); renderStaff();
    }
  });
}
function fillStaffSelects() {
  const list = activeStaff();
  $('staffNames').innerHTML = list.map(s => `<option value="${esc(s.name)}">`).join('');
  const ps = $('payStaff'), old = ps.value;
  ps.innerHTML = list.map(s => `<option value="${esc(s.id)}">${esc(s.name)} — ${esc(s.role)}</option>`).join('') || '<option value="">Add staff first</option>';
  if ([...ps.options].some(o => o.value === old)) ps.value = old;
  const pf = $('payFilterStaff'), oldF = pf.value;
  pf.innerHTML = '<option value="">Everyone</option>' + load('staff').map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.removed ? ' (removed)' : ''}</option>`).join('');
  pf.value = [...pf.options].some(o => o.value === oldF) ? oldF : '';
}

/* ============================== payroll ============================== */
const PAY_CHIP = { 'Salary payment': 'chip-green', 'Advance': 'chip-amber', 'Loan issued': 'chip-red', 'Loan repayment': 'chip-blue' };
function payHint() {
  const id = $('payStaff').value, s = load('staff').find(x => x.id === id), month = $('payMonth').value || ym(new Date());
  if (!s) { $('payHint').innerHTML = 'Add a staff member first (People → Staff management).'; return; }
  const st = staffStats(id, month), remaining = Math.max(0, (Number(s.salary) || 0) - st.paid - st.adv);
  $('payHint').innerHTML = `<div class="kv"><span>${esc(s.name)} — salary</span><span>${money(s.salary)}</span><span>Salary already paid (${monthLabel(month)})</span><span>${money(st.paid)}</span><span>Advances taken (${monthLabel(month)})</span><span>${money(st.adv)}</span><span class="kv-total">Still to pay for the month</span><span class="kv-total">${money(remaining)}</span><span>Outstanding loan</span><span>${money(st.loan)}</span></div>`;
}
function renderPayroll() {
  if (!$('payMonth').value) $('payMonth').value = ym(new Date());
  fillStaffSelects(); payHint();
  const who = $('payFilterStaff').value;
  const list = load('payments').filter(p => !who || p.staffId === who).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 60);
  $('payList').innerHTML = list.length ? table(['Date', 'Staff', 'Type', 'Amount', ''], list.map(p =>
    `<tr><td>${new Date(p.date).toLocaleDateString()}</td><td><b>${esc(staffName(p.staffId))}</b>${p.note ? `<small>${esc(p.note)}</small>` : ''}</td><td><span class="chip ${PAY_CHIP[p.type] || ''}">${esc(p.type)}</span>${p.month ? `<small>${monthLabel(p.month)}</small>` : ''}<small>${p.from === 'drawer' ? 'From cash drawer' : p.from === 'other' ? 'Bank / other' : ''}</small></td><td class="num"><b>${money(p.amount)}</b></td><td class="num"><button class="btn btn-link-danger btn-sm" data-del="${esc(p.id)}" data-admin-only>Delete</button></td></tr>`), [3, 4]) : empty('No staff payments yet.');
}
function bindPayroll() {
  ['payStaff', 'payMonth', 'payType'].forEach(id => $(id).addEventListener('change', payHint));
  $('payFilterStaff').addEventListener('change', renderPayroll);
  $('payForm').addEventListener('submit', e => {
    e.preventDefault();
    const staffId = $('payStaff').value, s = load('staff').find(x => x.id === staffId), amount = Number($('payAmount').value), type = $('payType').value, month = $('payMonth').value || ym(new Date());
    if (!s) return toast('Add a staff member first.', true);
    if (!(amount > 0)) return toast('Enter a positive amount.', true);
    const st = staffStats(staffId, month);
    if (type === 'Loan repayment' && amount > st.loan && !confirm(`${s.name}'s loan balance is only ${money(st.loan)}. Record ${money(amount)} anyway?`)) return;
    if (type === 'Salary payment') { const rem = Math.max(0, (Number(s.salary) || 0) - st.paid - st.adv); if (amount > rem && !confirm(`That is more than the ${money(rem)} still due for ${monthLabel(month)}. Record it anyway?`)) return; }
    const a = load('payments'); a.push({ id: uid(), staffId, type, amount, month, from: $('payFrom').value, note: $('payNote').value.trim(), date: new Date().toISOString() });
    if (!save('payments', a)) return;
    $('payAmount').value = ''; $('payNote').value = ''; toast(`${type} saved for ${s.name}`); renderPayroll();
  });
  $('payList').addEventListener('click', e => {
    const d = e.target.closest('[data-del]'); if (!d || !needAdmin()) return;
    if (!confirm('Delete this payment record? This cannot be undone.')) return;
    save('payments', load('payments').filter(p => p.id !== d.dataset.del)); toast('Payment deleted'); renderPayroll();
  });
}

/* ============================== customers ============================== */
function customerStats() {
  const map = {};
  FD().getReceipts().filter(r => !r.voided && r.customerName).forEach(r => {
    const k = r.customerName.trim().toLowerCase(), x = map[k] || (map[k] = { visits: 0, spent: 0, last: 0 });
    x.visits += 1; x.spent += Number(r.total) || 0; x.last = Math.max(x.last, new Date(r.date).getTime());
  });
  return map;
}
function upsertCustomerName(name) {
  name = String(name || '').trim(); if (!name) return;
  const a = load('customers');
  if (a.some(c => c.name.trim().toLowerCase() === name.toLowerCase())) return;
  a.push({ id: uid(), name, phone: '', contact: '', note: '', auto: true, createdAt: new Date().toISOString() });
  save('customers', a);
}
function renderCustomers() {
  const q = $('customerSearch').value.trim().toLowerCase(), stats = customerStats();
  const list = load('customers').map(c => ({ c, s: stats[c.name.trim().toLowerCase()] || { visits: 0, spent: 0, last: 0 } }))
    .filter(({ c }) => (c.name + ' ' + (c.phone || '') + ' ' + (c.contact || '')).toLowerCase().includes(q)).sort((a, b) => b.s.spent - a.s.spent || a.c.name.localeCompare(b.c.name));
  $('customerList').innerHTML = list.length ? `<div class="ops-list">${list.slice(0, 200).map(({ c, s }) =>
    `<div class="ops-row"><div><b>${esc(c.name)}</b> ${s.visits ? `<span class="chip chip-green">${s.visits} visit${s.visits > 1 ? 's' : ''}</span>` : ''}<small>${esc(c.phone || 'No phone')}${c.contact ? ' · ' + esc(c.contact) : ''}${c.note ? ' · ' + esc(c.note) : ''}</small>${s.visits ? `<small>Spent ${money(s.spent)} · last visit ${new Date(s.last).toLocaleDateString()}</small>` : ''}</div>
      <div class="row-actions"><button class="btn btn-small btn-sm" data-edit="${esc(c.id)}">Edit</button><button class="btn btn-link-danger btn-sm" data-del="${esc(c.id)}" data-admin-only>Delete</button></div></div>`).join('')}</div>` : empty('No matching customers.');
  fillCustomerDatalist();
}
function fillCustomerDatalist() {
  const dl = document.getElementById('customerNames'); if (!dl) return;
  dl.innerHTML = load('customers').slice(-300).map(c => `<option value="${esc(c.name)}">`).join('');
}
function resetCustomerForm() { $('customerForm').reset(); $('customerEditId').value = ''; $('customerFormTitle').textContent = 'Save a customer'; $('customerSubmit').textContent = 'Save customer'; $('customerCancel').hidden = true; }
function bindCustomers() {
  $('customerSearch').addEventListener('input', renderCustomers);
  $('customerForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('opsCustomerName').value.trim(); if (!name) return toast('Enter a name.', true);
    const data = { name, phone: $('opsCustomerPhone').value.trim(), contact: $('opsCustomerContact').value.trim(), note: $('opsCustomerNote').value.trim() };
    const a = load('customers'); let editId = $('customerEditId').value;
    if (!editId) { const dup = a.find(c => c.name.trim().toLowerCase() === name.toLowerCase()); if (dup) { editId = dup.id; toast('Customer already saved — details updated.'); } }
    if (editId) { Object.assign(a.find(c => c.id === editId) || {}, data, { auto: false }); }
    else { a.push({ id: uid(), ...data, createdAt: new Date().toISOString() }); toast('Customer saved'); }
    if (!save('customers', a)) return;
    resetCustomerForm(); renderCustomers();
  });
  $('customerCancel').addEventListener('click', resetCustomerForm);
  $('importCustomersBtn').addEventListener('click', () => {
    const have = new Set(load('customers').map(c => c.name.trim().toLowerCase())), add = [];
    FD().getReceipts().forEach(r => { const n = (r.customerName || '').trim(), k = n.toLowerCase(); if (n && !have.has(k)) { have.add(k); add.push({ id: uid(), name: n, phone: '', contact: '', note: '', auto: true, createdAt: new Date().toISOString() }); } });
    if (!add.length) return toast('No new names found in past receipts.');
    save('customers', load('customers').concat(add)); toast(`Imported ${add.length} customer name${add.length > 1 ? 's' : ''}`); renderCustomers();
  });
  $('customerList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const c = load('customers').find(x => x.id === ed.dataset.edit); if (!c) return;
      $('customerEditId').value = c.id; $('opsCustomerName').value = c.name; $('opsCustomerPhone').value = c.phone || ''; $('opsCustomerContact').value = c.contact || ''; $('opsCustomerNote').value = c.note || '';
      $('customerFormTitle').textContent = 'Edit customer'; $('customerSubmit').textContent = 'Save changes'; $('customerCancel').hidden = false; $('opsCustomerName').focus();
    } else if (del) {
      if (!needAdmin() || !confirm('Delete this customer record? Receipts are not affected.')) return;
      save('customers', load('customers').filter(c => c.id !== del.dataset.del)); toast('Customer deleted'); renderCustomers();
    }
  });
}

/* ============================== printers ============================== */
function renderPrinters() {
  const p = load('printers');
  [['printerKitchen1', 'kitchen1'], ['printerKitchen2', 'kitchen2'], ['printerCashier', 'cashier'], ['printerFooter', 'footer']].forEach(([id, k]) => { $(id).value = p[k] || ''; });
  const routes = p.routes || {};
  $('routeList').innerHTML = `<div class="ops-list">${FD().getCategories().map(c => `<div class="ops-row"><div><b>${esc(c.icon || '')} ${esc(c.name)}</b></div><select data-route="${esc(c.id)}" style="max-width:220px;min-height:38px;border:1px solid #cfddd2;border-radius:10px;padding:6px 8px">${Object.entries(STATION_NAME).map(([v, n]) => `<option value="${v}" ${(routes[c.id] || 'kitchen1') === v ? 'selected' : ''}>${esc(p[v] || n)}</option>`).join('')}</select></div>`).join('')}</div>`;
}
function bindPrinters() {
  $('printerForm').addEventListener('submit', e => {
    e.preventDefault(); if (!needAdmin()) return;
    const p = load('printers');
    Object.assign(p, { kitchen1: $('printerKitchen1').value.trim(), kitchen2: $('printerKitchen2').value.trim(), cashier: $('printerCashier').value.trim(), footer: $('printerFooter').value.trim() });
    if (!save('printers', p)) return;
    const s = $('printerStatus'); s.hidden = false; s.textContent = 'Printer settings saved on this computer.'; renderPrinters();
  });
  $('routeList').addEventListener('change', e => {
    const sel = e.target.closest('[data-route]'); if (!sel || !needAdmin()) return;
    const p = load('printers'); p.routes = p.routes || {}; p.routes[sel.dataset.route] = sel.value; save('printers', p); toast('Routing saved');
  });
  $('printKotTest').addEventListener('click', () => {
    const p = load('printers');
    FD().printHTML(ticketHtml({ title: 'KOT TEST', no: 'TEST', label: 'Test ticket', waiter: 'n/a', printer: p.kitchen1 || STATION_NAME.kitchen1, lines: [{ qty: 1, name: 'Sample item' }], footer: p.footer, extra: 'Not a customer order' }), 'KOT test');
  });
}

/* ============================== reports ============================== */
function periodRange() {
  const v = $('reportPeriod').value, now = new Date(), y = now.getFullYear(), m = now.getMonth();
  if (v === 'today') return [new Date(y, m, now.getDate()), new Date(y, m, now.getDate() + 1), 'Today'];
  if (v === 'lastmonth') return [new Date(y, m - 1, 1), new Date(y, m, 1), monthLabel(ym(new Date(y, m - 1, 1)))];
  if (v === '30') return [new Date(now.getTime() - 30 * 86400000), new Date(now.getTime() + 1), 'Last 30 days'];
  if (v === 'all') return [new Date(0), new Date(8.64e15), 'All time'];
  return [new Date(y, m, 1), new Date(y, m + 1, 1), monthLabel(ym(now))];
}
const bars = (items, fmtV = money, amber = false) => {
  const max = Math.max(1, ...items.map(i => i.v));
  return items.length ? items.map(i => `<div class="bar-row"><span>${esc(i.l)}</span><div class="bar ${amber ? 'amber' : ''}"><i style="width:${Math.max(2, Math.round(i.v / max * 100))}%"></i></div><b>${fmtV(i.v)}</b></div>`).join('') : '<p class="ops-help">Nothing to show for this period.</p>';
};
function reportData() {
  const [from, to, label] = periodRange();
  const inR = d => { const t = when(d).getTime(); return t >= from.getTime() && t < to.getTime(); };
  const rec = FD().getReceipts().filter(r => !r.voided && inR(r.date));
  const exp = load('expenses').filter(e => inR(e.date));
  const pays = load('payments').filter(p => inR(p.date));
  return { label, rec, exp, pays };
}
function renderReports() {
  const { label, rec, exp, pays } = reportData();
  const revenue = sum(rec, r => r.total), profit = revenue - sum(rec, r => r.cost), expTotal = sum(exp, e => e.amount);
  const staffPay = sum(pays.filter(p => p.type === 'Salary payment' || p.type === 'Advance'), p => p.amount);
  const net = profit - expTotal - staffPay;
  const group = (arr, keyF, valF) => { const m = {}; arr.forEach(x => { const k = keyF(x); m[k] = (m[k] || 0) + valF(x); }); return Object.entries(m).map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v); };
  const expBy = group(exp, e => e.type, e => Number(e.amount) || 0);
  const waiters = group(rec, r => r.waiterName || 'Unassigned', r => Number(r.total) || 0);
  const pm = {}; rec.forEach(r => { if (r.splitPayments) { pm.cash = (pm.cash || 0) + (+r.splitPayments.cash || 0); pm.card = (pm.card || 0) + (+r.splitPayments.card || 0); } else { const k = r.paymentMethod || 'cash'; pm[k] = (pm[k] || 0) + (+r.total || 0); } });
  const top = group(rec.filter(r => r.customerName), r => r.customerName.trim(), r => Number(r.total) || 0).slice(0, 8);
  const loans = activeStaff().map(s => ({ l: s.name, v: staffStats(s.id).loan })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  $('opsReports').innerHTML = `
    <div class="ops-stats">
      <div class="ops-stat"><div class="l">Sales · ${esc(label)}</div><div class="v">${money(revenue)}</div></div>
      <div class="ops-stat"><div class="l">Orders · avg bill</div><div class="v">${rec.length} · ${money(rec.length ? revenue / rec.length : 0)}</div></div>
      <div class="ops-stat"><div class="l">Gross profit</div><div class="v">${money(profit)}</div></div>
      <div class="ops-stat"><div class="l">Expenses</div><div class="v">${money(expTotal)}</div></div>
      <div class="ops-stat"><div class="l">Salaries & advances paid</div><div class="v">${money(staffPay)}</div></div>
      <div class="ops-stat ${net < 0 ? 'bad' : ''}"><div class="l">Result after expenses & pay</div><div class="v">${money(net)}</div></div>
    </div>
    <p class="ops-help">Result = gross profit (sales − ingredient cost) − expenses − salaries/advances. Loans are not counted as costs.</p>
    <div class="report-cols">
      <div><h4>Expenses by type</h4>${bars(expBy, money, true)}</div>
      <div><h4>Sales by waiter</h4>${bars(waiters)}</div>
      <div><h4>Top customers</h4>${bars(top)}</div>
      <div><h4>Payment methods</h4>${bars(Object.entries(pm).map(([l, v]) => ({ l, v })).sort((a, b) => b.v - a.v))}</div>
      <div><h4>Outstanding staff loans</h4>${bars(loans, money, true)}</div>
    </div>`;
}
function bindReports() {
  $('reportPeriod').addEventListener('change', renderReports);
  $('exportExpensesCsvBtn').addEventListener('click', () => {
    if (!needAdmin()) return;
    const rows = [['Date', 'Type', 'Amount', 'Paid by', 'Note']].concat(reportData().exp.sort((a, b) => when(a.date) - when(b.date)).map(e => [when(e.date).toISOString().slice(0, 10), e.type, e.amount, e.payment, e.note || '']));
    download(`freshdrop-expenses-${ymd(new Date())}.csv`, toCsv(rows), 'text/csv');
  });
  $('exportCustomersCsvBtn').addEventListener('click', () => {
    if (!needAdmin()) return;
    const st = customerStats();
    const rows = [['Name', 'Phone', 'Contact', 'Notes', 'Visits', 'Total spent', 'Last visit']].concat(load('customers').map(c => { const s = st[c.name.trim().toLowerCase()]; return [c.name, c.phone || '', c.contact || '', c.note || '', s?.visits || 0, s ? s.spent.toFixed(2) : '0.00', s ? new Date(s.last).toISOString().slice(0, 10) : '']; }));
    download(`freshdrop-customers-${ymd(new Date())}.csv`, toCsv(rows), 'text/csv');
  });
  $('exportOpsBtn').addEventListener('click', () => {
    if (!needAdmin()) return;
    const data = { exportedAt: new Date().toISOString(), shifts: load('shifts'), expenses: load('expenses'), staff: load('staff'), staffPayments: load('payments'), customers: load('customers'), printers: load('printers') };
    download(`freshdrop-operations-${ymd(new Date())}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
}

/* ============================== nav badges + wiring ============================== */
function setBadge(name, text, cls) {
  document.querySelectorAll(`[data-badge="${name}"]`).forEach(b => { b.hidden = !text; b.textContent = text || ''; b.className = 'nav-badge' + (cls ? ' ' + cls : ''); });
}
function updateBadges() {
  try {
    const n = openKeys().length;
    setBadge('open', n ? String(n) : '', 'warn');
    setBadge('shift', openShift() ? 'LIVE' : '', 'live');
  } catch (_) { /* FDPOS not ready yet */ }
}
function init() {
  if (!window.FDPOS || !$('operationsTab')) { console.error('FreshDrop operations: app bridge missing'); return; }
  bindFloor(); bindOpen(); bindShift(); bindExpenses(); bindStaff(); bindPayroll(); bindCustomers(); bindPrinters(); bindReports();
  fillStaffSelects(); fillCustomerDatalist(); updateBadges();
  window.addEventListener('fdpos:ops-section', e => showSection(e.detail?.section));
  window.addEventListener('fdpos:data-saved', () => updateBadges());
  window.addEventListener('fdpos:role', () => { if (document.getElementById('operationsTab')?.classList.contains('active')) showSection(section); });
  window.addEventListener('fdpos:receipt', e => { upsertCustomerName(e.detail?.customerName); fillCustomerDatalist(); updateBadges(); });
  window.addEventListener('storage', () => updateBadges());
  // keep "open for 12 min" fresh without disturbing forms the user is typing in
  setInterval(() => {
    if (!$('operationsTab').classList.contains('active')) return;
    if (section === 'floor') renderFloorPlan(); else if (section === 'open') renderOpen(); else if (section === 'shift' && openShift()) renderShift();
    updateBadges();
  }, 30000);
  showSection('floor');
}
window.addEventListener('DOMContentLoaded', init);
