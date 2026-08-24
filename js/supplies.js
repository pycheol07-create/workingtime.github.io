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

/** 발주정보 칸에 들어가는 문자열 — 표시와 필터가 같은 값을 보도록 한 곳에서 만든다. */
function orderInfoOf(it) {
    const parts = [];
    if (it.orderUnit) parts.push(it.orderUnit);
    if (num(it.leadTimeDays) > 0) parts.push(`리드타임 ${num(it.leadTimeDays)}일`);
    if (it.lastOrderDate) parts.push(`최근발주 ${it.lastOrderDate}`);
    if (it.memo) parts.push(it.memo);
    return parts.join(' · ');
}

// ───────── 목록 컬럼 정의 (헤더 정렬·필터의 기준) ─────────
// type: 'text' → 값 목록 체크박스 필터 / 'num' → 최소·최대 범위 필터
const COLS = [
    { key: 'category',   label: '종류',     type: 'text', get: it => it.category || '미분류' },
    { key: 'name',       label: '품명',     type: 'text', get: it => it.name || '' },
    { key: 'stock',      label: '현재고',   type: 'num',  get: it => num(it.stock) },
    { key: 'safetyStock',label: '안전재고', type: 'num',  get: it => num(it.safetyStock) },
    { key: 'unitPrice',  label: '단가',     type: 'num',  get: it => num(it.unitPrice) },
    { key: 'stockValue', label: '재고금액', type: 'num',  get: it => stockValueOf(it) },
    { key: 'size',       label: '사이즈',   type: 'text', get: it => it.size || '' },
    { key: 'vendor',     label: '업체',     type: 'text', get: it => it.vendor || '' },
    { key: 'orderInfo',  label: '발주정보', type: 'text', get: it => orderInfoOf(it) }
];
const colOf = (key) => COLS.find(c => c.key === key);
const NUM_COLS = new Set(COLS.filter(c => c.type === 'num').map(c => c.key));

// 헤더에서 고른 정렬·필터 상태
let sortState = { key: '', dir: 'asc' };
// { [key]: Set<string> }  — 값이 있으면 그 값들만 통과. text 컬럼 전용
const textFilters = {};
// { [key]: { min, max } } — 빈 문자열이면 제한 없음. num 컬럼 전용
const numFilters = {};

const hasColFilter = (key) =>
    (textFilters[key] && textFilters[key].size > 0) ||
    (numFilters[key] && (numFilters[key].min !== '' || numFilters[key].max !== ''));
const anyFilterActive = () =>
    COLS.some(c => hasColFilter(c.key)) || !!sortState.key ||
    !!$('filter-category').value || !!$('filter-search').value.trim() || $('filter-low').checked;

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

/** 상단 도구모음 + 헤더 필터를 모두 통과한 항목. */
function visibleItems() {
    const cat = $('filter-category').value;
    const kw = $('filter-search').value.trim().toLowerCase();
    const lowOnly = $('filter-low').checked;

    const list = items.filter(it => {
        if (cat && (it.category || '미분류') !== cat) return false;
        if (lowOnly && !isLow(it)) return false;
        if (kw) {
            const hay = `${it.name} ${it.category} ${it.vendor} ${it.size} ${it.memo}`.toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        // 헤더에서 고른 컬럼별 필터 — 모두 만족해야 통과(AND)
        for (const col of COLS) {
            const picked = textFilters[col.key];
            if (picked && picked.size > 0 && !picked.has(String(col.get(it)))) return false;
            const range = numFilters[col.key];
            if (range) {
                const v = num(col.get(it));
                if (range.min !== '' && v < num(range.min)) return false;
                if (range.max !== '' && v > num(range.max)) return false;
            }
        }
        return true;
    });

    if (sortState.key) {
        const col = colOf(sortState.key);
        const sign = sortState.dir === 'desc' ? -1 : 1;
        list.sort((a, b) => {
            const va = col.get(a), vb = col.get(b);
            const r = (col.type === 'num') ? (num(va) - num(vb)) : String(va).localeCompare(String(vb), 'ko');
            return r * sign || String(a.name).localeCompare(String(b.name), 'ko');
        });
        return list;
    }
    // 기본 정렬 — 주요 비품 먼저, 그다음 종류·품명
    return list.sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0)
        || String(a.category || '').localeCompare(String(b.category || ''))
        || String(a.name).localeCompare(String(b.name)));
}

/** 헤더 — 컬럼마다 정렬 버튼과 필터 버튼을 붙인다. */
function renderHead() {
    const head = $('items-head');
    if (!head) return;
    head.innerHTML = COLS.map(c => {
        const on = sortState.key === c.key;
        const ic = on ? (sortState.dir === 'asc' ? '▲' : '▼') : '↕';
        return `<th class="${c.type === 'num' ? 'num' : ''}">
            <div class="th-wrap">
                <button type="button" class="th-sort ${on ? 'active' : ''}" data-sort="${c.key}"
                    title="클릭해서 정렬 (오름차순 → 내림차순 → 해제)">${esc(c.label)} <span class="th-ic">${ic}</span></button>
                <button type="button" class="th-filter ${hasColFilter(c.key) ? 'on' : ''}" data-filter="${c.key}"
                    title="${esc(c.label)} 필터" aria-label="${esc(c.label)} 필터">▼</button>
            </div>
        </th>`;
    }).join('') + '<th class="text-center">관리</th>';

    $('btn-reset-filters').classList.toggle('hidden', !anyFilterActive());
}

function renderTable() {
    renderHead();
    const list = visibleItems();
    const body = $('items-body');
    $('empty-state').classList.toggle('hidden', list.length > 0);
    if (items.length > 0) {
        $('empty-state').innerHTML = '조건에 맞는 비품이 없습니다. 필터를 확인해 주세요.';
    }

    body.innerHTML = list.map(it => {
        const low = isLow(it);
        const orderInfo = orderInfoOf(it);

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
            <td class="text-slate-500 text-[12px] max-w-[16rem]">${orderInfo ? esc(orderInfo) : '-'}</td>
            <td class="text-center whitespace-nowrap">
                <button data-stock="${esc(it.id)}" class="text-[11px] font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100">재고</button>
                <button data-edit="${esc(it.id)}" class="text-[11px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">수정</button>
            </td>
        </tr>`;
    }).join('');
}

// ───────── 헤더 필터 팝업 ─────────
// 표가 overflow 컨테이너 안에 있어 잘리므로, 팝업은 body에 붙이고 좌표로 띄운다.
let openFilterKey = null;

function closeFilterPop() {
    document.querySelectorAll('.flt-pop').forEach(p => p.remove());
    openFilterKey = null;
}

function openFilterPop(key, anchor) {
    if (openFilterKey === key) return closeFilterPop();
    closeFilterPop();
    openFilterKey = key;

    const col = colOf(key);
    const pop = document.createElement('div');
    pop.className = 'flt-pop';
    pop.dataset.key = key;

    if (col.type === 'num') {
        const r = numFilters[key] || { min: '', max: '' };
        pop.innerHTML = `
            <div class="font-bold text-slate-600 mb-2">${esc(col.label)} 범위</div>
            <div class="flex items-center gap-1">
                <input type="number" class="inp" style="padding:5px 7px;font-size:12px" data-min placeholder="최소" value="${esc(r.min)}">
                <span class="text-slate-400">~</span>
                <input type="number" class="inp" style="padding:5px 7px;font-size:12px" data-max placeholder="최대" value="${esc(r.max)}">
            </div>
            <div class="text-right mt-2"><button type="button" class="flt-btn" data-clear>초기화</button></div>`;
    } else {
        // 값 목록은 '이 컬럼을 뺀 나머지 필터'를 통과한 항목에서 뽑는다(엑셀과 같은 방식).
        const others = items.filter(it => COLS.every(c => {
            if (c.key === key) return true;
            const picked = textFilters[c.key];
            if (picked && picked.size > 0 && !picked.has(String(c.get(it)))) return false;
            const range = numFilters[c.key];
            if (range) {
                const v = num(c.get(it));
                if (range.min !== '' && v < num(range.min)) return false;
                if (range.max !== '' && v > num(range.max)) return false;
            }
            return true;
        }));
        const counts = new Map();
        others.forEach(it => {
            const v = String(col.get(it));
            counts.set(v, (counts.get(v) || 0) + 1);
        });
        const picked = textFilters[key];
        const values = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'ko'));
        pop.innerHTML = `
            <div class="flex items-center justify-between gap-1 mb-1">
                <span class="font-bold text-slate-600">${esc(col.label)}</span>
                <span><button type="button" class="flt-btn" data-all>전체</button><button type="button" class="flt-btn" data-none>해제</button></span>
            </div>
            <input type="search" class="inp" style="padding:5px 7px;font-size:12px" data-q placeholder="값 검색">
            <div class="flt-list">${
                values.length === 0
                    ? '<div class="text-slate-400 text-center py-2">값이 없습니다.</div>'
                    : values.map(v => `
                    <label class="flt-row" data-v="${esc(v)}">
                        <input type="checkbox" data-val="${esc(v)}" ${(!picked || picked.size === 0 || picked.has(v)) ? 'checked' : ''}>
                        <span title="${esc(v)}">${esc(v === '' ? '(빈 값)' : v)}</span>
                        <span class="flt-cnt">${counts.get(v)}</span>
                    </label>`).join('')
            }</div>`;
    }

    document.body.appendChild(pop);

    // 화면 밖으로 나가지 않게 위치 보정
    const a = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (a.bottom + h + 8 > window.innerHeight ? Math.max(8, a.top - h - 4) : a.bottom + 4) + 'px';

    const qEl = pop.querySelector('[data-q]');
    if (qEl) setTimeout(() => qEl.focus(), 20);
}

/** 팝업의 체크 상태를 필터에 반영한다. 전부 체크면 '필터 없음'으로 둔다. */
function applyTextFilterFromPop(pop) {
    const key = pop.dataset.key;
    const boxes = [...pop.querySelectorAll('input[data-val]')];
    const checked = boxes.filter(b => b.checked).map(b => b.dataset.val);
    if (checked.length === boxes.length) delete textFilters[key];
    else textFilters[key] = new Set(checked);
    renderTable();
}

document.addEventListener('click', (e) => {
    // 정렬 — 오름차순 → 내림차순 → 해제
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
        const key = sortBtn.dataset.sort;
        if (sortState.key !== key) sortState = { key, dir: 'asc' };
        else if (sortState.dir === 'asc') sortState.dir = 'desc';
        else sortState = { key: '', dir: 'asc' };
        closeFilterPop();
        renderTable();
        return;
    }
    const fltBtn = e.target.closest('[data-filter]');
    if (fltBtn) { openFilterPop(fltBtn.dataset.filter, fltBtn); return; }
    if (!e.target.closest('.flt-pop')) closeFilterPop();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilterPop(); });
window.addEventListener('resize', closeFilterPop);

// 팝업 내부 조작
document.addEventListener('input', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (!pop) return;
    const key = pop.dataset.key;

    if (e.target.matches('[data-q]')) {
        const q = e.target.value.trim().toLowerCase();
        pop.querySelectorAll('.flt-row').forEach(r => {
            r.style.display = r.dataset.v.toLowerCase().includes(q) ? '' : 'none';
        });
        return;
    }
    if (e.target.matches('[data-min],[data-max]')) {
        const min = pop.querySelector('[data-min]').value;
        const max = pop.querySelector('[data-max]').value;
        if (min === '' && max === '') delete numFilters[key];
        else numFilters[key] = { min, max };
        renderTable();
    }
});

document.addEventListener('change', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (pop && e.target.matches('input[data-val]')) applyTextFilterFromPop(pop);
});

document.addEventListener('click', (e) => {
    const pop = e.target.closest('.flt-pop');
    if (!pop) return;
    if (e.target.matches('[data-all]')) {
        pop.querySelectorAll('input[data-val]').forEach(b => { b.checked = true; });
        applyTextFilterFromPop(pop);
    } else if (e.target.matches('[data-none]')) {
        pop.querySelectorAll('input[data-val]').forEach(b => { b.checked = false; });
        applyTextFilterFromPop(pop);
    } else if (e.target.matches('[data-clear]')) {
        pop.querySelector('[data-min]').value = '';
        pop.querySelector('[data-max]').value = '';
        delete numFilters[pop.dataset.key];
        renderTable();
    }
});

function resetAllFilters() {
    COLS.forEach(c => { delete textFilters[c.key]; delete numFilters[c.key]; });
    sortState = { key: '', dir: 'asc' };
    $('filter-category').value = '';
    $('filter-search').value = '';
    $('filter-low').checked = false;
    closeFilterPop();
    renderTable();
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
$('btn-reset-filters').addEventListener('click', resetAllFilters);

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
