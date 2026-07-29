// === js/supplies.js ===
// 📦 비품 관리 — 데이터 관리·로케이션 관리처럼 별도 탭(페이지)으로 동작한다.
//
// 저장: artifacts/team-work-logger-v2/persistent_data/supplies  (단일 문서 { items: [...] })
//  - 비품은 수십 건 규모라 문서 하나로 관리하는 편이 읽기·쓰기 모두 저렴하다.
//  - 각 비품은 종류·현재고를 기본으로 하고, 단가/사이즈/발주정보/업체 등 상세를 함께 보관한다.

import { initializeFirebase } from './config.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const DOC_REF = doc(db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'supplies');

// 처음 열었을 때 자동으로 만들어 두는 기본 비품
const SEED_ITEMS = [
    { name: '택배봉투', category: '포장자재', unit: '장', isMain: true },
    { name: '포장봉투', category: '포장자재', unit: '장', isMain: true }
];

const MAX_LOG = 30; // 비품당 보관하는 재고 변동 이력 개수

let items = [];
let currentUser = '';
let editingId = null;
let stockTargetId = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => Number(v) || 0;
const fmt = (v) => num(v).toLocaleString();
const uid = () => 'sup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const isLow = (it) => num(it.safetyStock) > 0 && num(it.stock) <= num(it.safetyStock);
const stockValueOf = (it) => num(it.stock) * num(it.unitPrice);

// ───────── 인증 게이트 ─────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        $('auth-gate').classList.remove('hidden');
        $('main').classList.add('hidden');
        return;
    }
    currentUser = user.email || 'unknown';
    $('auth-gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    await load();
    renderAll();
});

// ───────── 저장소 ─────────
async function load() {
    try {
        const snap = await getDoc(DOC_REF);
        if (snap.exists() && Array.isArray(snap.data().items)) {
            items = snap.data().items;
        } else {
            // 최초 진입 — 기본 비품(택배봉투·포장봉투) 생성
            items = SEED_ITEMS.map(s => ({
                id: uid(), stock: 0, safetyStock: 0, unitPrice: 0,
                size: '', vendor: '', vendorContact: '', orderUnit: '',
                leadTimeDays: 0, lastOrderDate: '', memo: '', logs: [], ...s
            }));
            await persist();
        }
    } catch (e) {
        console.error('비품 데이터 로드 실패:', e);
        alert('비품 데이터를 불러오지 못했습니다: ' + (e.message || e));
    }
}

async function persist() {
    await setDoc(DOC_REF, { items, updatedAt: new Date().toISOString(), updatedBy: currentUser });
}

// ───────── 렌더 ─────────
function renderAll() {
    renderMainItems();
    renderSummary();
    renderCategoryFilter();
    renderTable();
}

function renderMainItems() {
    const host = $('main-items');
    const mains = items.filter(i => i.isMain);
    if (mains.length === 0) {
        host.innerHTML = `<div class="col-span-full text-xs text-slate-400 bg-white border border-dashed border-slate-300 rounded-xl p-4 text-center">
            주요 비품으로 지정된 항목이 없습니다. 비품 수정에서 '주요 비품으로 상단에 고정'을 켜보세요.</div>`;
        return;
    }
    host.innerHTML = mains.map(it => {
        const low = isLow(it);
        return `
        <div class="bg-white rounded-2xl border ${low ? 'border-red-300' : 'border-slate-200'} shadow-sm p-4">
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold text-slate-400">${esc(it.category || '비품')}</div>
                    <div class="text-base font-extrabold text-slate-800 truncate">${esc(it.name)}</div>
                </div>
                ${low ? '<span class="text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-600 shrink-0">재고 부족</span>' : ''}
            </div>
            <div class="mt-3 flex items-end gap-1">
                <span class="text-3xl font-black ${low ? 'text-red-600' : 'text-slate-800'}">${fmt(it.stock)}</span>
                <span class="text-xs font-bold text-slate-400 mb-1">${esc(it.unit || '개')}</span>
            </div>
            <div class="text-[11px] text-slate-500 mt-1">
                ${num(it.safetyStock) > 0 ? `안전재고 ${fmt(it.safetyStock)}${esc(it.unit || '개')} · ` : ''}
                ${num(it.unitPrice) > 0 ? `단가 ${fmt(it.unitPrice)}원` : '단가 미등록'}
            </div>
            <div class="flex gap-2 mt-3">
                <button data-stock="${esc(it.id)}" class="flex-1 text-xs font-bold py-2 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100">재고 조정</button>
                <button data-edit="${esc(it.id)}" class="text-xs font-bold py-2 px-3 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">상세</button>
            </div>
        </div>`;
    }).join('');
}

function renderSummary() {
    const totalValue = items.reduce((s, i) => s + stockValueOf(i), 0);
    const lowCount = items.filter(isLow).length;
    const categories = new Set(items.map(i => i.category || '미분류'));

    const card = (label, value, tone = 'text-slate-800') => `
        <div class="bg-white rounded-xl border border-slate-200 p-3">
            <div class="text-[11px] font-bold text-slate-400">${label}</div>
            <div class="text-lg font-black ${tone} mt-0.5">${value}</div>
        </div>`;

    $('summary').innerHTML =
        card('등록 비품', `${items.length}종`) +
        card('종류', `${categories.size}개`) +
        card('재고 부족', `${lowCount}종`, lowCount > 0 ? 'text-red-600' : 'text-slate-800') +
        card('총 재고금액', `${fmt(Math.round(totalValue))}원`);
}

function renderCategoryFilter() {
    const sel = $('filter-category');
    const prev = sel.value;
    const cats = Array.from(new Set(items.map(i => i.category || '미분류'))).sort();
    sel.innerHTML = `<option value="">전체 종류</option>` + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (cats.includes(prev)) sel.value = prev;

    $('category-list').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}

function visibleItems() {
    const cat = $('filter-category').value;
    const kw = $('filter-search').value.trim().toLowerCase();
    const lowOnly = $('filter-low').checked;

    return items.filter(it => {
        if (cat && (it.category || '미분류') !== cat) return false;
        if (lowOnly && !isLow(it)) return false;
        if (kw) {
            const hay = `${it.name} ${it.category} ${it.vendor} ${it.size} ${it.memo}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    }).sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || String(a.category || '').localeCompare(String(b.category || '')) || String(a.name).localeCompare(String(b.name)));
}

function renderTable() {
    const list = visibleItems();
    const body = $('items-body');
    $('empty-state').classList.toggle('hidden', list.length > 0);

    body.innerHTML = list.map(it => {
        const low = isLow(it);
        const orderParts = [];
        if (it.orderUnit) orderParts.push(esc(it.orderUnit));
        if (num(it.leadTimeDays) > 0) orderParts.push(`리드타임 ${num(it.leadTimeDays)}일`);
        if (it.lastOrderDate) orderParts.push(`최근발주 ${esc(it.lastOrderDate)}`);
        if (it.memo) orderParts.push(esc(it.memo));

        return `
        <tr>
            <td class="text-slate-500">${esc(it.category || '미분류')}</td>
            <td class="font-bold">${it.isMain ? '<span class="text-amber-500 mr-1">★</span>' : ''}${esc(it.name)}</td>
            <td class="num font-bold ${low ? 'text-red-600' : ''}">${fmt(it.stock)} <span class="text-[11px] font-normal text-slate-400">${esc(it.unit || '개')}</span></td>
            <td class="num text-slate-500">${num(it.safetyStock) > 0 ? fmt(it.safetyStock) : '-'}</td>
            <td class="num">${num(it.unitPrice) > 0 ? fmt(it.unitPrice) + '원' : '-'}</td>
            <td class="num text-slate-600">${stockValueOf(it) > 0 ? fmt(Math.round(stockValueOf(it))) + '원' : '-'}</td>
            <td class="text-slate-600">${esc(it.size || '-')}</td>
            <td class="text-slate-600">${esc(it.vendor || '-')}${it.vendorContact ? `<div class="text-[11px] text-slate-400">${esc(it.vendorContact)}</div>` : ''}</td>
            <td class="text-slate-500 text-[12px] max-w-[16rem]">${orderParts.length ? orderParts.join(' · ') : '-'}</td>
            <td class="text-center whitespace-nowrap">
                <button data-stock="${esc(it.id)}" class="text-[11px] font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100">재고</button>
                <button data-edit="${esc(it.id)}" class="text-[11px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">수정</button>
            </td>
        </tr>`;
    }).join('');
}

// ───────── 비품 추가/수정 모달 ─────────
function openItemModal(id = null) {
    editingId = id;
    const it = id ? items.find(x => x.id === id) : null;

    $('item-modal-title').textContent = it ? '✏️ 비품 수정' : '➕ 비품 추가';
    $('btn-delete-item').classList.toggle('hidden', !it);
    showError('item-modal-error', '');

    $('f-name').value = it?.name || '';
    $('f-category').value = it?.category || '';
    $('f-stock').value = it ? num(it.stock) : '';
    $('f-unit').value = it?.unit || '';
    $('f-safety').value = it ? (num(it.safetyStock) || '') : '';
    $('f-price').value = it ? (num(it.unitPrice) || '') : '';
    $('f-size').value = it?.size || '';
    $('f-vendor').value = it?.vendor || '';
    $('f-vendor-contact').value = it?.vendorContact || '';
    $('f-order-unit').value = it?.orderUnit || '';
    $('f-leadtime').value = it ? (num(it.leadTimeDays) || '') : '';
    $('f-last-order').value = it?.lastOrderDate || '';
    $('f-memo').value = it?.memo || '';
    $('f-main').checked = !!it?.isMain;

    openModal('item-modal');
    setTimeout(() => $('f-name').focus(), 30);
}

async function saveItem() {
    const name = $('f-name').value.trim();
    if (!name) return showError('item-modal-error', '품명을 입력해주세요.');

    const dup = items.find(x => x.name === name && x.id !== editingId);
    if (dup) return showError('item-modal-error', '같은 품명의 비품이 이미 있습니다.');

    const data = {
        name,
        category: $('f-category').value.trim() || '미분류',
        stock: num($('f-stock').value),
        unit: $('f-unit').value.trim() || '개',
        safetyStock: num($('f-safety').value),
        unitPrice: num($('f-price').value),
        size: $('f-size').value.trim(),
        vendor: $('f-vendor').value.trim(),
        vendorContact: $('f-vendor-contact').value.trim(),
        orderUnit: $('f-order-unit').value.trim(),
        leadTimeDays: num($('f-leadtime').value),
        lastOrderDate: $('f-last-order').value,
        memo: $('f-memo').value.trim(),
        isMain: $('f-main').checked,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser
    };

    const btn = $('btn-save-item');
    btn.disabled = true;
    try {
        if (editingId) {
            const idx = items.findIndex(x => x.id === editingId);
            const before = num(items[idx].stock);
            items[idx] = { ...items[idx], ...data };
            // 수정 화면에서 현재고를 직접 바꾼 경우도 이력에 남긴다.
            if (before !== data.stock) pushLog(items[idx], 'set', data.stock - before, data.stock, '상세 수정에서 변경');
        } else {
            items.push({ id: uid(), logs: [], ...data });
        }
        await persist();
        closeModal('item-modal');
        renderAll();
    } catch (e) {
        showError('item-modal-error', '저장 실패: ' + (e.message || e));
    } finally {
        btn.disabled = false;
    }
}

async function deleteItem() {
    const it = items.find(x => x.id === editingId);
    if (!it) return;
    if (!confirm(`'${it.name}' 비품을 삭제할까요?\n재고 변동 이력도 함께 사라집니다.`)) return;
    items = items.filter(x => x.id !== editingId);
    try {
        await persist();
        closeModal('item-modal');
        renderAll();
    } catch (e) {
        showError('item-modal-error', '삭제 실패: ' + (e.message || e));
    }
}

// ───────── 재고 조정 모달 ─────────
function pushLog(it, op, delta, after, memo) {
    if (!Array.isArray(it.logs)) it.logs = [];
    it.logs.unshift({
        at: new Date().toISOString(), by: currentUser,
        op, delta, after, memo: memo || ''
    });
    it.logs = it.logs.slice(0, MAX_LOG);
}

function currentStockOp() {
    return document.querySelector('input[name="stock-op"]:checked')?.value || 'in';
}

function updateStockPreview() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;
    const qty = num($('stock-qty').value);
    const op = currentStockOp();
    const after = op === 'in' ? num(it.stock) + qty : (op === 'out' ? num(it.stock) - qty : qty);
    $('stock-preview').textContent = `${fmt(Math.max(0, after))} ${it.unit || '개'}${after < 0 ? ' (재고 부족)' : ''}`;
}

function openStockModal(id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    stockTargetId = id;

    $('stock-modal-title').textContent = `${it.name} — 재고 조정`;
    $('stock-current').textContent = `${fmt(it.stock)} ${it.unit || '개'}`;
    $('stock-qty').value = '';
    $('stock-memo').value = '';
    document.querySelector('input[name="stock-op"][value="in"]').checked = true;
    showError('stock-modal-error', '');
    updateStockPreview();

    const logs = Array.isArray(it.logs) ? it.logs : [];
    $('stock-log').innerHTML = logs.length === 0
        ? '<div class="text-[11px] text-slate-400 text-center py-2">재고 변동 이력이 없습니다.</div>'
        : `<div class="text-[11px] font-bold text-slate-500 mb-1">최근 변동 이력</div>` + logs.map(l => {
            const label = l.op === 'in' ? '입고' : (l.op === 'out' ? '사용' : '실사');
            const tone = l.delta > 0 ? 'text-emerald-600' : (l.delta < 0 ? 'text-red-600' : 'text-slate-500');
            return `<div class="text-[11px] text-slate-500 flex justify-between gap-2">
                <span>${esc(String(l.at).slice(0, 10))} ${label}${l.memo ? ` · ${esc(l.memo)}` : ''}</span>
                <span class="${tone} font-bold shrink-0">${l.delta > 0 ? '+' : ''}${fmt(l.delta)} → ${fmt(l.after)}</span>
            </div>`;
        }).join('');

    openModal('stock-modal');
    setTimeout(() => $('stock-qty').focus(), 30);
}

async function saveStock() {
    const it = items.find(x => x.id === stockTargetId);
    if (!it) return;

    const qty = num($('stock-qty').value);
    const op = currentStockOp();
    if (qty <= 0 && op !== 'set') return showError('stock-modal-error', '수량을 입력해주세요.');

    const before = num(it.stock);
    const after = op === 'in' ? before + qty : (op === 'out' ? before - qty : qty);
    if (after < 0) return showError('stock-modal-error', '재고가 0보다 작아질 수 없습니다.');

    const btn = $('btn-save-stock');
    btn.disabled = true;
    try {
        it.stock = after;
        it.updatedAt = new Date().toISOString();
        it.updatedBy = currentUser;
        // 입고는 발주가 들어온 것으로 보고 최근 발주일을 갱신하지 않는다(발주일은 상세에서 직접 관리).
        pushLog(it, op, after - before, after, $('stock-memo').value.trim());
        await persist();
        closeModal('stock-modal');
        renderAll();
    } catch (e) {
        showError('stock-modal-error', '저장 실패: ' + (e.message || e));
    } finally {
        btn.disabled = false;
    }
}

// ───────── 모달 공통 ─────────
function openModal(id) { const m = $(id); m.classList.remove('hidden'); m.classList.add('flex'); }
function closeModal(id) { const m = $(id); m.classList.add('hidden'); m.classList.remove('flex'); }
function showError(id, msg) { const el = $(id); el.textContent = msg; el.classList.toggle('hidden', !msg); }

// ───────── 이벤트 ─────────
$('btn-add-item').addEventListener('click', () => openItemModal(null));
$('btn-save-item').addEventListener('click', saveItem);
$('btn-delete-item').addEventListener('click', deleteItem);
$('btn-save-stock').addEventListener('click', saveStock);
$('btn-refresh').addEventListener('click', async () => { await load(); renderAll(); });
$('btn-close').addEventListener('click', () => window.close());

['filter-category', 'filter-search', 'filter-low'].forEach(id => {
    $(id).addEventListener('input', renderTable);
    $(id).addEventListener('change', renderTable);
});

$('stock-qty').addEventListener('input', updateStockPreview);
document.querySelectorAll('input[name="stock-op"]').forEach(r => r.addEventListener('change', updateStockPreview));

document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
        const m = btn.closest('.fixed');
        if (m) closeModal(m.id);
    });
});

// 목록/카드의 [재고]·[수정] 버튼 — 이벤트 위임
document.addEventListener('click', (e) => {
    const stockBtn = e.target.closest('[data-stock]');
    if (stockBtn) return openStockModal(stockBtn.dataset.stock);
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) return openItemModal(editBtn.dataset.edit);
});
