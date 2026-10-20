// === calculator/logis-defaults.js ===
// 통관비 옵션 기본값(상품 단가·박스당 수량·박스당 무게) ← Firestore integrations/customsDefaults (2026-10-16).
//   값은 앱\통관비기본값\실행.py 가 logis 최근 90일 평균으로 15일마다 쓴다(클라이언트 쓰기는 규칙이 막는다).
//   로그인한 등록 직원만 읽을 수 있다 — 로그아웃·실패면 SettingsContext.js 가 localStorage 의 마지막 저장값을 쓴다.
//
// 결과는 window.__customsDefaults 에 두고 'customs-defaults' 이벤트로 알린다.
//   { status: 'loading' | 'ok' | 'signed-out' | 'error', values, meta, error }
//   values = { defaultUnitPrice, defaultQuantityPerBox, defaultWeightPerBox } (status 'ok' 일 때만)
//   meta   = { window{from,to,days}, packings, lastOkAt(ms), lastRunAt(ms), ok, error, logisCollectedAt(ms) }
// 다시 읽기: window.__reloadCustomsDefaults()
// SettingsContext.js(Babel)와 어느 쪽이 먼저 끝날지 모르므로 그쪽은 window 값 확인 + 이벤트 구독을 같이 한다.
//
// Firebase 초기화는 firebase-init.js 한 곳(공통 상단바 js/app-shell.js 는 Firebase 를 초기화하지 않고,
// 개인 알림 모듈도 계산기에서는 불러오지 않는다 — NOTI_OFF_PAGES). 로그인 상태는 여기서 상단바에 uid 만 넘긴다(메뉴는 캐시).
import { db, auth } from './firebase-init.js?v=202610201634';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { setShellContext } from '../js/app-shell-bridge.js?v=202610201634';

const DOC_PATH = 'artifacts/team-work-logger-v2/integrations/customsDefaults';

const publish = (state) => {
    window.__customsDefaults = state;
    try { window.dispatchEvent(new CustomEvent('customs-defaults', { detail: state })); } catch (e) { /* 무시 */ }
};

const tsMs = (v) => {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
};
const posNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;

publish({ status: 'loading', values: null, meta: null, error: null });

let seq = 0;    // 늦게 끝난 앞 요청이 뒤 결과를 덮지 않게

async function load(user) {
    const my = ++seq;
    if (!db || !auth) {
        publish({ status: 'error', values: null, meta: null, error: 'Firebase 초기화 실패' });
        return;
    }
    if (!user) {
        publish({ status: 'signed-out', values: null, meta: null, error: null });
        return;
    }
    publish({ status: 'loading', values: null, meta: (window.__customsDefaults || {}).meta || null, error: null });
    try {
        const snap = await getDoc(doc(db, DOC_PATH));
        if (my !== seq) return;
        if (!snap.exists()) {
            publish({ status: 'error', values: null, meta: null, error: '아직 계산된 값이 없습니다' });
            return;
        }
        const d = snap.data() || {};
        const values = {
            defaultUnitPrice: posNum(d.unitPriceUsd),
            defaultQuantityPerBox: posNum(d.qtyPerBox),
            defaultWeightPerBox: posNum(d.kgPerBox),
        };
        const meta = {
            window: d.window || null,
            packings: (d.sample && typeof d.sample.packings === 'number') ? d.sample.packings : null,
            lastOkAt: tsMs(d.lastOkAt),
            lastRunAt: tsMs(d.lastRunAt),
            logisCollectedAt: tsMs(d.logisCollectedAt),
            ok: d.ok !== false,
            error: d.error || null,
        };
        if (Object.values(values).some(v => v === null)) {
            publish({ status: 'error', values: null, meta, error: d.error || '저장된 값이 올바르지 않습니다' });
            return;
        }
        publish({ status: 'ok', values, meta, error: null });
    } catch (e) {
        if (my !== seq) return;
        console.warn('통관비 기본값 읽기 실패:', e && e.code ? e.code : e);
        const msg = (e && e.code === 'permission-denied') ? '읽기 권한 없음(등록된 직원 계정인지 확인)' : '읽기 실패 — 네트워크 확인';
        publish({ status: 'error', values: null, meta: null, error: msg });
    }
}

window.__reloadCustomsDefaults = () => load(auth ? auth.currentUser : null);

if (auth) {
    onAuthStateChanged(auth, (user) => {
        setShellContext(user ? { signedIn: true, uid: user.uid } : { signedIn: false });   // 공통 상단바(메뉴는 캐시)
        load(user);
    });
} else {
    load(null);
}
