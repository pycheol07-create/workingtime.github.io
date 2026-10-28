// === js/china-mibal2-scan.js ===
// 신규 미발계산기(china-mibal2.html) '스캐너 연동 (시험 — 읽기 전용)' 줄. 2026-10-27.
//
// ⚠️ 읽기만 한다. 운영 스캐너 자료(ScanDB·InboundHistory·FLOOR2_STOCK·FORCE_ALLOW·ScanDB_Versions·LOC_SHARD·InboundDiff)에는
//    한 건도 쓰지 않는다 — firestore 쓰기 함수를 import 하지 않는다(tests/mibal2-readonly.test.js 가 소스를 검사).
//    쓰기 버튼(스캐너DB 반영·스캔잠금·버전·미발 초기화)은 HTML 에서 disabled — 여기서 이벤트도 걸지 않는다.
// 읽기(경로·이름은 js/china-stock-goods.js 와 같다 — 그 파일은 import 하지 않는다):
//   · ChinaStockGoods/FLOOR2_STOCK · LOC_SHARD_0~7 구독 — [비축창고 보기]를 열거나 '위치지정(시험)' 보기에 처음 들어갈 때부터.
//     구독은 한 벌(ensureScanStore)을 두 곳이 같이 쓴다 — 페이지를 열기만 해서는 읽지 않는다.
//     LOC_SHARD 는 위치지정 표에 쓰는 칸만 남긴다(작업자 이름 대신 스캐너 전송분인지만 — js/lib/loc-mode.js locAssignFullOf)
//   · ChinaStockGoods_InboundHistory·ChinaStockGoods_ScanDB 1회 읽기 — [스캐너 값 미리보기 엑셀]을 누를 때만(구독 안 함.
//     입고이력은 barcode·qty 만 씀 — 앱 스캔 입고분을 빼서 넣을 값을 만든다)
//   표의 입고확인·차이 열과 입고 오차 통계·기록은 두지 않는다(기존 부족수량관리의 기능 — 2026-10-27·28 사용자 결정)
// 엑셀은 내 PC 로 내려받기만 한다(신규 화면과 같은 XLSX.writeFile .xlsx). 파일 이름은 '시험_' 으로 시작 — 이지어드민 업로드용이 아니다.
import { getDocs, onSnapshot, doc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { inboundMapOf, floor2MapOf, locAssignOf, scanDbPreviewOf, previewCompareAoa } from './lib/scan-link.js?v=202610281021';
import { locAssignFullOf } from './lib/loc-mode.js?v=202610281021';
import { friendlyFirebaseError } from './utils.js?v=202610281021';

const CHINA_COLLECTION = 'ChinaStockGoods';
const INBOUND_COLL = CHINA_COLLECTION + '_InboundHistory';
const SCANDB_COLL = CHINA_COLLECTION + '_ScanDB';
const FLOOR2_DOC = 'FLOOR2_STOCK';
const NUM_LOC_SHARDS = 8;   // china-stock-goods.js NUM_LOC_SHARDS 와 같다

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
 * 비축창고(FLOOR2_STOCK)·앱 지정 위치(LOC_SHARD_0~7) 구독 한 벌 — 처음 부를 때만 구독을 건다(두 번째부터는 같은 것).
 * [비축창고 보기]와 '위치지정(시험)' 보기(js/china-mibal2-loc.js)가 같이 쓴다. 읽기만 한다.
 * 반환 store:
 *   floor2 {map, names} · floor2Err · floor2Seen
 *   assign() → { code: {location, base, sub, at, scanned} } (js/lib/loc-mode.js locAssignFullOf)
 *   shardsSeen() → 응답이 온 샤드 수(0~8) · shardErr
 *   onChange(fn) — 구독 값이 바뀌면 부른다. 여러 번 와도 한 화면 그리기(requestAnimationFrame)로 모은다
 */
let scanStore = null;
export function ensureScanStore(db) {
    if (scanStore) return scanStore;
    const shardMaps = new Array(NUM_LOC_SHARDS).fill(null);
    const listeners = [];
    let frame = 0;
    const notify = () => {
        if (frame) return;
        const run = () => { frame = 0; listeners.forEach(fn => { try { fn(); } catch (e) { console.warn('[mibal2-scan] 다시 그리기 실패:', e && e.message); } }); };
        frame = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(run) : setTimeout(run, 0);
    };
    const store = {
        floor2: { map: {}, names: {} }, floor2Err: '', floor2Seen: false, shardErr: '',
        // 위치 원문(샤드 map)은 여기 밖으로 내지 않는다 — 쓰는 칸만 고른 사본
        assign: () => locAssignFullOf(shardMaps.filter(Boolean)),
        assignBasic: () => locAssignOf(shardMaps.filter(Boolean)),
        shardsSeen: () => shardMaps.filter(Boolean).length,
        onChange: (fn) => { listeners.push(fn); }
    };
    scanStore = store;
    onSnapshot(doc(db, CHINA_COLLECTION, FLOOR2_DOC), (snap) => {
        store.floor2 = floor2MapOf(snap.exists() ? snap.data() : null);
        store.floor2Err = ''; store.floor2Seen = true;
        notify();
    }, (err) => {
        store.floor2Err = friendlyFirebaseError(err); store.floor2Seen = true;
        notify();
    });
    for (let i = 0; i < NUM_LOC_SHARDS; i++) {
        onSnapshot(doc(db, CHINA_COLLECTION, 'LOC_SHARD_' + i), (snap) => {
            const d = snap.exists() ? snap.data() : null;
            shardMaps[i] = (d && d.map) ? d.map : {};
            notify();
        }, (err) => {
            store.shardErr = friendlyFirebaseError(err);
            console.warn('[mibal2-scan] 위치 샤드 읽기 실패:', err && err.code);
            notify();
        });
    }
    return store;
}

/**
 * 버튼·창 연결. opts:
 *   db, showToast(msg), setLoading(on, text),
 *   getLiveRows() → 오늘(실시간) 보기의 행
 */
export function setupScanTools(opts) {
    const { db, showToast, setLoading, getLiveRows } = opts;

    // ── 비축창고 보기 (FLOOR2_STOCK + 앱 지정 위치 LOC_SHARD — ensureScanStore 구독 공유) ──
    let store = null;
    const floor2Open = () => $('floor2-modal').style.display === 'flex';
    function ensureFloor2() {
        if (store) return;
        store = ensureScanStore(db);
        store.onChange(() => { if (floor2Open()) renderFloor2(); });
    }
    const subText = (s) => (s === 'today' ? '당일입고' : s === 'existing' ? '기존재고' : s);
    function floor2Rows() {
        const floor2 = store.floor2;
        const assign = store.assignBasic();
        return Object.keys(floor2.map).sort().map(code => {
            const a = assign[code];
            return { code, name: floor2.names[code] || '', qty: floor2.map[code], loc: a && a.location ? a.location : '', sub: a ? subText(a.sub) : '' };
        });
    }
    function renderFloor2() {
        const tb = $('f2-tbody');
        const { floor2Seen, floor2Err } = store;
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
        if (!store) return;
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

    // ── 이벤트 (켜진 버튼 2개 + 창 안 버튼만. 꺼진 버튼에는 아무것도 걸지 않는다) ──
    $('btn-scan-floor2').addEventListener('click', openFloor2);
    $('btn-scan-preview').addEventListener('click', downloadPreview);
    const close = (id) => { $(id).style.display = 'none'; };
    $('btn-floor2-close').addEventListener('click', () => close('floor2-modal'));
    $('floor2-modal').addEventListener('click', (e) => { if (e.target.id === 'floor2-modal') close('floor2-modal'); });
    $('btn-f2-download').addEventListener('click', downloadFloor2);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if ($('floor2-modal').style.display === 'flex') close('floor2-modal');
    });
}
