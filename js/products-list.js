// === js/products-list.js ===
// 상품 관리 — 목록(요약 · 필터 · 50행 쪽 넘김). 2026-10-13. 설계: 상품DB_설계_v2.md, 시안 Products.dc.html
//
// 3,768행을 한 번에 그리지 않는다(50행씩). 추가 읽기 없음 — 전부 products-store.js 가 받아 둔 메모리에서.
// 관리자 열(공급처·기본 단가)은 관리자일 때만 **만든다**(숨김 아님). 원가 값은 products-cost.js 메모리에만 있다.
import { S, locSummary } from './products-store.js?v=202610261142';
import { C, costOf } from './products-cost.js?v=202610261142';
import { esc, toast } from './products.js?v=202610261142';
import { loadXLSX } from './products-excel.js?v=202610261142';
import { catalogExportAoa } from './lib/product-excel-rows.js?v=202610261142';
import { fmt2, hasOptionPrices } from './lib/product-price.js?v=202610261142';

// 한 쪽에 보이는 상품 수 — 사용자가 고른다(이 브라우저에 기억). 'all' = 전체
const PAGE_SIZES = [20, 50, 100, 200, 500, 'all'];
const PAGE_KEY = 'products_pageSize';
function loadPageSize() {
    try { const v = localStorage.getItem(PAGE_KEY); const n = Number(v); if (PAGE_SIZES.includes(n)) return n; } catch (e) { /* 저장소를 못 쓰면 기본값 */ }
    return 50;
}
// '전체'는 기억하지 않는다 — 기억하면 목록으로 돌아올 때마다 수천 줄을 다시 그려 1초 넘게 멈춘다(이번 화면에만 적용)
function savePageSize(v) { if (v === 'all') return; try { localStorage.setItem(PAGE_KEY, String(v)); } catch (e) { /* 이번 화면에만 적용 */ } }
const F = { q: '', cat: '', status: '', gone: false, noPrice: false, optDiff: false, noSup: false, sup: '', page: 0,
            sort: null,   // { key, dir: 1 | -1 } — 머리글 정렬, null 이면 새로 들어온 순
            cf: {},       // 머리글 필터 { 열key: {q} | {excl:Set(해제한 값)} | {min,max,empty} }
            size: loadPageSize() };   // 한 쪽 상품 수(20·50·…·'all')
const searchKey = new WeakMap();
// 상세로 가기 전 목록 스크롤 위치 — 목록으로 돌아오면 그 자리로 되돌린다(한 번 쓰고 비운다)
// { cards, y } — 표는 목록 상자(.pd-list-scroll), 카드는 페이지(document.scrollingElement) 기준. 보기가 바뀌었으면 버린다
let listScrollTop = null;

// 휴대폰(768px 이하)은 표 대신 상품 카드(2026-10-22) — 같은 목록(filtered)·같은 쪽 넘김, 그리는 모양만 다르다.
// 화면 회전·창 크기 변경 때 지금 떠 있는 목록만 다시 그린다(curDraw).
const CARD_MQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
const isCardView = () => !!(CARD_MQ && CARD_MQ.matches);
let curDraw = null;
if (CARD_MQ) {
    const onMq = () => { if (curDraw) curDraw(); };
    if (CARD_MQ.addEventListener) CARD_MQ.addEventListener('change', onMq); else CARD_MQ.addListener(onMq);
}

const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const activeOpts = (p) => p.o.filter(o => !o[4]);

function keyOf(p, pid) {
    let k = searchKey.get(p);
    if (!k) {
        k = [pid, p.code2, p.name, ...p.o.map(o => o[0] + ' ' + (o[2] || ''))].join(' ').toLowerCase();
        searchKey.set(p, k);
    }
    return k;
}

export function statusPill(p) {
    if (p.gone) return '<span class="pd-pill risk">사라짐</span>';
    const s = p.status || '';
    if (!s) return '';
    const cls = /판매중|정상/.test(s) ? 'ok' : /품절|중지|보류/.test(s) ? 'warn' : /단종|종료/.test(s) ? 'mute' : 'accent';
    return `<span class="pd-pill ${cls}">${esc(s)}</span>`;
}

function filtered() {
    const q = F.q.trim().toLowerCase();
    const out = [];
    const cols = colDefs();
    const cf = cols.filter(c => F.cf[c.key]).map(c => [c, F.cf[c.key]]);
    for (const [pid, p] of S.products) {
        if (!F.gone && p.gone) continue;
        if (F.cat && (p.cat || '(없음)') !== F.cat) continue;
        if (F.status && (p.status || '(없음)') !== F.status) continue;
        if (q && !keyOf(p, pid).includes(q)) continue;
        if (S.isAdmin) {
            const c = costOf(pid);
            if (F.noPrice && c && c.base) continue;
            if (F.optDiff && !hasOptionPrices(c)) continue;
            if (F.noSup && c && c.sup) continue;
            if (F.sup && (!c || c.sup !== F.sup)) continue;
        }
        if (cf.length && !cf.every(([col, f]) => passCol(col, f, pid, p))) continue;
        out.push([pid, p]);
    }
    const sc = F.sort && cols.find(c => c.key === F.sort.key);
    if (sc) {
        const dir = F.sort.dir;
        const val = new Map(out.map(([pid, p]) => [pid, sc.get(pid, p)]));
        out.sort((a, b) => cmpVals(val.get(a[0]), val.get(b[0]), dir) || (a[0] < b[0] ? -1 : 1));
    } else {
        out.sort((a, b) => (b[1].add || 0) - (a[1].add || 0) || (a[0] < b[0] ? -1 : 1));
    }
    return out;
}

// ── 머리글 정렬·필터 (2026-10-14) ───────────────────────────────
// 머리글 글자 = 정렬(오름 → 내림 → 해제), ▾ = 그 열 필터.
//   text: 글자 포함 · set: 값 목록에서 고르기 · num: 최소~최대 / 빈 값만
// 원가 열(공급처·단가·원화)은 관리자일 때만 만든다(목록 열과 같은 규칙).
const NONE = '(없음)';
const KO = new Intl.Collator('ko', { numeric: true });   // localeCompare(locale) 는 비교마다 collator 를 새로 만들어 느리다
const numOrNull = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
function colDefs() {
    const cols = [
        { key: 'code', label: '상품코드', type: 'text', get: (pid, p) => p.code2 || pid, fget: (pid, p) => `${p.code2 || ''} ${pid}` },
        { key: 'name', label: '상품명', type: 'text', get: (pid, p) => p.name || '' },
        { key: 'cat', label: '카테고리', type: 'set', get: (pid, p) => p.cat || NONE },
        { key: 'opt', label: '옵션', type: 'num', r: true, get: (pid, p) => activeOpts(p).length },
    ];
    if (S.isAdmin) {
        const base = (pid) => { const c = costOf(pid); return c && c.base; };
        cols.push(
            { key: 'sup', label: '공급처', type: 'set', adm: true, get: (pid) => { const c = costOf(pid); return (c && c.sup) || '(미지정)'; } },
            { key: 'cny', label: '기본 단가(위안)', type: 'num', r: true, adm: true, get: (pid) => { const b = base(pid); return b ? numOrNull(b.cny) : null; } },
            { key: 'usd', label: '기본 단가(달러)', type: 'num', r: true, adm: true, get: (pid) => { const b = base(pid); return b ? numOrNull(b.usd) : null; } },
            { key: 'krw', label: '원가(원)', type: 'num', r: true, adm: true, get: (pid) => { const c = costOf(pid); return c ? numOrNull(c.krw) : null; } },
        );
    }
    cols.push(
        { key: 'loc', label: '위치', type: 'text', get: (pid, p) => locSummary(p).first || '' },
        { key: 'qty', label: '자리 수량', type: 'num', r: true, title: '로케이션관리 자리 수량 합(채우기 요약 기준)', get: (pid, p) => { const l = locSummary(p); return l.spots ? l.qty : null; } },
        { key: 'status', label: '상태', type: 'set', get: (pid, p) => p.gone ? '사라짐' : (p.status || NONE) },
    );
    return cols;
}
const colByKey = (k) => colDefs().find(c => c.key === k);

/** 한 열 필터를 통과하는가 */
function passCol(col, f, pid, p) {
    if (col.type === 'text') return String((col.fget || col.get)(pid, p)).toLowerCase().includes(f.q);
    if (col.type === 'set') return !f.excl.has(String(col.get(pid, p)));   // 해제한 값만 뺀다(나중에 생긴 값·목록에 안 보인 값은 그대로 보임)
    const v = col.get(pid, p);
    if (f.empty) return v == null;
    if (v == null) return false;
    if (f.min != null && v < f.min) return false;
    if (f.max != null && v > f.max) return false;
    return true;
}

/** 정렬 비교 — 빈 값은 방향과 상관없이 맨 뒤 */
function cmpVals(a, b, dir) {
    const ea = a == null || a === '', eb = b == null || b === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    return KO.compare(String(a), String(b)) * dir;
}

function theadHtml() {
    return '<tr>' + colDefs().map(c => {
        const s = F.sort && F.sort.key === c.key ? (F.sort.dir > 0 ? ' ▲' : ' ▼') : '';
        const on = F.cf[c.key] ? ' is-on' : '';
        return `<th class="${c.r ? 'r' : ''}"${c.title ? ` title="${esc(c.title)}"` : ''}><span class="pd-th">`
            + `<button type="button" class="pd-th-sort${s ? ' is-sorted' : ''}" data-sort="${c.key}" title="눌러서 정렬(오름 → 내림 → 해제)">${esc(c.label)}${s}</button>`
            + `<button type="button" class="pd-th-f${on}" data-filt="${c.key}" aria-label="${esc(c.label)} 필터" title="${esc(c.label)} 필터">▾</button>`
            + `${c.adm ? '<span class="pd-adm-tag">관리자</span>' : ''}</span></th>`;
    }).join('') + '</tr>';
}

/** 열 필터 창 — body 에 하나만 띄운다 */
let popOff = null;   // 열린 창의 바깥 클릭 리스너 떼기
function closeColPop() {
    if (popOff) { popOff(); popOff = null; }
    document.getElementById('pd-colpop')?.remove();
}
function openColPop(th, col, onApply) {
    closeColPop();
    const f = F.cf[col.key];
    const pop = document.createElement('div');
    pop.id = 'pd-colpop';
    pop.className = 'pd-colpop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', `${col.label} 필터`);
    let body = '';
    if (col.type === 'text') {
        body = `<input class="pd-in" data-k="q" placeholder="포함할 글자" value="${esc(f ? f.q : '')}">`;
    } else if (col.type === 'num') {
        body = `<div class="pd-colpop-row"><input class="pd-in num" data-k="min" inputmode="decimal" placeholder="최소" value="${f && f.min != null ? f.min : ''}">
            <span>~</span><input class="pd-in num" data-k="max" inputmode="decimal" placeholder="최대" value="${f && f.max != null ? f.max : ''}"></div>
            <label class="pd-sub"><input type="checkbox" data-k="empty" ${f && f.empty ? 'checked' : ''}> 빈 값만</label>`;
    } else {
        // 값 목록 — 지금 켜진 '단종·사라짐 보기' 기준, 많은 순
        const cnt = new Map();
        for (const [pid, p] of S.products) {
            if (!F.gone && p.gone) continue;
            const v = String(col.get(pid, p));
            cnt.set(v, (cnt.get(v) || 0) + 1);
        }
        const vals = [...cnt].sort((a, b) => b[1] - a[1] || KO.compare(a[0], b[0]));
        const LIMIT = 400;
        body = `<input class="pd-in" data-k="find" placeholder="목록에서 찾기">
            <div class="pd-colpop-row"><button type="button" class="d-btn d-btn-sm" data-a="all">모두 선택</button><button type="button" class="d-btn d-btn-sm" data-a="none">모두 해제</button></div>
            <div class="pd-colpop-list">${vals.slice(0, LIMIT).map(([v, n]) =>
                `<label data-v="${esc(v.toLowerCase())}"><input type="checkbox" value="${esc(v)}" ${!f || !f.excl.has(v) ? 'checked' : ''}> <span>${esc(v)}</span><span class="num pd-inh">${n.toLocaleString()}</span></label>`).join('')}</div>
            ${vals.length > LIMIT ? `<div class="pd-note">값이 ${vals.length.toLocaleString()}개라 많은 순 ${LIMIT}개만 보입니다 — 찾기로 좁혀 주세요</div>` : ''}`;
    }
    pop.innerHTML = `<div class="pd-colpop-title">${esc(col.label)}</div>${body}
        <div class="pd-colpop-row pd-colpop-foot"><button type="button" class="d-btn d-btn-sm" data-a="clear">지우기</button><button type="button" class="d-btn d-btn-sm d-btn-primary" data-a="apply">적용</button></div>`;
    document.body.appendChild(pop);
    const r = th.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
    pop.style.top = `${window.scrollY + r.bottom + 4}px`;
    const k = (n) => pop.querySelector(`[data-k="${n}"]`);
    (k('q') || k('find') || k('min'))?.focus();

    const apply = () => {
        let nf = null;
        if (col.type === 'text') {
            const q = k('q').value.trim().toLowerCase();
            if (q) nf = { q };
        } else if (col.type === 'num') {
            const num = (el) => { const t = el.value.trim().replace(/,/g, ''); return t === '' || !isFinite(Number(t)) ? null : Number(t); };
            const min = num(k('min')), max = num(k('max')), empty = k('empty').checked;
            if (empty || min != null || max != null) nf = { min, max, empty };
        } else {
            // 해제한 값만 기억한다 — 창에 안 보인 값(400개 넘는 목록의 뒤쪽)은 이전 상태를 이어받는다
            const boxes = [...pop.querySelectorAll('.pd-colpop-list input[type=checkbox]')];
            const shown = new Set(boxes.map(b => b.value));
            const excl = new Set(f && f.excl ? [...f.excl].filter(v => !shown.has(v)) : []);
            boxes.forEach(b => { if (!b.checked) excl.add(b.value); });
            if (excl.size) nf = { excl };
        }
        if (nf) F.cf[col.key] = nf; else delete F.cf[col.key];
        closeColPop();
        onApply();
    };
    pop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'apply') apply();
        else if (a === 'clear') { delete F.cf[col.key]; closeColPop(); onApply(); }
        else if (a === 'all' || a === 'none') pop.querySelectorAll('.pd-colpop-list label').forEach(l => { if (l.style.display !== 'none') l.querySelector('input').checked = a === 'all'; });
    });
    pop.addEventListener('input', (e) => {
        if (e.target.dataset.k !== 'find') return;
        const q = e.target.value.trim().toLowerCase();
        pop.querySelectorAll('.pd-colpop-list label').forEach(l => { l.style.display = !q || l.dataset.v.includes(q) ? '' : 'none'; });
    });
    pop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); apply(); }
        if (e.key === 'Escape') { e.stopPropagation(); closeColPop(); th.querySelector('.pd-th-f')?.focus(); }
    });
    const outside = (e) => { if (!pop.contains(e.target) && !th.contains(e.target)) closeColPop(); };
    const timer = setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    popOff = () => { clearTimeout(timer); document.removeEventListener('mousedown', outside, true); };
}

function summaryHtml() {
    let total = 0, opts = 0, gone = 0, today = 0, priced = 0, noPrice = 0, noSup = 0;
    const t0 = todayStart();
    for (const [pid, p] of S.products) {
        if (p.gone) { gone++; continue; }
        total++; opts += activeOpts(p).length;
        if ((p.add || 0) >= t0) today++;
        if (S.isAdmin) {
            const c = costOf(pid);
            if (c && c.base) priced++; else noPrice++;
            if (!c || !c.sup) noSup++;
        }
    }
    const first = `<div class="pd-sum"><div class="pd-sum-label">전체 상품</div>
        <div class="pd-sum-val">${total.toLocaleString()}<small>옵션 ${opts.toLocaleString()}</small></div>
        ${gone ? `<button class="pd-link" data-act="gone">사라진 상품 ${gone.toLocaleString()}개 보기</button>` : ''}</div>`;
    if (!S.isAdmin) {
        return first + `<div class="pd-sum" style="grid-column: span 3"><div class="pd-sum-label">오늘 새로 들어온 상품</div>
            <div class="pd-sum-val">${today.toLocaleString()}</div></div>`;
    }
    const pct = total ? Math.round(priced / total * 100) : 0;
    const costNote = C.costs ? '' : '<div class="pd-note pd-err">원가를 읽지 못함</div>';
    return first + `
        <div class="pd-sum"><div class="pd-sum-label">단가 입력됨</div><div class="pd-sum-val">${pct}%</div>
            <div class="pd-bar"><i style="width:${pct}%"></i></div>${costNote}</div>
        <div class="pd-sum"><div class="pd-sum-label">단가 미입력</div><div class="pd-sum-val pd-warn">${noPrice.toLocaleString()}</div>
            <button class="pd-link pd-warn" data-act="noPrice">목록 보기</button></div>
        <div class="pd-sum"><div class="pd-sum-label">공급처 미지정</div><div class="pd-sum-val pd-err">${noSup.toLocaleString()}</div>
            <button class="pd-link pd-err" data-act="noSup">목록 보기</button></div>`;
}

function chipsHtml() {
    const cats = new Map(), sts = new Map();
    for (const p of S.products.values()) {
        if (p.gone && !F.gone) continue;
        cats.set(p.cat || '(없음)', (cats.get(p.cat || '(없음)') || 0) + 1);
        sts.set(p.status || '(없음)', (sts.get(p.status || '(없음)') || 0) + 1);
    }
    const top = [...cats].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (F.cat && !top.some(([c]) => c === F.cat)) top.push([F.cat, cats.get(F.cat) || 0]);
    let h = `<button class="pd-chip ${F.cat ? '' : 'is-on'}" data-cat="">전체</button>`;
    for (const [c, n] of top) h += `<button class="pd-chip ${F.cat === c ? 'is-on' : ''}" data-cat="${esc(c)}">${esc(c)}<span class="num">${n.toLocaleString()}</span></button>`;
    if (cats.size > top.length) {
        h += `<select class="pd-select" data-sel="cat" aria-label="카테고리 더 보기"><option value="">카테고리 더…</option>${[...cats.keys()].sort().map(c => `<option ${F.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
    }
    h += `<select class="pd-select" data-sel="status" aria-label="상태"><option value="">상태 전체</option>${[...sts.keys()].sort().map(s => `<option ${F.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
    h += `<button class="pd-chip ${F.gone ? 'is-on' : ''}" data-tog="gone">단종·사라짐 보기</button>`;
    if (S.isAdmin) {
        const sups = C.ledger ? Object.keys(C.ledger.s || {}).sort() : [];
        h += `<span class="pd-sep"></span>
            <button class="pd-chip ${F.noPrice ? 'is-on' : ''}" data-tog="noPrice">단가 미입력만</button>
            <button class="pd-chip ${F.optDiff ? 'is-on' : ''}" data-tog="optDiff">옵션별 단가 다름</button>
            <button class="pd-chip ${F.noSup ? 'is-on' : ''}" data-tog="noSup">공급처 미지정</button>
            <select class="pd-select" data-sel="sup" aria-label="공급처"><option value="">공급처 전체</option>${sups.map(s => `<option ${F.sup === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
    }
    // 카드 보기에는 머리글이 없으니 정렬을 고르는 칸(카드 보기에서만 보임). 원가 열은 넣지 않는다
    const sortVal = F.sort ? `${F.sort.key}:${F.sort.dir}` : '';
    const sortOpts = CARD_SORTS.map(([v, t]) => `<option value="${v}" ${v === sortVal ? 'selected' : ''}>${t}</option>`).join('');
    const keepOpt = sortVal && !CARD_SORTS.some(([v]) => v === sortVal) ? `<option value="${esc(sortVal)}" selected>표 머리글 정렬</option>` : '';
    h += `<select class="pd-select pd-card-only" data-cardsort="1" aria-label="정렬">${sortOpts}${keepOpt}</select>`;
    const ncf = Object.keys(F.cf).length;
    const clr = isCardView() ? '정렬·필터 해제' : '머리글 정렬·필터 해제';   // 카드 보기엔 머리글이 없다
    if (ncf || F.sort) h += `<button class="pd-chip is-on" data-act="clearcf" title="${clr}를 모두 해제">${clr}${ncf ? `<span class="num">${ncf}</span>` : ''}</button>`;
    return h;
}

function rowHtml(pid, p) {
    const ls = locSummary(p);
    const nOpt = activeOpts(p).length;
    const code = p.code2
        ? `<span class="pd-code-big num">${esc(p.code2)}</span><span class="pd-code-small num">${esc(pid)}</span>`
        : `<span class="pd-code-big num">${esc(pid)}</span>`;
    let adm = '', pills = statusPill(p);
    if ((p.add || 0) >= todayStart() && !p.gone) pills += '<span class="pd-pill warn">새 상품</span>';
    let cls = p.gone ? 'is-gone' : '';
    if (S.isAdmin) {
        const c = costOf(pid);
        const b = c && c.base;
        adm = `<td>${c && c.sup ? esc(c.sup) : '<span class="pd-err">미지정</span>'}</td>
            <td class="r num">${b ? '¥' + fmt2(b.cny) : '<span class="pd-warn">미입력</span>'}</td>
            <td class="r num">${b ? '$' + fmt2(b.usd) : '<span class="pd-warn">미입력</span>'}</td>
            <td class="r num">${c && c.krw !== null && c.krw !== undefined ? Number(c.krw).toLocaleString() : '<span class="pd-inh">–</span>'}</td>`;
        if (!p.gone && !b) { pills += '<span class="pd-pill warn">단가 미입력</span>'; cls = cls || 'is-warn'; }
        if (hasOptionPrices(c)) pills += '<span class="pd-pill accent">옵션별 단가</span>';
        if (!p.gone && !(c && c.sup)) pills += '<span class="pd-pill risk">공급처 미지정</span>';
    }
    const loc = ls.first ? `${esc(ls.first)}${ls.spots > 1 ? `<span class="pd-inh" style="font-size:12px">(${ls.spots})</span>` : ''}` : `<span class="pd-inh">${S.loc ? '없음' : '–'}</span>`;
    return `<tr class="pd-click ${cls}" data-pid="${esc(pid)}" tabindex="0">
        <td>${code}</td><td class="pd-name" title="${esc(p.name)}">${esc(p.name)}</td><td>${esc(p.cat)}</td>
        <td class="r num">${nOpt}</td>${adm}
        <td class="num">${loc}</td><td class="r num">${ls.spots ? ls.qty.toLocaleString() : ''}</td><td>${pills}</td></tr>`;
}

// 카드 보기 정렬 — 값은 'colDefs key:방향'(F.sort 그대로)
const CARD_SORTS = [['', '새로 들어온 순'], ['code:1', '상품코드순'], ['name:1', '상품명순'], ['loc:1', '위치순'],
    ['qty:-1', '수량 많은 순'], ['qty:1', '수량 적은 순'], ['status:1', '상태순']];

/** 휴대폰 카드 — 상품코드·상품명·위치·수량 + 상태 배지만. 원가·공급처 관련(단가 미입력 등)은 넣지 않는다 */
function cardHtml(pid, p) {
    const ls = locSummary(p);
    let pills = statusPill(p);
    if ((p.add || 0) >= todayStart() && !p.gone) pills += '<span class="pd-pill warn">새 상품</span>';
    const loc = ls.first
        ? `${esc(ls.first)}${ls.spots > 1 ? `<span class="pd-inh pd-pcard-more">외 ${ls.spots - 1}곳</span>` : ''}`
        : `<span class="pd-inh">${S.loc ? '없음' : '–'}</span>`;
    return `<button type="button" class="pd-pcard${p.gone ? ' is-gone' : ''}" data-pid="${esc(pid)}">
        <span class="pd-pcard-top"><span class="pd-pcard-code num">${esc(p.code2 || pid)}</span>${p.code2 ? `<span class="pd-pcard-sub num">${esc(pid)}</span>` : ''}<span class="pd-pcard-pills">${pills}</span></span>
        <span class="pd-pcard-name">${esc(p.name || '')}</span>
        <span class="pd-pcard-meta"><span class="pd-pcard-loc"><span class="pd-pcard-lab">위치</span><span class="pd-pcard-val num">${loc}</span></span>
            <span class="pd-pcard-qty"><span class="pd-pcard-lab">수량</span><span class="pd-pcard-val num">${ls.spots ? ls.qty.toLocaleString() : '<span class="pd-inh">–</span>'}</span></span></span>
    </button>`;
}

export function renderList(main) {
    if (!S.products.size) {
        main.innerHTML = `<section class="pd-card"><div class="pd-empty">
            아직 상품 데이터가 없습니다.<br>${S.isAdmin ? '위의 <b>기본정보 올리기</b>로 상품 엑셀을 올려 주세요(양식은 그 창에서 받을 수 있습니다).' : '관리자가 기본정보 엑셀을 올리면 여기에 보입니다.'}
        </div></section>`;
        return;
    }
    main.innerHTML = `
        <section class="pd-card pd-summary" aria-label="요약" id="pd-sum">${summaryHtml()}</section>
        <section class="pd-card pd-list-sec" style="overflow:hidden">
            <div class="pd-filters" id="pd-filters">
                <input type="search" id="pd-q" class="pd-search" placeholder="품목코드·상품코드·상품명·바코드" value="${esc(F.q)}" aria-label="검색">
                <span id="pd-chips" style="display:contents">${chipsHtml()}</span>
                <span id="pd-count" class="pd-count num"></span>
            </div>
            <div class="pd-scroll pd-list-scroll"><table class="pd-t" style="min-width:${S.isAdmin ? 1280 : 900}px">
                <thead id="pd-thead">${theadHtml()}</thead>
                <tbody id="pd-tbody"></tbody></table><div id="pd-cards" class="pd-cards"></div></div>
            <div class="pd-foot"><span>상품을 누르면 상세가 열립니다. 위치·수량은 로케이션관리 기준(평일 아침 요약)입니다.</span>
                <span class="pd-pager"><label class="pd-pagesize">보기 <select class="pd-select" id="pd-size" aria-label="한 쪽에 보일 상품 수">${PAGE_SIZES.map(v => `<option value="${v}" ${String(F.size) === String(v) ? 'selected' : ''}>${v === 'all' ? '전체' : v + '개씩'}</option>`).join('')}</select></label><button class="d-btn d-btn-sm" id="pd-prev">이전</button><span id="pd-pageno" class="num"></span><button class="d-btn d-btn-sm" id="pd-next">다음</button></span></div>
        </section>`;
    let rows = filtered();
    // 스크롤 대상 — 카드 보기는 상자 높이 제한을 풀고(css) 페이지 하나로 스크롤한다
    const pageEl = () => document.scrollingElement || document.documentElement;
    const getScroll = () => isCardView() ? pageEl().scrollTop : main.querySelector('.pd-list-scroll').scrollTop;
    const toListTop = () => {
        if (!isCardView()) { main.querySelector('.pd-list-scroll').scrollTop = 0; return; }
        // 카드: 목록 칸 머리(검색줄)가 공통 상단바 바로 아래 오게 — 이미 그 위에 있으면 그대로
        const bar = parseFloat(getComputedStyle(main).getPropertyValue('--as-h')) || 0;
        const top = main.querySelector('.pd-list-sec').getBoundingClientRect().top + pageEl().scrollTop - bar - 8;
        if (pageEl().scrollTop > top) pageEl().scrollTop = Math.max(0, top);
    };
    const draw = () => {
        const PAGE = F.size === 'all' ? Math.max(1, rows.length) : F.size;
        const pages = Math.max(1, Math.ceil(rows.length / PAGE));
        F.page = Math.min(F.page, pages - 1);
        const from = F.page * PAGE;
        const page = rows.slice(from, from + PAGE);
        // 보이는 쪽만 그리고 다른 쪽은 비운다(전체 보기에서 DOM 이 두 벌이 되지 않게)
        const cards = isCardView();
        main.querySelector('.pd-list-sec').classList.toggle('is-cards', cards);
        main.querySelector('#pd-tbody').innerHTML = cards ? '' : page.map(([pid, p]) => rowHtml(pid, p)).join('')
            || `<tr><td colspan="${S.isAdmin ? 11 : 7}" class="pd-empty">조건에 맞는 상품이 없습니다</td></tr>`;
        main.querySelector('#pd-cards').innerHTML = !cards ? '' : page.map(([pid, p]) => cardHtml(pid, p)).join('')
            || '<div class="pd-empty">조건에 맞는 상품이 없습니다</div>';
        main.querySelector('#pd-count').textContent = rows.length ? `${rows.length.toLocaleString()}개 중 ${from + 1}–${Math.min(from + PAGE, rows.length)}` : '0개';
        main.querySelector('#pd-pageno').textContent = `${F.page + 1} / ${pages}`;
        main.querySelector('#pd-prev').disabled = F.page <= 0;
        main.querySelector('#pd-next').disabled = F.page >= pages - 1;
    };
    const redo = (chips = true) => {
        rows = filtered(); F.page = 0;
        if (chips) main.querySelector('#pd-chips').innerHTML = chipsHtml();
        main.querySelector('#pd-thead').innerHTML = theadHtml();
        draw();
        toListTop();   // 새 결과는 맨 위부터
    };
    closeColPop();
    main.querySelector('#pd-thead').addEventListener('click', (e) => {
        const sb = e.target.closest('[data-sort]');
        if (sb) {
            const k = sb.dataset.sort;
            F.sort = !F.sort || F.sort.key !== k ? { key: k, dir: 1 } : F.sort.dir > 0 ? { key: k, dir: -1 } : null;
            redo();
            return;
        }
        const fb = e.target.closest('[data-filt]');
        if (fb) {
            if (document.getElementById('pd-colpop')?.getAttribute('aria-label') === `${colByKey(fb.dataset.filt)?.label} 필터`) { closeColPop(); return; }
            const col = colByKey(fb.dataset.filt);
            if (col) openColPop(fb.closest('th'), col, () => redo());
        }
    });
    window.addEventListener('hashchange', closeColPop, { once: true });
    // 표 ↔ 카드 전환(회전·창 크기) — 이 목록이 아직 화면에 있을 때만, 같은 쪽을 다시 그린다
    let lastCards = isCardView();
    curDraw = () => {
        const sc = main.querySelector('.pd-list-scroll');
        if (!sc || !sc.isConnected) { curDraw = null; return; }
        if (isCardView() === lastCards) return;
        lastCards = isCardView();
        closeColPop();
        main.querySelector('#pd-chips').innerHTML = chipsHtml();   // 해제 칩 문구·정렬 칸
        draw();
        sc.scrollTop = 0;
    };
    draw();
    if (listScrollTop !== null) {
        if (listScrollTop.cards === isCardView()) {
            if (listScrollTop.cards) pageEl().scrollTop = listScrollTop.y;
            else main.querySelector('.pd-list-scroll').scrollTop = listScrollTop.y;
        }
        listScrollTop = null;
    }
    let t = null;
    main.querySelector('#pd-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; redo(false); }, 200); });
    // Enter — 결과가 1건이면 바로 상세를 연다(바코드 스캐너는 코드를 친 뒤 Enter 를 보낸다)
    main.querySelector('#pd-q').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        clearTimeout(t);
        if (F.q !== e.target.value) { F.q = e.target.value; redo(false); }   // 200ms 기다리지 않고 바로 거른다
        if (rows.length === 1) location.hash = 'p=' + encodeURIComponent(rows[0][0]);
    });
    main.querySelector('#pd-filters').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.act === 'clearcf') { F.cf = {}; F.sort = null; closeColPop(); redo(); return; }
        if (b.dataset.cat !== undefined) { F.cat = b.dataset.cat; redo(); }
        else if (b.dataset.tog) { F[b.dataset.tog] = !F[b.dataset.tog]; redo(); }
    });
    main.querySelector('#pd-filters').addEventListener('change', (e) => {
        const s = e.target.closest('select'); if (!s) return;
        if (s.dataset.cardsort) {
            const [k, d] = s.value.split(':');
            F.sort = k ? { key: k, dir: Number(d) > 0 ? 1 : -1 } : null;
            redo();
            return;
        }
        F[s.dataset.sel] = s.value; redo();
    });
    main.querySelector('#pd-sum').addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'gone') { F.gone = true; }
        else { F.noPrice = a === 'noPrice'; F.noSup = a === 'noSup'; }
        redo();
    });
    main.querySelector('#pd-size').addEventListener('change', (e) => {
        const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
        // 지금 보던 첫 상품이 새 쪽에서도 보이게 쪽 번호를 맞춘다
        const first = F.page * (F.size === 'all' ? 0 : F.size);
        F.size = v; savePageSize(v);
        F.page = v === 'all' ? 0 : Math.floor(first / v);
        draw();
        toListTop();
    });
    main.querySelector('#pd-prev').addEventListener('click', () => { F.page--; draw(); toListTop(); });
    main.querySelector('#pd-next').addEventListener('click', () => { F.page++; draw(); toListTop(); });
    const open = (el) => {
        if (!el) return;
        listScrollTop = { cards: isCardView(), y: getScroll() };
        location.hash = 'p=' + encodeURIComponent(el.dataset.pid);
    };
    main.querySelector('#pd-tbody').addEventListener('click', (e) => open(e.target.closest('tr[data-pid]')));
    main.querySelector('#pd-tbody').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e.target.closest('tr[data-pid]')); });
    // 카드는 <button> 이라 Enter·Space 도 click 으로 온다
    main.querySelector('#pd-cards').addEventListener('click', (e) => open(e.target.closest('.pd-pcard[data-pid]')));
}

/** 기본정보 현재 값 엑셀(양식과 같은 열) — 원가는 넣지 않는다 */
export async function exportCatalog() {
    if (!S.products.size) { toast('받을 상품이 없습니다'); return; }
    try {
        const XLSX = await loadXLSX();
        const ws = XLSX.utils.aoa_to_sheet(catalogExportAoa(S.products, { includeGone: F.gone }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '상품기본정보');
        const d = new Date();
        XLSX.writeFile(wb, `상품기본정보_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.xlsx`);
    } catch (e) {
        console.error('[products] 엑셀 만들기 실패:', e && e.message);
        toast('엑셀을 만들지 못했습니다');
    }
}
