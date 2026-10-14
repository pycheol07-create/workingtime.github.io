// === js/products-list.js ===
// 상품 관리 — 목록(요약 · 필터 · 50행 쪽 넘김). 2026-10-13. 설계: 상품DB_설계_v2.md, 시안 Products.dc.html
//
// 3,768행을 한 번에 그리지 않는다(50행씩). 추가 읽기 없음 — 전부 products-store.js 가 받아 둔 메모리에서.
// 관리자 열(공급처·기본 단가)은 관리자일 때만 **만든다**(숨김 아님). 원가 값은 products-cost.js 메모리에만 있다.
import { S, locSummary } from './products-store.js?v=202610141059';
import { C, costOf } from './products-cost.js?v=202610141059';
import { esc, toast } from './products.js?v=202610141059';
import { loadXLSX } from './products-excel.js?v=202610141059';
import { catalogExportAoa } from './lib/product-excel-rows.js?v=202610141059';
import { fmt2, hasOptionPrices } from './lib/product-price.js?v=202610141059';

const PAGE = 50;
const F = { q: '', cat: '', status: '', gone: false, noPrice: false, optDiff: false, noSup: false, sup: '', page: 0 };
const searchKey = new WeakMap();

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
        out.push([pid, p]);
    }
    out.sort((a, b) => (b[1].add || 0) - (a[1].add || 0) || (a[0] < b[0] ? -1 : 1));
    return out;
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
            <td class="r num">${b ? '$' + fmt2(b.usd) : '<span class="pd-warn">미입력</span>'}</td>`;
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

export function renderList(main) {
    if (!S.products.size) {
        main.innerHTML = `<section class="pd-card"><div class="pd-empty">
            아직 상품 데이터가 없습니다.<br>${S.isAdmin ? '위의 <b>기본정보 올리기</b>로 상품 엑셀을 올려 주세요(양식은 그 창에서 받을 수 있습니다).' : '관리자가 기본정보 엑셀을 올리면 여기에 보입니다.'}
        </div></section>`;
        return;
    }
    main.innerHTML = `
        <section class="pd-card pd-summary" aria-label="요약" id="pd-sum">${summaryHtml()}</section>
        <section class="pd-card" style="overflow:hidden">
            <div class="pd-filters" id="pd-filters">
                <input type="search" id="pd-q" class="pd-search" placeholder="품목코드·상품코드·상품명·바코드" value="${esc(F.q)}" aria-label="검색">
                <span id="pd-chips" style="display:contents">${chipsHtml()}</span>
                <span id="pd-count" class="pd-count num"></span>
            </div>
            <div class="pd-scroll"><table class="pd-t" style="min-width:${S.isAdmin ? 1180 : 900}px">
                <thead><tr><th>상품코드</th><th>상품명</th><th>카테고리</th><th class="r">옵션</th>
                    ${S.isAdmin ? '<th>공급처<span class="pd-adm-tag">관리자</span></th><th class="r">기본 단가(위안)<span class="pd-adm-tag">관리자</span></th><th class="r">기본 단가(달러)<span class="pd-adm-tag">관리자</span></th>' : ''}
                    <th>위치</th><th class="r" title="로케이션관리 자리 수량 합(채우기 요약 기준)">자리 수량</th><th>상태</th></tr></thead>
                <tbody id="pd-tbody"></tbody></table></div>
            <div class="pd-foot"><span>행을 누르면 상세가 열립니다. 위치·수량은 로케이션관리 기준(평일 아침 요약)입니다.</span>
                <span class="pd-pager"><button class="d-btn d-btn-sm" id="pd-prev">이전</button><span id="pd-pageno" class="num"></span><button class="d-btn d-btn-sm" id="pd-next">다음</button></span></div>
        </section>`;
    let rows = filtered();
    const draw = () => {
        const pages = Math.max(1, Math.ceil(rows.length / PAGE));
        F.page = Math.min(F.page, pages - 1);
        const from = F.page * PAGE;
        main.querySelector('#pd-tbody').innerHTML = rows.slice(from, from + PAGE).map(([pid, p]) => rowHtml(pid, p)).join('')
            || `<tr><td colspan="${S.isAdmin ? 10 : 7}" class="pd-empty">조건에 맞는 상품이 없습니다</td></tr>`;
        main.querySelector('#pd-count').textContent = rows.length ? `${rows.length.toLocaleString()}개 중 ${from + 1}–${Math.min(from + PAGE, rows.length)}` : '0개';
        main.querySelector('#pd-pageno').textContent = `${F.page + 1} / ${pages}`;
        main.querySelector('#pd-prev').disabled = F.page <= 0;
        main.querySelector('#pd-next').disabled = F.page >= pages - 1;
    };
    const redo = (chips = true) => {
        rows = filtered(); F.page = 0;
        if (chips) main.querySelector('#pd-chips').innerHTML = chipsHtml();
        draw();
    };
    draw();
    let t = null;
    main.querySelector('#pd-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; redo(false); }, 200); });
    main.querySelector('#pd-filters').addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.cat !== undefined) { F.cat = b.dataset.cat; redo(); }
        else if (b.dataset.tog) { F[b.dataset.tog] = !F[b.dataset.tog]; redo(); }
    });
    main.querySelector('#pd-filters').addEventListener('change', (e) => {
        const s = e.target.closest('select'); if (!s) return;
        F[s.dataset.sel] = s.value; redo();
    });
    main.querySelector('#pd-sum').addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const a = b.dataset.act;
        if (a === 'gone') { F.gone = true; }
        else { F.noPrice = a === 'noPrice'; F.noSup = a === 'noSup'; }
        redo();
    });
    main.querySelector('#pd-prev').addEventListener('click', () => { F.page--; draw(); });
    main.querySelector('#pd-next').addEventListener('click', () => { F.page++; draw(); });
    const open = (tr) => { if (tr) location.hash = 'p=' + encodeURIComponent(tr.dataset.pid); };
    main.querySelector('#pd-tbody').addEventListener('click', (e) => open(e.target.closest('tr[data-pid]')));
    main.querySelector('#pd-tbody').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e.target.closest('tr[data-pid]')); });
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
