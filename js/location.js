import { initializeFirebase, loadAppConfig } from './config.js?v=202610301348';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, writeBatch, getDocs, query, where, documentId, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { escapeHtml as escAttr } from './utils.js?v=202610301348';
import { cleanRaw, isCostCol, isDroppedHeader, supplierCodeOf } from './lib/sensitive-cols.js?v=202610301348';
import { multiLocGroups, reserveLocIds, normLocId } from './lib/multi-loc.js?v=202610301348';
import { codeOfRowB, checkUploadB, checkPermanent, newLocIds } from './lib/upload-check.js?v=202610301348';
import { orderKeyMap } from './lib/order-hash.js?v=202610301348';
import { setShellContext } from './app-shell-bridge.js?v=202610301348';
import { memberNameFor } from './app-shell-data.js?v=202610301348';
import { menuConfigOf } from './lib/perm.js?v=202610301348';
import { readHash, writeHash, onHashNav } from './hash-state.js?v=202610301348';
import { initPageNav } from './page-nav.js?v=202610301348';
import { initRefillCard } from './refill-card.js?v=202610301348';
import { initLocRecCard } from './locrec-card.js?v=202610301348';
import { initRebuildBar } from './rebuild-bar.js?v=202610301348';
import { mountRouteSlot } from './locrec-route-card.js?v=202610301348';
import { whenPerm, onPerm, canFeature } from './feature-gate.js?v=202610301348';   // 권한 개편 5단계 — 카드는 권한이 확인된 뒤에만 시작
import { mountBusyBanner, createUploadStatus } from './busy-banner.js?v=202610301348';
import { uploadBlockText } from './lib/busy-view.js?v=202610301348';
import { INCOMING_WAIT_MAX_MS, SHEET_REQ_DAILY_MAX, incomingReadAt, requestServerMs, judgeIncomingSnap, createRunGuard, guardedRun, once, waitTimeoutText } from './lib/incoming-wait.js?v=202610301348';
import { angleSizeOf, SERVER_DEFAULTS } from './lib/loc-recommend.js?v=202610301348';
import { initLocSetPanel } from './locset-panel.js?v=202610301348';   // 환경설정 '추천·채우기' 탭(변경 추천 설정·채우기 설정)
// 변경 추천 [처리함]이 옮긴 자리의 하루 표시(locRecMove)·오늘 재고 올리기 전 충돌 경고 — 계획·판정은 js/lib/locrec-apply.js
import { zoneDocIdOf, moveBadge, uploadMoveConflicts, uploadConflictText } from './lib/locrec-apply.js?v=202610301348';
import { dayKey as kstDayKey } from './lib/refill-view.js?v=202610301348';

// 🔐 onclick="fn('...')" 안에 데이터를 넣을 때 반드시 통과시킬 것.
//    작은따옴표만 막으면 상품명에 " < 역슬래시가 들어올 때 버튼이 동작하지 않거나
//    마크업이 깨진다(상품명·옵션은 외부 시트에서 들어오는 임의 문자열이다).
//    JS 문자열로 한 번, HTML 속성으로 한 번 — 두 겹을 다 막는다.
const jsArg = (v) => String(v == null ? '' : v)
    .replace(/\\/g, '\\\\')     // 역슬래시
    .replace(/'/g, "\\'")        // JS 문자열 종료
    .replace(/\r?\n/g, ' ')       // 줄바꿈은 속성 안에서 깨진다
    .replace(/&/g, '&amp;')      // 여기부터 HTML 속성 이스케이프
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// 🗓️ Date → 'YYYY-MM-DD' (로컬 기준).
//    toISOString().slice(0,10) 을 쓰면 UTC 로 바뀌어 한국시간 오전 9시 이전에는 '어제'가 된다.
//    입고 목록 필터·정리 로그 날짜가 하루 밀리던 원인이라 이 헬퍼로 통일한다.
const toDateStr = (date = new Date()) => {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// D안 상태색 — location.html :root 토큰을 가리킨다. 화면 템플릿에서 hex 대신 이 값을 쓴다.
const TONE = {
    ok: 'var(--c-ok)', okText: 'var(--c-ok-text)', okSoft: 'var(--c-ok-soft)',
    accent: 'var(--c-accent)', accentDeep: 'var(--c-accent-deep)', accentMid: 'var(--c-accent-mid)',
    accentLight: 'var(--c-accent-light)', accentSoft: 'var(--c-accent-soft)', accentRow: 'var(--c-accent-row)',
    warn: 'var(--c-warn)', warnText: 'var(--c-warn-text)', warnSoft: 'var(--c-warn-soft)', warnBg: 'var(--c-warn-bg)',
    risk: 'var(--c-risk)', riskText: 'var(--c-risk-text)', riskSoft: 'var(--c-risk-soft)', riskRow: 'var(--c-risk-row)',
    text: 'var(--c-text)', text2: 'var(--c-text-2)', text3: 'var(--c-text-3)', text4: 'var(--c-text-4)',
    line: 'var(--c-line)', lineSoft: 'var(--c-line-soft)', track: 'var(--c-track)', surface2: 'var(--c-surface-2)'
};

// 피킹용이 아닌 자리(대분류 '기타' = 비축·SAM·A-1-R 형식 등) 판정 — 여러 화면이 같은 기준을 쓴다.
function isEtcLocation(d) {
    const id = String((d && d.id) || '').trim();
    return String((d && d.category) || '피킹용').trim() === '기타' || /^비축/.test(id) || /^SAM/i.test(id);
}

const { db, auth } = initializeFirebase();
const LOC_COLLECTION = 'Locations';

let originalData = []; 
// 스냅샷에서 받은 자리별 원본 값(보정 전) — 최신화 때 '값이 그대로인 자리'를 건너뛰는 비교용
let rawLocMap = {};
let zikjinData = {}; // 플랫폼 출고 (직진+에이블리 합본)
let weeklyData = {}; // 주차별
let incomingData = {};
let incomingTotalByCode = {}; // ★ 상품코드별 입고대기 합계 (오더+사입)
let customTooltips = {}; // ★ v3.53: 사용자 정의 툴팁 { key: html_content, "__deleted__keyName": true }
let sortConfig = { key: 'id', direction: 'asc' };
// ★ v3.57: 모든 필터를 배열로 통일 (다중 선택 지원)
// loc: 구역 prefix, code: ['empty','not-empty'] 중복 불가
// reserved/preassigned: ['only'] 또는 [] (토글)
let filters = { loc: [], code: [], stock: [], stock2f: [], category: [], dong: [], pos: [], reserved: [], preassigned: [] };
// 헤더 검색창 입력으로 테이블을 부분일치 필터링 (컬럼키 → 검색어)
let colTextSearch = {};
// 머리줄 전체 검색(#loc-global-search) — 로케이션·코드·상품명·옵션 부분일치(소문자로 저장)
let globalSearch = '';
// 머리줄 검색이 상품 관리 링크(?q=)로 들어온 값인가 — 이때만 쉼표를 '여러 개(OR)'로 나눈다. 직접 고치면 일반 검색
let _globalSearchFromUrl = false;

const RESERVE_EXPIRE_MS = Infinity; 

let currentUserName = "비로그인 작업자";
let appConfig = null;
// 대시보드 맨 위 '채우기 지시서' 카드 — db·auth 를 넘긴다(Firebase 를 또 초기화하지 않게).
// 체크·요청에 남는 이름은 memberNameFor(직원 이름)만 — currentUserName 은 이메일 앞부분으로 떨어질 수 있어 쓰지 않는다.
whenPerm('location.refill', () => initRefillCard({ db, auth, getMemberName: () => memberNameFor(appConfig && appConfig.memberEmails, auth.currentUser && auth.currentUser.email) }));
// 그 아래 '로케이션 변경 추천' 카드 — 같은 db·auth, 같은 이름 규칙(memberNameFor 만, 이메일 폴백 없음)
whenPerm('location.locrec', () => initLocRecCard({ db, auth, getMemberName: () => memberNameFor(appConfig && appConfig.memberEmails, auth.currentUser && auth.currentUser.email),
    sizeOf: (id) => locAngleSize(originalData.find(d => d.id === id)) }));   // 변경 추천 표: 칸수 칸이 없는 옛 문서 행은 읽어 둔 자리에서 보충
// 대시보드 머리줄 [지금 재고로 다시 만들기](js/rebuild-bar.js) — 채우기·변경 추천을 한 번에. 두 권한 중 하나라도 있으면 시작(구독),
//   요청은 가진 권한 쪽 문서 하나에. 권한 판정이 나올 때마다(로그인 바뀜 포함) 다시 알려 준다. 이름 규칙은 카드와 같다(memberNameFor 만).
const _rebuildBar = initRebuildBar({ db, auth, getMemberName: () => memberNameFor(appConfig && appConfig.memberEmails, auth.currentUser && auth.currentUser.email) });
if (_rebuildBar) onPerm(() => _rebuildBar.setPerms({ canRefill: canFeature('location.refill'), canLocrec: canFeature('location.locrec') }));
// '갱신 중·업로드 중' 띠(js/busy-banner.js) — 이지어드민 잠금(미발·채우기 자동화) + 오늘 재고·도면 업로드 상태. 권한과 상관없이 모두에게.
//   업로드 상태 문서(계약 B)는 올리는 사람이 쓴다(firestore.rules locationStock/** = 업로드 권한). 이름은 memberNameFor 만 — 이메일 폴백 없음.
//   채우기 다시 만들기는 '오늘 채우기 지시서' 카드가 이미 보여 준다 → 띠는 잠금(refill)으로만. 시트 동기화 요청도 잠금(mibal)으로 자동.
const BUSY_LEASE_PATH = 'artifacts/team-work-logger-v2/integrations/ezadminLease';
const UPLOAD_STATUS_PATH = 'artifacts/team-work-logger-v2/locationStock/uploadStatus';
window.__locBusy = createUploadStatus({ db, path: UPLOAD_STATUS_PATH, kind: 'daily',
    getName: () => memberNameFor(appConfig && appConfig.memberEmails, auth.currentUser && auth.currentUser.email) || '' });
let _busyBannerStop = null;
function _syncBusyBanner(user) {
    if (user && !_busyBannerStop) {
        _busyBannerStop = mountBusyBanner({ db, el: document.getElementById('busy-banner'), sources: [
            { path: BUSY_LEASE_PATH, kind: 'lease' },
            { path: UPLOAD_STATUS_PATH, kind: 'upload', myRunId: () => (window.__locBusy && window.__locBusy.runId) || '' }
        ] });
    } else if (!user && _busyBannerStop) { _busyBannerStop(); _busyBannerStop = null; }
}
window.currentUsageTab = '3F';
window.capacity2F = 200000;

window.sheetUrlOrder = ''; 
window.sheetUrlBuy = ''; 

window.visibleColumns = ['std_category', 'std_dong', 'std_pos', 'std_id', 'std_code', 'std_name', 'std_option', 'std_stock'];

// (컬럼 순서는 헤더 드래그앤드롭으로 사용자가 직접 정한다 → 대분류 강제 고정 규칙 제거)
window.excelHeaders = [];

window.isPreAssignMode = false;
window.selectedPreAssignItem = null;

// 동선 기준(구역·동·위치 순서·제외 구역) — 입고대기 추천 자리(calcIncomingRecommend)가 쓴다. 서버 로케이션추천도 같은 값을 읽는다.
// 편집·저장은 환경설정 '추천·채우기' 탭(js/locset-panel.js). 수동 변경 계산 창·점수 비율 칸은 2026-10-27 없앴다(비율은 서버 설정.json).
window.recommendPriorities = {
    zones: { 0: ['★'], 1: ['A','B','C','D','E','F','G','H','I'], 2: ['Z'], 3: ['L','M','N','O','P','Q','R','S','T'] },
    dongs: ['★', '1', '2', '3', '4', '5', '6'],
    poses: ['★', '2', '3', '4', '1', '5']
};
// 자리 id → ZONE 문서 id. 식은 js/lib/locrec-apply.js zoneDocIdOf 한 곳(변경 추천 [처리함] 반영도 같은 문서를 쓴다)
const getZoneDocId = (locId) => zoneDocIdOf(locId);

const injectPuzzleStyle = () => {
    if(document.getElementById('puzzle-style')) return;
    const style = document.createElement('style');
    style.id = 'puzzle-style';
    style.innerHTML = `
        .puzzle-container { display: flex; flex-direction: column; gap: 6px; }
        .puzzle-row { display: flex; align-items: stretch; gap: 8px; }
        .puzzle-label { width: 70px; background: var(--c-track); font-weight: 600; font-size: 12px; color: var(--c-text); display: flex; align-items: center; justify-content: center; border-radius: var(--r-sm); text-align: center; }
        .puzzle-label.pz-r0 { background: var(--c-warn-soft); color: var(--c-warn-text); }
        .puzzle-label.pz-r1 { background: var(--c-ok-soft); color: var(--c-ok-text); }
        .puzzle-label.pz-r2 { background: var(--c-accent-soft); color: var(--c-accent-deep); }
        .puzzle-label.pz-r3 { background: var(--c-accent-light); color: var(--c-accent-deep); }
        .puzzle-label.pz-none { background: var(--c-track); color: var(--c-text-2); border: 1px solid var(--c-line-strong); }
        .puzzle-drop-area { flex: 1; min-height: 42px; border: 2px dashed var(--c-line-strong); border-radius: var(--r-sm); padding: 6px; display: flex; flex-wrap: wrap; gap: 5px; background: var(--c-surface-2); transition: 0.2s; }
        .puzzle-drop-area.pz-none-area { background: var(--c-track); }
        .puzzle-drop-area.dragover { background: var(--c-accent-row); border-color: var(--c-accent); }
        .puzzle-block, .puzzle-sort-block { width: 28px; height: 28px; background: var(--c-surface); color: var(--c-text); border: 1.5px solid var(--c-line-strong); border-radius: var(--r-cell); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; cursor: grab; box-shadow: var(--sh-tab); user-select: none; transition: transform 0.1s; }
        .puzzle-sort-block { width: 34px; border-color: var(--c-accent-mid); color: var(--c-accent-deep); }
        .puzzle-block:active, .puzzle-sort-block:active { cursor: grabbing; transform: scale(1.1); }
        .puzzle-block.dragging, .puzzle-sort-block.dragging { opacity: 0.4; border: 1.5px dashed var(--c-text-3); }
        .sort-container { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: var(--c-accent-row); border-radius: var(--r-sm); border: 1px solid var(--c-accent-soft); min-height: 46px; align-items: center; }
        .section-toggle { background: var(--c-surface-2); padding: 10px 15px; border-radius: var(--r-sm); font-weight: 600; color: var(--c-text); display: flex; justify-content: space-between; cursor: pointer; border: 1px solid var(--c-line); transition: background 0.2s; }
        .section-toggle:hover { background: var(--c-track); }
        .section-content { display: none; padding: 15px 5px 5px 5px; animation: slideDown 0.2s ease-out; }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    `;
    document.head.appendChild(style);
};

loadAppConfig(db).then(config => {
    appConfig = config;
    if (auth.currentUser) updateCurrentUserName(auth.currentUser);
    pushShellContext();
});

// 공통 상단바(js/app-shell.js)에 로그인 상태·메뉴 설정을 넘긴다.
// role 은 memberRoles 에 있을 때만 — 설정을 못 읽어 기본값이면 셸이 캐시 메뉴를 쓴다.
function pushShellContext() {
    const user = auth.currentUser;
    if (!user) { setShellContext({ signedIn: false }); return; }
    const email = (user.email || '').toLowerCase();
    const role = appConfig && appConfig.memberRoles ? appConfig.memberRoles[email] : undefined;
    // memberName 은 셸 개인 알림 구독용(설정을 읽은 뒤에만 생긴다) — 메모리에만, 캐시·로그에 남기지 않는다
    const memberName = (appConfig && memberNameFor(appConfig.memberEmails, email)) || undefined;
    setShellContext({ signedIn: true, uid: user.uid, email, role, memberName,
        menuConfig: role ? menuConfigOf(appConfig) : undefined });
}

function updateCurrentUserName(user) {
    if (!user) return;
    let email = user.email || "";
    let name = user.displayName || email.split('@')[0];
    if (appConfig && appConfig.memberEmails) {
        for (let key in appConfig.memberEmails) {
            if (appConfig.memberEmails[key] === email) { name = key; break; }
        }
    }
    currentUserName = name;
}

onAuthStateChanged(auth, (user) => {
    if (user) updateCurrentUserName(user);
    else currentUserName = "비로그인 작업자";
    pushShellContext();
    _syncBusyBanner(user);
});

window.showLoading = function(text) {
    const loadingText = document.getElementById('loading-text');
    if(loadingText) loadingText.innerText = text;
    document.getElementById('loading-overlay').style.display = 'flex';
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
};

window.hideLoading = function() {
    document.getElementById('loading-overlay').style.display = 'none';
};

// 실시간 연결 오류 띠 — onSnapshot 이 끊기면(권한 거부·네트워크 등) 화면이 옛 자료인 채로 조용히 멈추지 않게 알린다.
// 구독(key)별로 기록하고, 그 구독이 다시 자료를 받으면 지운다. 남은 것이 없으면 띠를 없앤다.
// 위치: 공통 상단바 아래 고정. 권한 안내 띠(js/page-gate.js #perm-gate-banner, warn)가 있으면 그 아래로 내린다.
const _syncErrors = new Map();   // key → { label, code }
let _syncErrObserver = null;
function _placeSyncError(el) {
    const perm = document.getElementById('perm-gate-banner');
    const off = perm ? perm.offsetHeight : 0;
    el.style.top = `calc(var(--as-h, 0px) + ${off}px)`;
}
function _renderSyncError() {
    let el = document.getElementById('loc-sync-error');
    if (_syncErrors.size === 0) {
        if (el) el.remove();
        if (_syncErrObserver) { _syncErrObserver.disconnect(); _syncErrObserver = null; }
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.id = 'loc-sync-error';
        el.setAttribute('role', 'alert');
        el.style.cssText = `position:fixed; left:0; right:0; z-index:2147483580;
            padding:6px 12px; text-align:center; box-sizing:border-box;
            background:var(--c-risk-soft,#FBEAEA); color:var(--c-risk-text,#A33A3A); border-bottom:1px solid var(--c-risk,#D9534F);
            font:600 12.5px/1.5 var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif);`;
        document.body.prepend(el);
        // 권한 안내 띠가 나중에 생기거나 닫히면 위치를 다시 맞춘다(body 직계 자식만 본다)
        _syncErrObserver = new MutationObserver(() => _placeSyncError(el));
        _syncErrObserver.observe(document.body, { childList: true });
    }
    const parts = Array.from(_syncErrors.values()).map(v => `${v.label}(${v.code})`);
    el.textContent = `로케이션 데이터 연결 실패: ${parts.join(', ')} — 화면이 최신이 아닐 수 있습니다. 새로고침해 주세요.`;
    _placeSyncError(el);
}
function showSyncError(key, label, err) {
    _syncErrors.set(key, { label, code: (err && err.code) || 'unknown' });
    _renderSyncError();
}
function clearSyncError(key) {
    if (!_syncErrors.delete(key)) return;
    _renderSyncError();
}

function setupRealtimeListenerB() {
    onSnapshot(collection(db, 'ZikjinData'), (snapshot) => {
        clearSyncError('zikjin');
        zikjinData = {};
        let maxAt = 0, rowCount = 0;
        snapshot.forEach(docSnap => {
            let data = docSnap.data();
            // 청크에 저장된 updatedAt으로 '전송 일시' 역산 (메타 저장 이전 업로드분도 표시)
            if (data.updatedAt) {
                const t = data.updatedAt.toMillis ? data.updatedAt.toMillis() : new Date(data.updatedAt).getTime();
                if (t && t > maxAt) maxAt = t;
            }
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    rowCount += chunk.length;
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) zikjinData[code] = row;
                    });
                } catch(e){}
            }
        });
        _zikjinDerivedMeta = maxAt > 0 ? { at: maxAt, count: rowCount } : null;

        // 직진/에이블리 소스별 합계 (버튼·상세에서 구분 표시용)
        _zikjinSourceTotals = { zikjin: 0, ably: 0, unknown: 0 };
        Object.values(zikjinData).forEach(item => {
            const sp = _zikjinSourceSplit(item);
            _zikjinSourceTotals.zikjin += sp.zikjin;
            _zikjinSourceTotals.ably += sp.ably;
            _zikjinSourceTotals.unknown += sp.unknown;
        });

        updateZikjinInfoDisplay();
        applyFiltersAndSort();
    }, (error) => { console.error("직진배송 오류:", error); showSyncError('zikjin', '플랫폼 출고', error); });

    onSnapshot(collection(db, 'WeeklyData'), (snapshot) => {
        clearSyncError('weekly');
        weeklyData = {};
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) weeklyData[code] = row;
                    });
                } catch(e){}
            }
        });
        applyFiltersAndSort();
    }, (error) => { console.error("주차별데이터 오류:", error); showSyncError('weekly', '주차별', error); });

    onSnapshot(collection(db, 'IncomingData'), (snapshot) => {
        clearSyncError('incoming');
        incomingListMeta = { sheetAt: 0, appliedAt: 0 };
        snapshot.forEach(d => {
            const v = d.data() || {};
            if (d.id === INCOMING_META_ID) {
                incomingListMeta.sheetAt = Number(v.sheetAt) || 0;
                incomingListMeta.appliedAt = Math.max(incomingListMeta.appliedAt, tsMillis(v.appliedAt));
            } else if (v.updatedAt) {
                incomingListMeta.appliedAt = Math.max(incomingListMeta.appliedAt, tsMillis(v.updatedAt));
            }
        });
        if (typeof window.paintIncomingBasis === 'function') window.paintIncomingBasis();
        incomingData = {};
        incomingTotalByCode = {}; // ★ 합계 초기화
        // ★ v3.53: 오늘 날짜 (YYYY-MM-DD)
        const _today = toDateStr();
        snapshot.forEach(docSnap => { 
            let data = docSnap.data();
            if(data.dataStr) {
                try {
                    let chunk = JSON.parse(data.dataStr);
                    chunk.forEach(row => {
                        // 시트에서 붙여넣은 코드에 탭·공백이 섞여 오는 일이 있다(예: 탭+S623811) — 글자 비교라
                        // 이미 배정된 상품이 '배정 전'으로 선지정 목록에 보였다(2026-10-22). 코드 칸은 읽을 때 공백을 걷어낸다.
                        for (const k of ['상품코드', '어드민상품코드', '대표상품코드', '품목코드', '바코드', '상품번호']) {
                            if (row[k] != null) row[k] = String(row[k]).replace(/\s+/g, '');
                        }
                        let code = (row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['품목코드'] || row['바코드'] || row['상품번호']);
                        if(code) {
                            incomingData[code] = row;
                            // ★ v3.53: 도착예정일이 과거이거나 빈칸이면 합계에서 제외
                            const arrivalDate = (row['도착예상일'] || row['표시날짜'] || '').toString().trim();
                            if (!arrivalDate || arrivalDate < _today) return;
                            const qty = Number(row['입고대기수량'] || 0);
                            incomingTotalByCode[code] = (incomingTotalByCode[code] || 0) + qty;
                        }
                    });
                } catch(e){}
            }
        });
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        applyFiltersAndSort();
    }, (error) => { console.error("입고예정데이터 오류:", error); showSyncError('incoming', '입고예정', error); });
}

// 🕒 마지막 데이터 최신화 시각 표시 (상단 헤더)
let _lastDataUpdateTs = null;   // 마지막으로 받은 lastDataUpdate (자정 넘김 재칠하기용)
let _hdrStatusReady = false;    // INFO_CONFIG 를 한 번이라도 받았는지
function updateLastUpdateDisplay(ts) {
    _lastDataUpdateTs = ts;
    _hdrStatusReady = true;
    const el = document.getElementById('last-data-update');
    if (!el) return;
    if (!ts) { el.innerHTML = '<span class="dot"></span>재고<span class="lu-label"> 최신화</span> <b>기록 없음</b>'; return; }
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    // 점 색: 플랫폼 출고와 같은 일수 기준 — 오늘 ok / 어제 warn / 2일 이상 risk
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
    const tone = daysAgo <= 0 ? 'ok' : (daysAgo === 1 ? 'warn' : 'risk');
    el.innerHTML = `<span class="dot" style="background:var(--c-${tone});"></span>재고<span class="lu-label"> 최신화</span> <b>${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}</b>`;
    el.title = '마지막 데이터 최신화: ' + d.toLocaleString('ko-KR');
}

// 헤더 상태 색(오늘/어제/2일+)은 날짜가 바뀌면 달라진다 — 데이터를 다시 읽지 않고 마지막 값으로 1분마다·탭 복귀 때 다시 칠한다
function refreshHeaderStatusTone() {
    if (!_hdrStatusReady) return;
    updateLastUpdateDisplay(_lastDataUpdateTs);
    updateZikjinInfoDisplay();
}
if (!window.__locHdrToneTimer) {
    window.__locHdrToneTimer = setInterval(refreshHeaderStatusTone, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHeaderStatusTone(); });
}

// 📂 직진·에이블리(플랫폼 출고) 전송 기록 간략 표시 (언제/얼마나 + 상세 링크)
let _zikjinSourceTotals = { zikjin: 0, ably: 0, unknown: 0 }; // 소스별 출고량 합계
let _zikjinMeta = null;         // 상세 모달에서 쓰는 '유효' 메타
let _zikjinConfigMeta = null;   // INFO_CONFIG.zikjinMeta (메타 기능 이후 업로드분)
let _zikjinDerivedMeta = null;  // ZikjinData 청크의 updatedAt/건수로 역산(메타 이전 업로드분 대응)
function updateZikjinInfoDisplay() {
    // ⚠️ 두 메타 중 '더 최신'을 쓴다. (예전엔 INFO_CONFIG 메타를 무조건 우선했다)
    //   - _zikjinConfigMeta : 이 앱의 업로드 버튼으로 올렸을 때만 기록됨
    //   - _zikjinDerivedMeta: ZikjinData 청크의 updatedAt에서 역산 — 실제 데이터가 언제 들어왔는지의 사실
    // 외부(스크립트 등)에서 ZikjinData만 직접 갱신하면 INFO_CONFIG 메타는 옛날 값 그대로 남아
    // "오늘 전송했는데 어제 날짜로 표시"되는 문제가 있었다.
    const zMeta = [_zikjinConfigMeta, _zikjinDerivedMeta]
        .filter(m => m && m.at)
        .sort((a, b) => b.at - a.at)[0] || null;
    _zikjinMeta = (zMeta && zMeta.at) ? zMeta : null;
    const el = document.getElementById('zikjin-update-info');
    if (!el) return;

    // 상태 색: ok(오늘) / warn(어제) / risk(2일+ · 기록 없음) — soft 바탕 + text 글자
    const setTone = (tone) => {
        el.style.background = `var(--c-${tone}-soft)`;
        el.style.borderColor = `var(--c-${tone}-soft)`;
        el.style.color = `var(--c-${tone}-text)`;
    };
    const dot = (tone) => `<span class="dot" style="background:var(--c-${tone});"></span>`;

    if (!zMeta || !zMeta.at) {
        el.innerHTML = `${dot('risk')}<span class="zk-label">플랫폼 </span>출고 <b>전송 기록 없음</b>`;
        el.title = '플랫폼 출고 데이터가 아직 업로드되지 않았습니다.\n[메뉴]의 [플랫폼 출고 데이터 올리기]에서 파일을 올려주세요.';
        setTone('risk');
        return;
    }

    const d = new Date(zMeta.at);
    const p = n => String(n).padStart(2, '0');
    const cnt = Number(zMeta.count || 0).toLocaleString();

    // 🔔 최신성 경고 — 플랫폼 출고 데이터는 자동으로 들어오지 않고 '수동 업로드'로만 갱신된다.
    //    올리는 걸 잊으면 로케이션 변경 추천이 옛날 출고량으로 계산되므로, 지난 날짜면 눈에 띄게 표시한다.
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const now = new Date();
    const daysAgo = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

    // 경고 글자는 날짜 앞에 둔다 — 좁은 폭에서 말줄임이 뒤에서부터 잘라도 경고는 남게
    let tone = 'ok', warn = '';
    if (daysAgo <= 0) {
        tone = 'ok'; // 오늘 — 정상
    } else if (daysAgo === 1) {
        tone = 'warn';
        warn = ' <b>어제 자료</b> ·';
    } else {
        tone = 'risk';
        warn = ` <b>${daysAgo}일 지남</b> ·`;
    }
    setTone(tone);

    // 직진/에이블리 구분 요약 (데이터가 있을 때만)
    const st = _zikjinSourceTotals || { zikjin: 0, ably: 0 };
    const splitTxt = (st.zikjin > 0 || st.ably > 0)
        ? ` <span style="font-weight:600; color:var(--c-accent-deep);">직진 ${st.zikjin.toLocaleString()}</span>`
          + `<span style="color:var(--c-text-4);"> / </span>`
          + `<span style="font-weight:600; color:var(--c-risk-text);">에이블리 ${st.ably.toLocaleString()}</span>`
        : '';

    // 좁은 폭에서는 .zk-extra(직진·에이블리 숫자·상세) → .zk-cnt(건수) 순으로 숨긴다 (location.html 헤더 CSS)
    el.innerHTML = `${dot(tone)}<span class="zk-label">플랫폼 </span>출고${warn} <b>${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}<span class="zk-cnt"> · ${cnt}건</span></b><span class="zk-extra">${splitTxt} <span style="text-decoration:underline; color:var(--c-text-2);">상세</span></span>`;
    el.title = `플랫폼 출고 전송: ${d.toLocaleString('ko-KR')} · ${zMeta.count}건`
        + ((st.zikjin > 0 || st.ably > 0)
            ? `

출고량 — 직진배송 ${st.zikjin.toLocaleString()} / 에이블리 ${st.ably.toLocaleString()}`
              + (st.unknown > 0 ? ` / 구분없음 ${st.unknown.toLocaleString()}` : '')
            : '')
        + (daysAgo > 0
            ? `\n\n오늘 올라온 자료가 아닙니다(${daysAgo}일 지남).\n플랫폼 출고 데이터는 자동 전송되지 않고 수동 업로드로만 갱신됩니다.\n출고 작업을 했다면 [메뉴]의 [플랫폼 출고 데이터 올리기]에서 파일을 올려주세요.`
            : '')
        + `\n\n클릭 시 전송 데이터 상세 보기`;
}

// 구분 뱃지(헤더 요약용) / 태그(표 행용)
function _zikBadge(label, qty, count, fg, bg) {
    return `<span style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600;
        color:${fg}; background:${bg}; border:1px solid ${bg}; border-radius:var(--r-pill); padding:3px 10px;">
        ${label} <b style="font-weight:700;">${Number(qty || 0).toLocaleString()}</b>
        <span style="font-weight:600; opacity:.75;">(${Number(count || 0).toLocaleString()}종)</span></span>`;
}
function _zikTag(label, qty, fg, bg) {
    return `<span style="display:inline-block; font-size:10.5px; font-weight:600; color:${fg}; background:${bg};
        border-radius:var(--r-pill); padding:2px 8px;">${label} ${Number(qty || 0).toLocaleString()}</span>`;
}

// 📂 플랫폼 출고 전송 데이터 상세 모달
window.openZikjinDetail = function () {
    const existing = document.getElementById('zikjin-detail-overlay');
    if (existing) existing.remove();

    // 옵션 — 출고 프로그램은 상품코드·상품명·수량만 보낸다(2026-10-26). 로케이션 자료(오늘 재고 엑셀의 '옵션')에서
    //   같은 상품코드의 옵션을 찾아 붙이고, 없으면 주차별·입고대기 자료의 '옵션'(데이터 리스트 옵션 칸과 같은 순서).
    const optByCode = new Map();
    (originalData || []).forEach(d => {
        const c = d && d.code ? String(d.code).trim() : '';
        if (c && d.option && String(d.option).trim() && !optByCode.has(c)) optByCode.set(c, String(d.option).trim());
    });
    const optionOf = (code, item) => optByCode.get(String(code).trim())
        || (item && item['옵션']) || (weeklyData[code] && weeklyData[code]['옵션']) || (incomingData[code] && incomingData[code]['옵션']) || '';
    const rows = Object.entries(zikjinData).map(([code, item]) => {
        const sp = _zikjinSourceSplit(item);
        return {
            code,
            name: (item['상품명'] || item['상품명칭'] || '').toString(),
            option: String(optionOf(code, item) || ''),
            qty: _ablyQtyFromItem(item),
            zikjin: sp.zikjin,
            ably: sp.ably,
            unknown: sp.unknown
        };
    }).sort((a, b) => b.qty - a.qty);
    const total = rows.reduce((s, r) => s + r.qty, 0);

    // 소스별 합계 — 직진 / 에이블리 / 구분없음(구버전 업로드분)
    const sumZ = rows.reduce((s, r) => s + r.zikjin, 0);
    const sumA = rows.reduce((s, r) => s + r.ably, 0);
    const sumU = rows.reduce((s, r) => s + r.unknown, 0);
    const cntZ = rows.filter(r => r.zikjin > 0).length;
    const cntA = rows.filter(r => r.ably > 0).length;
    const cntU = rows.filter(r => r.unknown > 0 && r.zikjin === 0 && r.ably === 0).length;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // 전송 일시 (몇일 몇시)
    const _days = ['일', '월', '화', '수', '목', '금', '토'];
    const _p = n => String(n).padStart(2, '0');
    const fmtAt = (ms) => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${_p(d.getMonth() + 1)}-${_p(d.getDate())}(${_days[d.getDay()]}) ${_p(d.getHours())}:${_p(d.getMinutes())}`;
    };

    let sentLine = '';
    if (_zikjinMeta && _zikjinMeta.at) {
        sentLine = `<div style="font-size:12.5px; color:var(--c-text); margin-top:4px; font-weight:600;">전송 일시: ${fmtAt(_zikjinMeta.at)}</div>`;
    } else {
        sentLine = `<div style="font-size:12px; color:var(--c-text-3); margin-top:4px;">전송 일시: 기록 없음</div>`;
    }

    // 🔎 진단: "오늘 보냈는데 왜 어제로 보이지?"를 바로 확인할 수 있게 두 소스를 함께 보여준다.
    //   업로드 기록 = 이 앱의 업로드 버튼으로 올린 시각
    //   데이터 반영 = ZikjinData 문서가 실제로 마지막으로 쓰인 시각(외부 자동 전송 포함)
    const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${_p(d.getMonth() + 1)}-${_p(d.getDate())}`; })();
    const isToday = (ms) => ms && fmtAt(ms).slice(0, 10) === todayKey;
    const srcLine = (label, meta) => meta && meta.at
        ? `<span style="color:${isToday(meta.at) ? 'var(--c-ok-text)' : 'var(--c-text-3)'};">${label} ${fmtAt(meta.at)}${isToday(meta.at) ? ' <b>(오늘)</b>' : ''} · ${Number(meta.count || 0).toLocaleString()}건</span>`
        : `<span style="color:var(--c-text-4);">${label} 없음</span>`;
    const diagLine = `<div style="font-size:11px; margin-top:4px; line-height:1.7;">
        ${srcLine('· 업로드 기록:', _zikjinConfigMeta)}<br>
        ${srcLine('· 데이터 반영:', _zikjinDerivedMeta)}
      </div>`;

    const body = rows.length === 0
        ? '<div style="padding:36px; text-align:center; color:var(--c-text-3);">전송된 플랫폼 출고 데이터가 없습니다.</div>'
        : `<table style="width:100%; border-collapse:collapse; font-size:13px;">
             <thead><tr style="position:sticky; top:0; background:var(--c-track); z-index:1;">
               <th style="text-align:left; padding:8px;">상품코드</th>
               <th style="text-align:left; padding:8px;">상품명</th>
               <th style="text-align:left; padding:8px;">옵션</th>
               <th style="text-align:center; padding:8px; width:150px;">구분</th>
               <th style="text-align:right; padding:8px;">출고량</th>
             </tr></thead>
             <tbody>${rows.map(r => {
               // 한 상품이 직진·에이블리 양쪽에서 나갈 수 있으므로 각각 표시한다.
               const tags = [];
               if (r.zikjin > 0) tags.push(_zikTag('직진', r.zikjin, TONE.accentDeep, TONE.accentSoft));
               if (r.ably > 0) tags.push(_zikTag('에이블리', r.ably, TONE.riskText, TONE.riskSoft));
               if (tags.length === 0) tags.push(_zikTag('구분없음', r.unknown || r.qty, TONE.text2, TONE.track));
               const src = (r.zikjin > 0 && r.ably > 0) ? 'both' : (r.zikjin > 0 ? 'zikjin' : (r.ably > 0 ? 'ably' : 'unknown'));
               return `<tr class="zik-row" data-src="${src}" style="border-bottom:1px solid var(--c-line-soft);">
                 <td style="padding:6px 8px; font-family:monospace;">${esc(r.code)}</td>
                 <td style="padding:6px 8px;">${esc(r.name)}</td>
                 <td style="padding:6px 8px; color:var(--c-text-2);">${r.option ? esc(r.option) : '<span style="color:var(--c-text-4);">-</span>'}</td>
                 <td style="padding:6px 8px; text-align:center; white-space:nowrap;">${tags.join(' ')}</td>
                 <td style="padding:6px 8px; text-align:right; font-weight:600;">${r.qty.toLocaleString()}</td>
               </tr>`;
             }).join('')}</tbody>
           </table>`;

    // 구분 필터 (전체 / 직진 / 에이블리)
    const filterBar = rows.length === 0 ? '' : `
      <div style="padding:8px 18px; border-bottom:1px solid var(--c-line-soft); background:var(--c-surface-2); display:flex; gap:6px; align-items:center;">
        <span style="font-size:11px; font-weight:700; color:var(--c-text-3); margin-right:2px;">구분 보기</span>
        ${['전체', '직진', '에이블리'].map((label, i) => {
          const key = ['all', 'zikjin', 'ably'][i];
          return `<button type="button" data-zik-filter="${key}" onclick="window.__zikFilter && window.__zikFilter('${key}')"
            class="zik-chip${key === 'all' ? ' on' : ''}">${label}</button>`;
        }).join('')}
        <span id="zik-filter-count" style="font-size:11px; color:var(--c-text-3); margin-left:4px;"></span>
      </div>`;

    const overlay = document.createElement('div');
    overlay.id = 'zikjin-detail-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(30,40,60,0.45); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = `
      <div style="background:var(--c-surface); border-radius:var(--r-card); width:100%; max-width:900px; max-height:85vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:var(--sh-pop);">
        <div style="padding:14px 18px; border-bottom:1px solid var(--c-line-soft); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:16px; font-weight:600; color:var(--c-text);">플랫폼 출고 전송 데이터</div>
            <div style="font-size:12px; color:var(--c-text-2); margin-top:2px;">총 ${rows.length.toLocaleString()}개 상품 · 출고량 합계 ${total.toLocaleString()}</div>
            <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
              ${_zikBadge('직진배송', sumZ, cntZ, TONE.accentDeep, TONE.accentSoft)}
              ${_zikBadge('에이블리', sumA, cntA, TONE.riskText, TONE.riskSoft)}
              ${sumU > 0 ? _zikBadge('구분없음', sumU, cntU, TONE.text2, TONE.track) : ''}
            </div>
            ${sentLine}
            ${diagLine}
          </div>
          <button class="modal-x" onclick="document.getElementById('zikjin-detail-overlay').remove()" aria-label="닫기">×</button>
        </div>
        ${filterBar}
        <div style="overflow:auto; flex:1;">${body}</div>
      </div>`;
    document.body.appendChild(overlay);

    // 구분 필터: 행을 보이고/숨기고 버튼 색을 바꾼다.
    window.__zikFilter = (key) => {
        const ov = document.getElementById('zikjin-detail-overlay');
        if (!ov) return;
        let shown = 0;
        ov.querySelectorAll('.zik-row').forEach(tr => {
            const src = tr.dataset.src;
            const hit = key === 'all'
                || (key === 'zikjin' && (src === 'zikjin' || src === 'both'))
                || (key === 'ably' && (src === 'ably' || src === 'both'));
            tr.style.display = hit ? '' : 'none';
            if (hit) shown++;
        });
        ov.querySelectorAll('[data-zik-filter]').forEach(btn => {
            const on = btn.dataset.zikFilter === key;
            btn.classList.toggle('on', on);
        });
        const cnt = ov.querySelector('#zik-filter-count');
        if (cnt) cnt.textContent = key === 'all' ? '' : `${shown.toLocaleString()}개 상품`;
    };
};

function setupRealtimeListenerA() {
    onSnapshot(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), (docSnap) => {
        clearSyncError('config');
        if(docSnap.exists()) {
            const conf = docSnap.data();
            updateLastUpdateDisplay(conf.lastDataUpdate);
            _zikjinConfigMeta = conf.zikjinMeta || null;
            updateZikjinInfoDisplay();
            if (Array.isArray(conf.dupLocations)) window.__dupLocations = conf.dupLocations;
            if (conf.capacity2F) window.capacity2F = conf.capacity2F;
            if (conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrlOrder;
            if (conf.sheetUrlBuy) window.sheetUrlBuy = conf.sheetUrlBuy;
            if (conf.sheetUrl && !conf.sheetUrlOrder) window.sheetUrlOrder = conf.sheetUrl;
            // ★ 사용자가 헤더를 드래그해 정한 순서를 그대로 사용 (대분류 강제 고정 해제)
            if (conf.visibleColumns) window.visibleColumns = conf.visibleColumns;
            if (conf.excelHeaders) {
                window.excelHeaders = conf.excelHeaders.filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('=') && !isDroppedHeader(h));
                window.__excelHeadersHadDropped = conf.excelHeaders.some(h => isDroppedHeader(h)); // 다음 최신화 때 저장본에서도 빼기
            }
            
            if (conf.recommendPriorities) {
                window.recommendPriorities = conf.recommendPriorities;
                // v4.1: 기존 설정에 ★이 없으면 자동으로 1순위에 추가 (호환성 보강)
                if (Array.isArray(window.recommendPriorities.dongs) && !window.recommendPriorities.dongs.includes('★')) {
                    window.recommendPriorities.dongs = ['★', ...window.recommendPriorities.dongs];
                }
                if (Array.isArray(window.recommendPriorities.poses) && !window.recommendPriorities.poses.includes('★')) {
                    window.recommendPriorities.poses = ['★', ...window.recommendPriorities.poses];
                }
            }
            // ★ v3.53: 사용자 정의 툴팁 로드
            if (conf.customTooltips) {
                customTooltips = conf.customTooltips;
            }
            
            renderTableHeader(); 
            applyFiltersAndSort();
            // ★ v3.53: 툴팁 재적용 (페이지 로드/설정 변경 시)
            if (typeof window.applyCustomTooltips === 'function') window.applyCustomTooltips();
        }
    }, (error) => { console.error("설정(INFO_CONFIG) 오류:", error); showSyncError('config', '설정', error); });

    const qZones = query(collection(db, LOC_COLLECTION), where(documentId(), ">=", "ZONE_"), where(documentId(), "<=", "ZONE_\uf8ff"));
    onSnapshot(qZones, (snapshot) => {
        clearSyncError('zones');
        document.getElementById('firebase-guide').style.display = 'none';
        
        let tempLocMap = {}; 
        const tempRawMap = {};
        
        snapshot.forEach(docSnap => {
            const zoneData = docSnap.data();
            for (let locId in zoneData) {
                if (typeof zoneData[locId] === 'object' && zoneData[locId] !== null) {
                    tempRawMap[locId] = zoneData[locId];
                    let locObj = { id: locId, ...zoneData[locId] };
                    
                    if (locObj.rawDataStr) {
                        try { locObj.rawData = JSON.parse(locObj.rawDataStr); } catch(e) { locObj.rawData = {}; }
                    } else if (!locObj.rawData) {
                        locObj.rawData = {};
                    }
                    // 보안(2026-10-14): 정리 전 옛 자료에 남은 원가 열·공급처 이름 값은 화면에 쓰지 않는다
                    locObj.rawData = cleanRaw(locObj.rawData).out;
                    // 비축(2층 창고) 재고: 엑셀 열 이름이 '비축창고재고' 로 바뀌어 stock2f 가 비어 있는 자료 보정.
                    // 기타(비축·SAM) 칸은 같은 수량을 '정상재고' 쪽에 담으므로 건드리지 않는다(이중 계상 방지).
                    if (!Number(locObj.stock2f || 0) && !isEtcLocation(locObj)) {
                        const _b = locObj.rawData['비축창고재고'] ?? locObj.rawData['2층창고재고'];
                        const _n = String(_b == null ? '' : _b).replace(/[^0-9.-]/g, '');
                        if (_n !== '' && Number(_n)) locObj.stock2f = _n;
                    }
                    
                    tempLocMap[locId] = locObj; 
                }
            }
        });
        
        originalData = Object.values(tempLocMap);
        rawLocMap = tempRawMap;
        
        // ★ codeTag 자정 초기화 체크
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        originalData.forEach(loc => {
            if (loc.codeTag && loc.codeTagAt && loc.codeTagAt < todayStart) {
                loc.codeTag = '';
                loc.codeTagAt = 0;
                // DB에서도 초기화 (비동기, 화면 렌더링 차단 안 함)
                const zoneDocId = getZoneDocId(loc.id);
                setDoc(doc(db, LOC_COLLECTION, zoneDocId), { [loc.id]: { codeTag: '', codeTagAt: 0 } }, { merge: true }).catch(() => {});
            }
        });
        
        renderTableHeader(); 
        applyUrlSearchOnce();
        applyFiltersAndSort(); 
        if(document.getElementById('incoming-sidebar').classList.contains('open')) window.renderIncomingQueue();
        
        // 도면 탭이 열려있으면 자동 재렌더링
        if (document.getElementById('view-map') && document.getElementById('view-map').style.display !== 'none') {
            window.renderMap();
        }
        
        const pop = document.getElementById('usage-popup');
        if (pop && pop.style.display === 'block') window.calculateAndRenderUsage();
    }, (error) => { console.error("A창고 오류:", error); showSyncError('zones', 'A창고 로케이션', error); });
}

window.onload = () => {
    injectPuzzleStyle();
    setupRealtimeListenerA();
    setupRealtimeListenerB();
    // v4.0a-fix4: 페이지 로드 시 페어 캐시 자동 로드 (페어 쌍 추천에 필수)
    if (typeof window.loadOrderPairsCache === 'function') {
        window.loadOrderPairsCache();
    }
    // v4.4 종합 대시보드 UI는 제거됐으나, 대시보드의 '재고 회전율' 지표를 위해
    // 재고 스냅샷 파이프라인(load/snapshot)은 유지한다.
    if (typeof window._v44_init === 'function') {
        setTimeout(() => { window._v44_init(); }, 1500);
    }
};

window.handleDragStart = (e) => {
    e.target.classList.add('dragging');
    e.dataTransfer.setData('text/plain', e.target.innerText);
    e.dataTransfer.effectAllowed = "move";
};
window.handleDragEnd = (e) => { e.target.classList.remove('dragging'); };
window.handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
    e.dataTransfer.dropEffect = "move";
};
window.handleDragLeave = (e) => { e.currentTarget.classList.remove('dragover'); };
window.handleDrop = (e, targetArea) => {
    e.preventDefault();
    targetArea.classList.remove('dragover');
    const draggedText = e.dataTransfer.getData('text/plain');
    const draggedEl = Array.from(document.querySelectorAll('.puzzle-block')).find(el => el.innerText === draggedText && el.classList.contains('dragging'));
    if(draggedEl) targetArea.appendChild(draggedEl);
};

window.handleSortDragOver = (e) => {
    e.preventDefault();
    const container = e.currentTarget;
    const dragging = document.querySelector('.puzzle-sort-block.dragging');
    if(!dragging) return;
    const afterElement = getDragAfterElement(container, e.clientX);
    if (afterElement == null) {
        container.appendChild(dragging);
    } else {
        container.insertBefore(dragging, afterElement);
    }
};
window.getDragAfterElement = (container, x) => {
    const draggableElements = [...container.querySelectorAll('.puzzle-sort-block:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
};

window.toggleSection = function(id, iconId) {
    const el = document.getElementById(id);
    const icon = document.getElementById(iconId);
    if(el.style.display === 'block') {
        el.style.display = 'none';
        icon.innerText = '▼';
    } else {
        el.style.display = 'block';
        icon.innerText = '▲';
    }
};

window.toggleUsageDetails = function() {
    const content = document.getElementById('usage-details-content');
    const btn = document.getElementById('usage-details-btn');
    if (content.style.display === 'none') {
        content.style.display = 'block';
        btn.innerText = '간략히보기 ▲';
    } else {
        content.style.display = 'none';
        btn.innerText = '자세히보기 ▼';
    }
};

const escHtmlLite = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ★ 자리 칸수 = 자리에 저장된 angleSize 만. 업로드 원본(rawData)의 '칸수' 는 쓰지 않는다 —
//   옵션추가항목1 로 만든 비축 자리도 상품 행의 rawData 를 그대로 받아 남(피킹 자리)의 칸수가 붙기 때문.
//   채우기자동화 규칙.py pick_label 도 angleSize 만 본다(같은 기준). 숫자 0·false 등 빈 값은 칸수 없음.
//   규칙은 lib/loc-recommend.js angleSizeOf 한 곳 — 변경 추천 행의 fromSize/toSize 도 같은 함수로 만든다.
const locAngleSize = angleSizeOf;

// ★ 메인 테이블 엑셀 다운로드 (HTML 테이블 .xls 형식)
window.downloadMainExcel = function() {
    // 1. 체크된 항목 확인 (가상 스크롤 전역 상태 사용)
    const checkedIds = VS.checkedIds;
    
    let targetData;
    let fileLabel;
    
    if (checkedIds.size > 0) {
        targetData = originalData.filter(d => checkedIds.has(d.id));
        fileLabel = `로케이션_선택${targetData.length}건`;
    } else if (window.lastFilteredData && window.lastFilteredData.length !== originalData.length) {
        targetData = window.lastFilteredData;
        fileLabel = `로케이션_필터${targetData.length}건`;
    } else {
        targetData = originalData;
        fileLabel = `로케이션_전체${targetData.length}건`;
    }
    
    if (!targetData || targetData.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    
    // 헤더 구성
    // ★ 2026-10-12 사용자 양식: A '로케이션1'(로케이션(칸수) / 상품코드) + B '로케이션'(자리 번호만)
    const stdHeaders = ['로케이션1', '로케이션', '동', '위치', '상품코드', '상품명', '옵션', '정상재고', '비축창고재고'];
    const cusHeaders = (window.excelHeaders || []).filter(h => h && !h.includes('<') && !h.includes('>') && !h.includes('=') && h !== '로케이션1');
    // '칸수' 열이 있는 파일을 한 번도 안 올렸으면 원본 열 목록에 없다 — 그래도 칸수 열은 늘 내보낸다(맨 끝)
    if (!cusHeaders.includes('칸수')) cusHeaders.push('칸수');
    const allHeaders = [...stdHeaders, ...cusHeaders];
    
    // HTML 테이블 생성
    let headerRow = allHeaders.map(h => `<td class=header>${h}</td>`).join('');
    
    let dataRows = '';
    targetData.forEach(loc => {
        const code = (loc.code === loc.id ? '' : loc.code) || '';
        const stock = loc.stock || '0';
        const stock2f = loc.stock2f || '0';
        
        // ★ 로케이션1: ★★-003(4)/ S610026 (칸수 없으면 괄호 없이, 상품 없으면 로케이션(칸수)만)
        const angleSize = locAngleSize(loc);
        const locWithAngle = angleSize ? `${loc.id}(${angleSize})` : loc.id;
        const locDisplay = code ? `${locWithAngle}/ ${code}` : locWithAngle;   // 로케이션 바로 뒤에 / (공백 없음, 사용자 요청 2026-10-14)

        let row = '';
        row += `<td class='style1'>${locDisplay}</td>`;
        row += `<td class='style1'>${loc.id}</td>`;
        row += `<td class='style2'>${loc.dong || ''}</td>`;
        row += `<td class='style2'>${loc.pos || ''}</td>`;
        row += `<td class='style1'>${code}</td>`;
        row += `<td class='style1'>${loc.name || ''}</td>`;
        row += `<td class='style1'>${loc.option || ''}</td>`;
        row += `<td class='style3'>${stock}</td>`;
        row += `<td class='style3'>${stock2f}</td>`;
        
        cusHeaders.forEach(h => {
            // 칸수는 자리에 저장된 값(angleSize)이 우선 — 업로드 원본(rawData)은 그다음
            const val = h === '칸수' ? angleSize : ((loc.rawData && loc.rawData[h]) ? loc.rawData[h] : '');
            const isNum = !isNaN(val) && val !== '';
            row += `<td class='${isNum ? 'style3' : 'style2'}'>${val}</td>`;
        });
        
        dataRows += `<tr>${row}</tr>\n`;
    });
    
    const htmlContent = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<meta http-equiv='Content-Type' content='text/html; charset=utf-8'>
<head>
<style>
    br {mso-data-placement:same-cell;}
    .header {font:bold 10pt "굴림"; white-space:nowrap; background:#CCFFCC;}
    .style1 {font:9pt "굴림"; white-space:nowrap; mso-number-format:\\@;}
    .style2 {font:9pt "굴림"; white-space:nowrap;}
    .style3 {font:9pt "굴림"; white-space:nowrap; mso-number-format:"0_ ";}
</style>
<!--[if gte mso 9]>
<xml>
<x:ExcelWorkbook>
<x:ExcelWorksheets>
<x:ExcelWorksheet>
<x:Name>로케이션</x:Name>
<x:WorksheetOptions><x:Selected/></x:WorksheetOptions>
</x:ExcelWorksheet>
</x:ExcelWorksheets>
</x:ExcelWorkbook>
</xml>
<![endif]-->
</head>
<body>
<table border="1" cellspacing="0" cellpadding="2">
<tr>${headerRow}</tr>
${dataRows}
</table>
</body>
</html>`;
    
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    a.download = `${fileLabel}_${dateString}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// 에이블리 출고량 계산. '수량/기간배송수량' 총량 컬럼이 있으면 사용하고,
// 없으면(에이블리 파일이 상품코드 + 날짜별 컬럼만 있는 경우) 날짜별(YYYYMMDD) 컬럼 합계를 출고량으로 사용.
// 📦 플랫폼 출고 행의 소스별(직진/에이블리) 수량 분해.
//   출고 자동화 프로그램이 각 행에 _q: { 소스ID: 수량 } 을 남긴다.
//     ZG  = 직진 일반   / ZGF = 직진 즉시출고
//     AB  = 에이블리 일반 / ABF = 에이블리 즉시출고
//     LEGACY = 소스 구분이 없던 시절(앱에서 엑셀 직접 업로드)분
function _zikjinSourceSplit(item) {
    const q = (item && typeof item._q === 'object' && item._q) ? item._q : null;
    if (!q) return { zikjin: 0, ably: 0, unknown: _ablyQtyFromItem(item) };
    const num = v => Number(v) || 0;
    return {
        zikjin: num(q.ZG) + num(q.ZGF),
        ably:   num(q.AB) + num(q.ABF),
        unknown: num(q.LEGACY)
    };
}

function _ablyQtyFromItem(aItem) {
    if (!aItem) return 0;
    const direct = Number(aItem['수량'] || aItem['기간배송수량'] || aItem['기간발주수량'] || 0);
    if (direct > 0) return direct;
    let sum = 0;
    for (const k in aItem) { if (/^20\d{6}$/.test(k)) sum += Number(aItem[k] || 0); }
    return sum;
}

// ========================================
// ★ 빈칸확보 기능 (구 2F 이동 추천) — 현재고 0 · 입고대기 0 상품, 공급처 제외 지원
// ========================================
window.current2FList = [];

window.toggle2FCheckAll = function(source) {
    document.querySelectorAll('.check-2f-item').forEach(cb => cb.checked = source.checked);
};

// rawData에서 키를 유연하게 찾는 헬퍼 (공백/전각공백 무시 — \s 는 NBSP도 매칭)
function get2FRawVal(rd, targetKey) {
    if (!rd) return '';
    if (rd[targetKey]) return rd[targetKey];
    const norm = targetKey.replace(/\s/g, '');
    for (const k of Object.keys(rd)) {
        if (k.replace(/\s/g, '') === norm) return rd[k];
    }
    return '';
}

// 마지막출고.배송일: 마지막배송일/마지막출고일 중 가장 최근 날짜를 반환. (마지막입고일은 미포함)
// 두 날짜는 서로 다른 이벤트(배송 vs 출고)이므로 둘 중 더 최근 값이 실제 마지막 이동일임.
function __getLastMoveDate(rd) {
    if (!rd) return '';
    let result = '';
    ['마지막배송일', '마지막출고일'].forEach(key => {
        const val = get2FRawVal(rd, key);
        if (val) {
            const norm = String(val).replace(/\./g, '-');
            if (norm > result) result = norm;
        }
    });
    return result;
}

// 상품(로케이션 묶음)의 공급처를 찾는다. '공급처코드' 열이 있으면 그 값을 먼저, 없으면 공급처 열 값
//   (저장 때 cleanRaw 로 코드 모양 값만 남는다). 재고 엑셀 헤더명이 확실치 않아 유연 매칭.
const SUPPLIER_KEYS = ['공급처', '공급처명', '공급사', '공급업체', '거래처', '거래처명', 'vendor', 'supplier', 'Supplier'];
function get2FSupplier(locs) {
    for (const loc of locs) {
        const rd = loc.rawData;
        if (!rd) continue;
        const code = supplierCodeOf(rd);
        if (code) return code;
        for (const key of SUPPLIER_KEYS) {
            const v = get2FRawVal(rd, key);
            if (v) return String(v).trim();
        }
        // '공급처'가 들어간 키(단, 상품명/코드류 제외)
        for (const k of Object.keys(rd)) {
            const ck = k.replace(/\s/g, '');
            if (ck.includes('공급처') && !ck.includes('상품') && !ck.includes('코드')) {
                const v = rd[k];
                if (v) return String(v).trim();
            }
        }
    }
    return '';
}

// 공급처 제외 체크리스트 렌더 (기존 체크 상태 유지)
window.render2FSupplierList = function(supplierSet, excluded) {
    const box = document.getElementById('2f-supplier-box');
    if (!box) return;
    const suppliers = [...supplierSet].sort((a, b) => a.localeCompare(b, 'ko'));
    if (suppliers.length === 0) {
        box.innerHTML = '<span style="font-size:12px; color:var(--c-text-3);">공급처 정보가 있는 상품이 없습니다.</span>';
        const allCb0 = document.getElementById('2f-supplier-all');
        if (allCb0) allCb0.checked = false;
        return;
    }
    box.innerHTML = suppliers.map(s => {
        const checked = excluded.has(s) ? ' checked' : '';
        const safe = String(s).replace(/"/g, '&quot;');
        return '<label style="font-size:12px; color:var(--c-text); cursor:pointer; user-select:none; white-space:nowrap;">' +
               '<input type="checkbox" class="f2-supplier-cb" value="' + safe + '"' + checked + ' style="vertical-align:middle;"> ' + s +
               '</label>';
    }).join('');
    const allCb = document.getElementById('2f-supplier-all');
    if (allCb) allCb.checked = suppliers.every(s => excluded.has(s));
};

window.toggle2FSupplierAll = function(source) {
    document.querySelectorAll('.f2-supplier-cb').forEach(cb => cb.checked = source.checked);
    window.calc2FList();
};

window.calc2FList = function() {
    // 재렌더 전에 현재 체크된 '제외 공급처' 수집
    const excluded = new Set(
        Array.from(document.querySelectorAll('.f2-supplier-cb:checked')).map(cb => cb.value)
    );

    // 상품코드별로 그룹핑
    const codeMap = {};
    originalData.forEach(loc => {
        const code = loc.code;
        if (!code || code.trim() === '' || code === loc.id) return;
        if (!codeMap[code]) codeMap[code] = [];
        codeMap[code].push(loc);
    });

    window.current2FList = [];
    const supplierSet = new Set(); // 조건 통과 후보들의 공급처 (체크리스트용)

    // 입고대기(오더/사입 입고 리스트)에 포함된 상품코드 — 공백 정규화하여 집합화
    const incomingCodeSet = new Set(Object.keys(incomingData || {}).map(c => String(c).trim()));

    for (const code in codeMap) {
        // ★ 기준 1: 입고대기에 포함된 상품 제외
        //   (미입고수량>0 이거나, 오더/사입 입고 리스트에 코드가 존재하면 제외 — 도착일 지남·잔량0도 포함)
        if (incomingCodeSet.has(String(code).trim()) || (incomingTotalByCode[code] || 0) > 0) continue;

        const locs = codeMap[code];

        // ★ 기준 2: 현재고(정상재고) 0개
        let totalStock = 0;
        locs.forEach(l => totalStock += Number(l.stock || 0));
        if (totalStock !== 0) continue;

        const firstLoc = locs[0];

        // 공급처 (제외 판별 + 표시)
        const supplier = get2FSupplier(locs);
        if (supplier) supplierSet.add(supplier);
        if (supplier && excluded.has(supplier)) continue; // ★ 선택한 공급처 제외

        // 마지막출고.배송일 (참고 표시용) — 마지막배송일/마지막출고일 중 더 최근 값
        let lastDelivery = '';
        for (const loc of locs) {
            const val = __getLastMoveDate(loc.rawData);
            if (val && val > lastDelivery) lastDelivery = val;
        }

        // 옵션추가항목1 값
        let extraOpt = '';
        for (const loc of locs) {
            const val = get2FRawVal(loc.rawData, '옵션추가항목1');
            if (val) { extraOpt = val; break; }
        }

        const locIds = locs.map(l => l.id).join(', ');
        const name = firstLoc.name || '';
        const option = firstLoc.option || '';
        const changeValue = `2F-${code}${extraOpt ? ' ' + extraOpt : ''}`;

        window.current2FList.push({
            code, name, option, supplier, totalStock, lastDelivery: lastDelivery || '기록없음',
            locIds, locs, changeValue, extraOpt
        });
    }

    // 공급처 체크리스트 갱신 (선택 상태 유지)
    window.render2FSupplierList(supplierSet, excluded);

    // 마지막배송일 오래된 순 정렬 (기록없음이 맨 위)
    window.current2FSortAsc = true;
    window.current2FList.sort((a, b) => {
        const aVal = a.lastDelivery === '기록없음' ? '0000-00-00' : a.lastDelivery;
        const bVal = b.lastDelivery === '기록없음' ? '0000-00-00' : b.lastDelivery;
        return aVal.localeCompare(bVal);
    });

    const icon = document.getElementById('2f-sort-icon');
    if (icon) icon.textContent = '▲';

    window.render2FTable();
};

window.current2FSortAsc = true; // 기본: 오래된 순 (오름차순)

window.sort2FList = function() {
    if (!window.current2FList || window.current2FList.length === 0) return;
    
    window.current2FSortAsc = !window.current2FSortAsc;
    
    window.current2FList.sort((a, b) => {
        const aVal = a.lastDelivery === '기록없음' ? '0000-00-00' : a.lastDelivery;
        const bVal = b.lastDelivery === '기록없음' ? '0000-00-00' : b.lastDelivery;
        return window.current2FSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    
    // 아이콘 업데이트
    const icon = document.getElementById('2f-sort-icon');
    if (icon) icon.textContent = window.current2FSortAsc ? '▲' : '▼';
    
    // 테이블 다시 렌더링
    window.render2FTable();
};

window.render2FTable = function() {
    const tbody = document.getElementById('2f-tbody');
    let html = '';
    window.current2FList.forEach((item, idx) => {
        const rowBg = idx % 2 === 0 ? 'var(--c-surface)' : 'var(--c-surface-2)';
        html += `
            <tr style="background:${rowBg};">
                <td><input type="checkbox" class="check-2f-item" data-idx="${idx}"></td>
                <td style="font-weight:600; color:var(--c-text-2);">${idx + 1}</td>
                <td style="font-weight:600; color:var(--c-accent-deep); white-space:nowrap;">${item.code}</td>
                <td style="text-align:left; font-size:13px; white-space:nowrap;">${item.name}</td>
                <td style="font-size:12px; white-space:nowrap;">${item.option}</td>
                <td style="font-size:12px; color:var(--c-text-2); white-space:nowrap;">${item.supplier || '-'}</td>
                <td style="font-weight:bold;">${item.totalStock}</td>
                <td style="font-size:12px; color:${item.lastDelivery === '기록없음' ? 'var(--c-risk-text)' : 'var(--c-text-2)'};">${item.lastDelivery}</td>
                <td style="font-size:12px;">${item.locIds}</td>
                <td style="background:var(--c-accent-soft); font-weight:600; color:var(--c-accent-deep); font-size:12px;">${item.changeValue}</td>
            </tr>
        `;
    });
    if (window.current2FList.length === 0) {
        html = '<tr><td colspan="10" style="padding:40px; color:var(--c-text-3);">조건에 해당하는 상품이 없습니다.</td></tr>';
    }
    tbody.innerHTML = html;
    document.getElementById('2f-check-all').checked = false;
};

window.download2FExcel = function() {
    if (!window.current2FList || window.current2FList.length === 0) {
        alert("다운로드할 데이터가 없습니다. 먼저 조회해주세요.");
        return;
    }

    // 체크된 항목이 있으면 선택만, 없으면 전체 다운로드
    const checked = document.querySelectorAll('.check-2f-item:checked');
    let targetList;
    let fileLabel;
    if (checked.length > 0) {
        const indices = Array.from(checked).map(cb => Number(cb.dataset.idx));
        targetList = indices.map(i => window.current2FList[i]).filter(Boolean);
        fileLabel = `빈칸확보_선택${targetList.length}건`;
    } else {
        targetList = window.current2FList;
        fileLabel = `빈칸확보_전체${targetList.length}건`;
    }

    const excelData = targetList.map((item, idx) => ({
        "No": idx + 1,
        "상품코드": item.code,
        "상품명": item.name,
        "옵션": item.option,
        "공급처": item.supplier || '',
        "정상재고": item.totalStock,
        "마지막출고.배송일": item.lastDelivery,
        "현재위치": item.locIds,
        "변경값": item.changeValue
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = [
        { wch: 5 }, { wch: 15 }, { wch: 40 }, { wch: 25 }, { wch: 18 },
        { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 30 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "빈칸확보");
    const today = new Date();
    const dateString = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `${fileLabel}_${dateString}.xlsx`);
};

function renderTableHeader() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const popupContainer = document.getElementById('dynamic-popups');
    if (!theadTr || !popupContainer) return;

    let html = `<th class="checkbox-cell" style="width: ${COL_W_CHECK}px;"><input type="checkbox" id="check-all" class="loc-check" onclick="toggleAllCheckboxes(this)"></th>`;
    let popupHtml = '';
    _colWidths = loadColWidths();
    document.body.classList.remove('col-resizing');   // 끄던 중 다시 그려졌을 때 커서 잠김 풀기
    
    window.visibleColumns.forEach(col => {
        if (col === 'std_dong') { html += createTh('dong', '동', 80, true, col); popupHtml += `<div id="pop-dong" class="filter-popup"></div>`; }
        else if (col === 'std_pos') { html += createTh('pos', '위치', 80, true, col); popupHtml += `<div id="pop-pos" class="filter-popup"></div>`; }
        else if (col === 'std_id') { html += createTh('id', '로케이션', 150, true, col); popupHtml += `<div id="pop-id" class="filter-popup"></div>`; }
        else if (col === 'std_category') { html += createTh('category', '대분류', 90, true, col); popupHtml += `<div id="pop-category" class="filter-popup"></div>`; }
        else if (col === 'std_code') { html += createTh('code', '상품코드', 150, true, col); popupHtml += `<div id="pop-code" class="filter-popup"></div>`; }
        else if (col === 'std_name') { html += createTh('name', '상품명', 'auto', true, col); popupHtml += `<div id="pop-name" class="filter-popup"></div>`; }
        else if (col === 'std_option') { html += createTh('option', '옵션', 180, true, col); popupHtml += `<div id="pop-option" class="filter-popup"></div>`; }
        else if (col === 'std_stock') { html += createTh('stock', '정상재고', 130, true, col); popupHtml += `<div id="pop-stock" class="filter-popup"></div>`; }
        else if (col === 'std_stock2f') { html += createTh('stock2f', '비축창고재고', 130, true, col); popupHtml += `<div id="pop-stock2f" class="filter-popup"></div>`; }
        else if (col.startsWith('cus_')) {
            const label = col.replace('cus_', '');
            // ★ 입고대기 컬럼에 툴팁 추가
            let displayLabel = label;
            if (label === '입고대기') {
                displayLabel = `입고대기<span class="info-tip" data-tip-key="header-incoming">i<span class="info-tip-content"><b>오더리스트 + 사입리스트 합계</b><br>입고대기 사이드바에 연동된 구글시트의 <b>미입고수량</b>을 상품코드 기준으로 합산한 값입니다.<br>(같은 상품코드의 옵션별 수량이 모두 더해집니다)</span></span>`;
            }
            html += createTh(col, displayLabel, 120, true, col);
            popupHtml += `<div id="pop-${col}" class="filter-popup"></div>`;
        }
    });

    theadTr.innerHTML = html;
    popupContainer.innerHTML = popupHtml;
    // ★ 열 폭 고정 + 끌어서 조절(2026-10-14): 표는 table-layout:fixed, 폭 = 열 폭 합계(넘치면 .list-container 가 가로 스크롤).
    //   열마다 기본 폭이 있고, 머리글 오른쪽 경계를 끌면 바뀐다. 바꾼 폭은 이 브라우저에만 저장(사람마다 따로).
    syncTableWidth();
    setupColumnResize();

    document.querySelectorAll('.filter-popup').forEach(p => { p.addEventListener('click', function(e) { e.stopPropagation(); }); });
    setupFilterPopups();
    setupHeaderDragAndDrop();
}

function createTh(key, label, width, hasFilter, colId) {
    // 기본 폭 = 지정 폭 + 좌우 여백(24). 'auto'(상품명)는 280. 저장된 폭이 있으면 그것.
    const defW = (width === 'auto' ? 280 : width) + 24;
    const saved = colId ? Number(_colWidths[colId]) : NaN;
    const w = Number.isFinite(saved) && saved >= COL_W_MIN && saved <= COL_W_MAX ? saved : defW;
    let widthStyle = `style="width: ${w}px;" data-defw="${defW}"`;
    let filterHtml = hasFilter ? `<span class="filter-btn" id="btn-filter-${key}" onclick="toggleFilterPopup(event, 'pop-${key}')">▼</span>` : '';
    // ★ 드래그앤드롭으로 컬럼 순서 변경 가능하도록 표식 부여
    const dragAttrs = colId ? ` draggable="true" data-col="${colId}" title="드래그해서 헤더 순서를 바꿀 수 있습니다"` : '';
    const resizeHtml = colId ? `<span class="th-resize" data-resize="${colId}" title="끌어서 폭 조절 · 더블클릭하면 기본 폭"></span>` : '';
    return `<th ${widthStyle}${dragAttrs}><div class="th-content"><span class="title-text">${label}</span>${filterHtml}</div>${resizeHtml}</th>`;
}

// ── 열 폭 (2026-10-14) ──────────────────────────────────────
const COL_W_KEY = 'loc.colWidths';
const COL_W_MIN = 50, COL_W_MAX = 800, COL_W_CHECK = 44;
let _colWidths = {};
function loadColWidths() {
    try { const o = JSON.parse(localStorage.getItem(COL_W_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
    catch (e) { return {}; }   // 저장소를 못 쓰거나 값이 깨졌으면 기본 폭
}
function saveColWidths() {
    try { localStorage.setItem(COL_W_KEY, JSON.stringify(_colWidths)); } catch (e) { /* 이번 화면에만 적용 */ }
}
/** 표 폭 = 머리글 열 폭 합계 (table-layout:fixed 라 열 폭이 그대로 지켜진다) */
function syncTableWidth() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    const table = theadTr && theadTr.closest('table');
    if (!table) return;
    let sum = 0;
    theadTr.querySelectorAll('th').forEach(th => { sum += parseFloat(th.style.width) || 0; });
    table.style.minWidth = '0';
    table.style.width = sum + 'px';
}
/** 머리글 오른쪽 경계(.th-resize)를 끌어 폭 조절, 더블클릭 = 기본 폭. 헤더 끌어 순서 바꾸기와 겹치지 않게 막는다. */
function setupColumnResize() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    if (!theadTr) return;
    theadTr.querySelectorAll('.th-resize').forEach(h => {
        const th = h.closest('th');
        const colId = h.dataset.resize;
        h.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
        h.addEventListener('click', (e) => e.stopPropagation());
        h.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX, startW = parseFloat(th.style.width) || th.offsetWidth;
            const wasDraggable = th.draggable;
            th.draggable = false;
            h.classList.add('is-resizing');
            document.body.classList.add('col-resizing');
            try { h.setPointerCapture(e.pointerId); } catch (_) {}
            const move = (ev) => {
                const w = Math.round(Math.min(COL_W_MAX, Math.max(COL_W_MIN, startW + (ev.clientX - startX))));
                th.style.width = w + 'px';
                syncTableWidth();
            };
            let ended = false;
            const up = () => {
                if (ended) return;
                ended = true;
                h.removeEventListener('pointermove', move);
                h.removeEventListener('pointerup', up);
                h.removeEventListener('pointercancel', up);
                h.removeEventListener('lostpointercapture', up);
                h.classList.remove('is-resizing');
                document.body.classList.remove('col-resizing');
                th.draggable = wasDraggable;
                const w = parseFloat(th.style.width);
                if (Number.isFinite(w) && w !== startW) {
                    if (w === Number(th.dataset.defw)) delete _colWidths[colId]; else _colWidths[colId] = w;
                    saveColWidths();
                }
            };
            h.addEventListener('pointermove', move);
            h.addEventListener('pointerup', up);
            h.addEventListener('pointercancel', up);
            // 끄는 도중 머리글이 다시 그려지면(onSnapshot) 손잡이가 빠져 pointerup 이 안 온다 — 포인터 잡기가 풀릴 때도 끝낸다
            h.addEventListener('lostpointercapture', up);
        });
        h.addEventListener('dblclick', (e) => {
            e.preventDefault(); e.stopPropagation();
            th.style.width = th.dataset.defw + 'px';
            delete _colWidths[colId];
            saveColWidths();
            syncTableWidth();
        });
    });
}

// ★ 헤더 드래그앤드롭 — th를 끌어다 놓으면 visibleColumns 순서를 바꾸고 저장한다.
let _dragColId = null;
function setupHeaderDragAndDrop() {
    const theadTr = document.getElementById('dynamic-thead-tr');
    if (!theadTr) return;
    const clearMarks = () => theadTr.querySelectorAll('th').forEach(t => t.classList.remove('th-dragging', 'th-drop-left', 'th-drop-right'));

    theadTr.querySelectorAll('th[data-col]').forEach(th => {
        th.addEventListener('dragstart', (e) => {
            _dragColId = th.dataset.col;
            th.classList.add('th-dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', _dragColId); } catch (_) {}
            }
        });
        th.addEventListener('dragend', () => { _dragColId = null; clearMarks(); });
        th.addEventListener('dragover', (e) => {
            if (!_dragColId || th.dataset.col === _dragColId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rect = th.getBoundingClientRect();
            const after = (e.clientX - rect.left) > rect.width / 2;
            th.classList.toggle('th-drop-right', after);
            th.classList.toggle('th-drop-left', !after);
        });
        th.addEventListener('dragleave', () => th.classList.remove('th-drop-left', 'th-drop-right'));
        th.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetCol = th.dataset.col;
            const dragged = _dragColId;
            clearMarks();
            if (!dragged || targetCol === dragged) return;
            const rect = th.getBoundingClientRect();
            const after = (e.clientX - rect.left) > rect.width / 2;
            moveVisibleColumn(dragged, targetCol, after);
        });
    });
}

function moveVisibleColumn(fromCol, toCol, placeAfter) {
    const cols = (window.visibleColumns || []).slice();
    const fromIdx = cols.indexOf(fromCol);
    if (fromIdx === -1) return;
    cols.splice(fromIdx, 1);
    let toIdx = cols.indexOf(toCol);
    if (toIdx === -1) return;
    if (placeAfter) toIdx += 1;
    cols.splice(toIdx, 0, fromCol);

    window.visibleColumns = cols;
    renderTableHeader();
    applyFiltersAndSort();
    saveVisibleColumnOrder(cols);
}

async function saveVisibleColumnOrder(cols) {
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { visibleColumns: cols }, { merge: true });
        showToast('헤더 순서가 저장되었습니다.');
    } catch (e) {
        console.error('헤더 순서 저장 실패:', e);
        showToast('헤더 순서 저장에 실패했습니다.');
    }
}

window.openSettingsModal = (e) => {
    if(e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    const container = document.getElementById('setting-headers-container');
    
    let html = '<div style="display:flex; flex-wrap:wrap; gap:5px;">';
    
    const stdCols = [
        { id: 'std_dong', label: '동' }, { id: 'std_pos', label: '위치' }, { id: 'std_id', label: '로케이션(ID)' }, { id: 'std_category', label: '대분류' },
        { id: 'std_code', label: '상품코드' }, { id: 'std_name', label: '상품명' }, { id: 'std_option', label: '옵션' }, { id: 'std_stock', label: '정상재고' }, { id: 'std_stock2f', label: '비축창고재고' }
    ];
    
    stdCols.forEach(col => {
        const isChecked = window.visibleColumns.includes(col.id) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%;"><input type="checkbox" class="chk-header" value="${col.id}" ${isChecked}> ${col.label}</label>`;
    });
    
    window.excelHeaders.forEach(header => {
        const colId = 'cus_' + header;
        const isChecked = window.visibleColumns.includes(colId) ? 'checked' : '';
        html += `<label style="display:flex; align-items:center; gap:5px; width: 45%; color:var(--c-warn-text,#e65100);"><input type="checkbox" class="chk-header" value="${colId}" ${isChecked}> ${header}</label>`;
    });

    html += `</div>`;
    container.innerHTML = html;
    // 권한으로 숨지 않은 첫 탭을 연다(feature-gate 가 숨긴 탭은 style.display='none')
    const tabs = [...document.querySelectorAll('#settings-modal [data-set-tab]')];
    const first = tabs.find(b => b.style.display !== 'none');
    window.switchLocSettingsTab(first ? first.dataset.setTab : 'columns');
    document.getElementById('settings-modal').style.display = 'flex';
};

// 환경설정 탭 전환 — 보이기/숨기기는 .is-on 클래스로만 한다(권한 가림은 feature-gate 가 inline display 로 따로 하므로 서로 덮지 않게)
window.switchLocSettingsTab = (tab) => {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-set-tab]').forEach(b => b.classList.toggle('active', b.dataset.setTab === tab));
    modal.querySelectorAll('[data-set-pane]').forEach(p => p.classList.toggle('is-on', p.dataset.setPane === tab));
    const save = document.getElementById('btn-save-header-settings');
    if (save) save.classList.toggle('is-off', tab !== 'columns');   // '열 설정 저장'은 화면 열 탭에서만
};
// '추천·채우기' 탭 — 위 switchLocSettingsTab·closeSettingsModal(location.html)을 감싸 저장 안 한 변경을 묻는다. window.saveLocRecSettings 를 만든다
// (location-guard.js 가 이 파일 다음에 감싸므로 여기서 바로 부른다)
initLocSetPanel({ db, auth });

window.saveHeaderSettings = async () => {
    const checkboxes = document.querySelectorAll('.chk-header:checked');
    const checked = Array.from(checkboxes).map(cb => cb.value);
    // ★ 드래그로 정해둔 기존 순서를 보존 — 이미 보이던 컬럼은 현재 순서 유지, 새로 켠 컬럼만 뒤에 추가
    const prev = window.visibleColumns || [];
    const newVisible = [
        ...prev.filter(c => checked.includes(c)),
        ...checked.filter(c => !prev.includes(c))
    ];

    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), {
            visibleColumns: newVisible
        }, { merge: true });

        window.visibleColumns = newVisible;
        document.getElementById('settings-modal').style.display = 'none';
        renderTableHeader(); 
        applyFiltersAndSort(); 
        showToast("화면 헤더 설정이 저장되었습니다.");
    } catch(e) { console.error(e); alert('화면 헤더 설정을 저장하지 못했습니다(인터넷 연결 확인).' + (e?.code ? ` (${e.code})` : '')); }
};

window.openSheetModal = (e) => {
    if (e) e.stopPropagation();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    // 시트 링크 칸은 2026-10-07 비활성 — 저장된 링크(공개 웹게시 주소)를 화면에 채우지 않는다.
    // window.sheetUrlOrder/Buy 는 syncIncomingData 의 예비 경로에서만 쓴다.
    const urlOrder = document.getElementById('modal-sheet-url-order');
    const urlBuy = document.getElementById('modal-sheet-url-buy');
    if (urlOrder) urlOrder.value = '';
    if (urlBuy) urlBuy.value = '';

    const modal = document.getElementById('sheet-modal');
    if (modal) modal.style.display = 'flex';
};

// [3단계] 입고대기 상품용 추천 자리 계산 함수
// 반환값: { case: 'A'|'B', loc: <originalData 원소>, score: number, partnerCount: number } 또는 null
// - Case A: 주문 데이터의 신뢰 페어(count ≥ SERVER_DEFAULTS.pairMinCount, lift ≥ pairMinLift — 서버 설정.json pair 와 같음) 발견 → 페어 위치 점수 최고 빈칸
// - Case B: 신뢰 페어 0개(또는 모든 partner가 시스템에 미배치) → 동선 기준(recommendPriorities) 1순위 빈칸
// - 빈칸 없거나 입력 오류 → null
// [5단계] 두 번째 인자 excludeLocIds (Set): 이 자리 ID들은 빈칸 후보에서 제외 (일괄적용 충돌 처리)
window.calcIncomingRecommend = function(code, excludeLocIds) {
    // 입력/시스템 상태 검증
    if (!code || typeof code !== 'string') return null;
    if (!Array.isArray(originalData) || originalData.length === 0) return null;
    
    // 동선 기준 — 환경설정 '추천·채우기' 탭의 recommendPriorities(변경 추천과 같은 값). 입고 전용 우선순위는 2026-10-27 없앴다(저장돼 있어도 읽지 않는다)
    const priorities = window.recommendPriorities || {
        zones: { 0: [], 1: [], 2: [], 3: [] },
        dongs: [],
        poses: [],
        excludeCombos: []
    };
    
    // 현재 이 code가 이미 배치된 동들 (같은 동 중복 배치 방지용)
    const currentDongsSet = new Set(
        originalData
            .filter(d => d.code === code)
            .map(d => (d.dong || '').toString().trim())
    );
    
    // 빈칸 추출 (선지정 제외 + 같은 동 제외 + 제외 조합 제외 + 일괄적용 시 이미 사용된 자리 제외)
    const excludeCombos = priorities.excludeCombos || [];
    const hasExclude = excludeLocIds && typeof excludeLocIds.has === 'function';
    const emptyLocs = originalData.filter(d => {
        const hasContent = (d.code && d.code !== d.id && String(d.code).trim() !== '')
                        || (d.name && String(d.name).trim() !== '');
        // 점유(상품 배치)·선지정·당일지정·예약된 자리는 추천에서 제외
        if (hasContent || d.preAssigned || d.reserved) return false;
        if (d.codeTag && String(d.codeTag).trim() !== '') return false; // 선지정/당일지정 등 태그된 자리

        // [5단계] 일괄적용 시 이미 다른 카드가 가져간 자리 제외
        if (hasExclude && excludeLocIds.has(d.id)) return false;
        
        const targetDong = (d.dong || '').toString().trim();
        if (currentDongsSet.has(targetDong)) return false;
        
        if (excludeCombos.length > 0) {
            const prefix = (d.id || '').charAt(0).toUpperCase();
            const dong = (d.dong || '').toString().trim();
            const combo = `${prefix}-${dong}`;
            if (excludeCombos.includes(combo)) return false;
        }
        return true;
    });
    
    if (emptyLocs.length === 0) return null;
    
    // Case A 판정: 주문 데이터에서 신뢰 페어 검색
    const trustedPartners = []; // [{ partner, weight }, ...]
    try {
        if (window._cachedOrderPairs && window._cachedOrderStats && window._cachedOrderMeta) {
            const pairs = window._cachedOrderPairs;
            const stats = window._cachedOrderStats;
            const N = window._cachedOrderMeta.totalProcessedOrders || 1;
            
            for (const p of pairs) {
                let partner = null;
                if (p.codeA === code) partner = p.codeB;
                else if (p.codeB === code) partner = p.codeA;
                else continue;
                
                const cA = (stats[p.codeA] || {}).count || 0;
                const cB = (stats[p.codeB] || {}).count || 0;
                if (cA === 0 || cB === 0) continue;
                
                const lift = (p.count * N) / (cA * cB);
                if (p.count < SERVER_DEFAULTS.pairMinCount || lift < SERVER_DEFAULTS.pairMinLift) continue;
                
                trustedPartners.push({ partner, weight: lift * p.count });
            }
        }
    } catch (e) {
        console.warn('[calcIncomingRecommend] 페어 데이터 조회 실패:', e);
    }
    
    // Case A: 신뢰 페어 있음 → 위치 점수로 최고 빈칸 선택
    if (trustedPartners.length > 0) {
        // partner들의 현재 위치 캐시 (중복 조회 방지)
        const partnerLocsCache = {};
        for (const tp of trustedPartners) {
            if (!partnerLocsCache[tp.partner]) {
                partnerLocsCache[tp.partner] = originalData.filter(d => d.code === tp.partner);
            }
        }
        
        let bestEmpty = null;
        let bestScore = -1;
        
        for (const eLoc of emptyLocs) {
            const eZone = (eLoc.id || '').charAt(0).toUpperCase();
            const eDong = (eLoc.dong || '').toString().trim();
            const ePos = (eLoc.pos || '').toString().trim();
            
            let totalScore = 0;
            for (const tp of trustedPartners) {
                const partnerLocs = partnerLocsCache[tp.partner] || [];
                if (partnerLocs.length === 0) continue;
                
                let bestCoeff = 0;
                for (const pLoc of partnerLocs) {
                    const pZone = (pLoc.id || '').charAt(0).toUpperCase();
                    const pDong = (pLoc.dong || '').toString().trim();
                    const pPos = (pLoc.pos || '').toString().trim();
                    
                    let coeff = 0;
                    if (eZone === pZone && eDong === pDong) {
                        const ePosNum = parseInt(ePos, 10);
                        const pPosNum = parseInt(pPos, 10);
                        if (!isNaN(ePosNum) && !isNaN(pPosNum)) {
                            const diff = Math.abs(ePosNum - pPosNum);
                            if (diff === 0) coeff = 1.0;
                            else if (diff === 1) coeff = 0.9;
                            else if (diff === 2) coeff = 0.8;
                            else coeff = 0.7;
                        } else {
                            coeff = 0.7;
                        }
                    }
                    if (coeff > bestCoeff) bestCoeff = coeff;
                }
                totalScore += tp.weight * bestCoeff;
            }
            
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestEmpty = eLoc;
            }
        }
        
        // 점수가 0보다 크면 Case A 결과 반환
        // (점수 0인 경우 = 신뢰 페어는 있으나 partner가 시스템에 미배치 → Case B로 폴백)
        if (bestEmpty && bestScore > 0) {
            return { case: 'A', loc: bestEmpty, score: bestScore, partnerCount: trustedPartners.length };
        }
    }
    
    // Case B: 신뢰 페어 없거나 점수 0 → 우선순위 기반 1순위 빈칸 선택
    const getZoneRank = (locId) => {
        const prefix = (locId || '').charAt(0).toUpperCase();
        const zones = priorities.zones || {};
        for (let i = 0; i <= 3; i++) {
            if (zones[i] && zones[i].includes(prefix)) return i;
        }
        return 99;
    };
    const getDongRank = (dong) => {
        const str = (dong || '').toString().trim();
        const arr = priorities.dongs || [];
        const idx = arr.indexOf(str);
        return idx !== -1 ? idx : 99;
    };
    const getPosRank = (pos) => {
        const str = (pos || '').toString().trim();
        const arr = priorities.poses || [];
        const idx = arr.indexOf(str);
        return idx !== -1 ? idx : 99;
    };
    
    const sortedEmpty = emptyLocs.slice().sort((a, b) => {
        const zA = getZoneRank(a.id), zB = getZoneRank(b.id);
        if (zA !== zB) return zA - zB;
        const dA = getDongRank(a.dong), dB = getDongRank(b.dong);
        if (dA !== dB) return dA - dB;
        const pA = getPosRank(a.pos), pB = getPosRank(b.pos);
        if (pA !== pB) return pA - pB;
        return (a.id || '').localeCompare(b.id || '');
    });
    
    return { case: 'B', loc: sortedEmpty[0], score: 0, partnerCount: 0 };
};

// [5단계] 입고대기 추천 자리 일괄 적용
// - 정렬: 출고예상일 빠른 순 → 같으면 미입고수량 많은 순
// - 충돌 처리: 우선순위 높은 카드가 먼저 자리를 차지, 후순위 카드는 해당 자리를 제외하고 차순위 자리 재계산
// - Firestore 저장 패턴은 기존 단일 선지정과 동일 (preAssigned, preAssignedCode 등)
window.applyAllRecommendations = async function() {
    try {
        // 1) 현재 입고대기 목록 (renderIncomingQueue와 같은 필터 적용)
        const filterSource = document.getElementById('filter-source')?.value || 'all';
        
        const existingLocMap = {};
        originalData.forEach(loc => {
            if (loc.preAssigned && loc.preAssignedCode) existingLocMap[String(loc.preAssignedCode).replace(/\s+/g, '')] = true;
            if (loc.code && loc.code !== loc.id) existingLocMap[String(loc.code).replace(/\s+/g, '')] = true;
        });
        
        const _today = toDateStr();
        
        let list = [];
        for (const code in incomingData) { list.push(incomingData[code]); }
        
        list = list.filter(item => {
            if (filterSource !== 'all' && item.source !== filterSource) return false;
            if (existingLocMap[(item['상품코드'] || item['어드민상품코드'] || item['대표상품코드'] || item['품목코드'] || item['바코드'] || item['상품번호'])]) return false;   // 목록 키와 같은 코드 칸 순서
            if (!item['표시날짜'] || item['표시날짜'].toString().trim() === '') return false;
            const arrivalDate = (item['도착예상일'] || item['표시날짜'] || '').toString().trim();
            if (arrivalDate && arrivalDate < _today) return false;
            return true;
        });
        
        if (list.length === 0) {
            return alert("일괄 적용할 입고대기 상품이 없습니다.");
        }
        
        // 2) 충돌 처리용 정렬: 출고예상일 빠른 순 → 같으면 미입고수량 많은 순
        list.sort((a, b) => {
            const dA = (a['표시날짜'] || '9999-99-99').toString();
            const dB = (b['표시날짜'] || '9999-99-99').toString();
            if (dA !== dB) return dA.localeCompare(dB);
            return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        });
        
        // 3) 각 카드의 추천 자리 계산 (이미 사용된 자리는 제외하고 재계산)
        const usedLocIds = new Set();
        const assignments = [];
        const skipped = [];
        
        for (const item of list) {
            const code = item['상품코드'];
            const rec = window.calcIncomingRecommend(code, usedLocIds);
            if (rec && rec.loc && rec.loc.id) {
                usedLocIds.add(rec.loc.id);
                assignments.push({ item, locId: rec.loc.id, rec });
            } else {
                skipped.push(item);
            }
        }
        
        if (assignments.length === 0) {
            return alert("추천 가능한 자리가 없습니다. (3층 빈칸이 부족할 수 있습니다.)");
        }
        
        // 누가 오늘 재고·도면을 올리는 중이면 확인(기본 취소) — js/busy-banner.js. 0건 검사 뒤에 묻는다
        if (window.__locBusy && !(await window.__locBusy.confirmIfUploading('일괄 수정'))) return;

        // 4) 사용자 확인
        const msg = `추천 자리 일괄 적용\n\n` +
                    `대상: ${assignments.length}개 상품\n` +
                    (skipped.length > 0 ? `추천 불가로 제외: ${skipped.length}개\n` : '') +
                    `\n` + assignments.slice(0, 8).map(({ item, locId }) => `${item['상품코드']} → ${locId}`).join('\n') +
                    (assignments.length > 8 ? `\n… 외 ${assignments.length - 8}건` : '') +
                    `\n\n계속 진행하시겠습니까?`;
        if (!confirm(msg)) return;
        
        // 5) zone 별로 묶어서 Firestore 일괄 저장
        const zoneUpdates = {};
        const now = Date.now();
        for (const { item, locId } of assignments) {
            const zoneDocId = getZoneDocId(locId);
            if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
            zoneUpdates[zoneDocId][locId] = {
                preAssigned: true,
                preAssignedCode: item['상품코드'],
                preAssignedName: item['상품명'] || '',
                preAssignedQty: item['입고대기수량'] || 0,
                preAssignedAt: now,
                code: item['상품코드'],
                name: item['상품명'] || '',
                option: item['옵션'] || '',
                stock: (item['입고대기수량'] || 0).toString(),
                reserved: false, reservedBy: '', reservedAt: 0,
                codeTag: '선지정', codeTagAt: now,
                updatedAt: new Date()
            };
        }
        
        const savePromises = [];
        for (const zoneDocId in zoneUpdates) {
            savePromises.push(setDoc(doc(db, LOC_COLLECTION, zoneDocId), zoneUpdates[zoneDocId], { merge: true }));
        }
        await Promise.all(savePromises);
        showToast(`추천 자리 ${assignments.length}건을 선지정했습니다`);

        // 6) 사이드바 갱신 (적용된 카드는 자동으로 사라짐)
        // ※ Firestore 실시간 리스너가 originalData를 갱신하므로 일반적으로 자동 갱신되나, 명시적 호출로 안정성 확보
        if (typeof window.renderIncomingQueue === 'function') {
            window.renderIncomingQueue();
        }
    } catch (e) {
        console.error('[applyAllRecommendations] 실패:', e);
        alert('일괄 적용 중 오류가 발생했습니다(인터넷 연결 확인). 일부 자리는 저장됐을 수 있으니 목록을 확인하세요.' + (e?.code ? ` (${e.code})` : ''));
    }
};

window.saveSheetUrl = async () => {
    // 2026-10-07 비활성: [시트 동기화]가 수집기 자료(incomingSheet)를 읽는다. 링크를 새로 저장하지 않는다.
    alert('시트 링크 설정은 더 이상 사용하지 않습니다.\n[시트 동기화]는 자동 수집 자료를 가져옵니다.');
    return;
    // eslint-disable-next-line no-unreachable
    const urlOrder = document.getElementById('modal-sheet-url-order').value.trim();
    const urlBuy = document.getElementById('modal-sheet-url-buy').value.trim();
    
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { sheetUrlOrder: urlOrder, sheetUrlBuy: urlBuy }, { merge: true });
        window.sheetUrlOrder = urlOrder;
        window.sheetUrlBuy = urlBuy;
        showToast("구글시트 링크를 저장했습니다.");
        if (typeof window.closeSheetModal === 'function') window.closeSheetModal();
    } catch(e) { console.error("링크 저장 실패:", e); alert('구글시트 링크를 저장하지 못했습니다(인터넷 연결 확인).' + (e?.code ? ` (${e.code})` : '')); }
};

const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

function formatExcelDate(excelDate) {
    if (!excelDate || excelDate.toString().trim() === "") return '';
    if (typeof excelDate === 'string' && (excelDate.includes('-') || excelDate.includes('.'))) return excelDate;
    const num = parseFloat(excelDate);
    if (isNaN(num)) return excelDate;
    const date = new Date(Math.round((num - 25569) * 86400 * 1000));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 입고대기 목록(IncomingData) 저장 + 오더취소 선지정 안내 — 수집기 경로·옛 시트 경로가 함께 쓴다
async function applyIncomingRows(finalJson, cancelledCodes, sourceMsg) {
    if (finalJson.length > 0) {
        await updateDatabaseB(finalJson, 'IncomingData', null, true);
        window.hideLoading();
        showToast(`입고 대기 상품 연동 완료\n${sourceMsg}`);
    } else {
        window.hideLoading();
        alert("입고 대기(수량 1개 이상) 상품이 없거나 데이터를 찾지 못했습니다.");
    }

    // ★ v3.96: 오더취소된 상품 중 선지정된 자리 찾기 → 모달 자동 표시
    if (cancelledCodes.size > 0) {
        const cancelledPreAssigns = originalData.filter(loc =>
            loc.preAssigned === true &&
            loc.preAssignedCode &&
            cancelledCodes.has(loc.preAssignedCode.toString().trim())
        );

        if (cancelledPreAssigns.length > 0) {
            window.showCancelledPreAssignModal(cancelledPreAssigns);
        }
    }
}

// 2026-10-07: 수집기(Apps Script, 업무자동화\앱\미발계산기2\미발수집_apps_script.gs)가 오더리스트·사입리스트에서
// 필요한 열만 읽어 저장해 둔 문서. 아래 옛 경로(syncIncomingData 의 fetchAndParse)와 같은 필드·같은 거르기다
// (2026-10-07 대조: 576행·476코드·9개 항목 전부 일치). 공개 '웹에 게시' 주소를 쓰지 않는다.
const INCOMING_SHEET_PATH = 'artifacts/team-work-logger-v2/integrations/incomingSheet';
// [시트 동기화] 전용 요청 — 수집기가 시트만 읽어 입고예정(incomingSheet)만 쓴다(이지어드민 0회, 2026-10-26).
//   미발 [지금 갱신] 의 mibal2/refreshRequest 와 따로 둔다(미발 숫자·하루 8회 한도와 무관).
const INCOMING_REQUEST_PATH = 'artifacts/team-work-logger-v2/mibal2/incomingRequest';
// 기다림 최대(10분)·새 자료 판정·진행 중 표시는 js/lib/incoming-wait.js

/** 수집기 자료를 읽는다. 쓸 수 없으면 null(→ 옛 경로) */
async function loadIncomingFromCollector() {
    try {
        const snap = await getDoc(doc(db, INCOMING_SHEET_PATH));
        if (!snap.exists()) return null;
        const d = snap.data() || {};
        if (d.ok === false || typeof d.rowsJson !== 'string') return null;
        const rows = JSON.parse(d.rowsJson);
        if (!Array.isArray(rows)) return null;
        const at = tsMillis(d.updatedAt);
        const cancelled = new Set((Array.isArray(d.cancelledCodes) ? d.cancelledCodes : []).map(c => String(c).trim()).filter(Boolean));
        // reqHandledAt·reqNote: 수집기가 마지막 [시트 동기화] 요청을 처리한 때와 결과('' 이면 읽음, 아니면 거절·실패 이유)
        // sheetReadAtMs: 이 자료가 시트 읽기를 시작한 때(ms, 수집기 2026-10-26 이후) — 없으면 0(→ updatedAt 으로 본다)
        return { rows, cancelled, at, sheetReadAtMs: typeof d.sheetReadAtMs === 'number' ? d.sheetReadAtMs : 0,
            reqHandledAt: tsMillis(d.reqHandledAt), reqNote: typeof d.reqNote === 'string' ? d.reqNote : '' };
    } catch (e) {
        console.warn('[입고예정] 수집기 자료 읽기 실패 — 옛 시트 경로로:', e && (e.code || e.message));
        return null;
    }
}

const tsMillis = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
const fmtHM = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 수집기 자료를 입고대기 목록에 반영 */
async function applyCollectorRows(col, extraMsg) {
    window.showLoading("시트 자료를 반영하는 중입니다...");
    try {
        const c = { '제작': 0, '사입': 0 };
        col.rows.forEach(r => { if (c[r.source] !== undefined) c[r.source]++; });
        const sheetAt = incomingReadAt(col);   // 시트 읽기를 시작한 때(없으면 저장 시각) — 저장 시각은 전체 수집이면 4~6분 뒤라 쓰지 않는다
        await applyIncomingRows(col.rows, col.cancelled,
            `(제작 ${c['제작']}건, 사입 ${c['사입']}건 · 시트 기준 ${sheetAt ? fmtHM(sheetAt) : '시각 모름'})` + (extraMsg ? `\n\n${extraMsg}` : ''));
        // 목록이 몇 시 시트 자료인지 남긴다(다른 PC 패널에도 보이게) — 실패해도 목록 반영은 이미 끝났다
        if (sheetAt) {
            try { await setDoc(doc(db, 'IncomingData', INCOMING_META_ID), { sheetAt, appliedAt: serverTimestamp() }); }
            catch (e) { console.warn('[입고예정] 기준 시각 기록 실패:', e && (e.code || e.message)); }
        }
    } catch (error) {
        window.hideLoading();
        alert(`반영 실패!\n(${error.message})`);
        console.error("입고예정 반영 실패:", error);
    }
}

// ── 새로 읽기를 기다리는 동안의 상태(패널 버튼 아래 한 줄) ──
// incomingGuard: [시트 동기화]를 누른 순간(첫 await 전)부터 반영이 끝날 때까지 다시 누르지 못하게 한다.
//   기다리기에 들어가면 그 기다림의 finish 가 내린다(finish 는 한 번만 돈다 — 타이머·구독은 자기 것만 끈다).
const incomingGuard = createRunGuard();
let incomingWait = null;   // 지금 기다리는 것 { col, finish(kind, msg) } — 패널의 [지금 자료로 반영] 버튼이 쓴다
function setSyncStatus(html) {
    const el = document.getElementById('incoming-sync-status');
    if (!el) return;
    el.style.display = html ? 'block' : 'none';
    el.innerHTML = html || '';
}
/** 기다리지 않고 지금 있는 자료로 반영 */
window.applyIncomingNow = async () => {
    if (incomingWait) await incomingWait.finish('latest', '새로 읽기를 기다리지 않고 반영했습니다.');
};

// ── 입고대기 목록 기준 시각 표시(2026-10-26) ──
//   목록(IncomingData)이 몇 시 시트 자료인지 + 수집기 최신 자료 시각 + 언제 [시트 동기화]가 시트를 새로 읽는지.
//   새로 읽기 규칙은 syncIncomingData 와 같다: 누르면 늘 시트를 새로 읽는다(월~토 07~19시, 하루 SHEET_REQ_DAILY_MAX 회).
//   07~19시 판정은 표시용이라 브라우저 시계로 한다.
const INCOMING_META_ID = '_meta';   // IncomingData/_meta {sheetAt(ms), appliedAt} — [시트 동기화]가 반영할 때 쓴다(dataStr 이 없어 목록 읽기에서 무시됨)
let incomingListMeta = { sheetAt: 0, appliedAt: 0 };
let incomingCollectorSheetReadAt = 0, incomingCollectorReadAt = 0, incomingBasisTimer = null;   // 수집기 최신 자료의 시트 읽기 시작(ms) · 그걸 읽은 때
window.paintIncomingBasis = async (open) => {
    const el = document.getElementById('incoming-basis');
    const sidebar = document.getElementById('incoming-sidebar');
    if (!el || !sidebar) return;
    const isOpen = open === undefined ? sidebar.classList.contains('open') : open;
    if (!isOpen) { clearInterval(incomingBasisTimer); incomingBasisTimer = null; return; }
    if (!incomingBasisTimer) incomingBasisTimer = setInterval(() => window.paintIncomingBasis(), 60 * 1000);
    // 수집기 최신 시각은 1분에 한 번만 읽는다(문서가 크다)
    if (Date.now() - incomingCollectorReadAt > 60 * 1000) {
        incomingCollectorReadAt = Date.now();
        const col = await loadIncomingFromCollector();
        if (col) incomingCollectorSheetReadAt = incomingReadAt(col);
    }
    const m = incomingListMeta, now = new Date();
    const hm = (ms) => fmtHM(ms).split(' ')[1];
    const list = m.sheetAt ? `시트 <b>${fmtHM(m.sheetAt)}</b> 자료` + (m.appliedAt ? ` (목록 반영 ${hm(m.appliedAt)})` : '')
        : (m.appliedAt ? `목록 반영 <b>${fmtHM(m.appliedAt)}</b>` : '기록 없음');
    let line2 = '';
    const awake = now.getDay() !== 0 && now.getHours() >= 7 && now.getHours() < 19;
    // m.sheetAt 은 2026-10-26 리뷰 전엔 저장 시각(updatedAt)이었다 — 읽기 시작보다 늦으므로 옛 기록이어도 '더 새 자료'로 잘못 뜨지 않는다
    const newer = incomingCollectorSheetReadAt && (!m.sheetAt || incomingCollectorSheetReadAt > m.sheetAt + 60 * 1000);
    if (!awake) {
        line2 = (newer ? `<span class="ib-new">시트에 더 새 자료(${fmtHM(incomingCollectorSheetReadAt)})가 있습니다 — [시트 동기화]를 누르면 반영됩니다</span><br>` : '') +
            `새로 읽기: 월~토 07~19시에만, 하루 ${SHEET_REQ_DAILY_MAX}회(매일 07:30 자동으로 새로 읽음)`;
    } else {
        line2 = (newer ? `<span class="ib-new">시트에 더 새 자료(${fmtHM(incomingCollectorSheetReadAt)})가 있습니다</span><br>` : '') +
            `새로 읽기: 지금 [시트 동기화]를 누르면 1~2분(월~토 07~19시, 하루 ${SHEET_REQ_DAILY_MAX}회)`;
    }
    el.innerHTML = `목록 기준: ${list}` + (line2 ? `<br>${line2}` : '');
};

/**
 * [시트 동기화] — 버튼 하나로(2026-10-26 리뷰: 바로 반영·같이 기다리기 없앰 — '눌렀는데 바로 끝나고 옛 기준' 을 막는다):
 *   · 누를 때마다 수집기에 '시트만 새로 읽기' 요청(mibal2/incomingRequest.requestedAt = 서버 시각 — 미발 [지금 갱신]과 따로)
 *     → 내 요청 뒤에 읽기 시작한 자료가 써지면 자동 반영(패널에 진행 표시, 기다리지 않고 반영하는 버튼도 있음)
 *     수집기는 마지막 requestedAt 하나만 보므로 처리 전에 여러 사람이 눌러도 한 번 읽기로 합쳐진다.
 *   · 수집기가 쉬는 시간(일요일·07시 전·19시 이후)이면 요청하지 않고 있던 자료로 반영하고 이유를 알린다
 *   · 요청이 거절(하루 한도 등)·저장 실패되면 있던 자료로 반영하고 이유를 알린다
 *   · 10분 안에 새로 읽지 못하면 목록은 그대로 두고 알린다(원하면 그때 있는 자료로 반영)
 * 요청 시각: 쓴 requestedAt 을 다시 읽어 얻는다(두 번까지). 새 자료 = incomingSheet.sheetReadAtMs ≥ 내 요청 서버 시각
 *   — 판정은 js/lib/incoming-wait.js(judgeIncomingSnap).
 * 수집기 규칙(업무자동화\앱\미발계산기2\미발수집_apps_script.gs 요청확인·maybeSheetOnly_): 1분마다 확인 · 월~토 07~19시 ·
 * 이지어드민은 안 부른다 · 마지막 시트 읽기 시작 1분 안이면 다음 확인 때 · 하루 20회. 결과는 incomingSheet 의
 * sheetReadAtMs·updatedAt(읽음)·reqHandledAt + reqNote(거절·실패 이유)로 알려 준다. 전체 수집이 돌고 있으면 그 뒤에 처리한다.
 * 진행 중 표시(incomingGuard)는 첫 await 전에 세운다 — 빨리 두 번 눌러도 요청·기다림은 하나다.
 */
window.syncIncomingData = async () => {
    // syncIncomingRun 이 기다리기에 들어가면(true) 진행 중 표시는 그 기다림의 finish 가 내린다
    await guardedRun(incomingGuard, syncIncomingRun,
        () => alert('지금 시트를 새로 읽는 중입니다. 끝나면 자동으로 반영됩니다.\n(기다리지 않으려면 패널의 [지금 자료로 반영]을 누르세요)'));
};

/**
 * 기다리기 — 입고예정 문서가 내 요청 뒤에 읽은 자료로 써지면 자동 반영. 타이머·구독은 지역 변수라 이 기다림 것만 끈다.
 * 구독을 타이머보다 먼저 건다 — 거는 중 예외가 나면 stop() 하고 다시 던진다(guardedRun 이 진행 중 표시를 내린다).
 * 진행 중 표시는 이 기다림을 세운 begin 번호(guardSeq)일 때만 내린다.
 */
function startIncomingWait(col, reqMs, baseHandledAt) {
    const startMs = Date.now();
    const guardSeq = incomingGuard.seq;
    let timer = null, unsub = null, stopped = false;
    const session = { col };
    const stop = () => {
        stopped = true;
        clearInterval(timer);
        if (unsub) { try { unsub(); } catch (e) { /* 이미 해제 */ } }
        if (incomingWait === session) { incomingWait = null; setSyncStatus(''); }
    };
    // kind: 'latest'(지금 수집기 자료 다시 읽어 반영) · 'keep'(기다리기 전 자료로 반영) · 'timeout'(반영 안 함, 물어보고)
    session.finish = once(async (kind, msg) => {
        stop();
        try {
            if (kind === 'timeout') {
                if (!confirm(`${msg}\n\n지금 있는 자료로라도 반영하려면 [확인]을 누르세요.`)) return;
                msg = '새로 읽기를 기다리지 못해 지금 있는 자료로 반영했습니다.';
            }
            const c2 = kind === 'keep' ? col : ((await loadIncomingFromCollector()) || col);
            await applyCollectorRows(c2, msg);
        } finally { incomingGuard.endIf(guardSeq); }
    });
    const render = () => {
        const s = Math.floor((Date.now() - startMs) / 1000);
        if (Date.now() - startMs > INCOMING_WAIT_MAX_MS) { session.finish('timeout', waitTimeoutText(INCOMING_WAIT_MAX_MS / 60000, Date.now())); return; }
        setSyncStatus(`⏳ 시트를 새로 읽는 중… <b>${Math.floor(s / 60)}분 ${s % 60}초</b> 경과 (보통 1~2분) — 끝나면 자동으로 반영됩니다.<br>` +
            `<button type="button" onclick="applyIncomingNow()" style="margin-top:4px; padding:3px 8px; font-size:11px; border:1px solid var(--c-line-strong,#bbb); border-radius:4px; background:var(--c-surface,#fff); cursor:pointer;">기다리지 않고 지금 자료(${fmtHM(incomingReadAt(col))} 기준)로 반영</button>`);
    };
    try {
        incomingWait = session;
        unsub = onSnapshot(doc(db, INCOMING_SHEET_PATH), snap => {
            const d = snap.data() || {};
            // 내 요청 뒤에 시트 읽기를 '시작'한 자료만 새 자료(요청 전에 읽기 시작한 전체 수집의 갱신은 무시하고 계속 기다림)
            // reqForMs: 그 처리·거절이 어느 요청의 것인지(수집기 새 코드) — 남의 앞 요청 실패를 내 거절로 보지 않게
            const v = judgeIncomingSnap({
                updatedAt: tsMillis(d.updatedAt), sheetReadAtMs: d.sheetReadAtMs, ok: d.ok,
                reqHandledAt: tsMillis(d.reqHandledAt), reqNote: typeof d.reqNote === 'string' ? d.reqNote : '', reqForMs: d.reqForMs
            }, { reqMs, baseAt: col.at, baseHandledAt });
            if (v === 'done') session.finish('latest', '');
            else if (v === 'saveFailed') session.finish('keep', '시트를 새로 읽었지만 입고예정 자료를 저장하지 못해(크기 초과 등) 이 기준 자료로 반영했습니다.');
            else if (v === 'rejected') {
                // 거절(하루 한도·이상한 요청 시각)·실패 — 목록 자료는 그대로이므로 지금 있는 자료로
                session.finish('latest', `새로 읽기 요청이 처리되지 않았습니다: ${d.reqNote}\n그래서 지금 있는 자료로 반영했습니다.`);
            }
        }, () => { /* 읽기 오류는 시간초과로 처리 */ });
        render();
        if (!stopped) timer = setInterval(render, 1000);
    } catch (e) {
        stop();
        throw e;
    }
}

/** [시트 동기화] 본체. 기다리기에 들어갔으면 true(진행 중 표시는 그 기다림이 내린다), 끝났으면 그 밖의 값. */
async function syncIncomingRun() {
    // 1순위: 수집기 자료
    const col = await loadIncomingFromCollector();
    if (col) {
        const now = new Date();
        const collectorAwake = now.getDay() !== 0 && now.getHours() >= 7 && now.getHours() < 19;
        if (!collectorAwake) {
            // 쉬는 시간엔 요청하지 않는다
            await applyCollectorRows(col, '※ 지금은 시트를 새로 읽는 시간이 아니라(월~토 07~19시) 이 기준 자료로 반영했습니다. 매일 07:30 자동으로 새로 읽습니다.');
            return false;
        }

        // 늘 새로 요청한다 — 처리 안 된 요청이 있어도 수집기는 마지막 requestedAt 하나만 보므로 한 번으로 합쳐진다
        const reqRef = doc(db, INCOMING_REQUEST_PATH);
        const baseHandledAt = col.reqHandledAt || 0;
        try { await setDoc(reqRef, { requestedAt: serverTimestamp() }, { merge: true }); }
        catch (e) {
            await applyCollectorRows(col, `새로 읽기를 요청하지 못해(${e.code || e.message}) 이 기준 자료로 반영했습니다.`);
            return false;
        }
        // 내 요청의 서버 시각 — 다시 읽어 얻는다(실패하면 한 번 더). 그래도 못 얻으면 브라우저 시각 − 1분(requestServerMs 주석)
        //   그 사이 다른 직원이 또 눌렀으면 그 사람 시각(더 늦음)을 읽게 되는데, 그 요청을 채운 읽기는 내 요청도 채우므로 괜찮다.
        let back = 0;
        for (let i = 0; i < 2 && !back; i++) {
            try { const r2 = await getDoc(reqRef); back = r2.exists() ? tsMillis(r2.data().requestedAt) : 0; }
            catch (e) { /* 한 번 더 */ }
        }
        if (!back) console.warn('[입고예정] 요청 서버 시각을 읽지 못해 브라우저 시각 − 1분으로 기다립니다');
        startIncomingWait(col, requestServerMs(back, Date.now()), baseHandledAt);
        return true;
    }

    // 2순위(전환 기간만): 옛 경로 — '웹에 게시' 시트를 직접 받는다. 시트 웹게시를 끄면 이 경로는 실패한다.
    if (!window.sheetUrlOrder && !window.sheetUrlBuy) return alert("시트 자료를 읽지 못했습니다.\n(수집기 자료가 없고, 예전 시트 링크도 설정되어 있지 않습니다)");
    window.showLoading("원본 시트에서 데이터를 분석하여 가져오는 중입니다...");
    
    try {
        let combinedData = [];

        const fetchAndParse = async (url, sourceName) => {
            if (!url) return [];
            // 외부 프록시(allorigins·corsproxy) 우회는 쓰지 않는다 — 시트에 단가가 있어 제3자 서버를 거치면 안 됨
            let textData = "";
            try {
                const res1 = await fetch(url);
                if (!res1.ok) throw new Error(`HTTP ${res1.status}`);
                textData = await res1.text();
            } catch (e1) {
                throw new Error(`자동 수집 자료를 읽지 못했고, 예비 경로(${sourceName} 시트 직접)도 실패했습니다 (${e1.message}). 관리자에게 알려 주세요.`);
            }

            const workbook = XLSX.read(textData, { type: 'string' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
            
            let headerRowIndex = -1;
            let pureHeaders = [];
            
            for (let i = 0; i < Math.min(20, rawData.length); i++) {
                const row = rawData[i];
                const cleanRow = row.map(h => cleanKey(h));
                if (cleanRow.includes('어드민상품코드') || cleanRow.includes('상품코드')) {
                    headerRowIndex = i;
                    pureHeaders = cleanRow; 
                    break;
                }
            }

            if (headerRowIndex === -1) return []; 

            const parsedList = [];
            for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                let rowObj = {};
                let isEmpty = true;
                for (let j = 0; j < pureHeaders.length; j++) {
                    const key = pureHeaders[j];
                    if (key) {
                        rowObj[key] = rawData[i][j];
                        if (rawData[i][j] !== "" && rawData[i][j] !== undefined) isEmpty = false;
                    }
                }
                if (!isEmpty) {
                    rowObj.source = sourceName; 
                    parsedList.push(rowObj);
                }
            }
            return parsedList;
        };

        const [orderData, buyData] = await Promise.all([
            fetchAndParse(window.sheetUrlOrder, '제작'),
            fetchAndParse(window.sheetUrlBuy, '사입')
        ]);

        combinedData = [...orderData, ...buyData];

        // ★ v3.96: '오더취소' 상품코드 수집
        const cancelledCodes = new Set();
        combinedData.forEach(row => {
            const status = (row['상태'] || '').toString().trim();
            if (status === '오더취소') {
                const code = (row['어드민상품코드'] || row['상품코드'] || '').toString().trim();
                if (code) cancelledCodes.add(code);
            }
        });

        const finalJson = combinedData.map(row => {
            let code = row['어드민상품코드'] || row['상품코드'] || '';
            let name = row['상품명'] || row['공급처상품명'] || '';
            
            let rawQty = row['총미입고수량본사입고기준'];
            if (rawQty === undefined || rawQty === "") rawQty = row['최종미입고수량추가입고예정'];
            if (rawQty === undefined || rawQty === "") rawQty = row['미입고수량'];
            let qty = Number(rawQty) || 0;
            
            let rawDate = "";
            let rawFactoryDate = "";
            let rawArrivalDate = "";
            if (row.source === '제작') {
                rawFactoryDate = row['공장출고예상일'] || '';
                rawDate = rawFactoryDate;
            } else if (row.source === '사입') {
                // 검수창고도착일이 비면(오더 직후) 출고예상일로 대신한다 — 미발 수집기(gs buildIncoming_)와 같은 규칙(2026-10-26)
                rawArrivalDate = row['검수창고도착일'] || row['출고예상일'] || '';
                rawDate = rawArrivalDate;
            }
            
            let date = formatExcelDate(rawDate);

            return {
                '상품코드': code,
                '상품명': name,
                '옵션': row['옵션'] || '',
                '입고대기수량': qty,
                '공장출고예상일': row.source === '제작' ? formatExcelDate(rawFactoryDate) : '',
                '검수창고도착일': row.source === '사입' ? formatExcelDate(rawArrivalDate) : '',
                '도착예상일': formatExcelDate(row['도착예상일'] || ''),
                '표시날짜': date,
                'source': row.source || '기타',
                '상태': (row['상태'] || '').toString().trim()
            };
        }).filter(row => 
            row['상품코드'] && row['상품코드'].toString().trim() !== '' && 
            Number(row['입고대기수량']) > 0 && 
            row['표시날짜'] && row['표시날짜'].toString().trim() !== '' &&
            row['상태'] !== '오더취소'  // ★ v3.96: 오더취소 상품은 IncomingData에서 제외
        );

        await applyIncomingRows(finalJson, cancelledCodes, `(오더리스트 ${orderData.length}건, 사입리스트 ${buyData.length}건 · 웹게시 시트에서 직접)`);
    } catch (error) {
        window.hideLoading(); 
        alert(`연결 실패!\n데이터를 가져오지 못했습니다.\n(${error.message})`); 
        console.error("데이터 동기화 실패:", error);
    }
}

// ★ v3.96: 오더취소 선지정 모달 표시
window.showCancelledPreAssignModal = function(items) {
    if (!items || items.length === 0) return;
    
    // 전역 변수로 보관 (해제 함수에서 참조)
    window._cancelledPreAssignItems = items;
    
    const tbody = document.getElementById('cancelled-preassign-tbody');
    if (!tbody) return;
    
    let html = '';
    items.forEach((loc, idx) => {
        const rowBg = idx % 2 === 0 ? 'var(--c-surface)' : 'var(--c-risk-row)';
        const code = loc.preAssignedCode || '';
        const name = loc.preAssignedName || '';
        const option = loc.option || '';
        const source = loc.preAssignedSource || '-';
        
        html += `
            <tr style="background:${rowBg};">
                <td style="font-weight:600; color:var(--c-risk-text);">${idx + 1}</td>
                <td style="font-weight:600; color:var(--c-text); font-size:14px;">${loc.id}</td>
                <td style="font-weight:600; color:var(--c-accent-deep);">${code}</td>
                <td style="text-align:left; font-size:13px;">${name}</td>
                <td style="font-size:12px;">${option}</td>
                <td style="font-size:11px; color:var(--c-text-2);">${source}</td>
                <td style="background:var(--c-risk-row);">
                    <button class="btn btn-risk btn-sm" onclick="window.releasePreAssign('${loc.id}')" style="height:28px; padding:0 12px; font-size:11px;">해제</button>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
    document.getElementById('cancelled-preassign-modal').style.display = 'flex';
};

// ★ v3.96: 개별 선지정 해제
window.releasePreAssign = async function(locId) {
    if (!locId) return;
    if (!confirm(`[${locId}] 자리의 선지정을 해제하시겠습니까?`)) return;
    
    try {
        const zoneDocId = getZoneDocId(locId);
        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
            [locId]: {
                preAssigned: false,
                preAssignedCode: '',
                preAssignedName: '',
                preAssignedQty: '',
                preAssignedAt: 0,
                codeTag: '',
                codeTagAt: 0,
                code: '',
                name: '',
                option: '',
                stock: '0',
                updatedAt: new Date()
            }
        }, { merge: true });
        
        showToast(`[${locId}] 선지정 해제 완료`);
        
        // 모달의 해당 행 제거
        if (window._cancelledPreAssignItems) {
            window._cancelledPreAssignItems = window._cancelledPreAssignItems.filter(item => item.id !== locId);
            
            // 모두 해제됐으면 모달 닫기
            if (window._cancelledPreAssignItems.length === 0) {
                document.getElementById('cancelled-preassign-modal').style.display = 'none';
                showToast(`모든 취소된 선지정 자리가 해제되었습니다.`);
            } else {
                // 남은 항목으로 모달 다시 그리기
                window.showCancelledPreAssignModal(window._cancelledPreAssignItems);
            }
        }
    } catch (e) {
        console.error("선지정 해제 오류:", e);
        alert("선지정 해제 중 오류가 발생했습니다.");
    }
};

// ★ v3.96: 일괄 선지정 해제
window.releaseAllCancelledPreAssigns = async function() {
    const items = window._cancelledPreAssignItems || [];
    if (items.length === 0) return;
    if (window.__locBusy && !(await window.__locBusy.confirmIfUploading('일괄 수정'))) return;   // 업로드 중 확인
    if (!confirm(`총 ${items.length}건의 선지정을 모두 해제하시겠습니까?\n\n해제된 자리는 다시 빈 자리로 돌아갑니다.`)) return;
    
    window.showLoading(`${items.length}건의 선지정을 일괄 해제 중...`);
    
    try {
        let batch = writeBatch(db);
        let batchCount = 0;
        
        for (const loc of items) {
            const zoneDocId = getZoneDocId(loc.id);
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), {
                [loc.id]: {
                    preAssigned: false,
                    preAssignedCode: '',
                    preAssignedName: '',
                    preAssignedQty: '',
                    preAssignedAt: 0,
                    codeTag: '',
                    codeTagAt: 0,
                    code: '',
                    name: '',
                    option: '',
                    stock: '0',
                    updatedAt: new Date()
                }
            }, { merge: true });
            batchCount++;
            
            // 400개마다 커밋
            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }
        
        if (batchCount > 0) await batch.commit();
        
        window.hideLoading();
        document.getElementById('cancelled-preassign-modal').style.display = 'none';
        window._cancelledPreAssignItems = [];
        showToast(`선지정 ${items.length}건을 일괄 해제했습니다.`);
    } catch (e) {
        window.hideLoading();
        console.error("일괄 해제 오류:", e);
        alert("일괄 해제 중 오류가 발생했습니다.");
    }
};

window.saveCapacity2F = async function() {
    const input = document.getElementById('input-cap-2f');
    if (!input) return;
    const newVal = parseInt(input.value.replace(/,/g, ''), 10);
    if (isNaN(newVal) || newVal <= 0) return alert("올바른 수량을 입력해주세요.");
    try {
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { capacity2F: newVal }, { merge: true });
        window.capacity2F = newVal;
        window.calculateAndRenderUsage();
        showToast(`2층 기준 수량을 ${newVal.toLocaleString()}장으로 바꿨습니다.`);
    } catch(e) { console.error(e); alert("오류가 발생했습니다."); }
};

window.switchUsageTab = function(tab) { window.currentUsageTab = tab; window.calculateAndRenderUsage(); };

// 대시보드 KPI 카드 → 데이터 리스트 뷰로 전환 + 해당 상태 필터 적용 (작업 가능 화면으로 바로 연결)
window.__dashGoToList = function(state, pickingOnly) {
    filters = { loc: [], code: [], stock: [], stock2f: [], category: [], dong: [], pos: [], reserved: [], preassigned: [] };
    if (state === 'used') filters.code = ['not-empty'];
    else if (state === 'empty') filters.code = ['empty'];
    else if (state === 'reserved') filters.reserved = ['only'];
    else if (state === 'preassigned') filters.preassigned = ['only'];
    if (pickingOnly) filters.pickingOnly = true; // 피킹용(기타·비축·SAM 제외)만
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    // 3개 뷰 중 '데이터 리스트'로 전환 (대시보드/도면 숨김 + 탭 활성화)
    const vList = document.getElementById('view-list');
    const vMap = document.getElementById('view-map');
    const vDash = document.getElementById('view-locdash');
    if (vList) vList.style.display = 'block';
    if (vMap) vMap.style.display = 'none';
    if (vDash) vDash.style.display = 'none';
    // 데이터 리스트 탭 켜짐 + 보던 탭 기억(UI 1단계 1c) — location.html markLocTab
    if (typeof window.markLocTab === 'function') window.markLocTab('list'); else writeHash({ tab: 'list' }, { replace: true });
    if (typeof window.showFilterResetBtn === 'function') window.showFilterResetBtn();
    if (vList && vList.scrollIntoView) vList.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.applyUsageFilter = function(zone, state) {
    // ★ v3.57: 모든 필터 배열 초기화
    filters = { loc: [], code: [], stock: [], stock2f: [], category: [], dong: [], pos: [], reserved: [], preassigned: [] };
    if (zone !== 'all') filters.loc = [zone];
    if (state === 'used') filters.code = ['not-empty'];
    else if (state === 'empty') filters.code = ['empty'];
    else if (state === 'reserved') filters.reserved = ['only'];
    else if (state === 'preassigned') filters.preassigned = ['only'];
    setupFilterPopups();
    applyFiltersAndSort();
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    // 데이터 리스트 탭으로 — 탭 버튼과 같은 길(location.html switchView: 리스트만 보이고 대시보드·도면 숨김 + markLocTab 켜짐·해시).
    // 예전엔 리스트만 켜고 대시보드(#view-locdash)를 숨기지 않아 두 화면이 겹쳤다.
    if (typeof window.switchView === 'function') window.switchView('list');
    else {
        document.getElementById('view-list').style.display = 'block';
        document.getElementById('view-map').style.display = 'none';
        const vDash = document.getElementById('view-locdash');
        if (vDash) vDash.style.display = 'none';
        if (typeof window.markLocTab === 'function') window.markLocTab('list'); else writeHash({ tab: 'list' }, { replace: true });
    }
    window.showFilterResetBtn();
};

window.calculateAndRenderUsage = function() {
    const popup = document.getElementById('usage-popup');
    if (!popup) return;
    let html = `<div style="display:flex; gap:10px; margin-bottom: 15px; border-bottom: 2px solid var(--c-line,#eee); padding-bottom: 10px;"><button onclick="switchUsageTab('3F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '3F' ? 'var(--primary)' : 'var(--c-track,#eee)'}; color:${window.currentUsageTab === '3F' ? 'var(--c-on-fill,white)' : 'var(--c-text-2,#555)'}">3층 로케이션</button><button onclick="switchUsageTab('2F')" style="flex:1; padding:8px; font-weight:bold; border:none; border-radius:5px; cursor:pointer; background:${window.currentUsageTab === '2F' ? 'var(--primary)' : 'var(--c-track,#eee)'}; color:${window.currentUsageTab === '2F' ? 'var(--c-on-fill,white)' : 'var(--c-text-2,#555)'}">2층 창고재고</button></div>`;

    if (window.currentUsageTab === '3F') {
        // 랙 사용률 통계이므로 '기타'(비축/샘플 등, 실제 피킹 랙이 아님) 위치는 제외
        const locations = originalData.filter(d => d.id.charAt(0).toUpperCase() !== 'K' && (d.category || '피킹용') !== '기타');
        let total = locations.length;
        if (total === 0) { popup.innerHTML = html + '<div style="padding: 10px;">데이터가 없습니다.</div>'; return; }
        
        let used = 0; 
        let zoneStats = {};
        let dongStats = {};
        let posStats = {};
        let todayReservedCount = 0;
        let preAssignedCount = 0; 
        
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        locations.forEach(loc => {
            const isUsed = (loc.code && loc.code.trim() !== '' && loc.code !== loc.id) || (loc.name && loc.name.trim() !== '');
            if (isUsed) used++;
            if (loc.codeTag === '당일지정') todayReservedCount++;
            if (loc.codeTag === '선지정') preAssignedCount++;
            
            const zone = loc.id.charAt(0).toUpperCase();
            if (!zoneStats[zone]) { zoneStats[zone] = { total: 0, used: 0 }; }
            zoneStats[zone].total++;
            if (isUsed) zoneStats[zone].used++;
            
            const dong = (loc.dong || '').toString().trim();
            if (dong) {
                if (!dongStats[dong]) dongStats[dong] = { total: 0, used: 0 };
                dongStats[dong].total++;
                if (isUsed) dongStats[dong].used++;
            }
            
            const pos = (loc.pos || '').toString().trim();
            if (pos) {
                if (!posStats[pos]) posStats[pos] = { total: 0, used: 0 };
                posStats[pos].total++;
                if (isUsed) posStats[pos].used++;
            }
        });

        const usageRate = ((used / total) * 100).toFixed(1);
        
        html += `
            <div style="display:flex; justify-content: space-around; background: var(--c-accent-soft,#eef1ff); padding: 10px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--c-accent-light,#c5cae9);">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2,#555); font-weight:bold;">당일지정수량<span class="info-tip" data-tip-key="usage-today-reserved">i<span class="info-tip-content"><b>오늘 작업 중 예약된 자리</b><br>로케이션 셀을 클릭하면 현재 작업자가 예약(복사+잠금)한 상태가 됩니다.<br><br>자정에 자동으로 초기화됩니다.</span></span></div>
                    <div style="font-size:18px; color:var(--primary); font-weight:900;">${todayReservedCount}</div>
                </div>
                <div style="width:1px; background:var(--c-line-strong,#ccc);"></div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2,#555); font-weight:bold;">선지정수량<span class="info-tip" data-tip-key="usage-pre-assigned">i<span class="info-tip-content"><b>입고 전에 미리 찜해둔 자리</b><br>입고대기 사이드바에서 상품을 클릭하고 빈 자리를 지정하면 선지정됩니다.<br><br>로케이션 변경 추천에서 보호(제외)되며, 자정에 초기화되지 않습니다.</span></span></div>
                    <div style="font-size:18px; color:var(--c-warn-text,#e65100); font-weight:900;">${preAssignedCount}</div>
                </div>
            </div>
            <div style="font-size:16px; font-weight:bold; margin-bottom:5px; color:var(--primary); text-align:center;">3층 전체 사용률: ${usageRate}%</div>
            <div style="font-size:12px; color:var(--c-text,#333); text-align:center;">전체 ${total}칸 중 <span style="color:var(--primary); font-weight:bold;">${used}칸 사용</span> / <span style="color:var(--c-risk-text,#ff5252); font-weight:bold;">${total - used}칸 빈칸</span></div>
            <div style="text-align:center; margin-top:10px;">
                <span onclick="toggleUsageDetails()" id="usage-details-btn" style="color:var(--primary); font-size:13px; text-decoration:underline; cursor:pointer; font-weight:bold;">자세히보기 ▼</span>
            </div>
        `;
        
        let detailHtml = `<div id="usage-details-content" style="display:none; margin-top:15px; border-top:1px solid var(--c-line,#eee); padding-top:15px;">`;
        detailHtml += `<div style="font-size:11px; color:var(--c-text-3,#888); text-align:center; margin-bottom:10px;">※ 숫자를 클릭하면 리스트에 해당 내용만 보입니다.</div>`;
        
        detailHtml += `<div onclick="document.getElementById('sec-zone-detail').style.display = document.getElementById('sec-zone-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-zone-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 구역별 사용률</div>`;
        detailHtml += `<div id="sec-zone-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>구역명</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const zones = Object.keys(zoneStats).sort((a,b) => (a==='★'?-1:(b==='★'?1:a.localeCompare(b))));
        zones.forEach(z => {
            const zTotal = zoneStats[z].total; const zUsed = zoneStats[z].used; const zEmpty = zTotal - zUsed; const zRate = ((zUsed / zTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${z}</strong> 구역</td><td>${zTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${jsArg(z)}', 'used')">${zUsed}</td><td style="color:var(--c-risk-text,#ff5252); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('${jsArg(z)}', 'empty')">${zEmpty}</td><td>${zRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;

        detailHtml += `<div onclick="document.getElementById('sec-dong-detail').style.display = document.getElementById('sec-dong-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-dong-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 동별 사용률</div>`;
        detailHtml += `<div id="sec-dong-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%; margin-bottom:15px;"><thead><tr><th>동</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const dongs = Object.keys(dongStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        dongs.forEach(d => {
            const dTotal = dongStats[d].total; const dUsed = dongStats[d].used; const dEmpty = dTotal - dUsed; const dRate = ((dUsed / dTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${d}</strong> 동</td><td>${dTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used'); filters.dong=['${d}']; setupFilterPopups(); applyFiltersAndSort();">${dUsed}</td><td style="color:var(--c-risk-text,#ff5252); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty'); filters.dong=['${d}']; setupFilterPopups(); applyFiltersAndSort();">${dEmpty}</td><td>${dRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;

        detailHtml += `<div onclick="document.getElementById('sec-pos-detail').style.display = document.getElementById('sec-pos-detail').style.display==='none'?'block':'none'; this.querySelector('.toggle-icon').textContent = document.getElementById('sec-pos-detail').style.display==='none'?'▶':'▼';" style="font-size:13px; font-weight:bold; margin-bottom:5px; color:var(--primary); cursor:pointer; user-select:none;"><span class="toggle-icon">▶</span> 위치별 사용률</div>`;
        detailHtml += `<div id="sec-pos-detail" style="display:none;">`;
        detailHtml += `<table class="usage-table" style="width:100%;"><thead><tr><th>위치</th><th>총 칸수</th><th>사용중</th><th>빈칸</th><th>사용률</th></tr></thead><tbody>`;
        const poses = Object.keys(posStats).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));
        poses.forEach(p => {
            const pTotal = posStats[p].total; const pUsed = posStats[p].used; const pEmpty = pTotal - pUsed; const pRate = ((pUsed / pTotal) * 100).toFixed(1);
            detailHtml += `<tr><td><strong>${p}</strong> 위치</td><td>${pTotal}</td><td style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'used'); filters.pos=['${p}']; setupFilterPopups(); applyFiltersAndSort();">${pUsed}</td><td style="color:var(--c-risk-text,#ff5252); cursor:pointer; text-decoration:underline;" onclick="applyUsageFilter('all', 'empty'); filters.pos=['${p}']; setupFilterPopups(); applyFiltersAndSort();">${pEmpty}</td><td>${pRate}%</td></tr>`;
        });
        detailHtml += `</tbody></table></div>`;
        detailHtml += `</div>`; 

        html += detailHtml;

    } else {
        // 상품코드별 대표값 한 번씩만 더한다(같은 상품이 여러 칸에 있으면 같은 비축수량이 반복 저장돼 있다)
        const _b2f = {};
        originalData.forEach(loc => {
            const c = String(loc.code || loc.id || '').trim();
            _b2f[c] = Math.max(_b2f[c] || 0, Number(loc.stock2f || 0));
        });
        let sum2F = Object.values(_b2f).reduce((a, v) => a + v, 0);
        let rate2F = ((sum2F / window.capacity2F) * 100).toFixed(1);
        let remaining2F = window.capacity2F - sum2F;
        
        // ★ 만재 예측: 현재 적재수량 + 도착예상일별 입고수량 누적
        let incomingByDate = {}; // {날짜: 총수량}
        let totalIncoming = 0;
        for (let code in incomingData) {
            const item = incomingData[code];
            // 도착예상일 우선, 없으면 표시날짜 폴백
            const rawDate = item['도착예상일'] || item['표시날짜'] || '';
            const date = rawDate.toString().trim();
            const qty = Number(item['입고대기수량'] || 0);
            if (date && qty > 0) {
                incomingByDate[date] = (incomingByDate[date] || 0) + qty;
                totalIncoming += qty;
            }
        }
        const sortedDates = Object.keys(incomingByDate).sort();
        
        let predictionHtml = '';
        let fullDate = '';
        let cumTotal = sum2F; // 현재 적재수량에서 시작
        
        for (const date of sortedDates) {
            cumTotal += incomingByDate[date];
            if (cumTotal >= window.capacity2F) {
                fullDate = date;
                break;
            }
        }
        
        if (sortedDates.length === 0) {
            predictionHtml = `<tr><th style="background:var(--c-track,#eceff1);">만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content"><b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="color:var(--c-text-3,#888); text-align:right;">입고대기 데이터 없음 (시트 동기화 필요)</td></tr>`;
        } else if (sum2F >= window.capacity2F) {
            predictionHtml = `<tr><th style="background:var(--c-risk-soft,#ffebee);">만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content"><b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:var(--c-risk-text,#d32f2f); text-align:right;">이미 초과 상태입니다! (${(sum2F - window.capacity2F).toLocaleString()}장 초과)</td></tr>`;
        } else if (fullDate) {
            predictionHtml = `<tr><th style="background:var(--c-warn-soft,#fff3e0);">만재 예측일<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content"><b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:var(--c-warn-text,#e65100); text-align:right;">${fullDate}<br><span style="font-size:11px; color:var(--c-text-3,#888);">현재 ${sum2F.toLocaleString()}장 + 입고예정 누적 → ${cumTotal.toLocaleString()}장 도달</span></td></tr>`;
        } else {
            const afterAll = sum2F + totalIncoming;
            const remainAfter = window.capacity2F - afterAll;
            
            // 일평균 입고량 기반 만재 예측 날짜 계산
            const firstDate = sortedDates[0];
            const lastDate = sortedDates[sortedDates.length - 1];
            const d1 = new Date(firstDate);
            const d2 = new Date(lastDate);
            const daySpan = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
            const dailyAvg = totalIncoming / daySpan;
            
            let estimatedDate = '';
            if (dailyAvg > 0) {
                const extraDays = Math.ceil(remainAfter / dailyAvg);
                const estDate = new Date(d2);
                estDate.setDate(estDate.getDate() + extraDays);
                estimatedDate = toDateStr(estDate);
            }
            
            if (estimatedDate && dailyAvg > 0) {
                predictionHtml = `<tr><th style="background:var(--c-ok-soft,#e8f5e9);">만재 예측일<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content"><b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:var(--c-ok-text,#2e7d32); text-align:right;">${estimatedDate} (추정)<br><span style="font-size:11px; color:var(--c-text-3,#888);">일평균 입고 ${Math.round(dailyAvg).toLocaleString()}장 기준, 입고예정 후 여유 ${remainAfter.toLocaleString()}장</span></td></tr>`;
            } else {
                predictionHtml = `<tr><th style="background:var(--c-ok-soft,#e8f5e9);">만재 예측<span class="info-tip" data-tip-key="usage-full-prediction">i<span class="info-tip-content"><b>만재 예측 계산 방식</b><br>현재 2층 적재수량에 입고대기 중인 수량을 <b>도착예상일 순</b>으로 누적 더해서, 총 적재가능수량에 도달하는 날짜를 계산합니다.<br><br>입고예정 전량을 더해도 여유가 있으면, 일평균 입고량을 기준으로 만재 예상일을 추정합니다.</span></span></th><td style="font-weight:bold; color:var(--c-ok-text,#2e7d32); text-align:right;">입고예정 전량 입고 후에도 여유 ${remainAfter.toLocaleString()}장<br><span style="font-size:11px; color:var(--c-text-3,#888);">예상 적재: ${afterAll.toLocaleString()} / ${window.capacity2F.toLocaleString()}장</span></td></tr>`;
            }
        }
        
        html += `<div style="font-size:15px; font-weight:bold; margin-bottom:15px; color:var(--primary); text-align:center;">2층 전체 창고 사용률: ${rate2F}%</div><table class="usage-table" style="width:100%;"><tr><th style="background:var(--c-accent-soft,#eef1ff); width: 40%;">총 적재가능수량</th><td style="text-align: right;"><input type="number" id="input-cap-2f" value="${window.capacity2F}" style="width:80px; padding:3px; text-align:right; font-size:13px; font-weight:bold;"> 장 <button onclick="saveCapacity2F()" style="padding:4px 8px; margin-left:5px; font-size:11px; background:var(--primary); color:var(--c-on-fill,white); border:none; border-radius:3px; cursor:pointer;">기준변경</button></td></tr><tr><th style="background:var(--c-accent-soft,#eef1ff);">현재 적재수량</th><td style="font-weight:bold; color:var(--primary); text-align: right;">${sum2F.toLocaleString()} 장</td></tr><tr><th style="background:var(--c-accent-soft,#eef1ff);">남은 수량</th><td style="font-weight:bold; color:var(--c-risk-text,#ff5252); text-align: right;">${remaining2F.toLocaleString()} 장</td></tr>${predictionHtml}</table>`;
    }
    popup.innerHTML = html;
};

window.toggleUsagePopup = function(e) {
    e.stopPropagation();
    const pop = document.getElementById('usage-popup');
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    if (pop.style.display !== 'block') { pop.style.display = 'block'; window.calculateAndRenderUsage(); }
};

function getSortButtonsHtml(key) {
    const isAsc = sortConfig.key === key && sortConfig.direction === 'asc';
    const isDesc = sortConfig.key === key && sortConfig.direction === 'desc';
    return `<div class="filter-option ${isAsc ? 'selected' : ''}" onclick="executeSort('${key}', 'asc')">오름차순 정렬</div><div class="filter-option ${isDesc ? 'selected' : ''}" onclick="executeSort('${key}', 'desc')">내림차순 정렬</div><div class="filter-divider"></div>`;
}

function updateLocPopupUI() {
    const locPop = document.getElementById('pop-id');
    if (!locPop) return;
    let prefixSet = new Set(originalData.map(d => d.id.charAt(0))); prefixSet.add('★');
    const prefixes = [...prefixSet].sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    let locHtml = window.getFilterSearchHtml('pop-id') + getSortButtonsHtml('id');
    const isAllSelected = filters.loc.length === 0;
    locHtml += `<div class="filter-option ${isAllSelected ? 'selected' : ''}" onclick="toggleLocFilter('all')">전체선택/해제</div>`;
    prefixes.forEach(p => { const isSelected = filters.loc.includes(p); locHtml += `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="toggleLocFilter('${jsArg(p)}')">${p} 구역</div>`; });
    locPop.innerHTML = locHtml;
}

function updateFilterButtonStates() {
    // 헤더 검색창 검색어(colTextSearch)도 필터다 — 검색어만 남아 있어도 ▼ 를 활성으로 표시
    const hasText = (key) => !!(colTextSearch[key] || '').trim();
    const btnId = document.getElementById('btn-filter-id');
    if (btnId) {
        if (filters.loc.length === 0 && !hasText('id')) btnId.classList.remove('active');
        else btnId.classList.add('active');
    }

    ['code', 'dong', 'pos', 'stock', 'stock2f', 'category'].forEach(type => {
        const btn = document.getElementById('btn-filter-' + type);
        if (btn) {
            if (type === 'code') {
                const active = (filters.code && filters.code.length > 0) ||
                               (filters.reserved && filters.reserved.includes('only')) ||
                               (filters.preassigned && filters.preassigned.includes('only')) ||
                               hasText('code');
                if (active) btn.classList.add('active'); else btn.classList.remove('active');
            } else {
                const arr = filters[type];
                if ((!Array.isArray(arr) || arr.length === 0) && !hasText(type)) btn.classList.remove('active');
                else btn.classList.add('active');
            }
        }
    });

    // 상품명·옵션은 목록 필터가 없고 검색창만 있다
    ['name', 'option'].forEach(type => {
        const btn = document.getElementById('btn-filter-' + type);
        if (btn) btn.classList.toggle('active', hasText(type));
    });

    // 커스텀 헤더 필터 버튼 활성 상태
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const btn = document.getElementById('btn-filter-' + col);
        if (btn) {
            const arr = filters[col];
            if ((!Array.isArray(arr) || arr.length === 0) && !hasText(col)) btn.classList.remove('active');
            else btn.classList.add('active');
        }
    });
}

function setupFilterPopups() {
    const codePop = document.getElementById('pop-code'); const namePop = document.getElementById('pop-name');
    const optionPop = document.getElementById('pop-option'); const stockPop = document.getElementById('pop-stock');
    const dongPop = document.getElementById('pop-dong'); const posPop = document.getElementById('pop-pos');
    
    updateLocPopupUI();
    
    const isReservedOnly = filters.reserved.includes('only');
    const isPreassignedOnly = filters.preassigned.includes('only');
    const isDesignatedOnly = filters.code.includes('designated-only'); // 신규
    const isEmpty = filters.code.includes('empty');
    const isNotEmpty = filters.code.includes('not-empty');
    const codeAll = filters.code.length === 0 && !isReservedOnly && !isPreassignedOnly && !isDesignatedOnly;
    let codeHtml = window.getFilterSearchHtml('pop-code') + getSortButtonsHtml('code') + 
      `<div class="filter-option ${codeAll ? 'selected' : ''}" onclick="setCodeTagFilter('all')">전체선택/해제</div>` +
        `<div class="filter-option ${isEmpty ? 'selected' : ''}" onclick="setCodeTagFilter('empty')">빈칸</div>` +
        `<div class="filter-option ${isNotEmpty ? 'selected' : ''}" onclick="setCodeTagFilter('not-empty')">내용있음</div>` +
        `<div class="filter-divider"></div>` +
        `<div class="filter-option ${isDesignatedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('designated-only')">지정값만 보기</div>` + // 추가
        `<div class="filter-option ${isReservedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('당일지정')">당일지정</div>` +
        `<div class="filter-option ${isPreassignedOnly ? 'selected' : ''}" onclick="setCodeTagFilter('선지정')">선지정</div>`;
    if(codePop) codePop.innerHTML = codeHtml;
    if(namePop) namePop.innerHTML = window.getFilterSearchHtml('pop-name') + getSortButtonsHtml('name');
    if(optionPop) optionPop.innerHTML = window.getFilterSearchHtml('pop-option') + getSortButtonsHtml('option');
    const dongs = [...new Set(originalData.map(d => (d.dong || '').toString()))].filter(Boolean).sort();
    const dongAll = filters.dong.length === 0;
    let dongHtml = window.getFilterSearchHtml('pop-dong') + getSortButtonsHtml('dong') + `<div class="filter-option ${dongAll ? 'selected' : ''}" onclick="setFilter('dong', 'all')">전체선택/해제</div>`;
    dongs.forEach(d => { 
        const sel = filters.dong.includes(d);
        dongHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('dong', '${jsArg(d)}')">${d}</div>`; 
    });
    if(dongPop) dongPop.innerHTML = dongHtml;
    const poses = [...new Set(originalData.map(d => (d.pos || '').toString()))].filter(Boolean).sort();
    const posAll = filters.pos.length === 0;
    let posHtml = window.getFilterSearchHtml('pop-pos') + getSortButtonsHtml('pos') + `<div class="filter-option ${posAll ? 'selected' : ''}" onclick="setFilter('pos', 'all')">전체선택/해제</div>`;
    poses.forEach(p => { 
        const sel = filters.pos.includes(p);
        posHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('pos', '${jsArg(p)}')">${p}</div>`; 
    });
    if(posPop) posPop.innerHTML = posHtml;
    const stocks = [...new Set(originalData.map(d => (d.stock || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    const stockAll = filters.stock.length === 0;
    let stockHtml = window.getFilterSearchHtml('pop-stock') + getSortButtonsHtml('stock') + `<div class="filter-option ${stockAll ? 'selected' : ''}" onclick="setFilter('stock', 'all')">전체선택/해제</div>`;
    stocks.forEach(s => { 
        const sel = filters.stock.includes(s);
        stockHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('stock', '${jsArg(s)}')">${s}</div>`; 
    });
    if(stockPop) stockPop.innerHTML = stockHtml;
   const stock2fPop = document.getElementById('pop-stock2f');
    const stocks2f = [...new Set(originalData.map(d => (d.stock2f || '0').toString()))].sort((a, b) => Number(a) - Number(b));
    const stock2fAll = !filters.stock2f || filters.stock2f.length === 0;
    let stock2fHtml = window.getFilterSearchHtml('pop-stock2f') + getSortButtonsHtml('stock2f') + `<div class="filter-option ${stock2fAll ? 'selected' : ''}" onclick="setFilter('stock2f', 'all')">전체선택/해제</div>`;
    stocks2f.forEach(s => { 
        const sel = filters.stock2f && filters.stock2f.includes(s);
        stock2fHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('stock2f', '${jsArg(s)}')">${s}</div>`; 
    });
    if(stock2fPop) stock2fPop.innerHTML = stock2fHtml;

    const categoryPop = document.getElementById('pop-category');
    const categories = [...new Set(originalData.map(d => (d.category || '피킹용').toString()))].sort();
    const categoryAll = !filters.category || filters.category.length === 0;
    let categoryHtml = window.getFilterSearchHtml('pop-category') + getSortButtonsHtml('category') + `<div class="filter-option ${categoryAll ? 'selected' : ''}" onclick="setFilter('category', 'all')">전체선택/해제</div>`;
    categories.forEach(c => {
        const sel = filters.category && filters.category.includes(c);
        categoryHtml += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('category', '${jsArg(c)}')">${c}</div>`;
    });
    if(categoryPop) categoryPop.innerHTML = categoryHtml;

    updateFilterButtonStates();

    // 커스텀 헤더 필터 팝업 생성
    window.visibleColumns.forEach(col => {
        if (!col.startsWith('cus_')) return;
        const pop = document.getElementById(`pop-${col}`);
        if (!pop) return;
        const key = col.replace('cus_', '');
        if (!Array.isArray(filters[col])) filters[col] = [];
        const arr = filters[col];
        const curAll = arr.length === 0;

        // ★ 옵션추가항목1: 빈칸/내용있음 전용 필터
        if (key === '옵션추가항목1') {
            const isE = arr.includes('empty');
            const isN = arr.includes('not-empty');
            let html = getSortButtonsHtml(col) +
                `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">전체선택/해제</div>` +
                `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">빈칸</div>` +
                `<div class="filter-option ${isN ? 'selected' : ''}" onclick="setFilter('${col}', 'not-empty')">내용있음</div>`;
            pop.innerHTML = html;
            return;
        }

        // ★ 값 수집
        const vals = [...new Set(originalData.map(d => {
            // ★ v3.57fix: 입고대기는 incomingTotalByCode 기준으로 필터값 수집
            if (key === '입고대기') {
                const code = (d.code && d.code !== d.id) ? d.code : '';
                const v = code && incomingTotalByCode[code] ? incomingTotalByCode[code].toString() : '';
                return v;
            }
            return (d.rawData && d.rawData[key]) ? d.rawData[key].toString().trim() : '';
        }))].filter(Boolean);

        // ★ v3.59: 날짜 필터 자동 감지 (70% 이상 YYYY-MM-DD 형식이면 날짜 필터)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const dateValsCount = vals.filter(v => dateRegex.test(v)).length;
        const isDateFilter = vals.length > 0 && (dateValsCount / vals.length) >= 0.7;

        if (isDateFilter) {
            // 유효한 날짜만 필터링
            const dateVals = vals.filter(v => dateRegex.test(v));
            // 빈칸 여부 (rawData에서 빈 값인 행이 있는지 체크)
            const hasEmpty = originalData.some(d => {
                const v = (d.rawData && d.rawData[key]) ? d.rawData[key].toString().trim() : '';
                return v === '';
            });
            
            // 년/월별로 그룹핑
            const byYear = {}; // { '2026': { '04': ['2026-04-15','2026-04-16'], '03': [...] }, ... }
            dateVals.forEach(d => {
                const [y, m] = d.split('-');
                if (!byYear[y]) byYear[y] = {};
                if (!byYear[y][m]) byYear[y][m] = [];
                byYear[y][m].push(d);
            });
            
            // 년도 최신순, 월 최신순, 일 최신순 정렬
            const years = Object.keys(byYear).sort().reverse();
            years.forEach(y => {
                const months = Object.keys(byYear[y]).sort().reverse();
                const sortedMonths = {};
                months.forEach(m => {
                    sortedMonths[m] = byYear[y][m].sort().reverse();
                });
                byYear[y] = sortedMonths;
            });
            
            // 정렬 + 전체선택/해제
            let html = window.getFilterSearchHtml(`pop-${col}`) + getSortButtonsHtml(col) +
                `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">전체선택/해제</div>`;
            
            // 빈칸 옵션 (있을 경우만)
            if (hasEmpty) {
                const isE = arr.includes('empty');
                html += `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">빈칸</div>`;
            }
            
            // 년도 계층 구조
            years.forEach(y => {
                const yearDates = [];
                Object.keys(byYear[y]).forEach(m => { yearDates.push(...byYear[y][m]); });
                const yearAllSelected = yearDates.every(d => arr.includes(d));
                const yearPartialSelected = !yearAllSelected && yearDates.some(d => arr.includes(d));
                const yearCheck = yearAllSelected ? 'is-all' : (yearPartialSelected ? 'is-part' : 'is-none');
                
                html += `<div class="date-node date-year" data-col="${col}" data-year="${y}">
                    <div class="date-row date-year-row">
                        <span class="date-toggle" onclick="event.stopPropagation(); window.toggleDateNode(this);">▶</span>
                        <span class="date-check ${yearCheck}" onclick="event.stopPropagation(); window.toggleDateGroup('${col}', 'year', '${y}');"></span>
                        <span class="date-label">${y}</span>
                    </div>
                    <div class="date-children" style="display:none;">`;
                
                // 월 계층
                Object.keys(byYear[y]).forEach(m => {
                    const monthDates = byYear[y][m];
                    const monthAllSelected = monthDates.every(d => arr.includes(d));
                    const monthPartialSelected = !monthAllSelected && monthDates.some(d => arr.includes(d));
                    const monthCheck = monthAllSelected ? 'is-all' : (monthPartialSelected ? 'is-part' : 'is-none');
                    
                    html += `<div class="date-node date-month" data-col="${col}" data-year="${y}" data-month="${m}">
                        <div class="date-row date-month-row">
                            <span class="date-toggle" onclick="event.stopPropagation(); window.toggleDateNode(this);">▶</span>
                            <span class="date-check ${monthCheck}" onclick="event.stopPropagation(); window.toggleDateGroup('${col}', 'month', '${y}-${m}');"></span>
                            <span class="date-label">${m}월</span>
                        </div>
                        <div class="date-children" style="display:none;">`;
                    
                    // 일 체크박스
                    monthDates.forEach(d => {
                        const sel = arr.includes(d);
                        const dayCheck = sel ? 'is-all' : 'is-none';
                        html += `<div class="date-row date-day-row ${sel ? 'selected' : ''}" onclick="event.stopPropagation(); setFilter('${col}', '${d}');">
                            <span class="date-check ${dayCheck}"></span>
                            <span class="date-label">${d}</span>
                        </div>`;
                    });
                    
                    html += `</div></div>`;
                });
                
                html += `</div></div>`;
            });
            
            pop.innerHTML = html;
            return;
        }

        // ★ 일반 필터 (기존 로직)
        const normalVals = vals.sort((a, b) => {
            // 숫자 정렬 (문자열 "1", "10", "100" → 숫자 순)
            const na = Number(a), nb = Number(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });

        let html = window.getFilterSearchHtml(`pop-${col}`) + getSortButtonsHtml(col) +
            `<div class="filter-option ${curAll ? 'selected' : ''}" onclick="setFilter('${col}', 'all')">전체선택/해제</div>`;

        // ★ 입고대기: 빈칸 옵션 추가
        if (key === '입고대기') {
            const isE = arr.includes('empty');
            html += `<div class="filter-option ${isE ? 'selected' : ''}" onclick="setFilter('${col}', 'empty')">빈칸</div>`;
        }

        normalVals.forEach(v => {
            const escaped = jsArg(v);
            const sel = arr.includes(v);
            html += `<div class="filter-option ${sel ? 'selected' : ''}" onclick="setFilter('${col}', '${escaped}')">${v}</div>`;
        });
        pop.innerHTML = html;
    });
}

window.executeSort = (key, direction) => { sortConfig = { key: key, direction: direction }; setupFilterPopups(); applyFiltersAndSort(); if (typeof window.closeAllPopups === 'function') window.closeAllPopups(); };
window.toggleLocFilter = (val) => { 
    if (val === 'all') filters.loc = []; 
    else { 
        if (filters.loc.includes(val)) filters.loc = filters.loc.filter(v => v !== val); 
        else filters.loc.push(val); 
    } 
    setupFilterPopups(); 
    applyFiltersAndSort();
    window.showFilterResetBtn();
};
// ★ v3.57: 모든 필터 배열 토글 방식
window.setFilter = (type, value) => { 
    if (!Array.isArray(filters[type])) filters[type] = [];
    if (value === 'all') {
        // ★ v3.57fix: 전체선택/해제 토글
        if (filters[type].length > 0) {
            // 선택된 게 있으면 → 전체 해제 (빈 배열 = 전체 표시)
            filters[type] = [];
        } else {
            // 아무것도 선택 안 된 상태면 → 전체 값 수집해서 모두 선택
            const pop = document.getElementById('pop-' + type);
            if (pop) {
                const allVals = [];
                pop.querySelectorAll('.filter-option[onclick]').forEach(opt => {
                    const m = opt.getAttribute('onclick').match(/setFilter\([^,]+,\s*'([^']+)'\)/);
                    if (m && m[1] !== 'all') allVals.push(m[1]);
                });
                filters[type] = allVals;
            }
        }
    } else {
        // 특수값 상호 배제: empty ↔ not-empty 는 하나만 선택
        if (value === 'empty' || value === 'not-empty') {
            const opposite = value === 'empty' ? 'not-empty' : 'empty';
            filters[type] = filters[type].filter(v => v !== opposite);
        }
        // 토글
        if (filters[type].includes(value)) {
            filters[type] = filters[type].filter(v => v !== value);
        } else {
            filters[type].push(value);
        }
    }
    setupFilterPopups(); 
    applyFiltersAndSort(); 
    // ★ 다중 선택 지원을 위해 팝업 자동 닫힘 제거 (사용자가 원할 때 닫음)
    window.showFilterResetBtn();
};

// ★ v3.59: 날짜 계층 필터 - 펼침/접힘 토글
window.toggleDateNode = function(toggleEl) {
    const node = toggleEl.closest('.date-node');
    if (!node) return;
    const children = node.querySelector('.date-children');
    if (!children) return;
    const isOpen = children.style.display === 'block';
    children.style.display = isOpen ? 'none' : 'block';
    toggleEl.textContent = isOpen ? '▶' : '▼';
};

// ★ v3.59: 날짜 그룹(년/월) 단위 토글 선택/해제
window.toggleDateGroup = function(col, level, keyStr) {
    if (!Array.isArray(filters[col])) filters[col] = [];
    
    // 해당 그룹에 속하는 모든 날짜 수집
    const pop = document.getElementById('pop-' + col);
    if (!pop) return;
    
    let targetDates = [];
    if (level === 'year') {
        // 해당 년도의 모든 일자
        const yearNode = pop.querySelector(`.date-year[data-year="${keyStr}"]`);
        if (yearNode) {
            yearNode.querySelectorAll('.date-day-row').forEach(row => {
                const label = row.querySelector('.date-label');
                if (label) targetDates.push(label.textContent.trim());
            });
        }
    } else if (level === 'month') {
        // 'YYYY-MM' 형식
        const [y, m] = keyStr.split('-');
        const monthNode = pop.querySelector(`.date-month[data-year="${y}"][data-month="${m}"]`);
        if (monthNode) {
            monthNode.querySelectorAll('.date-day-row').forEach(row => {
                const label = row.querySelector('.date-label');
                if (label) targetDates.push(label.textContent.trim());
            });
        }
    }
    
    if (targetDates.length === 0) return;
    
    // 전부 선택되어 있으면 → 전부 해제, 아니면 → 전부 선택
    const allSelected = targetDates.every(d => filters[col].includes(d));
    if (allSelected) {
        filters[col] = filters[col].filter(v => !targetDates.includes(v));
    } else {
        targetDates.forEach(d => {
            if (!filters[col].includes(d)) filters[col].push(d);
        });
    }
    
    setupFilterPopups();
    applyFiltersAndSort();
    window.showFilterResetBtn();
};
// ★ v3.60: 필터 검색 기능
// 각 팝업의 검색 쿼 저장 (팝업이 열려있는 동안만 유효)
window._filterSearchQuery = window._filterSearchQuery || {};

// 검색 쿼리 업데이트 및 리스트 재렌더링 트리거
let _filterSearchTimer = null;
window.updateFilterSearch = function(popId, query) {
    window._filterSearchQuery[popId] = query || '';
    const pop = document.getElementById(popId);
    if (!pop) return;
    
    // 일반 필터: filter-option 표시/숨김
    // 날짜 필터: 계층 구조면 평탄화 토글
    const isDateFilter = !!pop.querySelector('.date-node');
    
    if (isDateFilter) {
        // 날짜 필터: 검색 시 평탄화 모드로 재렌더링
        window.renderDateFilterFlat(popId, query);
    } else {
        // 일반 필터: 옵션 표시/숨김
        const q = (query || '').toLowerCase();
        pop.querySelectorAll('.filter-option').forEach(opt => {
            // 정렬 버튼(오름차순/내림차순)과 전체선택/해제는 항상 표시
            const text = opt.textContent || '';
            if (text.includes('오름차순') || text.includes('내림차순') || text.includes('전체선택/해제')) {
                opt.style.display = '';
                return;
            }
            if (!q) {
                opt.style.display = '';
            } else {
                // 앞자리 체크 표시 제외하고 비교 (체크는 이제 CSS ::before 라 글자에 없음)
                const cleanText = text.replace(/^\u2714\uFE0F?\s*/, '').toLowerCase();
                opt.style.display = cleanText.includes(q) ? '' : 'none';
            }
        });
        // 구분선은 항상 표시
        pop.querySelectorAll('.filter-divider').forEach(d => { d.style.display = ''; });
    }

    // ★ 검색창 입력으로 테이블 본문도 해당 컬럼 부분일치 필터링 — 표 다시 그리기만 150ms 모아서(글자마다 전체 필터·정렬을 돌리지 않게)
    const colKey = popId.replace('pop-', '');
    colTextSearch[colKey] = (query || '').trim();
    clearTimeout(_filterSearchTimer);
    _filterSearchTimer = setTimeout(applyFiltersAndSort, 150);
    updateFilterButtonStates();   // 검색어만 있어도 ▼ 를 활성으로(보이지 않는 필터가 남지 않게)
};

// 날짜 필터 평탄화 렌더링 (검색 모드)
window.renderDateFilterFlat = function(popId, query) {
    const pop = document.getElementById(popId);
    if (!pop) return;
    
    const q = (query || '').toLowerCase().trim();
    
    // 검색어가 없으면 원래 계층 구조 복구 = setupFilterPopups 재호출
    if (!q) {
        setupFilterPopups();
        // 재호출 후 검색창 값도 복원
        const input = pop.querySelector('.filter-search-input');
        if (input) input.value = '';
        return;
    }
    
    // 기존 모든 날짜 수집 (data-label 속성 기반)
    const allDates = [];
    pop.querySelectorAll('.date-day-row .date-label').forEach(label => {
        const d = label.textContent.trim();
        if (d && !allDates.includes(d)) allDates.push(d);
    });
    
    if (allDates.length === 0) return;
    
    // col 추출 (pop-cus_마지막배송일 → cus_마지막배송일)
    const col = popId.replace(/^pop-/, '');
    const arr = Array.isArray(filters[col]) ? filters[col] : [];
    
    // 평탄화 + 필터링
    const matched = allDates.filter(d => d.toLowerCase().includes(q)).sort().reverse();
    
    // 검색창 부분만 남기고 나머지 제거 후 재생성
    const searchWrap = pop.querySelector('.filter-search-wrap');
    const searchHtml = searchWrap ? searchWrap.outerHTML : '';
    
    // 정렬 버튼 + 전체선택/해제 + 검색 결과
    let html = searchHtml + getSortButtonsHtml(col);
    
    if (matched.length === 0) {
        html += `<div class="filter-option" style="color:var(--c-text-3); font-style:italic; cursor:default;">검색 결과 없음</div>`;
    } else {
        matched.forEach(d => {
            const sel = arr.includes(d);
            const dayCheck = sel ? 'is-all' : 'is-none';
            html += `<div class="date-row date-day-row ${sel ? 'selected' : ''}" style="padding-left:15px;" onclick="event.stopPropagation(); setFilter('${col}', '${d}');">
                <span class="date-check ${dayCheck}"></span>
                <span class="date-label">${d}</span>
            </div>`;
        });
    }
    
    pop.innerHTML = html;
    
    // 검색창에 포커스 유지
    const newInput = pop.querySelector('.filter-search-input');
    if (newInput) {
        newInput.value = query;
        newInput.focus();
        // 커서를 맨 끝으로
        newInput.setSelectionRange(query.length, query.length);
    }
};

// 검색창 HTML 생성 헬퍼
window.getFilterSearchHtml = function(popId) {
    const curQuery = (window._filterSearchQuery && window._filterSearchQuery[popId]) || '';
    return `<div class="filter-search-wrap" onclick="event.stopPropagation();">
        <input type="text" class="filter-search-input" placeholder="검색..." value="${escAttr(curQuery)}"
               onkeydown="event.stopPropagation();"
               oninput="event.stopPropagation(); updateFilterSearch('${popId}', this.value);">
        ${curQuery ? `<button type="button" class="filter-search-clear" onclick="event.stopPropagation(); this.previousElementSibling.value=''; updateFilterSearch('${popId}', '');" aria-label="검색어 지우기">×</button>` : ''}
    </div>`;
};

window.setCodeTagFilter = (mode) => {
    // mode: 'all', 'empty', 'not-empty', 'designated-only', '당일지정', '선지정'
    if (mode === 'all') {
        filters.code = []; filters.reserved = []; filters.preassigned = [];
    } else if (mode === 'empty') {
        filters.code = filters.code.filter(v => v !== 'not-empty' && v !== 'designated-only');
        if (filters.code.includes('empty')) filters.code = filters.code.filter(v => v !== 'empty');
        else filters.code.push('empty');
    } else if (mode === 'not-empty') {
        filters.code = filters.code.filter(v => v !== 'empty' && v !== 'designated-only');
        if (filters.code.includes('not-empty')) filters.code = filters.code.filter(v => v !== 'not-empty');
        else filters.code.push('not-empty');
    } else if (mode === 'designated-only') {
        // 지정값만 보기는 empty, not-empty, 당일지정, 선지정과 상호 배제
        filters.code = filters.code.filter(v => v !== 'empty' && v !== 'not-empty');
        filters.reserved = []; filters.preassigned = [];
        if (filters.code.includes('designated-only')) filters.code = filters.code.filter(v => v !== 'designated-only');
        else filters.code.push('designated-only');
    } else if (mode === '당일지정') {
        filters.code = filters.code.filter(v => v !== 'designated-only');
        if (filters.reserved.includes('only')) filters.reserved = [];
        else filters.reserved = ['only'];
    } else if (mode === '선지정') {
        filters.code = filters.code.filter(v => v !== 'designated-only');
        if (filters.preassigned.includes('only')) filters.preassigned = [];
        else filters.preassigned = ['only'];
    }
    setupFilterPopups();
    applyFiltersAndSort();
    window.showFilterResetBtn();
};

window.showFilterResetBtn = function() {
    // 필터 초기화 버튼 비활성화
    let btn = document.getElementById('filter-reset-btn');
    if (btn) btn.style.display = 'none';
};

// ★ v3.94: 모든 필터를 한 번에 해제
window.clearAllFilters = function(e) {
    if (e) e.stopPropagation();
    
    // 기본 필터 키 모두 빈 배열로 초기화
    filters = { loc: [], code: [], stock: [], stock2f: [], category: [], dong: [], pos: [], reserved: [], preassigned: [] };
    
    // 동적으로 추가된 커스텀 헤더 필터(cus_*)도 모두 제거
    Object.keys(filters).forEach(key => {
        if (key.startsWith('cus_')) delete filters[key];
    });
    
    // 검색 쿼리도 초기화
    if (window._filterSearchQuery) window._filterSearchQuery = {};
    colTextSearch = {};
    // 머리줄 전체 검색도 비운다(입력 대기 중인 검색은 취소)
    clearTimeout(_globalSearchTimer);
    globalSearch = '';
    _globalSearchFromUrl = false;
    const _gsInput = document.getElementById('loc-global-search');
    if (_gsInput) _gsInput.value = '';
    
    // 팝업/메뉴 모두 닫기
    if (typeof window.closeAllPopups === 'function') window.closeAllPopups();
    
    // 필터 UI 갱신 + 테이블 재렌더링
    setupFilterPopups();
    applyFiltersAndSort();
    
    // 사용자에게 알림
    showToast("모든 필터가 해제되었습니다.");
};

// 머리줄 전체 검색 — 150ms 모아서 걸고, 리스트가 아닌 탭에서 치면 리스트로 바꾼다(엑셀 받기도 걸러진 목록을 쓴다)
let _globalSearchTimer = null;
(function setupGlobalSearch() {
    const input = document.getElementById('loc-global-search');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(_globalSearchTimer);
        _globalSearchTimer = setTimeout(() => {
            globalSearch = input.value.trim().toLowerCase();
            _globalSearchFromUrl = false;
            if (globalSearch && document.body.dataset.locTab !== 'list' && typeof window.switchView === 'function') window.switchView('list');
            applyFiltersAndSort();
        }, 150);
    });
})();

// 변경 추천 표의 상품코드 클릭 → 데이터 리스트를 그 코드로 머리줄 검색(js/locrec-table.js)
window.locSearchCode = function(code) {
    const v = String(code || '').trim();
    if (!v) return;
    const input = document.getElementById('loc-global-search');
    if (input) input.value = v;
    clearTimeout(_globalSearchTimer);
    globalSearch = v.toLowerCase();
    _globalSearchFromUrl = false;
    if (document.body.dataset.locTab !== 'list' && typeof window.switchView === 'function') window.switchView('list');
    applyFiltersAndSort();
    const box = document.getElementById('view-list');
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
};

// 상품 관리 [로케이션관리에서 보기] → location.html?q=코드,코드#tab=list — 첫 데이터가 오면 한 번만 머리줄 검색에 넣는다
let _urlSearchApplied = false;
function applyUrlSearchOnce() {
    if (_urlSearchApplied) return;
    _urlSearchApplied = true;
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q || !q.trim()) return;
    const input = document.getElementById('loc-global-search');
    if (input) input.value = q.trim();
    clearTimeout(_globalSearchTimer);   // 그사이 친 글자의 대기 중 검색이 쉼표 나누기를 끄지 않게
    globalSearch = q.trim().toLowerCase();
    _globalSearchFromUrl = true;
    // 주소에서 ?q 는 지운다 — 남겨 두면 검색을 지운 뒤 새로고침해도 다시 걸린다
    try { history.replaceState(history.state, '', window.location.pathname + window.location.hash); } catch (e) { /* 무시 */ }
    if (document.body.dataset.locTab !== 'list' && typeof window.switchView === 'function') window.switchView('list');
}

function applyFiltersAndSort() {
    // 머리줄 검색: 상품 관리 링크(?q=)로 들어온 값만 쉼표로 여러 개(하나라도 맞으면) — 옵션 코드 여러 개를 넘긴다.
    // 직접 친 검색은 쉼표까지 한 덩어리로 찾는다("블랙,L" 등)
    const gsTerms = !globalSearch ? []
        : _globalSearchFromUrl ? globalSearch.split(',').map(t => t.trim()).filter(Boolean)
        : [globalSearch];
    let filtered = originalData.filter(item => {
        // ★ v3.57: 모든 필터 배열 기반 (OR 조건)
        if (filters.loc.length > 0 && !filters.loc.includes(item.id.charAt(0))) return false;
        if (filters.dong.length > 0 && !filters.dong.includes((item.dong || '').toString())) return false;
        if (filters.pos.length > 0 && !filters.pos.includes((item.pos || '').toString())) return false;
        
        // code: 'empty'/'not-empty'/'designated-only' 특수값 배열
        if (filters.code.length > 0) {
            const hasCode = (item.code && item.code !== item.id && item.code.trim() !== "") || (item.name && item.name.trim() !== "");
            const matchEmpty = filters.code.includes('empty') && !hasCode;
            const matchNotEmpty = filters.code.includes('not-empty') && hasCode;
            const matchDesignatedOnly = filters.code.includes('designated-only') && hasCode && item.codeTag !== '당일지정' && item.codeTag !== '선지정';
            if (!matchEmpty && !matchNotEmpty && !matchDesignatedOnly) return false;
        }
        
        if (filters.stock.length > 0 && !filters.stock.includes((item.stock || '0').toString())) return false;
        if (filters.stock2f.length > 0 && !filters.stock2f.includes((item.stock2f || '0').toString())) return false;
        if (filters.category && filters.category.length > 0 && !filters.category.includes((item.category || '피킹용').toString())) return false;
        // ★ 피킹용 전용 필터 (대시보드 '피킹용 빈 자리' 진입 시): 기타·비축·SAM 제외
        if (filters.pickingOnly) {
            const _pid = (item.id || '').toString().trim();
            if ((item.category || '피킹용').toString().trim() === '기타' || /^비축/.test(_pid) || /^SAM/i.test(_pid)) return false;
        }
        
        if (filters.reserved.length > 0 && filters.reserved.includes('only') && item.codeTag !== '당일지정') return false;
        if (filters.preassigned.length > 0 && filters.preassigned.includes('only') && item.codeTag !== '선지정') return false;
        
        // 커스텀 헤더 필터 (cus_*)
        for (const col in filters) {
            if (!col.startsWith('cus_')) continue;
            const arr = filters[col];
            if (!Array.isArray(arr) || arr.length === 0) continue;
            const key = col.replace('cus_', '');
            let val = (item.rawData && item.rawData[key]) ? item.rawData[key].toString().trim() : '';
            // ★ 입고대기 컬럼은 오더+사입 합계 기준으로 필터
            if (key === '입고대기') {
                const code = (item.code && item.code !== item.id) ? item.code : '';
                val = code && incomingTotalByCode[code] ? incomingTotalByCode[code].toString() : '';
            }
            // 매칭: 'empty' / 'not-empty' 특수값 또는 정확 일치 값
            let matched = false;
            for (const f of arr) {
                if (f === 'empty' && val === '') matched = true;
                else if (f === 'not-empty' && val !== '') matched = true;
                else if (f === val) matched = true;
                if (matched) break;
            }
            if (!matched) return false;
        }

        // ★ 헤더 검색창 텍스트 필터 (각 컬럼 부분일치, 대소문자 무시)
        for (const ck in colTextSearch) {
            const q = (colTextSearch[ck] || '').toLowerCase();
            if (!q) continue;
            let cv = '';
            if (ck === 'id') cv = item.id || '';
            else if (ck === 'code') cv = (item.code && item.code !== item.id) ? item.code : '';
            else if (ck === 'name') cv = item.name || '';
            else if (ck === 'option') cv = item.option || '';
            else if (ck === 'dong') cv = item.dong != null ? item.dong : '';
            else if (ck === 'pos') cv = item.pos != null ? item.pos : '';
            else if (ck === 'stock') cv = item.stock != null ? item.stock : '';
            else if (ck === 'stock2f') cv = item.stock2f != null ? item.stock2f : '';
            else if (ck === 'category') cv = item.category || '피킹용';
            else if (ck.startsWith('cus_')) {
                const key = ck.replace('cus_', '');
                if (key === '입고대기') {
                    const c = (item.code && item.code !== item.id) ? item.code : '';
                    cv = c && incomingTotalByCode[c] ? incomingTotalByCode[c].toString() : '';
                } else {
                    cv = (item.rawData && item.rawData[key] != null) ? item.rawData[key] : '';
                }
            }
            if (!String(cv).toLowerCase().includes(q)) return false;
        }

        // ★ 머리줄 전체 검색 (로케이션·코드·상품명·옵션 중 하나라도 부분일치)
        if (gsTerms.length) {
            const hay = [item.id, (item.code !== item.id ? item.code : ''), item.name, item.option].join(' ').toLowerCase();
            if (!gsTerms.some(t => hay.includes(t))) return false;
        }
        return true;
    });
    filtered.sort((a, b) => {
        let aVal, bVal;
        if (sortConfig.key.startsWith('cus_')) {
            const key = sortConfig.key.replace('cus_', '');
            aVal = (a.rawData && a.rawData[key]) ? a.rawData[key].toString() : '';
            bVal = (b.rawData && b.rawData[key]) ? b.rawData[key].toString() : '';
        } else {
            aVal = a[sortConfig.key] || ''; bVal = b[sortConfig.key] || '';
        }
        // ★ 값이 양쪽 다 순수 숫자면 숫자 정렬 (문자열 정렬 시 "100"이 "11"보다 앞에 오는 문제 방지)
        const aStr = aVal.toString(), bStr = bVal.toString();
        const aNum = Number(aStr), bNum = Number(bStr);
        const bothNumeric = aStr.trim() !== '' && bStr.trim() !== '' && !isNaN(aNum) && !isNaN(bNum);
        if (bothNumeric) return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        return sortConfig.direction === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    window.lastFilteredData = filtered;
    renderTable(filtered);

    // ── 병합(v4.4+대시보드): 로케이션 현황 대시보드 탭이 표시 중이면 자동 갱신 ──
    const __locdashEl = document.getElementById('view-locdash');
    if (__locdashEl && __locdashEl.style.display !== 'none' && typeof window.renderLocationDashboard === 'function') {
        window.renderLocationDashboard();
    }
}

window.handleRowClick = async function(event, locId) {
    if (event.target.tagName === 'INPUT') return;
    
    if (window.isPreAssignMode && window.selectedPreAssignItem) {
        const loc = originalData.find(d => d.id === locId);
        if (!loc) return;
        const hasContent = (loc.code && loc.code !== loc.id && loc.code.trim() !== "") || (loc.name && loc.name.trim() !== "");
        
        const zoneDocId = getZoneDocId(locId);

        if (loc.preAssigned) { 
            // 공백 무시 비교 — 예전에 탭이 붙은 채 저장된 선지정도 같은 상품으로 본다(2026-10-22)
            if (String(loc.preAssignedCode || '').replace(/\s+/g, '') === String(window.selectedPreAssignItem.code || '').replace(/\s+/g, '')) {
                if (confirm(`이미 '${loc.preAssignedCode}' 상품으로 선지정된 자리입니다.\n지정을 해제(취소)하시겠습니까?`)) {
                    try {
                        await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                            [locId]: { preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0, codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date() }
                        }, { merge: true });
                    } catch(e) {
                        console.error(e);
                        alert('선지정을 해제하지 못했습니다(인터넷 연결 확인).' + (e?.code ? ` (${e.code})` : ''));
                        return;
                    }
                    showToast(`[${locId}] 선지정 취소 완료`);
                    window.cancelPreAssignMode();
                    return;
                } else return;
            }
            if (!confirm(`이미 다른 상품(${loc.preAssignedCode})이 선지정된 자리입니다.\n기존 선지정을 무시하고 덮어쓰시겠습니까?`)) return; 
        } else {
            if (hasContent) { alert("이미 물건이 들어있는 자리입니다. 텅 빈 빈칸을 선택해주세요."); return; }
        }
        
        try {
            await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                [locId]: {
                    preAssigned: true, preAssignedCode: window.selectedPreAssignItem.code,
                    preAssignedName: window.selectedPreAssignItem.name, preAssignedQty: window.selectedPreAssignItem.qty,
                    preAssignedAt: Date.now(),
                    code: window.selectedPreAssignItem.code, name: window.selectedPreAssignItem.name,
                    option: window.selectedPreAssignItem.option || '', stock: window.selectedPreAssignItem.qty.toString(), 
                    reserved: false, reservedBy: '', reservedAt: 0,
                    codeTag: '선지정', codeTagAt: Date.now(),
                    updatedAt: new Date()
                }
            }, { merge: true });
            showToast(`[${locId}] 자리에 선지정했습니다`);
            window.cancelPreAssignMode();
        } catch(e) { console.error(e); alert('선지정을 저장하지 못했습니다(인터넷 연결 확인).' + (e?.code ? ` (${e.code})` : '')); }
        return;
    }
    
    // v3.90: 모달 대신 선지정 해제 로직으로 대체
    const targetData = originalData.find(d => d.id === locId);
    if (!targetData) return;

    if (targetData.preAssigned === true) {
        if (confirm(`[${locId}] 선지정을 해제하시겠습니까?`)) {
            try {
                const zoneDocId = getZoneDocId(locId);
                await setDoc(doc(db, LOC_COLLECTION, zoneDocId), {
                    [locId]: {
                        preAssigned: false, preAssignedCode: '', preAssignedName: '', preAssignedQty: '', preAssignedAt: 0,
                        codeTag: '', codeTagAt: 0, code: '', name: '', option: '', stock: '0', updatedAt: new Date()
                    }
                }, { merge: true });
                showToast("선지정이 해제되었습니다.");
            } catch(e) {
                console.error(e);
                alert('선지정을 해제하지 못했습니다(인터넷 연결 확인).' + (e?.code ? ` (${e.code})` : ''));
            }
        }
    }
};

// ★ 가상 스크롤 전역 상태
const VS = {
    data: [],
    rowHeight: 42,
    bufferRows: 20,
    checkedIds: new Set(),
    scrollHandler: null
};

function renderTable(data) {
    VS.data = data;
    
    // 체크 상태 보존
    const checkedBoxes = document.querySelectorAll('.loc-check:checked');
    checkedBoxes.forEach(cb => { if (cb.value && cb.value !== 'on') VS.checkedIds.add(cb.value); });
    
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container) return;
    
    // 필터·검색이 바뀌면 지금 목록에 없는 줄의 선택은 버린다
    // (안 그러면 화면에 안 보이는 줄까지 '선택 수정'·'일괄 삭제' 대상이 된다)
    if (VS.checkedIds.size > 0) {
        const visibleIds = new Set(data.map(d => d.id));
        [...VS.checkedIds].forEach(id => { if (!visibleIds.has(id)) VS.checkedIds.delete(id); });
    }

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="padding:50px; color:var(--c-text-3);">데이터가 없습니다.</td></tr>';
        updateLocBulkBar();
        return;
    }
    
    // 스크롤 이벤트 등록 (1회)
    if (!VS.scrollHandler) {
        VS.scrollHandler = () => { requestAnimationFrame(() => renderVisibleRows()); };
        container.addEventListener('scroll', VS.scrollHandler);
    }
    
    renderVisibleRows();
    updateLocBulkBar();
}

function renderVisibleRows() {
    const container = document.getElementById('list-container');
    const tbody = document.getElementById('location-list-body');
    if (!tbody || !container || VS.data.length === 0) return;
    
    const totalRows = VS.data.length;
    const totalHeight = totalRows * VS.rowHeight;
    
    // thead 높이 감안 (약 45px)
    const scrollTop = Math.max(0, container.scrollTop - 45);
    const viewHeight = container.clientHeight;
    
    let startIdx = Math.floor(scrollTop / VS.rowHeight) - VS.bufferRows;
    let endIdx = Math.ceil((scrollTop + viewHeight) / VS.rowHeight) + VS.bufferRows;
    startIdx = Math.max(0, startIdx);
    endIdx = Math.min(totalRows, endIdx);
    
    const topPad = startIdx * VS.rowHeight;
    const bottomPad = (totalRows - endIdx) * VS.rowHeight;
    
    let html = '';
    if (topPad > 0) html += `<tr style="height:${topPad}px;"><td colspan="20"></td></tr>`;
    const _todayKst = kstDayKey(Date.now());     // 변경 추천 하루 표시(locRecMove)는 오늘(KST)만
    
    for (let i = startIdx; i < endIdx; i++) {
        const loc = VS.data[i];
        let rowClass = '';
        let codeTagHtml = '';

        // 행 높이 40px 이하 유지: 배지는 줄바꿈 없이 코드 옆에 붙인다
        if (loc.codeTag === '당일지정') {
            rowClass = 'row-today';
            codeTagHtml = `<span class="badge badge-accent list-tag">당일지정</span>`;
        } else if (loc.codeTag === '선지정') {
            rowClass = 'row-pre';
            codeTagHtml = `<span class="badge badge-risk list-tag">선지정</span>`;
        }
        // 변경 추천 [처리함]으로 오늘 옮긴 자리 — 들어온 자리 '추천변경', 비운 자리 흐린 '→새자리', 엑셀이 되돌렸으면 경고색
        const _mv = moveBadge(loc, _todayKst);
        if (_mv) {
            codeTagHtml += _mv.kind === 'out'
                ? `<span class="list-move-out" title="${escHtmlLite(_mv.title)}">${escHtmlLite(_mv.text)}</span>`
                : `<span class="badge ${_mv.kind === 'in' ? 'badge-ok' : 'badge-warn'} list-tag" title="${escHtmlLite(_mv.title)}">${escHtmlLite(_mv.text)}</span>`;
        }

        let isChecked = VS.checkedIds.has(loc.id) ? 'checked' : '';
        html += `<tr onclick="handleRowClick(event, '${jsArg(loc.id)}')" class="${rowClass}">`;
        html += `<td class="checkbox-cell" onclick="event.stopPropagation()"><input type="checkbox" class="loc-check" value="${loc.id}" ${isChecked} onchange="window.vsCheckChanged(this)"></td>`;
        window.visibleColumns.forEach(col => {
            if (col === 'std_dong') html += `<td style="color:var(--c-text-2);">${loc.dong || ''}</td>`;
            else if (col === 'std_pos') html += `<td style="color:var(--c-text-2);">${loc.pos || ''}</td>`;
            else if (col === 'std_id') {
                // ★ 칸수가 있으면 로케이션 끝에 (칸수) — 복사·예약은 자리 번호만
                const _ang = locAngleSize(loc);
                html += `<td class="loc-copy-cell" onclick="copyLocationToClipboard(event, '${jsArg(loc.id)}')" title="클릭하여 복사 및 예약">${loc.id}${_ang ? `<span class="list-sub">(${escHtmlLite(_ang)})</span>` : ''}</td>`;
            }
            else if (col === 'std_category') html += `<td style="color:${(loc.category || '피킹용') === '기타' ? 'var(--c-warn-text)' : 'var(--c-text-2)'};">${loc.category || '피킹용'}</td>`;
            else if (col === 'std_code') html += `<td style="color:var(--c-accent-deep); font-weight:600;">${loc.code === loc.id ? '' : (loc.code || '')}${codeTagHtml}</td>`;
            else if (col === 'std_name') html += `<td style="text-align:left;">${loc.name || ''}</td>`;
            else if (col === 'std_option') html += `<td style="text-align:left; font-size:12px;">${loc.option || ''}</td>`;
            else if (col === 'std_stock') html += `<td style="font-weight:600; font-variant-numeric:tabular-nums;">${loc.stock || '0'}</td>`;
            else if (col === 'std_stock2f') html += `<td style="font-weight:600; font-variant-numeric:tabular-nums;">${loc.stock2f || '0'}</td>`;
            else if (col.startsWith('cus_')) {
                const key = col.replace('cus_', '');
                let val = (loc.rawData && loc.rawData[key]) ? loc.rawData[key] : '';
                if (key === '칸수') val = locAngleSize(loc);
                // ★ 입고대기 컬럼은 오더리스트/사입리스트 합계로 덮어쓰기
                if (key === '입고대기') {
                    const code = (loc.code && loc.code !== loc.id) ? loc.code : '';
                    val = code && incomingTotalByCode[code] ? incomingTotalByCode[code] : '0';
                }
                html += `<td>${val}</td>`;
            }
        });
        html += `</tr>`;
    }
    
    if (bottomPad > 0) html += `<tr style="height:${bottomPad}px;"><td colspan="20"></td></tr>`;
    
    tbody.innerHTML = html;
}

// 체크박스 상태를 가상 스크롤에서 유지
window.vsCheckChanged = function(cb) {
    if (cb.checked) VS.checkedIds.add(cb.value);
    else VS.checkedIds.delete(cb.value);
    updateLocBulkBar();
};

// 선택 막대(체크한 줄의 동·위치·대분류·칸수 수정) 표시 갱신
function updateLocBulkBar() {
    const bar = document.getElementById('loc-bulk-bar');
    const cnt = document.getElementById('loc-bulk-count');
    if (!bar) return;
    const n = VS.checkedIds.size;
    if (cnt) cnt.textContent = n.toLocaleString();
    bar.style.display = n > 0 ? 'flex' : 'none';
}
window.updateLocBulkBar = updateLocBulkBar;

window.clearLocSelection = function () {
    VS.checkedIds.clear();
    const all = document.getElementById('check-all');
    if (all) all.checked = false;
    renderVisibleRows();
    updateLocBulkBar();
};

// toggleAllCheckboxes 오버라이드 - 전체 데이터 기준으로 동작
window.toggleAllCheckboxes = (source) => {
    if (source.checked) {
        VS.data.forEach(d => VS.checkedIds.add(d.id));
    } else {
        VS.checkedIds.clear();
    }
    renderVisibleRows();
    updateLocBulkBar();
};

const extractDataFromHTML = function(htmlString) {
    const parser = new DOMParser();
    const cleanHtml = htmlString.replace(/<br\s*[\/]?>/gi, " ");
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const rows = doc.querySelectorAll('tr');
    
    let rawData = [];
    for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll('th, td');
        let rowData = [];
        for (let j = 0; j < cells.length; j++) {
            rowData.push(cells[j].innerText.trim());
        }
        if (rowData.length > 0) rawData.push(rowData);
    }
    return rawData;
};

const smartParseToJSON = function(rawData) {
    if (!rawData || rawData.length === 0) return [];

    let headerRowIndex = -1;
    let pureHeaders = [];

    for (let i = 0; i < Math.min(30, rawData.length); i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        const cleanRow = row.map(h => (h || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, ''));
        
        if (cleanRow.includes('상품코드') || cleanRow.includes('어드민상품코드') || 
            cleanRow.includes('대표상품코드') || cleanRow.includes('품목코드') || 
            cleanRow.includes('바코드') || cleanRow.includes('로케이션')) {
            headerRowIndex = i;
            pureHeaders = row.map(h => (h || '').toString().replace(/\s+/g, '')); 
            break;
        }
    }

    if (headerRowIndex === -1) {
        headerRowIndex = 0;
        pureHeaders = (rawData[0] || []).map(h => (h || '').toString().replace(/\s+/g, ''));
    } 

    const parsedList = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || !Array.isArray(row)) continue;
        
        let rowObj = {};
        let isEmpty = true;
        
        for (let j = 0; j < pureHeaders.length; j++) {
            const key = pureHeaders[j];
            if (key && key !== '') {
                let val = row[j];
                if (val !== undefined && val !== "") {
                    rowObj[key] = val;
                    isEmpty = false;
                }
            }
        }
        if (!isEmpty) parsedList.push(rowObj);
    }
    return parsedList;
};

const universalExcelReader = (file) => {
    return new Promise((resolve) => {
        // ★ v3.95: 진단 헬퍼 - 텍스트에서 어떤 케이스인지 판단
        const diagnoseText = (text, parsedJson) => {
            if (!text) return 'unknown';
            // A. 프레임셋 HTML 감지
            if (text.includes('c_rgszSh') || text.includes('Excel Workbook Frameset') || /\.files\/sheet\d+\.htm/.test(text)) {
                return 'frameset';
            }
            // 데이터 행 분석
            if (parsedJson && parsedJson.length === 0) {
                return 'empty-table';
            }
            if (parsedJson && parsedJson.length > 0) {
                const isValid = parsedJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                if (!isValid) return 'no-required-header';
            }
            return 'unknown';
        };

        const bufferReader = new FileReader();
        bufferReader.onload = (eBuf) => {
            let json = [];
            try {
                const data = new Uint8Array(eBuf.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
                json = smartParseToJSON(rawData);
            } catch(e) {}

            const isValid = json.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
            if (json.length > 0 && isValid) {
                return resolve({ rows: json, diagnosis: 'ok' });
            }

            const textReader = new FileReader();
            textReader.onload = (eTxt) => {
                let text = eTxt.target.result;
                if (text.includes('<table') || text.includes('<TABLE') || text.includes('<html') || text.includes('<meta')) {
                    try {
                        const rawData = extractDataFromHTML(text); 
                        const utfJson = smartParseToJSON(rawData);
                        const isValidUtf = utfJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                        if (utfJson.length > 0 && isValidUtf) {
                            return resolve({ rows: utfJson, diagnosis: 'ok' });
                        }
                        const utfDiag = diagnoseText(text, utfJson);
                        if (utfDiag !== 'unknown') {
                            return resolve({ rows: [], diagnosis: utfDiag });
                        }
                    } catch(err) {}
                }

                const eucReader = new FileReader();
                eucReader.onload = (eEuc) => {
                    try {
                        let eucText = eEuc.target.result;
                        const rawData = extractDataFromHTML(eucText); 
                        const eucJson = smartParseToJSON(rawData);
                        const isValidEuc = eucJson.some(row => row['상품코드'] || row['어드민상품코드'] || row['대표상품코드'] || row['로케이션'] || row['품목코드'] || row['바코드']);
                        if (eucJson.length > 0 && isValidEuc) {
                            return resolve({ rows: eucJson, diagnosis: 'ok' });
                        }
                        const eucDiag = diagnoseText(text, eucJson);
                        if (eucDiag !== 'unknown') {
                            return resolve({ rows: [], diagnosis: eucDiag });
                        }
                        resolve({ rows: [], diagnosis: 'unknown' });
                    } catch(err) {
                        resolve({ rows: [], diagnosis: 'unknown' });
                    }
                };
                eucReader.readAsText(file, 'euc-kr');
            };
            textReader.readAsText(file, 'utf-8');
        };
        bufferReader.readAsArrayBuffer(file);
    });
};

// ★ v3.95: 업로드별 필수 헤더 안내 + 진단 코드별 alert 메시지 헬퍼
const _uploadHeaderGuide = {
    'permanent': '로케이션, 동, 위치, 칸수, 대분류(피킹/기타, 선택)',
    'daily':     '로케이션, 상품코드, 상품명, 옵션, 정상재고, 비축창고재고(옛 이름: 2층창고재고)',
    'zikjin':    '상품코드(또는 어드민상품코드/대표상품코드 등), 수량 또는 날짜별(YYYYMMDD) 출고수량 컬럼',
    'weekly':    '상품코드(또는 어드민상품코드/대표상품코드 등), 기간배송수량 또는 기간발주수량'
};

// 오류 안내에 붙일 짧은 코드 — 메시지 원문(문서 경로·주문번호가 섞일 수 있다)은 쓰지 않는다
function _errCode(e) { return (e && (e.code || e.name)) || 'unknown'; }

function _showUploadDiagnosisAlert(diagnosis, uploadType) {
    const headers = _uploadHeaderGuide[uploadType] || '';
    let msg = '';
    if (diagnosis === 'frameset') {
        msg = "잘못된 파일 형식입니다.\n\n" +
              "이 파일은 Excel에서 '웹 페이지(*.htm)' 형식으로 저장된 파일입니다.\n" +
              "실제 데이터가 별도 폴더에 분리되어 있어 시스템에서 읽을 수 없습니다.\n\n" +
              "해결 방법:\n" +
              "1. 파일을 Excel로 엽니다\n" +
              "2. [다른 이름으로 저장] → 형식을 'Excel 통합 문서(*.xlsx)' 로 선택\n" +
              "3. 다시 업로드해주세요";
    } else if (diagnosis === 'empty-table') {
        msg = "파일에 데이터 행이 없습니다.\n\n" +
              "헤더(첫 행)는 있지만 실제 데이터가 입력되지 않은 빈 파일입니다.\n" +
              "데이터가 입력된 파일을 업로드해주세요.";
    } else if (diagnosis === 'no-required-header') {
        msg = "파일에서 필수 컬럼을 찾을 수 없습니다.\n\n" +
              "이 업로드에 필요한 헤더: " + headers + "\n\n" +
              "해결 방법:\n" +
              "- 파일의 첫 행에 위 헤더가 정확히 입력되어 있는지 확인\n" +
              "- 한글이 깨져 보이면 UTF-8 또는 EUC-KR로 다시 저장";
    } else {
        msg = "데이터가 없습니다.\n\n" +
              "파일 형식 또는 내용을 다시 확인해주세요.\n" +
              "(예상 헤더: " + headers + ")";
    }
    alert(msg);
}

// 플랫폼 출고·주차별 업로드 — 기존 데이터를 통째로 바꾸므로 파일을 읽은 뒤 검사하고 한 번 더 묻는다(js/lib/upload-check.js).
//   상품코드·수량 열이 없으면 안내만 하고 멈춘다(로케이션 열만 있는 파일로 전부 지워지던 문제). 통과하고 [확인]이면 true.
function _confirmUploadB(file, rows, kind) {
    const chk = checkUploadB(rows, kind);
    if (!chk.ok) { _showUploadDiagnosisAlert('no-required-header', kind); return false; }
    const label = kind === 'zikjin' ? '플랫폼 출고' : '주차별';
    const extra = kind === 'zikjin' ? '\n(출고자동화가 보낸 기록도 지워집니다)' : '';
    return confirm(`${label} 파일 「${file.name}」 유효 ${chk.valid.toLocaleString()}줄(전체 ${chk.total.toLocaleString()}줄)로 기존 [${label}] 데이터를 모두 바꿉니다.${extra}\n\n계속할까요?`);
}

const fileInputZikjin = document.getElementById('excel-upload-zikjin');
if (fileInputZikjin) {
    fileInputZikjin.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('플랫폼 출고 파일을 읽는 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) {
                window.hideLoading();
                if (!_confirmUploadB(file, result.rows, 'zikjin')) { e.target.value=''; return; }
                window.showLoading('플랫폼 출고 데이터를 저장 중입니다...');
                await updateDatabaseB(result.rows, 'ZikjinData', e.target, false);
            }
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'zikjin'); e.target.value=''; }
        } catch(err) { window.hideLoading(); console.error('직진배송 파일 처리 실패:', _errCode(err)); alert(`플랫폼 출고 파일을 읽거나 저장하지 못했습니다.\n파일 형식(xlsx·csv)과 인터넷 연결을 확인한 뒤 다시 올려 주세요.\n(오류 코드: ${_errCode(err)})`); e.target.value=''; }
    });
}

const fileInputWeekly = document.getElementById('excel-upload-weekly');
if (fileInputWeekly) {
    fileInputWeekly.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('주차별 데이터를 분석 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) {
                window.hideLoading();
                if (!_confirmUploadB(file, result.rows, 'weekly')) { e.target.value=''; return; }
                window.showLoading('주차별 데이터를 저장 중입니다...');
                await updateDatabaseB(result.rows, 'WeeklyData', e.target, false);
            }
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'weekly'); e.target.value=''; }
        } catch(err) { window.hideLoading(); console.error('주차별 파일 처리 실패:', _errCode(err)); alert(`주차별 파일을 읽거나 저장하지 못했습니다.\n파일 형식(xlsx·csv)과 인터넷 연결을 확인한 뒤 다시 올려 주세요.\n(오류 코드: ${_errCode(err)})`); e.target.value=''; }
    });
}

const fileInputA = document.getElementById('excel-upload-a');
if (fileInputA) {
    fileInputA.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        // 머리줄 [오늘 재고 올리기] — 덮어쓰기라 파일을 고른 뒤 한 번 더 묻는다(취소하면 아무것도 쓰지 않는다).
        // 파일을 먼저 읽어(읽기만, 쓰기 없음) 몇 줄을 덮어쓰는지 확인창에 보여 준다(UX 개선 7번).
        window.showLoading('오늘 재고 파일을 읽는 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) {
                window.hideLoading();
                // 다른 사람이 오늘 재고·도면을 올리는 중이면 막는다(같은 자리를 동시에 덮어쓰면 섞인다). 상태를 못 읽으면 막지 않는다.
                const _other = await window.__locBusy.checkOthers();
                if (_other) { alert(uploadBlockText(_other)); return; }
                // 오늘 변경 추천 [처리함]으로 옮긴 자리가 이 엑셀에서는 옛 자리면 먼저 알린다(계속하면 엑셀이 이긴다)
                const _mvConf = uploadMoveConflicts(result.rows, originalData, kstDayKey(Date.now()));
                if (_mvConf.length && !confirm(uploadConflictText(_mvConf))) return;
                if (!confirm(`오늘 재고 파일 「${file.name}」 ${result.rows.length.toLocaleString()}줄로 기존 로케이션 재고를 덮어씁니다.\n(파일에 없는 자리의 재고는 비워집니다 · 선지정된 자리는 보호됩니다)\n\n계속할까요?`)) return;
                window.showLoading('일일 재고/상품 데이터를 최신화 중입니다...');
                // 다른 사람 화면에 '오늘 재고 올리는 중' 띠 — 끝나면 done/failed. 기록 실패는 업로드를 막지 않는다
                // 시작 기록은 트랜잭션 — 두 사람이 확인창을 동시에 눌러도 한쪽만 통과한다(남은 쪽은 여기서 막힘)
                const _bg = await window.__locBusy.begin('daily');
                if (_bg.busy) { window.hideLoading(); alert(uploadBlockText(_bg.busy)); return; }
                let _upOk = false;
                try { _upOk = (await updateDatabaseA(result.rows, 'daily')) === true; }
                finally { window.__locBusy.end(_upOk); }
                // 🕒 데이터 최신화 시각 기록 (헤더 표시용)
                try { await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { lastDataUpdate: Date.now() }, { merge: true }); } catch(_) {}
            }
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'daily'); }
        } catch(err) { window.hideLoading(); console.error('오늘 재고 파일 처리 실패:', _errCode(err)); alert(`오늘 재고 파일을 읽거나 반영하지 못했습니다.\n파일 형식(xlsx·csv)과 인터넷 연결을 확인한 뒤 같은 파일을 다시 올려 주세요.\n(오류 코드: ${_errCode(err)})`); }
        finally { e.target.value=''; }
    });
}

const fileInputPerm = document.getElementById('excel-upload-permanent');
if (fileInputPerm) {
    fileInputPerm.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        // 덮어쓰기라 파일을 읽은 뒤 검사하고 한 번 더 묻는다('오늘 재고 올리기'와 같은 방식 · js/lib/upload-check.js)
        window.showLoading('도면(동/위치) 파일을 읽는 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if(result.rows.length > 0) {
                window.hideLoading();
                // 오늘 재고 올리기와 같은 문서·같은 규칙 — 남이 올리는 중이면 막는다
                const _other = await window.__locBusy.checkOthers();
                if (_other) { alert(uploadBlockText(_other)); return; }
                const chk = checkPermanent(result.rows);
                if (!chk.ok) { _showUploadDiagnosisAlert('no-required-header', 'permanent'); return; }
                const newCnt = newLocIds(result.rows, originalData.map(d => d.id)).length;
                if (!confirm(`도면 파일 「${file.name}」 ${chk.valid.toLocaleString()}줄로 동/위치/칸수를 덮어씁니다 · 없던 로케이션 ${newCnt.toLocaleString()}개가 새로 생깁니다.\n\n계속할까요?`)) return;
                window.showLoading('도면(동/위치) 영구 데이터를 덮어쓰기 세팅 중입니다...');
                const _bg = await window.__locBusy.begin('permanent');
                if (_bg.busy) { window.hideLoading(); alert(uploadBlockText(_bg.busy)); return; }
                let _upOk = false;
                try { _upOk = (await updateDatabaseA(result.rows, 'permanent')) === true; }
                finally { window.__locBusy.end(_upOk); }
            }
            else { window.hideLoading(); _showUploadDiagnosisAlert(result.diagnosis, 'permanent'); }
        } catch(err) { window.hideLoading(); console.error('도면 파일 처리 실패:', _errCode(err)); alert(`도면(동/위치) 파일을 읽거나 반영하지 못했습니다.\n파일 형식(xlsx·csv)과 인터넷 연결을 확인한 뒤 같은 파일을 다시 올려 주세요.\n(오류 코드: ${_errCode(err)})`); }
        finally { e.target.value=''; }
    });
}

// ===== v3.97a: 주문 페어 분석 (청크 압축 + 중복 방지) =====
const ORDER_PAIRS_COLL = 'OrderPairsChunks';
const ORDER_STATS_COLL = 'OrderStatsChunks';
const PROCESSED_ORDERS_COLL = 'ProcessedOrders';
// 보안(2026-10-14): ProcessedOrders 문서 ID = 주문번호 해시(lib/order-hash.js). 원문 주문번호는 저장·출력하지 않는다.
// 옛 원문 ID 문서는 2026-10-16 해시로 옮겼고(앱\보안점검\주문번호_해시이전.py), 2026-10-21 재확인에서 0 건 → 해시 ID 만 조회한다.
const CHUNK_SIZE_PAIRS = 200;
const CHUNK_SIZE_STATS = 200;

// 주문 데이터 파일 업로드 핸들러
const fileInputOrders = document.getElementById('excel-upload-orders');
if (fileInputOrders) {
    fileInputOrders.addEventListener('change', async function(e) {
        const file = e.target.files[0]; if (!file) return;
        window.showLoading('주문 데이터를 분석 중입니다...');
        try {
            const result = await universalExcelReader(file);
            if (result.rows.length > 0) {
                await window.processOrderData(result.rows);
            } else {
                window.hideLoading();
                _showUploadDiagnosisAlert(result.diagnosis, 'orders');
                e.target.value = '';
            }
        } catch (err) {
            window.hideLoading();
            // 오류 문구에 주문번호가 섞일 수 있어 코드·이름만 남긴다
            console.error('주문 파일 처리 오류:', (err && (err.code || err.name)) || 'unknown');
            alert('오류 발생: ' + ((err && (err.code || err.name)) || '알 수 없는 오류'));
            e.target.value = '';
        } finally {
            e.target.value = '';
        }
    });
}

// 💰 읽기 요금 최적화: ProcessedOrders 전체 스캔 대신 "업로드 파일의 주문번호"만 조회.
// 기존엔 getDocs(collection) 로 누적된 모든 처리주문(수만 건)을 매 업로드마다 읽어 읽기 폭탄이었음.
// documentId() in [...] 배치 쿼리는 실제로 존재(중복)하는 문서만 읽으므로,
// 읽기량이 "누적 전체"가 아니라 "이번 파일과 겹치는 소수"에만 비례한다.
// keyMap: Map(주문번호 원문 → 해시 ID). 돌려주는 값은 이미 처리된 '원문' 집합(메모리에서만 씀).
async function fetchExistingProcessedOrders(keyMap) {
    const CHUNK = 30;       // Firestore 'in' 최대 30개
    const CONCURRENCY = 10; // 동시 쿼리 수 제한 (과다 병렬 방지)
    const queryIds = async (ids) => {
        const found = new Set();
        const chunks = [];
        for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
            const group = chunks.slice(i, i + CONCURRENCY);
            const snaps = await Promise.all(group.map(part =>
                getDocs(query(collection(db, PROCESSED_ORDERS_COLL), where(documentId(), 'in', part)))
            ));
            snaps.forEach(snap => snap.forEach(d => found.add(d.id)));
        }
        return found;
    };
    const existing = new Set();
    const hashFound = await queryIds([...keyMap.values()]);
    keyMap.forEach((key, ono) => { if (hashFound.has(key)) existing.add(ono); });
    return existing;
}

// 주문 데이터 처리: 중복 검사 → 신규만 자동 누적 저장
window.processOrderData = async function(rows) {
    try {
        window.showLoading('주문번호별로 그룹화 중...');
        // 1. 주문번호별 그룹화
        const orderMap = {};
        for (const row of rows) {
            const orderNo = (row['주문번호'] || '').toString().trim();
            const code = (row['상품코드'] || row['바코드'] || '').toString().trim();
            const orderDate = (row['주문일'] || '').toString().trim();
            if (!orderNo || !code) continue;
            if (!orderMap[orderNo]) orderMap[orderNo] = { codes: new Set(), date: orderDate };
            orderMap[orderNo].codes.add(code);
        }

        const orderNos = Object.keys(orderMap);
        if (orderNos.length === 0) {
            window.hideLoading();
            alert('처리할 주문 데이터가 없습니다.');
            return;
        }

        // 2. 기존 ProcessedOrders 조회 (중복 업로드 방지)
        // 💰 전체 스캔 대신 이번 파일의 주문번호만 조회 → 읽기 요금 대폭 절감
        window.showLoading('중복 주문 검사 중...');
        const keyMap = await orderKeyMap(orderNos); // 주문번호 원문 → 해시 ID (원문은 메모리에서만)
        const processedSet = await fetchExistingProcessedOrders(keyMap);

        // 3. 신규 주문만 필터링
        const targetOrderNos = orderNos.filter(ono => !processedSet.has(ono));
        const dupCount = orderNos.length - targetOrderNos.length;

        if (targetOrderNos.length === 0) {
            window.hideLoading();
            alert(`모든 주문이 이미 처리되었습니다.\n\n파일 총 주문: ${orderNos.length.toLocaleString()}건\n이미 처리됨: ${dupCount.toLocaleString()}건\n\n이전에 같은 파일을 업로드했을 가능성이 큽니다.`);
            return;
        }

        // 4. 페어/단독 카운트 집계 (신규분만)
        window.showLoading('페어 통계 계산 중...');
        const newPairCounts = {};
        const newCodeCounts = {};
        let latestDate = '';

        for (const ono of targetOrderNos) {
            const obj = orderMap[ono];
            if (!obj) continue;
            const codes = [...obj.codes].sort();
            const date = obj.date;
            if (date > latestDate) latestDate = date;

            // 단독 카운트
            for (const c of codes) {
                if (!newCodeCounts[c]) newCodeCounts[c] = { count: 0, lastDate: '' };
                newCodeCounts[c].count++;
                if (date > newCodeCounts[c].lastDate) newCodeCounts[c].lastDate = date;
            }

            // 페어 카운트
            if (codes.length >= 2) {
                for (let i = 0; i < codes.length; i++) {
                    for (let j = i + 1; j < codes.length; j++) {
                        const pairId = codes[i] + '__' + codes[j];
                        if (!newPairCounts[pairId]) newPairCounts[pairId] = { count: 0, lastDate: '' };
                        newPairCounts[pairId].count++;
                        if (date > newPairCounts[pairId].lastDate) newPairCounts[pairId].lastDate = date;
                    }
                }
            }
        }

        // 5. 기존 청크 로드 + 병합
        window.showLoading('기존 누적 데이터와 병합 중...');
        const existingPairs = {};
        const existingStats = {};

        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => {
                    const pid = p.cA + '__' + p.cB;
                    existingPairs[pid] = { codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d };
                });
            } catch (e) {}
        });

        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => {
                    existingStats[s.c] = { code: s.c, count: s.n, lastDate: s.d };
                });
            } catch (e) {}
        });

        // 병합
        for (const code in newCodeCounts) {
            const nd = newCodeCounts[code];
            if (existingStats[code]) {
                existingStats[code].count += nd.count;
                if (nd.lastDate > existingStats[code].lastDate) existingStats[code].lastDate = nd.lastDate;
            } else {
                existingStats[code] = { code, count: nd.count, lastDate: nd.lastDate };
            }
        }
        for (const pid in newPairCounts) {
            const nd = newPairCounts[pid];
            const [codeA, codeB] = pid.split('__');
            if (existingPairs[pid]) {
                existingPairs[pid].count += nd.count;
                if (nd.lastDate > existingPairs[pid].lastDate) existingPairs[pid].lastDate = nd.lastDate;
            } else {
                existingPairs[pid] = { codeA, codeB, count: nd.count, lastDate: nd.lastDate };
            }
        }

        // 6. 청크 압축 저장 (기존 청크 삭제 후 다시 작성)
        window.showLoading('분석 결과 저장 중...');

        let batch = writeBatch(db);
        let bc = 0;
        pairsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();

        batch = writeBatch(db);
        bc = 0;
        statsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();

        // 새 청크 작성 (페어)
        const allPairs = Object.values(existingPairs).map(p => ({ cA: p.codeA, cB: p.codeB, c: p.count, d: p.lastDate }));
        batch = writeBatch(db);
        bc = 0;
        let chunkIdx = 0;
        for (let i = 0; i < allPairs.length; i += CHUNK_SIZE_PAIRS) {
            const chunk = allPairs.slice(i, i + CHUNK_SIZE_PAIRS);
            const docRef = doc(db, ORDER_PAIRS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 새 청크 작성 (단독)
        const allStats = Object.values(existingStats).map(s => ({ c: s.code, n: s.count, d: s.lastDate }));
        batch = writeBatch(db);
        bc = 0;
        chunkIdx = 0;
        for (let i = 0; i < allStats.length; i += CHUNK_SIZE_STATS) {
            const chunk = allStats.slice(i, i + CHUNK_SIZE_STATS);
            const docRef = doc(db, ORDER_STATS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 7. ProcessedOrders 추가 (처리한 주문 — 문서 ID 는 해시, 본문은 날짜·시각뿐)
        window.showLoading('처리 이력 저장 중...');
        batch = writeBatch(db);
        bc = 0;
        for (const ono of targetOrderNos) {
            const obj = orderMap[ono];
            const docRef = doc(db, PROCESSED_ORDERS_COLL, keyMap.get(ono));
            batch.set(docRef, { date: obj.date || latestDate, at: Date.now() }, { merge: true });
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();

        // 8. 메타정보 갱신 (누적 처리 주문수 더하기)
        let prevTotal = 0;
        try {
            const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
            if (cfgSnap.exists()) {
                const prevMeta = cfgSnap.data().orderAnalysisMeta || {};
                prevTotal = prevMeta.totalProcessedOrders || 0;
            }
        } catch (e) {}
        const metaUpdate = {
            orderAnalysisMeta: {
                lastUploadDate: latestDate || toDateStr(),
                lastUploadAt: Date.now(),
                totalProcessedOrders: prevTotal + targetOrderNos.length,
                totalPairs: Object.keys(existingPairs).length,
                totalCodes: Object.keys(existingStats).length
            }
        };
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), metaUpdate, { merge: true });

        window.hideLoading();

        // 9. 결과 alert + 자동 리포트 표시
        let msg = `주문 데이터 분석 완료!\n\n`;
        msg += `파일 총 주문: ${orderNos.length.toLocaleString()}건\n`;
        msg += `신규 처리: ${targetOrderNos.length.toLocaleString()}건\n`;
        if (dupCount > 0) msg += `이미 처리됨 (건너뜀): ${dupCount.toLocaleString()}건\n`;
        msg += `\n누적 페어: ${Object.keys(existingPairs).length.toLocaleString()}개\n`;
        msg += `누적 상품: ${Object.keys(existingStats).length.toLocaleString()}개\n\n`;
        msg += `자세한 리포트는 [페어 분석 리포트 보기]에서 확인하세요.`;
        showToast(msg);
        
        // 💰 읽기요금 절감: 방금 병합한 메모리 데이터로 페어 캐시를 직접 갱신.
        //    (기존엔 loadOrderPairsCache()가 PAIRS/STATS 전체를 Firestore에서 다시 읽어 급등 원인)
        try {
            window._cachedOrderPairs = Object.values(existingPairs).map(p => ({ codeA: p.codeA, codeB: p.codeB, count: p.count, lastDate: p.lastDate }));
            window._cachedOrderStats = existingStats;
            window._cachedOrderMeta = metaUpdate.orderAnalysisMeta;
            console.log(`[읽기절감] 업로드 후 페어 캐시를 메모리로 갱신(재읽기 0): 페어 ${window._cachedOrderPairs.length}, 상품 ${Object.keys(existingStats).length}`);
        } catch (e) {
            console.warn('페어 캐시 메모리 갱신 실패, 폴백으로 재로드:', e);
            if (typeof window.loadOrderPairsCache === 'function') window.loadOrderPairsCache();
        }

        // v4.4 v3: 주문 업로드 후 자동 팝업 호출 삭제
        // 사용자가 [📊 페어 분석 리포트 보기] 버튼을 직접 클릭해서 열도록 변경
        // window.openOrderAnalysisReport();
    } catch (e) {
        window.hideLoading();
        // 오류 문구(문서 경로 등)에 주문번호가 섞일 수 있어 코드·이름만 남긴다
        const why = (e && (e.code || e.name)) || '알 수 없는 오류';
        console.error('processOrderData 오류:', why);
        alert('주문 데이터 처리 중 오류가 발생했습니다.\n' + why);
    }
};

// 분석 리포트 모달 열기
window.openOrderAnalysisReport = async function() {
    document.getElementById('order-analysis-modal').style.display = 'flex';
    document.getElementById('order-analysis-summary').innerHTML = '<div style="text-align:center; color:var(--c-text-2);">데이터 로딩 중...</div>';
    document.getElementById('order-analysis-tbody').innerHTML = '';
    window.showLoading('분석 리포트 로딩 중...');

    try {
        let meta = {};
        const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
        if (cfgSnap.exists()) meta = cfgSnap.data().orderAnalysisMeta || {};

        let pairs = [];
        let stats = {};
        // 💰 읽기요금 절감: 캐시가 있으면 재사용(창 열기·업로드·정리 때 이미 로드됨). 없을 때만 전체 스캔.
        if (Array.isArray(window._cachedOrderPairs) && window._cachedOrderPairs.length > 0
            && window._cachedOrderStats && Object.keys(window._cachedOrderStats).length > 0) {
            pairs = window._cachedOrderPairs;
            stats = window._cachedOrderStats;
            console.log('[읽기절감] 리포트: 페어 캐시 재사용(재읽기 0)');
        } else {
            const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
            pairsSnap.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(p => pairs.push({ codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d }));
                } catch (e) {}
            });

            const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
            statsSnap.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(s => { stats[s.c] = { code: s.c, count: s.n, lastDate: s.d }; });
                } catch (e) {}
            });
        }

        const totalOrdersEstimate = meta.totalProcessedOrders || 1;
        const pairsWithLift = pairs.map(p => {
            const cntA = (stats[p.codeA] && stats[p.codeA].count) || 1;
            const cntB = (stats[p.codeB] && stats[p.codeB].count) || 1;
            const lift = (p.count * totalOrdersEstimate) / (cntA * cntB);
            return { ...p, lift };
        });

        const trustedPairs = pairsWithLift
            .filter(p => p.count >= 5 && p.lift >= 2.0)
            .sort((a, b) => (b.lift * b.count) - (a.lift * a.count));

        let summaryHtml = `
            <div style="display:flex; justify-content:space-around; flex-wrap:wrap; gap:15px;">
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2);">최근 업로드</div>
                    <div style="font-size:14px; color:var(--c-accent-deep); font-weight:600;">${meta.lastUploadDate || '-'}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2);">처리한 주문 건수</div>
                    <div style="font-size:18px; color:var(--c-accent-deep); font-weight:700;">${(meta.totalProcessedOrders || 0).toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2);">분석된 상품 종류</div>
                    <div style="font-size:18px; color:var(--c-accent-deep); font-weight:700;">${Object.keys(stats).length.toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2);">함께 팔린 상품 조합</div>
                    <div style="font-size:18px; color:var(--c-accent-deep); font-weight:700;">${pairs.length.toLocaleString()}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:11px; color:var(--c-text-2);">자주 함께 팔리는 조합</div>
                    <div style="font-size:22px; color:var(--c-accent); font-weight:700;">${trustedPairs.length.toLocaleString()}</div>
                </div>
            </div>
        `;
        document.getElementById('order-analysis-summary').innerHTML = summaryHtml;

        const top30 = trustedPairs.slice(0, 30);
        let html = '';
        if (top30.length === 0) {
            html = '<tr><td colspan="7" style="padding:40px; color:var(--c-text-3);">데이터를 더 누적하면 페어가 생성됩니다.</td></tr>';
        } else {
            // v3.99: 상품 상세 정보 HTML 생성 헬퍼
            const buildProductCell = (code) => {
                const matches = originalData.filter(d => d.code === code);
                if (matches.length === 0) {
                    return `<div style="font-weight:600; color:var(--c-accent-deep);">${code}</div>` +
                           `<div style="font-size:11px; color:var(--c-text-3); margin-top:2px;">로케이션 없음</div>`;
                }
                const loc = matches[0];
                const name = (loc.name || '').toString().trim();
                const option = (loc.option || '').toString().trim();
                const locId = (loc.id || '').toString().trim();
                const dupBadge = matches.length > 1
                    ? `<span style="display:inline-block; background:var(--c-warn-soft); color:var(--c-warn-text); padding:1px 6px; border-radius:var(--r-pill); font-size:9px; font-weight:600; margin-left:4px;" title="같은 상품코드가 ${matches.length}개 자리에 있습니다 (데이터 이상)">${matches.length}자리</span>`
                    : '';
                const optionHtml = option ? `<span style="color:var(--c-text-2); font-weight:normal; font-size:11px; margin-left:4px;">[${option}]</span>` : '';
                const locHtml = locId ? `<div style="font-size:11px; color:var(--c-ok-text); margin-top:2px;">${locId}${dupBadge}</div>` : `<div style="font-size:11px; color:var(--c-text-3); margin-top:2px;">자리 없음${dupBadge}</div>`;
                const nameHtml = name ? `<div style="font-size:11px; color:var(--c-text-2); margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:190px;" title="${name}">${name}</div>` : '';
                return `<div style="font-weight:600; color:var(--c-accent-deep);">${code}${optionHtml}</div>` + locHtml + nameHtml;
            };
            
            top30.forEach((p, idx) => {
                const locA = originalData.find(d => d.code === p.codeA);
                const locB = originalData.find(d => d.code === p.codeB);
                let distance = (locA && locB && locA.dong === locB.dong && locA.dong !== '') 
                    ? `<span style="color:var(--c-ok-text); font-weight:600;">같은 동</span>`
                    : `<span style="color:var(--c-risk-text); font-weight:600;">다른 동</span>`;
                html += `<tr style="background:${idx % 2 === 0 ? 'var(--c-surface)' : 'var(--c-surface-2)'};">
                    <td style="font-weight:600; color:var(--c-text-2);">${idx+1}</td>
                    <td style="text-align:left; padding:8px 10px;">${buildProductCell(p.codeA)}</td>
                    <td style="text-align:left; padding:8px 10px;">${buildProductCell(p.codeB)}</td>
                    <td style="font-weight:600; color:var(--c-accent-deep);">${p.count}회</td>
                    <td style="font-weight:600; color:var(--c-warn-text);">${p.lift.toFixed(2)}</td>
                    <td style="font-size:11px;">${p.lastDate || '-'}</td><td>${distance}</td></tr>`;
            });
        }
        document.getElementById('order-analysis-tbody').innerHTML = html;
    } catch (e) {
        console.error('리포트 로드 오류:', e);
        document.getElementById('order-analysis-summary').innerHTML = `<div style="color:var(--c-risk-text);">로드 실패: ${escAttr(e && e.message || e)}</div>`;
    } finally {
        window.hideLoading();
    }
};

// 누적 데이터 전체 초기화
window.resetOrderAnalysis = async function() {
    if (!confirm('함께 팔리는 상품 조합·통계·처리한 주문 기록이 모두 지워집니다. 되돌릴 수 없습니다. 계속할까요?')) return;
    // 지워질 건수 — 이미 불러 둔 요약(_cachedOrderMeta)에 있을 때만 붙인다(여기서 새로 읽지 않음)
    const _rm = window._cachedOrderMeta || {};
    const _rmCnt = (label, n, unit) => (Number(n) > 0 ? ` ${label} ${Number(n).toLocaleString()}${unit}` : '');
    const _rmDetail = [_rmCnt('짝', _rm.totalPairs, '개'), _rmCnt('상품', _rm.totalCodes, '개'), _rmCnt('처리한 주문', _rm.totalProcessedOrders, '건')].filter(Boolean).join(',');
    if (!confirm(`주문 짝 통계·주문 통계·처리한 주문 기록이 모두 삭제됩니다.${_rmDetail ? `\n(현재 기록:${_rmDetail})` : ''}\n정말 계속하시겠습니까?`)) return;
    window.showLoading('누적 데이터 삭제 중...');
    try {
        const colls = [ORDER_PAIRS_COLL, ORDER_STATS_COLL, PROCESSED_ORDERS_COLL];
        for (const collName of colls) {
            const snap = await getDocs(collection(db, collName));
            let batch = writeBatch(db); let bc = 0;
            snap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
            if (bc > 0) await batch.commit();
        }
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { orderAnalysisMeta: deleteField() }, { merge: true });
        window.hideLoading();
        showToast('누적 데이터를 모두 삭제했습니다.');
        document.getElementById('order-analysis-modal').style.display = 'none';
        
        // v3.98: 페어 캐시 초기화
        window._cachedOrderPairs = [];
        window._cachedOrderStats = {};
        window._cachedOrderMeta = {};
    } catch (e) {
        window.hideLoading(); console.error('초기화 오류:', e);
        alert('누적 데이터를 초기화하지 못했습니다(인터넷 연결 확인). 일부는 지워졌을 수 있으니 다시 시도하세요.' + (e?.code ? ` (${e.code})` : ''));
    }
};

async function updateDatabaseB(rows, collectionName, inputElement, silent = false) {
    let label = collectionName === 'ZikjinData' ? '플랫폼 출고' : (collectionName === 'WeeklyData' ? '주차별' : '데이터');
    try {
        // 걸러내기를 지우기보다 먼저 — 상품코드가 있는 줄이 하나도 없으면 기존 데이터를 지우지 않고 멈춘다(2026-10-20)
        const validRows = rows.filter(row => codeOfRowB(row));
        if (validRows.length === 0) {
            const err = new Error('상품코드가 있는 줄이 없어 기존 데이터를 지우지 않았습니다');
            err.code = 'no-valid-rows';
            throw err;
        }

        const querySnapshot = await getDocs(collection(db, collectionName));

        const CHUNK_SIZE = 200;
        const chunks = [];
        for (let i = 0; i < validRows.length; i += CHUNK_SIZE) chunks.push(validRows.slice(i, i + CHUNK_SIZE));
        const chunkCount = chunks.length;
        const setChunks = (batch) => chunks.forEach((chunk, n) =>
            batch.set(doc(db, collectionName, `CHUNK_${n}`), { dataStr: JSON.stringify(chunk), updatedAt: new Date() }));

        // 지우기·쓰기를 한 batch 로(2026-10-20) — 따로 commit 하면 쓰기가 실패했을 때 0건으로 남는다.
        //   새로 쓸 CHUNK 문서는 set 이 통째로 덮으므로 지우지 않고, 남는 옛 문서만 지운다.
        //   batch 는 한 번에 500건까지라, 지울 문서 + 쓸 문서가 500 을 넘으면(현실적으로는 없음 — 청크 1개 = 200줄)
        //   예전처럼 지우기 → 쓰기를 따로 commit 한다(이때는 쓰기 실패 시 비는 위험이 그대로 남는다).
        const writeIds = new Set(chunks.map((_, n) => `CHUNK_${n}`));
        const staleDocs = querySnapshot.docs.filter(d => !writeIds.has(d.id));
        if (querySnapshot.docs.length + chunkCount <= 500) {
            const batch = writeBatch(db);
            staleDocs.forEach(d => batch.delete(d.ref));
            setChunks(batch);
            await batch.commit();
        } else {
            const delBatch = writeBatch(db);
            querySnapshot.docs.forEach(d => delBatch.delete(d.ref));
            await delBatch.commit();
            const batch = writeBatch(db);
            setChunks(batch);
            await batch.commit();
        }

        // 📌 전송 기록 메타 저장(언제/얼마나) — 플랫폼 출고·주차별
        try {
            const metaKey = collectionName === 'ZikjinData' ? 'zikjinMeta'
                : (collectionName === 'WeeklyData' ? 'weeklyMeta' : null);
            if (metaKey) {
                await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'),
                    { [metaKey]: { at: Date.now(), count: validRows.length } }, { merge: true });
            }
        } catch (e) { console.warn('전송 기록 메타 저장 실패:', e); }

        if (!silent) showToast(`[${label}] 저장 완료 — ${validRows.length}건을 ${chunkCount}번의 쓰기로 반영했습니다.`);
        
    } catch (error) { 
        console.error(`${label} 실패:`, error); 
        if (!silent) alert(`${label} 중 오류가 발생했습니다.`); 
        throw error; 
    } finally { 
        if(inputElement && !silent) inputElement.value = ''; 
        if (!silent) window.hideLoading(); 
    }
}

async function updateDatabaseA(rows, mode = 'daily') {
    const totalRows = rows.length;

    // 🔎 '한 로케이션에 2+ 상품' 충돌 감지 (업로드 행 기준; 저장 시 같은 로케이션은 마지막 행만 남아 충돌이 사라지므로 여기서 포착)
    if (mode === 'daily') {
        try {
            const _locCodes = {};
            rows.forEach(row => {
                const raw = (row['로케이션'] || '').toString().trim();
                if (!raw) return;
                const loc = raw.includes('(') ? raw.split('(')[0].trim() : raw;
                let code = '';
                if (raw.includes('(')) { const af = raw.substring(raw.indexOf('(')); const si = af.indexOf('S'); if (si !== -1) code = af.substring(si).trim(); }
                if (!code) code = (row['상품코드'] || '').toString().trim();
                if (!loc || !code) return;
                (_locCodes[loc] = _locCodes[loc] || new Set()).add(code);
            });
            window.__dupLocations = Object.entries(_locCodes)
                .filter(([, s]) => s.size >= 2)
                .map(([loc, s]) => ({ loc, codes: [...s] }));
            setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { dupLocations: window.__dupLocations, dupLocationsAt: Date.now() }, { merge: true }).catch(() => {});
        } catch (e) { console.warn('[dupLoc] 충돌 감지 실패:', e); }
    }

    try {
        // ★ 모든 행의 키를 합쳐서 전체 헤더 추출 (첫 행에 빈 값이면 키가 누락되는 문제 해결)
        const allHeadersSet = new Set();
        rows.forEach(row => { Object.keys(row).forEach(k => allHeadersSet.add(k)); });
        const allHeaders = [...allHeadersSet];
        // '로케이션1'(다운로드가 만드는 합친 표기)은 다시 올려도 원본 열로 쌓지 않는다
        const excludeRaw = ['동', 'dong', '위치', 'pos', '상품코드', '로케이션', '로케이션1', '상품명', '옵션', '정상재고', '비축창고재고', '2층창고재고', '대분류'];
        // 공백제거 버전도 제외 목록에 포함
        const exclude = [...new Set([...excludeRaw, ...excludeRaw.map(h => h.replace(/\s+/g, ''))])];
        
        const customHeaders = allHeaders.filter(h => {
            const clean = h.replace(/\s+/g, '');
            return clean !== '' && 
                   !h.toUpperCase().includes('EMPTY') &&
                   !h.includes('<') && !h.includes('>') && !h.includes('=') &&
                   !exclude.includes(h) &&
                   !exclude.includes(clean) &&
                   !isCostCol(h); // 보안(2026-10-14): 원가 열은 저장하지 않는다
        });
        
        const newHeaders = [...new Set([...window.excelHeaders, ...customHeaders])].filter(h => !isDroppedHeader(h));
        // 원가 열이 빠져 목록이 줄어든 경우에도 다시 쓴다(옛 설정에 남은 원가 머리글 정리)
        const hasNewHeader = customHeaders.some(h => !window.excelHeaders.includes(h)) || newHeaders.length !== window.excelHeaders.length || !!window.__excelHeadersHadDropped;
        const _droppedCostHeaders = allHeaders.filter(h => isCostCol(h));
        let _supplierNamesRemoved = 0;
        
        // ★ 디버그 로그
        console.log('=== [DEBUG] 최신화 ===');
        console.log('allHeaders:', allHeaders.length, '개 →', allHeaders);
        console.log('customHeaders:', customHeaders.length, '개 →', customHeaders);
        
        if (hasNewHeader) {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { excelHeaders: newHeaders }, { merge: true });
            window.excelHeaders = newHeaders;
            window.__excelHeadersHadDropped = false;
        }
        
        let batch = writeBatch(db); 
        let updateCount = 0; 
        let skipCount = 0;
        let zoneUpdates = {};
        
        // v4.4: 2F SKU 카운트 (로케이션이 "2F-..." 형태인 행의 고유 상품코드 수)
        const twoFloorCodes = new Set();
        let twoFloorStockSum = 0;
        
        let existingLocMap = {};
        originalData.forEach(d => { existingLocMap[d.id] = d; });
        
        if (mode === 'daily') {
            originalData.forEach(loc => {
                const zoneDocId = getZoneDocId(loc.id);
                if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                
                zoneUpdates[zoneDocId][loc.id] = {
                    dong: loc.dong || '',
                    pos: loc.pos || '',
                    code: '',
                    name: '',
                    option: '',
                    stock: '0',
                    stock2f: '0',
                    reserved: false,
                    reservedAt: 0,
                    reservedBy: '',
                    assignedAt: 0,
                    updatedAt: new Date(),
                    rawDataStr: '{}',
                    rawData: deleteField(),
                    preAssigned: loc.preAssigned || false,
                    preAssignedCode: loc.preAssignedCode || '',
                    preAssignedName: loc.preAssignedName || '',
                    preAssignedQty: loc.preAssignedQty || '',
                    preAssignedAt: loc.preAssignedAt || 0,
                    codeTag: loc.codeTag || '',
                    codeTagAt: loc.codeTagAt || 0
                };
            });
        }
        
        // ★ permanent(영구보전) 업로드의 '대분류' 헤더 값 → 위치 카테고리(피킹용/기타) 정규화
        const normalizeLocCategory = (raw) => {
            const v = (raw || '').toString().trim();
            if (!v) return null;
            if (v.includes('기타')) return '기타';
            if (v.includes('피킹')) return '피킹용';
            return null;
        };

        for (let i = 0; i < totalRows; i++) {
            const row = rows[i];

            // ★ 커스텀 헤더(원본 데이터) 스냅샷 — '로케이션'/'옵션추가항목1' 두 경로 모두에서 공용으로 사용
            let cleanRawData = {};
            customHeaders.forEach(k => {
                // 엑셀 파싱 키와 customHeader 키 매칭 (공백/특수문자 무시)
                const normalizeKey = (s) => (s || '').toString().replace(/[\s ​﻿]/g, '');
                const normK = normalizeKey(k);

                // row에서 직접 매칭 시도
                let rawVal = row[k];
                if (rawVal === undefined) rawVal = row[normK];

                // 그래도 없으면 row의 모든 키를 정규화해서 비교
                if (rawVal === undefined) {
                    for (const rowKey of Object.keys(row)) {
                        if (normalizeKey(rowKey) === normK) {
                            rawVal = row[rowKey];
                            break;
                        }
                    }
                }

                if(rawVal !== undefined && rawVal !== null && rawVal.toString().trim() !== "") {
                    const strVal = rawVal.toString().trim();
                    const numVal = parseFloat(strVal);
                    if(!isNaN(numVal) && numVal > 40000 && numVal < 60000 && strVal.includes('.')) {
                        cleanRawData[k] = formatExcelDate(numVal);
                    } else if(!isNaN(numVal) && Number.isInteger(numVal) && numVal > 40000 && numVal < 60000) {
                        cleanRawData[k] = formatExcelDate(numVal);
                    } else {
                        cleanRawData[k] = strVal;
                    }
                }
            });
            // 보안(2026-10-14): 저장 전 원가 열 삭제·공급처 열은 코드 모양 값만 남김
            {
                const _c = cleanRaw(cleanRawData);
                cleanRawData = _c.out;
                _supplierNamesRemoved += _c.supplierValuesRemoved;
            }

            const rawLoc = row['로케이션']?.toString().trim();
            if (rawLoc) {
                // v4.4: 2F 로케이션 감지 ("2F-..." 형태)
                // 예: "2F-S614130 I-49"
                if (rawLoc.toUpperCase().startsWith('2F-')) {
                    // 2F 행: 상품코드 추출
                    // "2F-S614130 I-49" → "S614130"
                    const afterPrefix = rawLoc.substring(3).trim(); // "S614130 I-49"
                    let twoFCode = '';
                    // S로 시작하는 첫 토큰 추출
                    const tokens = afterPrefix.split(/\s+/);
                    for (const tk of tokens) {
                        const trimmed = tk.trim();
                        if (trimmed && trimmed.charAt(0).toUpperCase() === 'S') {
                            twoFCode = trimmed;
                            break;
                        }
                    }
                    // S로 시작하는 토큰이 없으면 row['상품코드'] 사용
                    if (!twoFCode) {
                        twoFCode = (row['상품코드'] || '').toString().trim();
                    }
                    if (twoFCode) {
                        twoFloorCodes.add(twoFCode);
                        // 2F 재고 수량 누적 (정상재고 또는 2층창고재고 컬럼 사용)
                        const stockVal = Number(row['정상재고'] || row['비축창고재고'] || row['2층창고재고'] || 0);
                        if (!isNaN(stockVal) && stockVal > 0) {
                            twoFloorStockSum += stockVal;
                        }
                    }
                    // 2F 행은 3층 로케이션 시스템에 저장하지 않음 (계속 skip)
                    skipCount++;
                    continue;
                }
                
                let cleanLocId = ''; let extractedCode = '';
                if (rawLoc.includes('(')) {
                    cleanLocId = rawLoc.split('(')[0].trim();
                    const afterParen = rawLoc.substring(rawLoc.indexOf('('));
                    const sIndex = afterParen.indexOf('S');
                    if (sIndex !== -1) extractedCode = afterParen.substring(sIndex).trim();
                } else { cleanLocId = rawLoc; }
                
                if (cleanLocId) {
                    // ★ permanent 모드: '대분류' 헤더로 피킹용/기타 구분 (없으면 피킹용 기본값)
                    const rowCategory = mode === 'permanent' ? (normalizeLocCategory(row['대분류']) || '피킹용') : '피킹용';

                    if (!existingLocMap[cleanLocId]) {
                        // ★ permanent 모드: 낯선 로케이션도 새로 생성 허용
                        if (mode === 'permanent') {
                            existingLocMap[cleanLocId] = {
                                id: cleanLocId, dong: '', pos: '', code: '', name: '',
                                option: '', stock: '0', stock2f: '0', category: rowCategory
                            };
                        } else {
                            skipCount++;
                            continue;
                        }
                    }

                    const zoneDocId = getZoneDocId(cleanLocId);
                    if (!zoneUpdates[zoneDocId]) zoneUpdates[zoneDocId] = {};
                    
                    const finalCode = extractedCode || row['상품코드']?.toString().trim() || '';
                    const existingData = existingLocMap[cleanLocId] || {};
                    
                    let updateData = zoneUpdates[zoneDocId][cleanLocId] || { 
                        dong: existingData.dong || '',
                        pos: existingData.pos || '',
                        reserved: false, 
                        reservedAt: 0, 
                        reservedBy: '',
                        assignedAt: 0,
                        preAssigned: existingData.preAssigned || false,
                        preAssignedCode: existingData.preAssignedCode || '',
                        preAssignedName: existingData.preAssignedName || '',
                        preAssignedQty: existingData.preAssignedQty || '',
                        preAssignedAt: existingData.preAssignedAt || 0,
                        codeTag: existingData.codeTag || '',
                        codeTagAt: existingData.codeTagAt || 0
                    };

                    updateData.updatedAt = new Date();
                    updateData.rawDataStr = JSON.stringify(cleanRawData);
                    updateData.rawData = deleteField();
                    // ★ permanent 모드: '대분류' 헤더 값 반영. daily 모드: 로케이션 필드는 항상 피킹용 취급
                    updateData.category = (mode === 'permanent') ? rowCategory : (existingData.category || '피킹용'); // 대분류는 자리 성격 값 → 일일 업로드는 기존 값 유지

                    if (mode === 'permanent') {
                        updateData.dong = ('동' in row || 'dong' in row) ? (row['동'] || row['dong'] || '').toString().trim() : (existingData.dong || '');
                        updateData.pos = ('위치' in row || 'pos' in row) ? (row['위치'] || row['pos'] || '').toString().trim() : (existingData.pos || '');
                        updateData.code = existingData.code || '';
                        updateData.name = existingData.name || '';
                        updateData.option = existingData.option || '';
                        updateData.stock = existingData.stock || '0';
                        updateData.stock2f = existingData.stock2f || '0';
                        // ★ 칸수 필드 추가 (엑셀에 칸수 컬럼이 있으면 저장, 없으면 기존 값 유지)
                        if ('칸수' in row || 'angleSize' in row) {
                            const rawAngle = (row['칸수'] || row['angleSize'] || '').toString().trim();
                            updateData.angleSize = rawAngle;
                        } else {
                            updateData.angleSize = existingData.angleSize || '';
                        }
                    } else {
                        updateData.code = finalCode || '';
                        updateData.name = row['상품명']?.toString().trim() || '';
                        updateData.option = row['옵션']?.toString().trim() || '';
                        updateData.stock = row['정상재고']?.toString().trim() || '0';
                        updateData.stock2f = (row['비축창고재고'] ?? row['2층창고재고'])?.toString().trim() || '0';
                        // 칸수(angleSize)는 영구보전 업로드에서만 읽는다(사용자 결정 2026-10-12) — 일일 업로드는 건드리지 않음

                        if (finalCode && finalCode.trim() !== '') {
                            updateData.preAssigned = false;
                            updateData.preAssignedCode = '';
                            updateData.preAssignedName = '';
                            updateData.preAssignedQty = '';
                            updateData.preAssignedAt = 0;
                        }
                    }
                    
                    zoneUpdates[zoneDocId][cleanLocId] = updateData;
                    updateCount++;
                }
            }

            // ★ '옵션추가항목1' 헤더: 로케이션과 별개의 '기타' 위치로 동일 상품을 추가 배정
            // (비축/샘플 등 위치 코드. permanent 모드로 사전 등록된 위치만 daily 모드에서 매칭됨 —
            //  '로케이션' 필드와 동일한 사전등록 규칙 적용)
            // ★ 콤마로 여러 위치가 나열될 수 있음(예: "비축-05,비축-04,R-08") → 개별 위치로 분리해 각각 등록
            const rawOpt1 = row['옵션추가항목1']?.toString().trim();
            if (rawOpt1) {
                const opt1LocIds = rawOpt1.split(',').map(s => s.trim()).filter(Boolean);

                for (const opt1LocId of opt1LocIds) {
                    if (!existingLocMap[opt1LocId]) {
                        // ★ daily 모드: 사전 등록 안 된 위치는 새로 만들지 않고 건너뜀 (로케이션 필드와 동일 규칙)
                        if (mode !== 'permanent') { skipCount++; continue; }
                        existingLocMap[opt1LocId] = {
                            id: opt1LocId, dong: '', pos: '', code: '', name: '',
                            option: '', stock: '0', stock2f: '0', category: '기타'
                        };
                    }
                    // ★ 안전장치: 이미 실제 피킹용 위치로 쓰이는 ID는 '기타'로 덮어쓰지 않음
                    //   (옵션추가항목1 텍스트가 우연히 다른 상품의 실제 로케이션 코드와 겹칠 수 있음)
                    if (existingLocMap[opt1LocId].category === '피킹용') { skipCount++; continue; }

                    const opt1ZoneDocId = getZoneDocId(opt1LocId);
                    if (!zoneUpdates[opt1ZoneDocId]) zoneUpdates[opt1ZoneDocId] = {};

                    const opt1ExistingData = existingLocMap[opt1LocId] || {};
                    const opt1Code = (row['상품코드'] || '').toString().trim();

                    let opt1UpdateData = zoneUpdates[opt1ZoneDocId][opt1LocId] || {
                        dong: opt1ExistingData.dong || '',
                        pos: opt1ExistingData.pos || '',
                        reserved: false,
                        reservedAt: 0,
                        reservedBy: '',
                        assignedAt: 0,
                        preAssigned: opt1ExistingData.preAssigned || false,
                        preAssignedCode: opt1ExistingData.preAssignedCode || '',
                        preAssignedName: opt1ExistingData.preAssignedName || '',
                        preAssignedQty: opt1ExistingData.preAssignedQty || '',
                        preAssignedAt: opt1ExistingData.preAssignedAt || 0,
                        codeTag: opt1ExistingData.codeTag || '',
                        codeTagAt: opt1ExistingData.codeTagAt || 0
                    };

                    opt1UpdateData.updatedAt = new Date();
                    opt1UpdateData.rawDataStr = JSON.stringify(cleanRawData);
                    opt1UpdateData.rawData = deleteField();
                    opt1UpdateData.category = '기타'; // ★ '옵션추가항목1' 헤더 기준 위치 → 대분류: 기타

                    if (mode === 'permanent') {
                        opt1UpdateData.code = opt1ExistingData.code || '';
                        opt1UpdateData.name = opt1ExistingData.name || '';
                        opt1UpdateData.option = opt1ExistingData.option || '';
                        opt1UpdateData.stock = opt1ExistingData.stock || '0';
                        opt1UpdateData.stock2f = opt1ExistingData.stock2f || '0';
                    } else {
                        opt1UpdateData.code = opt1Code || '';
                        opt1UpdateData.name = row['상품명']?.toString().trim() || '';
                        opt1UpdateData.option = row['옵션']?.toString().trim() || '';
                        // 기타칸의 재고수량은 '2층창고재고' 헤더 값을 사용 (위치별로 동일 수량 반복 표시)
                        opt1UpdateData.stock = (row['비축창고재고'] ?? row['2층창고재고'])?.toString().trim() || '0';
                        opt1UpdateData.stock2f = '0';
                    }

                    zoneUpdates[opt1ZoneDocId][opt1LocId] = opt1UpdateData;
                    updateCount++;
                }
            }
        }

        // ★ 쓰기·읽기 절약(2026-10-13): 값이 그대로인 자리는 쓰지 않는다.
        //   예전엔 최신화마다 모든 자리에 updatedAt 을 새로 찍어 ZONE 문서 전체(약 8.8천)를 다시 썼고,
        //   열려 있는 로케이션 화면마다 그만큼 다시 읽었다. 비교는 스냅샷 원본(rawLocMap, 보정 전 값) 기준.
        //   빈 값('', null, undefined, false)은 같은 것으로 본다. 새 자리·옛 rawData 칸이 남은 자리는 항상 쓴다.
        const _norm = v => (v === undefined || v === null || v === false || v === '') ? ''
            : (typeof v === 'object' && typeof v.toMillis === 'function') ? String(v.toMillis())
            : (typeof v === 'object') ? JSON.stringify(v) : String(v);
        let skippedSameCount = 0;
        for (const zoneId of Object.keys(zoneUpdates)) {
            const locs = zoneUpdates[zoneId];
            for (const locId of Object.keys(locs)) {
                const upd = locs[locId], cur = rawLocMap[locId];
                if (!cur || cur.rawData !== undefined) continue;
                const changed = Object.keys(upd).some(k => k !== 'updatedAt' && k !== 'rawData' && _norm(upd[k]) !== _norm(cur[k]));
                if (!changed) { delete locs[locId]; skippedSameCount++; }
            }
            if (Object.keys(locs).length === 0) delete zoneUpdates[zoneId];
        }
        console.log(`[최신화] 바뀐 자리만 저장 — 그대로인 자리 ${skippedSameCount}곳 건너뜀, 쓰는 ZONE 문서 ${Object.keys(zoneUpdates).length}개`);

        let currentBatchLocCount = 0;
        for (let zoneId in zoneUpdates) {
            const zoneData = zoneUpdates[zoneId];
            
            batch.set(doc(db, LOC_COLLECTION, zoneId), zoneData, { merge: true });
            currentBatchLocCount++;
            
            if (currentBatchLocCount >= 200) { 
                await batch.commit(); 
                batch = writeBatch(db); 
                currentBatchLocCount = 0; 
            }
        }
        if (currentBatchLocCount > 0) {
            await batch.commit();
        }
        
        // v4.4: 2F SKU 데이터 Firestore에 저장 (daily 모드에서만)
        let twoFloorMsgPart = '';
        if (mode === 'daily') {
            try {
                const twoFloorData = {
                    skuCount: twoFloorCodes.size,
                    totalStock: twoFloorStockSum,
                    codes: Array.from(twoFloorCodes), // 디버그/검증용
                    savedAt: new Date(),
                    sourceDate: toDateStr()
                };
                await setDoc(doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'twoFloorLatest'), twoFloorData);
                console.log('[v4.4] 2F SKU 데이터 저장 완료: SKU', twoFloorCodes.size, '개 / 총 재고', twoFloorStockSum);
                twoFloorMsgPart = `\n(2F 상품 ${twoFloorCodes.size}종 / 재고 ${twoFloorStockSum.toLocaleString()}장도 별도 집계됨)`;
                
                // 메모리 캐시 갱신 (대시보드 즉시 반영용)
                window._cached2FloorStock = twoFloorData;
            } catch (e) {
                console.error('[v4.4] 2F SKU 저장 실패:', e);
            }
            
            // v4.4 v2: 재고 스냅샷 저장 (회전율 계산용)
            // 트리거 시점: 일일 최신화 업로드 직후 (마감 트리거 대체)
            // originalData는 batch.commit() 이후 onSnapshot으로 비동기 갱신되므로 잠시 대기
            setTimeout(() => {
                if (typeof window._v44_saveStockSnapshot === 'function') {
                    window._v44_saveStockSnapshot().then(ok => {
                        if (ok) {
                            // 대시보드 보고 있으면 자동 새로고침
                            const dashView = document.getElementById('view-dashboard');
                            if (dashView && dashView.style.display !== 'none' && typeof window._v44_renderDashboard === 'function') {
                                window._v44_renderDashboard();
                            }
                        }
                    });
                }
            }, 2000);  // onSnapshot으로 originalData 반영될 시간 확보
        }
        
        let _secNote = '';
        if (_droppedCostHeaders.length) _secNote += `\n(보안: 원가 열(${_droppedCostHeaders.join(', ')})은 저장하지 않았습니다)`;
        if (_supplierNamesRemoved) _secNote += `\n(보안: 공급처 이름 값 ${_supplierNamesRemoved}건을 지웠습니다 — 공급처는 코드만 저장)`;
        if (mode === 'permanent') {
            showToast(`완료! ${updateCount}개 로케이션의 랙 구조(동/위치) 영구 세팅이 완료되었습니다.` + _secNote);
        } else {
            let msg = `스마트 클린 업데이트 완료!\n과거 유령 재고는 완벽히 비워졌고, 엑셀의 최신 데이터 ${updateCount}건만 정확하게 반영되었습니다.`;
            if(skipCount > 0) msg += `\n(※ 기존 도면에 없거나 2F 로케이션 ${skipCount}건은 3층 시스템에서 무시됨)`;
            if(twoFloorMsgPart) msg += twoFloorMsgPart;
            showToast(msg + _secNote);
            
            // v3.97b: 일일 최신화 완료 후 단종 페어 자동 정리 (비동기, alert 차단 안 함)
            setTimeout(() => { window.cleanupDeprecatedPairs().catch(e => console.error('[cleanup] 오류:', e)); }, 100);
        }
        // 보안(2026-10-14): 저장하지 않은 열 안내 — 머리글 이름과 건수만(값은 표시하지 않음).
        //   완료 알림이 토스트가 되면서(UX 개선 7번) 위 완료 토스트에 _secNote 를 함께 넣었다 — 토스트 칸이 하나라 따로 띄우면 덮인다.
        return true;   // 성공 — 업로드 상태(계약 B) done 판정용
    } catch (error) { 
        console.error("실패:", error); 
        alert(`로케이션 데이터를 반영하지 못했습니다. 일부만 반영됐을 수 있습니다.\n인터넷 연결을 확인한 뒤 같은 파일을 다시 올려 주세요(다시 올려도 중복되지 않습니다).\n계속되면 관리자에게 아래 오류 코드를 알려 주세요.\n(오류 코드: ${_errCode(error)})`); 
        return false;
    } finally { 
        if(document.getElementById('excel-upload-a')) document.getElementById('excel-upload-a').value = ''; 
        if(document.getElementById('excel-upload-permanent')) document.getElementById('excel-upload-permanent').value = ''; 
        window.hideLoading(); 
    }
}

// ===== v3.97b: 단종 상품 페어 자동 정리 =====
// 호출 시점: 일일 최신화(updateDatabaseA mode='daily') 완료 직후
// 단종 판정 조건 (3개 모두 만족):
//   1. 마지막배송일 30일+ 경과 (빈칸은 제외 = 신규 상품 보호)
//   2. 재고 0
//   3. 입고대기 0
// 동작:
//   - 한쪽이라도 단종이면 OrderPairsChunks의 페어 삭제 (엄격)
//   - 단종 상품의 OrderStatsChunks 단독 통계도 삭제
//   - 결과는 console.log만 (조용히)
//   - 상세 로그는 DeprecatedLog 컬렉션에 저장
window.cleanupDeprecatedPairs = async function() {
    console.log('[cleanup] 단종 페어 정리 시작...');
    
    try {
        // 1. 안전장치: OrderPairsChunks 비어있으면 종료
        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        if (pairsSnap.empty) {
            console.log('[cleanup] 페어 데이터 없음. 정리 건너뜀.');
            return;
        }
        
        // 2. 마지막배송일 컬럼 존재 확인 (rawData에 한 번이라도 나타나는지)
        const getRawVal = (rd, targetKey) => {
            if (!rd) return '';
            if (rd[targetKey]) return rd[targetKey];
            const norm = targetKey.replace(/[\s\u00A0]/g, '');
            for (const k of Object.keys(rd)) {
                if (k.replace(/[\s\u00A0]/g, '') === norm) return rd[k];
            }
            return '';
        };
        
        let hasLastDeliveryColumn = false;
        for (const loc of originalData) {
            if (getRawVal(loc.rawData, '마지막배송일')) {
                hasLastDeliveryColumn = true;
                break;
            }
        }
        if (!hasLastDeliveryColumn) {
            console.warn('[cleanup] 마지막배송일 컬럼이 데이터에 없음. 잘못된 정리를 방지하기 위해 건너뜀.');
            return;
        }
        
        // 3. incomingTotalByCode 상태 점검 (경고만)
        if (!incomingTotalByCode || Object.keys(incomingTotalByCode).length === 0) {
            console.warn('[cleanup] incomingTotalByCode가 비어있음. 시트 동기화를 먼저 수행하지 않았다면 단종 판정이 부정확할 수 있음.');
        }
        
        // 4. 30일 cutoff 날짜 계산
        const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
        const cutoffStr = toDateStr(cutoff);
        
        // 5. 상품코드별로 그룹핑 (마지막배송일, 재고 합계 집계)
        const codeMap = {}; // { code: { lastDelivery, totalStock, locIds: [] } }
        originalData.forEach(loc => {
            const code = (loc.code || '').toString().trim();
            if (!code || code === loc.id) return;
            
            if (!codeMap[code]) codeMap[code] = { lastDelivery: '', totalStock: 0, locIds: [] };
            
            // 마지막배송일: 가장 최근 값 (마지막배송일 우선, 없으면 마지막입고일 fallback)
            let val = getRawVal(loc.rawData, '마지막배송일');
            if (!val) val = getRawVal(loc.rawData, '마지막입고일');
            if (val && val > codeMap[code].lastDelivery) codeMap[code].lastDelivery = val;
            
            codeMap[code].totalStock += Number(loc.stock || 0);
            codeMap[code].locIds.push(loc.id);
        });
        
        // 6. 단종 상품 판정
        const deprecatedSet = new Set();
        const deprecatedDetail = []; // [{code, lastDelivery, totalStock, incomingQty, locIds}]
        
        for (const code in codeMap) {
            const info = codeMap[code];
            
            // 조건 1: 마지막배송일 빈칸 → 신규 상품으로 간주, 제외
            if (!info.lastDelivery) continue;
            
            // 조건 1: 마지막배송일 30일+ 경과
            if (info.lastDelivery >= cutoffStr) continue;
            
            // 조건 2: 재고 0
            if (info.totalStock > 0) continue;
            
            // 조건 3: 입고대기 0
            const incomingQty = Number(incomingTotalByCode[code] || 0);
            if (incomingQty > 0) continue;
            
            // 모두 만족 → 단종으로 판정
            deprecatedSet.add(code);
            deprecatedDetail.push({
                code,
                lastDelivery: info.lastDelivery,
                totalStock: info.totalStock,
                incomingQty,
                locIds: info.locIds.join(', ')
            });
        }

        // ===== v3.97c: 자리 없는 페어 정리 (사각지대 해결) =====
        // 페어 데이터에는 있지만 originalData에 자리 없는 상품 검사
        // 조건: 입고대기 0 AND lastDate(페어 최근 함께 산 날) 30일+ 경과
        const allPairCodes = new Set();
        const codeLastDate = {}; // 상품코드별 페어/통계 lastDate 중 최대값
        
        // 페어 데이터에서 모든 상품코드 + lastDate 수집
        try {
            const pairsSnapForOrphan = await getDocs(collection(db, ORDER_PAIRS_COLL));
            pairsSnapForOrphan.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(p => {
                        if (p.cA) {
                            allPairCodes.add(p.cA);
                            if (!codeLastDate[p.cA] || (p.d && p.d > codeLastDate[p.cA])) {
                                codeLastDate[p.cA] = p.d || '';
                            }
                        }
                        if (p.cB) {
                            allPairCodes.add(p.cB);
                            if (!codeLastDate[p.cB] || (p.d && p.d > codeLastDate[p.cB])) {
                                codeLastDate[p.cB] = p.d || '';
                            }
                        }
                    });
                } catch (e) {}
            });
            
            const statsSnapForOrphan = await getDocs(collection(db, ORDER_STATS_COLL));
            statsSnapForOrphan.forEach(d => {
                try {
                    const arr = JSON.parse(d.data().dataStr || '[]');
                    arr.forEach(s => {
                        if (s.c) {
                            allPairCodes.add(s.c);
                            if (!codeLastDate[s.c] || (s.d && s.d > codeLastDate[s.c])) {
                                codeLastDate[s.c] = s.d || '';
                            }
                        }
                    });
                } catch (e) {}
            });
        } catch (e) {
            console.warn('[cleanup-v3.97c] 페어/통계 lastDate 수집 실패:', e);
        }
        
        // 자리 없는 상품 = 페어 데이터에 있지만 codeMap(originalData)에 없음
        let orphanCount = 0;
        for (const code of allPairCodes) {
            if (codeMap[code]) continue; // 자리 있는 상품은 위에서 이미 처리됨
            if (deprecatedSet.has(code)) continue; // 이미 단종 판정된 경우 스킵
            
            // 자리 없는 상품의 단종 조건
            const incomingQty = Number(incomingTotalByCode[code] || 0);
            if (incomingQty > 0) continue; // 입고대기 있으면 보호 (재입고 예정)
            
            const lastDate = codeLastDate[code] || '';
            if (!lastDate) continue; // lastDate 없으면 판단 불가, 보호
            if (lastDate >= cutoffStr) continue; // 최근 30일 이내 함께 팔림 = 보호
            
            // 자리 없음 + 입고대기 0 + lastDate 30일+ 경과 → 단종 판정
            deprecatedSet.add(code);
            deprecatedDetail.push({
                code,
                lastDelivery: '(자리 없음)',
                totalStock: 0,
                incomingQty,
                locIds: '(없음, 페어 lastDate: ' + lastDate + ')'
            });
            orphanCount++;
        }
        
        if (orphanCount > 0) {
            console.log(`[cleanup-v3.97c] 자리 없는 단종 상품 ${orphanCount}개 추가 발견`);
        }
        // ===== v3.97c 끝 =====
        
        if (deprecatedSet.size === 0) {
            console.log('[cleanup] 단종 상품 없음. 정리 종료.');
            return;
        }
        
        console.log(`[cleanup] 단종 상품 ${deprecatedSet.size}개 발견:`, [...deprecatedSet]);
        
        // 7. OrderPairsChunks 로드 → 단종 페어 필터링 → 다시 쓰기
        const allPairs = [];
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => allPairs.push(p));
            } catch (e) {}
        });
        
        const survivingPairs = allPairs.filter(p => 
            !deprecatedSet.has(p.cA) && !deprecatedSet.has(p.cB)
        );
        const deletedPairCount = allPairs.length - survivingPairs.length;
        
        // 8. OrderStatsChunks 로드 → 단종 상품 통계 필터링 → 다시 쓰기
        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        const allStats = [];
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => allStats.push(s));
            } catch (e) {}
        });
        
        const survivingStats = allStats.filter(s => !deprecatedSet.has(s.c));
        const deletedStatCount = allStats.length - survivingStats.length;
        
        // 9. 기존 청크 모두 삭제 후 새로 작성 (페어)
        let batch = writeBatch(db);
        let bc = 0;
        pairsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();
        
        batch = writeBatch(db);
        bc = 0;
        let chunkIdx = 0;
        for (let i = 0; i < survivingPairs.length; i += CHUNK_SIZE_PAIRS) {
            const chunk = survivingPairs.slice(i, i + CHUNK_SIZE_PAIRS);
            const docRef = doc(db, ORDER_PAIRS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();
        
        // 10. 기존 청크 모두 삭제 후 새로 작성 (단독 통계)
        batch = writeBatch(db);
        bc = 0;
        statsSnap.forEach(d => { batch.delete(d.ref); bc++; if (bc >= 400) { batch.commit(); batch = writeBatch(db); bc = 0; } });
        if (bc > 0) await batch.commit();
        
        batch = writeBatch(db);
        bc = 0;
        chunkIdx = 0;
        for (let i = 0; i < survivingStats.length; i += CHUNK_SIZE_STATS) {
            const chunk = survivingStats.slice(i, i + CHUNK_SIZE_STATS);
            const docRef = doc(db, ORDER_STATS_COLL, `CHUNK_${chunkIdx}`);
            batch.set(docRef, { dataStr: JSON.stringify(chunk), updatedAt: new Date() });
            chunkIdx++;
            bc++;
            if (bc >= 400) { await batch.commit(); batch = writeBatch(db); bc = 0; }
        }
        if (bc > 0) await batch.commit();
        
        // 11. DeprecatedLog 컬렉션에 상세 로그 저장 (날짜별 1문서)
        const logDocId = toDateStr() + '_' + Date.now();
        await setDoc(doc(db, 'DeprecatedLog', logDocId), {
            cleanedAt: Date.now(),
            cleanedAtDate: toDateStr(),
            cutoffDate: cutoffStr,
            deprecatedCount: deprecatedSet.size,
            deletedPairCount,
            deletedStatCount,
            details: JSON.stringify(deprecatedDetail)
        });
        
        // 12. INFO_CONFIG의 orderAnalysisMeta 갱신 (페어/상품 카운트 동기화)
        await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), {
            orderAnalysisMeta: {
                lastCleanupAt: Date.now(),
                lastCleanupDate: toDateStr(),
                totalPairs: survivingPairs.length,
                totalCodes: survivingStats.length
            }
        }, { merge: true });
        
        console.log(`[cleanup] 완료: 단종 ${deprecatedSet.size}건 정리, 페어 ${deletedPairCount}개 삭제, 통계 ${deletedStatCount}개 삭제.`);
        console.log(`[cleanup] 상세 로그: DeprecatedLog/${logDocId}`);
        
        // v3.98: 페어 캐시 갱신
        if (typeof window.loadOrderPairsCache === 'function') {
            window.loadOrderPairsCache();
        }
    } catch (e) {
        console.error('[cleanup] 단종 정리 중 오류:', e);
    }
};

// ===== v3.98: 페어 데이터 캐시 로드 (입고대기 추천 Case A 에서 사용) =====
window.loadOrderPairsCache = async function() {
    try {
        const pairsSnap = await getDocs(collection(db, ORDER_PAIRS_COLL));
        const statsSnap = await getDocs(collection(db, ORDER_STATS_COLL));
        
        const pairs = [];
        pairsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(p => pairs.push({ codeA: p.cA, codeB: p.cB, count: p.c, lastDate: p.d }));
            } catch (e) {}
        });
        
        const stats = {};
        statsSnap.forEach(d => {
            try {
                const arr = JSON.parse(d.data().dataStr || '[]');
                arr.forEach(s => { stats[s.c] = { code: s.c, count: s.n, lastDate: s.d }; });
            } catch (e) {}
        });
        
        let meta = {};
        try {
            const cfgSnap = await getDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'));
            if (cfgSnap.exists()) {
                meta = cfgSnap.data().orderAnalysisMeta || {};
            }
        } catch (e) {}
        
        window._cachedOrderPairs = pairs;
        window._cachedOrderStats = stats;
        window._cachedOrderMeta = meta;
        
        console.log(`[v3.98] 페어 캐시 로드 완료: ${pairs.length}개 페어, ${Object.keys(stats).length}개 상품`);
    } catch (e) {
        console.warn('[v3.98] 페어 캐시 로드 실패:', e);
        window._cachedOrderPairs = [];
        window._cachedOrderStats = {};
        window._cachedOrderMeta = {};
    }
};

window.copyLocationToClipboard = async (event, locId) => {
    event.stopPropagation(); 
    
    if (window.isPreAssignMode) {
        window.handleRowClick(event, locId);
        return;
    }
    
    try {
        const zoneDocId = getZoneDocId(locId);
        const docRef = doc(db, LOC_COLLECTION, zoneDocId);
        const snap = await getDoc(docRef);
        
        if (snap.exists() && snap.data()[locId]) {
            const data = snap.data()[locId]; 
            const now = new Date().getTime();
            const isReserved = data.reserved === true; 
            const reserverName = data.reservedBy || '다른 작업자';
            
            if (isReserved && reserverName === currentUserName) {
                if (confirm(`[${locId}] 내가 예약한 자리입니다.\n해제하시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: false, reservedAt: 0, reservedBy: '', assignedAt: 0, codeTag: '', codeTagAt: 0, updatedAt: new Date() } }, { merge: true });
                    showToast(`[${locId}] 해제 완료`);
                } else { navigator.clipboard.writeText(locId); showToast(`[${locId}] 복사 완료!`); }
                return;
            }
            
            if (isReserved) {
                if (confirm(`[${locId}]은 현재 [${reserverName}]님이 사용 중입니다.\n강제로 예약을 가져오시겠습니까?`)) {
                    await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
                    navigator.clipboard.writeText(locId); showToast(`[${locId}] 강제 복사 완료!`);
                }
                return; 
            }
            
            if (data.preAssigned) { 
                // 선지정 자리: 예약(복사)만 진행, codeTag는 선지정 유지
                await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, updatedAt: new Date() } }, { merge: true });
                navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료! (선지정 유지)`); });
                return;
            }
            
            await setDoc(docRef, { [locId]: { reserved: true, reservedAt: now, assignedAt: now, reservedBy: currentUserName, codeTag: '당일지정', codeTagAt: now, updatedAt: new Date() } }, { merge: true });
            navigator.clipboard.writeText(locId).then(() => { showToast(`[${locId}] 복사 및 예약 완료!`); });
        }
    } catch (error) { console.error(error); alert('자리를 예약하지 못했습니다(인터넷 연결 확인).' + (error?.code ? ` (${error.code})` : '')); }
};

function showToast(message, ms) {
    const toast = document.getElementById("toast");
    // 기본 1.5초, 긴 문구는 글자 수에 맞춰 최대 6초(성공 alert 를 토스트로 바꾼 문구 — UX 개선 7번)
    const dur = ms || Math.min(6000, Math.max(1500, String(message || '').length * 45));
    if(toast) {
        toast.innerText = message; toast.classList.add("show");
        clearTimeout(showToast._t);   // 앞 토스트의 타이머가 새 토스트를 일찍 끄지 않게
        showToast._t = setTimeout(() => { toast.classList.remove("show"); }, dur);
    }
}

window.addSingleLocationFromSetting = async () => {
    const inputObj = document.getElementById('setting-new-loc'); const newId = inputObj.value.trim().toUpperCase();
    if (!newId) return alert("로케이션 번호를 입력하세요.");
    try {
        const zoneDocId = getZoneDocId(newId);
        const docRef = doc(db, LOC_COLLECTION, zoneDocId); 
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data()[newId]) return alert(`이미 존재합니다.`);
        await setDoc(docRef, { [newId]: { dong: '', pos: '', code: '', name: '', option: '', stock: '0', reserved: false, reservedAt: 0, assignedAt: 0, reservedBy: '', updatedAt: new Date(), rawData: {} } }, { merge: true });
        inputObj.value = ''; showToast(`로케이션 ${newId} 추가 완료`);
    } catch (error) { console.error(error); alert('로케이션을 추가하지 못했습니다(인터넷 연결 확인).' + (error?.code ? ` (${error.code})` : '')); }
};

window.deleteSelectedLocations = async () => {
    // 가상 스크롤이라 화면에 그려진 줄만 querySelectorAll 에 잡힌다 → 선택 집합을 쓴다
    const checkedIds = [...VS.checkedIds];
    if (checkedIds.length === 0) return alert("삭제할 대상을 선택하세요.");
    if (window.__locBusy && !(await window.__locBusy.confirmIfUploading('일괄 수정'))) return;   // 업로드 중 확인
    const _preview = checkedIds.slice(0, 5).join(', ') + (checkedIds.length > 5 ? ` 외 ${checkedIds.length - 5}개` : '');
    if (!confirm(`선택한 로케이션 ${checkedIds.length}개를 삭제합니다. 되돌릴 수 없습니다.\n대상: ${_preview}\n(그 자리의 재고·선지정 정보도 함께 지워집니다)\n\n삭제할까요?`)) return;
    try {
        let batch = writeBatch(db); let batchCount = 0;
        for (let i = 0; i < checkedIds.length; i++) {
            const locId = checkedIds[i];
            const zoneDocId = getZoneDocId(locId);
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), { [locId]: deleteField() }, { merge: true });
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        VS.checkedIds.clear();
        updateLocBulkBar();
        showToast(`로케이션 ${checkedIds.length}개 삭제 완료`);
    } catch (error) { console.error(error); alert('로케이션을 삭제하지 못했습니다(인터넷 연결 확인). 일부는 지워졌을 수 있으니 목록을 확인하세요.' + (error?.code ? ` (${error.code})` : '')); }
};

// ============================================================
// ✏️ 선택한 로케이션의 동·위치·대분류·칸수 직접 수정 (칸수 2026-10-14 추가 — 로케이션 뒤 (칸수) 로 표시·다운로드되는 값)
//    (지금까지는 영구보전 데이터 업로드로만 바꿀 수 있었다. 몇 칸만 고칠 때 엑셀을 다시 만들지 않아도 되게.)
//    자리 번호(로케이션 id)는 바꾸지 않는다 — 상품 지정·이력이 번호로 연결돼 있다.
// ============================================================
window.openLocBulkEdit = function () {
    const ids = [...VS.checkedIds];
    if (ids.length === 0) return alert('수정할 로케이션을 먼저 선택하세요.');
    const modal = document.getElementById('loc-bulk-modal');
    const target = document.getElementById('loc-bulk-target');
    if (!modal || !target) return;

    const byId = new Map(originalData.map(l => [l.id, l]));
    const rows = ids.map(id => byId.get(id)).filter(Boolean);
    const preview = rows.slice(0, 30).map(l =>
        `${escAttr(l.id)} <span style="color:var(--c-text-3);">(동 ${escAttr(l.dong || '-')} · 위치 ${escAttr(l.pos || '-')} · ${escAttr(l.category || '피킹용')} · 칸수 ${escAttr(locAngleSize(l) || '-')})</span>`
    ).join('<br>');
    target.innerHTML = `<b>${rows.length}개 로케이션</b>${rows.length > 30 ? ' <span style="color:var(--c-text-3);">(아래는 앞 30개)</span>' : ''}<br>${preview || '선택한 자리를 찾지 못했습니다.'}`;

    // 값이 모두 같으면 그 값을 미리 채워 준다
    const one = (key) => { const s = new Set(rows.map(l => (l[key] || '').toString().trim())); return s.size === 1 ? [...s][0] : ''; };
    ['dong', 'pos', 'cat', 'angle'].forEach(k => {
        const ck = document.getElementById('loc-bulk-use-' + k);
        if (ck) ck.checked = false;
    });
    const dongEl = document.getElementById('loc-bulk-dong');
    const posEl = document.getElementById('loc-bulk-pos');
    const catEl = document.getElementById('loc-bulk-cat');
    if (dongEl) { dongEl.value = one('dong'); dongEl.disabled = true; }
    if (posEl) { posEl.value = one('pos'); posEl.disabled = true; }
    if (catEl) { catEl.value = one('category') === '기타' ? '기타' : '피킹용'; catEl.disabled = true; }
    const angleEl = document.getElementById('loc-bulk-angle');
    if (angleEl) { const s = new Set(rows.map(l => locAngleSize(l))); angleEl.value = s.size === 1 ? [...s][0] : ''; angleEl.disabled = true; }

    modal.style.display = 'flex';
};

window.applyLocBulkEdit = async function () {
    // 실제로 있는 자리만 — 없는 id 에 저장하면 빈 껍데기 자리가 새로 생긴다
    const exist = new Set(originalData.map(l => l.id));
    const ids = [...VS.checkedIds].filter(id => exist.has(id));
    if (ids.length === 0) return alert('수정할 로케이션을 먼저 선택하세요.');

    const useDong = document.getElementById('loc-bulk-use-dong')?.checked;
    const usePos = document.getElementById('loc-bulk-use-pos')?.checked;
    const useCat = document.getElementById('loc-bulk-use-cat')?.checked;
    const useAngle = document.getElementById('loc-bulk-use-angle')?.checked;
    if (!useDong && !usePos && !useCat && !useAngle) return alert('바꿀 항목을 체크해 주세요.');

    const patch = {};
    if (useDong) patch.dong = (document.getElementById('loc-bulk-dong')?.value || '').trim();
    if (usePos) patch.pos = (document.getElementById('loc-bulk-pos')?.value || '').trim();
    if (useCat) patch.category = (document.getElementById('loc-bulk-cat')?.value === '기타') ? '기타' : '피킹용';
    if (useAngle) {
        // 칸수는 영구보전 업로드와 같은 곳(angleSize, 문자열)에 쓴다. 비우면 칸수 없음(괄호 표시 안 함).
        const a = (document.getElementById('loc-bulk-angle')?.value || '').trim();
        if (a && !/^\d{1,3}$/.test(a)) return alert('칸수는 숫자(1~999)로 넣거나, 칸수를 없애려면 비워 두세요.');
        patch.angleSize = a.replace(/^0+(?=\d)/, '');
    }

    const what = [useDong ? `동 → '${patch.dong || '(빈칸)'}'` : '', usePos ? `위치 → '${patch.pos || '(빈칸)'}'` : '', useCat ? `대분류 → '${patch.category}'` : '',
                  useAngle ? `칸수 → '${patch.angleSize || '(없음)'}'` : '']
        .filter(Boolean).join('\n');
    const notes = [];
    if ((useDong && !patch.dong) || (usePos && !patch.pos)) notes.push('※ 빈칸으로 두면 동·위치 필터에서 그 자리를 찾을 수 없습니다.');
    if (useCat) {
        const fixed = ids.filter(id => /^(비축|SAM)/i.test(id));
        if (fixed.length) notes.push(`※ ${fixed.length}개(비축·SAM 번호)는 번호 규칙상 항상 '기타'로 취급됩니다 — 대분류를 바꿔도 화면 집계는 그대로입니다.`);
    }
    if (window.__locBusy && !(await window.__locBusy.confirmIfUploading('일괄 수정'))) return;   // 업로드 중 확인
    if (!confirm(`${ids.length}개 로케이션을 바꿉니다.\n\n${what}\n${notes.length ? '\n' + notes.join('\n') + '\n' : ''}\n진행할까요?`)) return;

    window.showLoading(`${ids.length}개 로케이션 수정 중...`);
    try {
        // 같은 구역 문서에 여러 자리가 몰리므로 문서 단위로 묶어 쓴다(문서당 쓰기 1회)
        const byZone = new Map();
        for (const locId of ids) {
            const zoneDocId = getZoneDocId(locId);
            if (!byZone.has(zoneDocId)) byZone.set(zoneDocId, {});
            // 자리 하나의 해당 필드만 덮어쓴다(merge) — 상품코드·재고·이력은 건드리지 않는다
            byZone.get(zoneDocId)[locId] = { ...patch, updatedAt: new Date() };
        }
        let batch = writeBatch(db); let batchCount = 0;
        for (const [zoneDocId, payload] of byZone) {
            batch.set(doc(db, LOC_COLLECTION, zoneDocId), payload, { merge: true });
            batchCount++;
            if (batchCount >= 400) { await batch.commit(); batch = writeBatch(db); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        window.hideLoading();
        document.getElementById('loc-bulk-modal').style.display = 'none';
        window.clearLocSelection();
        showToast(`${ids.length}개 로케이션을 수정했습니다.`);
    } catch (e) {
        window.hideLoading();
        console.error('[location] 일괄 수정 실패:', e);
        alert('로케이션을 수정하지 못했습니다(인터넷 연결 확인). 일부는 바뀌었을 수 있으니 목록을 확인하세요.' + (e?.code ? ` (${e.code})` : ''));
    }
};

// 입고대기 패널에 보일 목록 = 로케이션 지정이 필요한 입고 예정 상품(아직 자리·선지정 없음, 날짜 있음, 도착예상일이 오늘 이후).
//   패널(renderIncomingQueue)과 대시보드 '입고 대기' 카드가 같은 기준을 쓴다. filterSource: 'all' | 제작 | 사입
function incomingNeedLocList(filterSource = 'all') {
    let existingLocMap = {}; 
    originalData.forEach(loc => {
        if(loc.preAssigned && loc.preAssignedCode) existingLocMap[String(loc.preAssignedCode).replace(/\s+/g, '')] = true;
        if(loc.code && loc.code !== loc.id) existingLocMap[String(loc.code).replace(/\s+/g, '')] = true;
    });

    let list = [];
    for(let code in incomingData) { list.push(incomingData[code]); }

    // ★ v3.53: 오늘 날짜 (YYYY-MM-DD)
    const _today = toDateStr();
    list = list.filter(item => {
        if(filterSource !== 'all' && item.source !== filterSource) return false;
        if(existingLocMap[(item['상품코드'] || item['어드민상품코드'] || item['대표상품코드'] || item['품목코드'] || item['바코드'] || item['상품번호'])]) return false;   // 목록 키와 같은 코드 칸 순서
        
        if(!item['표시날짜'] || item['표시날짜'].toString().trim() === '') return false;
        
        const arrivalDate = (item['도착예상일'] || item['표시날짜'] || '').toString().trim();
        if (arrivalDate && arrivalDate < _today) return false;
        
        return true;
    });
    return list;
}

window.renderIncomingQueue = function() {
    const container = document.getElementById('incoming-list');
    if(!container) return;
    const filterSource = document.getElementById('filter-source')?.value || 'all';
    const sortType = document.getElementById('sort-incoming')?.value || 'qty-desc';

    let list = incomingNeedLocList(filterSource);

    // 추천 자리 미리 배정 (일괄 적용과 동일 순서: 출고예상일 빠른 순 → 미입고수량 많은 순)
    // → 표시 정렬과 무관하게 상품마다 서로 다른 자리, 그리고 실제 일괄적용 결과와 일치
    const recLocMap = {};
    if (typeof window.calcIncomingRecommend === 'function') {
        const _usedRec = new Set();
        const _canon = list.slice().sort((a, b) => {
            const dA = (a['표시날짜'] || '9999-99-99').toString();
            const dB = (b['표시날짜'] || '9999-99-99').toString();
            if (dA !== dB) return dA.localeCompare(dB);
            return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        });
        for (const _it of _canon) {
            const _c = _it['상품코드'];
            if (!_c || recLocMap[_c]) continue;
            try {
                const _r = window.calcIncomingRecommend(_c, _usedRec);
                if (_r && _r.loc && _r.loc.id) { _usedRec.add(_r.loc.id); recLocMap[_c] = _r; }
            } catch (_e) { /* 카드는 그대로 표시 */ }
        }
    }

    list.sort((a, b) => {
        if(sortType === 'qty-desc') return Number(b['입고대기수량'] || 0) - Number(a['입고대기수량'] || 0);
        else if(sortType === 'date-asc') {
            let dA = a['표시날짜'] || '9999-99-99'; let dB = b['표시날짜'] || '9999-99-99';
            return dA.localeCompare(dB);
        }
        return 0;
    });

    let html = '';
    list.forEach(item => {
        let code = item['상품코드']; let qty = item['입고대기수량'] || 0;
        let name = item['상품명'] || '';
        let src = item.source || '-';
        let date = src === '제작' ? (item['공장출고예상일'] || item['표시날짜'] || '-') : (item['검수창고도착일'] || item['표시날짜'] || '-');
        let option = item['옵션'] || '';

        // [4단계] 추천 자리 (미리 배정된 맵에서 조회 — 일괄 적용과 동일 결과)
        let recHtml = '';
        const rec = recLocMap[code];
        if (rec && rec.loc && rec.loc.id) {
            const caseLabel = rec.case === 'A'
                ? `<span style="font-size:10px; color:var(--c-accent-deep); font-weight:normal;">(페어 ${rec.partnerCount}개)</span>`
                : `<span style="font-size:10px; color:var(--c-text-3); font-weight:normal;">(우선순위)</span>`;
            recHtml = `<div style="margin-top:6px; padding-top:5px; border-top:1px dashed var(--c-line); font-size:11px; color:var(--c-accent-deep);">추천: <b>${rec.loc.id}</b> ${caseLabel}</div>`;
        }
        
        html += `
            <div class="incoming-item" onclick="activatePreAssignMode('${jsArg(code)}', '${jsArg(name)}', '${jsArg(qty)}', '${jsArg(option)}', '${jsArg(rec?.loc?.id || '')}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div style="font-weight:600; color:var(--c-accent-deep); font-size:14px;">${code}</div>
                    <span class="badge incoming-src ${src==='제작'?'badge-accent':'badge-warn'}">${src}</span>
                </div>
                <div style="font-size:12px; color:var(--c-text); margin-bottom:${option ? '2px' : '6px'};">${name}</div>
                ${option ? `<div style="font-size:11px; color:var(--c-text-3); margin-bottom:6px;">${option}</div>` : ''}
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
                    <span style="color:var(--c-text-2);">${src==='제작'?'출고일':'도착일'}: <b style="color:var(--c-text);">${date}</b></span>
                    <span style="color:var(--c-warn-text); font-weight:600; font-size:12px;">대기: ${qty}개</span>
                </div>
                ${recHtml}
            </div>
        `;
    });
    container.innerHTML = html || '<div style="text-align:center; padding:30px; color:var(--c-text-3);">지정이 필요한 상품이 없습니다.</div>';
};

window.activatePreAssignMode = function(code, name, qty, option = '', recId = '') {
    window.isPreAssignMode = true;
    window.selectedPreAssignItem = { code, name, qty, option };
    document.getElementById('pre-assign-banner-text').innerText = `${code} (${name})` + (recId ? ` → 추천 ${recId}` : '');
    document.getElementById('pre-assign-banner').style.display = 'flex';
    if (document.body.dataset.locTab === 'locdash' && typeof window.switchView === 'function') window.switchView('list');
    if (window.innerWidth < 1100) document.getElementById('incoming-sidebar').classList.remove('open');
};

window.cancelPreAssignMode = function() {
    window.isPreAssignMode = false;
    window.selectedPreAssignItem = null;
    document.getElementById('pre-assign-banner').style.display = 'none';
};

// =============================
// ★ v3.55: 툴팁 탭 시스템 (설명/메뉴얼 양쪽 편집 + 편집 중 잠금)
// =============================

// 기본 설명 텍스트 캐시 (최초 렌더링 시의 HTML 저장, 복원용)
const _ttDefaults = {};
// 편집 모드 플래그 (true일 때 툴팁 자동 닫힘 차단)
let _ttEditingLock = false;

// 헬퍼: suffix 기반 키로 저장된 값 읽기 (하위 호환 포함)
function _ttGetStored(key, tab) {
    const suffixKey = key + '__' + tab;
    if (customTooltips[suffixKey] !== undefined) return customTooltips[suffixKey];
    // 하위 호환: suffix 없는 키는 메뉴얼로 간주
    if (tab === 'manual' && customTooltips[key] !== undefined) return customTooltips[key];
    return '';
}

// applyCustomTooltips: 초기 1회 세팅용 (탭 구조 주입)
window.applyCustomTooltips = function() {
    document.querySelectorAll('.info-tip[data-tip-key]').forEach(tip => {
        const key = tip.getAttribute('data-tip-key');
        if (!key) return;
        if (key.startsWith('dyn-')) return; // v3.98a-fix2: 동적 콘텐츠 툴팁은 캐싱 안 함
        const content = tip.querySelector('.info-tip-content');
        if (!content) return;
        if (content.querySelector('.tt-tabs')) return;
        if (!_ttDefaults[key]) _ttDefaults[key] = content.innerHTML;
        _ttRenderTabs(tip, key);
    });
};

function _ttRenderTabs(tip, key, activeTab) {
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    activeTab = activeTab || 'desc';
    
    // 설명 탭: 사용자 수정본이 있으면 그걸, 없으면 기본값
    const userDesc = _ttGetStored(key, 'desc');
    const descHtml = userDesc ? userDesc : (_ttDefaults[key] || '');
    const isDescCustom = !!userDesc;
    
    // 메뉴얼 탭: 사용자가 추가한 내용
    const manualHtml = (_ttGetStored(key, 'manual') || '').trim();
    
    content.innerHTML = `
        <div class="tt-tabs">
            <button type="button" class="tt-tab-btn ${activeTab==='desc'?'active':''}" data-tab="desc">설명</button>
            <button type="button" class="tt-tab-btn ${activeTab==='manual'?'active':''}" data-tab="manual">메뉴얼</button>
        </div>
        <div class="tt-tab-content tt-tab-desc ${activeTab==='desc'?'':'hidden'}">
            <div class="tt-view-wrap">
                <div class="tt-view-body">${descHtml}</div>
                <div class="tt-btn-row">
                    <button type="button" class="tt-btn-edit" data-target="desc">편집</button>
                    ${isDescCustom ? '<button type="button" class="tt-btn-reset" data-target="desc">기본값 복원</button>' : ''}
                </div>
            </div>
        </div>
        <div class="tt-tab-content tt-tab-manual ${activeTab==='manual'?'':'hidden'}">
            <div class="tt-view-wrap">
                <div class="tt-view-body">${manualHtml ? manualHtml : '<div class="tt-empty">아직 등록된 메뉴얼이 없습니다.<br>아래 편집 버튼으로 추가하세요.</div>'}</div>
                <div class="tt-btn-row">
                    <button type="button" class="tt-btn-edit" data-target="manual">편집</button>
                </div>
            </div>
        </div>
    `;
    
    // 탭 버튼 클릭
    content.querySelectorAll('.tt-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_ttEditingLock) return; // 편집 중엔 탭 전환 금지
            const tabName = btn.getAttribute('data-tab');
            content.querySelectorAll('.tt-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            content.querySelector('.tt-tab-desc').classList.toggle('hidden', tabName !== 'desc');
            content.querySelector('.tt-tab-manual').classList.toggle('hidden', tabName !== 'manual');
        });
    });
    
    // 편집 버튼 (설명/메뉴얼 공용)
    content.querySelectorAll('.tt-btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = btn.getAttribute('data-target');
            _ttShowEditor(tip, key, target);
        });
    });
    
    // 기본값 복원 버튼 (설명 탭만)
    content.querySelectorAll('.tt-btn-reset').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('설명을 기본값으로 복원하시겠습니까?')) return;
            delete customTooltips[key + '__desc'];
            try {
                await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { customTooltips }, { merge: true });
                showToast("기본값으로 복원되었습니다.");
                _ttRenderTabs(tip, key, 'desc');
            } catch(err) { console.error(err); alert("복원 실패"); }
        });
    });
}

function _ttShowEditor(tip, key, target) {
    // target: 'desc' 또는 'manual'
    const content = tip.querySelector('.info-tip-content');
    const tabBody = content.querySelector(target === 'desc' ? '.tt-tab-desc' : '.tt-tab-manual');
    if (!tabBody) return;
    
    // 편집 모드 활성화 (자동 닫힘 차단)
    _ttEditingLock = true;
    tip.classList.add('tt-editing');
    
    // 현재 값 가져오기 (설명은 사용자본 or 기본값, 메뉴얼은 저장본)
    let currentVal;
    if (target === 'desc') {
        const userDesc = _ttGetStored(key, 'desc');
        currentVal = userDesc ? userDesc : (_ttDefaults[key] || '');
    } else {
        currentVal = _ttGetStored(key, 'manual');
    }
    
    // ★ v3.56: <br> → \n 역변환 (메모장처럼 표시)
    const displayVal = currentVal.replace(/<br\s*\/?>/gi, '\n');
    
    const labelText = target === 'desc' ? '설명 편집' : '메뉴얼 편집';
    
    tabBody.innerHTML = `
        <div class="tt-editor">
            <div class="tt-editor-label">${labelText}</div>
            <div class="tt-toolbar">
                <button type="button" class="tt-tb-btn" data-action="bold" title="굵게">𝐁</button>
                <div class="tt-tb-color-wrap">
                    <button type="button" class="tt-tb-btn" data-action="color-toggle" title="색상">색</button>
                    <div class="tt-tb-palette">
                        <button type="button" class="tt-color-swatch" data-color="#ff5252" style="background:#ff5252;" title="빨강"></button>
                        <button type="button" class="tt-color-swatch" data-color="#e65100" style="background:#e65100;" title="주황"></button>
                        <button type="button" class="tt-color-swatch" data-color="#fbc02d" style="background:#fbc02d;" title="노랑"></button>
                        <button type="button" class="tt-color-swatch" data-color="#2e7d32" style="background:#2e7d32;" title="초록"></button>
                        <button type="button" class="tt-color-swatch" data-color="#1976d2" style="background:#1976d2;" title="파랑"></button>
                        <button type="button" class="tt-color-swatch tt-color-none" data-color="" title="색상 제거">×</button>
                    </div>
                </div>
                <button type="button" class="tt-tb-btn" data-action="hr" title="구분선 삽입">━</button>
            </div>
            <textarea class="tt-editor-textarea" placeholder="메모장처럼 자유롭게 입력하세요.&#10;엔터로 줄바꿈, 위 버튼으로 서식 적용"></textarea>
            <div class="tt-editor-btns">
                <button type="button" class="tt-btn-cancel">취소</button>
                <button type="button" class="tt-btn-save">저장</button>
            </div>
        </div>
    `;
    
    const textarea = tabBody.querySelector('.tt-editor-textarea');
    textarea.value = displayVal;
    textarea.focus();
    
    // 모든 마우스/키보드 이벤트 전파 차단
    ['click','mousedown','mouseup','mousemove','keydown','keyup'].forEach(ev => {
        textarea.addEventListener(ev, (e) => e.stopPropagation());
    });
    
    // ★ v3.56: 서식 툴바 헬퍼 - 커서 위치 또는 선택 영역에 태그 삽입
    function _ttInsertWrap(openTag, closeTag) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        const selected = val.substring(start, end);
        const before = val.substring(0, start);
        const after = val.substring(end);
        const newText = before + openTag + selected + closeTag + after;
        textarea.value = newText;
        // 선택 영역이 있었으면 그 뒤로 커서, 없으면 태그 사이로
        if (selected) {
            const newPos = start + openTag.length + selected.length + closeTag.length;
            textarea.setSelectionRange(newPos, newPos);
        } else {
            const newPos = start + openTag.length;
            textarea.setSelectionRange(newPos, newPos);
        }
        textarea.focus();
    }
    
    function _ttInsertText(text) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + text + val.substring(end);
        const newPos = start + text.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
    }
    
    // 서식 버튼 이벤트
    tabBody.querySelectorAll('.tt-tb-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            if (action === 'bold') {
                _ttInsertWrap('<b>', '</b>');
            } else if (action === 'hr') {
                _ttInsertText('<br>━━━━━━━━━<br>');
            } else if (action === 'color-toggle') {
                const palette = tabBody.querySelector('.tt-tb-palette');
                palette.classList.toggle('open');
            }
        });
    });
    
    // 색상 팔레트 클릭
    tabBody.querySelectorAll('.tt-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = swatch.getAttribute('data-color');
            if (color) {
                _ttInsertWrap(`<span style="color:${color};">`, '</span>');
            } else {
                // 색상 제거: 선택 영역의 color span 태그만 제거
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const val = textarea.value;
                const selected = val.substring(start, end);
                const cleaned = selected.replace(/<span\s+style="color:[^"]*;?">/gi, '').replace(/<\/span>/gi, '');
                textarea.value = val.substring(0, start) + cleaned + val.substring(end);
                textarea.setSelectionRange(start, start + cleaned.length);
            }
            tabBody.querySelector('.tt-tb-palette').classList.remove('open');
            textarea.focus();
        });
    });
    
    // 팔레트 외부 클릭 시 닫기
    tabBody.addEventListener('click', (e) => {
        if (!e.target.closest('.tt-tb-color-wrap')) {
            const palette = tabBody.querySelector('.tt-tb-palette');
            if (palette) palette.classList.remove('open');
        }
    });
    
    tabBody.querySelector('.tt-btn-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        _ttEditingLock = false;
        tip.classList.remove('tt-editing');
        _ttRenderTabs(tip, key, target);
    });
    
    tabBody.querySelector('.tt-btn-save').addEventListener('click', async (e) => {
        e.stopPropagation();
        // ★ v3.56: \n (엔터) → <br> 자동 변환 후 저장
        const rawVal = textarea.value.trim();
        const newVal = rawVal.replace(/\r?\n/g, '<br>');
        const storeKey = key + '__' + target;
        if (newVal) {
            customTooltips[storeKey] = newVal;
        } else {
            delete customTooltips[storeKey];
        }
        // 하위 호환: 메뉴얼 저장 시 구버전 키도 정리
        if (target === 'manual' && customTooltips[key] !== undefined && customTooltips[key] !== newVal) {
            delete customTooltips[key];
        }
        try {
            await setDoc(doc(db, LOC_COLLECTION, 'INFO_CONFIG'), { customTooltips }, { merge: true });
            showToast(`${target === 'desc' ? '설명' : '메뉴얼'}이 저장되었습니다.`);
            _ttEditingLock = false;
            tip.classList.remove('tt-editing');
            _ttRenderTabs(tip, key, target);
        } catch(err) { console.error(err); alert(`${target === 'desc' ? '설명' : '메뉴얼'}을 저장하지 못했습니다(인터넷 연결 확인).` + (err?.code ? ` (${err.code})` : '')); }
    });
}

// 툴팁 열기/닫기 + 위치 계산
let _ttHideTimer = null;
let _ttCurrentTip = null;

function _ttOpenTip(tip) {
    if (_ttHideTimer) { clearTimeout(_ttHideTimer); _ttHideTimer = null; }
    const key = tip.getAttribute('data-tip-key');
    if (!key) return;
    
    document.querySelectorAll('.info-tip.tip-open').forEach(t => {
        if (t !== tip) {
            // 다른 툴팁이 편집 중이면 닫지 않음
            if (t.classList.contains('tt-editing')) return;
            t.classList.remove('tip-open');
            _ttResetTab(t);
        }
    });
    
    tip.classList.add('tip-open');
    _ttCurrentTip = tip;
    
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    
    const r = tip.getBoundingClientRect();
    const cw = content.offsetWidth || 320;
    const ch = content.offsetHeight || 120;
    let x = r.left + r.width / 2 - cw / 2;
    let y = r.top - ch - 10;
    if (y < 8) y = r.bottom + 10;
    if (x < 8) x = 8;
    if (x + cw > window.innerWidth - 8) x = window.innerWidth - cw - 8;

    // v3.97c: 모달 안의 툴팁이면 모달 컨테이너 경계 내로 추가 보정
    const modalContent = tip.closest('.modal-content');
    if (modalContent) {
        const mr = modalContent.getBoundingClientRect();
        if (x < mr.left + 8) x = mr.left + 8;
        if (x + cw > mr.right - 8) x = mr.right - cw - 8;
        // 모달 자체가 cw보다 좁은 경우 보호
        if (x < 8) x = 8;
    }

    content.style.left = x + 'px';
    content.style.top = y + 'px';
}

function _ttResetTab(tip) {
    // 편집 중이면 리셋 금지
    if (_ttEditingLock && tip.classList.contains('tt-editing')) return;
    const content = tip.querySelector('.info-tip-content');
    if (!content) return;
    const key = tip.getAttribute('data-tip-key');
    if (!key) return;
    if (key.startsWith('dyn-')) return; // v3.98a-fix2: 동적 콘텐츠는 리셋하지 않음
    // 설명 탭으로 리셋
    _ttRenderTabs(tip, key, 'desc');
}

function _ttScheduleHide() {
    // 편집 중이면 자동 닫힘 차단
    if (_ttEditingLock) return;
    if (_ttHideTimer) clearTimeout(_ttHideTimer);
    _ttHideTimer = setTimeout(() => {
        if (_ttCurrentTip && !_ttCurrentTip.classList.contains('tt-editing')) {
            _ttCurrentTip.classList.remove('tip-open');
            _ttResetTab(_ttCurrentTip);
            _ttCurrentTip = null;
        }
    }, 300);
}

// 이벤트 바인딩 (v3.80 클릭 토글 방식)
document.addEventListener('click', function(e) {
    const tip = e.target.closest('.info-tip[data-tip-key]');
    const content = e.target.closest('.info-tip-content');

    // 1. ℹ️ 아이콘(또는 툴팁 트리거) 클릭 시 (단, 툴팁 본문 내부 클릭은 제외)
    if (tip && !content) {
        e.stopPropagation(); e.preventDefault(); // 외부 클릭 닫기 방지 + label 등 부모 기본동작 차단
        
        // 초기화 로직 (기존 유지)
        if (!tip.querySelector('.tt-tabs')) {
            const key = tip.getAttribute('data-tip-key');
            // v3.98a-fix2: 동적 콘텐츠 툴팁은 초기화/캐싱 없이 토글만 처리
            if (key && key.startsWith('dyn-')) {
                // 토글 동작으로 바로 이동 (탭 구조 주입 안 함)
            } else {
                if (!_ttDefaults[key]) {
                    const innerContent = tip.querySelector('.info-tip-content');
                    if (innerContent) _ttDefaults[key] = innerContent.innerHTML;
                }
                _ttRenderTabs(tip, key);
            }
        }

        // 토글 동작
        if (tip.classList.contains('tip-open')) {
            if (!_ttEditingLock) { // 편집 중이 아닐 때만 닫기
                tip.classList.remove('tip-open');
                _ttResetTab(tip);
                _ttCurrentTip = null;
            }
        } else {
            _ttOpenTip(tip); // 이 함수가 다른 열린 툴팁을 자동으로 닫음
        }
        return;
    }

    // 2. 툴팁 본문 내부 클릭 시 (편집 등 동작을 위해 아무것도 안 함)
    if (content) return;

    // 3. 그 외 외부 빈 공간 클릭 시 (열려있는 툴팁 닫기)
    document.querySelectorAll('.info-tip.tip-open').forEach(openTip => {
        if (!openTip.classList.contains('tt-editing')) { // 편집 중인 경우 제외
            openTip.classList.remove('tip-open');
            _ttResetTab(openTip);
        }
    });
    _ttCurrentTip = null;
}, true);

// =============================
// 🗺️ 도면 보기 (거리뷰)
// =============================
let currentCorridorIdx = 0;
let svCorridorList = [];
// 도면보기 범례 필터: null | 'empty' | 'content' | 'reserved' | 'preassigned'
let _mapLegendFilter = null;
// 범례 ON 시 모든 구역 표시 모드 (true: 모든 구역 순회, false: currentCorridorIdx 한 구역만)
let _mapShowAllZones = false;

window.updateMapCellSize = function(val) {
    document.getElementById('map-cell-size-label').innerText = val + 'px';
    renderCorridor(currentCorridorIdx);
};

// 도면보기 범례 클릭 → 필터 토글
window.setMapLegendFilter = function(filterType) {
    if (_mapLegendFilter === filterType) {
        _mapLegendFilter = null; // 같은 거 다시 클릭 → 해제
        _mapShowAllZones = false; // 모든 구역 모드도 해제
    } else {
        _mapLegendFilter = filterType;
        _mapShowAllZones = true; // 범례 켜면 모든 구역 표시 모드 진입
    }
    // 범례 UI 활성 표시 업데이트
    const legendMap = {
        'empty': 'map-legend-empty',
        'content': 'map-legend-content',
        'reserved': 'map-legend-reserved',
        'preassigned': 'map-legend-preassigned'
    };
    Object.keys(legendMap).forEach(key => {
        const el = document.getElementById(legendMap[key]);
        if (!el) return;
        el.classList.toggle('is-active', _mapLegendFilter === key);
    });
    // 도면 재렌더링 (opacity 반영)
    renderCorridor(currentCorridorIdx);
};

window.renderMap = function() {
    const mapBody = document.getElementById('map-body');
    const tabContainer = document.getElementById('map-zone-tabs');

    if (!originalData || originalData.length === 0) {
        mapBody.innerHTML = '<div style="text-align:center;padding:60px;color:var(--c-text-3);">서버에서 데이터를 불러오는 중입니다.<br>잠시 후 자동으로 표시됩니다.</div>';
        tabContainer.innerHTML = '';
        return;
    }

    // 구역+동 조합 목록 수집
    // ★구역은 동 없이 단독, 일반구역은 구역+동 조합으로 탭 구성
    svCorridorList = [];

    // ★ 기타 로케이션(비축·샘플 등, 대분류='기타')은 첫 글자 구역에서 분리 → 전용 '기타' 탭으로 모음
    //   (예: '비축-05'가 첫 글자 '비'로 '비구역' 탭에 잘못 묶이던 문제 해결)
    // ★ SAM 로케이션은 첫 글자가 'S'라 S구역으로 묶이던 것을 별도 존이 아닌 '기타' 탭으로 편입
    const isSamLoc = (d) => /^SAM/i.test((d.id || '').trim());
    const isEtcLoc = (d) => (d.category || '피킹용') === '기타' || isSamLoc(d);

    const zoneSet = new Set();
    originalData.forEach(d => { if (!isEtcLoc(d)) zoneSet.add(d.id.charAt(0).toUpperCase()); });
    const zones = [...zoneSet].sort((a, b) => {
        if (a === '★') return -1;
        if (b === '★') return 1;
        return a.localeCompare(b);
    });

    zones.forEach(zone => {
        svCorridorList.push({ zone, label: zone === '★' ? '★★ 구역' : `${zone}구역` });
    });

    // 기타 로케이션이 하나라도 있으면 맨 뒤에 전용 '기타' 탭 추가
    if (originalData.some(isEtcLoc)) {
        svCorridorList.push({ zone: '__ETC__', label: '기타' });
    }

    // 탭 렌더링
    tabContainer.innerHTML = '';
    svCorridorList.forEach((item, i) => {
        const btn = document.createElement('button');
        btn.id = `sv-tab-${i}`;
        btn.innerText = item.label;
        btn.className = 'map-zone-tab';
        btn.onclick = () => {
            _mapShowAllZones = false; // 구역 탭 클릭 → 단일 구역 모드로 전환
            currentCorridorIdx = i;
            renderCorridor(i);
            document.querySelectorAll('#map-zone-tabs button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        tabContainer.appendChild(btn);
    });

    currentCorridorIdx = 0;
    if (svCorridorList.length > 0) document.getElementById('sv-tab-0').click();
};

function renderCorridor(idx) {
    const mapBody = document.getElementById('map-body');
    const cellSize = document.getElementById('map-cell-size') ? Number(document.getElementById('map-cell-size').value) : 54;

    // 셀 공통 함수
    function hasContent(loc) {
        return loc && ((loc.code && loc.code !== loc.id && loc.code.trim() !== '') || (loc.name && loc.name.trim() !== ''));
    }
    // 도면 범례 필터 매칭 검사 (cellStyle 우선순위와 동일: preAssigned > reserved > hasContent > empty)
    function matchesLegendFilter(loc) {
        if (!_mapLegendFilter) return true; // 필터 없음 → 모두 매칭
        if (!loc) return false; // 필터 ON 시 null 셀(격자 placeholder)도 숨김
        if (_mapLegendFilter === 'preassigned') return loc.preAssigned === true;
        if (_mapLegendFilter === 'reserved') return loc.reserved === true && !loc.preAssigned;
        if (_mapLegendFilter === 'content') return hasContent(loc) && !loc.preAssigned && !loc.reserved;
        if (_mapLegendFilter === 'empty') return !hasContent(loc) && !loc.preAssigned && !loc.reserved;
        return true;
    }
    // 변경 추천 [처리함]으로 오늘 옮긴 자리 — 작은 '↻'(cellStyle 은 그대로), 툴팁 한 줄
    const _todayKst = kstDayKey(Date.now());
    function moveMarkHtml(loc) {
        const mv = moveBadge(loc, _todayKst);
        if (!mv) return '';
        const cls = mv.kind === 'mismatch' ? ' warn' : mv.kind === 'out' ? ' out' : '';
        return `<span class="map-move-mark${cls}" title="${escHtmlLite(mv.title)}">↻</span>`;
    }
    function cellStyle(loc) {
        if (!loc) return 'background:var(--c-bg); border:1px dashed var(--c-line);';
        let s;
        if (loc.preAssigned) s = 'background:var(--c-risk-soft); border:1.5px solid var(--c-risk);';
        else if (loc.reserved) s = 'background:var(--c-accent-soft); border:1.5px solid var(--c-accent-mid);';
        else if (hasContent(loc)) s = 'background:var(--c-ok-soft); border:1.5px solid var(--c-ok);';
        else s = 'background:var(--c-surface); border:1px solid var(--c-line-strong);';
        return s;
    }
    function cellInner(loc) {
        if (!loc) return '';
        const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
        const nameColor = hasContent(loc) ? 'var(--c-ok-text)' : 'var(--c-text-3)';
        const idFontSize = Math.max(10, Math.floor(cellSize / 8));
        const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
        const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
        const displayName = nameText.substring(0, maxChars) || '빈칸';
        return `<div style="font-size:${idFontSize}px;color:var(--c-text-3);line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:${cellSize - 4}px;">${loc.id}</div>
                <div style="font-size:${nameFontSize}px;font-weight:600;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize - 4}px;text-align:center;line-height:1.3;">${displayName}</div>${moveMarkHtml(loc)}`;
    }
    function tooltipHtml(loc) {
        if (!loc) return '';
        const isReserved = loc.reserved === true;
        const isPreAssigned = loc.preAssigned === true;
        let status = '빈칸';
        if (isPreAssigned) status = '선지정';
        else if (isReserved) status = `예약중 (${loc.reservedBy || ''})`;
        else if (hasContent(loc)) status = '사용중';
        const tipId = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
        return `<div id="${tipId}" class="sv-tip map-tip">
            <div class="tip-id">${loc.id}</div>
            <div>${status}</div>
            ${hasContent(loc) ? `<div><b>상품명</b>: ${loc.name || '-'}</div>${loc.option ? `<div><b>옵션</b>: ${loc.option}</div>` : ''}<div><b>재고</b>: ${loc.stock || '0'}개</div>` : ''}
            ${isPreAssigned ? `<div style="color:var(--c-risk-text);"><b style="color:inherit;">선지정코드</b>: ${loc.preAssignedCode || '-'}</div>` : ''}
            ${(() => { const mv = moveBadge(loc, _todayKst); return mv ? `<div>↻ ${escHtmlLite(mv.title)}</div>` : ''; })()}
        </div>`;
    }
    function getCell(locs, pos, num) {
        return locs.find(d => {
            const m = d.id.match(/(\d+)$/);
            return (d.pos || '').toString().trim() === pos && m && parseInt(m[1]) === num;
        }) || null;
    }

    function buildRackSection(locs, numsByPos, posLabels, posKey, cellSize) {
        // 필터 ON 시: 전체 매칭 슬롯 0개면 섹션 통째로 빈 문자열 반환
        if (_mapLegendFilter) {
            const anyMatch = posLabels.some(pos => {
                const posNums = (numsByPos[pos] && numsByPos[pos][posKey]) || [];
                return posNums.some(num => {
                    const loc = getCell(locs, pos, num);
                    return loc && matchesLegendFilter(loc);
                });
            });
            if (!anyMatch) return '';
        }
        let html = `<div style="padding:8px 8px;display:flex;flex-direction:column;gap:4px;">`;
        posLabels.forEach(pos => {
            const posNums = (numsByPos[pos] && numsByPos[pos][posKey]) || [];
            // 필터 ON 시: 이 pos 라인에 매칭 슬롯 0개면 라인 통째로 건너뜀 (pos 라벨도 안 그림)
            if (_mapLegendFilter) {
                const hasMatch = posNums.some(num => {
                    const loc = getCell(locs, pos, num);
                    return loc && matchesLegendFilter(loc);
                });
                if (!hasMatch) return;
            }
            html += `<div style="display:flex;flex-direction:row;align-items:center;gap:3px;">
                <div style="font-size:10px;font-weight:600;color:var(--c-text-3);min-width:18px;text-align:center;">${pos}</div>`;
            posNums.forEach(num => {
                const loc = getCell(locs, pos, num);
                if (!loc) {
                    if (_mapLegendFilter) return; // 필터 ON → null 셀(placeholder)도 숨김 (옆이 당겨옴)
                    html += `<div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(null)}border-radius:var(--r-cell);"></div>`;
                    return;
                }
                if (!matchesLegendFilter(loc)) return; // 미매칭 셀은 출력 안 함
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                html += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize + 6}px;${cellStyle(loc)}border-radius:var(--r-cell);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'"
                        onclick="window.copyLocationToClipboard(event, '${jsArg(loc.id)}')">
                        ${cellInner(loc)}
                    </div>${tooltipHtml(loc)}</div>`;
            });
            html += '</div>';
        });
        html += '</div>';
        return html;
    }

    // ★ 기타 로케이션 판별 + 동/위치/번호 없는 로케이션용 단순 격자 렌더러(★구역 starRow와 동일 스타일)
    const isSamLoc = (d) => /^SAM/i.test((d.id || '').trim());
    const isEtc = (d) => (d.category || '피킹용') === '기타' || isSamLoc(d);
    // 기타 탭 내부 세부 분류: 비축 / SAM / 그 외(알파벳-숫자-L,R 등 일반 코드 형태)
    const isBichukLoc = (d) => /^비축/.test((d.id || '').trim());
    function classifyEtc(d) {
        if (isSamLoc(d)) return 'sam';
        if (isBichukLoc(d)) return 'bichuk';
        return 'general';
    }
    function simpleGridCells(locs, cs) {
        const idFontSize = Math.max(10, Math.floor(cs / 8));
        const nameFontSize = Math.max(10, Math.floor(cs / 5));
        const maxChars = Math.max(4, Math.floor((cs - 6) / (nameFontSize * 0.55)));
        let h = '';
        locs.forEach(loc => {
            if (!matchesLegendFilter(loc)) return; // 범례 필터 미매칭 셀 숨김
            const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
            const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
            const nameColor = hasContent(loc) ? 'var(--c-ok-text)' : 'var(--c-text-3)';
            const displayName = nameText.substring(0, maxChars) || '빈칸';
            h += `<div style="position:relative;"
                onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                <div style="width:${cs}px;height:${cs+6}px;${cellStyle(loc)}border-radius:var(--r-cell);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                    onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'"
                    onclick="window.copyLocationToClipboard(event, '${jsArg(loc.id)}')">
                    <div style="font-size:${idFontSize}px;color:var(--c-text-3);line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:${cs-4}px;">${loc.id}</div>
                    <div style="font-size:${nameFontSize}px;font-weight:600;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cs-4}px;text-align:center;line-height:1.3;">${displayName}</div>${moveMarkHtml(loc)}
                </div>${tooltipHtml(loc)}</div>`;
        });
        return h;
    }

    let bodyHtml = '';

    // 모든 구역 모드(범례 ON) vs 단일 구역 모드 분기
    const itemsToRender = (_mapShowAllZones && _mapLegendFilter)
        ? svCorridorList
        : (svCorridorList[idx] ? [svCorridorList[idx]] : []);

    itemsToRender.forEach(item => {
        const isStarZone = item.zone === '★';

        if (isStarZone) {
            const allLocs = originalData.filter(d => d.id.charAt(0) === '★' && !isEtc(d))
                .sort((a, b) => parseInt((a.id.match(/\d+$/) || [0])[0]) - parseInt((b.id.match(/\d+$/) || [0])[0]));
            // 필터 ON 시 ★구역에 매칭 슬롯 0개면 통째로 건너뜀
            if (_mapLegendFilter && !allLocs.some(l => matchesLegendFilter(l))) return;
            const half = Math.ceil(allLocs.length / 2);
        const topLocs = allLocs.slice(0, half);
        const botLocs = allLocs.slice(half);

        // ★★구역 cellSize는 슬라이더 값 사용

        function starRow(locs) {
            // 필터 ON 시: 매칭 슬롯 0개면 빈 문자열 반환
            if (_mapLegendFilter && !locs.some(l => matchesLegendFilter(l))) return '';
            const idFontSize = Math.max(10, Math.floor(cellSize / 8));
            const nameFontSize = Math.max(10, Math.floor(cellSize / 5));
            const maxChars = Math.max(4, Math.floor((cellSize - 6) / (nameFontSize * 0.55)));
            let h = `<div style="padding:8px;display:flex;flex-wrap:wrap;gap:3px;">`;
            locs.forEach(loc => {
                if (!matchesLegendFilter(loc)) return; // 미매칭 셀은 출력 안 함
                const tid = 'tip-' + (loc.id || '').replace(/[^a-zA-Z0-9]/g, '_');
                const nameText = hasContent(loc) ? (loc.name || loc.code || '') : '';
                const nameColor = hasContent(loc) ? 'var(--c-ok-text)' : 'var(--c-text-3)';
                const displayName = nameText.substring(0, maxChars) || '빈칸';
                h += `<div style="position:relative;"
                    onmouseenter="(function(e){var t=document.getElementById('${tid}');if(!t)return;t.style.display='block';var r=e.currentTarget.getBoundingClientRect();var tw=t.offsetWidth||160;var th=t.offsetHeight||100;var x=r.left+r.width/2-tw/2;var y=r.top-th-8;if(y<8)y=r.bottom+8;if(x+tw>window.innerWidth-8)x=window.innerWidth-tw-8;if(x<8)x=8;t.style.left=x+'px';t.style.top=y+'px';})(event)"
                    onmouseleave="(function(){var t=document.getElementById('${tid}');if(t)t.style.display='none';})()">
                    <div style="width:${cellSize}px;height:${cellSize+6}px;${cellStyle(loc)}border-radius:var(--r-cell);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:3px;transition:transform 0.1s;"
                        onmouseenter="this.style.transform='scale(1.06)'" onmouseleave="this.style.transform='scale(1)'"
                        onclick="window.copyLocationToClipboard(event, '${jsArg(loc.id)}')">
                        <div style="font-size:${idFontSize}px;color:var(--c-text-3);line-height:1.1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:${cellSize-4}px;">${loc.id}</div>
                        <div style="font-size:${nameFontSize}px;font-weight:600;color:${nameColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:${cellSize-4}px;text-align:center;line-height:1.3;">${displayName}</div>${moveMarkHtml(loc)}
                    </div>${tooltipHtml(loc)}</div>`;
            });
            h += '</div>';
            return h;
        }

        bodyHtml += `
            <div class="map-sec" style="margin-bottom:0;">
                <div class="map-sec-head">★★ 구역</div>
                ${starRow(topLocs)}
                ${_mapLegendFilter ? '' : `<div class="map-aisle">
                    <div class="aisle-arrow">← ← ←</div>
                    <div class="aisle-label">★★ 통로</div>
                    <div class="aisle-arrow">→ → →</div>
                </div>`}
                ${starRow(botLocs)}
            </div>`;
    } else if (item.zone === '__ETC__') {
        // 기타 구역: 대분류='기타'(+SAM) 로케이션을 비축/SAM/그 외로 나눠서 표시 (동/위치 없음)
        const etcLocs = originalData.filter(isEtc)
            .sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, {numeric: true}));
        const etcGroups = [
            { key: 'bichuk', label: '비축', bg: 'var(--c-warn-bg)', color: 'var(--c-warn-text)', border: 'var(--c-warn-soft)' },
            { key: 'general', label: '기타 (알파벳-숫자-L/R 등)', bg: 'var(--c-surface-2)', color: 'var(--c-text-2)', border: 'var(--c-line)' },
            { key: 'sam', label: 'SAM', bg: 'var(--c-accent-row)', color: 'var(--c-accent-deep)', border: 'var(--c-accent-soft)' }
        ];
        etcGroups.forEach(g => {
            const groupLocs = etcLocs.filter(d => classifyEtc(d) === g.key);
            if (!groupLocs.length) return;
            if (_mapLegendFilter && !groupLocs.some(l => matchesLegendFilter(l))) return;
            const cells = simpleGridCells(groupLocs, cellSize);
            if (cells) {
                bodyHtml += `
                    <div class="map-sec">
                        <div class="map-sec-head" style="background:${g.bg};color:${g.color};border-bottom-color:${g.border};">${g.label}</div>
                        <div style="padding:8px;display:flex;flex-wrap:wrap;gap:3px;">${cells}</div>
                    </div>`;
            }
        });
    } else {
        // 일반구역: 동별로 섹션 나눠서 표시 (기타 로케이션은 전용 탭으로 분리)
        const zoneLocs = originalData.filter(d => d.id.charAt(0).toUpperCase() === item.zone && !isEtc(d));

        const dongSet = new Set();
        zoneLocs.forEach(d => {
            const dongVal = (d.dong || '').toString().trim();
            if (dongVal) dongSet.add(dongVal);
        });
        const dongs = [...dongSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

        dongs.forEach(dong => {
            const allLocs = zoneLocs.filter(d => (d.dong || '').toString().trim() === dong);
            // 필터 ON 시 이 동에 매칭 슬롯 0개면 동 통째로 건너뜀
            if (_mapLegendFilter && !allLocs.some(l => matchesLegendFilter(l))) return;

            const posSet = new Set();
            allLocs.forEach(d => { if (d.pos) posSet.add((d.pos || '').toString().trim()); });
            const posLabels = [...posSet].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
            if (posLabels.length === 0) return;

            const leftNumSet = new Set();
            const rightNumSet = new Set();
            const numsByPos = {};

            posLabels.forEach(pos => {
                const posLocs = allLocs.filter(d => (d.pos || '').toString().trim() === pos);
                const nums = posLocs.map(d => {
                    const m = d.id.match(/(\d+)$/);
                    return m ? parseInt(m[1]) : 0;
                }).filter(n => n > 0).sort((a, b) => a - b);
                const posHalf = Math.ceil(nums.length / 2);
                const leftN = nums.slice(0, posHalf);
                const rightN = nums.slice(posHalf);
                numsByPos[pos] = { left: leftN, right: rightN };
                leftN.forEach(n => leftNumSet.add(n));
                rightN.forEach(n => rightNumSet.add(n));
            });

            const leftNums = [...leftNumSet].sort((a, b) => a - b);
            const rightNums = [...rightNumSet].sort((a, b) => a - b);
            const leftLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && leftNumSet.has(parseInt(m[1])); });
            const rightLocs = allLocs.filter(d => { const m = d.id.match(/(\d+)$/); return m && rightNumSet.has(parseInt(m[1])); });

            // cellSize는 슬라이더 값 사용 (구역별 고정)

            bodyHtml += `
                <div class="map-sec">
                    <div class="map-sec-head">${item.zone}구역 ${dong}동</div>
                    ${buildRackSection(leftLocs, numsByPos, posLabels, 'left', cellSize)}
                    ${_mapLegendFilter ? '' : `<div class="map-aisle">
                        <div class="aisle-arrow">← ← ←</div>
                        <div class="aisle-label">${dong}동 통로</div>
                        <div class="aisle-arrow">→ → →</div>
                    </div>`}
                    ${buildRackSection(rightLocs, numsByPos, posLabels, 'right', cellSize)}
                </div>`;
        });

        // ★ 동/위치/끝번호가 없어 격자에 배치되지 못한 로케이션 → '미배치' 섹션 (도면 누락 방지)
        const isPlaced = (d) => {
            const dongVal = (d.dong || '').toString().trim();
            const posVal = (d.pos || '').toString().trim();
            return !!(dongVal && posVal && /\d+$/.test(d.id || ''));
        };
        const orphanLocs = zoneLocs.filter(d => !isPlaced(d))
            .sort((a, b) => (a.id || '').localeCompare(b.id || '', undefined, {numeric: true}));
        if (orphanLocs.length > 0 && !(_mapLegendFilter && !orphanLocs.some(l => matchesLegendFilter(l)))) {
            const cells = simpleGridCells(orphanLocs, cellSize);
            if (cells) {
                bodyHtml += `
                    <div class="map-sec" style="border-color:var(--c-warn);">
                        <div class="map-sec-head" style="background:var(--c-warn-bg);color:var(--c-warn-text);border-bottom-color:var(--c-warn-soft);">${item.zone}구역 · 미배치 (동/위치 미지정)</div>
                        <div style="padding:8px;display:flex;flex-wrap:wrap;gap:3px;">${cells}</div>
                    </div>`;
            }
        }
    }
    }); // itemsToRender.forEach 닫기

    if (!bodyHtml.trim()) {
        bodyHtml = '<div style="text-align:center;padding:60px;color:var(--c-text-3);font-size:14px;">선택한 필터에 매칭되는 자리가 없습니다.</div>';
    }

    mapBody.innerHTML = `
        <div>
            ${bodyHtml}
            <div style="display:flex;gap:12px;padding:10px 0;flex-wrap:wrap;">
                <span class="map-key"><i style="background:var(--c-ok-soft);border-color:var(--c-ok);"></i>상품있음</span>
                <span class="map-key"><i style="background:var(--c-surface);border-color:var(--c-line-strong);"></i>빈칸</span>
                <span class="map-key"><i style="background:var(--c-accent-soft);border-color:var(--c-accent-mid);"></i>예약중</span>
                <span class="map-key"><i style="background:var(--c-risk-soft);border-color:var(--c-risk);"></i>선지정</span>
            </div>
        </div>
    `;
}
// ====================================================================
// ===== v4.4: 종합 대시보드 + 전일 재고 스냅샷 (메인 시스템 연동) =====
// ====================================================================
// 알고리즘:
//   1. 메인 시스템의 artifacts/team-work-logger-v2/history 컬렉션 감시
//   2. 새 문서(YYYY-MM-DD) 추가 = 업무 마감 발생 → 재고 스냅샷 저장
//   3. 페이지 로드 시 사후 보정: 마지막 history 날짜 vs 저장된 재고 날짜 비교
//      - 다르면 마감 후 미저장 상태 → 현재 시점에 사후 저장
//   4. 저장 구조: artifacts/team-work-logger-v2/locationStock/latest
//      { current: {...}, previous: {...} } 형태로 직전 1개만 유지
//   5. 종합 대시보드 탭: 사용률 팝업 내용 + SKU + 재고회전율 통합
(function v44Module() {
    // ===== 유틸: 오늘 날짜 문자열 (메인 시스템과 동일 KST 보정 방식) =====
    window._v44_getTodayDateString = () => toDateStr();
    
    // ===== 현재 재고 집계 =====
    // 3층은 originalData에서 stock 합산, 2F는 캐시된 데이터에서 가져옴
    window._v44_calculateCurrentStock = function() {
        let stock3F = 0;
        const codes3F = new Set();
        // v4.4 추가: 2층 창고재고 SKU (stock2f > 0인 셀의 고유 상품코드)
        const codes2층 = new Set();
        try {
            (originalData || []).forEach(loc => {
                const s = Number(loc.stock || 0);
                if (!isNaN(s) && s > 0) stock3F += s;
                const c = (loc.code || '').toString().trim();
                if (c && c !== loc.id) codes3F.add(c);
                // 2층창고재고 값이 0이 아닌 셀의 상품코드 모음
                const s2 = Number(loc.stock2f || 0);
                if (!isNaN(s2) && s2 > 0 && c && c !== loc.id) {
                    codes2층.add(c);
                }
            });
        } catch (e) {
            console.warn('[v4.4] 3층 재고 집계 오류:', e);
        }
        
        const cached2F = window._cached2FloorStock || {};
        const stock2F = Number(cached2F.totalStock || 0);
        const sku2F = Number(cached2F.skuCount || 0);
        
        return {
            stock3F: stock3F,
            stock2F: stock2F,
            sku3F: codes3F.size,
            sku2F: sku2F,
            sku2층: codes2층.size, // v4.4 추가: 2층 창고재고 SKU
            date: window._v44_getTodayDateString()
        };
    };
    
    // ===== 2F 캐시 로드 =====
    window._v44_load2FloorCache = async function() {
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'twoFloorLatest');
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                window._cached2FloorStock = snap.data();
                console.log('[v4.4] 2F 캐시 로드 완료: SKU', window._cached2FloorStock.skuCount, '개');
            } else {
                window._cached2FloorStock = { skuCount: 0, totalStock: 0 };
                console.log('[v4.4] 2F 캐시 없음 (첫 적용)');
            }
        } catch (e) {
            console.warn('[v4.4] 2F 캐시 로드 실패:', e);
            window._cached2FloorStock = { skuCount: 0, totalStock: 0 };
        }
    };
    
    // ===== 재고 스냅샷 로드 =====
    window._v44_loadStockSnapshot = async function() {
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'latest');
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                window._cachedStockSnapshot = snap.data();
                console.log('[v4.4] 재고 스냅샷 로드: current.date =', (window._cachedStockSnapshot.current || {}).date, '/ previous.date =', (window._cachedStockSnapshot.previous || {}).date);
            } else {
                window._cachedStockSnapshot = { current: null, previous: null };
                console.log('[v4.4] 재고 스냅샷 없음 (첫 적용)');
            }
        } catch (e) {
            console.warn('[v4.4] 재고 스냅샷 로드 실패:', e);
            window._cachedStockSnapshot = { current: null, previous: null };
        }
    };
    
    // ===== 재고 스냅샷 저장 (v4.4 v2: 일일 최신화 업로드 시 호출) =====
    // 변경 이유: 마감 시점 트리거 → 일일 최신화 트리거로 변경
    //   - 마감 시점은 그날의 originalData 변동이 없을 수 있어 회전율 0% 문제 발생
    //   - 일일 최신화는 실제 새 재고 데이터가 들어오는 시점이라 의미 있음
    // 흐름:
    //   - current.date < 오늘 → 새 영업일 시작: 이전 current를 previous로 이동, 새 current 저장
    //   - current.date == 오늘 → 당일 내 업데이트: previous 유지, current만 덮어쓰기
    //   - current 없음 → 첫 적용: current만 저장
    window._v44_saveStockSnapshot = async function() {
        const newCurrent = window._v44_calculateCurrentStock();
        const today = window._v44_getTodayDateString();
        newCurrent.date = today;
        newCurrent.savedAt = new Date();
        
        const existing = window._cachedStockSnapshot || { current: null, previous: null };
        const oldCurrent = existing.current;
        const oldCurrentDate = oldCurrent?.date || '';
        
        let newPrevious;
        let logMode;
        if (oldCurrentDate && oldCurrentDate < today) {
            // 새 영업일 시작 → 어제 마지막 값을 previous로 이동
            newPrevious = oldCurrent;
            logMode = `새 영업일 시작 (이전 current[${oldCurrentDate}] → previous로 이동)`;
        } else if (oldCurrentDate === today) {
            // 당일 내 업데이트 → previous 그대로, current만 갱신
            newPrevious = existing.previous || null;
            logMode = `당일 내 갱신 (previous 유지)`;
        } else {
            // 첫 적용 (current 없음)
            newPrevious = existing.previous || null;
            logMode = `첫 저장`;
        }
        
        const newSnapshot = {
            current: newCurrent,
            previous: newPrevious
        };
        
        try {
            const docRef = doc(db, 'artifacts', 'team-work-logger-v2', 'locationStock', 'latest');
            await setDoc(docRef, newSnapshot);
            window._cachedStockSnapshot = newSnapshot;
            console.log(`[v4.4] 재고 스냅샷 저장 완료: ${logMode} / 3층 ${newCurrent.stock3F} / 2층 ${newCurrent.stock2F}`);
            return true;
        } catch (e) {
            console.error('[v4.4] 재고 스냅샷 저장 실패:', e);
            return false;
        }
    };
    
    // ===== v4.4 v2: history 리스너 제거됨 =====
    // 이전 v4.4: 메인 시스템의 history 컬렉션 onSnapshot 감지 → 마감 시점에 재고 저장
    // 변경 이유: 마감 시점 originalData가 그날 일일 최신화 결과와 같으면 회전율 0% 문제
    // 새 방식: 일일 최신화 업로드 시점에 저장 (updateDatabaseA 함수가 _v44_saveStockSnapshot 직접 호출)
    // 사용자 운영 패턴상 마감 후 일일 최신화 없음 → 의미 있는 회전율 자연스럽게 나옴
    window._v44_setupHistoryListener = function() {
        console.log('[v4.4] history 리스너는 사용하지 않음 (일일 최신화 업로드 트리거 방식)');
    };
    
    // ===== v4.4 v2: 사후 보정 제거됨 =====
    // 이전 v4.4: 페이지 로드 시 history 최신 문서 vs 저장된 재고 날짜 비교 → 사후 저장
    // 변경 이유: history 리스너 제거에 따라 사후 보정 불필요
    // 일일 최신화 업로드가 명시적 트리거이므로 사후 보정 개념 자체가 없음
    window._v44_postLoadCheck = async function() {
        // No-op
    };
    
    // ===== 재고회전율 계산 =====
    // 산출식: (전일 - 오늘) / 전일 × 100 (음수도 그대로 표시)
    window._v44_calculateTurnover = function() {
        const snap = window._cachedStockSnapshot || {};
        const current = snap.current;
        const previous = snap.previous;
        
        // 데이터 부족
        if (!current || !previous) {
            return {
                sufficient: false,
                message: '데이터 부족 (다음 일일 최신화 후 계산 가능)'
            };
        }
        
        // v4.4 v2: 부호 반전. 증가=양수, 감소=음수
        // 산출식: (current - previous) / previous × 100
        const calc = (prev, curr) => {
            if (!prev || prev === 0) return null; // 0 나누기 방지
            return ((curr - prev) / prev) * 100;
        };
        
        const rate3F = calc(previous.stock3F || 0, current.stock3F || 0);
        const rate2F = calc(previous.stock2F || 0, current.stock2F || 0);
        const prevTotal = (previous.stock3F || 0) + (previous.stock2F || 0);
        const currTotal = (current.stock3F || 0) + (current.stock2F || 0);
        const rateAll = calc(prevTotal, currTotal);
        
        return {
            sufficient: true,
            previousDate: previous.date || previous.triggerDate,
            currentDate: current.date || current.triggerDate,
            rate3F: rate3F,
            rate2F: rate2F,
            rateAll: rateAll,
            previousStock3F: previous.stock3F,
            previousStock2F: previous.stock2F,
            currentStock3F: current.stock3F,
            currentStock2F: current.stock2F
        };
    };
    
    // ===== 대시보드 렌더링 =====
    window._v44_renderDashboard = function() {
        const container = document.getElementById('dashboard-content');
        if (!container) return;
        
        // 1. 요약 카드용 데이터
        const currentStock = window._v44_calculateCurrentStock();
        const turnover = window._v44_calculateTurnover();
        
        // 당일지정수량 / 선지정수량 (기존 사용률 팝업과 동일 계산)
        let codeTagCount = 0;
        let preAssignCount = 0;
        try {
            (originalData || []).forEach(loc => {
                if (loc.codeTag && loc.codeTag.trim() !== '') codeTagCount++;
                if (loc.preAssigned) preAssignCount++;
            });
        } catch (e) {}
        
        const sku3F = currentStock.sku3F;
        const sku2F = currentStock.sku2F;
        const sku2층 = currentStock.sku2층 || 0; // v4.4: 2층 창고재고 SKU
        // v4.4: 총 SKU = 3층 SKU + 2층 SKU (2F SKU는 별도 표시)
        const skuTotal = sku3F + sku2층;
        
        // 카드 렌더링 헬퍼
        const card = (icon, title, value, sub, color) => {
            return `<div style="background:var(--c-surface,white); border:1px solid var(--c-line,#e0e0e0); border-radius:8px; padding:12px 16px; min-width:140px; flex:1; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                <div style="font-size:11px; color:var(--c-text-3,#888); font-weight:bold; margin-bottom:4px;">${icon} ${title}</div>
                <div style="font-size:22px; font-weight:900; color:${color || 'var(--c-text,#333)'};">${value}</div>
                ${sub ? `<div style="font-size:11px; color:var(--c-text-3,#999); margin-top:3px;">${sub}</div>` : ''}
            </div>`;
        };
        
        const formatRate = (rate) => {
            if (rate === null || rate === undefined) return '-';
            const sign = rate > 0 ? '+' : '';
            const color = rate > 0 ? 'var(--c-warn-text,#e65100)' : (rate < 0 ? 'var(--c-accent-deep,#1976d2)' : 'var(--c-text-2,#666)');
            return `<span style="color:${color};">${sign}${rate.toFixed(1)}%</span>`;
        };
        
        // 첫째 줄: 지정 + SKU
        // v4.4 v3: 2F SKU 카드 삭제 - 순서 = 당일지정 / 선지정 / 3층 SKU / 2층 SKU / 총 SKU
        let cardsRow1 = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">';
        cardsRow1 += card('', '당일지정수량', codeTagCount.toLocaleString());
        cardsRow1 += card('', '선지정수량', preAssignCount.toLocaleString());
        cardsRow1 += card('', '3층 SKU', sku3F.toLocaleString(), '고유 상품코드');
        cardsRow1 += card('', '2층 SKU', sku2층.toLocaleString(), '2층창고재고 보유');
        cardsRow1 += card('', '총 SKU', skuTotal.toLocaleString(), '3층 + 2층');
        cardsRow1 += '</div>';
        
        // 둘째 줄: 재고회전율
        // v4.4 v3: 재고회전율(2F) 삭제 - 3층 + 합산만 표시
        let cardsRow2 = '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px;">';
        if (!turnover.sufficient) {
            cardsRow2 += `<div style="background:var(--c-warn-soft,#fff8e1); border:1px solid var(--c-warn,#ffd54f); border-radius:8px; padding:12px 16px; flex:1; font-size:12px; color:var(--c-warn-text,#a36800);">
                ${turnover.message}<br>
                <span style="font-size:11px; color:var(--c-text-3,#999);">일일 최신화 업로드를 2영업일 이상 반복하면 회전율이 계산됩니다</span>
            </div>`;
        } else {
            // v4.4 v2: 날짜+수량을 두 줄로 표시
            const sub3F = `${turnover.previousDate}: ${(turnover.previousStock3F || 0).toLocaleString()}<br>${turnover.currentDate}: ${(turnover.currentStock3F || 0).toLocaleString()}`;
            const prevTotal = (turnover.previousStock3F || 0) + (turnover.previousStock2F || 0);
            const currTotal = (turnover.currentStock3F || 0) + (turnover.currentStock2F || 0);
            const subAll = `${turnover.previousDate}: ${prevTotal.toLocaleString()}<br>${turnover.currentDate}: ${currTotal.toLocaleString()}`;
            cardsRow2 += card('', '재고회전율 (3층)', formatRate(turnover.rate3F), sub3F);
            cardsRow2 += card('', '재고회전율 (합산)', formatRate(turnover.rateAll), subAll);
        }
        cardsRow2 += '</div>';
        
        // 2. 기존 사용률 데이터 통합 (3층 + 2층)
        // 기존 calculateAndRenderUsage 결과를 가져오기 위해 임시로 popup div 사용
        // → 더 깔끔하게 직접 계산
        const usage3FHtml = window._v44_renderUsage3F();
        const usage2FHtml = window._v44_renderUsage2F();
        
        const sectionTitle = (text) => `<div style="font-size:14px; font-weight:bold; color:var(--primary); margin:12px 0 8px 0; padding-bottom:4px; border-bottom:2px solid var(--c-line,#e0e0e0);">${text}</div>`;
        
        container.innerHTML = `
            <div style="padding: 8px 12px;">
                ${sectionTitle('요약 정보')}
                ${cardsRow1}
                ${cardsRow2}
                
                ${sectionTitle('3층 로케이션 사용률')}
                <div style="margin-bottom:18px;">${usage3FHtml}</div>
                
                ${sectionTitle('2층 창고 사용률')}
                <div>${usage2FHtml}</div>
            </div>
        `;
    };
    
    // ===== 3층 사용률 렌더링 (기존 calculateAndRenderUsage의 3F 부분 재사용) =====
    window._v44_renderUsage3F = function() {
        // 기존 사용률 팝업과 동일한 계산 로직을 임시로 호출
        // → 가장 간단: 기존 함수를 호출 후 그 결과 HTML을 추출
        // 그러나 popup div는 별도 영역이므로, 여기서는 임시로 hidden div 사용
        const tempDiv = document.createElement('div');
        tempDiv.id = '_v44_temp_usage';
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        const prevTab = window.currentUsageTab;
        window.currentUsageTab = '3F';
        
        // 기존 사용률 함수가 usage-popup에 출력하므로 임시로 그 div를 대체
        const popupEl = document.getElementById('usage-popup');
        const fakePopup = document.createElement('div');
        fakePopup.id = 'usage-popup';
        if (popupEl && popupEl.parentNode) {
            popupEl.id = '_v44_real_popup';
        }
        tempDiv.appendChild(fakePopup);
        
        let html = '';
        try {
            window.calculateAndRenderUsage();
            // 첫 줄(탭 버튼)은 제거
            const inner = fakePopup.innerHTML;
            // 탭 버튼 div를 제거하기 위해 첫 </div> 이후만 사용
            const firstDivEnd = inner.indexOf('</div>');
            if (firstDivEnd >= 0) {
                html = inner.substring(firstDivEnd + 6);
            } else {
                html = inner;
            }
        } catch (e) {
            console.warn('[v4.4] 3층 사용률 렌더링 실패:', e);
            html = '<div style="padding:20px; text-align:center; color:var(--c-text-3,#999);">사용률 정보를 불러올 수 없습니다.</div>';
        }
        
        // 원복
        window.currentUsageTab = prevTab;
        if (document.getElementById('_v44_real_popup')) {
            document.getElementById('_v44_real_popup').id = 'usage-popup';
        }
        tempDiv.remove();
        
        return html;
    };
    
    // ===== 2층 사용률 렌더링 (기존 함수 재사용) =====
    window._v44_renderUsage2F = function() {
        const tempDiv = document.createElement('div');
        tempDiv.id = '_v44_temp_usage2';
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        const prevTab = window.currentUsageTab;
        window.currentUsageTab = '2F';
        
        const popupEl = document.getElementById('usage-popup');
        const fakePopup = document.createElement('div');
        fakePopup.id = 'usage-popup';
        if (popupEl && popupEl.parentNode) {
            popupEl.id = '_v44_real_popup2';
        }
        tempDiv.appendChild(fakePopup);
        
        let html = '';
        try {
            window.calculateAndRenderUsage();
            const inner = fakePopup.innerHTML;
            const firstDivEnd = inner.indexOf('</div>');
            if (firstDivEnd >= 0) {
                html = inner.substring(firstDivEnd + 6);
            } else {
                html = inner;
            }
        } catch (e) {
            console.warn('[v4.4] 2F 사용률 렌더링 실패:', e);
            html = '<div style="padding:20px; text-align:center; color:var(--c-text-3,#999);">2F 사용률 정보를 불러올 수 없습니다.</div>';
        }
        
        window.currentUsageTab = prevTab;
        if (document.getElementById('_v44_real_popup2')) {
            document.getElementById('_v44_real_popup2').id = 'usage-popup';
        }
        tempDiv.remove();
        
        return html;
    };
    
    // ===== 초기화 (페이지 로드 후 호출됨) =====
    window._v44_init = async function() {
        try {
            console.log('[v4.4] 초기화 시작');
            // 1. 2F 캐시 + 재고 스냅샷 로드
            await window._v44_load2FloorCache();
            await window._v44_loadStockSnapshot();
            
            // 2. 사후 보정 체크
            await window._v44_postLoadCheck();
            
            // 3. history 리스너 설정 (이후 업무 마감 자동 감지)
            window._v44_setupHistoryListener();
            
            console.log('[v4.4] 초기화 완료');
            // 재고 회전율은 스냅샷 로드 후에 계산 가능 → 로케이션 대시보드가 떠 있으면 즉시 갱신
            const __locdashEl = document.getElementById('view-locdash');
            if (__locdashEl && __locdashEl.style.display !== 'none' && typeof window.renderLocationDashboard === 'function') {
                window.renderLocationDashboard();
            }
        } catch (e) {
            console.warn('[v4.4] 초기화 오류:', e);
        }
    };
})();

// ════════════════════════════════════════════════════════════
// 📍 [병합] 로케이션 현황 대시보드 (배포본 v3.94에서 이식)
//    별도 탭 'view-locdash'에서 렌더. v44 종합 대시보드와 독립.
// ════════════════════════════════════════════════════════════

// ============================================================
// 📊 로케이션 현황 대시보드
// ============================================================

// 피킹용이 아닌 자리(대분류 '기타' = 비축·SAM·A-1-R 형식 등) 판정 — 대시보드 여러 곳에서 같은 기준을 쓴다.
window.__isEtcLoc = isEtcLocation;

// '다중 위치 상품': 비축(isEtcLocation) 자리 때문에 2곳 이상이 되는 상품은 기본 제외, '비축포함보기'를 켜면 포함.
//   카드 숫자·상위 5개·전체 리스트가 같은 기준을 쓴다. 켜고 끈 상태는 이 PC 에 기억(저장 실패 시 이번 화면만).
const MULTI_LOC_RESERVE_KEY = 'locMultiLocIncludeReserve';
let multiLocIncludeReserve = false;
try { multiLocIncludeReserve = localStorage.getItem(MULTI_LOC_RESERVE_KEY) === '1'; } catch (e) { /* 기본값 */ }
window.__dashSetMultiLocReserve = function (on) {
    multiLocIncludeReserve = !!on;
    try { localStorage.setItem(MULTI_LOC_RESERVE_KEY, multiLocIncludeReserve ? '1' : '0'); } catch (e) { /* 이번 화면에만 적용 */ }
    if (typeof window.renderLocationDashboard === 'function') window.renderLocationDashboard();
    const modal = document.getElementById('dash-loc-modal');
    if (modal && modal.style.display === 'flex' && modal.dataset.type === 'multiloc') window.__dashShowLocList('multiloc');
};
const multiLocReserveToggle = (id) =>
    `<label style="font-size:12px; font-weight:normal; color:var(--c-text-2); cursor:pointer; user-select:none; white-space:nowrap;" title="비축·SAM 등 피킹 자리가 아닌 위치 때문에 2곳 이상이 되는 상품도 다중 위치로 셉니다">` +
    `<input type="checkbox" id="${id}" style="vertical-align:middle;" ${multiLocIncludeReserve ? 'checked' : ''} onchange="window.__dashSetMultiLocReserve(this.checked)"> ` +
    `<span style="vertical-align:middle;">비축포함보기</span></label>`;

// 마지막출고.배송일(배송일/출고일 중 최신) + 직진/주차별 출고 활동을 함께 고려한 분류 헬퍼.
// 일반배송 기록만 보면 직진배송으로 나간 물건이 데드로 잘못 잡힘 → 두 데이터를 합산.
function __dashInferDelivery(code, locs) {
    let lastDelivery = '';
    let hasStock = false;
    let hasRecentActivity = false;

    locs.forEach(loc => {
        if (Number(loc.stock || 0) > 0) hasStock = true;
        const val = __getLastMoveDate(loc.rawData || {});
        if (val && val > lastDelivery) lastDelivery = val;
    });

    // weeklyData YYYYMMDD 키 중 출고수량 > 0 인 가장 최근 날짜를 후보로
    if (code && weeklyData && weeklyData[code]) {
        let maxKey = '';
        for (const wk of Object.keys(weeklyData[code])) {
            if (/^20\d{6}$/.test(wk) && Number(weeklyData[code][wk] || 0) > 0) {
                if (wk > maxKey) maxKey = wk;
            }
        }
        if (maxKey) {
            const ymd = maxKey.slice(0, 4) + '-' + maxKey.slice(4, 6) + '-' + maxKey.slice(6, 8);
            if (ymd > lastDelivery) lastDelivery = ymd;
        }
    }

    // 직진배송 데이터 — 정확한 날짜는 모르지만 활동 사실은 확인 가능
    if (code && zikjinData && zikjinData[code] && Number(zikjinData[code]['수량'] || 0) > 0) {
        hasRecentActivity = true;
    }

    return { lastDelivery, hasStock, hasRecentActivity };
}

// 구역·동별 데드스톡 표의 정렬 상태 (key: dead|zone|dong|used|w1|m1|m3|m6plus|none, dir: 'asc'|'desc')
let __dashZdSort = { key: 'dead', dir: 'desc' };

// 구역 우선순위 (낮을수록 먼저). ★ → A → B → … → Z 외 나머지는 99.
function __zoneRank(z) {
    if (!z) return 99;
    if (z === '★') return -1;
    const code = z.charCodeAt(0);
    if (code >= 65 && code <= 90) return code - 65; // A=0, B=1, ...
    return 99;
}
// 동 정렬용 — 숫자 추출 후 비교. '미지정'은 항상 맨 뒤.
function __dongKey(d) {
    if (!d || d === '미지정') return Number.POSITIVE_INFINITY;
    const m = String(d).match(/-?\d+(\.\d+)?/);
    if (m) return Number(m[0]);
    return Number.POSITIVE_INFINITY - 1; // 숫자 없으면 거의 끝
}

function __dashSortRows(rows) {
    const { key, dir } = __dashZdSort;
    const mul = dir === 'asc' ? 1 : -1;
    const cmpStr = (a, b) => String(a).localeCompare(String(b)) * mul;
    const cmpNum = (a, b) => (a - b) * mul;
    rows.sort((a, b) => {
        switch (key) {
            case 'zone': {
                const z = __zoneRank(a.zone) - __zoneRank(b.zone);
                if (z !== 0) return z * mul;
                // 동일 구역 내 동 보조 정렬은 항상 오름차순
                const d = __dongKey(a.dong) - __dongKey(b.dong);
                if (d !== 0) return d;
                return cmpStr(a.dong, b.dong);
            }
            case 'dong': {
                const d = __dongKey(a.dong) - __dongKey(b.dong);
                if (d !== 0) return d * mul;
                // 동일 동 내 구역 보조 정렬은 항상 오름차순
                const z = __zoneRank(a.zone) - __zoneRank(b.zone);
                if (z !== 0) return z;
                return cmpStr(a.zone, b.zone);
            }
            case 'used':   return cmpNum(a.usedCount, b.usedCount);
            case 'w1':     return cmpNum(a.w1, b.w1);
            case 'm1':     return cmpNum(a.m1, b.m1);
            case 'm3':     return cmpNum(a.m3, b.m3);
            case 'm6plus': return cmpNum(a.m6plus, b.m6plus);
            case 'y1plus': return cmpNum(a.y1plus, b.y1plus);
            case 'none':   return cmpNum(a.none, b.none);
            case 'dead':
            default:       return cmpNum(a.deadRate, b.deadRate) || cmpNum(a.m6plus, b.m6plus);
        }
    });
}

// 헤더 클릭 핸들러 — 같은 키면 dir 토글, 다른 키면 그 키 + desc(zone/dong은 asc).
window.__dashZdSortBy = function (key) {
    if (__dashZdSort.key === key) {
        __dashZdSort.dir = __dashZdSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        __dashZdSort.key = key;
        // 이름 정렬은 asc, 숫자 정렬은 desc 기본
        __dashZdSort.dir = (key === 'zone' || key === 'dong') ? 'asc' : 'desc';
    }
    if (typeof window.renderLocationDashboard === 'function') window.renderLocationDashboard();
};

// 헤더 화살표 HTML 생성
function __dashSortArrow(key) {
    if (__dashZdSort.key !== key) return '<span style="color:var(--c-text-4,#cfd8dc); font-size:10px;">↕</span>';
    return __dashZdSort.dir === 'asc'
        ? '<span style="color:var(--primary); font-size:11px;">▲</span>'
        : '<span style="color:var(--primary); font-size:11px;">▼</span>';
}

// 분류 헬퍼: 마지막배송일 + 직진 활동 여부 → bucket 키 반환.
// 직진 활동이 있으면 3개월/6개월+/기록없음을 1개월로 끌어올려 데드에서 제외.
function __dashClassifyDelivery(info, todayMs) {
    const MS_DAY = 24 * 60 * 60 * 1000;
    if (!info.lastDelivery) return info.hasRecentActivity ? '1개월' : '기록없음';
    const d = new Date(info.lastDelivery);
    if (isNaN(d.getTime())) return info.hasRecentActivity ? '1개월' : '기록없음';
    const diff = (todayMs - d.getTime()) / MS_DAY;
    if (diff <= 7) return '1주';
    if (diff <= 31) return '1개월';
    if (diff <= 93) return info.hasRecentActivity ? '1개월' : '3개월';
    if (diff <= 365) return info.hasRecentActivity ? '1개월' : '6개월+';
    return info.hasRecentActivity ? '1개월' : '1년+';
}

window.renderLocationDashboard = function () {
    if (!originalData || originalData.length === 0) {
        const kpiRow = document.getElementById('dash-kpi-row');
        if (kpiRow) kpiRow.innerHTML = '<div class="dash-kpi-card" style="grid-column:1/-1;"><div class="kpi-body"><div class="kpi-title">데이터 없음</div><div class="kpi-sub">먼저 일일 최신화 엑셀을 업로드해주세요.</div></div></div>';
        return;
    }

    // 3F만 (K로 시작하는 2F 제외) — SKU/데드스톡 집계용 (기타 위치 포함) — 사용률 팝업 로직과 동일
    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    // ★ 3F 위치를 3분류로 구분: 피킹용 / 기타용(비축+A-1-R 형식) / SAM
    const _isSam = (d) => /^SAM/i.test(String(d.id || '').trim());
    const _isEtcAll = (d) => window.__isEtcLoc(d);
    // 랙 사용률/총 칸수 통계용 — 피킹용(기타·비축·SAM 제외)만
    const locsUsage = locs3F.filter(d => !_isEtcAll(d));
    const etcLocs = locs3F.filter(d => _isEtcAll(d) && !_isSam(d)); // 기타용 = 비축 + A-1-R 형식(대분류 '기타')
    const samLocs = locs3F.filter(d => _isSam(d));                  // SAM 전용 자리
    const total = locsUsage.length;

    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');

    // ---- 집계: 랙 사용률(칸 수 기준) — '기타' 제외 ----
    const zoneStats = {};                  // 구역 → {total, used}
    let used = 0, preAssigned = 0, todayReserved = 0;

    locsUsage.forEach(loc => {
        const u = isUsed(loc);
        if (u) used++;
        if (loc.codeTag === '선지정') preAssigned++;
        if (loc.codeTag === '당일지정') todayReserved++;

        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        if (!zoneStats[zone]) zoneStats[zone] = { total: 0, used: 0 };
        zoneStats[zone].total++;
        if (u) zoneStats[zone].used++;
    });

    // ---- 집계: SKU/재고 (상품코드 기준) — '기타' 포함, locs3F 전체 대상 ----
    const codeToLocs = new Map();          // 상품코드 → [loc, ...]
    let registeredStockSum = 0;

    locs3F.forEach(loc => {
        const u = isUsed(loc);
        if (u && loc.code) {
            const c = String(loc.code).trim();
            if (!codeToLocs.has(c)) codeToLocs.set(c, []);
            codeToLocs.get(c).push(loc);
            registeredStockSum += Number(loc.stock || 0) || 0;
        }
    });

    const uniqueCodes = codeToLocs.size;
    // 기본은 비축 자리를 뺀 개수로 판정('비축포함보기' 켜면 비축 포함) — 모달과 같은 함수·같은 정렬
    const multiLocCodes = multiLocGroups(codeToLocs, isEtcLocation, multiLocIncludeReserve, new Map(originalData.map(l => [normLocId(l.id), l])));
    const empty = total - used;
    const usageRate = total > 0 ? (used / total * 100) : 0;

    // ★ 기타용/SAM 그룹 사용률 집계 (isUsed 재사용)
    const _grpStat = (arr) => { let u = 0; arr.forEach(l => { if (isUsed(l)) u++; }); const t = arr.length; return { total: t, used: u, empty: t - u, rate: t > 0 ? (u / t * 100) : 0 }; };
    const stEtc = _grpStat(etcLocs);
    const stSam = _grpStat(samLocs);

    // 입고대기
    const incomingCodes = Object.keys(incomingTotalByCode || {}).filter(c => (incomingTotalByCode[c] || 0) > 0);
    const incomingQtyTotal = incomingCodes.reduce((a, c) => a + (incomingTotalByCode[c] || 0), 0);
    // 로케이션 지정이 필요한 입고 예정(패널 목록과 같은 기준) — 카드를 누르면 패널이 열린다 · 숫자는 위 '입고 대기 N종'과 같게 수량 > 0 인 코드만
    let needLocN = 0;
    try { needLocN = new Set(incomingNeedLocList('all').map(it => String(it['상품코드'] || '').trim()).filter(c => c && (incomingTotalByCode[c] || 0) > 0)).size; } catch (e) { console.warn('[location] 지정 필요 수 계산 실패:', e && e.message); }

    // 마지막배송일 분포 (정상재고 있는 상품만, 상품코드 기준)
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const MS_DAY = 24 * 60 * 60 * 1000;
    const buckets = { '1주': 0, '1개월': 0, '3개월': 0, '6개월+': 0, '1년+': 0, '기록없음': 0 };
    const bucketsQty = { '1주': 0, '1개월': 0, '3개월': 0, '6개월+': 0, '1년+': 0, '기록없음': 0 };
    codeToLocs.forEach((arr, code) => {
        const __info = __dashInferDelivery(code, arr);
        if (!__info.hasStock) return;
        const __bucketKey = __dashClassifyDelivery(__info, todayMs);
        buckets[__bucketKey]++;
        bucketsQty[__bucketKey] += arr.reduce((s, l) => s + (Number(l.stock || 0) || 0), 0);
        return;
        // (이하 옛 코드는 도달 불가 — 안전상 보존)
        let lastDelivery = '';
        let hasStock = false;
        arr.forEach(loc => {
            if (Number(loc.stock || 0) > 0) hasStock = true;
            const rd = loc.rawData || {};
            let val = rd['마지막배송일'] || rd['마지막입고일'] || '';
            if (!val) {
                // 공백/유니코드 변형 처리
                for (const k of Object.keys(rd)) {
                    const norm = k.replace(/[\s ]/g, '');
                    if (norm === '마지막배송일' || norm === '마지막입고일') { val = rd[k]; break; }
                }
            }
            if (val && val > lastDelivery) lastDelivery = val;
        });
        if (!hasStock) return;
        if (!lastDelivery) { buckets['기록없음']++; return; }
        // lastDelivery는 'YYYY-MM-DD' 또는 'YYYY.MM.DD' 형태로 추정 — 표준 Date 파싱 시도
        const d = new Date(String(lastDelivery).replace(/\./g, '-'));
        if (isNaN(d.getTime())) { buckets['기록없음']++; return; }
        const diff = (todayMs - d.getTime()) / MS_DAY;
        if (diff <= 7) buckets['1주']++;
        else if (diff <= 31) buckets['1개월']++;
        else if (diff <= 93) buckets['3개월']++;
        else buckets['6개월+']++;
    });

    // 데드 스톡 (3개월+) 후보 수 = 3개월 + 6개월+ + 1년+
    const deadStockCount = buckets['3개월'] + buckets['6개월+'] + buckets['1년+'];
    const deadStockQty = bucketsQty['3개월'] + bucketsQty['6개월+'] + bucketsQty['1년+'];

    // 빈 슬롯 비중 높은 동 Top 3
    const dongEmptyStats = {};
    locsUsage.forEach(loc => {
        const dong = (loc.dong || '').toString().trim();
        if (!dong) return;
        if (!dongEmptyStats[dong]) dongEmptyStats[dong] = { total: 0, empty: 0 };
        dongEmptyStats[dong].total++;
        if (!isUsed(loc)) dongEmptyStats[dong].empty++;
    });
    const topEmptyDongs = Object.entries(dongEmptyStats)
        .filter(([, s]) => s.total >= 10)
        .map(([d, s]) => ({ dong: d, empty: s.empty, total: s.total, rate: s.empty / s.total }))
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 3);

    // ---- 재고 회전율 (v4.4 스냅샷 기반: 전일 대비 재고 증감률) ----
    const __turnover = (typeof window._v44_calculateTurnover === 'function')
        ? window._v44_calculateTurnover() : { sufficient: false };
    const __fmtRate = (rate) => {
        if (rate === null || rate === undefined) return '-';
        const sign = rate > 0 ? '+' : '';
        const color = rate > 0 ? TONE.warnText : (rate < 0 ? TONE.accentDeep : TONE.text3);
        return `<span style="color:${color};">${sign}${rate.toFixed(1)}%</span>`;
    };

    // ---- KPI 띠 렌더 ----
    // 사용률 기준색: 90%+ risk / 85%+ warn / 65%+ accent / 그 외 ok (구역 막대도 같은 기준)
    const usageTone = (rate) => rate >= 90 ? 'risk' : rate >= 85 ? 'warn' : rate >= 65 ? 'accent' : 'ok';
    const usageBar = (rate) => {
        const w = Math.max(0, Math.min(100, rate || 0));
        return `<div class="kpi-bar"><div style="width:${w.toFixed(1)}%; background:${TONE[usageTone(rate || 0)]};"></div></div>`;
    };

    const kpiHtml = `
        <div class="dash-kpi-card">
            <div class="kpi-title">피킹용 사용률</div>
            <div class="kpi-value">${usageRate.toFixed(1)}%</div>
            ${usageBar(usageRate)}
            <div class="kpi-sub">${used.toLocaleString()}/${total.toLocaleString()} 칸 · 빈 ${empty.toLocaleString()}</div>
        </div>
        <div class="dash-kpi-card">
            <div class="kpi-title">기타용 사용률 <span class="kpi-note">비축+A-1-R</span></div>
            <div class="kpi-value">${stEtc.total > 0 ? stEtc.rate.toFixed(1) + '%' : '-'}</div>
            ${usageBar(stEtc.rate)}
            <div class="kpi-sub">${stEtc.used.toLocaleString()}/${stEtc.total.toLocaleString()} 칸 · 빈 ${stEtc.empty.toLocaleString()}</div>
        </div>
        <div class="dash-kpi-card">
            <div class="kpi-title">SAM 사용률</div>
            <div class="kpi-value">${stSam.total > 0 ? stSam.rate.toFixed(1) + '%' : '-'}</div>
            ${usageBar(stSam.rate)}
            <div class="kpi-sub">${stSam.used.toLocaleString()}/${stSam.total.toLocaleString()} 칸 · 빈 ${stSam.empty.toLocaleString()}</div>
        </div>
        <div class="dash-kpi-card kpi-click" onclick="window.__dashGoToList('empty', true)" title="클릭: 데이터 리스트에서 피킹용 빈 자리만 보기 (기타·비축·SAM 제외)">
            <div class="kpi-title">피킹용 빈 자리</div>
            <div class="kpi-value" style="color:${TONE.okText};">${empty.toLocaleString()}</div>
            <div class="kpi-sub">전체 대비 ${total > 0 ? (empty / total * 100).toFixed(1) : 0}% · <span class="kpi-link" style="color:${TONE.okText};">목록 보기</span></div>
        </div>
        <div class="dash-kpi-card">
            <div class="kpi-title">등록 상품 (고유)</div>
            <div class="kpi-value">${uniqueCodes.toLocaleString()}<span class="kpi-unit"> 종</span></div>
            <div class="kpi-sub">총 재고 ${registeredStockSum.toLocaleString()}개 · 평균 ${uniqueCodes > 0 ? (used / uniqueCodes).toFixed(1) : 0} 칸/상품</div>
        </div>
        <div class="dash-kpi-card kpi-click" onclick="window.__dashShowLocList('preassigned')" title="클릭: 선지정/당일지정 리스트 보기">
            <div class="kpi-title">선지정 / 당일지정</div>
            <div class="kpi-value"><span style="color:${TONE.riskText};">${preAssigned}</span> <span class="kpi-unit">/</span> <span style="color:${TONE.accentDeep};">${todayReserved}</span></div>
            <div class="kpi-sub">미입고 찜 ${preAssigned}건, 오늘 작업 ${todayReserved}건 · <span class="kpi-link" style="color:${TONE.accentDeep};">목록 보기</span></div>
        </div>
        <div class="dash-kpi-card kpi-incoming${needLocN > 0 ? ' kpi-click' : ''}"${needLocN > 0 ? ` onclick="window.__dashOpenIncoming()" title="클릭: 입고대기 패널을 열어 로케이션 지정"` : ''}>
            <div class="kpi-title">입고 대기</div>
            <div class="kpi-value">${incomingCodes.length}<span class="kpi-unit"> 종</span></div>
            <div class="kpi-sub">총 ${incomingQtyTotal.toLocaleString()} 개 미입고</div>
            ${needLocN > 0 ? `<div class="kpi-sub" style="margin-top:4px;"><span style="color:${TONE.warnText};font-weight:700;">로케이션 지정 필요 ${needLocN.toLocaleString()}종</span> · <span class="kpi-link" style="color:${TONE.accentDeep};">바로 지정</span></div>` : ''}
        </div>
    `;
    document.getElementById('dash-kpi-row').innerHTML = kpiHtml;

    // ---- 구역별 사용률 ----
    const sortedZones = Object.keys(zoneStats).sort((a, b) => (a === '★' ? -1 : (b === '★' ? 1 : a.localeCompare(b))));
    const zoneBars = sortedZones.map(z => {
        const s = zoneStats[z];
        const rate = s.total > 0 ? (s.used / s.total * 100) : 0;
        const tone = usageTone(rate);
        return `<div class="zone-bar-row is-${tone}">
            <div class="zb-label">${z} 구역</div>
            <div class="zb-track"><div class="zb-fill zb-${tone}" style="width:${rate.toFixed(1)}%;"></div></div>
            <div class="zb-text">${s.used} / ${s.total} (${rate.toFixed(1)}%)</div>
        </div>`;
    }).join('');
    document.getElementById('dash-zone-bars').innerHTML = zoneBars || `<div style="color:${TONE.text3}; font-size:12px;">데이터 없음</div>`;

    // ---- 마지막배송일 분포 ----
    // 색: 1주 ok / 1개월 accent / 3개월 accent-mid / 6개월+ warn / 1년+ risk / 기록없음 text-4
    const totalForBuckets = Object.values(buckets).reduce((a, b) => a + b, 0);
    const bucketDef = [
        { key: '1주', cls: 'zb-ok' },
        { key: '1개월', cls: 'zb-accent' },
        { key: '3개월', cls: 'zb-mid' },
        { key: '6개월+', cls: 'zb-warn' },
        { key: '1년+', cls: 'zb-risk' },
        { key: '기록없음', cls: 'zb-none' }
    ];
    const deliveryBars = bucketDef.map(b => {
        const v = buckets[b.key];
        const rate = totalForBuckets > 0 ? (v / totalForBuckets * 100) : 0;
        const cursor = v > 0 ? 'cursor:pointer;' : '';
        const clickAttr = v > 0 ? `onclick="window.__dashShowBucketList('${b.key}')"` : '';
        return `<div class="zone-bar-row" style="${cursor} transition: background 0.15s;" ${clickAttr}
                    onmouseover="if(${v})this.style.background='var(--c-accent-row)';"
                    onmouseout="this.style.background='';"
                    title="${v > 0 ? '클릭: 이 기간 상품 리스트 보기' : ''}">
            <div class="zb-label">${b.key}</div>
            <div class="zb-track"><div class="zb-fill ${b.cls}" style="width:${rate.toFixed(1)}%;"></div></div>
            <div class="zb-text">${v.toLocaleString()} 종 (${rate.toFixed(1)}%)</div>
        </div>`;
    }).join('');
    document.getElementById('dash-delivery-bars').innerHTML = deliveryBars;

    // ---- 인사이트 카드 ----
    const insightHtml = `
        <div class="insight-card">
            <h4>재고 회전</h4>
            ${__turnover.sufficient
                ? `<div class="ins-big">${((__turnover.currentStock3F || 0) + (__turnover.currentStock2F || 0)).toLocaleString()}<span class="kpi-unit"> 개</span> <span style="font-size:15px;">${__fmtRate(__turnover.rateAll)}</span></div>
                   <div class="ins-desc">3층 ${(__turnover.currentStock3F || 0).toLocaleString()}개 ${__fmtRate(__turnover.rate3F)} (전일 대비) · ${__turnover.previousDate} → ${__turnover.currentDate}</div>`
                : `<div class="ins-big" style="font-size:18px; color:${TONE.warnText};">데이터 부족</div>
                   <div class="ins-desc">일일 최신화 2회 이상 누적 시 계산됩니다.</div>`}
        </div>
        <div class="insight-card">
            <h4 style="display:flex; align-items:center; justify-content:space-between; gap:8px;">다중 위치 상품 ${multiLocReserveToggle('dash-multiloc-include-reserve')}</h4>
            <div class="ins-big" ${multiLocCodes.length > 0 ? `style="cursor:pointer; transition: color 0.15s;" onclick="window.__dashShowLocList('multiloc')" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''" title="전체 다중 위치 상품 리스트 보기"` : ''}>
                ${multiLocCodes.length}<span class="kpi-unit"> 종</span>
                ${multiLocCodes.length > 0 ? `<span style="font-size:11px; color:${TONE.text3}; font-weight:normal; margin-left:4px;">▸</span>` : ''}
            </div>
            <div class="ins-desc">한 상품코드가 2곳 이상 분산된 상품${multiLocIncludeReserve ? '(비축 자리 포함)' : '(비축 자리 제외)'}. 통합하면 빈 슬롯이 늘어납니다. <span style="color:${TONE.text3};">(숫자 클릭: 전체 리스트)</span></div>
            <div class="ins-list">
                ${multiLocCodes.slice(0, 5).map(g =>
                    `<div><span class="pill">${g.count}곳</span> ${escAttr(g.code)}</div>`
                ).join('') || `<div style="color:${TONE.text3};">없음</div>`}
            </div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed ${TONE.line}; font-size:12px;">
                <span style="color:${TONE.text}; font-weight:600;">한 자리 2+ 상품</span>
                <span ${(window.__dupLocations || []).length > 0 ? `style="cursor:pointer; color:${TONE.riskText}; font-weight:700; margin-left:4px;" onclick="window.__dashShowLocList('duploc')" title="중복 지정된 로케이션 보기"` : `style="color:${TONE.text3}; margin-left:4px;"`}>${(window.__dupLocations || []).length}건${(window.__dupLocations || []).length > 0 ? ' ▸' : ''}</span>
                <div style="color:${TONE.text3}; font-size:11px; margin-top:2px;">최근 데이터 최신화에서 같은 로케이션에 다른 상품이 들어온 경우</div>
            </div>
        </div>
        <div class="insight-card">
            <h4>데드 스톡 후보</h4>
            <div class="ins-big" ${deadStockCount > 0 ? `style="cursor:pointer; transition: color 0.15s;" onclick="window.__dashShowBucketList('dead-all')" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color=''" title="전체 데드스톡 합계 리스트 보기"` : ''}>
                ${deadStockCount}<span class="kpi-unit"> 종</span>
                <span class="kpi-unit"> / ${deadStockQty.toLocaleString()}개</span>
                ${deadStockCount > 0 ? `<span style="font-size:11px; color:${TONE.text3}; font-weight:normal; margin-left:4px;">▸</span>` : ''}
            </div>
            <div class="ins-list" style="display:flex; flex-direction:column; align-items:flex-start; gap:6px; line-height:1.4;">
                <span class="pill" style="cursor:pointer; background:${TONE.accentLight}; color:${TONE.accentDeep};" onclick="window.__dashShowBucketList('3개월')" title="3개월 경과 상품 보기">3개월: ${buckets['3개월']}종 / ${bucketsQty['3개월'].toLocaleString()}개</span>
                <span class="pill" style="cursor:pointer; background:${TONE.warnSoft}; color:${TONE.warnText};" onclick="window.__dashShowBucketList('6개월+')" title="6개월~1년 경과 상품 보기">6개월+: ${buckets['6개월+']}종 / ${bucketsQty['6개월+'].toLocaleString()}개</span>
                <span class="pill" style="cursor:pointer; background:${TONE.riskSoft}; color:${TONE.riskText};" onclick="window.__dashShowBucketList('1년+')" title="1년 이상 경과 상품 보기">1년+: ${buckets['1년+']}종 / ${bucketsQty['1년+'].toLocaleString()}개</span>
            </div>
        </div>
        <div class="insight-card">
            <h4>빈 자리 많은 동 Top 3</h4>
            ${topEmptyDongs.length > 0 ? `
                <div class="ins-list" style="margin-top: 4px;">
                    ${topEmptyDongs.map(d => `
                        <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                            <span class="pill" style="background:${TONE.okSoft}; color:${TONE.okText};">${d.dong}동</span>
                            <span style="color:${TONE.text}; font-weight:600;">${d.empty}/${d.total}</span>
                            <span style="color:${TONE.text3};">(${(d.rate * 100).toFixed(0)}%)</span>
                        </div>
                    `).join('')}
                </div>
            ` : `<div style="color:${TONE.text3}; font-size:12px; margin-top: 8px;">동 데이터가 부족합니다.</div>`}
        </div>
    `;
    document.getElementById('dash-insight-row').innerHTML = insightHtml;
    mountRouteSlot();   // '동선 효율' 카드 칸(변경 추천 권한일 때만, js/locrec-route-card.js) — 위에서 줄을 새로 그려 다시 붙인다

    // ---- 처리할 일 ----
    // 색: 입고 warn / 변경추천 accent / 빈칸확보 ok — 아이콘은 선 SVG
    const taskIcon = {
        box: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z"></path><path d="M3 8v8l9 5 9-5V8"></path></svg>',
        swap: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3"></path></svg>',
        grid: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"></rect><rect x="13" y="4" width="7" height="7" rx="1.5"></rect><rect x="4" y="13" width="7" height="7" rx="1.5"></rect><rect x="13" y="13" width="7" height="7" rx="1.5" stroke-dasharray="2 2"></rect></svg>'
    };
    const actionsHtml = `
        <button class="dash-task" onclick="window.toggleIncomingSidebar()">
            <span class="dash-task-ic tone-warn">${taskIcon.box}</span><span class="dash-task-label">입고대기 패널</span><span class="badge badge-warn">${incomingCodes.length}건</span>
        </button>
        <button class="dash-task" onclick="document.getElementById('modal-2f').style.display='flex'; window.calc2FList && window.calc2FList();">
            <span class="dash-task-ic tone-ok">${taskIcon.grid}</span><span class="dash-task-label">빈칸확보</span><span class="dash-task-go" style="color:${TONE.okText};">열기</span>
        </button>
    `;
    document.getElementById('dash-actions').innerHTML = actionsHtml;

    // ---- 구역·동별 데드스톡 분석 ----
    renderZoneDongDeadStock(locs3F, isUsed);

    // ---- 데이터 신선도 ----
    const zikjinKeys = Object.keys(zikjinData || {}).length;
    const weeklyKeys = Object.keys(weeklyData || {}).length;
    const freshHtml = `
        <div><b>오늘:</b> ${new Date().toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</div>
        <div><b>플랫폼 출고 데이터:</b> ${zikjinKeys > 0 ? zikjinKeys.toLocaleString() + '건' : `<button type="button" class="fresh-upload-link" style="color:${TONE.riskText};" title="눌러서 플랫폼 출고 데이터 파일 고르기" onclick="event.stopPropagation(); document.getElementById('excel-upload-zikjin')?.click();">미업로드</button>`}</div>
        <div><b>주차별 데이터:</b> ${weeklyKeys > 0 ? weeklyKeys.toLocaleString() + '건' : `<button type="button" class="fresh-upload-link" style="color:${TONE.riskText};" title="눌러서 주차별 데이터 파일 고르기" onclick="event.stopPropagation(); document.getElementById('excel-upload-weekly')?.click();">미업로드</button>`}</div>
        <div><b>입고대기 종 수:</b> ${incomingCodes.length.toLocaleString()}</div>
        <div><b>등록 로케이션:</b> ${originalData.length.toLocaleString()}칸 (3F: ${total.toLocaleString()}, 그 외: ${(originalData.length - total).toLocaleString()})</div>
    `;
    document.getElementById('dash-freshness').innerHTML = freshHtml;
};

// 구역·동별 데드스톡 집계 + 테이블 렌더
function renderZoneDongDeadStock(locs3F, isUsed) {
    const tbody = document.getElementById('dash-zonedong-tbody');
    const thead = document.getElementById('dash-zonedong-thead');
    const summary = document.getElementById('dash-zonedong-summary');
    if (!tbody) return;

    // 정렬 헤더 렌더
    if (thead) {
        const A = __dashSortArrow;
        const sortKey = __dashZdSort.key;
        const cellBase = `padding:8px; border:1px solid ${TONE.line}; cursor:pointer; user-select:none; font-weight:600; color:${TONE.text2};`;
        const isActive = (k) => sortKey === k;
        const hl = (k, baseBg) => isActive(k) ? `background:${TONE.accentSoft}; color:${TONE.accentDeep};` : (baseBg ? `background:${baseBg};` : '');
        const zoneSubActive = sortKey === 'zone';
        const dongSubActive = sortKey === 'dong';
        thead.innerHTML = `
            <tr style="background:${TONE.surface2};">
                <th style="${cellBase} ${(zoneSubActive||dongSubActive)?`background:${TONE.accentSoft};`:''}" title="구역 또는 동 기준 정렬">
                    <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                        <span onclick="window.__dashZdSortBy('zone')" style="cursor:pointer; padding:2px 8px; border-radius:var(--r-pill); ${zoneSubActive?'background:var(--c-surface); color:var(--c-accent-deep); font-weight:700;':`color:${TONE.text};`}">
                            구역 ${A('zone')}
                        </span>
                        <span style="color:${TONE.text4};">|</span>
                        <span onclick="window.__dashZdSortBy('dong')" style="cursor:pointer; padding:2px 8px; border-radius:var(--r-pill); ${dongSubActive?'background:var(--c-surface); color:var(--c-accent-deep); font-weight:700;':`color:${TONE.text};`}">
                            동 ${A('dong')}
                        </span>
                    </div>
                </th>
                <th style="${cellBase} ${hl('used')}" onclick="window.__dashZdSortBy('used')">사용중 ${A('used')}</th>
                <th style="${cellBase} ${hl('w1', TONE.okSoft)}" onclick="window.__dashZdSortBy('w1')">1주 ${A('w1')}</th>
                <th style="${cellBase} ${hl('m1', TONE.accentSoft)}" onclick="window.__dashZdSortBy('m1')">1개월 ${A('m1')}</th>
                <th style="${cellBase} ${hl('m3', TONE.accentLight)}" onclick="window.__dashZdSortBy('m3')">3개월 ${A('m3')}</th>
                <th style="${cellBase} ${hl('m6plus', TONE.warnSoft)}" onclick="window.__dashZdSortBy('m6plus')">6개월+ ${A('m6plus')}</th>
                <th style="${cellBase} ${hl('y1plus', TONE.riskSoft)}" onclick="window.__dashZdSortBy('y1plus')">1년+ ${A('y1plus')}</th>
                <th style="${cellBase} ${hl('none', TONE.track)}" onclick="window.__dashZdSortBy('none')">기록없음 ${A('none')}</th>
                <th style="${cellBase} ${hl('dead')} min-width: 180px;" onclick="window.__dashZdSortBy('dead')">데드율 (3개월+) ${A('dead')}</th>
            </tr>
        `;
    }

    const includeNone = !!document.getElementById('dash-zd-include-none')?.checked;
    const minSlots = Math.max(0, Number(document.getElementById('dash-zd-min-slots')?.value || 10));

    const todayMs = new Date().setHours(0, 0, 0, 0);
    const MS_DAY = 24 * 60 * 60 * 1000;

    // (zone, dong) → 상품코드 Map → bucket
    const groupMap = new Map(); // key 'A-1' → { codeMap: Map<code,locs[]>, zone, dong }

    locs3F.forEach(loc => {
        if (!isUsed(loc)) return;
        const code = String(loc.code || '').trim();
        if (!code) return;
        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        const dong = String(loc.dong || '').trim() || '미지정';
        const key = `${zone}-${dong}`;
        if (!groupMap.has(key)) groupMap.set(key, { zone, dong, codeMap: new Map() });
        const grp = groupMap.get(key);
        if (!grp.codeMap.has(code)) grp.codeMap.set(code, []);
        grp.codeMap.get(code).push(loc);
    });

    // 상품코드 단위로 bucket 분류 (전체 차트와 동일한 방법)
    const lastDeliveryOfCode = (locs) => {
        let lastDelivery = '';
        let hasStock = false;
        locs.forEach(loc => {
            if (Number(loc.stock || 0) > 0) hasStock = true;
            const rd = loc.rawData || {};
            let val = rd['마지막배송일'] || rd['마지막입고일'] || '';
            if (!val) {
                for (const k of Object.keys(rd)) {
                    const norm = k.replace(/[\s ]/g, '');
                    if (norm === '마지막배송일' || norm === '마지막입고일') { val = rd[k]; break; }
                }
            }
            if (val && val > lastDelivery) lastDelivery = val;
        });
        return { lastDelivery, hasStock };
    };

    const rows = [];
    groupMap.forEach(grp => {
        let usedCount = 0, w1 = 0, m1 = 0, m3 = 0, m6plus = 0, y1plus = 0, none = 0;
        grp.codeMap.forEach((arr, code) => {
            // 🛡️ 직진/주차 출고 활동 보강 헬퍼 사용 (전체 차트와 동일)
            const info = __dashInferDelivery(code, arr);
            if (!info.hasStock) return;
            usedCount++;
            const cat = __dashClassifyDelivery(info, todayMs);
            if (cat === '1주') w1++;
            else if (cat === '1개월') m1++;
            else if (cat === '3개월') m3++;
            else if (cat === '6개월+') m6plus++;
            else if (cat === '1년+') y1plus++;
            else none++;
            return;
            // (이하 구버전 로직 — 안전상 보존, 도달 불가)
            const { lastDelivery, hasStock } = lastDeliveryOfCode(arr);
            if (!hasStock) return;
            usedCount++;
            if (!lastDelivery) { none++; return; }
            const d = new Date(String(lastDelivery).replace(/\./g, '-'));
            if (isNaN(d.getTime())) { none++; return; }
            const diff = (todayMs - d.getTime()) / MS_DAY;
            if (diff <= 7) w1++;
            else if (diff <= 31) m1++;
            else if (diff <= 93) m3++;
            else m6plus++;
        });
        if (usedCount < minSlots) return;
        const deadBase = includeNone ? (m3 + m6plus + y1plus + none) : (m3 + m6plus + y1plus);
        const deadRate = usedCount > 0 ? (deadBase / usedCount * 100) : 0;
        rows.push({ ...grp, usedCount, w1, m1, m3, m6plus, y1plus, none, deadRate });
    });

    __dashSortRows(rows);

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px; color:${TONE.text3};">조건에 맞는 구역-동이 없습니다. (최소 사용 슬롯 ${minSlots} 기준)</td></tr>`;
        if (summary) summary.innerHTML = '';
        return;
    }

    const cellFmt = (v) => v > 0 ? v.toLocaleString() : `<span style="color:${TONE.text4};">·</span>`;
    // 데드율 내림차순 정렬일 때만 1~3위 강조 (다른 정렬에선 의미 없으므로 끔)
    const isDefaultDeadSort = __dashZdSort.key === 'dead' && __dashZdSort.dir === 'desc';
    const html = rows.map((r, idx) => {
        // 데드율 색: 50%+ risk / 30%+ warn / 15%+ accent-mid / 그 외 ok (막대=기본색, 숫자=글자색)
        const barColor = r.deadRate >= 50 ? TONE.risk : r.deadRate >= 30 ? TONE.warn : r.deadRate >= 15 ? TONE.accentMid : TONE.ok;
        const rateColor = r.deadRate >= 50 ? TONE.riskText : r.deadRate >= 30 ? TONE.warnText : r.deadRate >= 15 ? TONE.accentDeep : TONE.okText;
        const showRank = isDefaultDeadSort && idx < 3;
        const rankBadge = showRank ? `<span style="display:inline-block; background:${idx===0?TONE.risk:TONE.warn}; color:white; font-weight:700; font-size:10.5px; padding:2px 8px; border-radius:var(--r-pill); margin-right:6px;">${idx+1}위</span>` : '';
        // 클릭 셀 빌더 (값 > 0 이고 bucket 있을 때만 클릭 가능)
        const clickCell = (bucket, value, baseStyle) => {
            if (value > 0) {
                const safeZ = String(r.zone).replace(/'/g, "\\'");
                const safeD = String(r.dong).replace(/'/g, "\\'");
                return `<td style="${baseStyle} cursor:pointer;" onclick="window.__dashShowBucketList('${bucket}','${safeZ}','${safeD}')" title="${r.zone}-${r.dong} ${bucket} 상품 보기" onmouseover="this.style.background='var(--c-accent-row)';" onmouseout="this.style.background='';">${cellFmt(value)}</td>`;
            }
            return `<td style="${baseStyle}">${cellFmt(value)}</td>`;
        };
        return `
        <tr style="${showRank ? `background: ${TONE.warnBg};` : ''}">
            <td style="padding:8px; border:1px solid ${TONE.line}; font-weight:600; text-align:left;">${rankBadge}${r.zone} 구역 - ${r.dong} 동</td>
            <td style="padding:8px; border:1px solid ${TONE.line};">${r.usedCount.toLocaleString()}</td>
            ${clickCell('1주', r.w1, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.okText};`)}
            ${clickCell('1개월', r.m1, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.accent};`)}
            ${clickCell('3개월', r.m3, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.accentDeep}; font-weight:600;`)}
            ${clickCell('6개월+', r.m6plus, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.warnText}; font-weight:600;`)}
            ${clickCell('1년+', r.y1plus, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.riskText}; font-weight:600; background:${TONE.riskRow};`)}
            ${clickCell('기록없음', r.none, `padding:8px; border:1px solid ${TONE.line}; color:${TONE.text3};`)}
            <td style="padding:8px; border:1px solid ${TONE.line};">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="flex:1; background:${TONE.track}; height:8px; border-radius:4px; overflow:hidden;">
                        <div style="height:100%; width:${r.deadRate.toFixed(1)}%; background:${barColor}; border-radius:4px; transition: width 0.4s;"></div>
                    </div>
                    <span style="font-weight:600; color:${rateColor}; min-width: 42px; text-align:right; font-variant-numeric: tabular-nums;">${r.deadRate.toFixed(1)}%</span>
                </div>
            </td>
        </tr>`;
    }).join('');
    tbody.innerHTML = html;

    // 요약: 가중 평균 / 최악 / 최상
    const totalUsed = rows.reduce((a, r) => a + r.usedCount, 0);
    const totalDead = rows.reduce((a, r) => a + (includeNone ? r.m3 + r.m6plus + r.y1plus + r.none : r.m3 + r.m6plus + r.y1plus), 0);
    const avgRate = totalUsed > 0 ? (totalDead / totalUsed * 100) : 0;
    const worst = rows[0];
    const best = rows[rows.length - 1];
    if (summary) {
        summary.innerHTML = `
            표시된 ${rows.length}개 구역-동의 평균 데드율: <b style="color:${TONE.text};">${avgRate.toFixed(1)}%</b>
            &nbsp;|&nbsp; 최악: <b style="color:${TONE.riskText};">${worst.zone}-${worst.dong}동 (${worst.deadRate.toFixed(1)}%)</b>
            &nbsp;|&nbsp; 최상: <b style="color:${TONE.okText};">${best.zone}-${best.dong}동 (${best.deadRate.toFixed(1)}%)</b>
            ${includeNone ? ` &nbsp;<span style="color:${TONE.text3};">(기록없음 포함)</span>` : ''}
        `;
    }
}

// ============================================================
// 📅 bucket 클릭 → 상품 리스트 모달
// ============================================================
let __dashLastBucketList = []; // 엑셀 다운로드용 캐시

window.__dashShowBucketList = function (bucket, zoneFilter, dongFilter) {
    const modal = document.getElementById('dash-bucket-modal');
    const titleEl = document.getElementById('dash-bucket-title');
    const metaEl = document.getElementById('dash-bucket-meta');
    const tbody = document.getElementById('dash-bucket-tbody');
    if (!modal || !tbody) return;

    // 3F만, isUsed (코드+name) 인 로케이션만
    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');

    // zone/dong 필터 적용 후 상품코드 단위 그룹화
    const codeMap = new Map();
    locs3F.forEach(loc => {
        if (!isUsed(loc)) return;
        const zone = (loc.id || '').charAt(0).toUpperCase() || '?';
        const dong = String(loc.dong || '').trim() || '미지정';
        if (zoneFilter && zone !== zoneFilter) return;
        if (dongFilter && dong !== dongFilter) return;
        const code = String(loc.code || '').trim();
        if (!code) return;
        if (!codeMap.has(code)) codeMap.set(code, []);
        codeMap.get(code).push(loc);
    });

    // 자리 id 로 실제 로케이션을 찾기 위한 맵 (공백·NBSP·대소문자 흔들림을 흡수)
    // (normLocId 는 lib/multi-loc.js — 다중 위치 상품과 같은 함수)
    const locById = new Map(originalData.map(l => [normLocId(l.id), l]));

    // 비축랙 자리 표시 여부 (체크박스, 기본 꺼짐)
    const includeEtc = !!document.getElementById('dash-bucket-include-etc')?.checked;

    const todayMs = new Date().setHours(0, 0, 0, 0);
    // bucket이 'dead-all'이면 데드스톡 3종(3개월/6개월+/1년+)을 모두 포함.
    const DEAD_SET = new Set(['3개월', '6개월+', '1년+']);
    const isDeadAll = bucket === 'dead-all';
    const items = [];
    codeMap.forEach((arr, code) => {
        const info = __dashInferDelivery(code, arr);
        if (!info.hasStock) return;
        const cat = __dashClassifyDelivery(info, todayMs);
        if (isDeadAll) {
            if (!DEAD_SET.has(cat)) return;
        } else if (cat !== bucket) return;

        // 대표 정보 — 같은 코드여도 위치 여러 곳이면 모두 노출
        const rep = arr[0] || {};
        const name = rep.name || (zikjinData[code]?.['상품명']) || (weeklyData[code]?.['상품명']) || '';
        const option = rep.option || '';
        // 현재 위치: 피킹 자리와 비축랙 자리를 나눠 둔다 (기본은 피킹만 표시, 체크하면 비축랙도 함께)
        // ★ 비축랙 자리는 상품 행의 '옵션추가항목1'(예: '비축-002,비축-007,H-3-L')이 정확하다.
        //   비축 칸 문서에는 상품코드가 한 개만 남아(나중 행이 덮어씀) 거꾸로 찾으면 대부분 빠진다.
        //   → reserveLocIds(lib/multi-loc.js) — '다중 위치 상품'의 비축 자리도 같은 함수로 센다.
        const pickRows = arr.filter(l => !window.__isEtcLoc(l));
        const pickLocs = pickRows.map(l => l.id);
        const etcLocs = reserveLocIds(arr, locById, window.__isEtcLoc);
        const locsStr = (includeEtc ? [...pickLocs, ...etcLocs] : pickLocs).join(', ');
        const sumStock = (rows) => rows.reduce((a, l) => a + Number(l.stock || 0), 0);
        const totalStock2f = arr.reduce((a, l) => Math.max(a, Number(l.stock2f || 0)), 0);
        items.push({
            code, name, option,
            locsStr, pickLocs, etcLocs,
            stock: sumStock(arr),
            stockPick: sumStock(pickRows),
            stock2f: totalStock2f,
            lastDelivery: info.lastDelivery || '',
            hasRecentActivity: info.hasRecentActivity,
            cat
        });
    });

    // 정렬: 마지막배송일 오래된 순 (기록없음 맨 위)
    items.sort((a, b) => {
        if (!a.lastDelivery && !b.lastDelivery) return 0;
        if (!a.lastDelivery) return -1;
        if (!b.lastDelivery) return 1;
        return a.lastDelivery.localeCompare(b.lastDelivery);
    });

    __dashLastBucketList = { bucket, zoneFilter, dongFilter, items };

    // 헤더 텍스트
    const scopeLabel = (zoneFilter || dongFilter)
        ? `${zoneFilter || '전체구역'} - ${dongFilter || '전체동'} `
        : '전체 ';
    const displayBucket = isDeadAll ? '데드스톡 후보 합계' : bucket;
    if (titleEl) {
        titleEl.querySelector('span').textContent = `${scopeLabel}[${displayBucket}] 상품 리스트 (${items.length}종)`;
    }
    if (metaEl) {
        const desc = isDeadAll
            ? '3개월 / 6개월+ / 1년+ 합계 — 우선 정리/이동 대상'
            : ({
                '1주': '최근 1주일 내 출고된 상품 (회전 양호)',
                '1개월': '최근 1개월 내 출고된 상품',
                '3개월': '1~3개월 내 마지막 출고 — 데드 후보',
                '6개월+': '3~12개월 내 마지막 출고 — 데드',
                '1년+': '1년 이상 출고 없는 재고 — 우선 정리 대상',
                '기록없음': '마지막출고.배송일 기록이 없는 상품'
            }[bucket] || '');
        const etcCount = items.filter(it => it.etcLocs.length > 0).length;
        metaEl.textContent = desc + (etcCount > 0
            ? ` · 비축·기타 자리에도 지정된 상품 ${etcCount}종 (${includeEtc ? '함께 표시 중' : '표시하려면 오른쪽 체크'})` : '');
    }

    // dead-all 모드일 때 분류 컬럼 추가
    const thead = document.querySelector('#dash-bucket-modal thead tr');
    if (thead) {
        // 기존 분류 컬럼이 있으면 제거
        const oldCatTh = thead.querySelector('th[data-cat-col]');
        if (oldCatTh) oldCatTh.remove();
        if (isDeadAll) {
            const th = document.createElement('th');
            th.setAttribute('data-cat-col', '1');
            th.style.borderTop = 'none';
            th.textContent = '분류';
            thead.insertBefore(th, thead.children[thead.children.length - 2]); // 마지막배송일 앞
        }
    }

    if (items.length === 0) {
        const colCount = isDeadAll ? 9 : 8;
        tbody.innerHTML = `<tr><td colspan="${colCount}" style="padding:30px; text-align:center; color:var(--c-text-3);">해당 조건에 맞는 상품이 없습니다.</td></tr>`;
    } else {
        const catBadge = (cat) => {
            // 출고 경과 매핑(대시보드와 같음): 3개월 accent-mid · 6개월+ warn · 1년+ risk — soft 바탕
            const colors = {
                '3개월': 'background:var(--c-accent-soft); color:var(--c-accent-deep);',
                '6개월+': 'background:var(--c-warn-soft); color:var(--c-warn-text);',
                '1년+': 'background:var(--c-risk-soft); color:var(--c-risk-text);'
            };
            return `<span style="${colors[cat] || 'background:var(--c-track); color:var(--c-text-2);'} padding:2px 8px; border-radius:var(--r-pill); font-size:11px; font-weight:600;">${cat}</span>`;
        };
        const etcHint = (it) => ` <span style="color:var(--c-warn-text); font-size:10px;" title="${escAttr(it.etcLocs.join(', '))}">비축랙 ${it.etcLocs.length}곳</span>`;
        tbody.innerHTML = items.map(it => `
            <tr>
                <td style="font-family:monospace; font-size:11px;">${escAttr(it.code)}</td>
                <td style="text-align:left; padding-left:8px;">${escAttr(it.name) || '<span style=\"color:var(--c-text-4);\">-</span>'}</td>
                <td>${escAttr(it.option) || '<span style=\"color:var(--c-text-4);\">-</span>'}</td>
                <td style="font-family:monospace; font-size:11px;">${escAttr(it.locsStr)
                    || '<span style="color:var(--c-text-4);">-</span>'}${
                    (!includeEtc && it.etcLocs.length) ? etcHint(it) : ''}</td>
                <td style="font-weight:600;">${it.stockPick.toLocaleString()}</td>
                <td style="color:var(--c-text-2);">${it.stock2f > 0 ? it.stock2f.toLocaleString() : '<span style=\"color:var(--c-text-4);\">·</span>'}</td>
                ${isDeadAll ? `<td>${catBadge(it.cat)}</td>` : ''}
                <td>${it.lastDelivery || '<span style=\"color:var(--c-risk-text);\">기록없음</span>'}</td>
                <td>${it.hasRecentActivity ? '<span style="background:var(--c-ok-soft); color:var(--c-ok-text); padding:2px 8px; border-radius:var(--r-pill); font-size:10px; font-weight:600;">직진 활동</span>' : '<span style=\"color:var(--c-text-4);\">·</span>'}</td>
            </tr>
        `).join('');
    }

    modal.style.display = 'flex';
};

// ============================================================
// 📍 KPI 카드 클릭 → 상세 리스트 모달 (빈자리 / 선지정·당일지정 / 다중위치)
// ============================================================
// 대시보드 '입고 대기' 카드 → 입고대기 패널 열기(이미 열려 있으면 닫지 않고 목록만 새로)
window.__dashOpenIncoming = function () {
    const sb = document.getElementById('incoming-sidebar');
    if (!sb) return;
    const fs = document.getElementById('filter-source');   // 카드 숫자는 전체 기준 — 출처 필터를 풀어 같은 목록을 보인다
    if (fs && fs.value !== 'all') fs.value = 'all';
    if (sb.classList.contains('open')) { if (typeof window.renderIncomingQueue === 'function') window.renderIncomingQueue(); return; }
    if (typeof window.toggleIncomingSidebar === 'function') window.toggleIncomingSidebar();
};

window.__dashShowLocList = function (type) {
    const modal = document.getElementById('dash-loc-modal');
    const titleEl = document.getElementById('dash-loc-title');
    const metaEl = document.getElementById('dash-loc-meta');
    const thead = document.getElementById('dash-loc-thead');
    const tbody = document.getElementById('dash-loc-tbody');
    if (!modal || !tbody || !thead) return;
    modal.dataset.type = type; // '비축포함보기' 토글이 열린 다중위치 리스트를 다시 그릴 때 본다

    const locs3F = originalData.filter(d => (d.id || '').charAt(0).toUpperCase() !== 'K');
    // 빈 자리(랙 사용률) 리스트는 '기타'(비축/샘플 등) 위치를 제외한 실제 피킹 랙 기준
    const locsUsage = locs3F.filter(d => (d.category || '피킹용') !== '기타');
    const isUsed = (loc) =>
        (loc.code && String(loc.code).trim() !== '' && loc.code !== loc.id) ||
        (loc.name && String(loc.name).trim() !== '');
    const setTitle = (t) => { if (titleEl) titleEl.querySelector('span').textContent = t; };
    const th = (cols) => `<tr>${cols.map(c => `<th style="border-top:none; font-size:12px;${c.w ? `width:${c.w};` : ''}">${c.t}</th>`).join('')}</tr>`;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    if (type === 'empty') {
        const rows = locsUsage.filter(l => !isUsed(l)).sort((a, b) => (a.id || '').localeCompare(b.id || ''));
        setTitle(`빈 자리 리스트 (${rows.length}칸)`);
        if (metaEl) metaEl.textContent = '현재 비어 있는 3층 로케이션 — 입고/이동 배치에 사용 가능';
        thead.innerHTML = th([{ t: '로케이션', w: '130px' }, { t: '구역', w: '80px' }, { t: '동', w: '80px' }, { t: '위치' }]);
        tbody.innerHTML = rows.length ? rows.map(l => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${l.id}</td>
            <td>${(l.id || '').charAt(0).toUpperCase() || '-'}</td>
            <td>${String(l.dong || '').trim() || '-'}</td>
            <td>${String(l.pos || '').trim() || '-'}</td></tr>`).join('')
            : `<tr><td colspan="4" style="padding:30px; text-align:center; color:var(--c-text-3);">빈 자리가 없습니다.</td></tr>`;
    } else if (type === 'preassigned') {
        const rows = locs3F.filter(l => l.codeTag === '선지정' || l.codeTag === '당일지정')
            .sort((a, b) => (a.codeTag || '').localeCompare(b.codeTag || '') || (a.id || '').localeCompare(b.id || ''));
        setTitle(`선지정 / 당일지정 리스트 (${rows.length}건)`);
        if (metaEl) metaEl.textContent = '선지정(미입고 찜) · 당일지정(오늘 작업) 상태인 로케이션';
        thead.innerHTML = th([{ t: '로케이션', w: '130px' }, { t: '구분', w: '90px' }, { t: '상품코드', w: '120px' }, { t: '상품명' }, { t: '동', w: '70px' }]);
        const tagBadge = (tag) => tag === '선지정'
            ? '<span class="badge badge-risk">선지정</span>'
            : '<span class="badge badge-accent">당일지정</span>';
        tbody.innerHTML = rows.length ? rows.map(l => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${l.id}</td>
            <td>${tagBadge(l.codeTag)}</td>
            <td style="font-family:monospace; font-size:11px;">${l.preAssignedCode || l.code || '-'}</td>
            <td style="text-align:left; padding-left:8px;">${l.name || '-'}</td>
            <td>${String(l.dong || '').trim() || '-'}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:30px; text-align:center; color:var(--c-text-3);">선지정/당일지정 항목이 없습니다.</td></tr>`;
    } else if (type === 'multiloc') {
        const codeMap = new Map();
        locs3F.forEach(l => {
            if (!isUsed(l) || !l.code) return;
            const c = String(l.code).trim();
            if (!codeMap.has(c)) codeMap.set(c, []);
            codeMap.get(c).push(l);
        });
        // 대시보드 카드와 같은 기준·정렬 — 기본은 비축 자리를 뺀 개수·위치·재고('비축포함보기' 켜면 포함)
        const rows = multiLocGroups(codeMap, isEtcLocation, multiLocIncludeReserve, new Map(originalData.map(l => [normLocId(l.id), l])))
            .map(g => ({ ...g, locs: g.locIds.join(', ') }));
        setTitle(`다중 위치 상품 (${rows.length}종)`);
        if (metaEl) metaEl.innerHTML = `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">`
            + `<span>한 상품코드가 2곳 이상에 분산된 상품 — 통합 시 빈 슬롯 확보 가능 (${multiLocIncludeReserve ? '비축 자리 포함' : '비축 자리 제외 — 포함하려면 오른쪽 체크'})</span>`
            + multiLocReserveToggle('dash-loc-multiloc-include-reserve') + `</div>`;
        thead.innerHTML = th([{ t: '상품코드', w: '120px' }, { t: '상품명' }, { t: '분산 위치' }, { t: '칸수', w: '70px' }, { t: '정상재고', w: '90px' }]);
        tbody.innerHTML = rows.length ? rows.map(r => `<tr>
            <td style="font-family:monospace; font-size:11px; font-weight:600; color:var(--c-accent-deep);">${esc(r.code)}</td>
            <td style="text-align:left; padding-left:8px;">${esc(r.name) || '-'}</td>
            <td style="font-family:monospace; font-size:11px;">${esc(r.locs)}${r.reserveCount ? ` <span style="color:var(--c-warn-text); font-size:10px;">+비축 ${r.reserveCount}곳</span>` : ''}</td>
            <td style="font-weight:bold;">${r.count}곳</td>
            <td>${r.stock.toLocaleString()}</td></tr>`).join('')
            : `<tr><td colspan="5" style="padding:30px; text-align:center; color:var(--c-text-3);">다중 위치 상품이 없습니다.</td></tr>`;
    } else if (type === 'duploc') {
        const dups = window.__dupLocations || [];
        setTitle(`한 로케이션 2+ 상품 (${dups.length}건)`);
        if (metaEl) metaEl.textContent = '최근 데이터 최신화 시 같은 로케이션에 서로 다른 상품코드가 들어온 경우 — 저장 시 마지막 행만 남으므로 원본 엑셀을 확인하세요.';
        thead.innerHTML = th([{ t: '로케이션', w: '160px' }, { t: '지정된 상품코드들' }, { t: '개수', w: '70px' }]);
        tbody.innerHTML = dups.length ? dups.map(d => `<tr>
            <td style="font-family:monospace; font-weight:bold;">${esc(d.loc)}</td>
            <td style="text-align:left; padding-left:8px; font-family:monospace; font-size:11px;">${esc((d.codes || []).join(', '))}</td>
            <td style="font-weight:600; color:var(--c-risk-text);">${(d.codes || []).length}</td></tr>`).join('')
            : `<tr><td colspan="3" style="padding:30px; text-align:center; color:var(--c-text-3);">중복 지정된 로케이션이 없습니다.</td></tr>`;
    } else {
        return;
    }

    modal.style.display = 'flex';
};

// '비축 위치도 표시' 체크박스 → 같은 조건으로 목록만 다시 그린다
window.__dashRerenderBucketList = function () {
    const last = __dashLastBucketList;
    if (!last || !last.bucket) return;
    window.__dashShowBucketList(last.bucket, last.zoneFilter, last.dongFilter);
};

// 엑셀 다운로드 (XLSX는 페이지에 이미 로드됨)
window.__dashDownloadBucketExcel = function () {
    if (!__dashLastBucketList || !__dashLastBucketList.items || __dashLastBucketList.items.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
    }
    const { bucket, zoneFilter, dongFilter, items } = __dashLastBucketList;
    const sheetData = items.map(it => ({
        '상품코드': it.code,
        '상품명': it.name,
        '옵션': it.option,
        '현재위치': (it.pickLocs || []).join(', '),
        '비축랙위치': (it.etcLocs || []).join(', '),
        '정상재고': it.stockPick,
        '비축창고재고': it.stock2f,
        '마지막출고.배송일': it.lastDelivery || '',
        '직진활동': it.hasRecentActivity ? 'O' : ''
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    const scope = (zoneFilter || 'ALL') + '_' + (dongFilter || 'ALL');
    const sheetName = `${bucket}_${scope}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fname = `데드스톡_${bucket}_${scope}_${toDateStr()}.xlsx`;
    XLSX.writeFile(wb, fname);
};

// ── 보던 탭 복원 (UI 1단계 1c) ── 주소 뒤 #tab=locdash|list|map. 탭 버튼을 누르는 길로 연다
// (switchView 는 이제 markLocTab 으로 표시하므로 직접 불러도 되지만, 인라인 onclick 과 같은 길을 쓰려고 버튼 클릭으로 연다). 탭을 바꾸면 해시도 고친다.
const LOC_TABS = ['locdash', 'list', 'map'];
// 해시 이동(뒤로가기·Ctrl+K)에서 tab 이 없으면 첫 탭(대시보드) — 처음 열 때는 화면 기본값 그대로
const openLocTabFromHash = (h, fallback = '') => {
    const t = (h && h.tab) || fallback;
    if (!LOC_TABS.includes(t)) return;
    const btn = document.getElementById('tab-btn-' + t);
    if (btn && !btn.classList.contains('is-on')) btn.click();
};
// 탭 세그먼트(js/page-nav.js) — 방향키 이동만 더한다. 클릭은 버튼의 switchView(인라인), 켜짐은 markLocTab.
initPageNav(document.getElementById('loc-tab-nav'));
openLocTabFromHash(readHash());
onHashNav((h) => openLocTabFromHash(h, 'locdash'));
