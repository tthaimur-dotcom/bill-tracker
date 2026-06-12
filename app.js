// ====================== BILL TRACKER PRO v3.0 ======================
// Advanced Supplier Bill Tracker - Mobile First PWA
// Features: Ledger, Verification, Discrepancy Log, Analytics, Edit Bills

// ===== SERVICE WORKER REGISTRATION =====
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ===== DATA LAYER =====
const DB_KEY = 'billTrackerPro';
const THEME_KEY = 'billTrackerTheme';
const SYNC_URL_KEY = 'billTrackerSyncUrl';
const PENDING_SYNC_KEY = 'billTrackerPendingSync';

function loadData() {
    try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { suppliers: [], bills: [], payments: [], discrepancies: [] };
}

function saveData() {
    localStorage.setItem(DB_KEY, JSON.stringify(appData));
}

function getSyncUrl() {
    return localStorage.getItem(SYNC_URL_KEY) || '';
}

function setSyncUrl(url) {
    localStorage.setItem(SYNC_URL_KEY, url);
}

// Pending sync queue (for when offline)
function getPendingSync() {
    try {
        const raw = localStorage.getItem(PENDING_SYNC_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function addPendingSync(item) {
    const queue = getPendingSync();
    queue.push(item);
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
}

function clearPendingSync() {
    localStorage.removeItem(PENDING_SYNC_KEY);
}

// === GOOGLE SHEETS SYNC ===
async function syncToSheet(action, data) {
    const url = getSyncUrl();
    if (!url) return; // No sync URL configured

    const payload = { action, ...data };

    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        if (resp.ok) {
            toast('✓ Synced to Sheet');
        } else {
            throw new Error('Sync failed');
        }
    } catch (e) {
        // Offline or error — queue it
        addPendingSync(payload);
        toast('Saved offline — will sync later');
    }
}

// Try to flush pending sync queue
async function flushPendingSync() {
    const url = getSyncUrl();
    if (!url) return;

    const queue = getPendingSync();
    if (queue.length === 0) return;

    let success = 0;
    const failed = [];

    for (const payload of queue) {
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            if (resp.ok) success++;
            else failed.push(payload);
        } catch (e) {
            failed.push(payload);
            break; // Still offline, stop trying
        }
    }

    if (failed.length > 0) {
        localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(failed));
    } else {
        clearPendingSync();
    }

    if (success > 0) toast(`✓ Synced ${success} pending entries`);
}

// Auto-flush when online
window.addEventListener('online', () => flushPendingSync());
// Try flush on app load
setTimeout(() => flushPendingSync(), 3000);

let appData = loadData();
// Ensure discrepancies array exists for upgrades
if (!appData.discrepancies) appData.discrepancies = [];

// ===== THEME =====
function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem(THEME_KEY, isDark ? 'light' : 'dark');
}

initTheme();

// ===== UTILITIES =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 8); }
function fmt(n) { return '₹' + parseFloat(n || 0).toFixed(2); }
function fmtShort(n) {
    const num = parseFloat(n || 0);
    if (num >= 100000) return '₹' + (num / 100000).toFixed(1) + 'L';
    if (num >= 1000) return '₹' + (num / 1000).toFixed(1) + 'K';
    return '₹' + num.toFixed(0);
}
function fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateShort(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getBalance(supplierId) {
    const bills = appData.bills.filter(b => b.supplierId === supplierId);
    const payments = appData.payments.filter(p => p.supplierId === supplierId);
    return bills.reduce((s, b) => s + (b.calculatedTotal || 0), 0) -
           payments.reduce((s, p) => s + (p.amount || 0), 0);
}

function getRunningLedger(supplierId) {
    const bills = appData.bills.filter(b => b.supplierId === supplierId);
    const payments = appData.payments.filter(p => p.supplierId === supplierId);
    const all = [
        ...bills.map(b => ({ type: 'bill', date: b.date, amount: b.calculatedTotal, label: `Bill${b.billNumber ? ' #' + b.billNumber : ''} (${b.items.length} items)`, id: b.id, hasMismatch: b.hasMismatch })),
        ...payments.map(p => ({ type: 'payment', date: p.date, amount: p.amount, label: `Payment${p.note ? ' · ' + p.note : ''}`, id: p.id }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = 0;
    all.forEach(entry => {
        if (entry.type === 'bill') running += entry.amount;
        else running -= entry.amount;
        entry.balance = running;
    });
    return all;
}

function getTotalDue() {
    return appData.suppliers.reduce((s, sup) => s + Math.max(0, getBalance(sup.id)), 0);
}

function getThisMonthTotal() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return appData.bills
        .filter(b => new Date(b.date) >= start)
        .reduce((s, b) => s + (b.calculatedTotal || 0), 0);
}

function getItemSuggestions(supplierId) {
    const bills = appData.bills.filter(b => b.supplierId === supplierId);
    const itemMap = {};
    bills.forEach(bill => {
        bill.items.forEach(item => {
            if (item.name) {
                const key = item.name.toLowerCase().trim();
                if (!itemMap[key]) {
                    itemMap[key] = { name: item.name, rate: item.rate, unit: item.unit, count: 0, prevRate: 0 };
                }
                itemMap[key].prevRate = itemMap[key].rate;
                itemMap[key].rate = item.rate;
                itemMap[key].count++;
            }
        });
    });
    return Object.values(itemMap).sort((a, b) => b.count - a.count).slice(0, 15);
}

// Get last known rate for an item from a supplier
function getLastRate(supplierId, itemName) {
    if (!supplierId || !itemName) return null;
    const key = itemName.toLowerCase().trim();
    const bills = appData.bills
        .filter(b => b.supplierId === supplierId)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const bill of bills) {
        for (const item of bill.items) {
            if (item.name && item.name.toLowerCase().trim() === key) {
                return item.rate;
            }
        }
    }
    return null;
}

function toast(msg) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// ===== ROUTING =====
let currentScreen = 'dashboard';
let screenParams = {};

function navigate(screen, params = {}) {
    currentScreen = screen;
    screenParams = params;
    render();
    window.scrollTo(0, 0);
}

// ===== RENDER ENGINE =====
function render() {
    const app = document.getElementById('app');
    let html = '';

    switch (currentScreen) {
        case 'dashboard': html = renderDashboard(); break;
        case 'suppliers': html = renderSuppliers(); break;
        case 'add-supplier': html = renderAddSupplier(); break;
        case 'supplier-detail': html = renderSupplierDetail(); break;
        case 'add-bill': html = renderAddBill(); break;
        case 'bill-detail': html = renderBillDetail(); break;
        case 'history': html = renderHistory(); break;
        case 'settings': html = renderSettings(); break;
        case 'discrepancies': html = renderDiscrepancies(); break;
        case 'analytics': html = renderAnalytics(); break;
        case 'supplier-statement': html = renderSupplierStatement(); break;
    }

    html += renderBottomNav();
    app.innerHTML = html;
    attachEventListeners();
}

// ===== BOTTOM NAV =====
function renderBottomNav() {
    const items = [
        { id: 'dashboard', icon: '🏠', label: 'Home' },
        { id: 'suppliers', icon: '👥', label: 'Suppliers' },
        { id: 'add-bill', icon: '➕', label: 'Add Bill' },
        { id: 'analytics', icon: '📊', label: 'Analytics' },
        { id: 'settings', icon: '⚙️', label: 'More' }
    ];
    return `<nav class="bottom-nav">${items.map(i => `
        <button class="nav-item ${currentScreen === i.id ? 'active' : ''}" data-nav="${i.id}">
            <span class="nav-icon">${i.icon}</span>
            <span>${i.label}</span>
        </button>
    `).join('')}</nav>`;
}

// ===== DASHBOARD =====
function renderDashboard() {
    const totalDue = getTotalDue();
    const monthTotal = getThisMonthTotal();
    const billCount = appData.bills.length;
    const discCount = appData.discrepancies.length;

    const recentBills = [...appData.bills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

    return `
        <div class="screen-header">
            <h1>Bill Tracker</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="toggle-theme">🌙</button>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card highlight">
                <div class="stat-value">${fmtShort(totalDue)}</div>
                <div class="stat-label">Total Due</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${fmtShort(monthTotal)}</div>
                <div class="stat-label">This Month</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${billCount}</div>
                <div class="stat-label">Total Bills</div>
            </div>
            <div class="stat-card ${discCount > 0 ? 'warn' : ''}">
                <div class="stat-value">${discCount}</div>
                <div class="stat-label">Discrepancies</div>
            </div>
        </div>

        ${discCount > 0 ? `
            <div class="alert-banner" data-action="go-discrepancies">
                ⚠️ ${discCount} bill${discCount > 1 ? 's' : ''} with mismatch — tap to review
            </div>
        ` : ''}

        ${recentBills.length > 0 ? `
            <div class="section-title">Recent Bills</div>
            ${recentBills.map(bill => {
                const sup = appData.suppliers.find(s => s.id === bill.supplierId);
                return `<div class="card" data-action="view-bill" data-id="${bill.id}">
                    <div class="bill-card">
                        <div class="bill-icon ${bill.hasMismatch ? 'mismatch' : ''}">
                            ${bill.hasMismatch ? '⚠️' : '📄'}
                        </div>
                        <div class="bill-info">
                            <h4>${sup ? sup.name : 'Unknown'}</h4>
                            <p>${fmtDateShort(bill.date)} · ${bill.items.length} items</p>
                        </div>
                        <div class="bill-amount">${fmt(bill.calculatedTotal)}</div>
                    </div>
                </div>`;
            }).join('')}
        ` : `
            <div class="empty-state">
                <div class="icon">📋</div>
                <p>No bills yet. Add a supplier and start tracking!</p>
            </div>
        `}
    `;
}

// ===== SUPPLIERS LIST =====
function renderSuppliers() {
    const sorted = [...appData.suppliers].sort((a, b) => getBalance(b.id) - getBalance(a.id));

    return `
        <div class="screen-header">
            <h1>Suppliers</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="add-supplier">➕</button>
            </div>
        </div>

        ${sorted.length === 0 ? `
            <div class="empty-state">
                <div class="icon">🏪</div>
                <p>No suppliers yet.<br>Tap + to add your first supplier.</p>
            </div>
        ` : sorted.map(sup => {
            const balance = getBalance(sup.id);
            const billCount = appData.bills.filter(b => b.supplierId === sup.id).length;
            return `<div class="card" data-action="view-supplier" data-id="${sup.id}">
                <div class="supplier-item">
                    <div class="supplier-avatar">${sup.name.charAt(0).toUpperCase()}</div>
                    <div class="supplier-details">
                        <h3>${sup.name}</h3>
                        <p>${billCount} bill${billCount !== 1 ? 's' : ''} ${sup.phone ? '· ' + sup.phone : ''}</p>
                    </div>
                    <div class="supplier-amount">
                        <div class="amount">${fmt(balance)}</div>
                        <div class="label">${balance > 0 ? 'due' : balance < 0 ? 'overpaid' : 'clear'}</div>
                    </div>
                </div>
            </div>`;
        }).join('')}
    `;
}

// ===== ADD SUPPLIER =====
function renderAddSupplier() {
    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>${screenParams.editId ? 'Edit Supplier' : 'Add Supplier'}</h1>
            <div></div>
        </div>

        <div class="form-group">
            <label>Supplier Name *</label>
            <input class="form-input" id="inp-name" placeholder="e.g., MANISH" value="${screenParams.editName || ''}" autofocus />
        </div>
        <div class="form-group">
            <label>Phone</label>
            <input class="form-input" id="inp-phone" type="tel" placeholder="Mobile number" value="${screenParams.editPhone || ''}" />
        </div>
        <div class="form-group">
            <label>Address</label>
            <input class="form-input" id="inp-address" placeholder="Shop address" value="${screenParams.editAddress || ''}" />
        </div>
        <div class="form-group">
            <label>Category</label>
            <input class="form-input" id="inp-category" placeholder="e.g., Electronics, Spares" value="${screenParams.editCategory || ''}" />
        </div>
        <div class="form-group">
            <label>Credit Limit</label>
            <input class="form-input" id="inp-credit-limit" type="number" placeholder="0 = no limit" step="1000" value="${screenParams.editCreditLimit || ''}" />
        </div>
        <div class="form-group">
            <label>Opening Balance (amount already due)</label>
            <input class="form-input" id="inp-opening" type="number" placeholder="0" step="0.01" value="${screenParams.editOpening || ''}" />
        </div>

        <div class="btn-row">
            <button class="btn btn-primary" data-action="save-supplier">💾 Save Supplier</button>
        </div>
    `;
}

// ===== SUPPLIER DETAIL with Running Balance =====
function renderSupplierDetail() {
    const sup = appData.suppliers.find(s => s.id === screenParams.id);
    if (!sup) return '<p>Supplier not found</p>';

    const balance = getBalance(sup.id);
    const ledger = getRunningLedger(sup.id);
    const bills = appData.bills.filter(b => b.supplierId === sup.id);
    const creditLimit = sup.creditLimit || 0;
    const overLimit = creditLimit > 0 && balance > creditLimit;

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>${sup.name}</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="edit-supplier" data-id="${sup.id}">✏️</button>
                <button class="icon-btn" data-action="delete-supplier" data-id="${sup.id}">🗑️</button>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card highlight">
                <div class="stat-value">${fmt(balance)}</div>
                <div class="stat-label">Balance Due</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${bills.length}</div>
                <div class="stat-label">Bills</div>
            </div>
        </div>

        ${overLimit ? `<div class="alert-banner warn">⚠️ Credit limit exceeded! Limit: ${fmt(creditLimit)}</div>` : ''}

        <div class="btn-row">
            <button class="btn btn-primary btn-sm" data-action="add-bill-for" data-id="${sup.id}">➕ Bill</button>
            <button class="btn btn-success btn-sm" data-action="add-payment" data-id="${sup.id}">💰 Pay</button>
            <button class="btn btn-ghost btn-sm" data-action="view-statement" data-id="${sup.id}">📤 Statement</button>
        </div>

        <div class="section-title">Ledger (Running Balance)</div>
        ${ledger.length === 0 ? '<div class="empty-state"><p>No transactions yet</p></div>' :
            `<div class="card" style="padding:8px 12px;">
                ${ledger.reverse().map(entry => `
                    <div class="ledger-entry" ${entry.type === 'bill' ? `data-action="view-bill" data-id="${entry.id}"` : ''}>
                        <div class="ledger-dot ${entry.type}"></div>
                        <div class="ledger-info">
                            <div>${entry.label}${entry.hasMismatch ? ' ⚠️' : ''}</div>
                            <div class="date">${fmtDate(entry.date)}</div>
                        </div>
                        <div class="ledger-right">
                            <div class="ledger-amount ${entry.type === 'bill' ? 'debit' : 'credit'}">
                                ${entry.type === 'bill' ? '+' : '-'}${fmt(entry.amount)}
                            </div>
                            <div class="ledger-balance">Bal: ${fmt(entry.balance)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`
        }
    `;
}

// ===== ADD BILL with Live Tracker =====
let billState = {
    supplierId: '',
    items: [{ name: '', qty: '', unit: 'pcs', rate: '', total: '' }],
    photo: null,
    date: new Date().toISOString().split('T')[0],
    billNumber: '',
    writtenTotal: '',
    editingBillId: null
};

function resetBillState() {
    billState = {
        supplierId: screenParams.supplierId || '',
        items: [{ name: '', qty: '', unit: 'pcs', rate: '', total: '' }],
        photo: null,
        date: new Date().toISOString().split('T')[0],
        billNumber: '',
        writtenTotal: '',
        editingBillId: null
    };
}

function renderAddBill() {
    if (!billState.supplierId && screenParams.supplierId) {
        billState.supplierId = screenParams.supplierId;
    }

    const calcTotal = billState.items.reduce((s, i) => s + calcItemTotal(i), 0);
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;

    // Live tracker logic
    let trackerHtml = '';
    if (writtenTotal > 0 && calcTotal > 0) {
        const diff = calcTotal - writtenTotal;
        if (Math.abs(diff) < 0.5) {
            trackerHtml = `<div class="live-tracker match">✓ MATCH — Verified!</div>`;
        } else if (diff > 0) {
            trackerHtml = `<div class="live-tracker exceeded">⚠ EXCEEDED BY ${fmt(diff)}</div>`;
        } else {
            trackerHtml = `<div class="live-tracker short">⏳ SHORT BY ${fmt(Math.abs(diff))}</div>`;
        }
    } else if (writtenTotal > 0 && calcTotal === 0) {
        trackerHtml = `<div class="live-tracker short">⏳ REMAINING: ${fmt(writtenTotal)} — add items</div>`;
    } else if (calcTotal > 0 && writtenTotal === 0) {
        trackerHtml = `<div class="live-tracker neutral">Enter dealer's written total to verify</div>`;
    }

    const suggestions = billState.supplierId ? getItemSuggestions(billState.supplierId) : [];

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>${billState.editingBillId ? 'Edit Bill' : 'Add Bill'}</h1>
            <div></div>
        </div>

        <div class="form-group">
            <label>Supplier *</label>
            <select class="form-select" id="bill-supplier">
                <option value="">-- Select Supplier --</option>
                ${appData.suppliers.map(s => `<option value="${s.id}" ${billState.supplierId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
        </div>

        <div class="form-group" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
                <label>Date</label>
                <input class="form-input" type="date" id="bill-date" value="${billState.date}" />
            </div>
            <div>
                <label>Bill No.</label>
                <input class="form-input" id="bill-number" value="${billState.billNumber}" placeholder="Optional" />
            </div>
        </div>

        <!-- Live Tracker -->
        ${trackerHtml}

        <!-- Written Total -->
        <div class="form-group">
            <label>Dealer's Written Total</label>
            <input class="form-input" type="number" id="written-total" value="${billState.writtenTotal}" placeholder="₹ total on the slip" step="0.01" />
        </div>

        <!-- Photo Section -->
        <div class="photo-section">
            <div class="photo-btns">
                <button class="btn btn-outline btn-sm" data-action="take-photo">📷 Camera</button>
                <button class="btn btn-outline btn-sm" data-action="upload-photo">📁 Gallery</button>
            </div>
            ${billState.photo ? `<img class="photo-preview-img" src="${billState.photo}" alt="Bill" />` : ''}
            <input type="file" id="file-camera" accept="image/*" capture="environment" class="hidden" />
            <input type="file" id="file-upload" accept="image/*" class="hidden" />
        </div>

        <!-- Suggestions -->
        ${suggestions.length > 0 ? `
            <div class="section-title">Quick Add</div>
            <div class="suggestions-bar">
                ${suggestions.map(s => `<button class="suggestion-chip" data-action="add-suggestion" data-name="${s.name}" data-rate="${s.rate}" data-unit="${s.unit || 'pcs'}">${s.name} (₹${s.rate})</button>`).join('')}
            </div>
        ` : ''}

        <!-- Fast Items Entry -->
        <div class="section-title">Items — qty & rate or just total ↓</div>
        <div class="fast-entry-table" id="fast-entry">
            <div class="fast-entry-header">
                <span class="fe-name">Item (optional)</span>
                <span class="fe-qty">Qty</span>
                <span class="fe-rate">Rate</span>
                <span class="fe-total">Total</span>
            </div>
            ${billState.items.map((item, idx) => {
                const lastRate = getLastRate(billState.supplierId, item.name);
                const currentRate = parseFloat(item.rate) || 0;
                const rateChanged = lastRate !== null && currentRate > 0 && currentRate !== lastRate;
                const itemTotal = calcItemTotal(item);
                return `
                <div class="fast-entry-row" data-idx="${idx}">
                    <input class="fe-input fe-name item-input" placeholder="—" value="${item.name}" data-field="name" data-idx="${idx}" autocomplete="off" />
                    <input class="fe-input fe-qty item-input" placeholder="0" type="number" inputmode="decimal" value="${item.qty}" data-field="qty" data-idx="${idx}" step="any" />
                    <input class="fe-input fe-rate item-input ${rateChanged ? 'rate-changed' : ''}" placeholder="—" type="number" inputmode="decimal" value="${item.rate}" data-field="rate" data-idx="${idx}" step="0.01" />
                    <input class="fe-input fe-total-input item-input" placeholder="${itemTotal > 0 ? itemTotal.toFixed(0) : '₹'}" type="number" inputmode="decimal" value="${item.total || ''}" data-field="total" data-idx="${idx}" step="0.01" ${(parseFloat(item.qty) && parseFloat(item.rate)) ? 'disabled' : ''} />
                    ${billState.items.length > 1 ? `<button class="fe-remove" data-action="remove-item" data-idx="${idx}">×</button>` : ''}
                </div>
                ${rateChanged ? `<div class="fe-rate-alert">↑ Was ₹${lastRate} (${((currentRate - lastRate) / lastRate * 100).toFixed(0)}%)</div>` : ''}`;
            }).join('')}
        </div>
        <div class="px-16 mb-16" style="display:flex; gap:8px;">
            <button class="btn btn-ghost btn-sm" data-action="add-item" style="flex:1">+ Add Row</button>
            <button class="btn btn-ghost btn-sm" data-action="add-5-items" style="flex:1">+5 Rows</button>
        </div>

        <!-- Totals -->
        <div class="totals-section">
            <div class="total-row">
                <span class="label">Calculated Total</span>
                <span class="value success" id="calc-total-display">${fmt(calcTotal)}</span>
            </div>
            ${writtenTotal > 0 ? `
            <div class="total-row">
                <span class="label">Written Total</span>
                <span class="value">${fmt(writtenTotal)}</span>
            </div>
            ` : ''}
        </div>

        <div class="btn-row mt-16" style="margin-bottom:20px;">
            <button class="btn btn-primary" data-action="save-bill">💾 ${billState.editingBillId ? 'Update Bill' : 'Save Bill'}</button>
        </div>
    `;
}

function calcItemTotal(item) {
    const qty = parseFloat(item.qty) || 0;
    const rate = parseFloat(item.rate) || 0;
    const manualTotal = parseFloat(item.total) || 0;
    if (qty && rate) return qty * rate;
    if (manualTotal) return manualTotal;
    return 0;
}

// ===== BILL DETAIL =====
function renderBillDetail() {
    const bill = appData.bills.find(b => b.id === screenParams.id);
    if (!bill) return '<p>Bill not found</p>';

    const sup = appData.suppliers.find(s => s.id === bill.supplierId);
    const balance = getBalance(bill.supplierId);
    const diff = bill.hasMismatch ? bill.calculatedTotal - bill.writtenTotal : 0;

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>Bill Detail</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="edit-bill" data-id="${bill.id}">✏️</button>
                <button class="icon-btn" data-action="delete-bill" data-id="${bill.id}">🗑️</button>
            </div>
        </div>

        <!-- Shareable Preview Card -->
        <div class="share-preview-card" id="share-card">
            ${bill.photo ? `<div class="share-photo"><img src="${bill.photo}" alt="Bill" /></div>` : ''}

            <div class="share-body">
                <div class="share-header-info">
                    <strong>${sup ? sup.name : 'Unknown'}</strong>
                    <span>${fmtDate(bill.date)}${bill.billNumber ? ' · #' + bill.billNumber : ''}</span>
                </div>

                <div class="share-items">
                    ${bill.items.map((item, i) => `
                        <div class="share-item-row">
                            <span class="share-item-name">${item.name || 'Item ' + (i + 1)}</span>
                            <span class="share-item-detail">${item.qty}${item.unit && item.unit !== 'pcs' ? ' ' + item.unit : ''} ${item.rate ? '× ₹' + item.rate : ''}</span>
                            <span class="share-item-total">₹${item.calculatedTotal.toFixed(0)}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="share-total-section">
                    <div class="share-total-row main">
                        <span>Our Total</span>
                        <span>₹${bill.calculatedTotal.toFixed(2)}</span>
                    </div>
                    ${bill.hasMismatch ? `
                        <div class="share-total-row written">
                            <span>Dealer's Total</span>
                            <span>₹${bill.writtenTotal.toFixed(2)}</span>
                        </div>
                        <div class="share-total-row diff">
                            <span>${diff > 0 ? '⚠ Excess' : '⚠ Short'}</span>
                            <span>₹${Math.abs(diff).toFixed(2)}</span>
                        </div>
                    ` : `
                        <div class="share-total-row verified">
                            <span>✓ Verified — totals match</span>
                        </div>
                    `}
                </div>
            </div>
        </div>

        <div class="share-balance-strip">
            Running Balance: <strong>${fmt(balance)}</strong>
        </div>

        <div class="btn-row mt-16">
            <button class="btn btn-primary btn-sm" data-action="share-card-image" data-id="${bill.id}">📸 Share as Image</button>
        </div>
        <div class="btn-row">
            <button class="btn btn-outline btn-sm" data-action="share-bill-whatsapp" data-id="${bill.id}">💬 WhatsApp Text</button>
            <button class="btn btn-outline btn-sm" data-action="share-bill-text" data-id="${bill.id}">📋 Copy</button>
        </div>
    `;
}

// ===== HISTORY =====
function renderHistory() {
    const bills = [...appData.bills].sort((a, b) => new Date(b.date) - new Date(a.date));

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>History</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="export-csv">📊</button>
            </div>
        </div>

        <div class="search-bar">
            <input id="search-bills" placeholder="Search bills..." />
        </div>

        <div class="form-group">
            <select class="form-select" id="filter-supplier">
                <option value="all">All Suppliers</option>
                ${appData.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
        </div>

        <div id="history-container">
            ${renderHistoryList(bills)}
        </div>
    `;
}

function renderHistoryList(bills) {
    if (bills.length === 0) {
        return '<div class="empty-state"><div class="icon">📄</div><p>No bills found</p></div>';
    }

    const grouped = {};
    bills.forEach(bill => {
        const key = new Date(bill.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(bill);
    });

    let html = '';
    for (const [month, monthBills] of Object.entries(grouped)) {
        const monthTotal = monthBills.reduce((s, b) => s + b.calculatedTotal, 0);
        html += `<div class="section-title">${month} · ${fmt(monthTotal)}</div>`;
        monthBills.forEach(bill => {
            const sup = appData.suppliers.find(s => s.id === bill.supplierId);
            html += `<div class="card" data-action="view-bill" data-id="${bill.id}">
                <div class="bill-card">
                    <div class="bill-icon ${bill.hasMismatch ? 'mismatch' : ''}">
                        ${bill.hasMismatch ? '⚠️' : '📄'}
                    </div>
                    <div class="bill-info">
                        <h4>${sup ? sup.name : 'Unknown'}</h4>
                        <p>${fmtDateShort(bill.date)} · ${bill.items.length} items${bill.billNumber ? ' · #' + bill.billNumber : ''}</p>
                    </div>
                    <div class="bill-amount">${fmt(bill.calculatedTotal)}</div>
                </div>
            </div>`;
        });
    }
    return html;
}

// ===== DISCREPANCY LOG =====
function renderDiscrepancies() {
    const discBills = appData.bills.filter(b => b.hasMismatch).sort((a, b) => new Date(b.date) - new Date(a.date));

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>Discrepancies</h1>
            <div class="header-actions">
                <span class="badge">${discBills.length}</span>
            </div>
        </div>

        ${discBills.length === 0 ? `
            <div class="empty-state">
                <div class="icon">✅</div>
                <p>No discrepancies! All bills verified correctly.</p>
            </div>
        ` : `
            <div class="section-title">Bills with Mismatch</div>
            ${discBills.map(bill => {
                const sup = appData.suppliers.find(s => s.id === bill.supplierId);
                const diff = bill.calculatedTotal - bill.writtenTotal;
                return `<div class="card" data-action="view-bill" data-id="${bill.id}">
                    <div class="bill-card">
                        <div class="bill-icon mismatch">⚠️</div>
                        <div class="bill-info">
                            <h4>${sup ? sup.name : 'Unknown'}</h4>
                            <p>${fmtDate(bill.date)}${bill.billNumber ? ' · #' + bill.billNumber : ''}</p>
                            <p class="fs-sm text-danger">${diff > 0 ? 'Exceeded' : 'Short'} by ${fmt(Math.abs(diff))}</p>
                        </div>
                        <div class="bill-amount">${fmt(bill.calculatedTotal)}</div>
                    </div>
                </div>`;
            }).join('')}
        `}
    `;
}

// ===== ANALYTICS =====
function renderAnalytics() {
    const suppliers = appData.suppliers;

    // Supplier performance
    const perfData = suppliers.map(sup => {
        const bills = appData.bills.filter(b => b.supplierId === sup.id);
        const totalBilled = bills.reduce((s, b) => s + b.calculatedTotal, 0);
        const discCount = bills.filter(b => b.hasMismatch).length;
        const accuracy = bills.length > 0 ? Math.round(((bills.length - discCount) / bills.length) * 100) : 100;
        const balance = getBalance(sup.id);
        const creditLimit = sup.creditLimit || 0;
        const overLimit = creditLimit > 0 && balance > creditLimit;

        // Ageing
        const lastBillDate = bills.length > 0 ? bills.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date : null;
        const daysOld = lastBillDate ? Math.floor((Date.now() - new Date(lastBillDate)) / 86400000) : 0;
        let ageingBucket = '—';
        if (balance > 0) {
            if (daysOld <= 30) ageingBucket = '0-30d';
            else if (daysOld <= 60) ageingBucket = '30-60d';
            else if (daysOld <= 90) ageingBucket = '60-90d';
            else ageingBucket = '90d+';
        } else {
            ageingBucket = 'Clear';
        }

        return { sup, bills: bills.length, totalBilled, discCount, accuracy, balance, creditLimit, overLimit, ageingBucket, daysOld };
    }).sort((a, b) => b.balance - a.balance);

    const totalOutstanding = perfData.reduce((s, p) => s + Math.max(0, p.balance), 0);
    const overLimitCount = perfData.filter(p => p.overLimit).length;

    return `
        <div class="screen-header">
            <h1>Analytics</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="go-discrepancies">⚠️</button>
                <button class="icon-btn" data-action="go-history">📋</button>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card highlight">
                <div class="stat-value">${fmtShort(totalOutstanding)}</div>
                <div class="stat-label">Outstanding</div>
            </div>
            <div class="stat-card ${overLimitCount > 0 ? 'warn' : ''}">
                <div class="stat-value">${overLimitCount}</div>
                <div class="stat-label">Over Limit</div>
            </div>
        </div>

        ${overLimitCount > 0 ? `<div class="alert-banner warn">⚠️ ${overLimitCount} supplier${overLimitCount > 1 ? 's' : ''} over credit limit</div>` : ''}

        <div class="section-title">Supplier Scorecard</div>
        ${perfData.length === 0 ? '<div class="empty-state"><p>Add suppliers to see analytics</p></div>' : ''}
        ${perfData.map(p => `
            <div class="card analytics-card" data-action="view-supplier" data-id="${p.sup.id}">
                <div class="analytics-row">
                    <div class="analytics-name">
                        <strong>${p.sup.name}</strong>
                        <span class="analytics-meta">${p.bills} bills · ${p.ageingBucket}</span>
                    </div>
                    <div class="analytics-stats">
                        <div class="analytics-balance ${p.overLimit ? 'over-limit' : ''}">${fmt(p.balance)}</div>
                        <div class="analytics-accuracy ${p.accuracy === 100 ? 'perfect' : p.accuracy >= 90 ? 'good' : 'poor'}">${p.accuracy}% ✓</div>
                    </div>
                </div>
                ${p.overLimit ? `<div class="rate-alert">⚠️ Over limit: ${fmt(p.balance)} / ${fmt(p.creditLimit)}</div>` : ''}
            </div>
        `).join('')}
    `;
}

// ===== SUPPLIER STATEMENT (WhatsApp-ready) =====
function renderSupplierStatement() {
    const sup = appData.suppliers.find(s => s.id === screenParams.id);
    if (!sup) return '<p>Supplier not found</p>';

    const ledger = getRunningLedger(sup.id);
    const balance = getBalance(sup.id);
    const totalBilled = appData.bills.filter(b => b.supplierId === sup.id).reduce((s, b) => s + b.calculatedTotal, 0);
    const totalPaid = appData.payments.filter(p => p.supplierId === sup.id).reduce((s, p) => s + p.amount, 0);

    return `
        <div class="screen-header">
            <button class="back-btn" data-action="back">←</button>
            <h1>Statement</h1>
            <div></div>
        </div>

        <div class="statement-header">
            <h2>${sup.name}</h2>
            <p>Account Statement · ${fmtDate(new Date().toISOString())}</p>
        </div>

        <div class="statement-summary">
            <div class="statement-row"><span>Total Billed</span><span>${fmt(totalBilled)}</span></div>
            <div class="statement-row"><span>Total Paid</span><span class="text-success">${fmt(totalPaid)}</span></div>
            <div class="statement-row grand"><span>Balance Due</span><span class="text-danger">${fmt(balance)}</span></div>
        </div>

        <div class="section-title">Transactions</div>
        <div class="statement-table">
            <div class="statement-table-head">
                <span>Date</span><span>Type</span><span>Amount</span><span>Balance</span>
            </div>
            ${ledger.map(entry => `
                <div class="statement-table-row ${entry.type}">
                    <span>${fmtDateShort(entry.date)}</span>
                    <span>${entry.type === 'bill' ? 'BILL' : 'PAID'}</span>
                    <span>${entry.type === 'bill' ? '+' : '-'}${fmt(entry.amount)}</span>
                    <span>${fmt(entry.balance)}</span>
                </div>
            `).join('')}
        </div>

        <div class="btn-row mt-16">
            <button class="btn btn-primary btn-sm" data-action="copy-statement" data-id="${sup.id}">📋 Copy Statement</button>
            <button class="btn btn-success btn-sm" data-action="whatsapp-statement" data-id="${sup.id}">💬 WhatsApp</button>
        </div>
    `;
}

// ===== SETTINGS =====
function renderSettings() {
    const syncUrl = getSyncUrl();
    const pendingCount = getPendingSync().length;

    return `
        <div class="screen-header">
            <h1>More</h1>
            <div></div>
        </div>

        <div class="section-title">Google Sheets Sync</div>
        <div class="card">
            <div class="form-group" style="padding:0; margin:0;">
                <label>Apps Script URL</label>
                <input class="form-input" id="sync-url-input" placeholder="Paste your Web App URL here" value="${syncUrl}" />
            </div>
            <div style="display:flex; gap:8px; margin-top:12px;">
                <button class="btn btn-primary btn-sm" data-action="save-sync-url" style="flex:1">💾 Save URL</button>
                <button class="btn btn-success btn-sm" data-action="sync-all-now" style="flex:1">🔄 Sync All</button>
            </div>
            ${pendingCount > 0 ? `<p class="fs-sm mt-16" style="color:var(--warning);">⏳ ${pendingCount} pending entries waiting to sync</p>` : ''}
            ${syncUrl ? `<p class="fs-sm mt-16" style="color:var(--success);">✓ Connected</p>` : `<p class="fs-sm mt-16" style="color:var(--text-secondary);">Not connected — bills save locally only</p>`}
        </div>

        <div class="section-title">App</div>

        <div class="card" data-action="go-history" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📋</div>
                <div class="supplier-details"><h3>Bill History</h3><p>View all bills</p></div>
            </div>
        </div>

        <div class="card" data-action="go-discrepancies" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">⚠️</div>
                <div class="supplier-details"><h3>Discrepancies</h3><p>Bills with mismatch</p></div>
            </div>
        </div>

        <div class="card" data-action="toggle-theme" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">🌙</div>
                <div class="supplier-details"><h3>Dark Mode</h3><p>Toggle theme</p></div>
            </div>
        </div>

        <div class="section-title">Data</div>

        <div class="card" data-action="export-data" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">💾</div>
                <div class="supplier-details"><h3>Backup Data</h3><p>Download JSON backup</p></div>
            </div>
        </div>

        <div class="card" data-action="import-data" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📂</div>
                <div class="supplier-details"><h3>Restore Data</h3><p>Import from backup</p></div>
            </div>
        </div>

        <div class="card" data-action="export-csv" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📊</div>
                <div class="supplier-details"><h3>Export CSV</h3><p>Download bills as spreadsheet</p></div>
            </div>
        </div>

        <div class="card" data-action="monthly-summary" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📅</div>
                <div class="supplier-details"><h3>Monthly Summary</h3><p>Month-wise breakdown</p></div>
            </div>
        </div>

        <input type="file" id="import-file" accept=".json" class="hidden" />

        <div class="px-16 mt-16 text-center">
            <p class="fs-sm" style="color:var(--text-secondary);">Bill Tracker Pro v3.0<br>Data stored locally + Google Sheets</p>
        </div>
    `;
}

// ===== EVENT LISTENERS =====
function attachEventListeners() {
    document.querySelectorAll('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.nav === 'add-bill') resetBillState();
            navigate(btn.dataset.nav);
        });
    });

    document.querySelectorAll('[data-action]').forEach(el => {
        el.addEventListener('click', () => handleAction(el.dataset.action, el.dataset));
    });

    document.querySelectorAll('.item-input').forEach(inp => {
        inp.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const field = e.target.dataset.field;
            billState.items[idx][field] = e.target.value;

            // If qty+rate entered, auto-fill total and disable it
            const row = e.target.closest('.fast-entry-row');
            if (row) {
                const qty = parseFloat(billState.items[idx].qty) || 0;
                const rate = parseFloat(billState.items[idx].rate) || 0;
                const totalInput = row.querySelector('.fe-total-input');
                if (qty && rate && totalInput) {
                    totalInput.placeholder = (qty * rate).toFixed(0);
                    totalInput.disabled = true;
                    billState.items[idx].total = '';
                } else if (totalInput) {
                    totalInput.disabled = false;
                    totalInput.placeholder = '₹';
                }
            }
            updateLiveTracker();
        });

        // Auto-advance: Enter key flow
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const idx = parseInt(e.target.dataset.idx);
                const field = e.target.dataset.field;
                const row = e.target.closest('.fast-entry-row');

                if (field === 'name') {
                    if (row) row.querySelector('.fe-qty')?.focus();
                } else if (field === 'qty') {
                    if (row) row.querySelector('.fe-rate')?.focus();
                } else if (field === 'rate') {
                    // If rate filled, go to next row. If empty, go to total field
                    const rate = parseFloat(e.target.value);
                    if (rate) {
                        goNextRow(idx);
                    } else {
                        const totalInput = row?.querySelector('.fe-total-input');
                        if (totalInput && !totalInput.disabled) totalInput.focus();
                        else goNextRow(idx);
                    }
                } else if (field === 'total') {
                    goNextRow(idx);
                }
            }
        });
    });

    function goNextRow(currentIdx) {
        const nextIdx = currentIdx + 1;
        if (nextIdx < billState.items.length) {
            const nextRow = document.querySelector(`.fast-entry-row[data-idx="${nextIdx}"] .fe-qty`);
            if (nextRow) nextRow.focus();
        } else {
            billState.items.push({ name: '', qty: '', unit: 'pcs', rate: '', total: '' });
            navigate('add-bill');
            setTimeout(() => {
                const rows = document.querySelectorAll('.fast-entry-row');
                const last = rows[rows.length - 1];
                if (last) last.querySelector('.fe-qty')?.focus();
            }, 100);
        }
    }

    const supSelect = document.getElementById('bill-supplier');
    if (supSelect) {
        supSelect.addEventListener('change', (e) => {
            billState.supplierId = e.target.value;
            navigate('add-bill');
        });
    }

    const dateInp = document.getElementById('bill-date');
    if (dateInp) dateInp.addEventListener('change', e => billState.date = e.target.value);
    const numInp = document.getElementById('bill-number');
    if (numInp) numInp.addEventListener('input', e => billState.billNumber = e.target.value);
    const wtInp = document.getElementById('written-total');
    if (wtInp) wtInp.addEventListener('input', e => {
        billState.writtenTotal = e.target.value;
        updateLiveTracker();
    });

    const fileCam = document.getElementById('file-camera');
    const fileUp = document.getElementById('file-upload');
    if (fileCam) fileCam.addEventListener('change', handlePhoto);
    if (fileUp) fileUp.addEventListener('change', handlePhoto);

    const searchInp = document.getElementById('search-bills');
    if (searchInp) searchInp.addEventListener('input', handleSearch);

    const filterSup = document.getElementById('filter-supplier');
    if (filterSup) filterSup.addEventListener('change', handleSearch);

    const importFile = document.getElementById('import-file');
    if (importFile) importFile.addEventListener('change', handleImport);
}

function updateLiveTracker() {
    const calcTotal = billState.items.reduce((s, i) => s + calcItemTotal(i), 0);
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;

    // Update total display
    const totalEl = document.getElementById('calc-total-display');
    if (totalEl) totalEl.textContent = fmt(calcTotal);

    // Update live tracker
    const existing = document.querySelector('.live-tracker');
    let html = '';
    if (writtenTotal > 0 && calcTotal > 0) {
        const diff = calcTotal - writtenTotal;
        if (Math.abs(diff) < 0.5) {
            html = `<div class="live-tracker match">✓ MATCH — Verified!</div>`;
        } else if (diff > 0) {
            html = `<div class="live-tracker exceeded">⚠ EXCEEDED BY ${fmt(diff)}</div>`;
        } else {
            html = `<div class="live-tracker short">⏳ SHORT BY ${fmt(Math.abs(diff))}</div>`;
        }
    } else if (writtenTotal > 0 && calcTotal === 0) {
        html = `<div class="live-tracker short">⏳ REMAINING: ${fmt(writtenTotal)} — add items</div>`;
    } else if (calcTotal > 0 && writtenTotal === 0) {
        html = `<div class="live-tracker neutral">Enter dealer's written total to verify</div>`;
    }

    if (existing) {
        if (html) {
            existing.outerHTML = html;
        } else {
            existing.remove();
        }
    } else if (html) {
        const wtGroup = document.getElementById('written-total')?.closest('.form-group');
        if (wtGroup) wtGroup.insertAdjacentHTML('beforebegin', html);
    }
}

// ===== ACTION HANDLERS =====
function handleAction(action, dataset) {
    switch (action) {
        case 'back':
            if (currentScreen === 'add-supplier') navigate('suppliers');
            else if (currentScreen === 'supplier-detail') navigate('suppliers');
            else if (currentScreen === 'supplier-statement') navigate('supplier-detail', { id: screenParams.id });
            else if (currentScreen === 'bill-detail') navigate(screenParams.from || 'dashboard');
            else if (currentScreen === 'add-bill') navigate('dashboard');
            else if (currentScreen === 'history') navigate('dashboard');
            else if (currentScreen === 'discrepancies') navigate('dashboard');
            else navigate('dashboard');
            break;

        case 'toggle-theme': toggleTheme(); render(); break;
        case 'add-supplier': navigate('add-supplier'); break;
        case 'save-supplier': saveSupplier(); break;
        case 'view-supplier': navigate('supplier-detail', { id: dataset.id }); break;

        case 'edit-supplier': {
            const sup = appData.suppliers.find(s => s.id === dataset.id);
            if (sup) navigate('add-supplier', { editId: sup.id, editName: sup.name, editPhone: sup.phone || '', editAddress: sup.address || '', editCategory: sup.category || '', editCreditLimit: sup.creditLimit || '', editOpening: '' });
            break;
        }

        case 'delete-supplier':
            if (confirm('Delete this supplier and all their bills?')) {
                appData.bills = appData.bills.filter(b => b.supplierId !== dataset.id);
                appData.payments = appData.payments.filter(p => p.supplierId !== dataset.id);
                appData.suppliers = appData.suppliers.filter(s => s.id !== dataset.id);
                saveData();
                toast('Supplier deleted');
                navigate('suppliers');
            }
            break;

        case 'add-bill-for':
            resetBillState();
            billState.supplierId = dataset.id;
            navigate('add-bill', { supplierId: dataset.id });
            break;

        case 'view-bill': navigate('bill-detail', { id: dataset.id }); break;

        case 'edit-bill': {
            const bill = appData.bills.find(b => b.id === dataset.id);
            if (bill) {
                billState = {
                    supplierId: bill.supplierId,
                    items: bill.items.map(i => ({ name: i.name, qty: String(i.qty), unit: i.unit || 'pcs', rate: String(i.rate), total: '' })),
                    photo: bill.photo,
                    date: bill.date,
                    billNumber: bill.billNumber || '',
                    writtenTotal: bill.writtenTotal ? String(bill.writtenTotal) : '',
                    editingBillId: bill.id
                };
                navigate('add-bill');
            }
            break;
        }

        case 'add-item':
            billState.items.push({ name: '', qty: '', unit: 'pcs', rate: '', total: '' });
            navigate('add-bill');
            setTimeout(() => {
                const rows = document.querySelectorAll('.fast-entry-row');
                const last = rows[rows.length - 1];
                if (last) last.querySelector('.fe-name')?.focus();
            }, 100);
            break;

        case 'add-5-items':
            for (let i = 0; i < 5; i++) billState.items.push({ name: '', qty: '', unit: 'pcs', rate: '', total: '' });
            navigate('add-bill');
            break;

        case 'remove-item':
            billState.items.splice(parseInt(dataset.idx), 1);
            navigate('add-bill');
            break;

        case 'add-suggestion':
            billState.items.push({ name: dataset.name, qty: '1', unit: dataset.unit || 'pcs', rate: dataset.rate || '', total: '' });
            navigate('add-bill');
            break;

        case 'save-bill': saveBill(); break;

        case 'delete-bill':
            if (confirm('Delete this bill?')) {
                appData.bills = appData.bills.filter(b => b.id !== dataset.id);
                saveData();
                toast('Bill deleted');
                navigate('dashboard');
            }
            break;

        case 'take-photo': document.getElementById('file-camera').click(); break;
        case 'upload-photo': document.getElementById('file-upload').click(); break;
        case 'add-payment': showPaymentModal(dataset.id); break;

        case 'share-bill-text': shareBillAsText(dataset.id); break;
        case 'share-bill-whatsapp': shareBillWhatsApp(dataset.id); break;
        case 'share-card-image': shareCardAsImage(dataset.id); break;

        case 'view-statement': navigate('supplier-statement', { id: dataset.id }); break;
        case 'copy-statement': copyStatement(dataset.id); break;
        case 'whatsapp-statement': whatsappStatement(dataset.id); break;

        case 'go-discrepancies': navigate('discrepancies'); break;
        case 'go-history': navigate('history'); break;

        case 'export-data': exportData(); break;
        case 'import-data': document.getElementById('import-file').click(); break;
        case 'export-csv': exportCSV(); break;
        case 'monthly-summary': showMonthlySummary(); break;

        case 'save-sync-url': {
            const url = document.getElementById('sync-url-input')?.value.trim();
            if (url) {
                setSyncUrl(url);
                toast('✓ Sync URL saved!');
                flushPendingSync();
            } else {
                setSyncUrl('');
                toast('Sync URL cleared');
            }
            render();
            break;
        }

        case 'sync-all-now': {
            if (!getSyncUrl()) { toast('Set sync URL first'); break; }
            toast('Syncing all data...');
            syncToSheet('syncAll', {
                suppliers: appData.suppliers,
                bills: appData.bills,
                payments: appData.payments
            });
            break;
        }
    }
}

// ===== SAVE SUPPLIER =====
function saveSupplier() {
    const name = document.getElementById('inp-name').value.trim();
    if (!name) { toast('Enter supplier name'); return; }

    const creditLimit = parseFloat(document.getElementById('inp-credit-limit').value) || 0;
    const opening = parseFloat(document.getElementById('inp-opening').value) || 0;

    if (screenParams.editId) {
        // Update existing
        const sup = appData.suppliers.find(s => s.id === screenParams.editId);
        if (sup) {
            sup.name = name;
            sup.phone = document.getElementById('inp-phone').value.trim();
            sup.address = document.getElementById('inp-address').value.trim();
            sup.category = document.getElementById('inp-category').value.trim();
            sup.creditLimit = creditLimit;
            saveData();
            toast('Supplier updated!');
            navigate('supplier-detail', { id: sup.id });
        }
        return;
    }

    const supplier = {
        id: uid(),
        name,
        phone: document.getElementById('inp-phone').value.trim(),
        address: document.getElementById('inp-address').value.trim(),
        category: document.getElementById('inp-category').value.trim(),
        creditLimit,
        createdAt: new Date().toISOString()
    };

    appData.suppliers.push(supplier);

    if (opening > 0) {
        appData.bills.push({
            id: uid(),
            supplierId: supplier.id,
            date: new Date().toISOString().split('T')[0],
            billNumber: 'Opening',
            items: [{ name: 'Opening Balance', qty: 1, unit: '', rate: opening, calculatedTotal: opening }],
            calculatedTotal: opening,
            writtenTotal: opening,
            hasMismatch: false,
            photo: null,
            createdAt: new Date().toISOString()
        });
    }

    saveData();
    toast('Supplier added!');
    navigate('suppliers');
}

// ===== SAVE BILL =====
function saveBill() {
    if (!billState.supplierId) { toast('Select a supplier'); return; }

    const validItems = billState.items.filter(i => {
        const qty = parseFloat(i.qty) || 0;
        const rate = parseFloat(i.rate) || 0;
        const total = parseFloat(i.total) || 0;
        // Valid if: has qty+rate, OR has just a total amount, OR has qty only (total-only slip)
        return (qty && rate) || total || qty;
    });
    if (validItems.length === 0 && !parseFloat(billState.writtenTotal)) { toast('Enter qty/rate or total'); return; }

    const calculatedTotal = validItems.length > 0
        ? validItems.reduce((s, i) => s + calcItemTotal(i), 0)
        : parseFloat(billState.writtenTotal) || 0;
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;
    const hasMismatch = validItems.length > 0 && writtenTotal > 0 && Math.abs(calculatedTotal - writtenTotal) > 0.5;

    if (billState.editingBillId) {
        // Update existing bill
        const idx = appData.bills.findIndex(b => b.id === billState.editingBillId);
        if (idx >= 0) {
            appData.bills[idx] = {
                ...appData.bills[idx],
                supplierId: billState.supplierId,
                date: billState.date,
                billNumber: billState.billNumber,
                items: validItems.map(i => ({ name: i.name.trim(), qty: parseFloat(i.qty) || 0, unit: i.unit || '', rate: parseFloat(i.rate) || 0, calculatedTotal: calcItemTotal(i) })),
                calculatedTotal,
                writtenTotal,
                hasMismatch,
                photo: billState.photo
            };
            saveData();
            toast('Bill updated!');
            navigate('bill-detail', { id: billState.editingBillId });
        }
    } else {
        // New bill
        const bill = {
            id: uid(),
            supplierId: billState.supplierId,
            date: billState.date,
            billNumber: billState.billNumber,
            items: validItems.map(i => ({ name: i.name.trim(), qty: parseFloat(i.qty) || 0, unit: i.unit || '', rate: parseFloat(i.rate) || 0, calculatedTotal: calcItemTotal(i) })),
            calculatedTotal,
            writtenTotal,
            hasMismatch,
            photo: billState.photo,
            createdAt: new Date().toISOString()
        };

        appData.bills.push(bill);

        // Log discrepancy
        if (hasMismatch) {
            appData.discrepancies.push({
                id: uid(),
                billId: bill.id,
                supplierId: bill.supplierId,
                date: bill.date,
                billRef: bill.billNumber,
                dealerTotal: writtenTotal,
                enteredTotal: calculatedTotal,
                difference: Math.abs(calculatedTotal - writtenTotal),
                status: calculatedTotal > writtenTotal ? 'EXCEEDED' : 'SHORT',
                createdAt: new Date().toISOString()
            });
        }

        saveData();
        resetBillState();
        toast('Bill saved!');

        // Sync to Google Sheets
        const supName = appData.suppliers.find(s => s.id === bill.supplierId)?.name || 'Unknown';
        syncToSheet('addBill', {
            supplier: supName,
            date: bill.date,
            billNumber: bill.billNumber,
            items: bill.items,
            calculatedTotal: bill.calculatedTotal,
            writtenTotal: bill.writtenTotal,
            hasMismatch: bill.hasMismatch
        });

        navigate('bill-detail', { id: bill.id });
    }
}

// ===== PHOTO =====
function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX = 1200;
            let w = img.width, h = img.height;
            if (w > MAX || h > MAX) {
                if (w > h) { h = h * MAX / w; w = MAX; }
                else { w = w * MAX / h; h = MAX; }
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            billState.photo = canvas.toDataURL('image/jpeg', 0.7);
            navigate('add-bill');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

// ===== PAYMENT =====
function showPaymentModal(supplierId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-handle"></div>
            <h3 style="margin-bottom:16px;">Record Payment</h3>
            <div class="form-group" style="padding:0;">
                <label>Amount</label>
                <input class="form-input" type="number" id="payment-amt" placeholder="Enter amount" step="0.01" autofocus />
            </div>
            <div class="form-group" style="padding:0;">
                <label>Date</label>
                <input class="form-input" type="date" id="payment-date" value="${new Date().toISOString().split('T')[0]}" />
            </div>
            <div class="form-group" style="padding:0;">
                <label>Mode</label>
                <select class="form-select" id="payment-mode">
                    <option value="Cash">Cash</option>
                    <option value="UPI">UPI</option>
                    <option value="NEFT">NEFT</option>
                    <option value="Cheque">Cheque</option>
                </select>
            </div>
            <div class="form-group" style="padding:0;">
                <label>Note</label>
                <input class="form-input" id="payment-note" placeholder="UTR or reference" />
            </div>
            <div style="display:flex; gap:10px; margin-top:16px;">
                <button class="btn btn-success" id="confirm-payment">💰 Save</button>
                <button class="btn btn-ghost" id="cancel-payment">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#cancel-payment').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#confirm-payment').addEventListener('click', () => {
        const amount = parseFloat(document.getElementById('payment-amt').value);
        if (!amount || amount <= 0) { toast('Enter valid amount'); return; }
        const mode = document.getElementById('payment-mode').value;
        const note = document.getElementById('payment-note').value.trim();

        appData.payments.push({
            id: uid(),
            supplierId,
            amount,
            date: document.getElementById('payment-date').value || new Date().toISOString().split('T')[0],
            note: mode + (note ? ' · ' + note : ''),
            createdAt: new Date().toISOString()
        });
        saveData();
        overlay.remove();
        toast('Payment recorded!');

        // Sync to Google Sheets
        const supName = appData.suppliers.find(s => s.id === supplierId)?.name || 'Unknown';
        syncToSheet('addPayment', {
            supplier: supName,
            date: document.getElementById('payment-date').value || new Date().toISOString().split('T')[0],
            amount,
            note: mode + (note ? ' · ' + note : '')
        });

        navigate('supplier-detail', { id: supplierId });
    });
}

// ===== SHARE — WhatsApp Aligned Table Format =====
function shareBillAsText(billId) {
    const bill = appData.bills.find(b => b.id === billId);
    if (!bill) return;
    const sup = appData.suppliers.find(s => s.id === bill.supplierId);
    const text = buildBillText(bill, sup);
    copyText(text);
}

function shareBillWhatsApp(billId) {
    const bill = appData.bills.find(b => b.id === billId);
    if (!bill) return;
    const sup = appData.suppliers.find(s => s.id === bill.supplierId);
    const text = buildBillText(bill, sup);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function buildBillText(bill, sup) {
    const NL = '\n';
    const line = '─'.repeat(36);
    let t = '';
    t += `BILL VERIFICATION${NL}`;
    t += `${line}${NL}`;
    t += `Supplier : ${sup ? sup.name : 'Unknown'}${NL}`;
    t += `Bill Ref : ${bill.billNumber || '—'}${NL}`;
    t += `Date     : ${fmtDate(bill.date)}${NL}`;
    t += `${line}${NL}`;
    t += ``;

    // Aligned table
    const maxName = 16;
    t += padR('Item', maxName) + padR('Qty', 6) + padR('Rate', 9) + 'Amount' + NL;
    t += '─'.repeat(42) + NL;
    bill.items.forEach(item => {
        const name = item.name.length > maxName ? item.name.substring(0, maxName - 1) + '…' : item.name;
        t += padR(name, maxName) + padL(String(item.qty), 5) + ' ' + padL(item.rate.toFixed(2), 8) + ' ' + padL(item.calculatedTotal.toFixed(2), 9) + NL;
    });
    t += '─'.repeat(42) + NL;
    t += padR('TOTAL', maxName + 6 + 9) + padL(bill.calculatedTotal.toFixed(2), 9) + NL;

    if (bill.hasMismatch) {
        t += NL;
        const diff = bill.calculatedTotal - bill.writtenTotal;
        t += `⚠️ MISMATCH${NL}`;
        t += `Your total  : Rs.${bill.writtenTotal.toFixed(2)}${NL}`;
        t += `Our total   : Rs.${bill.calculatedTotal.toFixed(2)}${NL}`;
        t += `Difference  : Rs.${Math.abs(diff).toFixed(2)} (${diff > 0 ? 'Excess' : 'Short'})${NL}`;
        t += `${NL}Please verify and confirm.${NL}`;
    } else {
        t += `${NL}✓ Total verified. Balance: ${fmt(getBalance(bill.supplierId))}${NL}`;
    }

    return t;
}

function padR(str, len) { return str + ' '.repeat(Math.max(0, len - str.length)); }
function padL(str, len) { return ' '.repeat(Math.max(0, len - str.length)) + str; }

// ===== SUPPLIER STATEMENT =====
function copyStatement(supplierId) {
    const text = buildStatementText(supplierId);
    copyText(text);
}

function whatsappStatement(supplierId) {
    const text = buildStatementText(supplierId);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function buildStatementText(supplierId) {
    const sup = appData.suppliers.find(s => s.id === supplierId);
    if (!sup) return '';
    const ledger = getRunningLedger(supplierId);
    const balance = getBalance(supplierId);
    const NL = '\n';
    const line = '─'.repeat(36);

    let t = `ACCOUNT STATEMENT${NL}`;
    t += `${line}${NL}`;
    t += `Supplier : ${sup.name}${NL}`;
    t += `Date     : ${fmtDate(new Date().toISOString())}${NL}`;
    t += `${line}${NL}${NL}`;

    t += padR('Date', 8) + padR('Type', 6) + padR('Amount', 12) + 'Balance' + NL;
    t += '─'.repeat(40) + NL;
    ledger.forEach(entry => {
        const d = fmtDateShort(entry.date);
        const type = entry.type === 'bill' ? 'BILL' : 'PAID';
        const amt = (entry.type === 'bill' ? '+' : '-') + entry.amount.toFixed(2);
        t += padR(d, 8) + padR(type, 6) + padR(amt, 12) + entry.balance.toFixed(2) + NL;
    });
    t += '─'.repeat(40) + NL;
    t += `${NL}BALANCE DUE: Rs.${balance.toFixed(2)}${NL}`;
    t += `${NL}Kindly verify and confirm.${NL}`;

    return t;
}

// ===== SHARE AS IMAGE (canvas) =====
function shareCardAsImage(billId) {
    const bill = appData.bills.find(b => b.id === billId);
    if (!bill) return;
    const sup = appData.suppliers.find(s => s.id === bill.supplierId);

    const scale = 2; // 2x resolution for crisp image
    const W = 700 * scale;
    const padding = 50 * scale;
    const lineH = 36 * scale;

    // Calculate height
    let totalH = padding;
    if (bill.photo) totalH += 350 * scale;
    totalH += 80 * scale; // header
    totalH += 20 * scale; // divider gap
    totalH += bill.items.length * lineH + 30 * scale; // items + gap
    totalH += 60 * scale; // total line
    if (bill.hasMismatch) totalH += 120 * scale;
    else totalH += 40 * scale;
    totalH += padding;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Crisp rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, totalH);

    let y = padding;

    if (bill.photo) {
        const img = new Image();
        img.onload = () => {
            // Draw photo with rounded corners and shadow effect
            const photoH = 320 * scale;
            const photoW = W - padding * 2;
            const ratio = Math.min(photoW / img.width, photoH / img.height);
            const drawW = img.width * ratio;
            const drawH = img.height * ratio;
            const px = (W - drawW) / 2;

            // Light border around photo
            ctx.strokeStyle = '#e5e7eb';
            ctx.lineWidth = 1 * scale;
            ctx.strokeRect(px - 1, y - 1, drawW + 2, drawH + 2);
            ctx.drawImage(img, px, y, drawW, drawH);

            y += drawH + 30 * scale;
            finishDrawing(ctx, canvas, W, padding, lineH, y, bill, sup, scale);
        };
        img.src = bill.photo;
    } else {
        finishDrawing(ctx, canvas, W, padding, lineH, y, bill, sup, scale);
    }
}

function finishDrawing(ctx, canvas, W, padding, lineH, y, bill, sup, scale) {
    const contentW = W - padding * 2;

    // === HEADER ===
    ctx.fillStyle = '#111827';
    ctx.font = `bold ${24 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText(sup ? sup.name.toUpperCase() : 'UNKNOWN', padding, y);
    y += 30 * scale;

    ctx.fillStyle = '#6b7280';
    ctx.font = `${14 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    let subText = fmtDate(bill.date);
    if (bill.billNumber) subText += `  ·  Bill #${bill.billNumber}`;
    ctx.fillText(subText, padding, y);
    y += 36 * scale;

    // === THIN DIVIDER ===
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(W - padding, y);
    ctx.stroke();
    y += 24 * scale;

    // === ITEMS (clean, no grid, just aligned text) ===
    bill.items.forEach((item, i) => {
        const name = item.name || `Item ${i + 1}`;

        // Item name — left
        ctx.fillStyle = '#111827';
        ctx.font = `500 ${15 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(name, padding, y);

        // Qty × Rate — middle
        let detail = '';
        if (item.qty && item.rate) detail = `${item.qty} × ₹${item.rate}`;
        else if (item.qty) detail = `Qty: ${item.qty}`;
        ctx.fillStyle = '#9ca3af';
        ctx.font = `${13 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const detailX = padding + contentW * 0.5;
        ctx.fillText(detail, detailX, y);

        // Total — right aligned
        ctx.fillStyle = '#111827';
        ctx.font = `600 ${15 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        const totalText = '₹' + item.calculatedTotal.toFixed(0);
        const totalWidth = ctx.measureText(totalText).width;
        ctx.fillText(totalText, W - padding - totalWidth, y);

        y += lineH;

        // Light row separator (except last)
        if (i < bill.items.length - 1) {
            ctx.strokeStyle = '#f3f4f6';
            ctx.lineWidth = 0.5 * scale;
            ctx.beginPath();
            ctx.moveTo(padding, y - lineH * 0.35);
            ctx.lineTo(W - padding, y - lineH * 0.35);
            ctx.stroke();
        }
    });

    y += 16 * scale;

    // === TOTAL DIVIDER (slightly thicker) ===
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(W - padding, y);
    ctx.stroke();
    y += 30 * scale;

    // === TOTAL ===
    ctx.fillStyle = '#059669';
    ctx.font = `bold ${20 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillText('TOTAL', padding, y);
    const totalVal = '₹' + bill.calculatedTotal.toFixed(2);
    const totalValW = ctx.measureText(totalVal).width;
    ctx.fillText(totalVal, W - padding - totalValW, y);
    y += 40 * scale;

    // === MISMATCH SECTION ===
    if (bill.hasMismatch) {
        const diff = bill.calculatedTotal - bill.writtenTotal;

        // Red alert box background
        const boxY = y - 8 * scale;
        const boxH = 90 * scale;
        ctx.fillStyle = '#fef2f2';
        roundRect(ctx, padding - 10 * scale, boxY, contentW + 20 * scale, boxH, 8 * scale);
        ctx.fill();

        // Alert text
        ctx.fillStyle = '#dc2626';
        ctx.font = `bold ${16 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(`⚠ ${diff > 0 ? 'EXCEEDED' : 'SHORT'} BY ₹${Math.abs(diff).toFixed(2)}`, padding + 6 * scale, y + 10 * scale);
        y += 36 * scale;

        ctx.fillStyle = '#6b7280';
        ctx.font = `${13 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(`Dealer's total: ₹${bill.writtenTotal.toFixed(2)}   |   Calculated: ₹${bill.calculatedTotal.toFixed(2)}`, padding + 6 * scale, y + 10 * scale);
        y += 28 * scale;

        ctx.fillStyle = '#374151';
        ctx.font = `italic ${12 * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText('Please verify and confirm the correct amount.', padding + 6 * scale, y + 10 * scale);
    }

    // === EXPORT ===
    canvas.toBlob((blob) => {
        if (navigator.share && navigator.canShare) {
            try {
                const file = new File([blob], `bill-${sup ? sup.name : 'supplier'}-${bill.date}.png`, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: 'Bill Verification' }).catch(() => downloadBlob(blob, sup, bill));
                    return;
                }
            } catch (e) {}
        }
        downloadBlob(blob, sup, bill);
    }, 'image/png', 1.0);
}

function downloadBlob(blob, sup, bill) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill-${sup ? sup.name : 'supplier'}-${bill.date}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Image saved!');
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function copyText(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!')).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied!');
}

// ===== SEARCH =====
function handleSearch() {
    const query = (document.getElementById('search-bills')?.value || '').toLowerCase();
    const filterSup = document.getElementById('filter-supplier')?.value || 'all';
    let bills = [...appData.bills];
    if (filterSup !== 'all') bills = bills.filter(b => b.supplierId === filterSup);
    if (query) {
        bills = bills.filter(b => {
            const sup = appData.suppliers.find(s => s.id === b.supplierId);
            const supName = sup ? sup.name.toLowerCase() : '';
            const itemNames = b.items.map(i => i.name.toLowerCase()).join(' ');
            return supName.includes(query) || itemNames.includes(query) || (b.billNumber || '').toLowerCase().includes(query);
        });
    }
    bills.sort((a, b) => new Date(b.date) - new Date(a.date));
    const container = document.getElementById('history-container');
    if (container) {
        container.innerHTML = renderHistoryList(bills);
        container.querySelectorAll('[data-action="view-bill"]').forEach(el => {
            el.addEventListener('click', () => handleAction('view-bill', el.dataset));
        });
    }
}

// ===== EXPORT / IMPORT =====
function exportData() {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded!');
}

function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            if (imported.suppliers && imported.bills) {
                if (confirm(`Import ${imported.suppliers.length} suppliers and ${imported.bills.length} bills? This will REPLACE current data.`)) {
                    appData = imported;
                    if (!appData.discrepancies) appData.discrepancies = [];
                    saveData();
                    toast('Data restored!');
                    navigate('dashboard');
                }
            } else {
                toast('Invalid backup file');
            }
        } catch (err) {
            toast('Error reading file');
        }
    };
    reader.readAsText(file);
}

function exportCSV() {
    if (appData.bills.length === 0) { toast('No bills to export'); return; }
    let csv = 'Date,Supplier,Bill No,Item,Qty,Unit,Rate,Total,Bill Total,Written Total,Mismatch\n';
    appData.bills.forEach(bill => {
        const sup = appData.suppliers.find(s => s.id === bill.supplierId);
        bill.items.forEach(item => {
            csv += `${bill.date},"${sup ? sup.name : ''}","${bill.billNumber || ''}","${item.name}",${item.qty},"${item.unit}",${item.rate},${item.calculatedTotal},${bill.calculatedTotal},${bill.writtenTotal || ''},${bill.hasMismatch ? 'YES' : ''}\n`;
        });
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bills-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported!');
}

// ===== MONTHLY SUMMARY =====
function showMonthlySummary() {
    const monthly = {};
    appData.bills.forEach(bill => {
        const key = new Date(bill.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        if (!monthly[key]) monthly[key] = { total: 0, count: 0, paid: 0 };
        monthly[key].total += bill.calculatedTotal;
        monthly[key].count++;
    });
    appData.payments.forEach(p => {
        const key = new Date(p.date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        if (monthly[key]) monthly[key].paid += p.amount;
    });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="modal-handle"></div>
            <h3 style="margin-bottom:16px;">📅 Monthly Summary</h3>
            ${Object.entries(monthly).length === 0 ? '<p>No data yet</p>' :
                Object.entries(monthly).map(([month, data]) => `
                    <div style="display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border);">
                        <div>
                            <div style="font-weight:600;">${month}</div>
                            <div class="fs-sm" style="color:var(--text-secondary);">${data.count} bills · Paid: ${fmt(data.paid)}</div>
                        </div>
                        <div style="font-weight:700; font-size:1.1rem;">${fmt(data.total)}</div>
                    </div>
                `).join('')
            }
            <button class="btn btn-ghost mt-16" id="close-summary">Close</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#close-summary').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ===== INIT =====
render();
