// === js/china-mibal2-live.js ===
// 신규 부족수량관리 단독 운영(live) 쓰기 도구 — js/china-mibal2.js 가 live 일 때만 동적 import 한다. 2026-10-28 준비.
// 상수 js/lib/mibal2-mode.js MIBAL2_LIVE 가 false(지금)면 이 파일은 불러오지도 않는다(에뮬레이터 시험 주소 ?emu=1&live=1 제외).
// 계산은 js/lib/mibal2-live.js(순수 함수). 화면 문구·버튼은 기존 HTML 을 고쳐 쓴다(시험 때 HTML 은 그대로).
//
// 하는 일(기존 화면 js/china-stock-goods.js 의 같은 기능을 옮김 — 그 파일은 그대로 두어 되돌리기용으로 남긴다):
//   [스캐너에 반영]   ChinaStockGoods_ScanDB — 새 목록 set(칸: code·name·option·arrivalQty·mibalQty·totalStock·location·capacity·updatedAt,
//                    merge 아님 → hold 하위 컬렉션은 건드리지 않음) + 빠진 코드만 delete. 직전에 ScanDB_Versions 'pre-apply' 백업.
//                    작업(mibal2/settings.batch {id, ships, startedAt, appliedAt})을 시작·갱신한다. 최근 스캔 입고가 있으면 확인창.
//   [직전으로 되돌리기] 가장 최근 'pre-apply' 버전으로(기존 rollbackScanDBVersion 과 같은 쓰기, 잠금 없음)
//   [작업 마감]       ChinaStockGoods_Archive/{작업번호} 보관 → InboundDiff(trigger 'close') → MIBAL_HISTORY 입고미발(v2)
//                    → InboundHistory 삭제(읽은 문서만) · FLOOR2_STOCK·FORCE_ALLOW 비움 → batch 지움. StockLog·EDITED_CELLS 는 안 지운다.
//   [지난 작업 보기]   보관함 목록·엑셀 받기 · [스캔 내역] 조회(마감 때 보관함과 한 batch 로 저장한 내역 — ChinaStockGoods_ScanDB_Versions/_archiveScans/jobs)
//   [입고 오차 기록]   수동(기존 recordInboundDiffManual 과 같은 확인 흐름)
//   [바코드 매핑 올리기] 엑셀의 상품코드·바코드 두 열 → BARCODE_MAP(통째로 바꿈, 기존 미발재고로그 업로드와 같음)
//   [입고용 파일·미발확인 파일·비축창고 엑셀 받기] 이지어드민 업로드용 — 기존 화면과 같은 파일(내용은 lib/mibal2-live.js)
//   화면을 열면 그날 1회 MIBAL_HISTORY(basis 'v2') — 아직 입고 안 된 패킹별 미발수량(업무예상)
//   위치 쓰기(js/china-mibal2-live-loc.js) · 관리 창·적재량 편집(js/china-mibal2-live-admin.js)
// 이메일은 어디에도 저장하지 않는다(기록자 = 직원 이름). 공급처 이름·원가 없음.
import { doc, getDoc, getDocs, getDocFromServer, getDocsFromServer, setDoc as _setDoc, writeBatch as _writeBatch, collection, query, orderBy, limit, startAfter, where, documentId, serverTimestamp, deleteField }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { scanApplyPlan, versionDataOf, archiveRecordOf, shrinkArchive, archiveAoa, diffRowsOf, historyGroupsOf, historyRecordsOf,
    stableSig, hasHistoryToday, mibalTotalsOf, barcodeMapOfAoa, batchIdOf, isoDay, ARCHIVE_COLL, RECENT_SCAN_MIN, partialRecordOf,
    fileRowsOf, inboundFileAoa, mibalFileAoa, floor2FileAoa, readAllPages } from './lib/mibal2-live.js?v=202611101512';
import { buildDiffRecord, shouldAutoSave, mergeRev, shrinkIfLarge, diffSummaryText, overlapping, queryRange } from './lib/inbound-diff.js?v=202611101512';
import { inboundMapOf, floor2MapOf } from './lib/scan-link.js?v=202611101512';
import { inboundSig } from './lib/inbound-fix.js?v=202611101512';
import { buildScanLogDocs, expandScanLogDocs, checkScanLogParts, docIdOf, scanLogInputOf, scanLogListHtml, scanLogExcelRows,
    SCANLOG_JOBS_COLL, SCANLOG_MAX_PARTS } from './lib/mibal2-scanlog.js?v=202611101512';
import { setupLiveLoc } from './china-mibal2-live-loc.js?v=202611101512';
import { setupLiveAdmin, readSheetRowsAOA, packMap, unpackMap } from './china-mibal2-live-admin.js?v=202611101512';
import { gated, gatedBatch, run as gateRun, isFrozen } from './mibal2-gate.js?v=202611101512';
import { needReapply, staleRollback } from './lib/mibal2-fallback.js?v=202611101512';
import { shipMismatchOf, mismatchLine, mismatchBlockText } from './lib/ship-mismatch.js?v=202611101512';
import { writeXls, xlsBytes } from './lib/xls-limits.js?v=202611101512';

// 쓰기 덮개(비상 스위치, 2026-11-10) — 비상 전환 중(조회 전용)이면 막는다. 멈추기 전에 시작한 작업(guard 안)은 끝까지 한다(js/mibal2-gate.js)
const setDoc = gated(_setDoc);
const writeBatch = gatedBatch(_writeBatch);
const FROZEN_MSG = '⛔ 비상 전환 중 — 이 화면은 조회 전용입니다(기존 화면에서 작업하세요)';
// 비상 전환 때 끄는 버튼(쓰기). 받기·보기 버튼은 그대로
const WRITE_BTN_IDS = ['btn-scan-off-sync', 'btn-scan-off-version', 'btn-scan-off-reset', 'btn-scan-off-diffrec', 'btn-live-barcode',
    'btn-loc-off-upload', 'btn-loc-off-reset', 'btn-loc-off-clear', 'chk-loc-front'];

const CHINA = 'ChinaStockGoods';
const SCANDB = CHINA + '_ScanDB';
const VERSIONS = CHINA + '_ScanDB_Versions';
const INBOUND = CHINA + '_InboundHistory';
const INBOUND_DIFF = CHINA + '_InboundDiff';
const SETTINGS_PATH = 'artifacts/team-work-logger-v2/mibal2/settings';
const MAX_VERSIONS = 30;           // 기존 화면 MAX_SCANDB_VERSIONS 와 같다
const OPS = 450;                   // 한 batch 쓰기 수(한도 500 안)
const INBOUND_PAGE = 10000;        // 입고이력 한 쿼리 limit — 웹 SDK(Listen) 쿼리 limit 의 운영 서버 상한(넘으면 invalid-argument, 에뮬레이터는 검사하지 않는다)
const INBOUND_TOTAL_MAX = 100000;  // 입고이력 전체 상한 — 넘으면 마감·반영·되돌리기를 멈춘다(아무것도 바꾸지 않음)
const INBOUND_DIFF_DENIED = '입고 오차 기록 권한이 없습니다(서버 규칙 게시 전이거나 등록 직원이 아닙니다).';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const mdhm = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${hhmm(ms)}`; };
const fmtMD = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : String(s || ''); };
const n = (v) => Number(v || 0).toLocaleString();
const tsMs = (v) => (!v ? 0 : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : (new Date(v).getTime() || 0));
const isPermissionDenied = (e) => !!e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));
const sameList = (a, b) => JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());

/**
 * @param {object} ctx  js/china-mibal2.js loadLiveTools 가 넘기는 것(db·화면 상태 getter·다시 그리기)
 * @returns {{ locOptions, attachLoc, onLatest, onDates }}
 */
export function startLive(ctx) {
    const { db, showToast, setLoading, errText } = ctx;
    let busy = false;
    let historyDone = false;
    const admin = setupLiveAdmin(ctx);
    const loc = setupLiveLoc(ctx);

    decorate();

    // ── 화면 바꾸기(시험 → 운영 문구·버튼) ──
    function decorate() {
        const banner = document.querySelector('.trial-banner');
        if (banner) {
            banner.textContent = '스캐너 숫자는 [스캐너에 반영]을 눌러야 바뀝니다 · 그날 입고 작업이 끝나면 [작업 마감]';
            banner.style.background = 'var(--c-accent-soft)'; banner.style.color = 'var(--c-accent-deep)'; banner.style.borderBottomColor = 'var(--c-line)';
        }
        const title = document.querySelector('.page-title');
        if (title) title.textContent = '중국제작 부족수량 관리';
        document.title = '중국제작 부족수량 관리(신규)';
        const badge = document.querySelector('.version-badge');
        if (badge) badge.textContent = '신규';
        ['btn-date-legacy', 'btn-date-legacy-out'].forEach(id => { const b = $(id); if (b) { b.hidden = true; b.style.display = 'none'; } });
        const st = document.querySelector('.scan-bar .scan-title');
        if (st) st.textContent = '스캐너 연동';
        const on = (id, text, title) => { const b = $(id); if (!b) return null; b.disabled = false; b.textContent = text; b.title = title; return b; };
        on('btn-scan-off-sync', '스캐너에 반영', '지금 표(선택 출고일)의 피킹 배정수량·도착을 스캐너 자료에 씁니다. 직전 값은 자동 백업됩니다')
            ?.classList.add('d-btn-primary');
        on('btn-scan-off-version', '직전으로 되돌리기', '마지막 [스캐너에 반영] 직전의 스캐너 자료로 되돌립니다');
        on('btn-scan-off-reset', '작업 마감', '보관함에 저장하고 입고이력·비축창고를 비웁니다(다음 작업 준비)');
        on('btn-scan-off-diffrec', '입고 오차 기록', '선택한 출고일의 도착 − 입고확인을 기록합니다');
        const lock = $('btn-scan-off-lock'); if (lock) lock.style.display = 'none';
        const bar = document.querySelector('.scan-bar');
        if (bar) {
            const note = [...bar.querySelectorAll('span.t-3')].pop();
            if (note) { note.id = 'live-batch-note'; note.textContent = ''; }
            const add = (id, text, title) => {
                const b = document.createElement('button');
                b.type = 'button'; b.id = id; b.className = 'd-btn d-btn-sm'; b.textContent = text; b.title = title;
                bar.insertBefore(b, note || null);
                return b;
            };
            add('btn-live-archive', '지난 작업 보기', '작업 마감 때 저장한 보관함을 봅니다');
            add('btn-live-barcode', '바코드 매핑 올리기', '상품코드·바코드 두 열이 있는 엑셀로 스캐너 바코드 매핑을 바꿉니다');
            add('btn-live-admin', '관리', '위치매핑 · 오류바코드 · 구역 적재량 · 본사도착 유예 · 빈 칸 넘침 규칙');
            add('btn-live-inbound-file', '입고용 파일 받기', '지금 표에 보이는 행의 상품코드·도착수량을 이지어드민 업로드용 파일(입고용파일.xls)로 받습니다');
            add('btn-live-mibal-file', '미발확인 파일 받기', '지금 표에 보이는 행의 상품코드를 이지어드민 업로드용 파일(미발확인파일.xls)로 받습니다');
            add('btn-live-floor2-file', '비축창고 엑셀 받기', '스캐너가 쌓은 비축창고 입고분의 상품코드·작업수량을 이지어드민 업로드용 파일(비축창고재고.xls)로 받습니다');
        }
        const diffChk = $('chk-diff-only'); if (diffChk) { diffChk.checked = false; diffChk.closest('label').style.display = 'none'; }
        ['sum-old', 'sum-diff'].forEach(id => { const c = $(id)?.closest('.summary-card'); if (c) c.style.display = 'none'; });
        const viewLoc = $('btn-view-loc'); if (viewLoc) viewLoc.textContent = '위치지정';
        const locDl = $('btn-loc-download'); if (locDl) locDl.textContent = '위치값 엑셀 받기';
        const f2Note = $('btn-f2-download')?.parentElement?.querySelector('span.t-3');
        if (f2Note) f2Note.textContent = '이 엑셀은 확인용입니다 — 이지어드민 업로드용은 [비축창고 엑셀 받기]';
        document.querySelectorAll('#inbound-diff-modal h3 span, #floor2-modal h3 span').forEach(sp => { sp.textContent = ''; });
        const pv = $('btn-scan-preview'); if (pv) pv.title = '스캐너에 반영하면 들어갈 값과 지금 스캐너 자료를 나란히 엑셀로 받습니다(쓰지 않음)';
        // 적재량 칸을 누르면 고친다(표의 행 펼치기와 겹치지 않게 그 칸만)
        $('table-body').addEventListener('click', (e) => {
            const td = e.target.closest('td.cap-cell'); if (!td) return;
            const tr = td.closest('tr.data-row'); if (!tr) return;
            e.stopPropagation();
            admin.editCapacity(tr.dataset.code);
        }, true);
        const style = document.createElement('style');
        // 기존 계산기 비교 열(23·24번째 — 기존 미발수량·차이)은 live 에 값이 없어 숨긴다
        style.textContent = '.list-table td.cap-cell { cursor: text; text-decoration: underline dotted var(--c-line-strong); }'
            + ' .list-table tr:not(.detail-row) > :is(:nth-child(23), :nth-child(24)) { display: none; }';
        document.head.appendChild(style);
        $('btn-scan-off-sync').addEventListener('click', () => guard(applyToScanner));
        $('btn-scan-off-version').addEventListener('click', () => guard(rollbackLast));
        $('btn-scan-off-reset').addEventListener('click', () => guard(closeWork));
        $('btn-scan-off-diffrec').addEventListener('click', () => guard(recordDiffManual));
        $('btn-live-archive').addEventListener('click', () => openArchive());
        $('btn-live-admin').addEventListener('click', () => admin.open());
        // 입고용·미발확인은 다시 읽기(설정·출고일)를 하므로 다른 작업과 겹치지 않게 guard 안에서(비축창고 받기는 출고일과 무관 — 그대로)
        $('btn-live-inbound-file').addEventListener('click', () => guard(() => download(downloadInboundFile), false));
        $('btn-live-mibal-file').addEventListener('click', () => guard(() => download(downloadMibalFile), false));
        $('btn-live-floor2-file').addEventListener('click', () => download(downloadFloor2File));
        const file = document.createElement('input');
        file.type = 'file'; file.accept = '.xls,.xlsx,.csv,.html,.htm'; file.style.display = 'none'; file.id = 'live-barcode-file';
        document.body.appendChild(file);
        $('btn-live-barcode').addEventListener('click', () => file.click());
        file.addEventListener('change', (e) => guard(() => uploadBarcodeMap(e)));
        renderBatchNote();
    }

    // write = 쓰는 작업(비상 전환 중이면 시작하지 않음). 시작한 작업은 gate 에 등록돼 도중에 전환돼도 끝까지 한다
    async function guard(fn, write = true) {
        if (busy) { showToast('⏳ 다른 작업을 처리하는 중입니다'); return; }
        if (write && isFrozen()) { showToast(FROZEN_MSG); return; }
        busy = true;
        try { await (write ? gateRun(fn) : fn()); }   // 쓰지 않는 작업(받기)은 gate 에 등록하지 않는다
        catch (e) { setLoading(false); console.error('[mibal2-live]', e); alert('처리하지 못했습니다 — ' + errText(e)); }
        finally { busy = false; setLoading(false); }
    }

    /** 출고일 불일치 — 절반 넘게 다른 출고일 스캔이면 막는다(직원). 관리자는 '그래도 진행' 2차 확인. true = 계속 */
    function mismatchPass(mm, jobShips) {
        if (!mm.block) return true;
        const admin = !!(ctx.isAdmin && ctx.isAdmin());
        const text = mismatchBlockText(mm, { jobShips, admin });
        if (!admin) { alert(text); return false; }
        return confirm(text);
    }
    /** 확인창이 떠 있는 동안 비상 전환됐으면 쓰지 않고 멈춘다(true = 멈춤) */
    function frozenNow() {
        if (!isFrozen()) return false;
        alert('확인하는 동안 비상 전환(기존 화면 작업)으로 바뀌었습니다 — 아무것도 쓰지 않았습니다.');
        return true;
    }
    function batchOf() { const s = ctx.getSettings(); return (s && s.batch && Array.isArray(s.batch.ships)) ? s.batch : null; }
    /** 이미 마감된 작업인데 작업 표시가 남은 것(마감 끝 설정 저장 실패 등)인가 — 그러면 새 작업으로 시작해야 한다 */
    async function batchAlreadyClosed(b) {
        if (!b || !b.id) return false;
        const s = ctx.getSettings() || {};
        if (s.lastClosedId === b.id) return true;
        const a = await getDoc(doc(db, ARCHIVE_COLL, String(b.id)));
        return a.exists() && (Number(a.data().closedAtMs) || 0) >= (Number(b.appliedAt) || 0);
    }
    /** 설정(작업 표시) 저장 — 실패하면 화면에 분명히 알린다 */
    async function saveBatchSetting(patch, what) {
        try {
            await setDoc(doc(db, SETTINGS_PATH), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
            return true;
        } catch (e) {
            alert(`⚠️ ${what}은(는) 끝났지만 작업 표시(설정)를 저장하지 못했습니다 — ${errText(e)}\n`
                + '화면의 작업 표시가 실제와 다를 수 있습니다. 새로고침한 뒤 작업 표시를 확인하세요.');
            return false;
        }
    }
    // sig = 상품별 합 서명 — 입고확인 수정(fix__ 문서)은 문서 수·id·timestamp 가 그대로라 합으로 본다(2026-11-04)
    const sameInbound = (a, b) => a.docs.length === b.docs.length && a.lastMs === b.lastMs && a.sig === b.sig
        && a.docs.every((d, i) => d.id === b.docs[i].id);
    function renderBatchNote() {
        const el = $('live-batch-note'); if (!el) return;
        const b = batchOf();
        if (!b) { el.className = 't-3'; el.textContent = '· 진행 중인 작업 없음 — [스캐너에 반영]을 누르면 작업이 시작됩니다'; return; }
        const differ = !sameList(b.ships, ctx.getSelectedDates());
        el.className = differ ? 't-warn' : 't-3';
        el.textContent = `· 작업 중: 출고일 ${b.ships.map(fmtMD).join(', ')}${b.appliedAt ? ` · ${mdhm(b.appliedAt)} 반영` : ''}`
            + (differ ? ' — ⚠ 지금 고른 출고일과 다릅니다(반영하면 바뀜)' : '');
    }

    /** 다른 PC 값을 서버에서 다시 읽는다 — 못 읽으면 옛 값으로 진행하지 않고 null */
    async function reloadOrStop(what) {
        setLoading(true, '설정·적재량·작업 표시 다시 읽는 중...');
        try {
            const r = await ctx.reloadShared();
            if (r.popupOpen) {
                alert(`출고일 창이 열려 있어 ${what}을(를) 멈췄습니다(아무것도 바꾸지 않음).\n창이 닫히면서 고른 출고일이 저장됩니다 — 화면을 확인한 뒤 다시 누르세요.`);
                return null;
            }
            renderBatchNote();
            return r;
        } catch (e) {
            console.error('[mibal2-live] 다시 읽기 실패:', e && e.code);
            alert(`설정·적재량·작업 표시를 서버에서 읽지 못해 ${what}을(를) 멈췄습니다(아무것도 바꾸지 않음) — ${errText(e)}`);
            return null;
        } finally { setLoading(false); }
    }
    // 확인창 뒤 재확인 — 다른 PC 가 설정·적재량·작업 표시를 바꿨으면 계산이 낡았다
    const SHARED_CHANGED = '확인하는 동안 다른 PC 에서 설정·적재량·작업 표시가 바뀌었습니다 — 아무것도 쓰지 않았습니다.\n화면을 확인한 뒤 다시 누르세요.';
    const scanDbSig = (list) => stableSig(list.map(d => [d.id, d.data]));
    const DATES_CHANGED = '다른 PC 에서 출고일을 바꿔 이 화면의 출고일을 맞췄습니다.\n화면을 확인한 뒤 다시 누르세요(아무것도 바꾸지 않았습니다).';

    // ── 스캐너 자료 읽기(그때마다 서버에서) ──
    async function readInbound() {
        // 서버에서 따로 읽는다 — 화면의 입고이력 구독과 같은 쿼리면 SDK 가 구독 상태를 돌려줘 방금 들어온 스캔을 놓칠 수 있어
        //   모양이 다른 쿼리(문서 id 정렬 + limit)로 새로 읽는다(확인창 사이 새 스캔 확인용)
        // 한 쿼리는 INBOUND_PAGE 건까지(운영 상한) — 넘으면 마지막 문서 다음부터 이어 읽는다. id 순이라 두 번 읽은 결과를 sameInbound 로 비교할 수 있다.
        //   합이 INBOUND_TOTAL_MAX 를 넘으면 멈춘다 — 잘린 채 진행하면 일부만 보관·삭제된다
        const docs = await readAllPages(async (after) => (await getDocsFromServer(query(collection(db, INBOUND), orderBy(documentId()),
            ...(after ? [startAfter(after)] : []), limit(INBOUND_PAGE)))).docs,
            INBOUND_PAGE, INBOUND_TOTAL_MAX, '입고이력이 너무 많아 전부 읽지 못했습니다(아무것도 바꾸지 않음).');
        let last = 0;
        const list = docs.map(d => { const x = d.data() || {}; last = Math.max(last, tsMs(x.timestamp)); return { barcode: x.barcode, qty: x.qty }; });
        const map = inboundMapOf(list);
        return { map, docs, lastMs: last, sig: inboundSig(map) };
    }
    async function readScanDb() {
        const snap = await getDocsFromServer(collection(db, SCANDB));
        return snap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() || {} }));
    }
    function recentScanOk(lastMs, what) {
        if (!lastMs) return true;
        const min = Math.floor((Date.now() - lastMs) / 60000);
        if (min >= RECENT_SCAN_MIN) return true;
        return confirm(`⚠️ ${min}분 전에 스캐너 입고가 있었습니다 — 지금 스캔·전송 중일 수 있습니다.\n`
            + `${what} 동안 전송된 입고는 숫자가 어긋날 수 있습니다. 스캐너 전송이 끝났는지 확인하세요.\n\n그래도 계속할까요?`);
    }
    async function commitOps(ops) {
        for (let i = 0; i < ops.length; i += OPS) {
            const b = writeBatch(db);
            ops.slice(i, i + OPS).forEach(op => op(b));
            await b.commit();
        }
    }
    // extra.batch — 'pre-apply' 에 그때의 작업 표시(settings.batch, 없으면 null)를 같이 남겨 되돌릴 때 함께 복원한다.
    //   'pre-apply' 는 스캐너 자료가 비어 있어도 남긴다(되돌리면 빈 상태 + 작업 표시가 돌아가야 하므로)
    async function saveVersion(docs, trigger, note, extra) {
        if (!docs.length && trigger !== 'pre-apply') return false;
        const v = versionDataOf(docs);
        const at = Date.now();
        await setDoc(doc(db, VERSIONS, 'v' + at), { at: new Date(at), atMs: at, trigger, note, count: v.count, totalMibal: v.totalMibal, data: v.data, ...(extra || {}) });
        await pruneVersions();
        return true;
    }
    // 기존 화면 pruneScanDBVersions 와 같다 — 오늘 아닌 버전 삭제, 같은 날 MAX_VERSIONS 넘으면 오래된 것부터
    async function pruneVersions() {
        try {
            const snap = await getDocs(collection(db, VERSIONS));
            const today = isoDay();
            const keep = [], stale = [];
            snap.docs.forEach(d => (isoDay(new Date(d.data().atMs || 0)) === today ? keep : stale).push(d));
            const ops = stale.map(d => (b) => b.delete(d.ref));
            if (keep.length > MAX_VERSIONS) {
                keep.sort((a, b) => (a.data().atMs || 0) - (b.data().atMs || 0)).slice(0, keep.length - MAX_VERSIONS).forEach(d => ops.push((b) => b.delete(d.ref)));
            }
            await commitOps(ops);
        } catch (e) { console.warn('[mibal2-live] 버전 정리 실패:', e && e.code); }
    }

    // ── [스캐너에 반영] ──
    async function applyToScanner() {
        const fresh = await reloadOrStop('스캐너 반영');
        if (!fresh) return;
        if (fresh.datesChanged) { alert(DATES_CHANGED); return; }
        const dates = ctx.getSelectedDates();
        if (!dates.length) { alert('출고일을 하나 이상 고르세요.'); return; }
        const latest = ctx.getLatest();
        const okMs = latest ? tsMs(latest.lastOkAt) : 0;
        if (!okMs) { alert('수집 자료가 없어 반영할 수 없습니다. [지금 갱신]을 기다리세요.'); return; }
        if (isoDay(new Date(okMs)) !== isoDay() && !confirm(`⚠️ 수집 자료가 오늘 것이 아닙니다(${mdhm(okMs)}).\n재고·주문이 지금과 다를 수 있습니다. 그래도 반영할까요?`)) return;
        setLoading(true, '스캐너 자료·입고이력 읽는 중...');
        const [ih, cur] = await Promise.all([readInbound(), readScanDb()]);
        let b = batchOf();
        if (b && await batchAlreadyClosed(b)) b = null;   // 마감된 작업 표시가 남아 있었다 → 새 작업
        setLoading(false);
        if (!recentScanOk(ih.lastMs, '반영하는')) return;
        const rows = ctx.rowsFor(dates, ih.map);
        // 스캔이 다른 출고일 패킹 것이면(입고이력에는 패킹 표시가 없다) — 절반 넘게 없으면 막고, 아니면 확인창 맨 위에 경고(반영하는 출고일 기준)
        const mm = shipMismatchOf({ scanMap: ih.map, shipItems: ctx.getShipItems(), ships: dates });
        if (!mismatchPass(mm)) return;
        const plan = scanApplyPlan(rows, ih.map, cur.map(d => d.id));
        if (!plan.totals.codes) { alert('선택한 출고일에 도착이 있는 상품이 없습니다 — 반영하지 않았습니다.'); return; }
        const scanCodes = Object.keys(ih.map).filter(c => ih.map[c]);
        const lines = [
            mm.warn ? mismatchLine(mm.outside, mm.best, mm.bestInShips) : '',
            mm.warn ? '-' : '',
            scanCodes.length ? `⚠⚠ 앱 스캔 입고 ${n(scanCodes.length)}개 상품이 남아 있습니다 — 이전 작업 스캔이 남아 있으면 취소하고 먼저 [작업 마감]을 하세요` : '',
            scanCodes.length ? '-' : '',
            `스캐너에 반영할까요? (출고일 ${dates.map(fmtMD).join(', ')})`, '-',
            '이지어드민 입고 등록 전에 반영하세요. 등록한 뒤 다시 반영하면 입고분이 두 번 빠집니다.', '-',
            `· 상품 ${n(plan.totals.codes)}개 · 남은 도착 합 ${n(plan.totals.arr)} · 피킹으로 보낼 수량 합 ${n(plan.totals.mibal)}`,
            `· 앱 스캔 입고 ${n(Object.keys(ih.map).length)}개 상품 ${n(Object.values(ih.map).reduce((s, v) => s + v, 0))}장은 빼고 씁니다`,
            plan.totals.del ? `· 지금 스캐너 자료에만 있는 상품 ${n(plan.totals.del)}개는 지웁니다` : '',
            plan.unknownMibal.length ? `· ⚠ 비축재고를 몰라 피킹 배정을 계산 못 한 상품 ${n(plan.unknownMibal.length)}개 — 남은 도착 전부를 피킹으로 보냅니다` : '',
            plan.noLocation.length ? `· ⚠ 로케이션관리에 없어 스캐너 위치가 빈칸이 되는 상품 ${n(plan.noLocation.length)}개` : '',
            b && !sameList(b.ships, dates) ? `· ⚠ 작업 중인 출고일(${b.ships.map(fmtMD).join(', ')})이 바뀝니다` : '',
            '-', '지금 스캐너 자료는 [직전으로 되돌리기]용으로 자동 백업합니다.'
        ].filter(x => x !== '').map(x => (x === '-' ? '' : x));   // '-' = 일부러 넣는 빈 줄
        // 이미 반영한 작업(서버에서 다시 읽은 작업 표시)을 또 누름 — 등록 뒤라면 입고분이 두 번 빠지므로 한 번 더 묻는다(막지는 않음)
        if (b && !confirm(`⚠⚠ 이 작업은 이미 스캐너에 반영했습니다(${b.appliedAt ? mdhm(b.appliedAt) : '시각 모름'} · 출고일 ${b.ships.map(fmtMD).join(', ')}).\n\n`
            + '이지어드민 입고 등록을 한 뒤 다시 반영하면 입고분이 두 번 빠집니다.\n등록 전이 확실할 때만 [확인]을 누르세요.')) return;
        if (!confirm(lines.join('\n'))) return;
        // 확인창이 떠 있는 동안 스캐너 입고가 들어왔으면 계산이 낡았다 — 쓰지 않고 다시 하게 한다
        setLoading(true, '입고이력 다시 확인 중...');
        const [ih2, cur2, sig2] = await Promise.all([readInbound(), readScanDb(), ctx.readSharedSig()]);
        setLoading(false);
        if (!sameInbound(ih, ih2) || scanDbSig(cur2) !== scanDbSig(cur)) {
            alert('확인하는 동안 스캐너 입고(또는 스캐너 자료 변경)가 있었습니다 — 반영하지 않았습니다.\n잠시 뒤 [스캐너에 반영]을 다시 누르세요(새 입고를 넣어 다시 계산합니다).');
            return;
        }
        if (sig2 !== fresh.sig) { alert(SHARED_CHANGED); return; }
        if (frozenNow()) return;
        setLoading(true, '스캐너 자료 백업 중...');
        await saveVersion(cur, 'pre-apply', '스캐너에 반영 직전 자동 백업', { batch: b || null });
        setLoading(true, `스캐너에 반영 중... (${n(plan.totals.codes)}개)`);
        const now = new Date();
        const ops = Object.keys(plan.sets).map(code => (bt) => bt.set(doc(db, SCANDB, code), { ...plan.sets[code], updatedAt: now }));
        plan.deletes.forEach(code => ops.push((bt) => bt.delete(doc(db, SCANDB, code))));
        await commitOps(ops);
        // appliedTs = 서버 시각(비상 스위치 '되돌린 뒤 반영했나' 판정은 서버 시각끼리 — js/lib/mibal2-fallback.js needReapply). appliedAt 은 표시·옛 판정용
        const batch = b ? { ...b, ships: dates, appliedAt: Date.now() } : { id: batchIdOf(now), ships: dates, startedAt: Date.now(), appliedAt: Date.now() };
        setLoading(false);
        if (await saveBatchSetting({ batch: { ...batch, appliedTs: serverTimestamp() } }, '스캐너 반영')) ctx.patchSettings({ batch });
        renderBatchNote();
        showToast(`✅ 스캐너에 반영 — 상품 ${n(plan.totals.codes)}개${plan.totals.del ? ` · 지움 ${n(plan.totals.del)}개` : ''}`);
    }

    // ── [직전으로 되돌리기] ──
    async function rollbackLast() {
        setLoading(true, '버전 기록 읽는 중...');
        const snap = await getDocs(query(collection(db, VERSIONS), orderBy('atMs', 'desc'), limit(MAX_VERSIONS)));
        setLoading(false);
        const v = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.trigger === 'pre-apply');
        if (!v || !v.data) { alert('되돌릴 기록이 없습니다(오늘 [스캐너에 반영] 전 백업이 없음).'); return; }
        // 비상 기간 전 백업이면 기존 화면이 그동안 쓴 스캐너 자료를 덮는다 — 한 번 더 묻는다
        if (staleRollback(v.atMs, ctx.getFallback && ctx.getFallback()) && !confirm(`⚠ 이 백업(${mdhm(v.atMs)})은 비상 전환(기존 화면 작업) 전 자료입니다.\n되돌리면 비상 기간 전 자료로 돌아갑니다 — 그동안 기존 화면이 반영한 값이 사라집니다.\n\n그래도 되돌릴까요?`)) return;
        const ih = await readInbound();
        if (!recentScanOk(ih.lastMs, '되돌리는')) return;
        if (!confirm(`마지막 [스캐너에 반영] 직전(${mdhm(v.atMs)})으로 스캐너 자료를 되돌릴까요?\n\n상품 ${n(v.count)}개 · 미발 합 ${n(v.totalMibal)}\n`
            + '그 뒤 스캐너 입고로 줄어든 숫자도 그때 값으로 돌아갑니다. 지금 자료는 자동 백업합니다.')) return;
        if (frozenNow()) return;
        setLoading(true, '되돌리는 중...');
        const cur = await readScanDb();
        await saveVersion(cur, 'pre-rollback', '되돌리기 직전 자동 백업');
        const data = v.data || {};
        const keep = new Set(Object.keys(data));
        const now = new Date();
        const ops = Object.keys(data).map(code => (b) => b.set(doc(db, SCANDB, code), { code, ...data[code], updatedAt: now }));
        cur.forEach(d => { if (!keep.has(d.id)) ops.push((b) => b.delete(d.ref)); });
        await commitOps(ops);
        setLoading(false);
        // 그때의 작업 표시도 함께 되돌린다(반영으로 시작·바뀐 작업 출고일) — 'batch' 칸이 없는 옛 버전이면 그대로 둠
        if ('batch' in v) {
            const bb = v.batch && Array.isArray(v.batch.ships) ? v.batch : null;
            // 마감이 출고일 선택을 풀었으면 작업과 함께 되돌린다 — 안 그러면 작업은 살아났는데 표가 비어 입고 대조를 못 한다
            const restoreDates = bb && !ctx.getSelectedDates().length ? bb.ships.map(String) : null;
            // merge 쓰기는 batch 안 칸도 합친다 — 복원본에 없는 칸(appliedTs 등)이 지금 값으로 남지 않게 지운다
            const curBatch = (ctx.getSettings() || {}).batch || {};
            const batchOut = bb ? { ...Object.fromEntries(Object.keys(curBatch).filter(k => !(k in bb)).map(k => [k, deleteField()])), ...bb } : deleteField();
            if (await saveBatchSetting({ batch: batchOut, ...(restoreDates ? { shipDates: restoreDates } : {}) }, '되돌리기')) {
                ctx.patchSettings({ batch: bb || undefined, ...(restoreDates ? { shipDates: restoreDates } : {}) });
                if (restoreDates) ctx.setSelectedDates(restoreDates);
            }
            renderBatchNote();
        }
        showToast(`✅ 되돌리기 완료 (${mdhm(v.atMs)} · 미발 ${n(v.totalMibal)})`);
    }

    // ── 입고 오차 기록(공통) — 기존 writeInboundDiff 와 같다. 실패는 throw → { ok, rev, shrunk } ──
    async function writeInboundDiff(rec) {
        const ref = doc(db, INBOUND_DIFF, rec.shipKey);
        const snap = await getDoc(ref);
        const old = snap.exists() ? snap.data() : null;
        const { rec: merged, confDropped } = mergeRev(old, rec);
        if (confDropped && !confirm(`이미 저장된 입고 오차 기록(${rec.ships.map(fmtMD).join(', ')})보다 입고합이 줄었습니다 `
            + `(${n(parseInt(old.totals.conf) || 0)} → ${n(rec.totals.conf)}).\n\n덮어쓸까요? [취소]를 누르면 이번 기록은 저장하지 않습니다.`)) return { ok: false };
        const fit = shrinkIfLarge(merged);
        if (!fit.ok) throw new Error(`기록이 너무 큽니다(${Math.round(fit.size / 1024)}KB).`);
        await setDoc(ref, fit.rec);
        return { ok: true, rev: merged.rev, shrunk: fit.shrunk };
    }
    const arrivalByShip = () => { const m = {}; ctx.getShipList().forEach(x => { m[x.date] = x.arrivals || []; }); return m; };
    function diffRecordFor(ships, rows, trigger) {
        return buildDiffRecord({ rows: diffRowsOf(rows), dates: ships, arrivalByShip: arrivalByShip(), supplierOf: () => '',
            by: ctx.memberName(), now: new Date(), trigger });
    }

    // ── [입고 오차 기록] (수동) ──
    async function recordDiffManual() {
        const dates = ctx.getSelectedDates();
        if (!dates.length) { alert('출고일을 하나 이상 선택하세요.'); return; }
        let rec;
        try { rec = diffRecordFor(dates, ctx.getRows(), 'manual'); } catch (e) { alert('입고 오차를 기록할 수 없습니다 — ' + e.message); return; }
        if (!rec.rows.length) { alert('기록할 상품이 없습니다(선택한 출고일에 도착수량이 있는 상품이 없습니다).'); return; }
        if (!shouldAutoSave(rec)) { alert('선택한 출고일에 앱 스캔 입고가 없어 기록하지 않습니다.\n(스캔 전이거나 작업 마감 뒤일 수 있습니다 — 스캔 입고가 있는 상태에서 기록하세요)'); return; }
        let over = [];
        try {
            const { start, end } = queryRange(rec.ships[0], rec.ships[rec.ships.length - 1]);
            const cons = [];
            if (start) cons.push(where(documentId(), '>=', start));
            if (end) cons.push(where(documentId(), '<=', end));
            const s = await getDocs(query(collection(db, INBOUND_DIFF), ...cons));
            over = overlapping(s.docs.map(d => d.data()), rec);
        } catch (e) { if (isPermissionDenied(e)) { alert(INBOUND_DIFF_DENIED); return; } console.warn('입고 오차 겹침 확인 실패:', e && (e.code || e.message)); }
        if (over.length && !confirm('출고일이 겹치는 다른 입고 오차 기록이 있습니다.\n\n'
            + over.map(o => `· ${o.ships.map(fmtMD).join('+')} 기록 (겹침 ${o.common.map(fmtMD).join(', ')} · ${o.hasScan ? '스캔 있음' : '스캔 없음'} · ${mdhm(o.savedAtMs)} 저장)`).join('\n')
            + '\n\n이번 기록을 저장하면 통계에서 겹치는 출고일은 이번 기록으로 대체됩니다(위 기록은 지워지지 않고 통계에서 빠집니다).\n계속할까요?')) return;
        const t = rec.totals;
        if (!confirm(`선택한 출고일(${rec.ships.map(fmtMD).join(', ')})의 입고 오차를 기록할까요?\n\n`
            + `${n(t.n)}품목 · 도착 ${n(t.arr)} · 입고 ${n(t.conf)}\n${diffSummaryText(rec)}\n\n`
            + (rec.ships.length > 1 ? '여러 출고일을 함께 골랐으므로 묶음 1건으로 저장합니다.\n' : '')
            + '같은 출고일 기록이 있으면 덮어씁니다.')) return;
        if (frozenNow()) return;
        setLoading(true, '입고 오차 기록 중...');
        try {
            const r = await writeInboundDiff(rec);
            setLoading(false);
            if (r.ok) showToast(`📝 입고 오차 기록 저장${r.rev > 1 ? ` (${r.rev}번째 저장 — 덮어씀)` : ''}${r.shrunk ? ' · 상품명 빼고 저장(크기)' : ''}`);
        } catch (e) {
            setLoading(false);
            alert(isPermissionDenied(e) ? INBOUND_DIFF_DENIED : '입고 오차 기록 실패 — ' + errText(e));
        }
    }

    // ── [작업 마감] ──
    // 계산은 본사도착 유예를 보지 않는다(작업 출고일 도착분 전부). 확인창 뒤·비축 비우기 직전에 다시 읽어 새 스캔이 있으면 멈춘다.
    async function closeWork() {
        const fresh = await reloadOrStop('작업 마감');
        if (!fresh) return;
        const b = batchOf();
        // 비상 기간(기존 화면 작업) 뒤 아직 [스캐너에 반영]을 안 한 작업 — 스캐너 자료가 이 작업과 다르다
        if (needReapply(b, ctx.getFallback && ctx.getFallback())) {
            alert('비상 전환에서 돌아온 뒤 아직 [스캐너에 반영]을 하지 않았습니다 — 마감하지 않았습니다.\n먼저 출고일을 확인하고 [스캐너에 반영]을 누른 뒤 [작업 마감]을 하세요.');
            return;
        }
        if (fresh.datesChanged && !b) { alert(DATES_CHANGED); return; }   // 작업 표시가 있으면 작업 출고일로 마감하므로 선택이 달라도 된다
        const ships = b ? b.ships.map(String) : ctx.getSelectedDates();
        if (!ships.length) { alert('마감할 작업이 없습니다(출고일 없음).'); return; }
        setLoading(true, '입고이력·비축창고 읽는 중...');
        const readF2 = async () => { const sn = await getDocFromServer(doc(db, CHINA, 'FLOOR2_STOCK')); return floor2MapOf(sn.exists() ? sn.data() : null).map; };
        const [ih, f2] = await Promise.all([readInbound(), readF2()]);
        const now = new Date();
        // 보관 번호 — 작업 번호. 같은 번호의 보관이 이미 있으면 새 번호(이전 보관은 그대로 보존 — 마감된 작업 표시가 남은 경우,
        //   되돌리기로 작업 표시가 돌아온 경우 등).
        // 부분 마감 뒤(이 화면이 지난번 마감을 비축 비우기 직전에 멈췄다고 표시한 settings.closePartial = 첫 보관 번호, closePartialF2 = 그때까지 보관한 비축):
        //   늘 새 번호로 '추가분'만 보관한다(그 뒤 앱 스캔·늘어난 비축, partialOf 표시). 입고 오차는 다시 쓰지 않는다(지난번 기록 그대로).
        //   추가분이 없으면 보관은 건너뛰고 비우기만 마저 한다.
        const st0 = ctx.getSettings() || {};
        const partialOf = (st0.closePartial && st0.lastClosedId !== st0.closePartial) ? String(st0.closePartial) : '';
        let baseF2 = {};
        if (partialOf) { try { baseF2 = JSON.parse(st0.closePartialF2 || '{}') || {}; } catch (e) { baseF2 = {}; } }
        let id = (!partialOf && b && b.id && /^[0-9]{8}-[0-9]{6}$/.test(b.id)) ? String(b.id) : batchIdOf(now);
        if ((await getDoc(doc(db, ARCHIVE_COLL, id))).exists()) {
            id = batchIdOf(now);
            if ((await getDoc(doc(db, ARCHIVE_COLL, id))).exists()) { setLoading(false); alert('보관 번호가 겹칩니다 — 잠시 뒤 다시 누르세요.'); return; }
        }
        setLoading(false);
        if (!recentScanOk(ih.lastMs, '마감하는')) return;
        const rows = ctx.rowsFor(ships, ih.map, { allGrace: true });
        // 스캔이 작업(또는 고른) 출고일 패킹 것인가 — 절반 넘게 없으면 막는다(엉뚱한 출고일 이름으로 보관되지 않게). 보관은 지금처럼 모든 스캔
        const mm = shipMismatchOf({ scanMap: ih.map, shipItems: ctx.getShipItems(), ships });
        if (!mismatchPass(mm, b ? ships : null)) return;   // 작업 표시가 있으면 작업 출고일 기준 — 출고일을 바꾸고 다시 반영해야 풀린다
        const full = archiveRecordOf({ id, ships, startedAtMs: b ? b.startedAt : 0, closedAt: now, by: ctx.memberName(),
            rows, inboundMap: ih.map, floor2Map: f2 });
        const arch = shrinkArchive(partialOf ? partialRecordOf(full, partialOf, baseF2) : full);
        if (!arch.ok) { alert('보관 자료가 너무 커서 마감하지 못했습니다. 관리자에게 알려 주세요.'); return; }
        const skipArch = !!partialOf && !arch.rec.rows.length;   // 부분 마감 뒤 추가분 없음 — 보관 안 함, 비우기만
        // 스캔 내역 — 아래에서 지우는 것과 같은 문서(ih.docs)로 만든다. 못 만들거나 너무 크면 아무것도 하지 않고 멈춘다
        let scanLogParts = [];
        if (!skipArch && ih.docs.length) {
            try { scanLogParts = buildScanLogDocs(ih.docs.map(scanLogInputOf), { id, partialOf: partialOf || undefined, closedAtMs: now.getTime(), by: ctx.memberName() }); }
            catch (e) { console.error('[mibal2-live] 스캔 내역 만들기 실패:', e && e.message); alert('스캔 내역을 만들지 못해 마감하지 않았습니다(아무것도 바뀌지 않음). 관리자에게 알려 주세요.'); return; }
            if (scanLogParts.length > SCANLOG_MAX_PARTS) { alert('스캔 내역이 너무 커서 마감하지 않았습니다(아무것도 바뀌지 않음). 관리자에게 알려 주세요.'); return; }
        }
        const scanLogN = scanLogParts.reduce((s, p) => s + p.n, 0);
        let diffRec = null, diffLine;
        try { diffRec = diffRecordFor(ships, rows, 'close'); } catch (e) { diffRec = null; }
        if (partialOf) { diffRec = null; diffLine = `입고 오차 기록: 지난번 마감(${partialOf}) 때 기록함(다시 쓰지 않음)`; }   // 줄어든 값으로 덮지 않게
        else if (!diffRec) diffLine = '입고 오차 기록: 출고일 형식이 맞지 않아 저장하지 않습니다.';
        else if (!shouldAutoSave(diffRec)) { diffLine = '입고 오차 기록: 앱 스캔 입고가 없어 저장하지 않습니다.'; diffRec = null; }
        else diffLine = `입고 오차 기록(출고일 ${diffRec.ships.map(fmtMD).join(', ')}): ${diffSummaryText(diffRec)}`;
        const t = arch.rec.totals;
        const differ = b && !sameList(b.ships, ctx.getSelectedDates());
        if (!confirm((mm.warn ? mismatchLine(mm.outside, mm.best, mm.bestInShips) + ' — 그 상품도 이 작업으로 보관됩니다\n\n' : '')
            + `작업을 마감할까요? (출고일 ${ships.map(fmtMD).join(', ')}${b ? ` · 작업번호 ${id}` : ' · 반영 기록 없음 — 지금 고른 출고일로'})\n\n`
            + (skipArch ? `보관함: 지난번 마감(${partialOf}) 뒤 추가분 없음 — 새로 보관하지 않음\n${diffLine}\n\n`
                : `보관함에 저장${partialOf ? `(지난번 마감 ${partialOf} 뒤 추가분)` : ''}: 상품 ${n(t.codes)}개 · 도착 ${n(t.arr)} · 입고 ${n(t.conf)} · 비축 ${n(t.floor2)} · 스캔 내역 ${n(scanLogN)}건\n${diffLine}\n\n`)
            + `비우는 것: 앱 입고이력 ${n(ih.docs.length)}건 · 비축창고 누적 ${n(Object.keys(f2).length)}개 상품 · 스캐너 강제전송 허용목록\n`
            + '유지되는 것: 스캐너 자료(다음 [스캐너에 반영] 때 바뀜) · 위치 데이터 · 적재량 개별값'
            + (differ ? '\n\n⚠ 지금 고른 출고일이 작업 출고일과 다릅니다 — 작업 출고일로 마감합니다.' : '')
            + (ctx.pendingFixCount && ctx.pendingFixCount() ? `\n\n⚠ 저장 안 한 입고확인 ${n(ctx.pendingFixCount())}건도 버립니다.` : ''))) return;
        // 확인창이 떠 있는 동안 스캔이 들어왔으면 보관할 자료가 낡았다 — 아무것도 쓰지 않고 멈춘다
        setLoading(true, '입고이력·비축창고 다시 확인 중...');
        const [ih2, f2b, sig2] = await Promise.all([readInbound(), readF2(), ctx.readSharedSig()]);
        setLoading(false);
        if (!sameInbound(ih, ih2) || JSON.stringify(f2) !== JSON.stringify(f2b)) {
            alert('확인하는 동안 스캐너 입고가 있었습니다 — 마감하지 않았습니다(아무것도 바뀌지 않음).\n스캐너 전송이 끝난 뒤 [작업 마감]을 다시 누르세요.');
            return;
        }
        if (sig2 !== fresh.sig) { alert(SHARED_CHANGED); return; }
        if (frozenNow()) return;
        setLoading(true, '보관함에 저장 중...');
        const notes = [];
        if (!skipArch) {
            // 보관함과 스캔 내역은 함께 저장된다 — 실패하면 어느 쪽도 남지 않고, 아래 삭제 단계로 가지 않는다(자동 재시도 없음)
            try {
                const wb = writeBatch(db);
                wb.set(doc(db, ARCHIVE_COLL, id), arch.rec);
                scanLogParts.forEach(p => wb.set(doc(db, ...SCANLOG_JOBS_COLL, docIdOf(p.id, p.part)), p));
                await wb.commit();
            } catch (e) {
                console.error('[mibal2-live] 보관 저장 실패:', e && e.code);
                setLoading(false);
                alert(`보관함 저장 실패 — 입고이력·비축은 그대로입니다. [작업 마감]을 다시 누르세요.\n(${errText(e)})`);
                return;
            }
        } else notes.push('추가분이 없어 새로 보관하지 않음');
        if (partialOf && !skipArch) notes.push(`지난번 마감(${partialOf}) 뒤 추가분 보관`);
        let diffDone = partialOf ? '지난번 마감 때 기록함' : '';
        if (diffRec) {
            try { const r = await writeInboundDiff(diffRec); notes.push(r.ok ? '입고 오차 기록됨' : '입고 오차 기록 안 함'); diffDone = r.ok ? '기록함' : '기록 안 함'; }
            catch (e) { console.error('입고 오차 기록 실패:', e && (e.code || e.message)); notes.push('⚠️ 입고 오차 기록 실패'); diffDone = '기록 실패'; }
        } else if (!partialOf) diffDone = '기록할 스캔 없음';
        try {
            // 입고 미발(v2). 화면을 연 때 같은 키(출고일|오늘)로 이미 기록했으면 덮지 않는다
            const today = isoDay(now);
            const tot = mibalTotalsOf(ctx.computeFor(ships, { allGrace: true }));
            const arrs = rows.flatMap(r => (r.arrUsed || []).map(e => String(e[1] || ''))).filter(x => x.length >= 10).sort();
            const recs = historyRecordsOf([{ ships, 입고일: arrs[0] || today }], () => tot, today);
            const hs = await getDoc(doc(db, CHINA, 'MIBAL_HISTORY'));
            const have = (hs.exists() && hs.data().map) ? hs.data().map : {};
            const add = {};
            Object.keys(recs).forEach(k => { if (!have[k]) add[k] = recs[k]; });
            if (Object.keys(add).length) { await setDoc(doc(db, CHINA, 'MIBAL_HISTORY'), { map: add, updatedAt: new Date() }, { merge: true }); notes.push('입고 미발 기록됨'); }
            else notes.push('입고 미발은 오늘 이미 기록돼 있음');
        } catch (e) { console.error('미발 기록 실패:', e && e.code); notes.push('⚠️ 입고 미발 기록 실패'); }
        setLoading(true, '입고이력 비우는 중...');
        await commitOps(ih.docs.map(d => (bt) => bt.delete(d.ref)));   // 읽은 문서만 지운다(그 뒤 들어온 스캔은 남음)
        if (ctx.clearPendingFix) ctx.clearPendingFix();   // 입고확인 저장 대기도 버린다(2026-11-04)
        // 비축창고·허용목록은 통째로 비우므로, 그 직전에 새 스캔이 없는지 한 번 더 본다
        // 다음 마감이 '같은 작업 이어 하기'인지 알 수 있게 표시해 둔다(새 스캔이 있으면 그때는 새 번호로 보관)
        //   closePartialF2 = 지금까지 보관에 남긴 비축(이번 f2) — 다음 마감은 이것보다 늘어난 몫만 보관한다
        const mark = { closePartial: partialOf || id, closePartialF2: JSON.stringify(f2) };
        const saveMark = async () => { const ok = await saveBatchSetting(mark, '마감(일부)'); if (ok) ctx.patchSettings(mark); return ok; };
        let ih3, f2c;
        try { [ih3, f2c] = await Promise.all([readInbound(), readF2()]); }
        catch (e) {
            // 이미 보관·입고이력 삭제까지 했다 — 일반 오류창으로 빠지면 다시 눌렀을 때 보관이 겹치므로 '새 스캔' 멈춤과 같은 표시를 남긴다
            console.error('[mibal2-live] 비우기 직전 다시 읽기 실패:', e && (e.code || e.message));
            setLoading(false);
            const marked = await saveMark();
            alert(`비우기 직전에 입고이력·비축창고를 다시 읽지 못해 비축창고·강제전송 허용목록 비우기를 멈췄습니다 — ${errText(e)}\n`
                + `끝난 것: 보관(${skipArch ? '추가분 없어 안 함' : id}) · 입고 오차(${diffDone}) · 이전 입고이력 ${n(ih.docs.length)}건 삭제\n`
                + '남은 것: 비축창고·허용목록 비우기 · 작업 표시 지우기\n'
                + (marked
                    ? '네트워크를 확인한 뒤 [작업 마감]을 다시 누르세요 — 보관은 겹치지 않습니다(그사이 새 스캔이 없으면 추가분 없이 비우기만 합니다).'
                    : '⚠️ 진행 표시도 저장하지 못했습니다 — [작업 마감]을 다시 누르지 말고 관리자에게 알려 주세요(다시 누르면 보관·입고 오차가 겹칠 수 있음).'));
            return;
        }
        if (ih3.docs.length || JSON.stringify(f2) !== JSON.stringify(f2c)) {
            setLoading(false);
            const marked = await saveMark();
            alert('마감 도중 새 스캔이 들어와 비축창고·강제전송 허용목록 비우기를 멈췄습니다.\n'
                + `끝난 것: 보관(${skipArch ? '추가분 없어 안 함' : id}) · 입고 오차(${diffDone}) · 이전 입고이력 ${n(ih.docs.length)}건 삭제\n`
                + `남은 것: 새 스캔 ${n(ih3.docs.length)}건(그대로 있음) · 비축창고·허용목록 비우기 · 작업 표시 지우기\n`
                + (marked
                    ? '스캐너 전송이 끝난 뒤 [작업 마감]을 다시 누르세요 — 새 스캔·늘어난 비축은 새 번호로(추가분) 보관됩니다.'
                    : '⚠️ 진행 표시를 저장하지 못했습니다 — [작업 마감]을 다시 누르지 말고 관리자에게 알려 주세요(다시 누르면 보관·입고 오차가 겹칠 수 있음).'));
            return;
        }
        setLoading(true, '비축창고 비우는 중...');
        await setDoc(doc(db, CHINA, 'FLOOR2_STOCK'), { map: {}, updatedAt: new Date() });
        await setDoc(doc(db, CHINA, 'FORCE_ALLOW'), { map: {}, updatedAt: new Date() });
        setLoading(false);
        const doneId = skipArch ? partialOf : id;
        // 마감이 끝나면 출고일 선택도 푼다 — 표가 비고 '작업 마감됨'이 보인다(자료는 지우지 않음, 그 출고일은 다시 고르면 보인다. 2026-11-10)
        const cleared = await saveBatchSetting({ batch: deleteField(), lastClosedId: doneId, closePartial: deleteField(), closePartialF2: deleteField(), shipDates: [] }, '작업 마감');
        if (cleared) ctx.patchSettings({ batch: undefined, lastClosedId: doneId, closePartial: undefined, closePartialF2: undefined, shipDates: [] });
        if (cleared) ctx.setSelectedDates([]);
        renderBatchNote();
        showToast(`✅ 작업 마감 — 보관함 ${skipArch ? '(추가분 없음)' : id}${notes.length ? ' · ' + notes.join(' · ') : ''}${arch.shrunk ? ' · 상품명 빼고 보관(크기)' : ''}${cleared ? ' · 다음 출고일을 고르세요' : ''}`);
    }

    // ── [지난 작업 보기] > [스캔 내역] ──
    const scanLogCache = new Map();   // 작업번호 → { expanded } (다 읽힌 것만)
    let scanLogReq = 0, scanLogView = null;
    function scanLogModal() {
        let m = $('live-scanlog-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'live-scanlog-modal'; m.className = 'modal-overlay';
        m.innerHTML = `<div class="modal-content" style="width:860px; max-width:96vw; max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0;" id="live-scanlog-title">스캔 내역</h3>
            <div style="display:flex; gap:8px; margin-bottom:10px;">
                <label style="flex:1; min-width:0; display:flex; align-items:center; gap:6px;">상품코드 검색 <input type="search" id="live-scanlog-q" class="d-input" autocomplete="off" style="flex:1; min-width:0;"></label>
                <button type="button" id="btn-live-scanlog-dl" class="d-btn d-btn-sm">엑셀 받기</button>
            </div>
            <div id="live-scanlog-body" class="detail-row" style="max-height:62vh; overflow:auto; font-size:12px; line-height:1.7;"></div>
            <div style="margin-top:16px; text-align:right; border-top:1px solid var(--c-line-soft); padding-top:12px;">
                <button type="button" id="btn-live-scanlog-close" class="d-btn">닫기</button>
            </div></div>`;
        document.body.appendChild(m);
        const close = () => { m.style.display = 'none'; scanLogReq++; };
        $('btn-live-scanlog-close').addEventListener('click', close);
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.style.display === 'flex') close(); });
        $('live-scanlog-q').addEventListener('input', renderScanLog);
        $('btn-live-scanlog-dl').addEventListener('click', () => {
            const X = window.XLSX;
            if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
            if (!scanLogView) return;
            const bad = writeXls(X, [{ name: '스캔내역', aoa: scanLogExcelRows(scanLogView.expanded, scanLogView.nameOf) }], `스캔내역_${scanLogView.id}.xls`);
            if (bad) alert(bad);
        });
        return m;
    }
    function renderScanLog() {
        if (!scanLogView) return;
        $('live-scanlog-body').innerHTML = scanLogListHtml(scanLogView.expanded, scanLogView.nameOf, esc, { query: $('live-scanlog-q').value });
    }
    /** 보관된 내역 읽기 → { expanded } | { none } | { incomplete }. 일부만 읽히면 합계를 믿을 수 없어 내용을 돌려주지 않는다 */
    async function loadScanLog(id) {
        if (scanLogCache.has(id)) return scanLogCache.get(id);
        const refOf = (part) => doc(db, ...SCANLOG_JOBS_COLL, docIdOf(id, part));
        const first = await getDoc(refOf(0));
        if (!first.exists()) return { none: true };
        const head = first.data() || {};
        const total = parseInt(head.parts) || 0;
        if (total < 1 || total > SCANLOG_MAX_PARTS) return { incomplete: true };
        const rest = await Promise.all(Array.from({ length: total - 1 }, (_, i) => getDoc(refOf(i + 1))));
        const parts = [head, ...rest.map(s => (s.exists() ? s.data() : null))];
        if (!checkScanLogParts(parts, id).ok) return { incomplete: true };
        const v = { expanded: expandScanLogDocs(parts) };
        scanLogCache.set(id, v);
        return v;
    }
    async function openScanLog(r) {
        const m = scanLogModal();
        m.style.display = 'flex';
        const req = ++scanLogReq, id = String(r.id);
        scanLogView = null;
        const body = $('live-scanlog-body'), q = $('live-scanlog-q'), dl = $('btn-live-scanlog-dl');
        $('live-scanlog-title').textContent = `스캔 내역 — ${id}`;
        q.value = ''; q.disabled = true; dl.disabled = true;
        body.innerHTML = '<div class="t-3" style="padding:18px; text-align:center;">불러오는 중...</div>';
        const fail = (cls, text) => { body.innerHTML = `<div class="${cls}" style="padding:18px; text-align:center;">${esc(text)}</div>`; };
        let v;
        try { v = await loadScanLog(id); }
        catch (e) { if (req === scanLogReq) fail('t-risk', '불러오지 못했습니다 — ' + errText(e)); return; }
        if (req !== scanLogReq) return;
        if (v.none) { fail('t-3', '내역 저장 시작 전 마감된 작업입니다(이 작업은 스캔 내역이 없습니다).'); return; }
        if (v.incomplete) { fail('t-risk', '스캔 내역 일부를 읽지 못해 표시하지 않습니다 — 잠시 뒤 다시 열어 보세요.'); return; }
        const names = new Map((Array.isArray(r.rows) ? r.rows : []).map(x => [String(x.c), x.nm || '']));
        scanLogView = { id, expanded: v.expanded, nameOf: (c) => names.get(c) || '' };
        q.disabled = false; dl.disabled = false;
        renderScanLog();
    }

    // ── [지난 작업 보기] ──
    function archiveModal() {
        let m = $('live-archive-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'live-archive-modal'; m.className = 'modal-overlay';
        m.innerHTML = `<div class="modal-content" style="width:760px; max-width:96vw; max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0;">지난 작업 (보관함)</h3>
            <div class="d-note" style="margin-bottom:10px;">[작업 마감] 때 저장한 작업입니다. 최근 30건 · 엑셀은 상품코드별 도착·입고·비축·차이입니다.</div>
            <div style="max-height:60vh; overflow:auto; border:1px solid var(--c-line); border-radius:var(--r-sm);">
                <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center; white-space:nowrap;">
                    <thead><tr><th class="d-th">작업번호</th><th class="d-th">출고일</th><th class="d-th">마감</th><th class="d-th">상품</th><th class="d-th">도착</th><th class="d-th">입고</th><th class="d-th">비축</th><th class="d-th">부족·과입고</th><th class="d-th"></th></tr></thead>
                    <tbody id="live-archive-tbody"></tbody>
                </table>
            </div>
            <div style="margin-top:16px; text-align:right; border-top:1px solid var(--c-line-soft); padding-top:12px;">
                <button type="button" id="btn-live-archive-close" class="d-btn">닫기</button>
            </div></div>`;
        document.body.appendChild(m);
        const close = () => { m.style.display = 'none'; };
        $('btn-live-archive-close').addEventListener('click', close);
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        document.addEventListener('keydown', (e) => {   // 스캔 내역 창이 위에 떠 있으면 그 창만 닫힌다
            const top = $('live-scanlog-modal');
            if (e.key === 'Escape' && m.style.display === 'flex' && !(top && top.style.display === 'flex')) close();
        });
        return m;
    }
    async function openArchive() {
        const m = archiveModal();
        m.style.display = 'flex';
        const tb = $('live-archive-tbody');
        tb.innerHTML = '<tr><td colspan="9" class="t-3" style="padding:22px;">불러오는 중...</td></tr>';
        let recs;
        try {
            // 문서 id 내림차순은 에뮬레이터가 지원하지 않는다 — 마감 시각(보관 문서에 늘 있음)으로 최신순
            const snap = await getDocs(query(collection(db, ARCHIVE_COLL), orderBy('closedAtMs', 'desc'), limit(30)));
            recs = snap.docs.map(d => d.data());
        } catch (e) { tb.innerHTML = `<tr><td colspan="9" class="t-risk" style="padding:22px;">불러오지 못했습니다 — ${esc(errText(e))}</td></tr>`; return; }
        if (!recs.length) { tb.innerHTML = '<tr><td colspan="9" class="t-3" style="padding:22px;">보관된 작업이 없습니다. [작업 마감]을 하면 여기에 쌓입니다.</td></tr>'; return; }
        tb.innerHTML = recs.map((r, i) => { const t = r.totals || {}; return `<tr style="border-bottom:1px solid var(--c-line);">
            <td style="padding:6px;">${esc(r.id)}${r.partialOf ? `<div class="t-3" style="font-size:11px;">${esc(r.partialOf)} 뒤 추가분</div>` : ''}</td><td style="padding:6px;">${esc((r.ships || []).map(fmtMD).join(', '))}</td>
            <td style="padding:6px;">${r.closedAtMs ? esc(mdhm(r.closedAtMs)) : ''}</td><td style="padding:6px;">${n(t.codes)}</td>
            <td style="padding:6px;">${n(t.arr)}</td><td style="padding:6px;">${n(t.conf)}</td><td style="padding:6px;">${n(t.floor2)}</td>
            <td style="padding:6px;"><span class="t-risk">${n(t.short)}</span> · <span class="t-accent">${n(t.over)}</span></td>
            <td style="padding:6px;"><button type="button" class="d-btn d-btn-sm live-arch-dl" data-i="${i}">엑셀 받기</button> <button type="button" class="d-btn d-btn-sm live-arch-scan" data-i="${i}">스캔 내역</button></td></tr>`; }).join('');
        tb.querySelectorAll('.live-arch-scan').forEach(btn => btn.addEventListener('click', () => openScanLog(recs[+btn.dataset.i])));
        tb.querySelectorAll('.live-arch-dl').forEach(btn => btn.addEventListener('click', () => {
            const r = recs[+btn.dataset.i];
            const X = window.XLSX;
            if (!X) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
            const bad = writeXls(X, [{ name: '지난작업', aoa: archiveAoa(r) }], `지난작업_${r.id}.xls`);
            if (bad) alert(bad);
        }));
    }

    // ── [바코드 매핑 올리기] ──
    async function uploadBarcodeMap(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setLoading(true, '바코드 매핑 파일 읽는 중...');
        const aoa = await readSheetRowsAOA(file, ['상품코드', '바코드']);
        const r = barcodeMapOfAoa(aoa);
        let curCount = null;
        try { const s = await getDoc(doc(db, CHINA, 'BARCODE_MAP')); curCount = Object.keys(s.exists() ? unpackMap(s.data()) : {}).length; } catch (e2) { curCount = null; }
        setLoading(false);
        if (!r.map) { alert("'상품코드'·'바코드' 두 열을 찾지 못했습니다(위 20줄 안의 머리글)."); return; }
        const cnt = Object.keys(r.map).length;
        if (!confirm(`스캐너 바코드 매핑을 이 파일로 바꿀까요?\n\n파일: 상품 ${n(r.rows)}행 · 바코드가 상품코드와 다른 것 ${n(cnt)}건\n지금 매핑: ${curCount === null ? '읽지 못함' : n(curCount) + '건'}\n\n`
            + '파일에 없는 바코드는 매핑에서 빠집니다(오류바코드 매칭은 그대로).')) return;
        if (frozenNow()) return;
        setLoading(true, '바코드 매핑 저장 중...');
        await setDoc(doc(db, CHINA, 'BARCODE_MAP'), packMap(r.map));
        setLoading(false);
        showToast(`✅ 바코드 매핑 ${n(cnt)}건 저장 — 스캐너는 다음 조회부터 씁니다`);
    }

    // ── 이지어드민 업로드용 받기 3종 — 파일은 기존 화면과 같게(저장도 기존 downloadToDesktop 과 같다: 저장 창 → 안 되면 기본 다운로드) ──
    async function saveToDesktop(filename, blob) {
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    startIn: 'desktop',
                    types: [{ description: 'Excel', accept: { 'application/vnd.ms-excel': ['.xls'] } }]
                });
                const w = await handle.createWritable();
                await w.write(blob); await w.close();
                showToast('✅ 저장 완료');
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return;   // 사용자가 취소
                // 그 외 오류 → 기본 다운로드로
            }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    /** 진짜 .xls(BIFF8) 파일 — 기존 화면과 같은 쓰기(SheetJS write, type array) */
    //   biff8 한계(행 65,536 등 — js/lib/xls-limits.js)를 넘으면 throw → download() 가 안내
    function biff8Blob(aoa, sheetName) {
        const r = xlsBytes(window.XLSX, [{ name: sheetName, aoa }]);
        if (r.problem) throw new Error(r.problem);
        return new Blob([r.bytes], { type: 'application/vnd.ms-excel' });
    }
    async function download(fn) {
        if (!window.XLSX) { showToast('⚠️ 엑셀 라이브러리를 못 불러옴'); return; }
        try { await fn(); }
        catch (e) { console.error('[mibal2-live] 받기 실패:', e && (e.code || e.message)); alert('파일을 받지 못했습니다 — ' + errText(e)); }
    }
    // 입고용·미발확인 파일은 표(선택 출고일)의 행으로 만든다 — 다른 PC 가 출고일을 바꿨으면 옛 표로 받지 않는다(맞추고 다시 누르게)
    async function freshFileRows(what) {
        const fresh = await reloadOrStop(what);
        if (!fresh) return null;
        if (fresh.datesChanged) { alert(DATES_CHANGED); return null; }
        return fileRowsOf(ctx.getViewRows());
    }
    async function downloadInboundFile() {
        const rows = await freshFileRows('입고용 파일 받기');
        if (!rows) return;
        if (!rows.length) { showToast('받을 행이 없습니다'); return; }
        await saveToDesktop('입고용파일.xls', biff8Blob(inboundFileAoa(rows), 'worksheet'));   // 진짜 .xls(biff8, 2026-11-10 — 예전엔 HTML 표)
    }
    async function downloadMibalFile() {
        const rows = await freshFileRows('미발확인 파일 받기');
        if (!rows) return;
        if (!rows.length) { showToast('받을 행이 없습니다'); return; }
        await saveToDesktop('미발확인파일.xls', biff8Blob(mibalFileAoa(rows), 'worksheet'));
    }
    async function downloadFloor2File() {
        let map = {};
        try { const s = await getDoc(doc(db, CHINA, 'FLOOR2_STOCK')); map = (s.exists() && s.data().map) ? s.data().map : {}; }
        catch (e) { alert('비축창고 데이터 불러오기 실패: ' + errText(e)); return; }
        const aoa = floor2FileAoa(map);
        if (!aoa) { alert('비축창고로 입고된 데이터가 없습니다.\n(입고 스캔 시 미발수량을 넘긴 초과분이 비축창고로 잡힙니다)'); return; }
        await saveToDesktop('비축창고재고.xls', biff8Blob(aoa, '비축창고재고'));
    }

    // ── 업무예상용 미발 기록(화면을 열면 그날 1회) ──
    async function onLatest() {
        if (historyDone || isFrozen()) return;   // 비상 전환 중(조회 전용)이면 기록하지 않는다
        const latest = ctx.getLatest();
        const okMs = latest ? tsMs(latest.lastOkAt) : 0;
        const today = isoDay();
        if (!okMs || isoDay(new Date(okMs)) !== today) return;   // 오늘 수집 자료가 오면 그때
        historyDone = true;
        try {
            const s = await getDoc(doc(db, CHINA, 'MIBAL_HISTORY'));
            const map = (s.exists() && s.data().map) ? s.data().map : {};
            if (hasHistoryToday(map, today)) return;
            const groups = historyGroupsOf(ctx.getShipList(), today);
            if (!groups.length) return;
            const recs = historyRecordsOf(groups, (ships) => mibalTotalsOf(ctx.computeFor(ships)), today);
            await setDoc(doc(db, CHINA, 'MIBAL_HISTORY'), { map: recs, updatedAt: new Date() }, { merge: true });
            console.log('[mibal2-live] 업무예상용 미발 기록:', Object.keys(recs).length, '건');
        } catch (e) {
            historyDone = false;   // 다음 수집 자료 때 다시
            console.warn('[mibal2-live] 업무예상용 미발 기록 실패:', e && e.code);
        }
    }

    /** 비상 전환(조회 전용)이면 쓰기 버튼을 끈다 — 다시 켜는 것은 새로고침 뒤(decorate 가 켬) */
    function setFrozenUI(on) {
        if (!on) return;
        WRITE_BTN_IDS.forEach(id => { const b = $(id); if (b) { b.disabled = true; b.title = '비상 전환 중 — 조회 전용(기존 화면에서 작업)'; } });
    }

    return {
        locOptions: loc.locOptions,
        attachLoc: (tools) => { loc.attach(tools); if (isFrozen()) setFrozenUI(true); },
        onLatest,
        onDates: renderBatchNote,
        isBusy: () => busy,
        setFrozenUI
    };
}
