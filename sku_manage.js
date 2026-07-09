const skuForm = document.getElementById('skuForm');
const statusEl = document.getElementById('formStatus');
const skuTableBody = document.getElementById('skuTableBody');
const skuCountEl = document.getElementById('skuCount');
const skuSearchInput = document.getElementById('skuSearch');
const submitBtn = document.getElementById('submitBtn');
const deleteBtn = document.getElementById('deleteBtn');
const newSkuBtn = document.getElementById('newSkuBtn');

let dbClient = null;
let skuRows = [];
let selectedProductCode = null;

function showStatus(message, type = 'success') {
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
}

function clearStatus() {
    statusEl.textContent = '';
    statusEl.className = 'status-message';
}

function populateSelect(selectEl, rows, valueKey, labelKey, placeholderLabel = '-- ไม่ระบุ --') {
    if (!selectEl) return;
    const currentValue = selectEl.value;
    selectEl.innerHTML = `<option value="">${placeholderLabel}</option>`;
    rows.forEach(row => {
        const value = row[valueKey];
        const label = row[labelKey];
        if (value === null || value === undefined) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = String(label ?? value);
        selectEl.appendChild(option);
    });
    if (currentValue) {
        selectEl.value = currentValue;
    }
}

function resetForm() {
    skuForm.reset();
    document.getElementById('slots').value = '1';
    document.getElementById('price').value = '0';
    selectedProductCode = null;
    document.getElementById('productCode').focus();
}

function renderSkuRows() {
    const term = (skuSearchInput.value || '').trim().toLowerCase();
    const filtered = skuRows.filter(row => {
        if (!term) return true;
        return [row.product_code, row.name, row.size, row.product_prefix, row.pattern].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
    });

    skuCountEl.textContent = `${filtered.length} รายการ`;
    if (!filtered.length) {
        skuTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">ไม่พบข้อมูล SKU</td></tr>';
        return;
    }

    skuTableBody.innerHTML = filtered.map(row => `
        <tr data-product-code="${row.product_code}" class="${selectedProductCode === row.product_code ? 'active' : ''}">
            <td>${row.product_code || '-'}</td>
            <td>${row.name || '-'}</td>
            <td>${row.size || '-'}</td>
            <td>${row.price != null ? Number(row.price).toLocaleString('th-TH', {maximumFractionDigits:2}) : '-'}</td>
        </tr>
    `).join('');
}

async function loadLookups() {
    if (!dbClient) return;
    const requests = [
        dbClient.from('products').select('product_prefix, product_name').order('product_prefix', { ascending: true }),
        dbClient.from('aluminum_colors').select('color_code, color_name').order('color_code', { ascending: true }),
        dbClient.from('glass_colors').select('color_code, color_name').order('color_code', { ascending: true }),
        dbClient.from('mosquito_nets').select('net_id, net_status').order('net_id', { ascending: true })
    ];

    const [productsRes, frameRes, glassRes, netRes] = await Promise.allSettled(requests);
    const productSelect = document.getElementById('productPrefix');
    const frameColorSelect = document.getElementById('frameColor');
    const glassColorSelect = document.getElementById('glassColor');
    const netSelect = document.getElementById('netId');

    if (productsRes.status === 'fulfilled' && !productsRes.value.error) {
        populateSelect(productSelect, (productsRes.value.data || []).map(item => ({ product_prefix: item.product_prefix, product_name: `${item.product_prefix} - ${item.product_name}` })), 'product_prefix', 'product_name');
    }

    if (frameRes.status === 'fulfilled' && !frameRes.value.error) {
        populateSelect(frameColorSelect, frameRes.value.data || [], 'color_code', 'color_name');
    }

    if (glassRes.status === 'fulfilled' && !glassRes.value.error) {
        populateSelect(glassColorSelect, glassRes.value.data || [], 'color_code', 'color_name');
    }

    if (netRes.status === 'fulfilled' && !netRes.value.error) {
        populateSelect(netSelect, netRes.value.data || [], 'net_id', 'net_status');
    }
}

async function ensurePatternCodeUnique(patternCode, patternName, productCode) {
    const code = String(patternCode || '').trim();
    if (!code || !dbClient) return true;

    const { data: existingPattern, error: patternError } = await dbClient
        .from('patterns')
        .select('pattern_code')
        .eq('pattern_code', code)
        .maybeSingle();

    if (patternError) {
        console.warn('ตรวจสอบ patterns ล้มเหลว:', patternError);
        return false;
    }

    if (existingPattern) {
        if (!productCode) {
            return false;
        }

        const { data: existingSku, error: skuError } = await dbClient
            .from('sku_master')
            .select('pattern_code')
            .eq('product_code', productCode)
            .maybeSingle();

        if (skuError) {
            console.warn('ตรวจสอบ sku_master ล้มเหลว:', skuError);
            return false;
        }

        return existingSku?.pattern_code === code;
    }

    const { error: insertError } = await dbClient.from('patterns').insert([{
        pattern_code: code,
        pattern_name: String(patternName || code)
    }]);

    if (insertError) {
        console.warn('สร้าง pattern ใหม่ล้มเหลว:', insertError);
        return false;
    }

    return true;
}

async function loadSkus() {
    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        return;
    }

    try {
        const { data, error } = await dbClient
            .from('sku_master')
            .select('product_code, name, size, price, product_prefix, pattern, pattern_code, frame_color_code, glass_color_code, net_id')
            .order('product_code', { ascending: true });

        if (error) throw error;
        skuRows = data || [];
        renderSkuRows();
    } catch (error) {
        console.error(error);
        showStatus(`โหลด SKU ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function loadSelectedSku(productCode) {
    if (!dbClient || !productCode) return;
    try {
        const { data, error } = await dbClient
            .from('sku_master')
            .select('product_code, name, size, price, product_prefix, pattern, pattern_code, frame_color_code, glass_color_code, net_id')
            .eq('product_code', productCode)
            .maybeSingle();

        if (error) throw error;
        if (!data) return;

        document.getElementById('productCode').value = data.product_code || '';
        document.getElementById('name').value = data.name || '';
        document.getElementById('size').value = data.size || '';
        document.getElementById('slots').value = '1';
        document.getElementById('price').value = data.price ?? '0';
        document.getElementById('productPrefix').value = data.product_prefix || '';
        document.getElementById('pattern').value = data.pattern || '';
        document.getElementById('patternCode').value = data.pattern_code || '';
        document.getElementById('frameColor').value = data.frame_color_code || '';
        document.getElementById('glassColor').value = data.glass_color_code || '';
        document.getElementById('netId').value = data.net_id != null ? String(data.net_id) : '';
        selectedProductCode = data.product_code;
        renderSkuRows();
    } catch (error) {
        console.error(error);
        showStatus(`โหลดรายละเอียด SKU ไม่สำเร็จ: ${error.message}`, 'error');
    }
}

async function handleSubmit(event) {
    event.preventDefault();
    clearStatus();
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก...';

    if (!dbClient) {
        showStatus('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึก SKU';
        return;
    }

    const payload = {
        product_code: document.getElementById('productCode').value.trim(),
        name: document.getElementById('name').value.trim(),
        product_prefix: document.getElementById('productPrefix').value || null,
        size: document.getElementById('size').value.trim(),
        slots: Number(document.getElementById('slots').value || 1),
        pattern: document.getElementById('pattern').value.trim() || null,
        pattern_code: document.getElementById('patternCode').value || null,
        price: Number(document.getElementById('price').value || 0),
        net_id: document.getElementById('netId').value ? Number(document.getElementById('netId').value) : null,
        frame_color_code: document.getElementById('frameColor').value || null,
        glass_color_code: document.getElementById('glassColor').value || null
    };

    if (!payload.product_code || !payload.name || !payload.size) {
        showStatus('กรุณากรอก SKU, ชื่อสินค้า และขนาดให้ครบ', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึก SKU';
        return;
    }

    try {
        if (payload.pattern_code) {
            const ok = await ensurePatternCodeUnique(payload.pattern_code, payload.pattern, payload.product_code);
            if (!ok) {
                throw new Error('รหัสลายนี้ถูกใช้แล้ว กรุณาใส่รหัสใหม่');
            }
        }

        const { error } = await dbClient.from('sku_master').upsert([payload], { onConflict: 'product_code' });
        if (error) throw error;
        showStatus('บันทึก SKU สำเร็จแล้ว', 'success');
        selectedProductCode = payload.product_code;
        await loadSkus();
        await loadSelectedSku(payload.product_code);
    } catch (error) {
        console.error(error);
        showStatus(`บันทึกไม่สำเร็จ: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 บันทึก SKU';
    }
}

async function handleDelete() {
    const code = document.getElementById('productCode').value.trim();
    if (!code) return;
    if (!confirm(`ลบ SKU ${code} จริงหรือไม่?`)) return;

    try {
        const { error } = await dbClient.from('sku_master').delete().eq('product_code', code);
        if (error) throw error;
        showStatus('ลบ SKU สำเร็จแล้ว', 'success');
        resetForm();
        await loadSkus();
    } catch (error) {
        console.error(error);
        showStatus(`ลบ SKU ไม่สำเร็จ: ${error.message}`, 'error');
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

    skuForm.addEventListener('submit', handleSubmit);
    deleteBtn.addEventListener('click', handleDelete);
    newSkuBtn.addEventListener('click', resetForm);
    skuSearchInput.addEventListener('input', renderSkuRows);
    skuTableBody.addEventListener('click', event => {
        const row = event.target.closest('tr[data-product-code]');
        if (!row) return;
        const productCode = row.dataset.productCode;
        selectedProductCode = productCode;
        renderSkuRows();
        loadSelectedSku(productCode);
    });

    resetForm();
    loadLookups();
    loadSkus();
}

document.addEventListener('DOMContentLoaded', initializePage);
