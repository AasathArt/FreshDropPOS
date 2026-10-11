// app.js - Fresh Drop POS V3 - hardened build
import { initialStock } from './data/stock.js';

// ---------- CONFIG ----------
const DAY_ROLLOVER_HOUR = 0;   // hour (0-23) when a new business day starts. 0 = midnight. Use 4 if you trade past midnight.
const BACKUP_WARN_DAYS = 3;    // admin panel turns red if the last backup is older than this

const DATA_KEYS = [
  'fdpos_tables', 'fdpos_categories', 'fdpos_menu', 'fdpos_stock', 'fdpos_carts',
  'fdpos_todaysSales', 'fdpos_history', 'fdpos_receipts',
  'fdpos_ingredient_prices', 'fdpos_price_history', 'fdpos_initialized'
];
const LAST_BACKUP_KEY = 'fdpos_last_backup';
const ADMIN_PIN_KEY = 'fdpos_admin_pin';   // device-local; deliberately NOT part of backups
const STAFF_TABS = ['orders', 'stock'];    // tabs staff may open (stock is read-only for staff)
const ADMIN_ONLY_BUTTON_IDS = ['manageTablesBtn', 'manageItemsBtn', 'managePricesBtn', 'resetAllBtn', 'addIngredientBtn'];
const ADMIN_IDLE_MINUTES = 10;             // admin mode switches itself off after this much inactivity
const PIN_MAX_TRIES = 5;
const PIN_LOCK_SECONDS = 60;

// ---------- INITIAL DATA ----------
const defaultCategories = [
  { id: "fresh_juice", name: "Fresh Juice", icon: "🍹" },
  { id: "milkshake", name: "Milkshake", icon: "🥤" },
  { id: "special_drink", name: "Special Drink", icon: "⭐" },
  { id: "seasonal_special", name: "Seasonal Special", icon: "🌸" }
];

const defaultMenuItems = [
  { id: "lime_juice", name: "Lime Juice", price: 200, category: "fresh_juice", active: true, recipe: { "Lemon": 50, "Sugar": 40, "Ice": 50 } },
  { id: "watermelon_juice", name: "Watermelon Juice", price: 300, category: "fresh_juice", active: true, recipe: { "Watermelon": 300, "Ice": 50 } },
  { id: "papaya_juice", name: "Papaya Juice", price: 300, category: "fresh_juice", active: true, recipe: { "Papaya": 250, "Sugar": 20, "Ice": 50 } },
  { id: "pineapple_juice", name: "Pineapple Juice", price: 400, category: "fresh_juice", active: true, recipe: { "Pineapple": 250, "Sugar": 20, "Ice": 50 } },
  { id: "orange_juice", name: "Orange Juice", price: 400, category: "fresh_juice", active: true, recipe: { "Orange": 250, "Sugar": 25, "Ice": 50 } },
  { id: "mango_juice", name: "Mango Juice", price: 400, category: "fresh_juice", active: true, recipe: { "Mango": 250, "Sugar": 25, "Ice": 50 } },
  { id: "mixed_fruit_juice", name: "Mixed Fruit Juice", price: 450, category: "fresh_juice", active: true, recipe: { "Mango": 80, "Pineapple": 80, "Papaya": 60, "Orange": 60, "Sugar": 20, "Ice": 50 } },
  { id: "avocado_juice", name: "Avocado Juice", price: 500, category: "fresh_juice", active: true, recipe: { "Avocado": 180, "Fresh Milk": 180, "Sugar": 30, "Ice": 50 } },
  { id: "fruit_salad", name: "Fruit Salad", price: 500, category: "fresh_juice", active: true, recipe: { "Watermelon": 80, "Mango": 60, "Pineapple": 60, "Papaya": 60, "Lemon": 10, "Sugar": 15 } }
];

// Tables have STABLE ids. Carts are keyed by id, never by array position.
// Legacy table i keeps id "table_i" so existing saved carts keep working.
const makeDefaultTables = () => Array.from({ length: 10 }, (_, i) => ({ id: `table_${i}`, name: `Table ${i + 1}` }));

// Default ingredient prices (LKR per kg or per unit)
const defaultIngredientPrices = {
  "Sugar": 280, "Lime Powder": 1000, "Fresh Milk": 450, "Ice": 800, "Pepper": 2000,
  "Lemon": 450, "Mango": 350, "Orange": 1000, "Pineapple": 350, "Papaya": 300,
  "Watermelon": 300, "Avocado": 700, "CupSet": 30
};

// ---------- HELPERS ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fmt = n => round2(n);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- APP STATE ----------
let currentRole = 'staff';
let currentTable = 'takeaway';          // a table id, or 'takeaway'
let currentCategory = 'all';
let tables = makeDefaultTables();
let tablesDraft = [];                   // working copy while the Manage Tables modal is open
let categories = [...defaultCategories];
let menuItems = [...defaultMenuItems];
let carts = {};
let stock = { ...initialStock };
let todaysSales = newDayRecord();
let historyArchive = [];
let receipts = [];
let pendingCart = null;
let pendingCartKey = null;
let pendingTableName = '';
let ingredientPrices = { ...defaultIngredientPrices };
let priceHistory = [];
let persistentStorage = null;           // result of navigator.storage.persist()
const corruptKeys = [];

const SHOP_NAME = "FRESH DROP JUICE BAR";
const SHOP_PHONE = "0773503720";
const THANK_YOU_MSG = "Thank you for your order! 🌟";
const WELCOME_MSG = "Welcome again! 🍹";

// ---------- BUSINESS DAY ----------
function businessDate(d = new Date()) {
  return new Date(d.getTime() - DAY_ROLLOVER_HOUR * 3600000).toDateString();
}

function newDayRecord() {
  return { date: businessDate(), revenue: 0, cost: 0, profit: 0, ordersCount: 0, cupsSold: 0, transactions: [] };
}

// Archives yesterday (or any earlier day) and starts a fresh day when the date has moved on.
function rolloverIfNewDay() {
  const today = businessDate();
  if (todaysSales.date === today) return false;
  const prev = Date.parse(todaysSales.date);
  const cur = Date.parse(today);
  if (!isNaN(prev) && !isNaN(cur) && cur < prev) return false; // device clock moved backwards: don't archive
  if (todaysSales.ordersCount > 0 || todaysSales.revenue > 0) {
    historyArchive.push({
      date: todaysSales.date,
      revenue: round2(todaysSales.revenue),
      cost: round2(todaysSales.cost),
      profit: round2(todaysSales.profit),
      orders: todaysSales.ordersCount,
      cups: todaysSales.cupsSold,
      auto: true
    });
  }
  todaysSales = newDayRecord();
  saveData();
  return true;
}

function refreshAfterRollover() {
  updateDashboardAndStockViews();
  renderHistoryList();
}

// ---------- CARTS ----------
// A cart is an array of lines: { id, name, price, qty, timestamp }.
// Legacy carts (one entry per cup, no qty) are merged on load.
function normalizeCart(cart) {
  if (!Array.isArray(cart)) return [];
  const out = [];
  for (const line of cart) {
    if (!line || !line.id) continue;
    const qty = Number.isFinite(line.qty) && line.qty > 0 ? Math.floor(line.qty) : 1;
    const price = Number(line.price) || 0;
    const existing = out.find(l => l.id === line.id && l.price === price);
    if (existing) existing.qty += qty;
    else out.push({ id: line.id, name: line.name, price, qty, timestamp: line.timestamp || Date.now() });
  }
  return out;
}

function ensureCarts() {
  if (!isPlainObject(carts)) carts = {};
  tables.forEach(t => { if (!Array.isArray(carts[t.id])) carts[t.id] = []; });
  if (!Array.isArray(carts.takeaway)) carts.takeaway = [];
  Object.keys(carts).forEach(k => { carts[k] = normalizeCart(carts[k]); });
}

function currentCart() {
  if (!Array.isArray(carts[currentTable])) carts[currentTable] = [];
  return carts[currentTable];
}

function cartTotal(cart) { return cart.reduce((s, l) => s + l.price * l.qty, 0); }
function cartCups(cart) { return cart.reduce((s, l) => s + l.qty, 0); }
function findMenuItem(id) { return menuItems.find(m => m.id === id); } // includes soft-deleted items on purpose

function currentTableLabel() {
  if (currentTable === 'takeaway') return 'Takeaway';
  return tables.find(t => t.id === currentTable)?.name || 'Table';
}

// ---------- STORAGE ----------
function readJSON(key, fallback, validator) {
  let raw;
  try { raw = localStorage.getItem(key); } catch (e) { return fallback; }
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (validator && !validator(parsed)) throw new Error('unexpected shape');
    return parsed;
  } catch (e) {
    console.error(`Corrupt data in ${key}:`, e);
    try { localStorage.setItem(`fdpos_corrupt_${key.replace('fdpos_', '')}_${Date.now()}`, raw); } catch (_) {}
    corruptKeys.push(key);
    return fallback;
  }
}

let lastSaveWarning = 0;
function warnSaveFailed(err) {
  console.error('Save failed:', err);
  const now = Date.now();
  if (now - lastSaveWarning < 30000) return;
  lastSaveWarning = now;
  alert('⚠️ Could not save data (browser storage is full or blocked). Go to Admin → Data Backup and export a backup NOW.');
}

function writeKeys(map) {
  try {
    for (const [k, v] of Object.entries(map)) localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (err) {
    warnSaveFailed(err);
    return false;
  }
}

function loadPriceData() {
  const savedPrices = readJSON('fdpos_ingredient_prices', null, isPlainObject);
  ingredientPrices = savedPrices ? savedPrices : { ...defaultIngredientPrices };
  priceHistory = readJSON('fdpos_price_history', [], Array.isArray);
}

function savePriceData() {
  return writeKeys({ fdpos_ingredient_prices: ingredientPrices, fdpos_price_history: priceHistory });
}

function normalizeTables(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return makeDefaultTables();
  const seen = new Set();
  const out = [];
  raw.forEach((t, i) => {
    let id, name;
    if (typeof t === 'string') { id = `table_${i}`; name = t; }
    else if (t && typeof t === 'object') { id = t.id || `table_${i}`; name = t.name; }
    else return;
    if (seen.has(id)) id = `table_${i}_${Date.now()}`;
    seen.add(id);
    out.push({ id, name: String(name || `Table ${i + 1}`) });
  });
  return out.length ? out : makeDefaultTables();
}

function loadData() {
  tables = normalizeTables(readJSON('fdpos_tables', null));
  const savedCategories = readJSON('fdpos_categories', null, a => Array.isArray(a) && a.length);
  if (savedCategories) categories = savedCategories;
  const savedMenu = readJSON('fdpos_menu', null, a => Array.isArray(a) && a.every(m => m && m.id));
  if (savedMenu) menuItems = savedMenu;
  const savedStock = readJSON('fdpos_stock', null, isPlainObject);
  if (savedStock) stock = savedStock;
  carts = readJSON('fdpos_carts', {}, isPlainObject);
  const savedSales = readJSON('fdpos_todaysSales', null, isPlainObject);
  if (savedSales) todaysSales = { ...newDayRecord(), ...savedSales, transactions: Array.isArray(savedSales.transactions) ? savedSales.transactions : [] };
  historyArchive = readJSON('fdpos_history', [], Array.isArray);
  receipts = readJSON('fdpos_receipts', [], Array.isArray);
  loadPriceData();
  ensureCarts();
}

function saveData() {
  return writeKeys({
    fdpos_tables: tables,
    fdpos_categories: categories,
    fdpos_menu: menuItems,
    fdpos_stock: stock,
    fdpos_carts: carts,
    fdpos_todaysSales: todaysSales,
    fdpos_history: historyArchive,
    fdpos_receipts: receipts,
    fdpos_ingredient_prices: ingredientPrices,
    fdpos_price_history: priceHistory
  });
}

// ---------- BACKUP & RESTORE ----------
function collectBackup() {
  const data = {};
  DATA_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
  return { app: 'FreshDrop POS', schema: 1, exportedAt: new Date().toISOString(), data };
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Returns true if a backup file was produced, false if the user cancelled the share sheet.
async function exportBackup() {
  if (!requireAdmin()) return false;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = new File([JSON.stringify(collectBackup())], `freshdrop-backup-${stamp}.json`, { type: 'application/json' });
  let shared = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'FreshDrop POS backup' });
      shared = true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
  }
  if (!shared) downloadFile(file);
  try { localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString()); } catch (_) {}
  updateBackupStatus();
  return true;
}

function applyRawData(dataObj) {
  DATA_KEYS.forEach(k => localStorage.removeItem(k));
  Object.entries(dataObj).forEach(([k, v]) => localStorage.setItem(k, v));
}

async function importBackupFile(file) {
  if (!requireAdmin()) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (e) { alert('❌ That file is not valid JSON.'); return; }
  if (!parsed || parsed.app !== 'FreshDrop POS' || !isPlainObject(parsed.data)) {
    alert('❌ This is not a FreshDrop POS backup file.');
    return;
  }
  const incoming = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!DATA_KEYS.includes(k)) continue;
    try { JSON.parse(v); } catch (e) { alert(`❌ Backup is damaged (${k} is unreadable). Nothing was changed.`); return; }
    incoming[k] = v;
  }
  if (!incoming.fdpos_menu || !incoming.fdpos_stock) {
    alert('❌ Backup is missing menu or stock data. Nothing was changed.');
    return;
  }
  const when = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : 'unknown date';
  if (!confirm(`Restore backup from ${when}?\n\nThis REPLACES all current data (orders, stock, sales, prices). Export a backup of the current data first if you might need it.`)) return;
  const previous = collectBackup().data;
  try {
    applyRawData(incoming);
  } catch (err) {
    try { applyRawData(previous); } catch (_) {}
    alert('❌ Restore failed (storage problem). Your previous data was put back.');
    return;
  }
  alert('✅ Backup restored. The app will reload now.');
  location.reload();
}

async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      persistentStorage = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch (_) { persistentStorage = null; }
  updateBackupStatus();
}

function storageChars() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('fdpos_')) n += k.length + (localStorage.getItem(k) || '').length; } } catch (_) {}
  return n;
}

function updateBackupStatus() {
  const el = document.getElementById('backupStatus');
  if (!el) return;
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch (_) {}
  let text, stale = false;
  if (!last) { text = '⚠️ No backup has ever been exported.'; stale = true; }
  else {
    const days = (Date.now() - new Date(last).getTime()) / 86400000;
    text = `Last backup: ${new Date(last).toLocaleString()}`;
    if (days > BACKUP_WARN_DAYS) { text += ` (${Math.floor(days)} days ago)`; stale = true; }
  }
  const mb = (storageChars() * 2 / 1048576).toFixed(2);
  const prot = persistentStorage === true ? 'protected from auto-cleanup' : (persistentStorage === false ? 'NOT protected from auto-cleanup' : 'protection unknown');
  el.style.color = stale ? '#c62828' : '#2e7d32';
  el.innerHTML = `${esc(text)}<br><small style="color:#666;">Browser storage: ~${mb} MB used, ${prot}. Browser data can be wiped; the exported file is your real backup.</small>`;
}

function renderBackupPanel() {
  const section = document.querySelector('#adminTab .admin-section');
  if (!section || document.getElementById('backupPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'backupPanel';
  panel.className = 'history-viewer';
  panel.innerHTML = `
    <h4>💾 Data Backup</h4>
    <div id="backupStatus" style="margin:6px 0 10px; font-weight:600;"></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button id="exportBackupBtn" class="btn btn-primary">⬇️ Export Backup</button>
      <button id="importBackupBtn" class="btn btn-outline">⬆️ Restore Backup</button>
      <button id="changePinBtn" class="btn btn-outline">🔑 Change PIN</button>
    </div>
    <input type="file" id="importBackupInput" accept="application/json,.json" style="display:none">`;
  const history = section.querySelector('.history-viewer');
  section.insertBefore(panel, history);
  document.getElementById('exportBackupBtn').addEventListener('click', () => exportBackup());
  document.getElementById('changePinBtn').addEventListener('click', changeAdminPin);
  const input = document.getElementById('importBackupInput');
  document.getElementById('importBackupBtn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { if (input.files[0]) importBackupFile(input.files[0]); input.value = ''; });
  updateBackupStatus();
}

// ---------- ROLES ----------
// NOTE: this runs in the browser, so it stops accidents and casual tampering, not a determined person with dev tools.
let pinFailures = 0;
let pinLockedUntil = 0;
let idleTimer = null;
const isAdmin = () => currentRole === 'admin';

function requireAdmin() {
  if (isAdmin()) return true;
  alert('🔒 Admin only. Switch to Admin Mode first.');
  return false;
}

async function hashPin(pin) {
  const text = `fdpos|${pin}`;
  try {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_) {}
  let h = 5381;
  for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return 'x' + h;
}

function askPin(title, note = '') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'block';
    overlay.style.zIndex = '10000';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:320px;">
        <h3>${esc(title)}</h3>
        ${note ? `<p style="color:#666; margin:6px 0;">${esc(note)}</p>` : ''}
        <input type="password" inputmode="numeric" autocomplete="off" maxlength="12" class="pin-field" style="width:100%; padding:10px; font-size:1.2rem; letter-spacing:4px; margin:8px 0; box-sizing:border-box;">
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary pin-ok">OK</button>
          <button class="btn btn-outline pin-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.pin-field');
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelector('.pin-ok').onclick = () => done(input.value);
    overlay.querySelector('.pin-cancel').onclick = () => done(null);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value); });
    setTimeout(() => input.focus(), 50);
  });
}

async function createPin() {
  const first = await askPin('Create Admin PIN', 'Choose 4 to 12 digits. Do not share it with staff.');
  if (first === null) return false;
  if (!/^\d{4,12}$/.test(first)) { alert('❌ The PIN must be 4 to 12 digits.'); return false; }
  const second = await askPin('Confirm Admin PIN');
  if (second !== first) { if (second !== null) alert('❌ The PINs did not match.'); return false; }
  try { localStorage.setItem(ADMIN_PIN_KEY, await hashPin(first)); }
  catch (e) { alert('❌ Could not save the PIN (storage problem).'); return false; }
  return true;
}

async function authenticateAdmin() {
  let stored = null;
  try { stored = localStorage.getItem(ADMIN_PIN_KEY); } catch (_) {}
  if (!stored) {
    const ok = await createPin();
    if (ok) alert('✅ Admin PIN set. You need it every time you enter Admin Mode.');
    return ok;
  }
  const wait = Math.ceil((pinLockedUntil - Date.now()) / 1000);
  if (wait > 0) { alert(`⏳ Too many wrong attempts. Try again in ${wait}s.`); return false; }
  const entered = await askPin('Admin PIN');
  if (entered === null) return false;
  if ((await hashPin(entered)) === stored) { pinFailures = 0; return true; }
  pinFailures++;
  if (pinFailures >= PIN_MAX_TRIES) {
    pinFailures = 0;
    pinLockedUntil = Date.now() + PIN_LOCK_SECONDS * 1000;
    alert(`❌ Wrong PIN. Locked for ${PIN_LOCK_SECONDS}s.`);
  } else {
    alert('❌ Wrong PIN.');
  }
  return false;
}

async function changeAdminPin() {
  if (!requireAdmin()) return;
  const stored = localStorage.getItem(ADMIN_PIN_KEY);
  if (stored) {
    const current = await askPin('Current PIN');
    if (current === null) return;
    if ((await hashPin(current)) !== stored) { alert('❌ Wrong PIN.'); return; }
  }
  if (await createPin()) alert('✅ PIN changed.');
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!isAdmin()) return;
  idleTimer = setTimeout(() => {
    setRole('staff');
    alert('🔒 Admin Mode ended after inactivity.');
  }, ADMIN_IDLE_MINUTES * 60000);
}

function applyRoleUI() {
  const admin = isAdmin();
  ADMIN_ONLY_BUTTON_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = admin ? '' : 'none'; });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.style.display = (admin || STAFF_TABS.includes(btn.dataset.tab)) ? '' : 'none';
  });
  if (!admin) {
    ['tablesModal', 'itemsModal', 'itemFormModal', 'priceManagementModal'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    const active = document.querySelector('.tab-btn.active');
    if (active && !STAFF_TABS.includes(active.dataset.tab)) switchTab('orders');
  }
  renderMenu();
  renderStockList();
}

function setRole(role) {
  currentRole = role;
  const sel = document.getElementById('roleSwitcher');
  if (sel) sel.value = role;
  applyRoleUI();
  resetIdleTimer();
}

// ---------- PRICE MANAGEMENT ----------
function getCurrentPricePerGram(ingredientName) {
  if (ingredientName === 'CupSet') {
    return ingredientPrices['CupSet'] || 30;
  }
  const pricePerKg = ingredientPrices[ingredientName] || 0;
  return pricePerKg / 1000;
}

// Cost of ONE serving at TODAY's ingredient prices. Only ever used at the moment of sale.
function unitCostOf(menuItem) {
  let cost = 0;
  for (const [ingredient, amount] of Object.entries(menuItem?.recipe || {})) {
    cost += amount * getCurrentPricePerGram(ingredient);
  }
  return round2(cost + getCurrentPricePerGram('CupSet'));
}

// Keeps the old name; lines are cart lines ({id, qty}).
function computeCostForOrder(lines) {
  return round2(lines.reduce((s, l) => s + unitCostOf(findMenuItem(l.id)) * (l.qty || 1), 0));
}

// Pure check: returns { stock } with the new levels, or { error } with a human message. Does not mutate anything.
function planStockDeduction(cart) {
  const next = { ...stock };
  for (const line of cart) {
    const menuItem = findMenuItem(line.id);
    if (!menuItem || !menuItem.recipe) {
      return { error: `"${line.name}" has no recipe (it was removed before this update). Remove it from the cart.` };
    }
    for (const [ingredient, perCup] of Object.entries(menuItem.recipe)) {
      const need = perCup * line.qty;
      if (!hasOwn(next, ingredient) || !Number.isFinite(next[ingredient])) {
        return { error: `${ingredient} (used in ${menuItem.name}) is not in the stock list. Add it in the Stock tab or fix the recipe.` };
      }
      if (next[ingredient] < need) {
        return { error: `Insufficient ${ingredient} for ${menuItem.name}! Need ${need} but only ${next[ingredient]} available.` };
      }
      next[ingredient] -= need;
    }
    if (!hasOwn(next, 'CupSet') || !Number.isFinite(next.CupSet)) {
      return { error: 'CupSet is not in the stock list, so cups cannot be tracked.' };
    }
    if (next.CupSet < line.qty) {
      return { error: `Insufficient cups! Need ${line.qty} but only ${next.CupSet} left.` };
    }
    next.CupSet -= line.qty;
  }
  return { stock: next };
}

function recordPriceChange(ingredientName, oldPrice, newPrice) {
  priceHistory.push({
    date: new Date().toISOString(),
    ingredient: ingredientName,
    oldPrice: oldPrice,
    newPrice: newPrice,
    changedBy: currentRole
  });
  if (priceHistory.length > 100) priceHistory = priceHistory.slice(-100);
}

// A price change only affects FUTURE sales. Past receipts keep the unit costs frozen at the time of sale.
function updateIngredientPrice(ingredientName, newPricePerKg) {
  if (!requireAdmin()) return false;
  const oldPrice = ingredientPrices[ingredientName];
  if (oldPrice === newPricePerKg) return false;
  ingredientPrices[ingredientName] = newPricePerKg;
  recordPriceChange(ingredientName, oldPrice, newPricePerKg);
  saveData();
  updateDashboardAndStockViews();
  return true;
}

// ---------- RENDER FUNCTIONS ----------
function renderTables() {
  const container = document.getElementById('tablesContainer');
  if (!container) return;
  container.innerHTML = '';
  tables.forEach(t => {
    const btn = document.createElement('button');
    btn.className = `table-chip ${currentTable === t.id ? 'active' : ''}`;
    btn.textContent = `🍽️ ${t.name}`;
    btn.onclick = () => {
      document.querySelectorAll('.table-chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      currentTable = t.id;
      document.getElementById('currentTableName').innerText = t.name;
      renderCart();
    };
    container.appendChild(btn);
  });
  const takeawayBtn = document.createElement('button');
  takeawayBtn.className = `table-chip ${currentTable === 'takeaway' ? 'active' : ''}`;
  takeawayBtn.innerHTML = '🛍️ Takeaway';
  takeawayBtn.onclick = () => {
    document.querySelectorAll('.table-chip').forEach(c => c.classList.remove('active'));
    takeawayBtn.classList.add('active');
    currentTable = 'takeaway';
    document.getElementById('currentTableName').innerText = 'Takeaway';
    renderCart();
  };
  container.appendChild(takeawayBtn);
  const label = document.getElementById('currentTableName');
  if (label) label.innerText = currentTableLabel();
}

function renderCategories() {
  const container = document.getElementById('categoryBar');
  if (!container) return;
  container.innerHTML = '<button class="category-btn active" data-category="all">📋 All Items</button>';
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'category-btn';
    btn.textContent = `${cat.icon || '📌'} ${cat.name}`;
    btn.onclick = () => {
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = cat.id;
      renderMenu();
    };
    container.appendChild(btn);
  });
}

function renderMenu() {
  const container = document.getElementById('menuGrid');
  if (!container) return;
  let filteredItems = menuItems.filter(item => item.active !== false && !item.deleted);
  if (currentCategory !== 'all') {
    filteredItems = filteredItems.filter(item => item.category === currentCategory);
  }
  container.innerHTML = '';
  filteredItems.forEach(item => {
    const category = categories.find(c => c.id === item.category);
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      ${currentRole === 'admin' ? '<button class="edit-item-btn" data-id="' + esc(item.id) + '" style="position:absolute; top:5px; right:5px; background:none; border:none; font-size:1rem; cursor:pointer;">✏️</button>' : ''}
      <div class="product-category">${esc(category ? category.name : 'Juice')}</div>
      <div class="product-name">${esc(item.name)}</div>
      <div class="product-price">LKR ${esc(item.price)}</div>
      <div class="qty-selector">
        <button class="qty-btn dec-qty" data-id="${esc(item.id)}">-</button>
        <span id="qty-${esc(item.id)}">1</span>
        <button class="qty-btn inc-qty" data-id="${esc(item.id)}">+</button>
      </div>
      <button class="add-btn" data-id="${esc(item.id)}">➕ Add</button>
    `;
    container.appendChild(card);
  });
  document.querySelectorAll('.dec-qty').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const span = document.getElementById(`qty-${btn.dataset.id}`);
      let val = parseInt(span.innerText);
      if (val > 1) span.innerText = val - 1;
    };
  });
  document.querySelectorAll('.inc-qty').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const span = document.getElementById(`qty-${btn.dataset.id}`);
      span.innerText = parseInt(span.innerText) + 1;
    };
  });
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.onclick = () => {
      const menuItem = findMenuItem(btn.dataset.id);
      if (!menuItem) return;
      const qty = parseInt(document.getElementById(`qty-${menuItem.id}`).innerText) || 1;
      const price = Number(menuItem.price) || 0;
      const cart = currentCart();
      const existing = cart.find(l => l.id === menuItem.id && l.price === price);
      if (existing) existing.qty += qty;
      else cart.push({ id: menuItem.id, name: menuItem.name, price, qty, timestamp: Date.now() });
      renderCart();
      saveData();
    };
  });
  if (currentRole === 'admin') {
    document.querySelectorAll('.edit-item-btn').forEach(btn => {
      btn.onclick = () => openEditItemModal(btn.dataset.id);
    });
  }
}

function renderCart() {
  const cart = currentCart();
  const container = document.getElementById('cartItems');
  const totalSpan = document.getElementById('cartTotal');
  if (!container) return;
  if (cart.length === 0) {
    container.innerHTML = '<div class="empty-cart">✨ Cart empty. Add items!</div>';
    totalSpan.innerText = '0';
    return;
  }
  container.innerHTML = '';
  cart.forEach((line, idx) => {
    const missing = !findMenuItem(line.id);
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <span>${esc(line.name)} × ${line.qty}${missing ? ' ⚠️ <small>(item removed, delete this line)</small>' : ''}</span>
      <span>LKR ${fmt(line.price * line.qty)}</span>
      <span>
        <button class="remove-item dec-line" data-index="${idx}" title="One less">➖</button>
        <button class="remove-item remove-line" data-index="${idx}" title="Remove line">🗑️</button>
      </span>`;
    container.appendChild(div);
  });
  totalSpan.innerText = fmt(cartTotal(cart));
  container.querySelectorAll('.dec-line').forEach(btn => {
    btn.onclick = () => {
      const line = cart[parseInt(btn.dataset.index)];
      if (!line) return;
      line.qty -= 1;
      if (line.qty <= 0) cart.splice(parseInt(btn.dataset.index), 1);
      renderCart();
      saveData();
    };
  });
  container.querySelectorAll('.remove-line').forEach(btn => {
    btn.onclick = () => {
      cart.splice(parseInt(btn.dataset.index), 1);
      renderCart();
      saveData();
    };
  });
}

// ---------- STOCK MANAGEMENT ----------
function findStockNameCI(name) {
  const wanted = String(name).trim().toLowerCase();
  return Object.keys(stock).find(k => k.toLowerCase() === wanted);
}

function renderStockList() {
  const container = document.getElementById('stockList');
  if (!container) return;
  const search = document.getElementById('stockSearch')?.value.toLowerCase() || '';
  let lowCount = 0;
  container.innerHTML = '';
  for (let [name, qty] of Object.entries(stock)) {
    if (search && !name.toLowerCase().includes(search)) continue;
    const isLow = (qty < 200 && name !== 'CupSet') || (name === 'CupSet' && qty < 30);
    if (isLow) lowCount++;
    const div = document.createElement('div');
    div.className = `stock-item ${isLow ? 'low-stock' : ''}`;
    div.innerHTML = `
      <span><strong>${esc(name)}</strong><br>${qty} ${name.includes('Milk') ? 'ml' : (name === 'CupSet' ? 'units' : 'g')}</span>
      ${isAdmin() ? `<div style="display: flex; gap: 5px; flex-wrap: wrap;">
        <button class="rename-stock-btn" data-name="${esc(name)}" style="background:#2196F3; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">✏️ Rename</button>
        <button class="edit-stock-btn" data-name="${esc(name)}" style="background:#FF9800; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">📝 Set</button>
        <button class="restock-btn" data-name="${esc(name)}" style="background:#4CAF50; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">➕ Add</button>
        <button class="reduce-stock-btn" data-name="${esc(name)}" style="background:#f44336; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">➖ Remove</button>
      </div>` : ''}
    `;
    container.appendChild(div);
  }
  const banner = document.getElementById('lowStockBanner');
  if (banner) banner.innerText = lowCount > 0 ? `⚠️ Low stock: ${lowCount} items below threshold` : '✅ Stock levels healthy';

  document.querySelectorAll('.edit-stock-btn').forEach(btn => {
    btn.onclick = () => {
      let newVal = prompt(`Enter new quantity for ${btn.dataset.name}:`);
      if (newVal !== null && newVal.trim() !== '' && !isNaN(newVal) && parseInt(newVal) >= 0) {
        stock[btn.dataset.name] = parseInt(newVal);
        saveData();
        renderStockList();
        alert(`✅ ${btn.dataset.name} set to ${parseInt(newVal)}`);
      }
    };
  });
  document.querySelectorAll('.restock-btn').forEach(btn => {
    btn.onclick = () => {
      let addVal = prompt(`Add how much to ${btn.dataset.name}:`);
      if (addVal && !isNaN(addVal) && parseInt(addVal) > 0) {
        stock[btn.dataset.name] += parseInt(addVal);
        saveData();
        renderStockList();
        alert(`✅ Added ${addVal} to ${btn.dataset.name}. New total: ${stock[btn.dataset.name]}`);
      }
    };
  });
  document.querySelectorAll('.reduce-stock-btn').forEach(btn => {
    btn.onclick = () => {
      let removeVal = prompt(`Remove how much from ${btn.dataset.name}? (for waste, spoilage, bad fruit, expired milk)`);
      if (removeVal && !isNaN(removeVal) && parseInt(removeVal) > 0) {
        const currentQty = stock[btn.dataset.name];
        const newQty = currentQty - parseInt(removeVal);
        if (newQty >= 0) {
          stock[btn.dataset.name] = newQty;
          saveData();
          renderStockList();
          alert(`✅ Removed ${removeVal} from ${btn.dataset.name}. Remaining: ${newQty}`);
        } else {
          alert(`❌ Cannot remove more than available! Current stock: ${currentQty}`);
        }
      }
    };
  });
  document.querySelectorAll('.rename-stock-btn').forEach(btn => {
    btn.onclick = () => {
      const oldName = btn.dataset.name;
      let newName = prompt(`Rename "${oldName}" to:`, oldName);
      if (newName === null) return;
      newName = newName.trim();
      if (newName === '' || newName === oldName) return;
      const clash = findStockNameCI(newName);
      if (clash !== undefined && clash !== oldName) {
        alert(`❌ "${clash}" already exists!`);
        return;
      }
      stock[newName] = stock[oldName];
      delete stock[oldName];
      // keep the price attached to the ingredient, otherwise its cost silently becomes 0
      if (hasOwn(ingredientPrices, oldName)) {
        ingredientPrices[newName] = ingredientPrices[oldName];
        delete ingredientPrices[oldName];
      }
      menuItems.forEach(item => {
        if (item.recipe && hasOwn(item.recipe, oldName)) {
          item.recipe[newName] = item.recipe[oldName];
          delete item.recipe[oldName];
        }
      });
      saveData();
      renderStockList();
      renderMenu();
      renderItemsList();
      alert(`✅ Renamed "${oldName}" to "${newName}"`);
    };
  });
}

function addIngredient() {
  if (!requireAdmin()) return;
  let name = prompt('Ingredient name:');
  if (name === null) return;
  name = name.trim();
  if (!name) return;
  const clash = findStockNameCI(name);
  if (clash !== undefined) {
    alert(`❌ "${clash}" already exists!`);
    return;
  }
  let qty = prompt('Initial quantity (g/ml/units):');
  if (qty !== null && qty.trim() !== '' && !isNaN(qty) && parseInt(qty) >= 0) {
    stock[name] = parseInt(qty);
    let price = prompt(`Set price per kg for ${name} (LKR):`);
    if (price && !isNaN(price) && parseInt(price) > 0) {
      ingredientPrices[name] = parseInt(price);
    } else {
      ingredientPrices[name] = 500;
    }
    saveData();
    renderStockList();
    alert(`✅ Added new ingredient: ${name} with ${parseInt(qty)} units at LKR ${ingredientPrices[name]}/kg`);
  }
}

// ---------- ITEM MANAGEMENT ----------
function ingredientOptions(selected) {
  const names = Object.keys(stock).filter(i => i !== 'CupSet');
  if (selected && !names.includes(selected)) names.push(selected); // never silently swap a recipe ingredient
  return names.map(ing => `<option value="${esc(ing)}" ${ing === selected ? 'selected' : ''}>${esc(ing)}${hasOwn(stock, ing) ? '' : ' (missing from stock!)'}</option>`).join('');
}

function openEditItemModal(itemId) {
  if (!requireAdmin()) return;
  const item = menuItems.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('itemFormTitle').innerText = 'Edit Item';
  document.getElementById('itemId').value = item.id;
  document.getElementById('itemName').value = item.name;
  document.getElementById('itemPrice').value = item.price;
  document.getElementById('itemCategory').value = item.category;
  const container = document.getElementById('ingredientsList');
  container.innerHTML = '';
  for (let [ingredient, amount] of Object.entries(item.recipe || {})) {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `
      <select class="ingredient-name">${ingredientOptions(ingredient)}</select>
      <input type="number" class="ingredient-amount" value="${esc(amount)}" placeholder="Amount" step="1">
      <button type="button" class="remove-ingredient">✖️</button>
    `;
    container.appendChild(div);
  }
  container.querySelectorAll('.remove-ingredient').forEach(btn => {
    btn.onclick = () => btn.parentElement.remove();
  });
  document.getElementById('itemFormModal').style.display = 'block';
}

function saveItemForm(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  const itemId = document.getElementById('itemId').value;
  const name = document.getElementById('itemName').value.trim();
  const price = parseInt(document.getElementById('itemPrice').value);
  const category = document.getElementById('itemCategory').value;
  if (!name || isNaN(price) || price < 0) {
    alert('Please enter a name and a valid price!');
    return;
  }
  const recipe = {};
  let hasValidIngredient = false;
  document.querySelectorAll('#ingredientsList .ingredient-row').forEach(row => {
    const ingredient = row.querySelector('.ingredient-name').value;
    const amount = parseInt(row.querySelector('.ingredient-amount').value);
    if (ingredient && amount > 0) {
      recipe[ingredient] = (recipe[ingredient] || 0) + amount; // same ingredient twice = add up, don't overwrite
      hasValidIngredient = true;
    }
  });
  if (!hasValidIngredient) {
    alert('Please add at least one ingredient with amount > 0!');
    return;
  }
  if (itemId) {
    const index = menuItems.findIndex(i => i.id === itemId);
    if (index !== -1) {
      menuItems[index] = { ...menuItems[index], name, price, category, recipe };
      alert(`✅ Item "${name}" updated successfully! (Past sales keep their original costs.)`);
    }
  } else {
    const newId = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    menuItems.push({ id: newId, name, price, category, recipe, active: true });
    alert(`✅ New item "${name}" added successfully!`);
  }
  saveData();
  renderMenu();
  renderItemsList();
  document.getElementById('itemFormModal').style.display = 'none';
}

function openAddItemModal() {
  if (!requireAdmin()) return;
  document.getElementById('itemFormTitle').innerText = 'Add New Item';
  document.getElementById('itemId').value = '';
  document.getElementById('itemName').value = '';
  document.getElementById('itemPrice').value = '';
  document.getElementById('itemCategory').value = 'fresh_juice';
  document.getElementById('ingredientsList').innerHTML = '';
  document.getElementById('itemFormModal').style.display = 'block';
}

function renderItemsList() {
  const container = document.getElementById('itemsListContainer');
  if (!container) return;
  container.innerHTML = '';
  menuItems.filter(item => !item.deleted).forEach(item => {
    const div = document.createElement('div');
    div.className = 'stock-item';
    div.style.marginBottom = '10px';
    div.innerHTML = `
      <div style="flex:1;">
        <strong>${esc(item.name)}</strong><br>
        Price: LKR ${esc(item.price)} | Category: ${esc(categories.find(c => c.id === item.category)?.name || 'Juice')}<br>
        <small style="color:#666;">Recipe: ${Object.entries(item.recipe || {}).map(([ing, amt]) => `${esc(ing)}:${esc(amt)}g`).join(', ')}</small>
      </div>
      <div style="display: flex; gap: 5px;">
        <button class="edit-existing-item-btn" data-id="${esc(item.id)}" style="background:#FF9800; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">✏️ Edit</button>
        <button class="delete-item-btn" data-id="${esc(item.id)}" style="background:#f44336; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">🗑️ Delete</button>
      </div>
    `;
    container.appendChild(div);
  });
  document.querySelectorAll('.edit-existing-item-btn').forEach(btn => {
    btn.onclick = () => openEditItemModal(btn.dataset.id);
  });
  document.querySelectorAll('.delete-item-btn').forEach(btn => {
    btn.onclick = () => {
      if (!requireAdmin()) return;
      const itemToDelete = menuItems.find(i => i.id === btn.dataset.id);
      if (!itemToDelete) return;
      if (confirm(`Remove "${itemToDelete.name}" from the menu?\n\nOrders already in a cart and past sales are not affected.`)) {
        // Soft delete: the record (and its recipe) stays so open orders can still be checked out.
        itemToDelete.deleted = true;
        saveData();
        renderMenu();
        renderItemsList();
        renderCart();
        alert('✅ Item removed from the menu.');
      }
    };
  });
}

// ---------- CHECKOUT & RECEIPT ----------
function checkout() {
  rolloverIfNewDay();
  refreshAfterRollover();
  const cart = currentCart();
  if (cart.length === 0) {
    alert('Cart is empty!');
    return;
  }
  const plan = planStockDeduction(cart);
  if (plan.error) {
    alert(plan.error);
    return;
  }
  pendingCart = cart;
  pendingCartKey = currentTable;
  pendingTableName = currentTableLabel();
  document.getElementById('customerModal').style.display = 'block';
  document.getElementById('customerName').value = '';
}

function generateReceipt(customerName) {
  rolloverIfNewDay();
  const cart = pendingCart;
  if (!cart || cart.length === 0) return;
  const plan = planStockDeduction(cart);
  if (plan.error) {
    alert(plan.error);
    return;
  }
  // Freeze each line's cost NOW. Later price or recipe edits must never touch it.
  const items = cart.map(l => ({
    id: l.id,
    name: l.name,
    price: l.price,
    qty: l.qty,
    unitCost: unitCostOf(findMenuItem(l.id))
  }));
  const total = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const orderCost = round2(items.reduce((s, i) => s + i.unitCost * i.qty, 0));
  const cups = items.reduce((s, i) => s + i.qty, 0);

  stock = plan.stock;
  todaysSales.revenue = round2(todaysSales.revenue + total);
  todaysSales.cost = round2(todaysSales.cost + orderCost);
  todaysSales.profit = round2(todaysSales.revenue - todaysSales.cost);
  todaysSales.ordersCount += 1;
  todaysSales.cupsSold += cups;
  const receipt = {
    id: 'RCP-' + Date.now(),
    date: new Date().toISOString(),
    businessDate: todaysSales.date,
    customerName: customerName,
    table: pendingTableName,
    items,
    total,
    cost: orderCost,
    cups
  };
  receipts.push(receipt);
  todaysSales.transactions.push(receipt);
  if (pendingCartKey !== null && Array.isArray(carts[pendingCartKey])) carts[pendingCartKey] = [];
  saveData();
  renderCart();
  updateDashboardAndStockViews();
  renderStockList();
  displayReceipt(receipt);
  pendingCart = null;
  pendingCartKey = null;
  document.getElementById('customerModal').style.display = 'none';
}

function displayReceipt(receipt) {
  const when = new Date(receipt.date);
  const lines = receipt.items.map(item => {
    const qty = item.qty || 1;
    const label = (qty > 1 ? `${item.name} x${qty}` : item.name).padEnd(25);
    return `${esc(label)} LKR ${fmt(item.price * qty)}`;
  }).join('\n');
  const receiptHTML = `
    <pre style="font-family: 'Courier New', monospace; font-size: 12px;">
${'='.repeat(40)}
<b>${SHOP_NAME}</b>
${'='.repeat(40)}
📞 ${SHOP_PHONE}
📅 ${when.toLocaleDateString()}
⏰ ${when.toLocaleTimeString()}
${'='.repeat(40)}
👤 Customer: ${esc(receipt.customerName)}
🍽️ ${esc(receipt.table)}
${'='.repeat(40)}
Item                     Price
${'-'.repeat(40)}
${lines}
${'-'.repeat(40)}
TOTAL${' '.repeat(30)} LKR ${fmt(receipt.total)}
${'='.repeat(40)}
${THANK_YOU_MSG}
${WELCOME_MSG}
${'='.repeat(40)}
Receipt #: ${receipt.id}
    </pre>
  `;
  document.getElementById('receiptContent').innerHTML = receiptHTML;
  document.getElementById('receiptModal').style.display = 'block';
}

function printReceipt() {
  const receiptContent = document.getElementById('receiptContent').innerHTML;
  const printWindow = window.open('', '_blank');
  printWindow.document.write(`<html><head><title>Receipt</title></head><body>${receiptContent}</body></html>`);
  printWindow.document.close();
  printWindow.print();
}

function downloadPDF() {
  const element = document.getElementById('receiptContent');
  html2pdf().from(element).save('receipt.pdf');
}

function sendWhatsApp() {
  const receiptText = document.getElementById('receiptContent').innerText;
  window.open(`https://wa.me/?text=${encodeURIComponent(receiptText)}`, '_blank');
}

// ---------- TABLE MANAGEMENT ----------
// Edits happen on a draft copy and are committed by "Save Tables". Closing the modal discards them.
function nextTableId() {
  let max = -1;
  [...tables.map(t => t.id), ...tablesDraft.map(t => t.id), ...Object.keys(carts)].forEach(id => {
    const m = /^table_(\d+)/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1]));
  });
  return `table_${max + 1}`;
}

function renderTablesDraft() {
  const container = document.getElementById('tablesList');
  container.innerHTML = '';
  tablesDraft.forEach(t => {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = t.name;
    input.style.flex = '1';
    input.addEventListener('input', () => { t.name = input.value; });
    const del = document.createElement('button');
    del.className = 'remove-ingredient';
    del.textContent = '🗑️';
    del.onclick = () => {
      const open = carts[t.id] || [];
      if (open.length > 0) {
        alert(`❌ "${t.name}" still has an open order (${cartCups(open)} items). Check it out or clear it first.`);
        return;
      }
      tablesDraft = tablesDraft.filter(x => x.id !== t.id);
      renderTablesDraft();
    };
    div.appendChild(input);
    div.appendChild(del);
    container.appendChild(div);
  });
}

function manageTables() {
  if (!requireAdmin()) return;
  tablesDraft = tables.map(t => ({ ...t }));
  renderTablesDraft();
  document.getElementById('tablesModal').style.display = 'block';
}

function addNewTable() {
  if (!requireAdmin()) return;
  tablesDraft.push({ id: nextTableId(), name: `Table ${tablesDraft.length + 1}` });
  renderTablesDraft();
}

function saveTables() {
  if (!requireAdmin()) return;
  const removed = tables.filter(t => !tablesDraft.some(d => d.id === t.id));
  const blocked = removed.find(t => (carts[t.id] || []).length > 0);
  if (blocked) {
    alert(`❌ "${blocked.name}" has an open order and can't be removed.`);
    return;
  }
  tables = tablesDraft.map((t, i) => ({ id: t.id, name: (t.name || '').trim() || `Table ${i + 1}` }));
  removed.forEach(t => { delete carts[t.id]; });
  ensureCarts();
  if (currentTable !== 'takeaway' && !tables.some(t => t.id === currentTable)) {
    currentTable = tables[0]?.id ?? 'takeaway';
  }
  saveData();
  renderTables();
  renderCart();
  document.getElementById('tablesModal').style.display = 'none';
}

// ---------- DASHBOARD & REPORTS ----------
function updateDashboardAndStockViews() {
  const container = document.getElementById('dashboardCards');
  if (!container) return;
  const lowStockCount = Object.entries(stock).filter(([k, v]) =>
    (v < 200 && k !== 'CupSet') || (k === 'CupSet' && v < 30)
  ).length;
  container.innerHTML = `
    <div class="stat-card"><h4>Today's Revenue</h4><div class="stat-number">LKR ${fmt(todaysSales.revenue)}</div></div>
    <div class="stat-card"><h4>Cost</h4><div class="stat-number">LKR ${fmt(todaysSales.cost)}</div></div>
    <div class="stat-card"><h4>Profit</h4><div class="stat-number">LKR ${fmt(todaysSales.profit)}</div></div>
    <div class="stat-card"><h4>Orders</h4><div class="stat-number">${todaysSales.ordersCount}</div></div>
    <div class="stat-card"><h4>Cups Sold</h4><div class="stat-number">${todaysSales.cupsSold}</div></div>
    <div class="stat-card"><h4>⚠️ Low Stock</h4><div class="stat-number">${lowStockCount}</div></div>
  `;
  const runningCount = Object.values(carts).filter(arr => arr.length > 0).length;
  container.innerHTML += `<div class="stat-card"><h4>Active Tables</h4><div class="stat-number">${runningCount}</div></div>`;
}

function showProfitBreakdown() {
  const profitMargin = todaysSales.revenue > 0 ? (todaysSales.profit / todaysSales.revenue * 100) : 0;
  const itemSales = {};
  todaysSales.transactions.forEach(receipt => {
    receipt.items.forEach(item => {
      const qty = item.qty || 1;
      if (!itemSales[item.name]) itemSales[item.name] = { quantity: 0, revenue: 0 };
      itemSales[item.name].quantity += qty;
      itemSales[item.name].revenue += item.price * qty;
    });
  });
  const topItems = Object.entries(itemSales).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
  const profitHTML = `
    <div class="profit-breakdown">
      <h3>📊 Profit Breakdown</h3>
      <div class="profit-bar"><div class="profit-bar-fill" style="width: ${Math.max(0, profitMargin)}%">${profitMargin.toFixed(1)}% Profit</div></div>
      <div class="profit-stats">
        <div class="profit-stat-card"><div class="label">Revenue</div><div class="value">LKR ${fmt(todaysSales.revenue)}</div></div>
        <div class="profit-stat-card"><div class="label">Cost</div><div class="value">LKR ${fmt(todaysSales.cost)}</div></div>
        <div class="profit-stat-card"><div class="label">Profit</div><div class="value">LKR ${fmt(todaysSales.profit)}</div></div>
      </div>
      ${topItems.length > 0 ? `<h3 style="margin-top:15px;">🏆 Top Selling Items</h3>${topItems.map(([name, data]) => `<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #eee;"><span>${esc(name)}</span><span>${data.quantity} sold | LKR ${fmt(data.revenue)}</span></div>`).join('')}` : ''}
    </div>`;
  document.getElementById('reportDisplay').innerHTML = profitHTML;
}

function showProfitTrend() {
  const last7Days = historyArchive.slice(-7);
  if (last7Days.length === 0) {
    showReport('Not enough data for trend analysis. Close some days first.');
    return;
  }
  const avgProfit = last7Days.reduce((a, b) => a + b.profit, 0) / last7Days.length;
  const lastDayProfit = last7Days[last7Days.length - 1]?.profit || 0;
  const trend = lastDayProfit > avgProfit ? 'up' : (lastDayProfit < avgProfit ? 'down' : 'stable');
  const trendHTML = `<div class="profit-breakdown"><h3>📈 Profit Trend Analysis</h3><div class="profit-stats"><div class="profit-stat-card"><div class="label">Avg Daily Profit</div><div class="value">LKR ${Math.round(avgProfit)}</div></div><div class="profit-stat-card"><div class="label">Last Day Profit</div><div class="value">LKR ${fmt(lastDayProfit)}</div></div><div class="profit-stat-card"><div class="label">Trend</div><div class="value"><span class="trend-badge trend-${trend}">${trend === 'up' ? '📈 Up' : (trend === 'down' ? '📉 Down' : '➡️ Stable')}</span></div></div></div><h4>Daily Profit History:</h4>${last7Days.map(day => `<div style="display:flex; justify-content:space-between; padding:5px 0;"><span>${esc(day.date)}</span><span style="color:${day.profit >= 0 ? '#2e7d32' : '#f44336'}">LKR ${fmt(day.profit)}</span></div>`).join('')}</div>`;
  document.getElementById('reportDisplay').innerHTML = trendHTML;
}

function showPriceManagement() {
  if (!requireAdmin()) return;
  const modalContent = `
    <div class="modal-content" style="max-width: 600px;">
      <span class="close-price">&times;</span>
      <h2>💰 Ingredient Price Management</h2>
      <p style="color: #666; margin-bottom: 1rem;">Prices in LKR per kilogram. Changes apply to future sales only.</p>
      <div class="price-header">
        <button id="bulkPriceUpdateBtn" class="price-btn-bulk">📊 Bulk Update</button>
        <button id="priceHistoryBtn" class="price-btn-bulk" style="background: #2196F3;">📜 Price History</button>
      </div>
      <div class="price-list" id="priceListContainer">
        ${Object.entries(ingredientPrices).map(([name, price]) => `
          <div class="price-item">
            <div class="price-item-info">
              <div class="price-item-name">${esc(name)}</div>
              <div class="price-item-current">Current: LKR ${esc(price)}/kg</div>
            </div>
            <div class="price-item-actions">
              <input type="number" id="newprice-${esc(name.replace(/ /g, '_'))}" placeholder="New price" step="10" class="price-input">
              <button class="price-btn-edit" data-ingredient="${esc(name)}">Update</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  let priceModal = document.getElementById('priceManagementModal');
  if (!priceModal) {
    priceModal = document.createElement('div');
    priceModal.id = 'priceManagementModal';
    priceModal.className = 'modal';
    document.body.appendChild(priceModal);
  }
  priceModal.innerHTML = modalContent;
  priceModal.style.display = 'block';
  priceModal.querySelector('.close-price').onclick = () => priceModal.style.display = 'none';
  priceModal.querySelectorAll('.price-btn-edit').forEach(btn => {
    btn.onclick = () => {
      const ingredient = btn.dataset.ingredient;
      const inputId = `newprice-${ingredient.replace(/ /g, '_')}`;
      const newPrice = parseFloat(document.getElementById(inputId).value);
      if (isNaN(newPrice) || newPrice < 0) { alert('Please enter a valid price!'); return; }
      if (updateIngredientPrice(ingredient, newPrice)) {
        alert(`✅ ${ingredient} price updated to LKR ${newPrice}/kg`);
        showPriceManagement();
        renderStockList();
        updateDashboardAndStockViews();
      }
    };
  });
  priceModal.querySelector('#bulkPriceUpdateBtn').onclick = () => {
    const percentage = parseFloat(prompt('Enter percentage change (e.g., 10 for +10%, -5 for -5%):'));
    if (!isNaN(percentage)) {
      Object.keys(ingredientPrices).forEach(name => {
        const newPrice = ingredientPrices[name] * (1 + percentage / 100);
        updateIngredientPrice(name, Math.round(newPrice));
      });
      alert(`✅ Applied ${percentage}% change to all ingredients!`);
      showPriceManagement();
      renderStockList();
      updateDashboardAndStockViews();
    }
  };
  priceModal.querySelector('#priceHistoryBtn').onclick = () => {
    if (priceHistory.length === 0) { alert('No price changes recorded yet.'); return; }
    alert(priceHistory.slice(-10).map(p => `${new Date(p.date).toLocaleDateString()}: ${p.ingredient} ${p.oldPrice}→${p.newPrice}`).join('\n'));
  };
}

const sumOf = (arr, key) => arr.reduce((a, b) => a + (b[key] || 0), 0);
function dailyReport() {
  const margin = todaysSales.revenue > 0 ? ((todaysSales.profit / todaysSales.revenue) * 100).toFixed(1) : 0;
  showReport(`📅 DAILY SUMMARY\n━━━━━━━━━━━━━━━━━━━━━━━━━\nRevenue: LKR ${fmt(todaysSales.revenue)}\nCost: LKR ${fmt(todaysSales.cost)}\nProfit: LKR ${fmt(todaysSales.profit)}\nProfit Margin: ${margin}%\nOrders: ${todaysSales.ordersCount}\nCups: ${todaysSales.cupsSold}\n━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
function weeklyReport() {
  const total = sumOf(historyArchive, 'profit');
  showReport(`📆 WEEKLY TREND\n━━━━━━━━━━━━━━━━━━━━━━━━━\nArchived Days: ${historyArchive.length}\nTotal Revenue: LKR ${fmt(sumOf(historyArchive, 'revenue'))}\nTotal Profit: LKR ${fmt(total)}\nAvg Daily Profit: LKR ${historyArchive.length ? Math.round(total / historyArchive.length) : 0}\n━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
function monthlyReport() {
  showReport(`📈 MONTHLY SUMMARY\n━━━━━━━━━━━━━━━━━━━━━━━━━\nTotal Revenue: LKR ${fmt(sumOf(historyArchive, 'revenue'))}\nTotal Profit: LKR ${fmt(sumOf(historyArchive, 'profit'))}\nDays: ${historyArchive.length}\n━━━━━━━━━━━━━━━━━━━━━━━━━`);
}
function showReport(msg) { const el = document.getElementById('reportDisplay'); if (el) el.innerHTML = `<pre>${msg}</pre>`; }

function closeDay() {
  if (!requireAdmin()) return;
  if (!confirm('Close today and archive it? Today\'s totals will reset to zero.')) return;
  const summary = {
    date: todaysSales.date,
    revenue: round2(todaysSales.revenue),
    cost: round2(todaysSales.cost),
    profit: round2(todaysSales.profit),
    orders: todaysSales.ordersCount,
    cups: todaysSales.cupsSold
  };
  historyArchive.push(summary);
  todaysSales = newDayRecord();
  saveData();
  updateDashboardAndStockViews();
  renderHistoryList();
  alert('✅ Day closed & archived!');
  if (confirm('Save a backup file now? (Recommended at the end of every day.)')) exportBackup();
}

function resetDay() {
  if (!requireAdmin()) return;
  if (confirm('Reset today without archiving?')) {
    todaysSales = newDayRecord();
    saveData();
    updateDashboardAndStockViews();
    alert('Today reset.');
  }
}

function renderHistoryList() {
  const histDiv = document.getElementById('historyList');
  if (!histDiv) return;
  histDiv.innerHTML = historyArchive.slice().reverse().map(h => `<div class="history-card">📆 ${esc(h.date)} | Revenue: LKR ${fmt(h.revenue)} | Profit: LKR ${fmt(h.profit)} | Orders: ${esc(h.orders)}</div>`).join('');
  if (historyArchive.length === 0) histDiv.innerHTML = '<div class="history-card">No archived days yet.</div>';
}

async function resetAllData() {
  if (!requireAdmin()) return;
  if (!confirm('⚠️ WARNING: Reset ALL data? This cannot be undone!\n\nYou will be offered a backup file first.')) return;
  const saved = await exportBackup();
  if (!saved && !confirm('No backup was saved. Reset everything anyway?')) return;
  // only FreshDrop's own keys; localStorage.clear() would also wipe any other app on the same domain
  Object.keys(localStorage).filter(k => k.startsWith('fdpos_') && k !== ADMIN_PIN_KEY).forEach(k => localStorage.removeItem(k));
  location.reload();
}

function switchTab(tabName) {
  if (!isAdmin() && !STAFF_TABS.includes(tabName)) tabName = 'orders';
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const selectedTab = document.getElementById(`${tabName}Tab`);
  if (selectedTab) selectedTab.classList.add('active');
  const selectedBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (selectedBtn) selectedBtn.classList.add('active');
  if (tabName === 'stock') renderStockList();
  else if (tabName === 'reports') { rolloverIfNewDay(); updateDashboardAndStockViews(); }
  else if (tabName === 'admin') { rolloverIfNewDay(); renderHistoryList(); updateBackupStatus(); }
}

// ---------- PWA INSTALLATION ----------
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBanner = document.getElementById('installBanner');
  if (installBanner) installBanner.style.display = 'block';
});

document.getElementById('installAppBtn')?.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    document.getElementById('installBanner').style.display = 'none';
    deferredPrompt = null;
  }
});

document.getElementById('closeBannerBtn')?.addEventListener('click', () => {
  document.getElementById('installBanner').style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  console.log('PWA installed');
  document.getElementById('installBanner').style.display = 'none';
});

// ---------- EVENT LISTENERS ----------
window.addEventListener('DOMContentLoaded', () => {
  loadData();
  currentTable = tables[0]?.id ?? 'takeaway';
  rolloverIfNewDay();
  saveData();
  try { localStorage.setItem('fdpos_initialized', 'true'); } catch (_) {}
  renderTables(); renderCategories(); renderMenu(); renderCart(); renderStockList(); updateDashboardAndStockViews(); renderHistoryList(); renderItemsList();
  renderBackupPanel();
  requestPersistence();
  setRole('staff'); // always start locked, and force the dropdown to match (browsers can restore a stale selection)

  // the customer-name popup had no way out; add a Cancel button
  const customerBox = document.querySelector('#customerModal .modal-content');
  if (customerBox && !document.getElementById('cancelCustomerBtn')) {
    const cancel = document.createElement('button');
    cancel.id = 'cancelCustomerBtn';
    cancel.className = 'btn btn-outline';
    cancel.style.marginTop = '10px';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => { document.getElementById('customerModal').style.display = 'none'; pendingCart = null; pendingCartKey = null; };
    customerBox.appendChild(cancel);
  }

  // keep the business day correct while the app stays open overnight
  setInterval(() => { if (rolloverIfNewDay()) refreshAfterRollover(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && rolloverIfNewDay()) refreshAfterRollover(); });

  if (corruptKeys.length) {
    setTimeout(() => alert(`⚠️ Some saved data could not be read and was reset: ${corruptKeys.map(k => k.replace('fdpos_', '')).join(', ')}.\nThe damaged copy was kept in browser storage. If you have a backup file, restore it from Admin → Data Backup.`), 300);
  }

  document.getElementById('roleSwitcher')?.addEventListener('change', async (e) => {
    const sel = e.target;
    if (sel.value === 'admin') {
      sel.disabled = true;
      const ok = await authenticateAdmin();
      sel.disabled = false;
      setRole(ok ? 'admin' : 'staff');
    } else {
      setRole('staff');
    }
  });
  document.addEventListener('pointerdown', () => { if (isAdmin()) resetIdleTimer(); }, true);
  document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', () => switchTab(btn.dataset.tab)); });
  document.getElementById('resetAllBtn')?.addEventListener('click', resetAllData);
  document.getElementById('manageTablesBtn')?.addEventListener('click', manageTables);
  document.getElementById('manageItemsBtn')?.addEventListener('click', () => { if (requireAdmin()) document.getElementById('itemsModal').style.display = 'block'; });
  document.getElementById('managePricesBtn')?.addEventListener('click', showPriceManagement);
  document.getElementById('checkoutBtn')?.addEventListener('click', checkout);
  document.getElementById('clearCartBtn')?.addEventListener('click', () => { carts[currentTable] = []; renderCart(); saveData(); });
  document.getElementById('addTableBtn')?.addEventListener('click', addNewTable);
  document.getElementById('saveTablesBtn')?.addEventListener('click', saveTables);
  document.getElementById('addIngredientBtn')?.addEventListener('click', addIngredient);
  document.getElementById('dailyReportBtn')?.addEventListener('click', dailyReport);
  document.getElementById('weeklyReportBtn')?.addEventListener('click', weeklyReport);
  document.getElementById('monthlyReportBtn')?.addEventListener('click', monthlyReport);
  document.getElementById('profitTrendBtn')?.addEventListener('click', showProfitTrend);
  document.getElementById('closeDayBtn')?.addEventListener('click', closeDay);
  document.getElementById('resetDayBtn')?.addEventListener('click', resetDay);
  document.getElementById('stockSearch')?.addEventListener('input', () => renderStockList());
  document.getElementById('printReceiptBtn')?.addEventListener('click', printReceipt);
  document.getElementById('pdfReceiptBtn')?.addEventListener('click', downloadPDF);
  document.getElementById('whatsappReceiptBtn')?.addEventListener('click', sendWhatsApp);
  document.getElementById('confirmCustomerBtn')?.addEventListener('click', () => { const customerName = document.getElementById('customerName').value.trim(); if (customerName) generateReceipt(customerName); else alert('Please enter customer name'); });
  document.getElementById('itemForm')?.addEventListener('submit', saveItemForm);
  document.getElementById('addNewItemBtn')?.addEventListener('click', openAddItemModal);
  document.getElementById('addIngredientFieldBtn')?.addEventListener('click', () => {
    const container = document.getElementById('ingredientsList');
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `<select class="ingredient-name">${ingredientOptions(null)}</select><input type="number" class="ingredient-amount" placeholder="Amount" step="1"><button type="button" class="remove-ingredient">✖️</button>`;
    container.appendChild(div);
    div.querySelector('.remove-ingredient').onclick = () => div.remove();
  });
  document.querySelectorAll('.close, .close-tables, .close-items, .close-item-form').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('tablesModal').style.display = 'none';
      document.getElementById('itemsModal').style.display = 'none';
      document.getElementById('itemFormModal').style.display = 'none';
      document.getElementById('receiptModal').style.display = 'none';
      document.getElementById('customerModal').style.display = 'none';
    };
  });
});
