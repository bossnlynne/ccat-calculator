// =============================================
// 貓咪名字資料庫（雲端同步）
// =============================================
const API_BASE = 'https://ccat-cats-api.ccat-lynne.workers.dev';
const CATS_API = `${API_BASE}/cats`;
const SETTINGS_API = `${API_BASE}/settings`;
const AUTH_API = `${API_BASE}/auth`;
const OFFICIAL_HOLIDAYS_API = `${API_BASE}/official-holidays`;
let _cats = [];
let _catsRevision = 'none';
let _settingsRevision = 'none';
let _selectedCats = new Set();
let _catCountFilter = 0;
let _catSearch = '';
let _catSort = localStorage.getItem('ccat_sort') || 'default';
let _quoteIsCurrent = false;
let _allowUnlistedCat = '';

function invalidateQuote() {
    if (!document.getElementById('resultArea')?.innerHTML) return;
    _quoteIsCurrent = false;
    document.getElementById('actionButtons').style.display = 'none';
    document.getElementById('quoteStaleNotice').style.display = 'block';
}

function getCatCount(name) { return name.split('/').length; }

function normalizeCats(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(c => c && (typeof c === 'string' ? true : typeof c.name === 'string' && c.name))
        .map(c => {
            if (typeof c === 'string') return { name: c, fees: [] };
            if (!Array.isArray(c.fees)) return { name: c.name, fees: c.fee > 0 ? [{ caretaker: '', fee: c.fee }] : [] };
            return c;
        });
}

function getFilteredSortedCats() {
    let result = [..._cats];
    if (_catSearch) result = result.filter(c => c.name.toLowerCase().includes(_catSearch.toLowerCase()));
    if (_catCountFilter > 0) {
        result = _catCountFilter === 99
            ? result.filter(c => getCatCount(c.name) >= 4)
            : result.filter(c => getCatCount(c.name) === _catCountFilter);
    }
    if (_catSort === 'count') result.sort((a, b) => getCatCount(a.name) - getCatCount(b.name));
    else if (_catSort === 'strokes') result.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW-u-co-stroke'));
    return result;
}

async function loadCatsFromCloud() {
    try {
        const res = await fetch(CATS_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _catsRevision = res.headers.get('X-Data-Version') || 'legacy';
        _cats = normalizeCats(await res.json());
    } catch(e) {
        try { _cats = normalizeCats(JSON.parse(localStorage.getItem('ccat_cats') || '[]')); } catch(_) {}
        showToast('雲端名單連線失敗，已使用本機資料');
    }
    // 初始化排序 select
    const sortSel = document.getElementById('catSortSelect');
    if (sortSel) sortSel.value = _catSort;
    renderCatList();
    refreshCatDatalist();
}

function getCats() { return _cats; }

async function saveCats(nextCats = _cats) {
    try {
        const res = await fetch(CATS_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Data-Version': _catsRevision,
            },
            body: JSON.stringify(nextCats),
        });
        if (res.status === 409) {
            await loadCatsFromCloud();
            showToast('名單已被其他管理師更新，已載入最新版');
            return false;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _catsRevision = res.headers.get('X-Data-Version') || (await res.json()).revision || _catsRevision;
        _cats = nextCats;
        localStorage.setItem('ccat_cats', JSON.stringify(_cats));
        return true;
    } catch(e) {
        console.warn('雲端儲存失敗，已還原雲端版本', e);
        await loadCatsFromCloud();
        showToast('雲端同步失敗，未套用這次變更');
        return false;
    }
}

async function verifyAdminKey(key) {
    if (!key) return false;
    try {
        const res = await fetch(AUTH_API, { method: 'POST', headers: { 'X-Admin-Key': key } });
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function ensureAdminAuth() {
    const saved = sessionStorage.getItem('admin_key') || '';
    if (saved && await verifyAdminKey(saved)) return saved;
    sessionStorage.removeItem('admin_key');
    const entered = prompt('請輸入管理密碼以同步變更');
    if (!entered) return '';
    if (!(await verifyAdminKey(entered))) {
        showToast('管理密碼錯誤或雲端暫時無法連線');
        return '';
    }
    sessionStorage.setItem('admin_key', entered);
    return entered;
}

function refreshCatDatalist() {
    const dl = document.getElementById('catList');
    dl.innerHTML = '';
    _cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        dl.appendChild(opt);
    });
}

// ── Toast ──
let _toastTimer = null;
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Cat Edit Drawer ──
let _drawerCatName = null;
let _drawerReturnFocus = null;

function addDrawerFeeRow(caretaker = '', fee = '') {
    const list = document.getElementById('catDrawerFeeList');
    const row = document.createElement('div');
    row.className = 'drawer-fee-row';
    const caretakerInput = document.createElement('input');
    caretakerInput.type = 'text';
    caretakerInput.className = 'fee-caretaker';
    caretakerInput.placeholder = '管理師名字';
    caretakerInput.value = caretaker || '';

    const feeInput = document.createElement('input');
    feeInput.type = 'number';
    feeInput.className = 'fee-amount';
    feeInput.placeholder = '費用';
    feeInput.min = '0';
    feeInput.value = fee || '';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-sm btn-danger-sm';
    deleteBtn.style.padding = '4px 8px';
    deleteBtn.title = '刪除';
    deleteBtn.type = 'button';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => row.remove());

    row.append(caretakerInput, feeInput, deleteBtn);
    list.appendChild(row);
}

function openCatDrawer(name, createNew = false) {
    _drawerReturnFocus = document.activeElement;
    _drawerCatName = createNew ? null : name;
    document.getElementById('catDrawerTitle').textContent = createNew ? '新增貓咪與交通費' : '編輯貓咪名字';
    document.getElementById('catDrawerCurrent').textContent = name;
    document.getElementById('catDrawerInput').value = name;
    const cat = createNew ? null : _cats.find(c => c.name === name);
    const list = document.getElementById('catDrawerFeeList');
    list.innerHTML = '';
    (cat && cat.fees || []).forEach(f => addDrawerFeeRow(f.caretaker, f.fee || ''));
    document.getElementById('catDrawerOverlay').classList.add('open');
    document.getElementById('catDrawer').classList.add('open');
    document.getElementById('catDrawer').setAttribute('aria-hidden', 'false');
    setTimeout(() => { const i = document.getElementById('catDrawerInput'); i.focus(); i.select(); }, 260);
}

function closeCatDrawer() {
    document.getElementById('catDrawerOverlay').classList.remove('open');
    document.getElementById('catDrawer').classList.remove('open');
    document.getElementById('catDrawer').setAttribute('aria-hidden', 'true');
    _drawerCatName = null;
    if (_drawerReturnFocus && document.contains(_drawerReturnFocus)) _drawerReturnFocus.focus();
    _drawerReturnFocus = null;
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('catDrawer').classList.contains('open')) closeCatDrawer();
});

async function saveCatDrawer() {
    const newName = document.getElementById('catDrawerInput').value.replace(/\s/g, '').trim();
    if (!newName) { alert('名字不可為空'); return; }
    const newFees = Array.from(document.querySelectorAll('#catDrawerFeeList .drawer-fee-row')).map(row => ({
        caretaker: row.querySelector('.fee-caretaker').value.trim(),
        fee: parseInt(row.querySelector('.fee-amount').value) || 0,
    })).filter(f => f.caretaker || f.fee > 0);
    const idx = _drawerCatName === null ? -1 : _cats.findIndex(c => c.name === _drawerCatName);
    if (newName !== _drawerCatName && _cats.find(c => c.name === newName)) {
        showToast('「' + newName + '」已存在'); return;
    }
    const nextCats = idx === -1
        ? [..._cats, { name: newName, fees: newFees }]
        : _cats.map((cat, index) => index === idx ? { name: newName, fees: newFees } : cat);
    if (!(await saveCats(nextCats))) return;
    renderCatList();
    if (document.getElementById('catNames').value.replace(/\s/g, '') === newName) {
        const names = newName.split('/').filter(Boolean);
        document.getElementById('catNameStatus').textContent = `已辨識：${names.join('、')}，共 ${names.length} 隻`;
        _allowUnlistedCat = '';
    }
    closeCatDrawer();
}

function renderCatList() {
    const container = document.getElementById('catGrid');
    if (!container) return;
    const filtered = getFilteredSortedCats();

    // selection bar
    const selBar = document.getElementById('catSelectionBar');
    selBar.style.display = _selectedCats.size > 0 ? 'flex' : 'none';
    document.getElementById('catSelCount').textContent = _selectedCats.size;

    container.innerHTML = '';
    filtered.forEach(cat => {
        const name = cat.name;
        const fees = cat.fees || [];
        const feeLabel = fees.filter(f => f.fee > 0).map(f => (f.caretaker ? f.caretaker + ' ' : '') + '$' + f.fee).join(' / ') || '—';
        const isSelected = _selectedCats.has(name);
        const card = document.createElement('div');
        card.className = 'cat-card' + (isSelected ? ' selected' : '');

        const label = document.createElement('label');
        label.className = 'cat-card-label';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'cat-card-checkbox';
        checkbox.checked = isSelected;
        checkbox.addEventListener('change', () => toggleCatSelect(name, checkbox.checked));

        const nameSpan = document.createElement('span');
        nameSpan.className = 'cat-card-name';
        nameSpan.title = name;
        nameSpan.textContent = name;
        nameSpan.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openCatDrawer(name);
        });

        const feeSpan = document.createElement('span');
        feeSpan.className = 'cat-card-fee';
        feeSpan.title = '點擊編輯交通費';
        feeSpan.textContent = feeLabel;
        feeSpan.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openCatDrawer(name);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'cat-card-del';
        deleteBtn.title = '刪除';
        deleteBtn.type = 'button';
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', () => removeCat(name));

        label.append(checkbox, nameSpan);
        card.append(label, feeSpan, deleteBtn);
        container.appendChild(card);
    });
    refreshCatDatalist();
}

function toggleCatSelect(name, checked) {
    if (checked) _selectedCats.add(name); else _selectedCats.delete(name);
    renderCatList();
}

function selectAllCats() {
    getFilteredSortedCats().forEach(c => _selectedCats.add(c.name));
    renderCatList();
}

function clearCatSelection() { _selectedCats.clear(); renderCatList(); }

async function batchDeleteCats() {
    if (_selectedCats.size === 0) return;
    if (!confirm(`確定刪除已選的 ${_selectedCats.size} 筆？`)) return;
    const nextCats = _cats.filter(c => !_selectedCats.has(c.name));
    if (!(await saveCats(nextCats))) return;
    _selectedCats.clear();
    renderCatList();
}

function setCatSearch(val) { _catSearch = val; renderCatList(); }
function setCatCountFilter(val) { _catCountFilter = parseInt(val); renderCatList(); }
function setCatSort(val) { _catSort = val; localStorage.setItem('ccat_sort', val); renderCatList(); }

function toggleCatAddRow() {
    const row = document.getElementById('catAddRow');
    const isHidden = row.style.display === 'none' || row.style.display === '';
    row.style.display = isHidden ? 'block' : 'none';
    if (isHidden) document.getElementById('catNewInput').focus();
}

async function addCatEntry(name) {
    const val = (name !== undefined ? name : document.getElementById('catNewInput').value).replace(/\s/g, '').trim();
    if (!val) return;
    if (_cats.find(c => c.name === val)) {
        showToast('「' + val + '」已存在');
        return;
    }
    const nextCats = [..._cats, { name: val, fees: [] }];
    if (!(await saveCats(nextCats))) return;
    if (name === undefined) {
        document.getElementById('catNewInput').value = '';
        document.getElementById('catAddRow').style.display = 'none';
        setTimeout(() => openCatDrawer(val), 100);
    }
    renderCatList();
}

function importCatsFromCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        const lines = e.target.result.split(/\r?\n/);
        let added = 0;
        const nextCats = [..._cats];
        lines.forEach((line, idx) => {
            const cols = line.split(',');
            const field = cols[0].replace(/^"|"$/g, '').replace(/\s/g, '').trim();
            if (!field) return;
            if (idx === 0 && /名字|name|cat|貓/i.test(field)) return;
            const fee = parseInt(cols[1]) || 0;
            if (!nextCats.find(c => c.name === field)) { nextCats.push({ name: field, fees: fee > 0 ? [{ caretaker: '', fee }] : [] }); added++; }
        });
        if (added === 0) {
            input.value = '';
            alert('沒有可新增的資料');
            return;
        }
        if (!(await saveCats(nextCats))) return;
        renderCatList();
        input.value = '';
        alert(`✅ 匯入完成！新增 ${added} 筆，共 ${_cats.length} 筆。`);
    };
    reader.readAsText(file, 'UTF-8');
}

async function removeCat(name) {
    const nextCats = _cats.filter(c => c.name !== name);
    if (!(await saveCats(nextCats))) return;
    _selectedCats.delete(name);
    renderCatList();
}

function downloadCatTemplate() {
    const csv = '﻿名字,交通費\n跳跳/白木,150\n咪咪,\n橘子/花花/豆豆,100\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ccat_cats_template.csv';
    a.click();
}

// =============================================
// 預設值
// =============================================
const DEFAULT_COPY_TEXT = `付款方式：
1. 轉帳或刷卡：https://core.newebpay.com/EPG/cmeow/4h3YZI
2. LINE PAY MONEY
👉請搜尋電話0953770112，加入好友，並打開對話，左下+選擇手機轉帳選LINE PAY MONEY

若您的外出計畫有更動 提醒您退費方式：
🔺「當日」取消將不予以退費
🔺「前一日」取消可退費 10%
🔺「前七日內」取消可退費 50%
🔺「八日以上」取消可全額退費

🌟請參考 熙貓樂園-管理契約，委託人務必詳閱內容!謝謝
👉https://reurl.cc/WLYE59`;

const DEFAULTS = {
    ratePeriods: [
        { name: '2025 費率', start: '2025-01-01', end: '2025-12-31', rate1: 880, rate2: 1540, rate3: 2400, status: 'archived' },
        { name: '2026 費率', start: '2026-01-01', end: '2026-12-31', rate1: 880, rate2: 1540, rate3: 2400, status: 'active' },
    ],
    special1: 1400, special2: 2500, special3: 3800,
    transportTiers: { base: 50, t10: 100, t15: 150, t20: 200 },
    holidayFee: 150,
    multiCatFee: 150,
    specialStart: '2026-02-14',
    specialEnd:   '2026-02-22',
    holidayRanges: [
        { name: '元旦',     start: '2025-12-31', end: '2026-01-02' },
        { name: '春節',     start: '2026-02-26', end: '2026-03-02' },
        { name: '兒童節',   start: '2026-04-02', end: '2026-04-07' },
        { name: '勞動節',   start: '2026-04-30', end: '2026-05-04' },
        { name: '端午節',   start: '2026-06-18', end: '2026-06-22' },
        { name: '中秋節',   start: '2026-09-24', end: '2026-09-29' },
        { name: '國慶日',   start: '2026-10-08', end: '2026-10-12' },
        { name: '重陽節',   start: '2026-10-23', end: '2026-10-27' },
        { name: '聖誕連假', start: '2026-12-24', end: '2026-12-28' },
    ],
    copyText: DEFAULT_COPY_TEXT,
};

let _settingsCache = null;

// =============================================
// 設定讀取
// =============================================
function getSettings() {
    if (_settingsCache) return _settingsCache;
    try {
        const saved = JSON.parse(localStorage.getItem('ccat_settings') || '{}');
        _settingsCache = normalizeSettings(Object.assign({}, DEFAULTS, saved));
    } catch (e) {
        _settingsCache = normalizeSettings(Object.assign({}, DEFAULTS));
    }
    return _settingsCache;
}

function normalizeSettings(settings) {
    const today = new Date().toISOString().split('T')[0];
    return {
        ...settings,
        ratePeriods: (settings.ratePeriods || []).map(p => ({ ...p, status: p.status || (p.end < today ? 'archived' : 'active') })),
        holidayRanges: (settings.holidayRanges || []).map(r => ({ ...r, status: r.status || (r.end < today ? 'archived' : 'active') })),
    };
}

async function loadSettingsFromCloud() {
    try {
        const res = await fetch(SETTINGS_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _settingsRevision = res.headers.get('X-Data-Version') || 'none';
        const cloud = await res.json();
        _settingsCache = normalizeSettings(Object.assign({}, DEFAULTS, cloud));
        localStorage.setItem('ccat_settings', JSON.stringify(_settingsCache));
        return true;
    } catch (error) {
        _settingsCache = null;
        getSettings();
        showToast('共用設定連線失敗，已使用此裝置快取');
        return false;
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// 依日期找對應費率分期，回傳 { name, rates:{1,2,3} }
function getRateForDate(dateObj) {
    const ymd = dateObj.toISOString().split('T')[0];
    const periods = [...(getSettings().ratePeriods || [])].filter(p => p.status !== 'draft').sort((a, b) => a.start.localeCompare(b.start));
    for (const p of periods) {
        if (ymd >= p.start && ymd <= p.end)
            return { name: p.name, rates: { 1: p.rate1, 2: p.rate2, 3: p.rate3 } };
    }
    // 晚於最後一期時沿用最近一期；早於第一期時沿用第一期。
    if (periods.length > 0) {
        const p = ymd > periods[periods.length - 1].end ? periods[periods.length - 1] : periods[0];
        return { name: p.name, rates: { 1: p.rate1, 2: p.rate2, 3: p.rate3 } };
    }
    return { name: '基本費率', rates: { 1: 880, 2: 1540, 3: 2400 } };
}

// =============================================
// 日期判斷
// =============================================
function isSpecialDate(dateObj) {
    const ymd = dateObj.toISOString().split('T')[0];
    const s = getSettings();
    return ymd >= s.specialStart && ymd <= s.specialEnd;
}

function getHolidayInfo(dateObj) {
    if (isSpecialDate(dateObj)) return false;
    const ymd = dateObj.toISOString().split('T')[0];
    for (const r of getSettings().holidayRanges) {
        if (r.status !== 'draft' && ymd >= r.start && ymd <= r.end) {
            let reason = r.name || '假日計費';
            if (r.officialStart && ymd < r.officialStart) reason = '連假前一天';
            else if (r.officialEnd && ymd > r.officialEnd) reason = '連假後一天';
            else if (r.source === 'dgpa') reason = `國定假日${r.name ? `：${r.name}` : ''}`;
            return { range: r, reason };
        }
    }
    return null;
}

function isHoliday(dateObj) { return Boolean(getHolidayInfo(dateObj)); }

// =============================================
// 分頁切換
// =============================================
function switchTab(name, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    btn.classList.add('active');
    if (name === 'settings' && sessionStorage.getItem('settings_unlocked') === '1') showSettingsContent();
}

// =============================================
// 設定頁：密碼鎖
// =============================================
async function unlockSettings() {
    const password = document.getElementById('lockPassword').value;
    if (await verifyAdminKey(password)) {
        sessionStorage.setItem('admin_key', password);
        sessionStorage.setItem('settings_unlocked', '1');
        document.getElementById('lockError').textContent = '';
        showSettingsContent();
    } else {
        document.getElementById('lockError').textContent = '密碼錯誤或雲端暫時無法連線';
        document.getElementById('lockPassword').value = '';
    }
}

function lockSettings() {
    sessionStorage.removeItem('settings_unlocked');
    sessionStorage.removeItem('admin_key');
    document.getElementById('settings-lock').style.display = '';
    document.getElementById('settings-content').style.display = 'none';
    document.getElementById('lockPassword').value = '';
    document.getElementById('lockError').textContent = '';
}

function showSettingsContent() {
    document.getElementById('settings-lock').style.display = 'none';
    document.getElementById('settings-content').style.display = 'block';
    populateSettingsForm();
}

// =============================================
// 設定頁：表單填入
// =============================================
function populateSettingsForm() {
    const s = getSettings();
    const t = s.transportTiers || DEFAULTS.transportTiers;
    document.getElementById('s_tBase').value = t.base;
    document.getElementById('s_t10').value  = t.t10;
    document.getElementById('s_t15').value  = t.t15;
    document.getElementById('s_t20').value  = t.t20;
    document.getElementById('s_special1').value    = s.special1;
    document.getElementById('s_special2').value    = s.special2;
    document.getElementById('s_special3').value    = s.special3;
    document.getElementById('s_holidayFee').value  = s.holidayFee;
    document.getElementById('s_multiCatFee').value = s.multiCatFee;
    document.getElementById('s_specialStart').value = s.specialStart;
    document.getElementById('s_specialEnd').value   = s.specialEnd;
    document.getElementById('s_copyText').value     = s.copyText || DEFAULT_COPY_TEXT;

    // 費率分期
    const list = document.getElementById('ratePeriodList');
    list.innerHTML = '';
    (s.ratePeriods || []).forEach(p => addRatePeriodCard(p.name, p.start, p.end, p.rate1, p.rate2, p.rate3, p.status));

    // 假日清單
    const hList = document.getElementById('holidayRangeList');
    hList.innerHTML = '';
    (s.holidayRanges || []).forEach(r => addHolidayRow(r.name, r.start, r.end, r.status, r));
}

// =============================================
// 費率分期卡片
// =============================================
function addRatePeriodCard(name='', start='', end='', rate1='', rate2='', rate3='', status='draft') {
    const list = document.getElementById('ratePeriodList');
    const card = document.createElement('div');
    card.className = `rate-period-card${status === 'archived' ? ' is-archived' : ''}`;
    card.dataset.status = status;
    card.innerHTML = `
        <div class="card-top">
            <div class="period-name">
                <input type="text" placeholder="費率名稱（例如：2026費率）" value="${escapeHtml(name)}">
            </div>
            <div class="period-dates">
                <input type="date" value="${escapeHtml(start)}" title="生效起始日">
                <span class="period-dash">—</span>
                <input type="date" value="${escapeHtml(end)}" title="生效結束日">
            </div>
            <span class="status-badge ${status}">${status === 'archived' ? '已封存' : status === 'draft' ? '草稿' : '使用中'}</span>
            <button class="btn-sm btn-ghost-sm" onclick="toggleArchive(this.closest('.rate-period-card'))">${status === 'archived' ? '解除封存' : status === 'draft' ? '啟用' : '封存'}</button>
        </div>
        <div class="card-rates">
            <div>
                <label>1 次 / 天</label>
                <input type="number" value="${escapeHtml(rate1)}" min="0" placeholder="例如 880">
            </div>
            <div>
                <label>2 次 / 天</label>
                <input type="number" value="${escapeHtml(rate2)}" min="0" placeholder="例如 1540">
            </div>
            <div>
                <label>3 次 / 天</label>
                <input type="number" value="${escapeHtml(rate3)}" min="0" placeholder="例如 2400">
            </div>
        </div>
    `;
    setCardDisabled(card, status === 'archived');
    list.appendChild(card);
}

function setCardDisabled(card, disabled) { card.querySelectorAll('input').forEach(input => { input.disabled = disabled; }); }

function toggleArchive(card) {
    const current = card.dataset.status;
    if (current === 'archived' && !confirm('確定解除封存？解除後即可修改這筆歷史資料。')) return;
    const next = current === 'draft' ? 'active' : current === 'active' ? 'archived' : 'active';
    card.dataset.status = next;
    card.classList.toggle('is-archived', next === 'archived');
    setCardDisabled(card, next === 'archived');
    const badge = card.querySelector('.status-badge');
    badge.className = `status-badge ${next}`;
    badge.textContent = next === 'archived' ? '已封存' : '使用中';
    card.querySelector('button').textContent = next === 'archived' ? '解除封存' : '封存';
}

function copyLatestRateToNextYear() {
    const periods = collectRatePeriods();
    if (!periods.length) return addRatePeriodCard();
    const latest = [...periods].sort((a, b) => b.end.localeCompare(a.end))[0];
    const year = Number(latest.end.slice(0, 4)) + 1;
    addRatePeriodCard(`${year} 費率`, `${year}-01-01`, `${year}-12-31`, latest.rate1, latest.rate2, latest.rate3, 'draft');
}

function collectRatePeriods() {
    return Array.from(document.querySelectorAll('.rate-period-card')).map(card => {
        const inputs = card.querySelectorAll('input');
        return {
            name:  inputs[0].value.trim() || '費率',
            start: inputs[1].value,
            end:   inputs[2].value,
            rate1: parseInt(inputs[3].value) || 0,
            rate2: parseInt(inputs[4].value) || 0,
            rate3: parseInt(inputs[5].value) || 0,
            status: card.dataset.status || 'draft',
        };
    }).filter(p => p.start && p.end);
}

// =============================================
// 假日清單
// =============================================
function addHolidayRow(name='', start='', end='', status='active', metadata={}) {
    const list = document.getElementById('holidayRangeList');
    const row = document.createElement('div');
    row.className = `holiday-row${status === 'archived' ? ' is-archived' : ''}`;
    row.dataset.status = status;
    row.dataset.source = metadata.source || 'manual';
    row.dataset.officialStart = metadata.officialStart || '';
    row.dataset.officialEnd = metadata.officialEnd || '';
    row.innerHTML = `
        <div class="holiday-name">
            <input type="text" placeholder="假日名稱" value="${escapeHtml(name)}">
        </div>
        <div class="holiday-date">
            <input type="date" value="${escapeHtml(start)}">
        </div>
        <span class="holiday-dash">—</span>
        <div class="holiday-date">
            <input type="date" value="${escapeHtml(end)}">
        </div>
        <span class="status-badge ${status}">${status === 'archived' ? '已封存' : status === 'draft' ? '草稿' : '使用中'}</span>
        <button class="btn-sm btn-ghost-sm" onclick="toggleArchive(this.closest('.holiday-row'))">${status === 'archived' ? '解除封存' : status === 'draft' ? '啟用' : '封存'}</button>
    `;
    setCardDisabled(row, status === 'archived');
    list.appendChild(row);
}

function collectHolidayRanges() {
    return Array.from(document.querySelectorAll('#holidayRangeList .holiday-row')).map(row => {
        const inputs = row.querySelectorAll('input');
        return {
            name: inputs[0].value.trim(), start: inputs[1].value, end: inputs[2].value,
            status: row.dataset.status || 'active', source: row.dataset.source || 'manual',
            officialStart: row.dataset.officialStart || undefined, officialEnd: row.dataset.officialEnd || undefined,
        };
    }).filter(r => r.start && r.end);
}

function shiftYmd(ymd, days) {
    const date = new Date(`${ymd}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

let _officialHolidayPreview = [];
async function previewOfficialHolidays() {
    const year = Number(document.getElementById('holidayImportYear').value);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return alert('請輸入有效的西元年份');
    const box = document.getElementById('holidayImportPreview');
    box.style.display = 'block';
    box.textContent = '正在讀取人事行政總處資料…';
    try {
        const response = await fetch(`${OFFICIAL_HOLIDAYS_API}?year=${year}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        _officialHolidayPreview = data.holidays.map(item => ({
            name: item.name,
            start: shiftYmd(item.officialStart, -1),
            end: shiftYmd(item.officialEnd, 1),
            officialStart: item.officialStart,
            officialEnd: item.officialEnd,
            source: 'dgpa',
            status: 'active',
        }));
        if (!_officialHolidayPreview.length) throw new Error('沒有找到國定假日');
        box.innerHTML = `<strong>${year} 年匯入預覽</strong><br>${_officialHolidayPreview.map(item =>
            `${escapeHtml(item.name)}：${item.start}～${item.end}（官方 ${item.officialStart}～${item.officialEnd}）`
        ).join('<br>')}<div style="margin-top:10px"><button class="btn-sm btn-primary-sm" onclick="confirmOfficialHolidayImport()">確認加入</button> <button class="btn-sm btn-ghost-sm" onclick="cancelOfficialHolidayImport()">取消</button></div>`;
    } catch (error) {
        _officialHolidayPreview = [];
        box.textContent = `官方資料讀取失敗：${error.message}`;
    }
}

function confirmOfficialHolidayImport() {
    const existing = collectHolidayRanges();
    let added = 0;
    _officialHolidayPreview.forEach(item => {
        const duplicate = existing.some(range => range.source === 'dgpa' && range.officialStart === item.officialStart && range.officialEnd === item.officialEnd);
        if (!duplicate) { addHolidayRow(item.name, item.start, item.end, item.status, item); added += 1; }
    });
    cancelOfficialHolidayImport();
    showToast(`已加入 ${added} 筆，請按「儲存設定」同步`);
}

function cancelOfficialHolidayImport() {
    _officialHolidayPreview = [];
    const box = document.getElementById('holidayImportPreview');
    box.style.display = 'none';
    box.innerHTML = '';
}

// =============================================
// 設定頁：儲存
// =============================================
async function saveSettings() {
    const s = {
        ratePeriods:  collectRatePeriods(),
        transportTiers: {
            base: parseInt(document.getElementById('s_tBase').value) || 0,
            t10:  parseInt(document.getElementById('s_t10').value)  || 0,
            t15:  parseInt(document.getElementById('s_t15').value)  || 0,
            t20:  parseInt(document.getElementById('s_t20').value)  || 0,
        },
        special1:     parseInt(document.getElementById('s_special1').value) || 0,
        special2:     parseInt(document.getElementById('s_special2').value) || 0,
        special3:     parseInt(document.getElementById('s_special3').value) || 0,
        holidayFee:   parseInt(document.getElementById('s_holidayFee').value) || 0,
        multiCatFee:  parseInt(document.getElementById('s_multiCatFee').value) || 0,
        specialStart: document.getElementById('s_specialStart').value,
        specialEnd:   document.getElementById('s_specialEnd').value,
        holidayRanges: collectHolidayRanges(),
        copyText:     document.getElementById('s_copyText').value,
    };

    if (!s.ratePeriods.length) {
        alert('請至少保留一組有效的費率期間');
        return;
    }
    if (s.ratePeriods.some(p => p.start > p.end)) {
        alert('費率期間的結束日期不可早於開始日期');
        return;
    }
    const sortedPeriods = [...s.ratePeriods].sort((a, b) => a.start.localeCompare(b.start));
    if (sortedPeriods.some((p, i) => i > 0 && p.start <= sortedPeriods[i - 1].end)) {
        alert('費率期間不可重疊，請檢查日期');
        return;
    }
    if (!s.specialStart || !s.specialEnd || s.specialStart > s.specialEnd) {
        alert('請填寫有效的春節起迄日期');
        return;
    }
    if (s.holidayRanges.some(r => r.start > r.end)) {
        alert('假日期間的結束日期不可早於開始日期');
        return;
    }

    const adminKey = await ensureAdminAuth();
    if (!adminKey) return;

    let res;
    try {
        res = await fetch(SETTINGS_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': adminKey,
                'X-Data-Version': _settingsRevision,
            },
            body: JSON.stringify(s),
        });
    } catch (_) {
        alert('雲端設定連線失敗，這次變更尚未儲存');
        return;
    }

    if (res.status === 401) {
        sessionStorage.removeItem('admin_key');
        sessionStorage.removeItem('settings_unlocked');
        alert('管理密碼錯誤，這次變更尚未儲存');
        lockSettings();
        return;
    }
    if (res.status === 409) {
        await loadSettingsFromCloud();
        populateSettingsForm();
        renderSchedule();
        alert('設定已被其他管理師更新，已載入雲端最新版；請重新確認後再修改');
        return;
    }
    if (!res.ok) {
        alert(`雲端設定儲存失敗（${res.status}），這次變更尚未套用`);
        return;
    }

    _settingsRevision = res.headers.get('X-Data-Version') || (await res.json()).revision || _settingsRevision;
    _settingsCache = s;
    localStorage.setItem('ccat_settings', JSON.stringify(s));
    // 每日費率會在 renderSchedule() 時寫入行程列；儲存設定後必須重建，
    // 否則後續計算仍會沿用儲存前的費率與假日判斷。
    renderSchedule();
    alert('✅ 共用設定已同步至所有裝置！');
}

// =============================================
// 計算頁：交通費（多筆）
// =============================================
let _transportIndex = 0;

function addTransportEntry() {
    const idx = _transportIndex++;
    const card = document.createElement('div');
    card.className = 'card card-yellow transport-entry';
    card.dataset.idx = idx;
    card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:14px">交通費</strong>
            <button class="btn-sm btn-danger-sm transport-del-btn" style="padding:2px 7px;font-size:12px;line-height:1" onclick="removeTransportEntry(this)" title="刪除">✕</button>
        </div>
        <div class="input-group">
            <label>交通費設定</label>
            <select class="transport-mode" onchange="toggleTransportConfigFor(this)">
                <option value="no">無（0元）</option>
                <option value="yes">有（計算里程或自訂）</option>
            </select>
        </div>
        <div class="input-group hidden transport-km-group">
            <label>單趟里程數（公里）</label>
            <input type="number" class="transport-km" placeholder="例如 12" oninput="updateTransportFeeFor(this)">
            <div class="note-text transport-tier-note"></div>
        </div>
        <div class="input-group">
            <label>單趟交通費（可手動修改）</label>
            <input type="number" class="transport-fee" value="0">
        </div>
        <div class="input-group" style="margin-bottom:0">
            <label>誰的交通費</label>
            <input type="text" class="transport-label" placeholder="管理師名字">
        </div>
    `;
    document.getElementById('transportList').appendChild(card);
    const t = getSettings().transportTiers || DEFAULTS.transportTiers;
    card.querySelector('.transport-tier-note').textContent =
        `規則：10km內 $${t.base} ／ 10km起 $${t.t10} ／ 15km起 $${t.t15} ／ 20km起 $${t.t20}`;
    _updateDeleteButtons();
    updateDayCaretakerSelectors();
}

function removeTransportEntry(btn) {
    btn.closest('.transport-entry').remove();
    _updateDeleteButtons();
    updateDayCaretakerSelectors();
}

function _updateDeleteButtons() {
    const entries = document.querySelectorAll('.transport-entry');
    entries.forEach(e => {
        e.querySelector('.transport-del-btn').style.display = entries.length > 1 ? '' : 'none';
    });
}

function toggleTransportConfigFor(select) {
    const entry = select.closest('.transport-entry');
    const kmGroup = entry.querySelector('.transport-km-group');
    const feeInput = entry.querySelector('.transport-fee');
    if (select.value === 'yes') {
        kmGroup.classList.remove('hidden');
        if (!feeInput.value || feeInput.value == 0) updateTransportFeeFor(entry.querySelector('.transport-km'));
    } else {
        kmGroup.classList.add('hidden');
        entry.querySelector('.transport-km').value = '';
        feeInput.value = 0;
    }
    updateDayCaretakerSelectors();
}

function updateTransportFeeFor(kmInput) {
    const km = parseFloat(kmInput.value);
    if (isNaN(km)) return;
    const t = getSettings().transportTiers || DEFAULTS.transportTiers;
    let fee = t.base;
    if (km >= 20) fee = t.t20;
    else if (km >= 15) fee = t.t15;
    else if (km >= 10) fee = t.t10;
    kmInput.closest('.transport-entry').querySelector('.transport-fee').value = fee;
    updateDayCaretakerSelectors();
}

function resetTransportEntries() {
    document.querySelectorAll('.transport-entry').forEach(entry => {
        const select = entry.querySelector('.transport-mode');
        select.value = 'no';
        entry.querySelector('.transport-km-group').classList.add('hidden');
        entry.querySelector('.transport-km').value = '';
        entry.querySelector('.transport-fee').value = 0;
        entry.querySelector('.transport-label').value = '';
    });
}

function getTransportEntries() {
    return Array.from(document.querySelectorAll('.transport-entry')).map(e => ({
        fee: parseInt(e.querySelector('.transport-fee').value) || 0,
        label: e.querySelector('.transport-label').value.trim(),
    }));
}

// 目前「已填費用且已填管理師姓名」的交通費項目，依卡片順序回傳去重後的姓名清單
function getActiveTransportCaretakers() {
    const names = [];
    getTransportEntries().forEach(e => {
        if (e.fee > 0 && e.label && !names.includes(e.label)) names.push(e.label);
    });
    return names;
}

// =============================================
// 計算頁：渲染行程
// =============================================
function onStartDateChange() {
    const startInput = document.getElementById('startDate');
    const endInput   = document.getElementById('endDate');
    if (startInput.value && endInput.value && endInput.value < startInput.value) {
        const d = new Date(startInput.value);
        d.setDate(d.getDate() + 3);
        endInput.value = d.toISOString().split('T')[0];
    }
    updatePaymentDeadlineDefault();
    renderSchedule();
}

function renderSchedule() {
    invalidateQuote();
    const startDateStr = document.getElementById('startDate').value;
    const endDateStr   = document.getElementById('endDate').value;
    if (!startDateStr || !endDateStr) return;

    if (endDateStr < startDateStr) {
        document.getElementById('day-list').innerHTML = '';
        document.getElementById('schedule-container').style.display = 'none';
        document.getElementById('resultArea').innerHTML = '';
        document.getElementById('actionButtons').style.display = 'none';
        document.getElementById('policyContainer').style.display = 'none';
        document.getElementById('quoteStaleNotice').style.display = 'none';
        showToast('結束日期不可早於開始日期');
        return;
    }

    const s = getSettings();
    const SPECIAL = { 1: s.special1, 2: s.special2, 3: s.special3 };

    const listDiv = document.getElementById('day-list');
    listDiv.innerHTML = '';
    document.getElementById('actionButtons').style.display = 'none';
    document.getElementById('policyContainer').style.display = 'none';

    let cur = new Date(startDateStr);
    const end = new Date(endDateStr);
    const dateArray = [];
    while (cur <= end) { dateArray.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

    dateArray.forEach(date => {
        const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
        const ymd     = date.toISOString().split('T')[0];
        const isSpec  = isSpecialDate(date);
        const holidayInfo = getHolidayInfo(date);
        const isHol   = Boolean(holidayInfo);
        const weekDay = ['日','一','二','三','四','五','六'][date.getDay()];
        const rp      = getRateForDate(date);

        const opts = isSpec
            ? [SPECIAL[1], SPECIAL[2], SPECIAL[3]]
            : [rp.rates[1], rp.rates[2], rp.rates[3]];

        let tagHtml = '';
        if (isSpec) tagHtml = '<span class="tag tag-special">春節期間</span>';
        else if (isHol) tagHtml = `<span class="tag tag-holiday">假日</span><span class="manager-reason">${escapeHtml(holidayInfo.reason)}</span>`;

        const row = document.createElement('div');
        row.className = 'day-row';
        row.innerHTML = `
            <div class="day-row-main">
                <div class="day-label">
                    ${dateStr}（${weekDay}）${tagHtml}
                    <input type="hidden" class="date-val" value="${ymd}">
                    <input type="hidden" class="is-special" value="${isSpec}">
                    <input type="hidden" class="is-holiday" value="${isHol}">
                    <input type="hidden" class="rate-period-name" value="${escapeHtml(isSpec ? '春節費率' : rp.name)}">
                    <input type="hidden" class="rate1" value="${opts[0]}">
                    <input type="hidden" class="rate2" value="${opts[1]}">
                    <input type="hidden" class="rate3" value="${opts[2]}">
                </div>
                <select class="day-select">
                    <option value="0">0 次 ($0)</option>
                    <option value="1" selected>1 次 ($${opts[0]})</option>
                    <option value="2">2 次 ($${opts[1]})</option>
                    <option value="3">3 次 ($${opts[2]})</option>
                </select>
            </div>
        `;
        listDiv.appendChild(row);
    });

    document.getElementById('schedule-container').style.display = 'block';
    document.getElementById('resultArea').innerHTML = '';
    document.getElementById('quoteStaleNotice').style.display = 'none';
    updateDayCaretakerSelectors();
}

// 只有存在 2 筆以上「已填費用且已填管理師姓名」的交通費項目時，
// 才在每日列顯示「當天負責管理師」選單；否則移除選單，維持原本行為
// （交通費沿用單一費率 × 全期趟數）。選單預設值取第一筆輸入的管理師姓名。
// 若當天次數 ≥ 2，另外提供「分開」按鈕，可展開成每一趟各自選管理師。
function updateDayCaretakerSelectors() {
    const caretakers = getActiveTransportCaretakers();
    const rows = document.querySelectorAll('#day-list .day-row');
    rows.forEach(row => {
        const freq = parseInt(row.querySelector('.day-select').value) || 0;
        let group  = row.querySelector('.day-caretaker-group');
        let visits = row.querySelector('.day-caretaker-visits');

        if (caretakers.length < 2) {
            if (group) group.remove();
            if (visits) visits.remove();
            return;
        }

        if (!group) {
            group = document.createElement('div');
            group.className = 'day-caretaker-group';
            group.innerHTML = `
                <select class="day-caretaker"></select>
                <button type="button" class="day-caretaker-toggle" onclick="toggleDayCaretakerExpand(this)">分開</button>
            `;
            row.querySelector('.day-row-main').insertBefore(group, row.querySelector('.day-select'));
        }
        if (!visits) {
            visits = document.createElement('div');
            visits.className = 'day-caretaker-visits hidden';
            row.appendChild(visits);
        }

        const sel = group.querySelector('.day-caretaker');
        const prevValue = sel.value;
        sel.innerHTML = caretakers.map(name =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ).join('');
        sel.value = caretakers.includes(prevValue) ? prevValue : caretakers[0];

        const toggleBtn = group.querySelector('.day-caretaker-toggle');
        const isExpanded = !visits.classList.contains('hidden');

        if (freq < 2) {
            toggleBtn.style.display = 'none';
            if (isExpanded) collapseDayCaretaker(row);
        } else {
            toggleBtn.style.display = '';
            if (isExpanded) renderDayCaretakerVisits(row, caretakers);
        }
    });
}

// 展開每日次數各自的管理師選單，每一趟預設沿用當天選定的管理師，
// 若已展開過則保留原本每趟的選擇（除非該選擇已不在有效管理師名單中）。
function renderDayCaretakerVisits(row, caretakers) {
    const freq = parseInt(row.querySelector('.day-select').value) || 0;
    const visits = row.querySelector('.day-caretaker-visits');
    const dayDefault = row.querySelector('.day-caretaker').value;
    const existing = Array.from(visits.querySelectorAll('.day-caretaker-visit')).map(s => s.value);
    const rowsHtml = [];
    for (let i = 0; i < freq; i++) {
        const prev = existing[i];
        const val = caretakers.includes(prev) ? prev : dayDefault;
        rowsHtml.push(`
            <div class="day-caretaker-visit-row">
                <span>第${i + 1}趟</span>
                <select class="day-caretaker-visit">
                    ${caretakers.map(name =>
                        `<option value="${escapeHtml(name)}" ${name === val ? 'selected' : ''}>${escapeHtml(name)}</option>`
                    ).join('')}
                </select>
            </div>
        `);
    }
    visits.innerHTML = rowsHtml.join('');
}

function collapseDayCaretaker(row) {
    const sel = row.querySelector('.day-caretaker');
    const visits = row.querySelector('.day-caretaker-visits');
    const toggleBtn = row.querySelector('.day-caretaker-toggle');
    if (sel) sel.classList.remove('hidden');
    if (visits) { visits.classList.add('hidden'); visits.innerHTML = ''; }
    if (toggleBtn) toggleBtn.textContent = '分開';
}

function toggleDayCaretakerExpand(btn) {
    const row = btn.closest('.day-row');
    const sel = row.querySelector('.day-caretaker');
    const visits = row.querySelector('.day-caretaker-visits');
    if (visits.classList.contains('hidden')) {
        renderDayCaretakerVisits(row, getActiveTransportCaretakers());
        visits.classList.remove('hidden');
        sel.classList.add('hidden');
        btn.textContent = '收合';
    } else {
        collapseDayCaretaker(row);
    }
    invalidateQuote();
}

function setMiddleDays(freq) {
    const selects = document.querySelectorAll('.day-select');
    if (selects.length <= 2) { alert('天數太少，沒有中間日期可修改'); return; }
    for (let i = 1; i < selects.length - 1; i++) selects[i].value = freq;
    updateDayCaretakerSelectors();
}

// =============================================
// 計算頁：計算費用
// =============================================
function formatDateRanges(dateStrings) {
    if (!dateStrings.length) return '';
    dateStrings.sort();
    const ranges = [];
    let rStart = dateStrings[0], rEnd = dateStrings[0];
    for (let i = 1; i < dateStrings.length; i++) {
        const diff = (new Date(dateStrings[i]) - new Date(rEnd)) / 86400000;
        if (diff === 1) rEnd = dateStrings[i];
        else { ranges.push(fmtRange(rStart, rEnd)); rStart = rEnd = dateStrings[i]; }
    }
    ranges.push(fmtRange(rStart, rEnd));
    return ranges.join(', ');
}

function fmtRange(start, end) {
    const short = s => { const [,m,d] = s.split('-'); return `${+m}/${+d}`; };
    return start === end ? short(start) : `${short(start)}-${short(end)}`;
}

function calculate() {
    const catNamesInput = document.getElementById('catNames').value.trim();
    if (!catNamesInput) { alert('請先填寫貓咪名字喔！'); return; }
    if (document.getElementById('catDrawer').classList.contains('open')) return;
    const normalizedCatName = catNamesInput.replace(/\s/g, '');
    if (!_cats.some(cat => cat.name === normalizedCatName) && _allowUnlistedCat !== normalizedCatName) {
        if (confirm('此名稱不在貓咪名單中，請問是否新增？')) openCatDrawer(normalizedCatName, true);
        else _allowUnlistedCat = normalizedCatName;
        return;
    }
    if (!document.getElementById('quoteDate').value) { alert('請填寫報價日期'); return; }

    const quoteDateValue = document.getElementById('quoteDate').value;
    const serviceStartValue = document.getElementById('startDate').value;
    if (quoteDateValue > serviceStartValue && !confirm('報價日晚於服務首日，這份報價單將視為回溯產出。是否繼續？')) return;

    const s           = getSettings();
    const HOLIDAY_FEE   = s.holidayFee;
    const MULTI_CAT_FEE = s.multiCatFee;
    const transportEntries = getTransportEntries();
    const discountFee   = parseInt(document.getElementById('discountFee').value)  || 0;
    const discountDesc  = document.getElementById('discountDesc').value.trim();
    const extraFee      = parseInt(document.getElementById('extraFee').value)     || 0;
    const extraDesc     = document.getElementById('extraDesc').value.trim();

    const rows = document.querySelectorAll('.day-row');
    if (!rows.length) { renderSchedule(); return; }

    const cats    = catNamesInput.split('/').filter(n => n.trim());
    const catCount = cats.length;

    // 用 Map 聚合：key = `${periodName}__${freq}` (春節獨立)
    // Map value: { label, unitPrice, count, total, dates[] }
    const buckets = new Map();
    let holidayDays = 0, holidayDates = [], totalTrips = 0, activeDays = 0;
    let grandTotal = 0;
    // 依「當天負責管理師」分組的趟數，讓每位管理師的交通費只算自己實際去的天數，避免疊加
    const tripsByCaretaker = {};
    let hasDayCaretakers = false;
    // 報價明細用的「每天負責管理師」文字列表，展開日期會拆成每一趟各一行
    const caretakerSchedule = [];

    rows.forEach(row => {
        const freq = parseInt(row.querySelector('.day-select').value);
        if (!freq) return;
        activeDays++;

        const isSpec  = row.querySelector('.is-special').value === 'true';
        const isHol   = row.querySelector('.is-holiday').value === 'true';
        const ymd     = row.querySelector('.date-val').value;
        const pName   = row.querySelector('.rate-period-name').value;
        const unitRate = parseInt(row.querySelector(`.rate${freq}`).value);

        const key = `${pName}__${freq}`;
        if (!buckets.has(key)) {
            buckets.set(key, {
                label: isSpec
                    ? `春節期間費用（每日 ${freq} 次）`
                    : `${pName.replace(/\s*費率$/, '').trim()} 基本費用（每日 ${freq} 次）`,
                unitPrice: unitRate,
                count: 0, total: 0, dates: []
            });
        }
        const b = buckets.get(key);
        b.count++;
        b.total += unitRate;
        b.dates.push(ymd);
        grandTotal += unitRate;

        if (!isSpec && isHol) {
            holidayDays++;
            holidayDates.push(ymd);
            grandTotal += HOLIDAY_FEE;
        }

        totalTrips += freq;

        const caretakerSel = row.querySelector('.day-caretaker');
        if (caretakerSel) {
            hasDayCaretakers = true;
            const visits = row.querySelector('.day-caretaker-visits');
            const visitSelects = visits && !visits.classList.contains('hidden')
                ? Array.from(visits.querySelectorAll('.day-caretaker-visit'))
                : null;
            const shortDate = fmtRange(ymd, ymd);
            if (visitSelects && visitSelects.length) {
                // 已展開：同一天的每一趟各自記到自己選的管理師名下
                visitSelects.forEach(vs => {
                    tripsByCaretaker[vs.value] = (tripsByCaretaker[vs.value] || 0) + 1;
                });
                caretakerSchedule.push(`${shortDate}（${visitSelects.length}趟）`);
                visitSelects.forEach((vs, i) => caretakerSchedule.push(`${shortDate}-${i + 1}：${vs.value}`));
            } else {
                // 未展開：整天次數都算給同一位管理師
                tripsByCaretaker[caretakerSel.value] = (tripsByCaretaker[caretakerSel.value] || 0) + freq;
                caretakerSchedule.push(freq > 1
                    ? `${shortDate}（${freq}趟）：${caretakerSel.value}`
                    : `${shortDate}：${caretakerSel.value}`);
            }
        }
    });

    if (hasDayCaretakers) {
        const activeEntries = transportEntries.filter(e => e.fee > 0);
        if (activeEntries.length > 1 && activeEntries.some(e => !e.label)) {
            alert('已設定多位管理師的每日負責人，每一筆交通費都必須填寫「誰的交通費」對應管理師姓名，請確認後再產生報價');
            return;
        }
        const unmatched = activeEntries.find(e => e.label && !(e.label in tripsByCaretaker));
        if (unmatched) {
            alert(`交通費「誰的交通費」欄位「${unmatched.label}」與每日管理師選單的名字不一致，請確認後再產生報價`);
            return;
        }
    }
    // 沒有指定當天管理師時（單一管理師費率），維持原本「單一交通費率 × 全期趟數」的算法
    const transportTripsFor = e => (hasDayCaretakers && e.label) ? (tripsByCaretaker[e.label] || 0) : totalTrips;

    transportEntries.forEach(e => { if (e.fee > 0) grandTotal += e.fee * transportTripsFor(e); });

    if (catCount > 1 && activeDays > 0) grandTotal += MULTI_CAT_FEE * activeDays * (catCount - 1);
    if (discountFee > 0) grandTotal -= discountFee;
    if (extraFee > 0)    grandTotal += extraFee;

    const startStr = document.getElementById('startDate').value;
    const endStr   = document.getElementById('endDate').value;
    const dateRangeDisplay = fmtRange(startStr, endStr);
    const startYear = startStr.slice(0, 4);
    const endYear = endStr.slice(0, 4);
    const quoteDate = quoteDateValue;
    const paymentDeadline = document.getElementById('paymentDeadline').value;
    const deadlineText = paymentDeadline ? paymentDeadline.replaceAll('-', '/') : '';
    const fullServiceRange = startYear === endYear
        ? `${startYear}/${startStr.slice(5).replace('-', '/')}～${endStr.slice(5).replace('-', '/')}`
        : `${startStr.replaceAll('-', '/')}～${endStr.replaceAll('-', '/')}`;

    let html = `
        <div class="quote-title">熙貓樂園寵物管理服務報價單</div>
        <div class="quote-meta">
            <div><strong>報價日期：</strong>${escapeHtml(quoteDate.replaceAll('-', '/'))}</div>
            <div><strong>服務期間：</strong>${escapeHtml(fullServiceRange)}</div>
            <div><strong>服務對象：</strong>${escapeHtml(cats.join('、'))}（共 ${catCount} 隻）</div>
            <div><strong>付款期限：</strong>${escapeHtml(deadlineText || '')}</div>
        </div>
        <table>
            <thead>
                <tr class="header-row">
                    <th>費用項目</th><th>計價方式</th><th>數量</th><th>小計</th><th>說明</th>
                </tr>
            </thead>
            <tbody>
    `;

    buckets.forEach(b => {
        html += quoteRowHtml(b.label, `每日 $${b.unitPrice.toLocaleString()}`, `${b.count} 天`, b.total, formatDateRanges(b.dates));
    });

    if (holidayDays > 0)
        html += quoteRowHtml('假日加價', `每日 $${HOLIDAY_FEE.toLocaleString()}`, `${holidayDays} 天`, HOLIDAY_FEE * holidayDays, formatDateRanges(holidayDates));
    if (catCount > 1 && activeDays > 0)
        html += quoteRowHtml('多貓加價', `第二隻起，每日每隻 $${MULTI_CAT_FEE.toLocaleString()}`, `${activeDays} 天`,
            MULTI_CAT_FEE * activeDays * (catCount - 1), `共 ${catCount} 隻貓`);
    transportEntries.forEach(e => {
        if (e.fee > 0) {
            const trips = transportTripsFor(e);
            html += quoteRowHtml('交通費', `每趟 $${e.fee.toLocaleString()}`, `${trips} 趟`, e.fee * trips, e.label);
        }
    });
    if (extraFee > 0)
        html += quoteRowHtml('補收費用', '單次', '1 次', extraFee, extraDesc || '無說明');
    if (discountFee > 0)
        html += quoteRowHtml('折抵費用', '單次', '1 次', -discountFee, discountDesc || '無說明');

    html += `
            <tr class="total-row">
                <td>合計</td><td></td><td></td>
                <td>$${grandTotal.toLocaleString()}</td><td>${dateRangeDisplay}</td>
            </tr>
            </tbody></table>
    `;

    if (hasDayCaretakers && caretakerSchedule.length) {
        html += `
            <div class="quote-caretaker-schedule">
                <div class="quote-caretaker-schedule-title">管理師出勤明細</div>
                <div class="quote-caretaker-schedule-body">${caretakerSchedule.map(escapeHtml).join('<br>')}</div>
            </div>
        `;
    }

    document.getElementById('resultArea').innerHTML = html;
    document.getElementById('actionButtons').style.display = 'flex';
    document.getElementById('quoteStaleNotice').style.display = 'none';
    _quoteIsCurrent = true;

    // 顯示可編輯的政策文字
    const policyEl = document.getElementById('policyDisplay');
    const policyText = getSettings().copyText || DEFAULT_COPY_TEXT;
    policyEl.textContent = `請確認費用明細並於期限內完成付款，謝謝🧡\n\n${policyText}`;
    document.getElementById('policyContainer').style.display = 'block';
}

function getDefaultPaymentDeadline() {
    const startVal = document.getElementById('startDate').value;
    if (!startVal) return '';
    const quoteValue = document.getElementById('quoteDate').value;
    if (!quoteValue || quoteValue > startVal) return '';
    if (quoteValue === startVal) return startVal;
    const quoteDate = new Date(`${quoteValue}T00:00:00`);
    const start = new Date(`${startVal}T00:00:00`);

    const defaultDeadline = new Date(quoteDate);
    defaultDeadline.setDate(quoteDate.getDate() + 7);

    const latestDeadline = new Date(start);
    latestDeadline.setDate(start.getDate() - 1);

    const deadline = defaultDeadline > latestDeadline ? latestDeadline : defaultDeadline;
    return `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}`;
}

function updatePaymentDeadlineDefault() {
    document.getElementById('paymentDeadline').value = getDefaultPaymentDeadline();
}

function rowHtml(name, price, qty, unit, total, note) {
    const dp = (typeof price === 'string' && price.startsWith('-')) ? price : `$${price}`;
    const dt = (typeof total === 'string' && total.startsWith('-')) ? total : `$${Number(total).toLocaleString()}`;
    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(dp)}</td><td>${escapeHtml(qty)}</td><td>${escapeHtml(unit)}</td><td>${escapeHtml(dt)}</td><td>${escapeHtml(note)}</td></tr>`;
}

function quoteRowHtml(name, pricing, quantity, total, note) {
    const displayTotal = total < 0 ? `-$${Math.abs(total).toLocaleString()}` : `$${Number(total).toLocaleString()}`;
    return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(pricing)}</td><td>${escapeHtml(quantity)}</td><td>${escapeHtml(displayTotal)}</td><td>${escapeHtml(note)}</td></tr>`;
}

// =============================================
// 複製 / 截圖 / 分享
// =============================================
function copyPolicyText() {
    const base = getSettings().copyText || DEFAULT_COPY_TEXT;
    const text = `請確認費用明細並於期限內完成付款，謝謝🧡\n\n${base}`;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => alert('✅ 已成功複製！可直接貼上至 LINE。'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('✅ 已成功複製！'); }
    catch { alert('複製失敗，請手動選取。'); }
    document.body.removeChild(ta);
}

function captureTable() {
    if (!_quoteIsCurrent) { alert('內容已修改，請重新產生報價'); return Promise.reject(); }
    const result = document.getElementById('resultArea');
    const el = result;
    if (!el.innerHTML) { alert('請先產生報價明細'); return Promise.reject(); }
    const clone = el.cloneNode(true);
    clone.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;background:#fff;padding:20px;z-index:-1;';
    document.body.appendChild(clone);
    return html2canvas(clone, { scale: 2, backgroundColor: '#ffffff' })
        .then(c => { document.body.removeChild(clone); return c; })
        .catch(e => { document.body.removeChild(clone); throw e; });
}

function getFileName() {
    const names = document.getElementById('catNames').value.replace(/[\/\\:*?"<>|]/g, '').trim();
    const date  = document.getElementById('startDate').value.replace(/-/g, '');
    return `${names}${date}.png`;
}

function downloadImage() {
    captureTable().then(c => {
        const a = document.createElement('a');
        a.download = getFileName(); a.href = c.toDataURL('image/png');
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }).catch(e => { if (e) alert('圖片製作失敗，請重試'); });
}

function shareImage() {
    if (!navigator.share) { downloadImage(); return; }
    captureTable().then(c => {
        c.toBlob(blob => {
            const file = new File([blob], getFileName(), { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
                navigator.share({ files: [file] }).catch(e => { if (e.name !== 'AbortError') console.error(e); });
            } else { downloadImage(); }
        });
    }).catch(e => { if (e) alert('圖片製作失敗，請重試'); });
}

// =============================================
// 初始化
// =============================================
window.onload = async function () {
    const today = new Date();
    const s = new Date(today); s.setDate(today.getDate() + 7);
    const e = new Date(s);    e.setDate(s.getDate() + 3);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    document.getElementById('startDate').value = fmt(s);
    document.getElementById('endDate').value   = fmt(e);
    document.getElementById('quoteDate').value = fmt(today);
    updatePaymentDeadlineDefault();
    document.getElementById('holidayImportYear').value = today.getFullYear() + 1;
    await Promise.all([loadCatsFromCloud(), loadSettingsFromCloud()]);
    document.getElementById('catNames').disabled = false;
    document.getElementById('catNameStatus').textContent = '';
    addTransportEntry();
    renderSchedule();

    let _currentCatFees = [];

    document.getElementById('catNames').addEventListener('change', function() {
        const val = this.value.replace(/\s/g, '').trim();
        const cat = _cats.find(c => c.name === val);
        const parsedNames = val.split('/').filter(Boolean);
        const status = document.getElementById('catNameStatus');
        status.textContent = val
            ? cat ? `已辨識：${parsedNames.join('、')}，共 ${parsedNames.length} 隻` : '此名稱不在貓咪名單中，請問是否新增？'
            : '';
        if (val && !cat) {
            if (confirm('此名稱不在貓咪名單中，請問是否新增？')) openCatDrawer(val, true);
            else _allowUnlistedCat = val;
        } else _allowUnlistedCat = '';
        const reminder = document.getElementById('transportReminder');
        const activeFees = cat && cat.fees ? cat.fees.filter(f => f.fee > 0) : [];
        _currentCatFees = activeFees;
        resetTransportEntries();
        updateDayCaretakerSelectors();

        if (!activeFees.length) {
            reminder.style.display = 'none';
            return;
        }

        reminder.style.display = 'block';

        if (activeFees.length === 1) {
            // 單筆費用：直接帶入第一筆 transport entry
            const entries = document.querySelectorAll('.transport-entry');
            const entry = entries[0];
            const select = entry.querySelector('.transport-mode');
            select.value = 'yes';
            toggleTransportConfigFor(select);
            entry.querySelector('.transport-fee').value = activeFees[0].fee;
            entry.querySelector('.transport-label').value = activeFees[0].caretaker || '';
        }
        // 多筆：等使用者輸入管理師名字後再帶入（由 transport-label input 事件處理）
    });

    document.getElementById('transportList').addEventListener('input', function(e) {
        if (e.target.classList.contains('transport-label')) {
            // 管理師名字輸入時，比對貓咪費用自動帶入
            if (_currentCatFees.length) {
                const name = e.target.value.trim();
                const match = _currentCatFees.find(f => f.caretaker === name);
                if (match) {
                    const entry = e.target.closest('.transport-entry');
                    const select = entry.querySelector('.transport-mode');
                    select.value = 'yes';
                    toggleTransportConfigFor(select);
                    entry.querySelector('.transport-fee').value = match.fee;
                }
            }
            updateDayCaretakerSelectors();
        } else if (e.target.classList.contains('transport-fee')) {
            updateDayCaretakerSelectors();
        }
    });

    // 每日次數變更時，重新檢查是否要顯示「分開」按鈕與每趟管理師選單
    document.getElementById('day-list').addEventListener('change', function(e) {
        if (e.target.classList.contains('day-select')) updateDayCaretakerSelectors();
    });

    document.getElementById('tab-calc').addEventListener('input', invalidateQuote);
    document.getElementById('tab-calc').addEventListener('change', invalidateQuote);
};
