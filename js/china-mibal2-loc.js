// === js/china-mibal2-loc.js ===
// 신규 부족수량관리(china-mibal2.html) '위치지정(시험)' 보기 — 보기·엑셀 받기만. 2026-10-28.
// 규칙은 js/lib/loc-mode.js(기존 부족수량관리 위치지정모드를 그대로 옮긴 순수 함수)에 있다.
//
// ⚠️ 읽기만 한다. firestore 쓰기 함수를 import 하지 않는다(tests/mibal2-readonly.test.js 가 소스를 검사).
//    기존 화면의 쓰기 기능(자리 수정·삭제·위치 초기화·엑셀 올리기·새 위치 앞/뒤 저장·열 설정 저장)은 두지 않는다 —
//    꺼진 단추(btn-loc-off-*)·체크박스는 HTML 에서 disabled, 여기서 이벤트도 걸지 않는다.
// 읽기(경로·이름은 js/china-stock-goods.js 와 같다 — 그 파일은 import 하지 않는다):
//   · ChinaStockGoods/FLOOR2_STOCK · LOC_SHARD_0~7 구독 — 이 보기에 처음 들어갈 때부터(js/china-mibal2-scan.js ensureScanStore, [비축창고 보기]와 공유)
//   · ChinaStockGoods_StockLog(미발재고로그 청크) getDocs 1회 — 이 보기에 처음 들어갈 때. 받자마자 상품코드·상품명·옵션·로케이션·
//     옵션추가항목1 만 남기고 나머지(공급처 등)는 버린다(lib stockLogPick). 행 전체를 콘솔·엑셀에 내지 않는다.
//   · 새 위치 앞/뒤 = ChinaStockGoods/CONFIG.newLocPosition 읽기만(신규 화면이 이미 읽은 CONFIG)
// 기존 화면과 다른 점(패널 안내에도 적음): 출고일과 무관하게 보인다 · 상품명은 신규 표 → 비축 이름 → 미발재고로그 순 ·
//   기존재고 '비고' 는 기준값 없음만으로 판정 · 받기 직전에 비축창고를 다시 읽지 않는다(구독 값 그대로) · 열 설정은 기본 열 고정.
// 엑셀은 내 PC 로 내려받기만 한다. 파일 이름은 '시험_' 으로 시작(형식은 기존과 같은 .xls biff8 — 이지어드민 업로드는 기존 화면에서).
import { getDocs, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ensureScanStore } from './china-mibal2-scan.js?v=202610281042';
import { stockLogPick, todayLocRows, existingLocRows, dayLocAoa, locMoveAoa, locPartsArr, newLocPositionOf } from './lib/loc-mode.js?v=202610281042';
import { friendlyFirebaseError } from './utils.js?v=202610281042';

const STOCKLOG_COLL = 'ChinaStockGoods_StockLog';
const RENDER_CAP = 300;   // 기존재고 표시 상한(기존 LM_RENDER_CAP 과 같다). 엑셀은 전체
const TEST_TOAST = '시험용 — 이지어드민 업로드는 기존 화면에서 하세요';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
const fmtAt = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/**
 * 위치지정 보기 연결. opts:
 *   db, showToast(msg), isActive() → 지금 위치지정 보기인가,
 *   getConfig() → ChinaStockGoods/CONFIG(이미 읽은 것), getNewRows() → 신규 표 행(상품명·옵션 출처),
 *   getShipItems() → 수집기 출고 기록 {code:{nm,op}}(상품명·옵션 보조), getLocations() → {code: 앱 대표 로케이션}(로케이션 보조)
 * 반환: { enter() — 보기에 들어올 때(처음이면 구독·1회 읽기 시작), refresh() — 다시 그리기 }
 */
const NUM_LOC_SHARDS = 8;   // china-mibal2-scan.js·china-stock-goods.js NUM_LOC_SHARDS 와 같다

export function setupLocMode(opts) {
    const { db, showToast, isActive, getConfig, getNewRows, getShipItems, getLocations } = opts;
    let store = null;
    let sub = 'today';                  // 'today'(당일입고지정) | 'existing'(기존재고지정) — 기억하지 않는다
    let stockLog = {};                  // code → { name, option, loc, opt1 }
    let stockLogState = 'idle';         // 'idle' | 'loading' | 'ok' | 'fail'
    let stockLogErr = '';
    let stockLogBad = 0;                // 깨진 청크 수 — 1 이상이면 받기를 막는다(그 상품이 기존 자리값 없이 들어가 덮어쓸 수 있다)

    async function loadStockLog() {
        stockLogState = 'loading';
        try {
            const snap = await getDocs(collection(db, STOCKLOG_COLL));
            const next = {};
            let bad = 0;
            snap.forEach(d => {
                const s = (d.data() || {}).dataStr;
                if (!s) return;
                let rows;
                try { rows = JSON.parse(s); } catch (e) { bad++; return; }   // 깨진 청크는 세기만 한다(내용은 찍지 않는다)
                Object.assign(next, stockLogPick(rows));               // 청크 순서대로 — 뒤 청크가 이긴다(기존과 같음)
            });
            stockLog = next;
            stockLogBad = bad;
            stockLogState = bad ? 'fail' : 'ok';
            if (bad) stockLogErr = `미발재고로그 조각 ${bad}개가 깨져 있음`;
        } catch (e) {
            stockLogState = 'fail';
            stockLogErr = friendlyFirebaseError(e);
            console.warn('[mibal2-loc] 미발재고로그 읽기 실패:', e && e.code);
        }
        refresh();
    }

    function enter() {
        if (!store) {
            store = ensureScanStore(db);
            store.onChange(() => { if (isActive()) render(); });
            loadStockLog();
        }
        render();
    }
    function refresh() { if (store && isActive()) render(); }

    const ready = () => !!store && store.floor2Seen && store.shardsSeen() > 0;
    // 받기는 더 엄격하게 — 위치 조각 8개가 모두 오고 오류가 없어야 한다(하나라도 빠지면 그 상품들의 지정분이 파일에서 조용히 빠진다)
    const canDownload = () => ready() && store.shardsSeen() === NUM_LOC_SHARDS && !store.shardErr && !store.floor2Err && stockLogState === 'ok';
    const search = () => ($('loc-search').value || '').trim();
    const pos = () => newLocPositionOf(getConfig());

    function newRowMaps() {
        const names = {}, options = {};
        (getNewRows() || []).forEach(r => { if (r && r.code) { if (r.name) names[r.code] = r.name; if (r.option) options[r.code] = r.option; } });
        return { names, options };
    }
    function todayArgs(withSearch) {
        const { names, options } = newRowMaps();
        return { assign: store.assign(), floor2: store.floor2.map, floor2Names: store.floor2.names, names, options, stockLog,
            shipItems: (getShipItems && getShipItems()) || {}, locations: (getLocations && getLocations()) || {}, search: withSearch ? search() : '' };
    }

    // ── 그리기 ──
    function render() {
        if (!store) return;
        document.querySelectorAll('.loc-subtab').forEach(b => b.classList.toggle('on', b.dataset.sub === sub));
        $('chk-loc-front').checked = pos() === 'front';
        const warn = [];
        if (store.floor2Err) warn.push('비축창고 자료를 읽지 못함 — ' + store.floor2Err);
        if (store.shardErr) warn.push('앱 지정 위치를 읽지 못함 — ' + store.shardErr);
        if (stockLogState === 'loading') warn.push('미발재고로그 불러오는 중…');
        if (stockLogState === 'fail') warn.push('미발재고로그를 읽지 못함 — ' + stockLogErr + ' (위치값 엑셀 받기를 막았습니다)');
        $('btn-loc-download').disabled = !canDownload();
        $('btn-loc-download').title = !canDownload()
            ? (stockLogState !== 'ok' && ready() && !store.shardErr && !store.floor2Err ? '미발재고로그를 아직 받지 못했습니다' : '비축창고·앱 지정 위치를 아직 다 받지 못했습니다')
            : '받기 직전에 미발재고로그를 다시 읽습니다';
        if (!ready()) {
            $('loc-summary').innerHTML = warn.length ? `<span class="t-risk">⚠ ${warn.map(esc).join(' / ')}</span>` : '불러오는 중…';
            $('loc-thead').innerHTML = '';
            $('loc-tbody').innerHTML = '<tr><td class="t-3" style="padding:40px;">불러오는 중…</td></tr>';
            return;
        }
        if (sub === 'today') renderToday(warn); else renderExisting(warn);
    }
    function renderToday(warn) {
        const rows = todayLocRows(todayArgs(true));
        const miss = rows.filter(r => r.missing).length;
        const assigned = rows.filter(r => r.assigned).length;
        $('loc-summary').innerHTML = `당일입고지정 <b>${rows.length.toLocaleString()}개 상품</b> (비축 입고분 + 오늘 지정) · 자리 지정됨 <b>${assigned.toLocaleString()}</b>`
            + (miss ? ` · 비축됐는데 자리 미지정 <b class="t-risk">${miss.toLocaleString()}</b> (맨 위)` : '')
            + (warn.length ? `<br><span class="t-risk">⚠ ${warn.map(esc).join(' / ')}</span>` : '');
        $('loc-thead').innerHTML = '<tr><th>No</th><th>상품코드</th><th>상품명</th><th>옵션명</th><th>로케이션</th><th>옵션추가항목1</th><th>추가위치</th></tr>';
        $('loc-tbody').innerHTML = rows.length ? rows.map((r, i) => `<tr${r.missing ? ' class="loc-miss"' : ''}>
                <td>${i + 1}</td><td class="code-cell">${esc(r.code)}</td><td class="name-cell">${esc(r.name)}</td><td>${esc(r.option)}</td>
                <td>${r.locFromApp ? `<span class="t-3" title="미발재고로그에 없는 상품 — 앱 로케이션관리 자리(이지어드민 값 아님)">${esc(r.location)} (앱)</span>` : esc(r.location)}</td><td>${esc(r.opt1)}</td>
                <td>${r.newLocs.length ? r.newLocs.map(p => `<span class="loc-new">${esc(p)}</span>`).join(', ') : '<span class="t-risk" style="font-weight:600;">⚠️ 미지정</span>'}</td></tr>`).join('')
            : `<tr><td colspan="7" class="t-3" style="padding:40px;">${search() ? '검색에 맞는 상품이 없습니다.' : '비축창고 입고분도, 오늘 위치가 지정된 상품도 없습니다.'}</td></tr>`;
    }
    function locListHtml(location, base) {
        const b = new Set(locPartsArr(base));
        return locPartsArr(location).map(p => b.has(p) ? `<span class="t-2">${esc(p)}</span>` : `<span class="loc-new">${esc(p)}</span>`).join(', ');
    }
    function renderExisting(warn) {
        const rows = existingLocRows({ assign: store.assign(), search: search() });
        const flagged = rows.filter(r => r.noBase).length;
        const notes = [];
        if (flagged) notes.push(`<b class="t-warn">⚠️ 파일에 없던 상품 ${flagged}건 포함</b>`);
        if (rows.length > RENDER_CAP) notes.push(`상위 ${RENDER_CAP}건만 표시 · 전체 ${rows.length}건 (검색으로 좁히기)`);
        $('loc-summary').innerHTML = `기존재고지정 — 스캐너로 전송된 상품 <b>${rows.length.toLocaleString()}건</b> (최신순)`
            + (notes.length ? ' · ' + notes.join(' · ') : '')
            + (warn.length ? `<br><span class="t-risk">⚠ ${warn.map(esc).join(' / ')}</span>` : '');
        $('loc-thead').innerHTML = '<tr><th>상품코드</th><th>위치 (초록 = 새로 추가된 자리)</th><th>지정 시각</th></tr>';
        $('loc-tbody').innerHTML = rows.length ? rows.slice(0, RENDER_CAP).map(r => `<tr${r.noBase ? ' class="loc-warn"' : ''}>
                <td class="code-cell">${esc(r.code)}${r.noBase ? '<div><span class="flag warn" title="업로드 파일에 없던 상품 — 기존 위치를 몰라 스캔한 자리만 반영됩니다">파일에 없던 상품</span></div>' : ''}</td>
                <td style="text-align:left;">${locListHtml(r.location, r.base)}</td><td class="t-3">${esc(fmtAt(r.atMs))}</td></tr>`).join('')
            : '<tr><td colspan="3" class="t-3" style="padding:40px;">전송된 기존재고가 없습니다.<br><span style="font-size:11px;">(기존재고 업로드 후 스캐너 \'기존재고\' 모드로 위치를 찍어 전송하면 여기 표시됩니다)</span></td></tr>';
    }

    // ── 시험 위치값 엑셀 받기 (내 PC 다운로드만 — 형식은 기존과 같은 .xls) ──
    function writeXls(aoa, name) {
        const X = window.XLSX;
        if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'worksheet');
        X.writeFile(wb, name, { bookType: 'biff8' });
        showToast(TEST_TOAST);
    }
    function downloadToday() {
        const shown = todayLocRows(todayArgs(true));
        const all = todayLocRows(todayArgs(false));
        const r = dayLocAoa({ assign: store.assign(), floor2: store.floor2.map, stockLog, shownRows: shown, allRows: all, pos: pos() });
        if (r.hidden && !confirm(`⚠️ 검색으로 화면에서 숨겨진 지정 상품 ${r.hidden}건은 받는 파일에서 빠집니다.\n(검색을 지우고 받으면 모두 들어갑니다)\n\n그래도 받을까요?`)) return;
        if (!r.count) { alert('당일 입고분으로 위치가 지정된 상품이 없습니다.\n(스캐너 위치모드 "당일 입고분"으로 지정 후 이용하세요)'); return; }
        if (!r.f2Known) alert('비축창고 입고분이 비어 있어 \'파일에 없던 상품\' 판정을 건너뜁니다.\n(위치값 파일에 \'비고\' 열이 들어가지 않습니다)');
        if (r.flagged && !confirm(`⚠️ 비축창고 입고파일에 없던 상품 ${r.flagged}건이 포함되어 있습니다.\n(패킹과 다르게 도착했을 수 있음 — 위치값 파일 '비고'에 '파일에 없던 상품'으로 표시됩니다)\n\n그대로 받을까요?`)) return;
        if (r.risky && !confirm(`⚠️ 미발재고로그에 없는 상품 ${r.risky}건이 있습니다.\n기존 옵션추가항목1 을 알 수 없어 '스캔한 자리만' 들어가므로, 이지어드민에 이미 있던 자리값을 덮어쓸 수 있습니다.\n\n그래도 받을까요?`)) return;
        writeXls(r.aoa, `시험_위치값_${ymd()}.xls`);
    }
    function downloadExisting() {
        const r = locMoveAoa({ rows: existingLocRows({ assign: store.assign(), search: search() }), pos: pos() });
        if (!r.count) { alert('새로 추가된 위치가 없습니다.\n(기존재고 업로드 후 스캐너 "기존재고" 모드로 새 자리를 지정하세요)'); return; }
        if (r.flagged && !confirm(`⚠️ 기존값(업로드 파일)에 없던 상품 ${r.flagged}건이 포함되어 있습니다.\n이 상품들은 기존 옵션추가항목1 없이 '스캔한 자리만' 들어가, 이지어드민의 기존값을 덮어쓸 수 있습니다.\n\n그래도 전체 받을까요?`)) return;
        writeXls(r.aoa, `시험_기존재고_위치값_${ymd()}.xls`);
    }
    let downloading = false;
    async function download() {
        if (downloading || !canDownload()) return;
        // 이 탭을 연 뒤 다른 화면에서 미발재고로그를 새로 올렸을 수 있다 — 받기 직전에 다시 읽는다(옛 옵션추가항목1 이 섞이지 않게)
        downloading = true;
        $('btn-loc-download').disabled = true;
        try { await loadStockLog(); } finally { downloading = false; render(); }
        if (!canDownload()) { showToast('⚠️ 미발재고로그를 다시 읽지 못해 받지 않았습니다'); return; }
        if (sub === 'today') downloadToday(); else downloadExisting();
    }

    // ── 이벤트 (켜진 것만. 꺼진 단추·체크박스에는 아무것도 걸지 않는다) ──
    document.querySelectorAll('.loc-subtab').forEach(b => b.addEventListener('click', () => { sub = b.dataset.sub === 'existing' ? 'existing' : 'today'; render(); }));
    $('loc-search').addEventListener('input', () => render());
    $('btn-loc-download').addEventListener('click', download);

    return { enter, refresh };
}
