// === js/products-excel.js ===
// 상품 관리 — (관리자) 엑셀 업로드 공통 화면: 양식 받기 · 읽기 · 미리보기 · 반영 · 결과. 2026-10-13. 설계: 상품DB_설계_v2.md 3-4
//
// 두 파일(D2): 기본정보(catalog → ProductCatalog) / 원가(cost → adminProductCost). 열 이름은 우리 양식 고정(D1).
// 읽기: SheetJS 0.18.5 를 버튼 누를 때 불러온다(다른 페이지와 같은 CDN 주소). 셀 원시값을 글자로(sheetToAoa — 숫자 바코드 지수표기·날짜 서식 방지).
// 반영: 버킷별 트랜잭션을 차례로(products-write.js). 행 = 품목 하나. 충돌(그 사이 누가 고침)은 그 품목만 빠진다.
// 🔒 올린 파일·읽은 내용은 어디에도 저장하지 않는다(Firestore·localStorage·IndexedDB 모두). 창을 닫으면 변수에서 버린다.
//    기본정보 파일에 원가·공급처 열이 있어도 읽지 않는다(lib/product-excel-rows.js FORBIDDEN_RE).
// 이지어드민 '상품정보' 엑셀(2026-10-14): 머리글로 자동 인식(detectEzadmin) → 기본정보는 단독 상품 보정·등록일 최소,
//   원가는 전용 열(EZ_COST_COLS)·글 단가 해석(diffEzCost). 기본정보 반영 뒤 [원가 단계로 이어서] 로 같은 내용(메모리)을 원가에 쓴다.
//   새 공급처는 반영 직전 확인 후 대장에 이름 빈칸으로 등록(ensureSuppliers). 설계: 이지어드민상품엑셀_설계.md
// ⚠️ 원가 값을 console 에 찍지 말 것 — 시간·행 수만.
import { S, applyLocalProduct } from './products-store.js?v=202610271324';
import { C, ledgerCodes, loadLedger } from './products-cost.js?v=202610271324';
import { esc, toast, route, renderBasis } from './products.js?v=202610271324';
import { costChangeText } from './products-cost.js?v=202610271324';
import { catalogChangeText } from './products-detail.js?v=202610271324';
import { writeBucket, writeCatalogSummary, ensureSuppliers } from './products-write.js?v=202610271324';
import { catalogBucketId, costBucketId, CATALOG_BUCKETS } from './lib/product-bucket.js?v=202610271324';
import {
    CATALOG_COLS, COST_COLS, readRows, groupCatalogRows, diffCatalog, diffCost, defaultChecked,
    catalogJson, costJson, bucketSizesAfter, templateAoa, costExportAoa, resultAoa, STATUS_LABEL, BUCKET_LIMIT,
    sheetToAoa, goneSelected
} from './lib/product-excel-rows.js?v=202610271324';
import { EZ_COST_COLS, detectEzadmin, ezCatalogGroups, diffEzCost } from './lib/product-ezadmin.js?v=202610271324';
import { friendlyFirebaseError } from './utils.js?v=202610271324';   // 원시 오류 코드 대신 할 일 한 줄
import { REASON_LABEL } from './lib/product-price-text.js?v=202610271324';

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const PAGE = 50;
const $ = (id) => document.getElementById(id);

let xlsxP = null;
export function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxP) return xlsxP;
    xlsxP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = XLSX_URL;
        s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX 없음'));
        s.onerror = () => { xlsxP = null; reject(new Error('SheetJS 를 불러오지 못함')); };
        document.head.appendChild(s);
    });
    return xlsxP;
}

const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const ymdDash = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nextTick = () => new Promise(r => setTimeout(r, 0));

async function downloadAoa(aoa, sheet, fname, widths) {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, fname);
}

// ── 상태 (창을 닫으면 비운다) ─────────────────────────────
let U = null;        // { kind, ez, cols, aoa(이지어드민 기본정보 단계만 — 원가 단계로 넘길 내용), fname, entries, checked:Set, filter, page, header, results }
let busy = false;

function closeModal() {
    if (busy) { toast('반영 중에는 닫을 수 없습니다'); return; }
    const changed = !!(U && U.results);
    $('pd-modal').classList.add('hidden');
    $('pd-modal-body').innerHTML = '';
    U = null;                                   // 읽은 내용 버리기
    document.documentElement.style.overflow = '';
    if (changed) route();                       // 반영했으면 목록·상세 다시 그리기
}
let wired = false;

/**
 * 업로드 창 열기. kind = 'catalog' | 'cost'.
 * opts.aoa : 이지어드민 기본정보 단계에서 읽어 둔 내용 — 원가 단계로 이어갈 때(파일을 다시 고르지 않음)
 */
export function openUpload(kind, { aoa: givenAoa = null, fname: givenName = '' } = {}) {
    if (!S.isAdmin) return;
    if (!wired) {
        $('pd-modal-close').addEventListener('click', closeModal);
        $('pd-modal').addEventListener('click', (e) => { if (e.target.id === 'pd-modal') closeModal(); });
        wired = true;
    }
    U = null;
    const cat = kind === 'catalog';
    $('pd-modal-title').textContent = cat ? '기본정보 엑셀 올리기' : '원가 엑셀 올리기 (관리자 전용)';
    const lastRate = localStorage.getItem('products_lastRate') || '';
    $('pd-modal-body').innerHTML = `
        <div class="pd-step"><h3>1. 양식</h3>
            <div class="pd-row">
                <button class="d-btn" data-act="tpl">${cat ? '기본정보' : '원가'} 양식 내려받기</button>
                <label class="pd-sub"><input type="checkbox" class="pd-check" data-f="desc"> 열 설명 행 넣기</label>
                ${cat ? '' : '<button class="d-btn" data-act="cur">현재 값으로 받기</button>'}
            </div>
            <div class="pd-note" style="margin-top:8px">${cat
                ? `열 이름: ${CATALOG_COLS.map(c => c.name).join(' · ')}. 옵션 하나 = 한 행. 열 순서는 상관없고, 빈 칸은 그대로 두고 하이픈(-)은 지웁니다. 원가·공급처 열이 있어도 읽지 않습니다.`
                : `열 이름: ${COST_COLS.map(c => c.name).join(' · ')}. 상품코드를 비우면 상품 기본 단가, 넣으면 그 옵션만. 공급처는 대장에 먼저 등록. <b>원가 파일은 AI·메신저에 올리지 마세요.</b>`}</div>
        </div>
        <div class="pd-step"><h3>2. 올리기</h3>
            <div class="pd-row">
                ${cat ? `<label class="pd-sub"><input type="checkbox" class="pd-check" data-f="full" checked> 이 파일이 <b>전체 목록</b>이다 (빠진 상품은 '사라짐'으로 표시, 삭제하지 않음)</label>`
                    : `<label class="pd-field" style="width:150px">기본 환율(1달러당 위안)<input class="pd-in num" data-f="rate" inputmode="decimal" value="${esc(lastRate)}"></label>
                       <label class="pd-field" style="width:170px">기준일<input class="pd-in" type="date" data-f="rateDate" value="${ymdDash()}"></label>
                       <span class="pd-note">환율 칸이 빈 행에 씁니다</span>`}
            </div>
            ${givenAoa
                ? `<div class="pd-row" style="margin-top:12px"><button class="d-btn d-btn-primary" data-act="go">비교 시작</button><span class="pd-note" data-f="readmsg">기본정보 단계에서 읽은 ${esc(givenName)} 을(를) 그대로 씁니다(파일을 다시 고르지 않음)</span></div>`
                : `<div class="pd-row" style="margin-top:12px"><input type="file" data-f="file" accept=".xlsx,.xls,.csv"><span class="pd-note" data-f="readmsg"></span></div>`}
            <div class="pd-note" style="margin-top:8px">이지어드민 '상품정보' 엑셀도 그대로 올릴 수 있습니다(머리글로 자동 인식). 순서: 기본정보 → 원가.</div>
        </div>
        <div id="pd-preview"></div>`;
    $('pd-modal').classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
    const body = $('pd-modal-body');
    const q = (f) => body.querySelector(`[data-f="${f}"]`);
    body.querySelector('[data-act="tpl"]').addEventListener('click', async () => {
        try {
            const cols = cat ? CATALOG_COLS : COST_COLS;
            await downloadAoa(templateAoa(kind, q('desc').checked), cat ? '상품기본정보' : '원가', cat ? '상품기본정보_양식.xlsx' : '원가_양식.xlsx', cols.map(c => q('desc').checked ? 26 : 14));
        } catch (e) { toast('양식을 만들지 못했습니다'); }
    });
    body.querySelector('[data-act="cur"]')?.addEventListener('click', async () => {
        if (!C.costs) { toast('원가를 읽지 못한 상태입니다'); return; }
        if (!confirm('원가 원본 파일을 내려받습니다(관리자 전용).\nAI·메신저·메일로 보내지 마세요. 계속할까요?')) return;
        try { await downloadAoa(costExportAoa(S.products, C.costs), '원가', `원가_현재값_관리자전용_${ymd()}.xlsx`); }
        catch (e) { toast('엑셀을 만들지 못했습니다'); }
    });
    /** 원가 비교에 쓰는 기본 환율·기준일. 못 쓰면 null(안내 문구를 띄움) */
    const costDefaults = () => {
        const msg = q('readmsg');
        msg.className = 'pd-note pd-err';
        if (!C.costs) { msg.textContent = '원가를 읽지 못한 상태라 비교할 수 없습니다 — 새로고침 후 다시'; return null; }
        const rate = Number(q('rate').value);
        if (!(rate >= 3 && rate <= 15)) { msg.textContent = '기본 환율(3~15, 1달러당 위안)을 먼저 넣어 주세요'; return null; }
        localStorage.setItem('products_lastRate', String(rate));
        msg.className = 'pd-note';
        return { rate, rateDate: q('rateDate').value || ymdDash() };
    };
    /** 읽은 aoa → 비교 → 미리보기. 이지어드민 상품 엑셀이면 전용 경로 */
    const compare = async (aoa, fname, readMs, defaults) => {
        const msg = q('readmsg');
        msg.className = 'pd-note';
        msg.textContent = `비교 중… (${(aoa.length).toLocaleString()}행)`;
        await nextTick();
        const t1 = performance.now();
        const ez = !!detectEzadmin(aoa);
        const cols = cat ? CATALOG_COLS : ez ? EZ_COST_COLS : COST_COLS;
        const rr = readRows(aoa, cols, { forbid: cat });
        let res;
        if (!rr.fileErrors.length) {
            const ctx = { catalog: S.products, costs: C.costs, ledger: ledgerCodes(), defaults };
            if (cat) res = diffCatalog(ez ? ezCatalogGroups(rr.rows) : groupCatalogRows(rr.rows), S.products, { fullList: q('full').checked });
            else res = ez ? diffEzCost(rr.rows, ctx) : diffCost(rr.rows, ctx);
        }
        const t2 = performance.now();
        console.log(`[products] 엑셀 읽기 ${Math.round(readMs)}ms · 비교 ${Math.round(t2 - t1)}ms · 행 ${rr.rows.length}${ez ? ' · 이지어드민' : ''}`);
        msg.textContent = `${fname} · ${rr.rows.length.toLocaleString()}행 · ${readMs ? `읽기 ${(readMs / 1000).toFixed(1)}초 · ` : ''}비교 ${((t2 - t1) / 1000).toFixed(1)}초`;
        U = { kind, ez, cols, aoa: cat && ez ? aoa : null, fname,
            header: rr.header, fileErrors: rr.fileErrors, skipped: rr.skipped, fullList: cat && q('full').checked,
            entries: res ? res.entries : [], counts: res ? res.counts : null, needGoneConfirm: !!(res && res.needGoneConfirm),
            goneRatio: res ? res.goneRatio || 0 : 0, goneOptCount: res ? res.goneOptCount || 0 : 0, goneOptRatio: res ? res.goneOptRatio || 0 : 0,
            filter: 'todo', page: 0, results: null };
        U.checked = new Set(U.entries.filter(defaultChecked).map(x => x.pid));
        renderPreview();
    };
    body.querySelector('[data-act="go"]')?.addEventListener('click', async () => {
        const defaults = costDefaults();
        if (!defaults) return;
        $('pd-preview').innerHTML = '';
        try { await compare(givenAoa, givenName, 0, defaults); }
        catch (err) {
            console.error('[products] 비교 실패:', err && err.message);
            q('readmsg').className = 'pd-note pd-err';
            q('readmsg').textContent = '비교하지 못했습니다';
        }
    });
    q('file')?.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const msg = q('readmsg');
        if (f.size > 10 * 1024 * 1024) { msg.textContent = '10MB 가 넘습니다 — 나눠서 올려 주세요'; e.target.value = ''; return; }
        let defaults = null;
        if (!cat) {
            defaults = costDefaults();
            if (!defaults) { e.target.value = ''; return; }
        }
        msg.className = 'pd-note'; msg.textContent = '읽는 중…';
        $('pd-preview').innerHTML = '';
        await nextTick();
        try {
            const XLSX = await loadXLSX();
            const t0 = performance.now();
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array', cellNF: true });   // cellNF: 셀 서식(z)을 받아 날짜 칸을 가려낸다
            const want = cat ? '상품기본정보' : '원가';
            const ws = wb.Sheets[want] || wb.Sheets[wb.SheetNames[0]];
            const aoa = sheetToAoa(ws, XLSX, { date1904: !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904) });                      // 원시값 기준(바코드 지수표기·날짜 서식 방지)
            const t1 = performance.now();
            e.target.value = '';                                   // 파일 참조 버리기
            await compare(aoa, f.name, t1 - t0, defaults);
        } catch (err) {
            console.error('[products] 엑셀 읽기 실패:', err && err.message);
            msg.className = 'pd-note pd-err';
            msg.textContent = '파일을 읽지 못했습니다(엑셀 파일이 맞는지 확인)';
            e.target.value = '';
        }
    });
}

const FILTERS = [
    ['todo', '반영 대상', e => defaultChecked(e)], ['new', '새로', e => e.status === 'new'], ['changed', '변경', e => e.status === 'changed'],
    ['revived', '다시 나타남', e => e.status === 'revived'], ['gone', '사라짐', e => e.status === 'gone'],
    ['warn', '경고', e => e.warnings.length > 0 && e.status !== 'error'], ['error', '오류', e => e.status === 'error'],
    ['same', '동일', e => e.status === 'same'], ['check', '확인 필요', e => !!(e.checks && e.checks.length) && e.status !== 'error'],
    ['all', '전체', () => true],
];
const PILL = { new: 'accent', changed: 'ok', same: 'mute', revived: 'accent', gone: 'risk', error: 'risk' };

function renderPreview() {
    const box = $('pd-preview');
    if (!U) { box.innerHTML = ''; return; }
    const cat = U.kind === 'catalog';
    if (U.fileErrors.length) { box.innerHTML = `<div class="pd-alert risk">${U.fileErrors.map(esc).join('<br>')}</div>`; return; }
    const h = U.header;
    const found = Object.keys(h.map).map(k => U.cols.find(c => c.key === k).name);
    const filters = FILTERS.filter(f => f[0] !== 'check' || !cat);
    const c = U.counts;
    const list = U.entries.filter((FILTERS.find(f => f[0] === U.filter) || FILTERS[0])[2]);
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    U.page = Math.min(U.page, pages - 1);
    const from = U.page * PAGE;
    const sel = U.entries.filter(e => U.checked.has(e.pid));
    const sg = goneSelected(U.entries, U.checked);
    const goneNeed = sg.options || sg.products;                     // 확인 입력값 = 사라질 옵션 수(옵션 없으면 상품 수)
    const chText = cat ? catalogChangeText : costChangeText;
    box.innerHTML = `<div class="pd-step"><h3>3. 미리보기 · 반영</h3>
        <div class="pd-note">찾은 열: ${found.map(esc).join(' · ')}${h.ignored.length ? ` · 모르는 열(무시): ${h.ignored.map(esc).join(', ')}` : ''}${U.skipped ? ` · 설명 행 ${U.skipped}개 건너뜀` : ''}</div>
        ${U.ez ? `<div class="pd-alert info" style="margin-top:8px">이지어드민 상품 엑셀로 인식했습니다. ${cat
            ? '이 단계는 기본정보만 읽습니다(대표상품코드가 빈 행 = 단독 상품). 반영한 뒤 <b>원가 단계로 이어서</b>를 누르세요.'
            : '추가항목2 = 위안 단가, 비축창고재고 = 달러 단가, 원가 = 원화 원가로 읽습니다. 새 품목은 기본정보를 먼저 반영해야 합니다(\'기본정보에 없음\'). 글로 적힌 단가를 확정 못 한 품목은 단가를 바꾸지 않고 원가메모에 원문을 남깁니다(\'확인 필요\').'}</div>` : ''}
        ${h.forbidden.length ? `<div class="pd-alert warn" style="margin-top:8px">원가·공급처로 보이는 열은 읽지 않았습니다: ${h.forbidden.map(esc).join(', ')}</div>` : ''}
        ${h.dupes.length ? `<div class="pd-alert warn" style="margin-top:8px">같은 뜻의 열이 또 있어 뒤의 것은 무시: ${h.dupes.map(esc).join(', ')}</div>` : ''}
        ${cat && U.needGoneConfirm ? `<div class="pd-alert risk" style="margin-top:8px">사라짐이 상품 ${c.gone.toLocaleString()}개(기존의 ${Math.round(U.goneRatio * 100)}%) · 옵션 ${U.goneOptCount.toLocaleString()}개(기존의 ${Math.round(U.goneOptRatio * 100)}%) 입니다. 파일을 잘못 고르지 않았는지 확인하세요.
            ${goneNeed ? `반영하려면 선택한 것 중 사라질 ${sg.options ? '옵션' : '상품'} 수 <b>${goneNeed.toLocaleString()}</b> 을 입력: <input class="pd-in num sm" data-f="goneok" inputmode="numeric" style="width:100px">` : '(지금 선택에는 사라짐이 없습니다)'}</div>` : ''}
        <div class="pd-row" style="margin-top:12px">${filters.map(([k, label, fn]) => {
            const n = U.entries.filter(fn).length;
            return `<button class="pd-chip ${U.filter === k ? 'is-on' : ''}" data-flt="${k}">${label}<span class="num">${n.toLocaleString()}</span></button>`;
        }).join('')}</div>
        <div class="pd-scroll" style="margin-top:12px"><table class="pd-t pd-t-sm" style="min-width:820px">
            <thead><tr><th><input type="checkbox" class="pd-check" data-act="page" aria-label="이 쪽 전부"></th><th>품목코드</th><th>상품명</th><th>판정</th><th>바뀐 것 / 오류·경고</th></tr></thead>
            <tbody>${list.slice(from, from + PAGE).map(e => {
                const p = S.products.get(e.pid);
                const name = cat ? (e.next.name || (p && p.name) || '') : ((p && p.name) || '');
                const can = e.status !== 'error' && e.status !== 'same';
                const res = U.results ? U.results.get(e.pid) : '';
                const lines = e.changes.slice(0, 4).map(chText);
                if (e.changes.length > 4) lines.push(`<span class="pd-inh">외 ${e.changes.length - 4}건</span>`);
                const checks = (e.checks || []).map(x => REASON_LABEL[x] || x);   // 사유 라벨만(단가 원문·숫자 없음)
                const notes = [...e.errors.map(x => `<span class="pd-err">${esc(x)}</span>`),
                    ...(checks.length ? [`<span class="pd-warn"><b>확인 필요</b>: ${esc(checks.join(', '))} — 단가는 그대로, 원문은 원가메모에</span>`] : []),
                    ...e.warnings.map(x => `<span class="pd-warn">${esc(x)}</span>`), ...(e.infos || []).map(x => `<span class="pd-inh">${esc(x)}</span>`)];
                return `<tr class="${e.status === 'error' ? 'is-risk' : (e.warnings.length || checks.length) ? 'is-warn' : ''}">
                    <td><input type="checkbox" class="pd-check" data-pid="${esc(e.pid)}" ${U.checked.has(e.pid) ? 'checked' : ''} ${can && !U.results ? '' : 'disabled'} aria-label="${esc(e.pid)} 반영"></td>
                    <td class="num">${esc(e.pid)}</td><td class="pd-name">${esc(name)}</td>
                    <td><span class="pd-pill ${PILL[e.status]}">${STATUS_LABEL[e.status]}</span>${res ? `<br><span class="pd-sub">${esc(res)}</span>` : ''}</td>
                    <td class="pd-chg">${[...lines, ...notes].join('<br>') || '<span class="pd-inh">–</span>'}</td></tr>`;
            }).join('') || '<tr><td colspan="5" class="pd-inh">없음</td></tr>'}</tbody></table></div>
        <div class="pd-row" style="margin-top:10px"><span class="pd-sub num">${list.length.toLocaleString()}개 중 ${list.length ? from + 1 : 0}–${Math.min(from + PAGE, list.length)}</span>
            <span class="pd-pager"><button class="d-btn d-btn-sm" data-act="prev" ${U.page <= 0 ? 'disabled' : ''}>이전</button><span class="num">${U.page + 1} / ${pages}</span><button class="d-btn d-btn-sm" data-act="next" ${U.page >= pages - 1 ? 'disabled' : ''}>다음</button></span></div>
        <div class="pd-progress" style="margin-top:14px; display:none" data-f="prog"><i></i></div>
        <div class="pd-actions"><span class="pd-note" data-f="applymsg"></span>
            ${U.results ? `<button class="d-btn pd-btn-lg" data-act="result">결과 엑셀 받기</button>${cat && U.ez && U.aoa ? '<button class="d-btn d-btn-primary pd-btn-lg" data-act="tocost">원가 단계로 이어서</button>' : ''}<button class="d-btn ${cat && U.ez && U.aoa ? '' : 'd-btn-primary'} pd-btn-lg" data-act="done">닫기</button>`
                : `<button class="d-btn d-btn-primary pd-btn-lg" data-act="apply" ${sel.length ? '' : 'disabled'}>선택 ${sel.length.toLocaleString()}개 반영</button>`}</div></div>`;

    box.querySelectorAll('[data-flt]').forEach(b => b.addEventListener('click', () => { U.filter = b.dataset.flt; U.page = 0; renderPreview(); }));
    box.querySelector('[data-act="prev"]').addEventListener('click', () => { U.page--; renderPreview(); });
    box.querySelector('[data-act="next"]').addEventListener('click', () => { U.page++; renderPreview(); });
    box.querySelectorAll('input[data-pid]').forEach(cb => cb.addEventListener('change', () => {
        if (cb.checked) U.checked.add(cb.dataset.pid); else U.checked.delete(cb.dataset.pid);
        renderPreview();
    }));
    box.querySelector('[data-act="page"]').addEventListener('change', (ev) => {
        for (const e of list.slice(from, from + PAGE)) {
            if (e.status === 'error' || e.status === 'same') continue;
            if (ev.target.checked) U.checked.add(e.pid); else U.checked.delete(e.pid);
        }
        renderPreview();
    });
    box.querySelector('[data-act="apply"]')?.addEventListener('click', () => apply(sel));
    box.querySelector('[data-act="result"]')?.addEventListener('click', () => {
        downloadAoa(resultAoa(U.entries, U.results), '결과', `${cat ? '기본정보' : '원가'}_업로드결과_${ymd()}.xlsx`).catch(() => toast('엑셀을 만들지 못했습니다'));
    });
    box.querySelector('[data-act="done"]')?.addEventListener('click', closeModal);
    box.querySelector('[data-act="tocost"]')?.addEventListener('click', () => {
        const aoa = U.aoa, fname = U.fname;
        U = null;
        route();                                      // 반영한 기본정보로 뒤 화면 다시 그리기
        openUpload('cost', { aoa, fname });
    });
}

async function apply(sel) {
    const box = $('pd-preview');
    const msg = box.querySelector('[data-f="applymsg"]');
    const cat = U.kind === 'catalog';
    msg.className = 'pd-note pd-err';
    const sg = goneSelected(U.entries, U.checked);
    const goneNeed = sg.options || sg.products;
    const selGone = sg.products;
    if (cat && U.needGoneConfirm && goneNeed) {
        const v = Number((box.querySelector('[data-f="goneok"]') || {}).value);
        if (v !== goneNeed) { msg.textContent = `사라질 ${sg.options ? '옵션' : '상품'} 수(${goneNeed})를 정확히 입력해야 반영합니다`; return; }
    }
    // 버킷별로 묶고 크기 확인(700KB 넘으면 전체 거부)
    const n = cat ? (Number(S.meta && S.meta.n) || CATALOG_BUCKETS) : 0;
    const bidOf = (pid) => cat ? catalogBucketId(pid, n) : costBucketId(pid);
    const groups = new Map();
    for (const e of sel) {
        const b = bidOf(e.pid);
        if (!groups.has(b)) groups.set(b, []);
        groups.get(b).push(e);
    }
    const cur = {};
    if (cat) for (const [pid, p] of S.products) (cur[bidOf(pid)] ||= {})[pid] = catalogJson(p);
    else for (const [pid, c] of C.costs) (cur[bidOf(pid)] ||= {})[pid] = costJson(c);
    const ser = cat ? catalogJson : costJson;
    const writes = sel.map(e => ({ bid: bidOf(e.pid), pid: e.pid, json: ser({ ...e.next, ver: e.expectVer + 1, at: Date.now(), by: S.email, src: 'excel', add: Date.now() }) }));
    const size = bucketSizesAfter(cur, writes);
    const maxB = Math.max(0, ...Object.values(size.bytes));
    if (size.over.length) {
        msg.textContent = `버킷 ${size.over.join(', ')} 이(가) ${Math.round(BUCKET_LIMIT / 1000)}KB 를 넘어 반영하지 않습니다 — 상품이 너무 많거나 길어 버킷을 더 나눠야 합니다(개발 작업 필요)`;
        return;
    }
    if (!confirm(`${sel.length.toLocaleString()}개 품목을 반영합니다${selGone || sg.options ? ` (사라짐 상품 ${selGone}개 · 옵션 ${sg.options}개 포함)` : ''}. 계속할까요?`)) return;
    // 이지어드민 원가: 대장에 없는 공급처는 이름 빈칸으로 먼저 등록(원가에는 코드만 들어간다)
    const ledger = ledgerCodes();
    const newSups = cat ? [] : [...new Set(sel.map(e => e.newSup).filter(c => c && !ledger.has(c)))];
    if (newSups.length && !confirm(`공급처 ${newSups.length.toLocaleString()}개를 대장에 새로 등록합니다(이름 빈칸). 계속할까요?`)) return;
    busy = true;
    msg.className = 'pd-note';
    const prog = box.querySelector('[data-f="prog"]');
    prog.style.display = 'block';
    box.querySelector('[data-act="apply"]').disabled = true;
    if (newSups.length) {
        msg.textContent = `공급처 대장 등록 중… (${newSups.length}개)`;
        try {
            await ensureSuppliers(S.db, newSups, S.email);
            await loadLedger();
        } catch (e) {
            console.error('[products] 공급처 대장 등록 실패:', e && e.code);
            busy = false;
            prog.style.display = 'none';
            box.querySelector('[data-act="apply"]').disabled = false;
            msg.className = 'pd-note pd-err';
            msg.textContent = '공급처 대장 등록에 실패해 반영하지 않았습니다 — ' + friendlyFirebaseError(e);
            return;
        }
    }
    const batchId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const results = new Map();
    let i = 0, okN = 0, conflictN = 0, failN = 0;
    const bids = [...groups.keys()].sort();
    for (const bid of bids) {
        i++;
        msg.textContent = `버킷 ${i}/${bids.length} 쓰는 중… (최대 ${Math.round(maxB / 1000)}KB)`;
        prog.firstElementChild.style.width = `${Math.round((i - 1) / bids.length * 100)}%`;
        const items = groups.get(bid).map(e => ({ pid: e.pid, expectVer: e.expectVer, next: e.next, changes: e.changes }));
        try {
            const r = await writeBucket(S.db, cat ? 'catalog' : 'cost', bid, items, { email: S.email, logKind: 'excel', batchId, counts: U.counts, src: 'excel' });
            for (const { pid, obj } of r.ok) {
                results.set(pid, '반영'); okN++;
                if (cat) applyLocalProduct(pid, { ...obj, bid }); else C.costs.set(pid, obj);
            }
            for (const { pid } of r.conflict) { results.set(pid, '충돌 — 그 사이 다른 사람이 고침(다시 올리기)'); conflictN++; }
            if (cat && r.ok.length && S.meta && S.meta.chunks) {
                S.meta.chunks[bid] = { ...(S.meta.chunks[bid] || {}), rev: (Number(S.meta.chunks[bid] && S.meta.chunks[bid].rev) || 0) + 1 };
            }
        } catch (e) {
            console.error('[products] 버킷 쓰기 실패:', bid, e && e.code);
            for (const it of items) { results.set(it.pid, `실패(${(e && e.code) || '오류'})`); failN++; }
        }
    }
    prog.firstElementChild.style.width = '100%';
    if (cat && okN) {
        let tp = 0, to = 0;
        for (const p of S.products.values()) if (!p.gone) { tp++; to += p.o.filter(o => !o[4]).length; }
        try { await writeCatalogSummary(S.db, { email: S.email, batchId, counts: U.counts, total: { p: tp, o: to } }); }
        catch (e) { console.error('[products] META 요약 쓰기 실패:', e && e.code); }
    }
    busy = false;
    U.results = results;
    U.filter = 'all';
    renderPreview();
    const m2 = $('pd-preview').querySelector('[data-f="applymsg"]');
    m2.className = failN || conflictN ? 'pd-note pd-warn' : 'pd-note pd-ok';
    m2.textContent = `반영 ${okN.toLocaleString()} · 충돌 ${conflictN.toLocaleString()} · 실패 ${failN.toLocaleString()}`;
    if (okN) {
        if (!cat) toast('원가를 반영했습니다');
        else { if (!S.meta) S.meta = { n: CATALOG_BUCKETS, chunks: {} }; toast('기본정보를 반영했습니다'); }
        renderBasis();
    }
}
