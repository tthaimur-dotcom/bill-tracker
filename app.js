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

// === IndexedDB (survives Chrome history clear) ===
const IDB_NAME = 'BillTrackerDB';
const IDB_STORE = 'appdata';
const IDB_VERSION = 1;

function openIDB() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function() { reject(); };
    });
}

function saveToIDB(data) {
    openIDB().then(function(db) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(data, 'main');
    }).catch(function() {});
}

function loadFromIDB() {
    return openIDB().then(function(db) {
        return new Promise(function(resolve, reject) {
            var tx = db.transaction(IDB_STORE, 'readonly');
            var req = tx.objectStore(IDB_STORE).get('main');
            req.onsuccess = function() { resolve(req.result || null); };
            req.onerror = function() { resolve(null); };
        });
    }).catch(function() { return null; });
}

// === Load data: try localStorage first, fallback to IndexedDB ===
function loadData() {
    try {
        var raw = localStorage.getItem(DB_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { suppliers: [], bills: [], payments: [], discrepancies: [] };
}

function saveData() {
    localStorage.setItem(DB_KEY, JSON.stringify(appData));
    // Also save to IndexedDB (survives clear history)
    saveToIDB(appData);
}

// Auto-save draft bill
const DRAFT_KEY = 'billTrackerDraft';
function saveDraft() {
    if (billState.supplierId || billState.items.some(function(i) { return i.qty || i.rate || i.total; })) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(billState));
    }
}
function loadDraft() {
    try { var d = localStorage.getItem(DRAFT_KEY); return d ? JSON.parse(d) : null; } catch(e) { return null; }
}
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

// On startup: if localStorage is empty but IndexedDB has data, restore it
function initDataRecovery() {
    var lsData = localStorage.getItem(DB_KEY);
    if (!lsData || lsData === '{"suppliers":[],"bills":[],"payments":[],"discrepancies":[]}') {
        loadFromIDB().then(function(idbData) {
            if (idbData && idbData.suppliers && idbData.suppliers.length > 0) {
                appData = idbData;
                if (!appData.discrepancies) appData.discrepancies = [];
                localStorage.setItem(DB_KEY, JSON.stringify(appData));
                toast('Data recovered from backup!');
                render();
            }
        });
    }
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
    return '₹' + num.toLocaleString('en-IN', { maximumFractionDigits: 0 });
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
        case 'calendar': html = renderCalendar(); break;
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

    // Today's bills
    const today = new Date().toISOString().split('T')[0];
    const todayBills = appData.bills.filter(b => b.date === today);
    const todayTotal = todayBills.reduce((s, b) => s + b.calculatedTotal, 0);

    // Monthly comparison
    const now = new Date();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastMonthTotal = appData.bills
        .filter(b => { var d = new Date(b.date); return d >= lastMonthStart && d <= lastMonthEnd; })
        .reduce((s, b) => s + b.calculatedTotal, 0);
    const monthDiff = lastMonthTotal > 0 ? Math.round(((monthTotal - lastMonthTotal) / lastMonthTotal) * 100) : 0;

    const recentBills = [...appData.bills].sort((a, b) => new Date(a.date) - new Date(b.date));

    return `
        <div class="screen-header">
            <h1>Bill Tracker</h1>
            <div class="header-actions">
                <button class="icon-btn" data-action="toggle-theme">🌙</button>
            </div>
        </div>

        <!-- Global Search -->
        <div class="search-bar">
            <input id="global-search" placeholder="Search bills, suppliers, amounts..." />
        </div>

        ${todayBills.length > 0 ? `
        <div class="today-strip">
            Today: ${todayBills.length} bill${todayBills.length > 1 ? 's' : ''} · ${fmtShort(todayTotal)}
        </div>` : ''}

        <div class="stats-grid">
            <div class="stat-card highlight">
                <div class="stat-value">${fmtShort(totalDue)}</div>
                <div class="stat-label">Total Due</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${fmtShort(monthTotal)}</div>
                <div class="stat-label">This Month ${monthDiff !== 0 ? '<span style="font-size:0.7rem;color:' + (monthDiff > 0 ? 'var(--danger)' : 'var(--success)') + '">' + (monthDiff > 0 ? '↑' : '↓') + Math.abs(monthDiff) + '%</span>' : ''}</div>
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

        <!-- Supplier Balances -->
        ${appData.suppliers.length > 0 ? `
            <div class="section-title">Supplier Balances</div>
            <div class="card balance-card">
                ${[...appData.suppliers].sort((a, b) => getBalance(b.id) - getBalance(a.id)).map(sup => {
                    const bal = getBalance(sup.id);
                    return `<div class="bal-row" data-action="view-supplier" data-id="${sup.id}">
                        <span class="bal-name">${sup.name}</span>
                        <span class="bal-amt ${bal > 0 ? 'due' : bal < 0 ? 'overpaid' : 'clear'}">${bal === 0 ? 'Clear' : fmtShort(bal)}</span>
                    </div>`;
                }).join('')}
                <div class="bal-row bal-total">
                    <span class="bal-name">TOTAL</span>
                    <span class="bal-amt due">${fmtShort(totalDue)}</span>
                </div>
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
            <button class="btn btn-ghost btn-sm" data-action="view-statement" data-id="${sup.id}">� Statement</button>
        </div>

        <!-- Quick Payment -->
        <div class="quick-pay-strip">
            <input class="quick-pay-input" type="number" inputmode="decimal" placeholder="₹ Amount" id="quick-pay-amt" />
            <select class="quick-pay-mode" id="quick-pay-mode"><option>Cash</option><option>UPI</option><option>NEFT</option><option>Cheque</option></select>
            <button class="btn btn-success btn-sm quick-pay-btn" data-action="quick-pay" data-id="${sup.id}">Pay</button>
        </div>

        <div class="section-title">Ledger (Running Balance)</div>
        ${ledger.length === 0 ? '<div class="empty-state"><p>No transactions yet</p></div>' :
            `<div class="card" style="padding:8px 12px;">
                ${ledger.map(entry => `
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

        <!-- Payment History -->
        ${appData.payments.filter(p => p.supplierId === sup.id).length > 0 ? `
        <div class="section-title">Payment History</div>
        <div class="card" style="padding:8px 12px;">
            ${appData.payments.filter(p => p.supplierId === sup.id).sort((a, b) => new Date(a.date) - new Date(b.date)).map(p => `
                <div class="pay-hist-row">
                    <div class="pay-hist-info">
                        <span class="pay-hist-date">${fmtDate(p.date)}</span>
                        <span class="pay-hist-mode">${p.note || 'Payment'}</span>
                    </div>
                    <span class="pay-hist-amt">${fmtShort(p.amount)}</span>
                </div>
            `).join('')}
            <div class="pay-hist-row pay-hist-total">
                <span>Total Paid</span>
                <span class="pay-hist-amt">${fmtShort(appData.payments.filter(p => p.supplierId === sup.id).reduce((s, p) => s + p.amount, 0))}</span>
            </div>
        </div>
        ` : ''}
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
    adjustment: '',
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
        adjustment: '',
        editingBillId: null
    };
}

function renderAddBill() {
    if (!billState.supplierId && screenParams.supplierId) {
        billState.supplierId = screenParams.supplierId;
    }
    // Check for saved draft
    if (!billState.supplierId && !billState.editingBillId) {
        var draft = loadDraft();
        if (draft && draft.supplierId && !screenParams.draftChecked) {
            screenParams.draftChecked = true;
            if (confirm('Continue with saved draft?')) {
                billState = draft;
            } else {
                clearDraft();
            }
        }
    }

    const calcTotal = billState.items.reduce((s, i) => s + calcItemTotal(i), 0);
    const adj = parseFloat(billState.adjustment) || 0;
    const finalTotal = calcTotal + adj;
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;

    // Live tracker logic
    let trackerHtml = '';
    if (writtenTotal > 0 && finalTotal > 0) {
        const diff = finalTotal - writtenTotal;
        if (Math.abs(diff) < 0.5) {
            trackerHtml = `<div class="live-tracker match">✓ MATCH — Verified!</div>`;
        } else if (diff > 0) {
            trackerHtml = `<div class="live-tracker exceeded">⚠ EXCEEDED BY ${fmt(diff)}</div>`;
        } else {
            trackerHtml = `<div class="live-tracker short">⏳ SHORT BY ${fmt(Math.abs(diff))}</div>`;
        }
    } else if (writtenTotal > 0 && finalTotal === 0) {
        trackerHtml = `<div class="live-tracker short">⏳ REMAINING: ${fmt(writtenTotal)} — add items</div>`;
    } else if (finalTotal > 0 && writtenTotal === 0) {
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
                <option value="">-- Select --</option>
                ${appData.suppliers.map(s => `<option value="${s.id}" ${billState.supplierId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
            </select>
            ${billState.supplierId ? `<div class="supplier-bal-hint">Balance: <strong>${fmtShort(getBalance(billState.supplierId))}</strong></div>` : ''}
        </div>

        <div class="form-group" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
                <label>Date</label>
                <input class="form-input" type="date" id="bill-date" value="${billState.date}" />
            </div>
            <div>
                <label>Dealer Total</label>
                <input class="form-input form-input-lg" type="number" id="written-total" value="${billState.writtenTotal}" placeholder="₹" inputmode="decimal" step="1" />
            </div>
        </div>

        <!-- Live Tracker -->
        ${trackerHtml}

        <!-- Photo -->
        <div class="photo-section">
            <div class="photo-btns">
                <button class="btn btn-outline btn-sm" data-action="take-photo">📷</button>
                <button class="btn btn-outline btn-sm" data-action="upload-photo">�</button>
                ${billState.photo ? `<button class="btn btn-ghost btn-sm" data-action="clear-photo">✕ Remove</button>` : ''}
            </div>
            ${billState.photo ? `<img class="photo-preview-img" src="${billState.photo}" alt="Bill" />` : ''}
            <input type="file" id="file-camera" accept="image/*" capture="environment" class="hidden" />
            <input type="file" id="file-upload" accept="image/*" class="hidden" />
        </div>

        <!-- Suggestions -->
        ${suggestions.length > 0 ? `
            <div class="suggestions-bar">
                ${suggestions.slice(0, 8).map(s => `<button class="suggestion-chip" data-action="add-suggestion" data-name="${s.name}" data-rate="${s.rate}" data-unit="${s.unit || 'pcs'}">${s.name}</button>`).join('')}
            </div>
        ` : ''}

        <!-- FAST ITEM ENTRY -->
        <div class="fast-items-section">
            <div class="fast-items-head">
                <span class="fi-sl">#</span>
                <span class="fi-item">Item</span>
                <span class="fi-qty">Qty</span>
                <span class="fi-rate">Rate</span>
                <span class="fi-amt">Amt</span>
            </div>
            ${billState.items.map((item, idx) => {
                const itemTotal = calcItemTotal(item);
                const hasQtyRate = parseFloat(item.qty) && parseFloat(item.rate);
                return `
                <div class="fast-items-row" data-idx="${idx}">
                    <span class="fi-sl">${idx + 1}</span>
                    <input class="fi-input fi-item item-input" placeholder="Item ${idx + 1}" value="${item.name}" data-field="name" data-idx="${idx}" />
                    <input class="fi-input fi-qty item-input" placeholder="—" type="number" inputmode="decimal" value="${item.qty}" data-field="qty" data-idx="${idx}" />
                    <input class="fi-input fi-rate item-input" placeholder="—" type="number" inputmode="decimal" value="${item.rate}" data-field="rate" data-idx="${idx}" />
                    <input class="fi-input fi-amt item-input" placeholder="${hasQtyRate ? itemTotal.toFixed(0) : '—'}" type="number" inputmode="decimal" value="${item.total || (hasQtyRate ? '' : '')}" data-field="total" data-idx="${idx}" ${hasQtyRate ? 'disabled' : ''} />
                </div>`;
            }).join('')}
            <div class="fast-items-footer">
                <button class="fi-add-btn" data-action="add-item">+</button>
                <button class="fi-add-btn" data-action="add-5-items">+5</button>
                <span class="fi-total-label">TOTAL</span>
                <span class="fi-total-val" id="calc-total-display">${finalTotal > 0 ? finalTotal.toLocaleString('en-IN') : '0'}</span>
            </div>
        </div>

        <!-- Comparison Strip -->
        ${(finalTotal > 0 || writtenTotal > 0) ? `
        <div class="compare-strip">
            <div class="compare-row">
                <span class="compare-label">Your Items</span>
                <span class="compare-value" id="compare-calc">${calcTotal > 0 ? calcTotal.toLocaleString('en-IN') : '—'}</span>
            </div>
            ${adj !== 0 ? `<div class="compare-row">
                <span class="compare-label">Adjustment (prev bill)</span>
                <span class="compare-value" style="color:${adj < 0 ? 'var(--success)' : 'var(--danger)'}">${adj > 0 ? '+' : ''}${adj.toLocaleString('en-IN')}</span>
            </div>
            <div class="compare-row">
                <span class="compare-label">Net Total</span>
                <span class="compare-value"><strong>${finalTotal.toLocaleString('en-IN')}</strong></span>
            </div>` : ''}
            <div class="compare-row">
                <span class="compare-label">Dealer's Slip</span>
                <span class="compare-value">${writtenTotal > 0 ? writtenTotal.toLocaleString('en-IN') : '—'}</span>
            </div>
            ${(finalTotal > 0 && writtenTotal > 0) ? `
            <div class="compare-row compare-diff ${Math.abs(finalTotal - writtenTotal) < 0.5 ? 'match' : 'mismatch'}">
                <span class="compare-label">${Math.abs(finalTotal - writtenTotal) < 0.5 ? 'MATCH' : 'DIFFERENCE'}</span>
                <span class="compare-value">${Math.abs(finalTotal - writtenTotal) < 0.5 ? '0' : (finalTotal - writtenTotal > 0 ? '+' : '') + Math.round(finalTotal - writtenTotal).toLocaleString('en-IN')}</span>
            </div>` : ''}
        </div>` : ''}

        <div class="form-group" style="margin-top:8px;">
            <label>Bill No. (optional)</label>
            <input class="form-input" id="bill-number" value="${billState.billNumber}" placeholder="Ref" />
        </div>

        <div class="form-group">
            <label>Adjustment (prev bill correction)</label>
            <div style="display:flex;gap:8px;align-items:center;">
                <button class="adj-sign-btn" data-action="toggle-adj-sign" id="adj-sign-btn" data-sign="${(parseFloat(billState.adjustment) || 0) < 0 ? 'neg' : 'pos'}" style="color:${(parseFloat(billState.adjustment) || 0) < 0 ? 'var(--danger)' : 'var(--success)'}">${(parseFloat(billState.adjustment) || 0) < 0 ? '-' : '+'}</button>
                <input class="form-input" type="number" inputmode="decimal" id="bill-adjustment" value="${Math.abs(parseFloat(billState.adjustment) || 0) || ''}" placeholder="0" step="1" style="flex:1" />
            </div>
            <p class="fs-sm" style="color:var(--text-secondary);margin-top:4px;">Enter total adjustment amount. Tap +/- to switch.</p>
        </div>

        <div class="btn-row mt-16" style="margin-bottom:20px;">
            <button class="btn btn-primary" data-action="save-bill">${billState.editingBillId ? 'Update Bill' : 'Save Bill'}</button>
        </div>
    `;
}

function calcItemTotal(item) {
    const qty = parseFloat(item.qty) || 0;
    const rate = parseFloat(item.rate) || 0;
    const manualTotal = parseFloat(item.total) || 0;
    if (qty && rate) return Math.round(qty * rate * 100) / 100;
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
            <button class="btn btn-primary btn-sm" data-action="share-card-image" data-id="${bill.id}">📸 Share Image</button>
            <button class="btn btn-outline btn-sm" data-action="edit-bill" data-id="${bill.id}">✏️ Edit Bill</button>
        </div>
        <div class="btn-row">
            <button class="btn btn-outline btn-sm" data-action="share-bill-whatsapp" data-id="${bill.id}">💬 WhatsApp</button>
            <button class="btn btn-outline btn-sm" data-action="share-bill-text" data-id="${bill.id}">📋 Copy</button>
            <button class="btn btn-danger btn-sm" data-action="delete-bill" data-id="${bill.id}">🗑️</button>
        </div>
    `;
}

// ===== HISTORY =====
function renderHistory() {
    const bills = [...appData.bills].sort((a, b) => new Date(a.date) - new Date(b.date));

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
            html += `<div class="card bill-card-wrap">
                <div class="bill-card" data-action="view-bill" data-id="${bill.id}">
                    <div class="bill-icon ${bill.hasMismatch ? 'mismatch' : ''}">
                        ${bill.hasMismatch ? '⚠️' : '📄'}
                    </div>
                    <div class="bill-info">
                        <h4>${sup ? sup.name : 'Unknown'}</h4>
                        <p>${fmtDateShort(bill.date)} · ${bill.items.length} items${bill.billNumber ? ' · #' + bill.billNumber : ''}</p>
                    </div>
                    <div class="bill-amount">${fmt(bill.calculatedTotal)}</div>
                </div>
                <button class="bill-edit-btn" data-action="edit-bill" data-id="${bill.id}">✏️</button>
            </div>`;
        });
    }
    return html;
}

// ===== DISCREPANCY LOG =====
function renderDiscrepancies() {
    const discBills = appData.bills.filter(b => b.hasMismatch).sort((a, b) => new Date(a.date) - new Date(b.date));

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
            <button class="btn btn-primary btn-sm" data-action="pdf-statement" data-id="${sup.id}">� PDF Statement</button>
        </div>
        <div class="btn-row">
            <button class="btn btn-outline btn-sm" data-action="copy-statement" data-id="${sup.id}">📋 Copy</button>
            <button class="btn btn-outline btn-sm" data-action="whatsapp-statement" data-id="${sup.id}">💬 WhatsApp</button>
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

        <div class="card" data-action="go-calendar" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📅</div>
                <div class="supplier-details"><h3>Spending Calendar</h3><p>Heatmap of daily spending</p></div>
            </div>
        </div>

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

        <div class="card" data-action="export-pdf-ledger" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📄</div>
                <div class="supplier-details"><h3>Export PDF Ledger</h3><p>Full month ledger as PDF</p></div>
            </div>
        </div>

        <div class="card" data-action="toggle-theme" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">🌙</div>
                <div class="supplier-details"><h3>Dark Mode</h3><p>Toggle theme</p></div>
            </div>
        </div>

        <div class="section-title">Sync & Backup</div>

        <div class="card" data-action="qr-sync" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📲</div>
                <div class="supplier-details"><h3>QR Sync (Offline)</h3><p>Transfer data via QR code</p></div>
            </div>
        </div>

        <div class="card" data-action="email-backup" style="cursor:pointer;">
            <div class="supplier-item">
                <div class="supplier-avatar">📧</div>
                <div class="supplier-details"><h3>Email Backup</h3><p>Send backup to your email</p></div>
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

// ===== NAVIGATION HELPERS (global) =====
function goNextRowGlobal(currentIdx) {
    var nextIdx = currentIdx + 1;
    if (nextIdx < billState.items.length) {
        var nextQty = document.querySelector('.fast-items-row[data-idx="' + nextIdx + '"] .fi-qty');
        if (nextQty) nextQty.focus();
    } else {
        billState.items.push({ name: '', qty: '', unit: 'pcs', rate: '', total: '' });
        navigate('add-bill');
        setTimeout(function() {
            var rows = document.querySelectorAll('.fast-items-row');
            var last = rows[rows.length - 1];
            if (last) last.querySelector('.fi-qty').focus();
        }, 100);
    }
}

function moveToNextFieldGlobal() {
    var focused = document.activeElement;
    if (!focused || !focused.classList.contains('fi-input')) {
        var first = document.querySelector('.fast-items-row[data-idx="0"] .fi-qty');
        if (first) first.focus();
        return;
    }
    var row = focused.closest('.fast-items-row');
    if (!row) return;
    var idx = parseInt(row.dataset.idx);

    if (focused.classList.contains('fi-item')) {
        var q = row.querySelector('.fi-qty');
        if (q) q.focus();
    } else if (focused.classList.contains('fi-qty')) {
        var r = row.querySelector('.fi-rate');
        if (r) r.focus();
    } else if (focused.classList.contains('fi-rate')) {
        // After rate → go to NEXT row qty (not amt in same row)
        goNextRowGlobal(idx);
    } else if (focused.classList.contains('fi-amt')) {
        goNextRowGlobal(idx);
    }
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

            // If qty+rate entered, auto-calculate and disable amt field
            const row = e.target.closest('.fast-items-row');
            if (row) {
                const qty = parseFloat(billState.items[idx].qty) || 0;
                const rate = parseFloat(billState.items[idx].rate) || 0;
                const amtInput = row.querySelector('.fi-amt');
                if (qty && rate && amtInput) {
                    amtInput.placeholder = (qty * rate).toFixed(0);
                    amtInput.disabled = true;
                    billState.items[idx].total = '';
                } else if (amtInput) {
                    amtInput.disabled = false;
                    amtInput.placeholder = '—';
                }
            }

            // Update total display
            const calcTotal = billState.items.reduce((s, i) => s + calcItemTotal(i), 0);
            const totalEl = document.getElementById('calc-total-display');
            if (totalEl) totalEl.textContent = '₹' + (calcTotal > 0 ? calcTotal.toLocaleString('en-IN') : '0');

            updateLiveTracker();
            saveDraft();
        });

        // Enter key: fast navigation
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const idx = parseInt(e.target.dataset.idx);
                const field = e.target.dataset.field;
                const row = e.target.closest('.fast-items-row');

                if (field === 'name') {
                    if (row) row.querySelector('.fi-qty')?.focus();
                } else if (field === 'qty') {
                    if (row) row.querySelector('.fi-rate')?.focus();
                } else if (field === 'rate') {
                    const rate = parseFloat(e.target.value);
                    if (rate) {
                        goNextRow(idx);
                    } else {
                        const amtInput = row?.querySelector('.fi-amt');
                        if (amtInput && !amtInput.disabled) amtInput.focus();
                        else goNextRow(idx);
                    }
                } else if (field === 'total') {
                    goNextRow(idx);
                }
            }
        });
    });

    function goNextRow(currentIdx) {
        goNextRowGlobal(currentIdx);
    }

    // Move focus: qty → rate → amt → next row qty
    function moveToNextField() {
        moveToNextFieldGlobal();
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
    const adjInp = document.getElementById('bill-adjustment');
    const adjSignBtn = document.getElementById('adj-sign-btn');
    if (adjInp) adjInp.addEventListener('input', e => {
        var val = parseFloat(e.target.value) || 0;
        var isNeg = adjSignBtn && adjSignBtn.dataset.sign === 'neg';
        billState.adjustment = String(isNeg ? -val : val);
        updateLiveTracker();
    });
    if (adjSignBtn) adjSignBtn.addEventListener('click', function() {
        var isNeg = this.dataset.sign === 'neg';
        if (isNeg) {
            this.dataset.sign = 'pos';
            this.textContent = '+';
            this.style.color = 'var(--success)';
        } else {
            this.dataset.sign = 'neg';
            this.textContent = '-';
            this.style.color = 'var(--danger)';
        }
        // Recalculate adjustment with new sign
        var val = parseFloat(adjInp.value) || 0;
        billState.adjustment = String(this.dataset.sign === 'neg' ? -val : val);
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

    // Global search on dashboard
    const globalSearch = document.getElementById('global-search');
    if (globalSearch) {
        globalSearch.addEventListener('input', function(e) {
            var q = e.target.value.toLowerCase().trim();
            var resultsDiv = document.getElementById('search-results');
            if (!q) { if (resultsDiv) resultsDiv.remove(); return; }

            var results = [];
            // Search bills
            appData.bills.forEach(function(b) {
                var sup = appData.suppliers.find(function(s) { return s.id === b.supplierId; });
                var supName = sup ? sup.name.toLowerCase() : '';
                var items = b.items.map(function(i) { return (i.name || '').toLowerCase(); }).join(' ');
                var amt = String(b.calculatedTotal);
                var billNum = (b.billNumber || '').toLowerCase();
                if (supName.includes(q) || items.includes(q) || amt.includes(q) || billNum.includes(q) || (b.date || '').includes(q)) {
                    results.push({ type: 'bill', id: b.id, title: (sup ? sup.name : '?') + (b.billNumber ? ' #' + b.billNumber : ''), sub: fmtDateShort(b.date) + ' · ' + b.items.length + ' items', amt: b.calculatedTotal });
                }
            });
            // Search suppliers
            appData.suppliers.forEach(function(s) {
                if (s.name.toLowerCase().includes(q)) {
                    results.push({ type: 'supplier', id: s.id, title: s.name, sub: 'Supplier', amt: getBalance(s.id) });
                }
            });

            if (!resultsDiv) {
                resultsDiv = document.createElement('div');
                resultsDiv.id = 'search-results';
                resultsDiv.className = 'search-results';
                globalSearch.parentElement.after(resultsDiv);
            }
            if (results.length === 0) {
                resultsDiv.innerHTML = '<div class="search-no-result">No results</div>';
            } else {
                resultsDiv.innerHTML = results.slice(0, 10).map(function(r) {
                    return '<div class="search-result-item" data-action="' + (r.type === 'bill' ? 'view-bill' : 'view-supplier') + '" data-id="' + r.id + '">' +
                        '<div class="sr-info"><div class="sr-title">' + r.title + '</div><div class="sr-sub">' + r.sub + '</div></div>' +
                        '<div class="sr-amt">' + fmtShort(r.amt) + '</div></div>';
                }).join('');
                // Attach click events
                resultsDiv.querySelectorAll('[data-action]').forEach(function(el) {
                    el.addEventListener('click', function() { handleAction(el.dataset.action, el.dataset); });
                });
            }
        });
    }
}

function updateLiveTracker() {
    const calcTotal = billState.items.reduce((s, i) => s + calcItemTotal(i), 0);
    const adj = parseFloat(billState.adjustment) || 0;
    const finalTotal = calcTotal + adj;
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;

    // Update total display in footer
    const totalEl = document.getElementById('calc-total-display');
    if (totalEl) totalEl.textContent = finalTotal > 0 ? finalTotal.toLocaleString('en-IN') : '0';

    // Update compare strip values if visible
    const compareCalc = document.getElementById('compare-calc');
    if (compareCalc) compareCalc.textContent = calcTotal > 0 ? calcTotal.toLocaleString('en-IN') : '—';

    // Update live tracker banner
    const existing = document.querySelector('.live-tracker');
    let html = '';
    if (writtenTotal > 0 && finalTotal > 0) {
        const diff = finalTotal - writtenTotal;
        if (Math.abs(diff) < 0.5) {
            html = `<div class="live-tracker match">✓ MATCH</div>`;
        } else if (diff > 0) {
            html = `<div class="live-tracker exceeded">⚠ EXCEEDED BY ₹${Math.abs(Math.round(diff)).toLocaleString('en-IN')}</div>`;
        } else {
            html = `<div class="live-tracker short">⏳ SHORT BY ₹${Math.abs(Math.round(diff)).toLocaleString('en-IN')}</div>`;
        }
    } else if (writtenTotal > 0 && finalTotal === 0) {
        html = `<div class="live-tracker short">⏳ REMAINING: ₹${Math.round(writtenTotal).toLocaleString('en-IN')}</div>`;
    } else if (finalTotal > 0 && writtenTotal === 0) {
        html = `<div class="live-tracker neutral">Enter dealer total to verify</div>`;
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
                    adjustment: bill.adjustment ? String(bill.adjustment) : '',
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

        case 'next-field':
            moveToNextFieldGlobal();
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
        case 'clear-photo': billState.photo = null; navigate('add-bill'); break;
        case 'add-payment': showPaymentModal(dataset.id); break;

        case 'quick-pay': {
            var qAmt = parseFloat(document.getElementById('quick-pay-amt')?.value);
            if (!qAmt || qAmt <= 0) { toast('Enter amount'); break; }
            var qMode = document.getElementById('quick-pay-mode')?.value || 'Cash';
            appData.payments.push({
                id: uid(),
                supplierId: dataset.id,
                amount: qAmt,
                date: new Date().toISOString().split('T')[0],
                note: qMode,
                createdAt: new Date().toISOString()
            });
            saveData();
            var supN = appData.suppliers.find(function(s) { return s.id === dataset.id; })?.name || '';
            syncToSheet('addPayment', { supplier: supN, date: new Date().toISOString().split('T')[0], amount: qAmt, note: qMode });
            toast('Payment recorded!');
            navigate('supplier-detail', { id: dataset.id });
            break;
        }

        case 'share-bill-text': shareBillAsText(dataset.id); break;
        case 'share-bill-whatsapp': shareBillWhatsApp(dataset.id); break;
        case 'share-card-image': shareCardAsImage(dataset.id); break;

        case 'view-statement': navigate('supplier-statement', { id: dataset.id }); break;
        case 'copy-statement': copyStatement(dataset.id); break;
        case 'whatsapp-statement': whatsappStatement(dataset.id); break;
        case 'pdf-statement': generateStatementPDF(dataset.id); break;

        case 'go-discrepancies': navigate('discrepancies'); break;
        case 'go-history': navigate('history'); break;

        case 'export-data': exportData(); break;
        case 'import-data': document.getElementById('import-file').click(); break;
        case 'export-csv': exportCSV(); break;
        case 'monthly-summary': showMonthlySummary(); break;
        case 'go-calendar': navigate('calendar'); break;
        case 'voice-entry': startVoiceEntry(); break;
        case 'export-pdf-ledger': exportPDFLedger(); break;
        case 'email-backup': emailBackup(); break;
        case 'qr-sync': showQRSync(); break;

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

        case 'cal-prev':
        case 'cal-next':
        case 'cal-day':
            handleCalendarAction(action, dataset); break;

        case 'zoom-photo':
            if (billState.photo) showPhotoZoom(billState.photo); break;
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

    const adjustment = parseFloat(billState.adjustment) || 0;
    const itemsTotal = validItems.length > 0
        ? validItems.reduce((s, i) => s + calcItemTotal(i), 0)
        : parseFloat(billState.writtenTotal) || 0;
    const calculatedTotal = itemsTotal + adjustment;
    const writtenTotal = parseFloat(billState.writtenTotal) || 0;
    const hasMismatch = validItems.length > 0 && writtenTotal > 0 && Math.abs(calculatedTotal - writtenTotal) > 0.5;

    // Duplicate detection
    if (!billState.editingBillId) {
        var duplicate = appData.bills.find(function(b) {
            return b.supplierId === billState.supplierId && b.date === billState.date && Math.abs(b.calculatedTotal - calculatedTotal) < 1;
        });
        if (duplicate) {
            if (!confirm('Same supplier, date, and amount already exists. Save anyway?')) return;
        }
    }

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
            adjustment,
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
        clearDraft();
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
        t += `${NL}Sir, please check once. There is a small${NL}difference in the bill total.${NL}Kindly verify and confirm.${NL}Thank you.${NL}`;
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

// ===== PDF STATEMENT (image-based) =====
function generateStatementPDF(supplierId) {
    var sup = appData.suppliers.find(function(s) { return s.id === supplierId; });
    if (!sup) { toast('Supplier not found'); return; }
    var ledger = getRunningLedger(supplierId);
    var balance = getBalance(supplierId);
    var totalBilled = appData.bills.filter(function(b) { return b.supplierId === supplierId; }).reduce(function(s, b) { return s + b.calculatedTotal; }, 0);
    var totalPaid = appData.payments.filter(function(p) { return p.supplierId === supplierId; }).reduce(function(s, p) { return s + p.amount; }, 0);

    var S = 2;
    var W = 800 * S;
    var pad = 50 * S;
    var LH = 26 * S;
    var F = 14 * S;
    var amtX = W - pad;

    // Height calc
    var lines = 12 + ledger.length + 4;
    var H = lines * LH + pad * 2;

    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    var y = pad;

    function setFont(size, bold) { ctx.font = (bold ? 'bold ' : '') + size + 'px "Courier New", monospace'; }
    function line(thick) { ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.strokeStyle = '#000'; ctx.lineWidth = (thick ? 2.5 : 1) * S; ctx.stroke(); y += LH * 0.5; }
    function txtL(t, bold) { setFont(F, bold); ctx.fillStyle = '#111'; ctx.fillText(t, pad, y); y += LH; }
    function txtLR(l, r, bold) { setFont(F, bold); ctx.fillStyle = '#111'; ctx.fillText(l, pad, y); var w = ctx.measureText(r).width; ctx.fillText(r, W - pad - w, y); y += LH; }

    // Title
    setFont(18 * S, true); ctx.fillStyle = '#111';
    var title = 'ACCOUNT STATEMENT';
    ctx.fillText(title, (W - ctx.measureText(title).width) / 2, y);
    y += LH * 1.4;

    // Supplier info
    txtL('Supplier : ' + sup.name.toUpperCase(), true);
    txtLR('Date     : ' + fmtDate(new Date().toISOString()), sup.phone ? 'Ph: ' + sup.phone : '');
    y += LH * 0.3;

    line(true);

    // Summary
    txtLR('Total Billed', 'Rs.' + Math.round(totalBilled));
    txtLR('Total Paid', 'Rs.' + Math.round(totalPaid));
    setFont(F, true); ctx.fillStyle = '#111';
    ctx.fillText('BALANCE DUE', pad, y);
    var balStr = 'Rs.' + Math.round(balance);
    ctx.fillText(balStr, W - pad - ctx.measureText(balStr).width, y);
    y += LH;

    line(true);
    y += LH * 0.3;

    // Column headers
    setFont(F, true); ctx.fillStyle = '#111';
    ctx.fillText('Date', pad, y);
    ctx.fillText('Type', pad + 130 * S, y);
    ctx.fillText('Amount', pad + 240 * S, y);
    var bh = 'Balance';
    ctx.fillText(bh, W - pad - ctx.measureText(bh).width, y);
    y += LH;

    line(false);

    // Transactions
    ledger.forEach(function(entry) {
        setFont(F, false);
        ctx.fillStyle = entry.type === 'bill' ? '#111' : '#059669';
        var d = fmtDateShort(entry.date);
        var tp = entry.type === 'bill' ? 'BILL' : 'PAID';
        var amt = (entry.type === 'bill' ? '+' : '-') + Math.round(entry.amount);
        var bal = String(Math.round(entry.balance));
        ctx.fillText(d, pad, y);
        ctx.fillText(tp, pad + 130 * S, y);
        ctx.fillText(amt, pad + 240 * S, y);
        setFont(F, true);
        ctx.fillStyle = '#111';
        ctx.fillText(bal, W - pad - ctx.measureText(bal).width, y);
        y += LH;
    });

    line(true);

    // Footer
    setFont(12 * S, false); ctx.fillStyle = '#666';
    ctx.fillText('Generated: ' + new Date().toLocaleDateString('en-IN') + '  |  For Reference Only', pad, y);
    y += LH;

    // Crop and export
    var fH = y + pad / 2;
    var fc = document.createElement('canvas');
    fc.width = W; fc.height = fH;
    var fctx = fc.getContext('2d');
    fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, fc.width, fH);
    fctx.drawImage(canvas, 0, 0);

    fc.toBlob(function(blob) {
        if (navigator.share && navigator.canShare) {
            try {
                var file = new File([blob], 'statement-' + sup.name + '-' + new Date().toISOString().split('T')[0] + '.png', {type:'image/png'});
                if (navigator.canShare({files:[file]})) { navigator.share({files:[file], title:'Statement'}).catch(function(){}); return; }
            } catch(e) {}
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'statement-' + sup.name + '-' + new Date().toISOString().split('T')[0] + '.png';
        a.click(); URL.revokeObjectURL(url);
        toast('Statement saved!');
    }, 'image/png', 1.0);
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

// ===== SHARE AS IMAGE (receipt style) =====

// ===== SHARE AS IMAGE (receipt style - clean) =====

// ===== SHARE AS IMAGE (clean minimal style) =====
function shareCardAsImage(billId) {
    var bill = appData.bills.find(function(b) { return b.id === billId; });
    if (!bill) return;
    var sup = appData.suppliers.find(function(s) { return s.id === bill.supplierId; });
    var S = 2;
    var W = 750 * S;
    var pad = 44 * S;
    var LH = 32 * S;
    var itemCount = bill.items.length;
    var lines = 7 + itemCount + (bill.hasMismatch ? 5 : 0);
    if (bill.photo) lines += 12;
    var H = lines * LH + pad * 3;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    var y = pad;
    if (bill.photo) {
        var img = new Image();
        img.onload = function() {
            var maxPH = 10 * LH;
            var ratio = Math.min((W - pad * 2) / img.width, maxPH / img.height);
            var dw = img.width * ratio, dh = img.height * ratio;
            ctx.drawImage(img, (W - dw) / 2, y, dw, dh);
            y += dh + LH;
            drawCleanBill(ctx, W, pad, LH, y, bill, sup, S, canvas);
        };
        img.src = bill.photo;
    } else {
        drawCleanBill(ctx, W, pad, LH, y, bill, sup, S, canvas);
    }
}

function drawCleanBill(ctx, W, pad, LH, y, bill, sup, S, canvas) {
    var supName = sup ? sup.name.toUpperCase() : 'UNKNOWN';
    var amtX = W - pad;

    // === HEADER ===
    ctx.font = 'bold ' + (22*S) + 'px "Courier New", monospace';
    ctx.fillStyle = '#1c1c1e';
    ctx.fillText(supName, pad, y);
    y += LH * 0.9;

    ctx.font = (13*S) + 'px "Courier New", monospace';
    ctx.fillStyle = '#8e8e93';
    ctx.fillText(fmtDate(bill.date) + (bill.billNumber ? '  |  #' + bill.billNumber : ''), pad, y);
    y += LH * 1.2;

    // === THIN LINE after header ===
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y);
    ctx.strokeStyle = '#e5e5ea'; ctx.lineWidth = 1 * S; ctx.stroke();
    y += LH * 0.7;

    // === ITEMS (clean: name left, qty x rate middle, amount right) ===
    bill.items.forEach(function(item, i) {
        var name = item.name || 'Item ' + (i + 1);

        // Item name
        ctx.font = (15*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#1c1c1e';
        ctx.fillText(name, pad, y);

        // Qty x Rate (middle, grey)
        var detail = '';
        if (item.qty && item.rate) detail = item.qty + ' x \u20B9' + item.rate;
        else if (item.qty) detail = 'Qty: ' + item.qty;
        ctx.font = (13*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#8e8e93';
        var detailX = pad + (W - pad*2) * 0.42;
        ctx.fillText(detail, detailX, y);

        // Amount (right, bold)
        ctx.font = 'bold ' + (15*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#1c1c1e';
        var amt = '\u20B9' + Math.round(item.calculatedTotal).toLocaleString('en-IN');
        var aw = ctx.measureText(amt).width;
        ctx.fillText(amt, amtX - aw, y);

        y += LH;
    });

    // === LINE before total ===
    y += LH * 0.3;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y);
    ctx.strokeStyle = '#e5e5ea'; ctx.lineWidth = 1 * S; ctx.stroke();
    y += LH * 0.9;

    // === TOTAL ===
    ctx.font = 'bold ' + (17*S) + 'px "Courier New", monospace';
    ctx.fillStyle = '#34c759';
    ctx.fillText('TOTAL', pad, y);
    var totalAmt = '\u20B9' + bill.calculatedTotal.toFixed(2);
    var tw = ctx.measureText(totalAmt).width;
    ctx.fillText(totalAmt, amtX - tw, y);
    y += LH * 1.3;

    // === MISMATCH BOX ===
    if (bill.hasMismatch) {
        var diff = bill.calculatedTotal - bill.writtenTotal;
        var boxH = 4.2 * LH;

        // Pink background box
        ctx.fillStyle = '#fff5f5';
        ctx.fillRect(pad - 8*S, y - 8*S, W - pad*2 + 16*S, boxH);
        // Left red bar
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(pad - 8*S, y - 8*S, 4*S, boxH);

        y += LH * 0.5;

        // SHORT BY / EXCESS BY
        ctx.font = 'bold ' + (16*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#ff3b30';
        ctx.fillText((diff > 0 ? '\u26A0 EXCESS BY \u20B9' : '\u26A0 SHORT BY \u20B9') + Math.abs(Math.round(diff)).toLocaleString('en-IN'), pad + 10*S, y);
        y += LH;

        // Dealer vs calc
        ctx.font = (12*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#666';
        ctx.fillText("Dealer's total: \u20B9" + Math.round(bill.writtenTotal).toLocaleString('en-IN') + '  |  Calculated: \u20B9' + Math.round(bill.calculatedTotal).toLocaleString('en-IN'), pad + 10*S, y);
        y += LH;

        // Polite note
        ctx.font = 'italic ' + (12*S) + 'px "Courier New", monospace';
        ctx.fillStyle = '#888';
        ctx.fillText('Sir, please check once. Small difference in total.', pad + 10*S, y);
        y += LH * 0.7;
        ctx.fillText('Kindly verify. Thank you.', pad + 10*S, y);
        y += LH;
    }

    // === EXPORT ===
    var fH = y + pad;
    var fc = document.createElement('canvas');
    fc.width = W; fc.height = fH;
    var fctx = fc.getContext('2d');
    fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, fc.width, fH);
    fctx.drawImage(canvas, 0, 0);
    fc.toBlob(function(blob) {
        if (navigator.share && navigator.canShare) {
            try {
                var file = new File([blob], 'bill-' + (sup ? sup.name : 'x') + '-' + bill.date + '.png', {type:'image/png'});
                if (navigator.canShare({files:[file]})) { navigator.share({files:[file], title:'Bill'}).catch(function(){}); return; }
            } catch(e) {}
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'bill-' + (sup ? sup.name : 'x') + '-' + bill.date + '.png';
        a.click(); URL.revokeObjectURL(url);
        toast('Image saved!');
    }, 'image/png', 1.0);
}
function numberToWords(n) {
    if (n === 0) return 'Zero';
    var ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    var tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    function tw(num) { if (num < 20) return ones[num]; return tens[Math.floor(num/10)] + (num%10 ? ' ' + ones[num%10] : ''); }
    var w = '';
    if (n >= 10000000) { w += tw(Math.floor(n/10000000)) + ' Crore '; n %= 10000000; }
    if (n >= 100000) { w += tw(Math.floor(n/100000)) + ' Lakh '; n %= 100000; }
    if (n >= 1000) { w += tw(Math.floor(n/1000)) + ' Thousand '; n %= 1000; }
    if (n >= 100) { w += ones[Math.floor(n/100)] + ' Hundred '; n %= 100; }
    if (n > 0) w += tw(n);
    return w.trim();
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
    bills.sort((a, b) => new Date(a.date) - new Date(b.date));
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

// ===== VOICE ENTRY (Speech Recognition) =====
function startVoiceEntry() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        toast('Voice not supported on this browser');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    toast('🎤 Listening... say items');

    recognition.onresult = function(event) {
        const text = event.results[0][0].transcript;
        parseVoiceInput(text);
    };

    recognition.onerror = function() {
        toast('Could not hear. Try again.');
    };

    recognition.start();
}

function parseVoiceInput(text) {
    // Try to parse: "item qty rate, item qty rate"
    // Example: "LED backlight 10 380, remote 5 120"
    const parts = text.split(/[,;and]+/i);
    parts.forEach(function(part) {
        part = part.trim();
        if (!part) return;
        // Try to find numbers at the end
        var words = part.split(/\s+/);
        var nums = [];
        var nameParts = [];
        words.forEach(function(w) {
            var n = parseFloat(w.replace(/[^\d.]/g, ''));
            if (!isNaN(n) && w.match(/\d/)) nums.push(n);
            else nameParts.push(w);
        });
        var item = { name: nameParts.join(' ') || '', qty: '', unit: 'pcs', rate: '', total: '' };
        if (nums.length >= 2) { item.qty = String(nums[0]); item.rate = String(nums[1]); }
        else if (nums.length === 1) { item.qty = String(nums[0]); }
        if (item.name || item.qty) billState.items.push(item);
    });
    // Remove empty first row if exists
    if (billState.items.length > 1 && !billState.items[0].name && !billState.items[0].qty) {
        billState.items.shift();
    }
    toast('Added ' + parts.length + ' item(s) by voice');
    navigate('add-bill');
}

// ===== PHOTO ZOOM + ANNOTATE =====
function showPhotoZoom(photoSrc) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.background = 'rgba(0,0,0,0.9)';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.innerHTML = '<div class="zoom-container">' +
        '<img src="' + photoSrc + '" class="zoom-img" id="zoom-img" />' +
        '<div class="zoom-tools">' +
        '<button class="btn btn-sm btn-outline" id="zoom-circle" style="color:#fff;border-color:#fff">&#x1F534; Circle</button>' +
        '<button class="btn btn-sm btn-outline" id="zoom-close" style="color:#fff;border-color:#fff">Close</button>' +
        '</div></div>';
    document.body.appendChild(overlay);

    var annotating = false;
    overlay.querySelector('#zoom-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#zoom-circle').addEventListener('click', function() {
        annotating = !annotating;
        this.style.background = annotating ? '#dc2626' : 'transparent';
        toast(annotating ? 'Tap image to mark' : 'Marking off');
    });

    overlay.querySelector('#zoom-img').addEventListener('click', function(e) {
        if (!annotating) return;
        var rect = this.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var circle = document.createElement('div');
        circle.style.cssText = 'position:absolute;width:40px;height:40px;border:3px solid red;border-radius:50%;left:' + (x - 20) + 'px;top:' + (y - 20) + 'px;pointer-events:none;';
        this.parentElement.style.position = 'relative';
        this.parentElement.appendChild(circle);
    });
}

// ===== SPENDING CALENDAR =====
function renderCalendar() {
    var now = new Date();
    var year = screenParams.year || now.getFullYear();
    var month = screenParams.month !== undefined ? screenParams.month : now.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthName = new Date(year, month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    // Get spending per day
    var dayTotals = {};
    var maxSpend = 0;
    appData.bills.forEach(function(b) {
        var d = new Date(b.date);
        if (d.getFullYear() === year && d.getMonth() === month) {
            var day = d.getDate();
            dayTotals[day] = (dayTotals[day] || 0) + b.calculatedTotal;
            if (dayTotals[day] > maxSpend) maxSpend = dayTotals[day];
        }
    });

    var monthTotal = Object.values(dayTotals).reduce(function(s, v) { return s + v; }, 0);

    // Build calendar grid
    var cells = '';
    for (var i = 0; i < firstDay; i++) cells += '<div class="cal-cell empty"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
        var spent = dayTotals[d] || 0;
        var intensity = maxSpend > 0 ? Math.min(spent / maxSpend, 1) : 0;
        var cls = 'cal-cell';
        if (intensity > 0.7) cls += ' hot';
        else if (intensity > 0.3) cls += ' warm';
        else if (intensity > 0) cls += ' mild';
        cells += '<div class="' + cls + '" data-action="cal-day" data-day="' + d + '">' +
            '<span class="cal-day-num">' + d + '</span>' +
            (spent > 0 ? '<span class="cal-day-amt">' + (spent >= 1000 ? Math.round(spent / 1000) + 'k' : spent) + '</span>' : '') +
            '</div>';
    }

    return '<div class="screen-header">' +
        '<button class="back-btn" data-action="back">&#x2190;</button>' +
        '<h1>Calendar</h1><div></div></div>' +
        '<div class="cal-nav">' +
        '<button class="btn btn-ghost btn-sm" data-action="cal-prev">&#x25C0;</button>' +
        '<strong>' + monthName + '</strong>' +
        '<button class="btn btn-ghost btn-sm" data-action="cal-next">&#x25B6;</button>' +
        '</div>' +
        '<div class="cal-total">Month Total: <strong>' + fmt(monthTotal) + '</strong></div>' +
        '<div class="cal-grid">' +
        '<div class="cal-head">S</div><div class="cal-head">M</div><div class="cal-head">T</div><div class="cal-head">W</div><div class="cal-head">T</div><div class="cal-head">F</div><div class="cal-head">S</div>' +
        cells + '</div>';
}

// ===== EMAIL BACKUP =====
function emailBackup() {
    var data = JSON.stringify(appData, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var date = new Date().toISOString().split('T')[0];
    var subject = 'Bill Tracker Backup - ' + date;
    var body = 'Attached is your Bill Tracker backup from ' + date + '. Import this file to restore data.';

    // On mobile, mailto with attachment doesn't work well
    // Best approach: download + open mail app
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'bill-tracker-backup-' + date + '.json';
    a.click();
    URL.revokeObjectURL(url);

    // Open email compose
    setTimeout(function() {
        window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body + '\n\nNote: Attach the downloaded JSON file to this email.');
    }, 500);
    toast('Backup downloaded — attach to email');
}

// ===== QR SYNC (Offline to Offline) =====
function showQRSync() {
    // Generate a compact data summary as QR-compatible text
    var summary = {
        s: appData.suppliers.map(function(s) { return { n: s.name, b: getBalance(s.id) }; }),
        t: appData.bills.length,
        p: appData.payments.length,
        d: new Date().toISOString().split('T')[0]
    };
    var jsonStr = JSON.stringify(summary);

    // For full data transfer, we split into chunks and use a simpler approach
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-sheet">' +
        '<div class="modal-handle"></div>' +
        '<h3 style="margin-bottom:12px">Offline Sync via QR</h3>' +
        '<p class="fs-sm" style="color:var(--text-secondary);margin-bottom:16px">For full data transfer, use Backup/Restore (JSON file). QR shows a summary for quick verification.</p>' +
        '<div class="qr-display" id="qr-display"></div>' +
        '<div style="margin-top:12px">' +
        '<p class="fs-sm"><strong>Summary:</strong> ' + appData.suppliers.length + ' suppliers, ' + appData.bills.length + ' bills</p>' +
        '<p class="fs-sm" style="margin-top:8px"><strong>To fully sync:</strong></p>' +
        '<p class="fs-sm">1. On this device: More → Backup Data (downloads .json)</p>' +
        '<p class="fs-sm">2. Transfer file to other device (WhatsApp/Bluetooth/USB)</p>' +
        '<p class="fs-sm">3. On other device: More → Restore Data</p>' +
        '</div>' +
        '<button class="btn btn-ghost mt-16" id="close-qr">Close</button>' +
        '</div>';
    document.body.appendChild(overlay);

    // Generate simple QR using a canvas (basic QR-like visual)
    var qrDiv = overlay.querySelector('#qr-display');
    qrDiv.innerHTML = '<div style="background:#fff;padding:16px;border-radius:8px;text-align:center;">' +
        '<div style="font-family:monospace;font-size:10px;word-break:break-all;max-height:200px;overflow:auto;text-align:left;padding:8px;background:#f5f5f5;border-radius:4px;">' + jsonStr + '</div>' +
        '<p style="margin-top:8px;font-size:11px;color:#666">Copy this on other device → import</p></div>';

    overlay.querySelector('#close-qr').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
}

// ===== EXPORT PDF LEDGER =====
function exportPDFLedger() {
    // Ask which supplier or all
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal-sheet">' +
        '<div class="modal-handle"></div>' +
        '<h3 style="margin-bottom:12px">Export PDF Ledger</h3>' +
        '<div class="form-group" style="padding:0"><label>Supplier</label>' +
        '<select class="form-select" id="pdf-supplier">' +
        '<option value="all">All Suppliers</option>' +
        appData.suppliers.map(function(s) { return '<option value="' + s.id + '">' + s.name + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="form-group" style="padding:0"><label>Month (optional)</label>' +
        '<input class="form-input" type="month" id="pdf-month" value="' + new Date().toISOString().substring(0, 7) + '" /></div>' +
        '<div style="display:flex;gap:10px;margin-top:16px">' +
        '<button class="btn btn-primary" id="gen-pdf">Generate PDF</button>' +
        '<button class="btn btn-ghost" id="close-pdf">Cancel</button>' +
        '</div></div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#close-pdf').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#gen-pdf').addEventListener('click', function() {
        var supId = document.getElementById('pdf-supplier').value;
        var monthStr = document.getElementById('pdf-month').value;
        overlay.remove();
        generatePDFLedger(supId, monthStr);
    });
}

function generatePDFLedger(supId, monthStr) {
    var S = 2;
    var W = 800 * S;
    var pad = 50 * S;
    var LH = 24 * S;

    // Filter data
    var suppliers = supId === 'all' ? appData.suppliers : appData.suppliers.filter(function(s) { return s.id === supId; });
    var monthFilter = monthStr ? monthStr : null;

    var allRows = [];
    suppliers.forEach(function(sup) {
        var ledger = getRunningLedger(sup.id);
        if (monthFilter) {
            ledger = ledger.filter(function(e) { return e.date && e.date.startsWith(monthFilter); });
        }
        if (ledger.length > 0) {
            allRows.push({ type: 'header', name: sup.name, balance: getBalance(sup.id) });
            ledger.forEach(function(e) { allRows.push(e); });
            allRows.push({ type: 'separator' });
        }
    });

    if (allRows.length === 0) { toast('No data for this period'); return; }

    var totalLines = 8 + allRows.length * 1.2;
    var H = Math.max(totalLines * LH + pad * 2, 400 * S);

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    var y = pad;

    function setF(size, bold) { ctx.font = (bold ? 'bold ' : '') + size + 'px "Courier New", monospace'; }
    function drawL(thick) { ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.strokeStyle = '#000'; ctx.lineWidth = (thick ? 2.5 : 1) * S; ctx.stroke(); y += LH * 0.5; }

    function txt(t, bold, color) {
        setF(14 * S, bold);
        ctx.fillStyle = color || '#111';
        ctx.fillText(t, pad, y);
        y += LH;
    }

    function txtLR(l, r, bold) {
        setF(14 * S, bold);
        ctx.fillStyle = '#111';
        ctx.fillText(l, pad, y);
        var w = ctx.measureText(r).width;
        ctx.fillText(r, W - pad - w, y);
        y += LH;
    }

    // Title
    setF(16 * S, true); ctx.fillStyle = '#111';
    var title = 'LEDGER STATEMENT';
    var tw = ctx.measureText(title).width;
    ctx.fillText(title, (W - tw) / 2, y); y += LH * 1.3;
    txt('Period: ' + (monthFilter || 'All Time'));
    drawL(true);
    txtLR('Date        Type      Amount', 'Balance', true);
    drawL(false);

    allRows.forEach(function(row) {
        if (row.type === 'header') {
            y += LH * 0.3;
            txt('[ ' + row.name.toUpperCase() + ' ]  Balance: Rs.' + Math.round(row.balance), true);
            drawL(true);
        } else if (row.type === 'separator') {
            y += LH * 0.3;
        } else {
            var d = row.date ? fmtDateShort(row.date).padEnd(12) : '            ';
            var tp = (row.type === 'bill' ? 'BILL' : 'PAID').padEnd(10);
            var amt = ((row.type === 'bill' ? '+' : '-') + Math.round(row.amount)).padStart(10);
            var bal = String(Math.round(row.balance));
            setF(14 * S, false);
            ctx.fillStyle = row.type === 'bill' ? '#111' : '#059669';
            ctx.fillText(d + tp + amt, pad, y);
            var bw = ctx.measureText(bal).width;
            ctx.fillText(bal, W - pad - bw, y);
            y += LH;
        }
    });

    drawL(true);
    txt('Generated: ' + new Date().toLocaleDateString('en-IN'));

    // Crop and export
    var fH = y + pad;
    var fc = document.createElement('canvas');
    fc.width = W; fc.height = fH;
    var fctx = fc.getContext('2d');
    fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, fc.width, fH);
    fctx.drawImage(canvas, 0, 0);

    fc.toBlob(function(blob) {
        if (navigator.share && navigator.canShare) {
            try {
                var file = new File([blob], 'ledger-' + (monthStr || 'all') + '.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file], title: 'Ledger' }).catch(function() {});
                    return;
                }
            } catch (e) {}
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'ledger-' + (monthStr || 'all') + '.png';
        a.click(); URL.revokeObjectURL(url);
        toast('Ledger PDF saved!');
    }, 'image/png', 1.0);
}

// ===== CALENDAR NAV ACTIONS =====
function handleCalendarAction(action, dataset) {
    var now = new Date();
    var year = screenParams.year || now.getFullYear();
    var month = screenParams.month !== undefined ? screenParams.month : now.getMonth();

    if (action === 'cal-prev') {
        month--;
        if (month < 0) { month = 11; year--; }
        navigate('calendar', { year: year, month: month });
    } else if (action === 'cal-next') {
        month++;
        if (month > 11) { month = 0; year++; }
        navigate('calendar', { year: year, month: month });
    } else if (action === 'cal-day') {
        var day = parseInt(dataset.day);
        var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        var dayBills = appData.bills.filter(function(b) { return b.date === dateStr; });
        if (dayBills.length > 0) {
            toast(dayBills.length + ' bill(s) on ' + fmtDate(dateStr) + ' = ' + fmt(dayBills.reduce(function(s, b) { return s + b.calculatedTotal; }, 0)));
        }
    }
}

// ===== INIT =====
render();
initDataRecovery();
