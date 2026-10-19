// === calculator/shared-settings.js ===
// 통합계산기 공용 설정 (사용자 결정 2026-10-16) — 설정 관리의 모든 칸을 팀이 같이 쓴다. 통관비 기본값 3개는 제외(logis 평균 자동값).
//   문서: artifacts/team-work-logger-v2/persistent_data/calculatorSettings (규칙: 등록 직원 읽기·쓰기 — 규칙 변경 없음)
//   모양·저장 규칙: ../js/lib/calc-settings.js
//
// 읽기: 로그인하면 한 번 읽어 window.__calcShared 에 두고 'calc-shared-settings' 이벤트로 알린다.
//   { status: 'loading' | 'ok' | 'empty' | 'signed-out' | 'error', settings, meta, history, error }
//   'empty' = 공용 문서가 아직 없다(처음 저장하는 사람의 PC 설정으로 시작된다).
//   로그아웃·실패면 SettingsContext.js 가 localStorage 의 마지막 값을 그대로 쓴다.
// 저장: window.__calcSharedSave(base, local, { confirmedInitial }) → Promise
//   { mode: 'shared', applied: [{key,label}], conflicts: [{key,label,remote,mine}], initial, settings }
//   처음 이전(공용 문서 없음)은 확인 전엔 쓰지 않고 돌려준다(바뀐 칸이 없어도 같음)
//     확인 전: { needInitialConfirm: true, applied, settings: null } → 확인받고 confirmedInitial: true 로 다시 부른다
//   { mode: 'local', reason }   (로그인 안 됨 — 이 PC 에만)
//   실패하면 예외(공용에는 아무것도 안 씀).
//   runTransaction 으로 읽고-비교-쓰기: 그사이 다른 사람이 바꾼 칸은 덮지 않고 conflicts 로 돌려준다.
// 이름: mainConfig.memberEmails(이름 → 이메일) 역매핑 → systemAccounts → '알 수 없음'. 이메일은 이력에 넣지 않는다.
import { db, auth } from './firebase-init.js?v=202610191524';
import { doc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    planSave, historyEntries, appendHistory, updateMeta, nameForEmail, labelOf, formatValue
} from '../js/lib/calc-settings.js?v=202610191524';

const DOC_PATH = 'artifacts/team-work-logger-v2/persistent_data/calculatorSettings';
const CONFIG_PATH = 'artifacts/team-work-logger-v2/config/mainConfig';

const publish = (state) => {
    window.__calcShared = state;
    try { window.dispatchEvent(new CustomEvent('calc-shared-settings', { detail: state })); } catch (e) { /* 무시 */ }
};

publish({ status: 'loading', settings: null, meta: null, history: [], error: null });

let seq = 0;
const nameCache = { uid: null, name: null };

const errText = (e) => (e && e.code === 'permission-denied') ? '권한 없음(등록된 직원 계정인지 확인)' : '네트워크·서버 오류';

async function load(user) {
    const my = ++seq;
    if (!db || !auth) { publish({ status: 'error', settings: null, meta: null, history: [], error: 'Firebase 초기화 실패' }); return; }
    if (!user) { publish({ status: 'signed-out', settings: null, meta: null, history: [], error: null }); return; }
    try {
        const snap = await getDoc(doc(db, DOC_PATH));
        if (my !== seq) return;
        const d = snap.exists() ? (snap.data() || {}) : null;
        if (!d || !d.settings || typeof d.settings !== 'object') {
            publish({ status: 'empty', settings: null, meta: null, history: (d && Array.isArray(d.history)) ? d.history : [], error: null });
            return;
        }
        publish({ status: 'ok', settings: d.settings, meta: d.meta || {}, history: Array.isArray(d.history) ? d.history : [], error: null });
    } catch (e) {
        if (my !== seq) return;
        console.warn('공용 계산기 설정 읽기 실패:', e && e.code ? e.code : e);
        publish({ status: 'error', settings: null, meta: null, history: [], error: errText(e) });
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
    const by = await myName(user);
    const ref = doc(db, DOC_PATH);
    let out = null;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);                       // 재시도마다 새로 읽는다
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
        tx.set(ref, { settings: plan.next, meta, history, rev: (Number(d.rev) || 0) + 1, updatedAt: at, updatedBy: by });
        out = { mode: 'shared', applied: plan.applied.map(k => ({ key: k, label: labelOf(k) })), conflicts,
                initial: plan.initial, settings: plan.next, meta, history };
    });
    // 커밋된 결과를 게시할 때 순번을 올린다 — 그 전에 시작해 아직 안 끝난 새로고침(load)은 커밋 전 값일 수 있어 버린다(load 는 my !== seq 면 버림).
    // 저장이 실패하거나 게시할 것이 없으면 순번을 건드리지 않아 진행 중인 load 가 정상으로 끝난다.
    if (out.settings) { ++seq; publish({ status: 'ok', settings: out.settings, meta: out.meta, history: out.history, error: null }); }
    return out;
}

window.__calcSharedSave = save;
window.__reloadCalcShared = () => load(auth ? auth.currentUser : null);

if (auth) onAuthStateChanged(auth, (user) => { nameCache.uid = null; load(user); });
else load(null);
