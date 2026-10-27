// === calculator/shared-settings.js ===
// 통합계산기 공용 설정 (사용자 결정 2026-10-16) — 설정 관리의 모든 칸을 팀이 같이 쓴다. 통관비 기본값 3개는 제외(logis 평균 자동값).
//   문서: artifacts/team-work-logger-v2/persistent_data/calculatorSettings
//     (규칙: 읽기 = 등록 직원 · 쓰기 = 계산기 권한 hasFeature('calculator.view') — 2026-10-23 변경, 아직 게시 안 함)
//   공개 사본: artifacts/team-work-logger-v2/calcPublic/settings = { settings, rev, updatedAt } (2026-10-23 외부 열람)
//     명단 밖 로그인 사용자(guest)는 원본을 못 읽는다(이력·칸별 변경자에 직원 이름이 있다) → 이 사본을 읽어 보기 전용으로 쓴다.
//     쓰기는 직원만(규칙: 키 3개만, rev 는 줄지 않게). 직원 저장 트랜잭션이 원본과 같이 쓰고,
//     직원이 화면을 열 때 사본이 없거나 rev 가 원본보다 작으면 맞춘다(실패는 조용히 — console.warn 에 코드만).
//     사본 rev 가 원본보다 크면(콘솔에서 사본을 고쳤거나 원본을 되돌림) 사본을 맞추지 못한다 — console.warn 에 두 숫자를 남긴다.
//       조치: 관리자가 Firebase 콘솔에서 calcPublic/settings 문서를 지우면 다음에 직원이 계산기를 열 때 다시 만들어진다.
//   모양·저장 규칙: ../js/lib/calc-settings.js
//
// 읽기: 로그인하면 한 번 읽어 window.__calcShared 에 두고 'calc-shared-settings' 이벤트로 알린다.
//   { status: 'loading' | 'ok' | 'empty' | 'signed-out' | 'error', settings, meta, history, error, readOnly }
//   'empty' = 공용 문서가 아직 없다(처음 저장하는 사람의 PC 설정으로 시작된다).
//   readOnly: true = guest(원본 읽기 거부 → 공개 사본). meta·history 는 비어 있다. 사본이 없으면 'empty'.
//   readOnlyReason: 'guest' | 'perm' | null — 'perm' = 계산기 권한(calculator.view)이 없는 직원(auth-gate.js role 'member-readonly').
//     원본은 읽고(이력 포함) 저장만 막는다. 서버 규칙도 calculatorSettings·calcPublic 쓰기를 hasFeature('calculator.view') 로 막는다.
//   로그아웃·실패면 SettingsContext.js 가 localStorage 의 마지막 값을 그대로 쓴다.
// 저장: window.__calcSharedSave(base, local, { confirmedInitial }) → Promise
//   { mode: 'shared', applied: [{key,label}], conflicts: [{key,label,remote,mine}], initial, settings }
//   처음 이전(공용 문서 없음)은 확인 전엔 쓰지 않고 돌려준다(바뀐 칸이 없어도 같음)
//     확인 전: { needInitialConfirm: true, applied, settings: null } → 확인받고 confirmedInitial: true 로 다시 부른다
//   { mode: 'local', reason }   (로그인 안 됨 — 이 PC 에만)
//   { mode: 'readonly' }        (guest — 쓰기를 시도하지 않는다. 설정 화면이 저장 버튼을 막아 두므로 보통 오지 않는다)
//   실패하면 예외(공용에는 아무것도 안 씀).
//   runTransaction 으로 읽고-비교-쓰기: 그사이 다른 사람이 바꾼 칸은 덮지 않고 conflicts 로 돌려준다.
//   같은 트랜잭션에서 공개 사본도 쓴다(읽기 둘을 먼저 하고 그다음 쓰기 — Firestore 트랜잭션 규칙).
//   rev = 원본 문서의 rev(저장마다 +1, 이 파일이 처음부터 써 온 칸). 사본 rev 는 원본 rev 와 같게 둔다.
// 이름: mainConfig.memberEmails(이름 → 이메일) 역매핑 → systemAccounts → '알 수 없음'. 이메일은 이력에 넣지 않는다.
import { db, auth } from './firebase-init.js?v=202610271157';
import { doc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    planSave, historyEntries, appendHistory, updateMeta, nameForEmail, labelOf, formatValue, publicMirror
} from '../js/lib/calc-settings.js?v=202610271157';

const DOC_PATH = 'artifacts/team-work-logger-v2/persistent_data/calculatorSettings';
const CONFIG_PATH = 'artifacts/team-work-logger-v2/config/mainConfig';
const PUBLIC_PATH = 'artifacts/team-work-logger-v2/calcPublic/settings';

// 보기 전용 이유를 붙인다 — guest(readOnly 로 온 상태) / perm(권한 없는 직원). 맨 처음 publish 전에도 쓰이므로 function 선언(호이스팅).
function withReadOnly(state) {
    if (state.readOnly) return { ...state, readOnlyReason: 'guest' };
    const permRo = !!(window.__calcAuth && window.__calcAuth.role === 'member-readonly') && state.status !== 'signed-out';
    return { ...state, readOnly: permRo, readOnlyReason: permRo ? 'perm' : null };
}

const publish = (raw) => {
    const state = withReadOnly(raw);
    window.__calcShared = state;
    try { window.dispatchEvent(new CustomEvent('calc-shared-settings', { detail: state })); } catch (e) { /* 무시 */ }
};

publish({ status: 'loading', settings: null, meta: null, history: [], error: null, readOnly: false });

let seq = 0;
const nameCache = { uid: null, name: null };
let guestMode = false;      // 마지막 읽기에서 원본이 거부됐나(guest) — 로그인이 바뀌면 다시 정한다

// 로그인 게이트(auth-gate.js)가 guest 로 통과시켰거나, 원본 읽기가 거부됐으면 guest
const isGuest = () => guestMode || !!(window.__calcAuth && window.__calcAuth.role === 'guest');
const isPermReadOnly = () => !!(window.__calcAuth && window.__calcAuth.role === 'member-readonly');

// 로그인 게이트의 판정(role)이 이 모듈의 읽기보다 늦게 올 수 있다 — 보기 전용 이유가 바뀌면 지금 상태를 다시 알린다
window.addEventListener('calc-auth', () => {
    const cur = window.__calcShared;
    if (!cur) return;
    const next = withReadOnly({ ...cur, readOnly: cur.readOnlyReason === 'guest' });
    if (next.readOnlyReason !== cur.readOnlyReason) publish({ ...cur, readOnly: cur.readOnlyReason === 'guest' });
});

const errText = (e) => (e && e.code === 'permission-denied') ? '권한 없음(계정 확인)' : '네트워크·서버 오류';

// 공개 사본 맞추기(직원이 화면을 열 때) — 사본이 없거나 rev 가 원본보다 작을 때만 쓴다. 실패는 조용히.
async function syncMirror() {
    try {
        await runTransaction(db, async (tx) => {
            const src = await tx.get(doc(db, DOC_PATH));
            const pub = await tx.get(doc(db, PUBLIC_PATH));
            const d = src.exists() ? (src.data() || {}) : null;
            if (!d || !d.settings || typeof d.settings !== 'object') return;
            const rev = Number(d.rev) || 0;
            const pubRev = pub.exists() ? (Number((pub.data() || {}).rev) || 0) : -1;
            if (pubRev > rev) console.warn('공용 설정 공개 사본 rev 가 원본보다 큼:', pubRev, '>', rev);
            if (pubRev >= rev) return;
            tx.set(doc(db, PUBLIC_PATH), publicMirror(d.settings, rev, d.updatedAt));
        });
    } catch (e) {
        console.warn('공용 설정 공개 사본 맞추기 실패:', (e && e.code) || 'unknown');
    }
}

// guest — 공개 사본을 읽어 보기 전용으로 게시
async function loadPublic(my) {
    try {
        const snap = await getDoc(doc(db, PUBLIC_PATH));
        if (my !== seq) return;
        const d = snap.exists() ? (snap.data() || {}) : null;
        if (!d || !d.settings || typeof d.settings !== 'object') {
            publish({ status: 'empty', settings: null, meta: {}, history: [], error: null, readOnly: true });
            return;
        }
        publish({ status: 'ok', settings: d.settings, meta: {}, history: [], error: null, readOnly: true });
    } catch (e) {
        if (my !== seq) return;
        console.warn('공용 계산기 설정(공개 사본) 읽기 실패:', e && e.code ? e.code : e);
        publish({ status: 'error', settings: null, meta: null, history: [], error: errText(e), readOnly: true });
    }
}

async function load(user) {
    const my = ++seq;
    if (!db || !auth) { publish({ status: 'error', settings: null, meta: null, history: [], error: 'Firebase 초기화 실패', readOnly: false }); return; }
    if (!user) { guestMode = false; publish({ status: 'signed-out', settings: null, meta: null, history: [], error: null, readOnly: false }); return; }
    try {
        const snap = await getDoc(doc(db, DOC_PATH));
        if (my !== seq) return;
        guestMode = false;
        const d = snap.exists() ? (snap.data() || {}) : null;
        if (!d || !d.settings || typeof d.settings !== 'object') {
            publish({ status: 'empty', settings: null, meta: null, history: (d && Array.isArray(d.history)) ? d.history : [], error: null, readOnly: false });
            return;
        }
        publish({ status: 'ok', settings: d.settings, meta: d.meta || {}, history: Array.isArray(d.history) ? d.history : [], error: null, readOnly: false });
        if (!isPermReadOnly()) syncMirror();           // 기다리지 않는다(권한 없는 직원은 규칙상 못 쓴다 — 건너뜀)
    } catch (e) {
        if (my !== seq) return;
        if (e && e.code === 'permission-denied') {
            // 명단 밖(guest) — 원본 대신 공개 사본(이름 칸 없음)
            guestMode = true;
            await loadPublic(my);
            return;
        }
        console.warn('공용 계산기 설정 읽기 실패:', e && e.code ? e.code : e);
        publish({ status: 'error', settings: null, meta: null, history: [], error: errText(e), readOnly: false });
    }
}

async function myName(user) {
    if (nameCache.uid === user.uid && nameCache.name) return nameCache.name;
    let name = '알 수 없음';
    try {
        const snap = await getDoc(doc(db, CONFIG_PATH));
        if (snap.exists()) name = nameForEmail(snap.data(), user.email);
    } catch (e) { /* 이름을 못 구하면 '알 수 없음' */ }
    nameCache.uid = user.uid; nameCache.name = name;
    return name;
}

async function save(base, local, opts = {}) {
    const user = auth ? auth.currentUser : null;
    if (!db || !user) return { mode: 'local', reason: '로그인하지 않음' };
    if (isGuest() || isPermReadOnly()) return { mode: 'readonly' };   // guest·권한 없는 직원은 쓰기를 시도하지 않는다
    const by = await myName(user);
    const ref = doc(db, DOC_PATH);
    const pubRef = doc(db, PUBLIC_PATH);
    let out = null;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);                       // 재시도마다 새로 읽는다
        const pubSnap = await tx.get(pubRef);                 // 읽기는 쓰기보다 먼저(트랜잭션 규칙)
        const d = snap.exists() ? (snap.data() || {}) : {};
        const remote = (d.settings && typeof d.settings === 'object') ? d.settings : null;
        const plan = planSave({ remote, base, local });
        const conflicts = plan.conflicts.map(c => ({ ...c, label: labelOf(c.key), remoteText: formatValue(c.remote) }));
        // 처음 이전: 바뀐 칸이 없어도(이 PC 설정 그대로를 팀 기준으로) 만든다 — 단 확인(opts.confirmedInitial)을 받은 뒤에만 쓴다
        if (plan.initial && !opts.confirmedInitial) {
            out = { mode: 'shared', applied: plan.applied.map(k => ({ key: k, label: labelOf(k) })), conflicts: [],
                    initial: true, needInitialConfirm: true, settings: null };
            return;
        }
        if (!plan.initial && !plan.applied.length) {
            out = { mode: 'shared', applied: [], conflicts, initial: false, settings: remote, meta: d.meta || {}, history: d.history || [] };
            return;                                           // 쓸 것 없음
        }
        const at = new Date().toISOString();
        const before = remote || plan.next;                   // 처음 이전이면 '이전 값' 은 이 사람의 화면을 열 때 값
        const rows = historyEntries({ applied: plan.applied, before: plan.initial ? base : before, after: plan.next, at, by, initial: plan.initial });
        const history = appendHistory(d.history, rows);
        const meta = updateMeta(d.meta, plan.applied, at, by);
        const rev = (Number(d.rev) || 0) + 1;
        tx.set(ref, { settings: plan.next, meta, history, rev, updatedAt: at, updatedBy: by });
        // 공개 사본 — 사본 rev 가 이미 더 크면(이상한 상태) 규칙이 거부해 저장 전체가 실패하므로 건드리지 않는다
        const pubRev = pubSnap.exists() ? (Number((pubSnap.data() || {}).rev) || 0) : -1;
        if (pubRev <= rev) tx.set(pubRef, publicMirror(plan.next, rev, at));
        else console.warn('공용 설정 공개 사본 rev 가 원본보다 큼:', pubRev, '>', rev);
        out = { mode: 'shared', applied: plan.applied.map(k => ({ key: k, label: labelOf(k) })), conflicts,
                initial: plan.initial, settings: plan.next, meta, history };
    });
    // 커밋된 결과를 게시할 때 순번을 올린다 — 그 전에 시작해 아직 안 끝난 새로고침(load)은 커밋 전 값일 수 있어 버린다(load 는 my !== seq 면 버림).
    // 저장이 실패하거나 게시할 것이 없으면 순번을 건드리지 않아 진행 중인 load 가 정상으로 끝난다.
    if (out.settings) { ++seq; publish({ status: 'ok', settings: out.settings, meta: out.meta, history: out.history, error: null, readOnly: false }); }
    return out;
}

window.__calcSharedSave = save;
window.__reloadCalcShared = () => load(auth ? auth.currentUser : null);

if (auth) onAuthStateChanged(auth, (user) => { nameCache.uid = null; guestMode = false; load(user); });
else load(null);
