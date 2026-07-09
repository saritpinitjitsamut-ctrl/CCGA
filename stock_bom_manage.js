const bomForm = document.getElementById('bomForm');
const formStatus = document.getElementById('formStatus');
const bomTableBody = document.getElementById('bomTableBody');
const bomCount = document.getElementById('bomCount');
const bomSearchInput = document.getElementById('bomSearch');
const refreshBtn = document.getElementById('refreshBtn');
const deleteBomBtn = document.getElementById('deleteBomBtn');
const clearBomBtn = document.getElementById('clearBomBtn');
const saveBomBtn = document.getElementById('saveBomBtn');
const bomParentSkuInput = document.getElementById('bomParentSku');
const bomParentSuggestionsEl = document.getElementById('bomParentSuggestions');
const bomChildSkuInput = document.getElementById('bomChildSku');
const bomChildNameInput = document.getElementById('bomChildName');
const addNewChildSkuBtn = document.getElementById('addNewChildSkuBtn');
const bomQtyInput = document.getElementById('bomQty');
const bomSuggestionsEl = document.getElementById('bomSuggestions');
const componentsListEl = document.getElementById('componentsList');
const addComponentBtn = document.getElementById('addComponentBtn');

let dbClient = null;
let bomRows = [];
let selectedBomId = null;
let childSearchTimer = null;
let parentSearchTimer = null;
let componentNameMap = {};
let selectedBomParent = null;
let compRowCounter = 0;

function showStatus(message, type = 'success') {
    formStatus.textContent = message;
    formStatus.className = `status-message status-${type}`;
}

function clearStatus() {
    formStatus.textContent = '';
    formStatus.className = 'status-message';
}

function renderBomRows() {
    const term = (bomSearchInput.value || '').trim().toLowerCase();
    const filtered = bomRows.filter(row => {
        if (!term) return true;
        return [row.product_code, row.component_product_code].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
    });

    bomCount.textContent = `${filtered.length} รายการ`;
    if (!filtered.length) {
        bomTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">ไม่พบ BOM</td></tr>';
        return;
    }

    bomTableBody.innerHTML = filtered.map(row => {
        const componentName = componentNameMap[row.component_product_code] || '-';
        return `
        <tr data-bom-id="${row.id}" class="${selectedBomId === row.id ? 'active' : ''}">
            <td>${row.product_code}</td>
            <td>${row.component_product_code}</td>
            <td>${componentName}</td>
            <td>${row.component_qty}</td>
        </tr>
    `;
    }).join('');
}

async function loadBomRows() {
    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        return;
    }

    try {
        const { data, error } = await dbClient
            .from('stock_bom')
            .select('id, product_code, component_product_code, component_qty')
            .order('product_code', { ascending: true })
            .order('component_product_code', { ascending: true });

        if (error) throw error;
        bomRows = data || [];
        await loadComponentNames(bomRows.map(row => row.component_product_code));
        selectedBomId = null;
        renderBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`โหลด BOM ล้มเหลว: ${error.message}`, 'error');
    }
}

async function loadComponentNames(codes) {
    componentNameMap = {};
    const uniqueCodes = Array.from(new Set(codes.filter(Boolean)));
    if (!uniqueCodes.length || !dbClient) return;

    try {
        const { data, error } = await dbClient
            .from('stock_items')
            .select('product_code, product_name')
            .in('product_code', uniqueCodes);
        if (error) throw error;
        (data || []).forEach(item => {
            componentNameMap[item.product_code] = item.product_name;
        });
    } catch (error) {
        console.warn('ไม่สามารถโหลดชื่อ SKU ชิ้นส่วนได้:', error);
    }
}

function resetBomForm(keepStatus = false) {
    bomForm.reset();
    selectedBomId = null;
    selectedBomParent = null;
    if (componentsListEl) componentsListEl.innerHTML = '';
    if (!keepStatus) clearStatus();
}

function setBomForm(row) {
    // Populate form for editing whole parent BOM
    const parent = row.product_code || '';
    bomParentSkuInput.value = parent;
    selectedBomParent = parent;
    // clear existing component rows
    if (componentsListEl) componentsListEl.innerHTML = '';
    // add all components for this parent
    const comps = bomRows.filter(r => r.product_code === parent);
    if (comps.length) {
        comps.forEach(c => addComponentRow({ code: c.component_product_code, name: componentNameMap[c.component_product_code] || '', qty: c.component_qty }));
    } else {
        addComponentRow();
    }
    selectedBomId = null;
    renderBomRows();
}

async function searchStockItems(query) {
    if (!dbClient || !query) return [];
    try {
        const { data, error } = await dbClient
            .from('stock_items')
            .select('product_code, product_name')
            .or(`product_code.ilike.%${query}%,product_name.ilike.%${query}%`)
            .order('product_code', { ascending: true })
            .limit(12);
        if (error) throw error;
        return data || [];
    } catch (error) {
        console.warn('ค้นหา stock_items ไม่สำเร็จ:', error);
        return [];
    }
}

function renderSuggestions(items) {
    if (!bomSuggestionsEl) return;
    if (!items || !items.length) {
        bomSuggestionsEl.classList.remove('show');
        bomSuggestionsEl.innerHTML = '';
        return;
    }

    bomSuggestionsEl.innerHTML = items.map(item => `
        <div class="suggestion-item" data-code="${item.product_code}" data-name="${item.product_name || ''}">
            <span class="suggestion-label">${item.product_code}</span>
            <span class="suggestion-subtitle">${item.product_name || '-'}</span>
        </div>
    `).join('');
    bomSuggestionsEl.classList.add('show');
}

function hideSuggestions() {
    bomSuggestionsEl.classList.remove('show');
    if (bomParentSuggestionsEl) bomParentSuggestionsEl.classList.remove('show');
}

function fillChildSku(code, name) {
    if (!bomChildSkuInput || !bomChildNameInput) return;
    bomChildSkuInput.value = code;
    bomChildNameInput.value = name || '';
    hideSuggestions();
}

function addComponentRow(data = {}) {
    if (!componentsListEl) return;
    const id = `comp-${++compRowCounter}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'component-row';
    wrapper.dataset.compId = id;
    wrapper.innerHTML = `
        <div class="comp-grid" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <div style="flex:1">
                <input class="comp-code" placeholder="SKU ชิ้นส่วน" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
                <div class="comp-suggestions" style="position:relative"></div>
            </div>
            <div style="flex:1">
                <input class="comp-name" placeholder="ชื่อชิ้นส่วน" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
            </div>
            <div style="width:110px">
                <input class="comp-qty" type="number" min="1" value="1" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;" />
            </div>
            <div style="width:40px;text-align:center">
                <button type="button" class="btn-remove-comp" title="ลบรายการ">✖</button>
            </div>
        </div>
    `;
    componentsListEl.appendChild(wrapper);

    const codeInput = wrapper.querySelector('.comp-code');
    const nameInput = wrapper.querySelector('.comp-name');
    const qtyInput = wrapper.querySelector('.comp-qty');
    const suggestionsEl = wrapper.querySelector('.comp-suggestions');
    const removeBtn = wrapper.querySelector('.btn-remove-comp');

    if (data.code) codeInput.value = data.code;
    if (data.name) nameInput.value = data.name;
    if (data.qty) qtyInput.value = data.qty;

    let rowTimer = null;
    codeInput.addEventListener('input', (e) => {
        const q = String(e.target.value || '').trim();
        if (rowTimer) clearTimeout(rowTimer);
        if (!q) { suggestionsEl.innerHTML = ''; suggestionsEl.classList.remove('show'); return; }
        rowTimer = setTimeout(async () => {
            const results = await searchStockItems(q);
            suggestionsEl.innerHTML = results.map(item => `
                <div class="suggestion-item" data-code="${item.product_code}" data-name="${item.product_name || ''}" style="padding:6px;border-bottom:1px solid rgba(0,0,0,0.03);cursor:pointer;">
                    <div style="font-weight:600">${item.product_code}</div>
                    <div style="font-size:12px;color:#666">${item.product_name || '-'}</div>
                </div>
            `).join('');
            suggestionsEl.classList.add('show');
        }, 220);
    });

    suggestionsEl.addEventListener('click', (ev) => {
        const it = ev.target.closest('.suggestion-item');
        if (!it) return;
        const c = it.dataset.code;
        const n = it.dataset.name || '';
        codeInput.value = c;
        nameInput.value = n;
        suggestionsEl.classList.remove('show');
    });

    removeBtn.addEventListener('click', () => {
        wrapper.remove();
    });
}

function getComponentsFromForm() {
    if (!componentsListEl) return [];
    const rows = Array.from(componentsListEl.querySelectorAll('.component-row'));
    return rows.map(r => {
        const code = (r.querySelector('.comp-code')?.value || '').trim();
        const name = (r.querySelector('.comp-name')?.value || '').trim();
        const qty = parseInt(r.querySelector('.comp-qty')?.value || '1') || 1;
        return { code, name, qty };
    }).filter(c => c.code);
}

function renderParentSuggestions(items) {
    if (!bomParentSuggestionsEl) return;
    if (!items || !items.length) {
        bomParentSuggestionsEl.classList.remove('show');
        bomParentSuggestionsEl.innerHTML = '';
        return;
    }

    bomParentSuggestionsEl.innerHTML = items.map(item => `
        <div class="suggestion-item" data-code="${item.product_code}" data-name="${item.product_name || ''}">
            <span class="suggestion-label">${item.product_code}</span>
            <span class="suggestion-subtitle">${item.product_name || '-'}</span>
        </div>
    `).join('');
    bomParentSuggestionsEl.classList.add('show');
}

function fillParentSku(code, name) {
    bomParentSkuInput.value = code;
    if (bomParentSuggestionsEl) bomParentSuggestionsEl.classList.remove('show');
}

async function stockItemExists(productCode) {
    if (!dbClient || !productCode) return false;
    const { data, error } = await dbClient
        .from('stock_items')
        .select('id')
        .eq('product_code', productCode)
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return Boolean(data);
}

async function addNewChildSku() {
    clearStatus();
    if (!bomChildSkuInput) {
        showStatus('ไม่พบช่องกรอก SKU ชิ้นส่วนบนหน้า (ใช้ปุ่ม + เพื่อเพิ่มชิ้นส่วนแทน)', 'error');
        return;
    }
    const code = bomChildSkuInput.value.trim();
    if (!code) {
        showStatus('กรุณากรอก SKU ชิ้นส่วนก่อนกดเพิ่ม', 'error');
        return;
    }

    try {
        const exists = await stockItemExists(code);
        if (exists) {
            showStatus(`SKU ชิ้นส่วน ${code} มีอยู่แล้วในระบบ`, 'info');
            return;
        }

        const payload = {
            product_code: code,
            product_name: code,
            quantity: 0,
            unit: 'ชิ้น',
            category: 'general'
        };

        const { error } = await dbClient.from('stock_items').insert([payload]);
        if (error) throw error;

        showStatus(`เพิ่ม SKU ชิ้นส่วนใหม่เรียบร้อย: ${code}`, 'success');
        bomChildSkuInput.value = code;
        await loadBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`เพิ่ม SKU ชิ้นส่วนไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function handleBomSearchInput(event) {
    const query = String(event.target.value || '').trim();
    if (childSearchTimer) clearTimeout(childSearchTimer);
    if (!query) {
        hideSuggestions();
        return;
    }

    childSearchTimer = setTimeout(async () => {
        const results = await searchStockItems(query);
        renderSuggestions(results);
    }, 240);
}

async function handleParentSearchInput(event) {
    const query = String(event.target.value || '').trim();
    if (parentSearchTimer) clearTimeout(parentSearchTimer);
    if (!query) {
        if (bomParentSuggestionsEl) {
            bomParentSuggestionsEl.classList.remove('show');
            bomParentSuggestionsEl.innerHTML = '';
        }
        return;
    }

    parentSearchTimer = setTimeout(async () => {
        const results = await searchStockItems(query);
        renderParentSuggestions(results);
    }, 240);
}

async function getStockItemByCode(productCode) {
    if (!dbClient || !productCode) return null;
    const { data, error } = await dbClient
        .from('stock_items')
        .select('id, product_name')
        .eq('product_code', productCode)
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

async function ensureStockItemExists(productCode, productName) {
    const normalizedName = productName ? productName.trim() : '';
    const existing = await getStockItemByCode(productCode);
    if (existing) {
        if (normalizedName && existing.product_name !== normalizedName) {
            const { error } = await dbClient
                .from('stock_items')
                .update({ product_name: normalizedName })
                .eq('id', existing.id);
            if (error) throw error;
        }
        return existing;
    }

    const payload = {
        product_code: productCode,
        product_name: normalizedName || productCode,
        quantity: 0,
        unit: 'ชิ้น',
        category: 'general'
    };
    const { data, error } = await dbClient
        .from('stock_items')
        .insert([payload])
        .select('id, product_name')
        .single();
    if (error) throw error;
    return data;
}

async function saveBom(event) {
    event.preventDefault();
    clearStatus();
    const productCode = (bomParentSkuInput?.value || '').trim();
    if (!productCode) {
        showStatus('กรุณากรอก SKU หลัก', 'error');
        return;
    }

    try {
        const components = getComponentsFromForm();
        if (!components.length) {
            showStatus('กรุณาเพิ่มอย่างน้อย 1 ชิ้นส่วน', 'error');
            return;
        }

        // ensure parent exists
        await ensureStockItemExists(productCode, null);

        // ensure each component exists (and update name if provided)
        for (const c of components) {
            await ensureStockItemExists(c.code, c.name);
        }

        // If editing an existing parent BOM, remove old rows for that parent
        if (selectedBomParent || selectedBomId) {
            const parentToDelete = productCode;
            const { error: delErr } = await dbClient.from('stock_bom').delete().eq('product_code', parentToDelete);
            if (delErr) throw delErr;
        }

        const payloads = components.map(c => ({ product_code: productCode, component_product_code: c.code, component_qty: c.qty }));
        const { error } = await dbClient.from('stock_bom').insert(payloads);
        if (error) throw error;
        showStatus('เพิ่ม/อัปเดต BOM สำเร็จแล้ว', 'success');

        resetBomForm(true);
        await loadBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`บันทึก BOM ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function deleteBom() {
    if (!selectedBomId) {
        showStatus('กรุณาเลือก BOM ที่ต้องการลบก่อน', 'error');
        return;
    }

    if (!confirm('ยืนยันการลบรายการ BOM นี้?')) return;

    try {
        const { error } = await dbClient.from('stock_bom').delete().eq('id', selectedBomId);
        if (error) throw error;
        showStatus('ลบ BOM สำเร็จแล้ว', 'success');
        resetBomForm(true);
        await loadBomRows();
    } catch (error) {
        console.error(error);
        showStatus(`ลบ BOM ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

function clearBomForm() {
    resetBomForm();
    hideSuggestions();
}

function handleTableClick(event) {
    const row = event.target.closest('tr[data-bom-id]');
    if (!row) return;
    const id = Number(row.dataset.bomId);
    const bomRow = bomRows.find(item => item.id === id);
    if (!bomRow) return;
    setBomForm(bomRow);
}

function handleDocumentClick(event) {
    const target = event.target;
    const insideChild = bomSuggestionsEl && bomSuggestionsEl.contains(target);
    const insideParent = bomParentSuggestionsEl && bomParentSuggestionsEl.contains(target);
    const isChildInput = target.id === 'bomChildSku';
    const isParentInput = target.id === 'bomParentSku';
    if (!insideChild && !insideParent && !isChildInput && !isParentInput) {
        hideSuggestions();
    }
}

function initializePage() {
    dbClient = window.auth?.supabase || (window.supabase && window.SUPABASE_CONFIG
        ? window.supabase.createClient(window.SUPABASE_CONFIG.URL, window.SUPABASE_CONFIG.KEY)
        : null);

    if (!dbClient) {
        showStatus('ไม่พบ Supabase client กรุณาตรวจสอบ config.js', 'error');
        return;
    }

    bomForm.addEventListener('submit', saveBom);
    deleteBomBtn.addEventListener('click', deleteBom);
    clearBomBtn.addEventListener('click', clearBomForm);
    refreshBtn.addEventListener('click', loadBomRows);
    bomTableBody.addEventListener('click', handleTableClick);
    bomSearchInput.addEventListener('input', renderBomRows);
    // addComponent button
    if (addComponentBtn) addComponentBtn.addEventListener('click', () => addComponentRow());
    // Parent SKU autocomplete listeners
    if (bomParentSkuInput) {
        bomParentSkuInput.addEventListener('input', handleParentSearchInput);
    }
    if (bomParentSuggestionsEl) {
        bomParentSuggestionsEl.addEventListener('click', event => {
            const item = event.target.closest('.suggestion-item');
            if (!item) return;
            fillParentSku(item.dataset.code, item.dataset.name);
        });
    }
    document.addEventListener('click', handleDocumentClick);

    resetBomForm();
    // ensure there's at least one empty component row
    if (componentsListEl && !componentsListEl.querySelector('.component-row')) addComponentRow();
    loadBomRows();
}

document.addEventListener('DOMContentLoaded', initializePage);
