// === js/china-mibal2-scan.js ===
// 신규 미발계산기(china-mibal2.html) '스캐너 연동 (시험 — 읽기 전용)' 줄. 2026-10-27.
//
// ⚠️ 읽기만 한다. 운영 스캐너 자료(ScanDB·InboundHistory·FLOOR2_STOCK·FORCE_ALLOW·ScanDB_Versions·LOC_SHARD·InboundDiff)에는
//    한 건도 쓰지 않는다 — firestore 쓰기 함수를 import 하지 않는다(tests/mibal2-readonly.test.js 가 소스를 검사).
//    쓰기 버튼(스캐너DB 반영·스캔잠금·버전·미발 초기화·입고 오차 기록)은 HTML 에서 disabled — 여기서 이벤트도 걸지 않는다.
// 읽기(경로·이름은 js/china-stock-goods.js 와 같다 — 그 파일은 import 하지 않는다):
//   · ChinaStockGoods/FLOOR2_STOCK 구독 — [비축창고 보기]를 처음 열 때부터
//   · ChinaStockGoods/LOC_SHARD_0~7 구독 — [비축창고 보기]를 처음 열 때부터(앱 지정 위치. 작업자 이름은 꺼내지 않는다)
//   · ChinaStockGoods_InboundDiff 기간 읽기 — [입고 오차 통계]를 열 때
//   · ChinaStockGoods_InboundHistory·ChinaStockGoods_ScanDB 1회 읽기 — [스캐너 값 미리보기 엑셀]을 누를 때만(구독 안 함.
//     입고이력은 barcode·qty 만 씀 — 앱 스캔 입고분을 빼서 넣을 값을 만든다)
//   표의 입고확인·차이 열은 두지 않는다(기존 부족수량관리의 기능 — 2026-10-27 사용자 결정)
// 엑셀은 내 PC 로 내려받기만 한다(신규 화면과 같은 XLSX.writeFile .xlsx). 파일 이름은 '시험_' 으로 시작 — 이지어드민 업로드용이 아니다.
import { getDocs, onSnapshot, doc, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { inboundMapOf, floor2MapOf, locAssignOf, scanDbPreviewOf, previewCompareAoa } from './lib/scan-link.js?v=202610271228';
import { summarizeByShip, monthlyTrend, topCodes, bySupplier, overallSummary, statsAoa, queryRange, shiftIso, STATS_TAB_LABEL } from './lib/inbound-diff.js?v=202610271228';
import { friendlyFirebaseError } from './utils.js?v=202610271228';

const CHINA_COLLECTION = 'ChinaStockGoods';
const INBOUND_COLL = CHINA_COLLECTION + '_InboundHistory';
const SCANDB_COLL = CHINA_COLLECTION + '_ScanDB';
const INBOUND_DIFF_COLL = CHINA_COLLECTION + '_InboundDiff';
const FLOOR2_DOC = 'FLOOR2_STOCK';
const NUM_LOC_SHARDS = 8;   // china-stock-goods.js NUM_LOC_SHARDS 와 같다
// 기존 화면(china-stock-goods.js INBOUND_DIFF_DENIED)과 같은 문구 — 규칙 게시 전이면 읽기도 막힌다
const INBOUND_DIFF_DENIED = '입고 오차 기록 권한이 없습니다(서버 규칙 게시 전이거나 등록 직원이 아닙니다).';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPermissionDenied = (e) => !!e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));
const pad2 = (n) => String(n).padStart(2, '0');
const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ymd = (d = new Date()) => todayISO(d).replace(/-/g, '');

/**
 * 입고이력 1회 읽기 → { barcode: qty 합 }. 문서에서 barcode·qty 만 꺼낸다(작업자 등 다른 칸은 보지 않는다).
 */
async function readInboundMap(db) {
    const snap = await getDocs(collection(db, INBOUND_COLL));
    return inboundMapOf(snap.docs.map(d => { const x = d.data() || {}; return { barcode: x.barcode, qty: x.qty }; }));
}

/**
 * 버튼·창 연결. opts:
 *   db, showToast(msg), setLoading(on, text),
 *   getLiveRows() → 오늘(실시간) 보기의 행(날짜별 보기면 null)
 */
export function setupScanTools(opts) {
    const { db, showToast, setLoading, getLiveRows } = opts;

    // ── 입고 오차 통계 (읽기 전용 — 기존 화면 openInboundDiffModal 과 같은 표) ──
    let idfTab = 'ship';
    let idfRecs = [];
    let idfReqSeq = 0;
    const idfOpts = () => ({
        from: $('idf-from').value || '', to: $('idf-to').value || '',
        kind: $('idf-kind').value || 'all', includeNoScan: !!$('idf-noscan').checked
    });
    const idfData = (tab, recs, o) => {
        if (tab === 'month') return monthlyTrend(recs, o);
        if (tab === 'code') return topCodes(recs, o);
        if (tab === 'supplier') return bySupplier(recs, o);
        return summarizeByShip(recs, o);
    };
    async function fetchInboundDiffRange(from, to) {
        const { start, end } = queryRange(from, to);
        const cons = [];
        if (start) cons.push(where(documentId(), '>=', start));
        if (end) cons.push(where(documentId(), '<=', end));
        const snap = await getDocs(query(collection(db, INBOUND_DIFF_COLL), ...cons));
        return snap.docs.map(d => d.data());
    }
    async function refreshStats() {
        const o = idfOpts();
        const tb = $('idf-tbody');
        const seq = ++idfReqSeq;
        tb.innerHTML = '<tr><td class="t-3" style="padding:22px;">불러오는 중...</td></tr>';
        let recs;
        try { recs = await fetchInboundDiffRange(o.from, o.to); }
        catch (e) {
            if (seq !== idfReqSeq) return;
            idfRecs = [];
            $('idf-summary').textContent = '';
            tb.innerHTML = `<tr><td style="padding:22px;" class="t-risk">${esc(isPermissionDenied(e) ? INBOUND_DIFF_DENIED : '불러오지 못했습니다 — ' + friendlyFirebaseError(e))}</td></tr>`;
            return;
        }
        if (seq !== idfReqSeq) return;   // 그사이 더 새 요청이 있었다
        idfRecs = recs;
        renderStats();
    }
    function renderStats() {
        const o = idfOpts();
        document.querySelectorAll('#idf-tabs .idf-tab').forEach(b => b.classList.toggle('d-btn-primary', b.dataset.tab === idfTab));
        const g = overallSummary(summarizeByShip(idfRecs, o));
        const n = (v) => Number(v || 0).toLocaleString();
        $('idf-summary').innerHTML = `패킹 <b>${n(g.packs)}건</b>${g.bundles ? ` (+ 묶음 줄 ${n(g.bundles)})` : ''} · 도착 <b>${n(g.arr)}</b> · 입고 <b>${n(g.conf)}</b>`
            + ` · 오차 <b>${n(g.errN)}품목</b> (부족 <b class="t-risk">${n(g.short)}</b> · 과입고 <b class="t-accent">${n(g.over)}</b>)`
            + ` · 오차율 <b>${g.rate === null ? '–' : esc((Math.round(g.rate * 1000) / 10).toFixed(1)) + '%'}</b>`
            + ` · 미스캔 <b>${n(g.noScanN)}품목 ${n(g.noScanQ)}장</b>${o.includeNoScan ? ' (오차·오차율에 포함)' : ' (오차·오차율에서 뺌)'}`;
        const aoa = statsAoa(idfTab, idfData(idfTab, idfRecs, o));
        const head = aoa[0] || [], rows = aoa.slice(1);
        $('idf-thead').innerHTML = '<tr>' + head.map(h => `<th class="d-th">${esc(h)}</th>`).join('') + '</tr>';
        const cls = (h, v) => (h === '부족' && v > 0) ? ' class="t-risk"' : ((h === '과입고' && v > 0) ? ' class="t-accent"' : '');
        $('idf-tbody').innerHTML = rows.length ? rows.map(r => '<tr style="border-bottom:1px solid var(--c-line);">'
            + r.map((v, i) => `<td${cls(head[i], v)} style="padding:6px 6px;">${esc(v === null || v === undefined ? '' : v)}</td>`).join('') + '</tr>').join('')
            : `<tr><td colspan="${head.length || 1}" class="t-3" style="padding:22px;">기간 안에 기록이 없습니다. 기록은 기존 미발계산기에서 쌓입니다(이 화면은 읽기만 합니다).</td></tr>`;
    }
    function downloadStats() {
        const X = window.XLSX;
        if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
        const o = idfOpts();
        const aoa = statsAoa(idfTab, idfData(idfTab, idfRecs, o));
        if (aoa.length <= 1) { showToast('내려받을 데이터가 없습니다'); return; }
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'worksheet');
        X.writeFile(wb, `시험_입고오차_${(STATS_TAB_LABEL[idfTab] || idfTab).replace(/\s+/g, '')}_${o.from || '처음'}_${o.to || '끝'}.xlsx`);
    }
    async function openStats() {
        if (!$('idf-from').value) $('idf-from').value = shiftIso(todayISO(), -90);   // 기본 90일
        if (!$('idf-to').value) $('idf-to').value = todayISO();
        $('inbound-diff-modal').style.display = 'flex';
        await refreshStats();   // 열 때마다 새로 읽는다
    }

    // ── 비축창고 보기 (FLOOR2_STOCK + 앱 지정 위치 LOC_SHARD — 처음 열 때부터 구독) ──
    let floor2 = { map: {}, names: {} };
    let floor2Err = '';
    let floor2Seen = false;
    const shardMaps = new Array(NUM_LOC_SHARDS).fill(null);
    let subscribed = false;
    const floor2Open = () => $('floor2-modal').style.display === 'flex';
    function ensureFloor2() {
        if (subscribed) return;
        subscribed = true;
        onSnapshot(doc(db, CHINA_COLLECTION, FLOOR2_DOC), (snap) => {
            floor2 = floor2MapOf(snap.exists() ? snap.data() : null);
            floor2Err = ''; floor2Seen = true;
            if (floor2Open()) renderFloor2();
        }, (err) => {
            floor2Err = friendlyFirebaseError(err); floor2Seen = true;
            if (floor2Open()) renderFloor2();
        });
        for (let i = 0; i < NUM_LOC_SHARDS; i++) {
            onSnapshot(doc(db, CHINA_COLLECTION, 'LOC_SHARD_' + i), (snap) => {
                const d = snap.exists() ? snap.data() : null;
                shardMaps[i] = (d && d.map) ? d.map : {};
                if (floor2Open()) renderFloor2();
            }, (err) => console.warn('[mibal2-scan] 위치 샤드 읽기 실패:', err && err.code));
        }
    }
    const subText = (s) => (s === 'today' ? '당일입고' : s === 'existing' ? '기존재고' : s);
    function floor2Rows() {
        const assign = locAssignOf(shardMaps.filter(Boolean));
        return Object.keys(floor2.map).sort().map(code => {
            const a = assign[code];
            return { code, name: floor2.names[code] || '', qty: floor2.map[code], loc: a && a.location ? a.location : '', sub: a ? subText(a.sub) : '' };
        });
    }
    function renderFloor2() {
        const tb = $('f2-tbody');
        if (!floor2Seen) { tb.innerHTML = '<tr><td colspan="5" class="t-3" style="padding:22px;">불러오는 중...</td></tr>'; $('f2-summary').textContent = ''; return; }
        if (floor2Err) { tb.innerHTML = `<tr><td colspan="5" class="t-risk" style="padding:22px;">비축창고 자료를 읽지 못했습니다 — ${esc(floor2Err)}</td></tr>`; $('f2-summary').textContent = ''; return; }
        const rows = floor2Rows();
        const total = rows.reduce((s, r) => s + r.qty, 0);
        const noLoc = rows.filter(r => !r.loc).length;
        $('f2-summary').innerHTML = `비축창고 입고분 <b>${rows.length.toLocaleString()}개 상품</b> · 작업수량 합 <b>${total.toLocaleString()}</b>`
            + (noLoc ? ` · 앱 지정 위치 없음 <b class="t-risk">${noLoc.toLocaleString()}개</b>` : '')
            + ' <span class="t-3">(스캐너가 미발수량을 넘긴 초과분을 쌓은 값 · 미발 초기화 때 비워짐)</span>';
        tb.innerHTML = rows.length ? rows.map((r, i) => `<tr style="border-bottom:1px solid var(--c-line);">
                <td style="padding:5px 6px;">${i + 1}</td><td style="padding:5px 6px; font-weight:600;">${esc(r.code)}</td>
                <td style="padding:5px 6px; text-align:left;">${esc(r.name)}</td><td style="padding:5px 6px;"><b>${esc(r.qty)}</b></td>
                <td style="padding:5px 6px;">${r.loc ? esc(r.loc) + (r.sub ? ` <span class="t-3">(${esc(r.sub)})</span>` : '') : '<span class="t-3">–</span>'}</td></tr>`).join('')
            : '<tr><td colspan="5" class="t-3" style="padding:22px;">비축창고로 입고된 데이터가 없습니다. (입고 스캔 시 미발수량을 넘긴 초과분이 비축창고로 잡힙니다)</td></tr>';
    }
    function downloadFloor2() {
        const X = window.XLSX;
        if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
        const rows = floor2Rows();
        if (!rows.length) { showToast('비축창고로 입고된 데이터가 없습니다'); return; }
        const aoa = [['상품코드', '상품명', '작업수량', '앱 지정 위치', '위치 구분'], ...rows.map(r => [r.code, r.name, r.qty, r.loc, r.sub])];
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), '비축창고');
        X.writeFile(wb, `시험_비축창고_${ymd()}.xlsx`);
    }
    function openFloor2() {
        ensureFloor2();
        $('floor2-modal').style.display = 'flex';
        renderFloor2();
    }

    // ── 스캐너 값 미리보기 엑셀 (신규 계산이면 ScanDB 에 들어갈 값 vs 지금 ScanDB — 쓰지 않는다) ──
    async function downloadPreview() {
        const X = window.XLSX;
        if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
        const rows = getLiveRows();
        if (!rows) { showToast('오늘(실시간) 보기에서 쓰세요'); return; }
        setLoading(true, '입고이력·지금 스캐너DB 값 읽는 중(읽기만)...');
        let preview;
        let scanDb = {};
        try {
            preview = scanDbPreviewOf(rows, await readInboundMap(db));
            const snap = await getDocs(collection(db, SCANDB_COLL));
            snap.forEach(d => { const v = d.data() || {}; scanDb[d.id] = { arrivalQty: v.arrivalQty, mibalQty: v.mibalQty, location: v.location, name: v.name }; });
        } catch (e) {
            setLoading(false);
            showToast('⚠️ 입고이력·스캐너DB 읽기 실패 — ' + friendlyFirebaseError(e));
            return;
        }
        setLoading(false);
        const aoa = previewCompareAoa(preview, scanDb);
        if (aoa.length <= 1) { showToast('비교할 행이 없습니다'); return; }
        const diffN = aoa.slice(1).filter(r => r[r.length - 1]).length;
        const note = [
            ['시험용 미리보기 — 스캐너DB 에는 아무것도 쓰지 않았습니다. 이지어드민 업로드용 파일이 아닙니다.'],
            ['신규 arrivalQty = max(도착 − 앱 스캔 입고, 0) · 신규 mibalQty = max(피킹 배정수량 − 앱 스캔 입고, 0) (비축 모름이면 빈칸)'],
            ['신규 location = 로케이션관리(Locations) 대표 피킹자리 · ScanDB location = 기존 계산기(미발재고로그 로케이션)'],
            ['대상 = 선택 출고일에 도착이 있는 코드 + 지금 ScanDB 에 있는 코드'],
            [`만든 때 ${new Date().toLocaleString()} · 코드 ${aoa.length - 1}개 · 다른 칸 있음 ${diffN}개`]
        ];
        const wb = X.utils.book_new();
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), '미리보기비교');
        X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(note), '안내');
        X.writeFile(wb, `시험_스캐너미리보기_${ymd()}.xlsx`);
    }

    // ── 이벤트 (켜진 버튼 3개 + 창 안 버튼만. 꺼진 버튼에는 아무것도 걸지 않는다) ──
    $('btn-scan-stats').addEventListener('click', openStats);
    $('btn-scan-floor2').addEventListener('click', openFloor2);
    $('btn-scan-preview').addEventListener('click', downloadPreview);
    const close = (id) => { $(id).style.display = 'none'; };
    $('btn-inbound-diff-close').addEventListener('click', () => close('inbound-diff-modal'));
    $('inbound-diff-modal').addEventListener('click', (e) => { if (e.target.id === 'inbound-diff-modal') close('inbound-diff-modal'); });
    ['idf-from', 'idf-to'].forEach(id => $(id).addEventListener('change', refreshStats));
    ['idf-kind', 'idf-noscan'].forEach(id => $(id).addEventListener('change', renderStats));
    $('idf-tabs').addEventListener('click', (e) => { const b = e.target.closest('.idf-tab'); if (b) { idfTab = b.dataset.tab; renderStats(); } });
    $('btn-idf-download').addEventListener('click', downloadStats);
    $('btn-floor2-close').addEventListener('click', () => close('floor2-modal'));
    $('floor2-modal').addEventListener('click', (e) => { if (e.target.id === 'floor2-modal') close('floor2-modal'); });
    $('btn-f2-download').addEventListener('click', downloadFloor2);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        ['inbound-diff-modal', 'floor2-modal'].forEach(id => { if ($(id).style.display === 'flex') close(id); });
    });
}
