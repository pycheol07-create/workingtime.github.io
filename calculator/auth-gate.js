// === calculator/auth-gate.js ===
// 🔒 통합계산기 로그인 게이트 (2026-10-22) — 로그인한 등록 사용자만 계산기를 쓴다.
//   팀원이 아닌 외부 인원(설정·관리의 '시스템 계정' + calculator.view 만 있는 역할)도 대시보드를 거치지 않고
//   이 화면에서 바로 로그인한다. 모양·문구는 js/china-stock-gate.js 와 같은 틀(상단바 자리는 비운다).
//
// 동작
//   1. 곧바로 '확인 중' 가림막. 로그아웃이면 로그인 칸(이메일·비밀번호 — 표준 signInWithEmailAndPassword).
//   2. 로그인 → mainConfig 1회 읽기 → js/lib/calc-member.js 로 등록 확인(대시보드 app.js 와 같은 기준 + memberRoles).
//      명단 밖·퇴사자(규칙상 mainConfig 읽기 거부 포함)는 '앱에 등록된 사용자가 아닙니다' + [로그아웃].
//      네트워크 등으로 못 읽으면 '확인하지 못했습니다' + [다시 시도]·[로그아웃].
//   3. 통과하면 가림막을 걷고 window.__calcAuth = { status:'ok' } + 'calc-auth' 이벤트 — app.js 가 그때 React 를 그린다
//      (그 전에는 그리지 않으므로 localStorage 의 설정·입력 기억값이 화면에 나오지 않는다). 로그아웃되면 app.js 가 내린다.
//   4. 기능 권한(calculator.view)은 js/page-gate.js 가 따로 본다(warn 띠 / block 가림막). 이 가림막이 그 위(z-index)에 있다.
//   상태: 'checking' | 'signed-out' | 'denied' | 'error' | 'ok'
// 로그아웃: window.__calcSignOut() — 계산기 머리의 [로그아웃]·이 가림막의 [로그아웃]이 부른다(공통 상단바에는 로그아웃이 없다).
// 비밀번호 재설정은 두지 않는다(관리자에게 문의).
// ⚠️ 화면 가림만 한다. 데이터는 firestore.rules 가 지킨다. 이름·이메일은 화면·로그에 남기지 않는다.
// ⚠️ role="dialog"·data-act 를 쓰지 않는다(page-gate.js 와 같은 이유 — 봇이 그 선택자로 확인창을 찾는다).
import { db, auth } from './firebase-init.js?v=202610231013';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { calcMemberStatus } from '../js/lib/calc-member.js?v=202610231013';
import { clearShellMenuCache } from '../js/app-shell-bridge.js?v=202610231013';

const CONFIG_PATH = 'artifacts/team-work-logger-v2/config/mainConfig';
const OVERLAY_ID = 'calc-auth-gate';
const CHECK_TIMEOUT_MS = 15000;      // 등록 확인(mainConfig 읽기) 제한 시간

// china-stock-gate.js 와 같은 틀 — 바깥은 스크롤 상자, 안쪽은 margin:auto 가운데 정렬(휴대폰 키보드가 올라와도 버튼이 보이게).
// 위쪽은 공통 상단바(--as-h) 자리를 비운다. z-index 는 page-gate.js 가림막·띠(2147483590)보다 위.
// 색은 calc-d.css 토큰(body#calc-root 아래라 다크모드를 따라간다).
const BASE_STYLE = `position:fixed; inset:var(--as-h,0px) 0 0 0; z-index:2147483600; background:var(--c-bg,#F5F6F8);
    display:flex; overflow-y:auto; -webkit-overflow-scrolling:touch;
    font-family:var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); color:var(--c-text,#23272E); text-align:center;`;
const INNER_STYLE = `margin:auto; display:flex; flex-direction:column; align-items:center; gap:10px; padding:24px; width:100%;`;
const NOTE_STYLE = `font-size:12.5px; color:var(--c-text-2,#646B75); line-height:1.7; max-width:320px;`;
const INPUT_STYLE = `padding:11px 12px; border:1px solid var(--c-line-strong,#D6DAE0); border-radius:10px; font-size:15px;
    font-family:inherit; background:var(--c-surface,#FFFFFF); color:var(--c-text,#23272E);`;
const BTN_STYLE = `padding:12px; border:0; border-radius:999px; background:var(--c-accent-strong,#2F62C9); color:#fff;
    font-size:15px; font-weight:600; font-family:inherit; cursor:pointer;`;
const BTN2_STYLE = `padding:9px 18px; border:1px solid var(--c-line-strong,#D6DAE0); border-radius:999px; background:var(--c-surface,#FFFFFF);
    color:var(--c-text,#23272E); font-size:14px; font-weight:600; font-family:inherit; cursor:pointer;`;

const publish = (status) => {
    window.__calcAuth = { status };
    try { window.dispatchEvent(new CustomEvent('calc-auth', { detail: window.__calcAuth })); } catch (e) { /* 무시 */ }
};

const removeGate = () => {
    document.getElementById(OVERLAY_ID)?.remove();
    document.documentElement.style.overflow = '';
};

const showGate = (html) => {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = OVERLAY_ID;
        el.style.cssText = BASE_STYLE;
        document.body.appendChild(el);
    }
    el.innerHTML = `<div style="${INNER_STYLE}">${html}</div>`;
    document.documentElement.style.overflow = 'hidden';
    return el;
};

const showChecking = () => showGate(`<div style="font-size:16px; font-weight:600;">로그인 상태를 확인하는 중…</div>`);

const doSignOut = async () => {
    clearShellMenuCache();                 // 다음 사람에게 앞 사람 메뉴가 남지 않게(대시보드 로그아웃과 같게)
    try { if (auth) await signOut(auth); }
    catch (e) { console.warn('[계산기] 로그아웃 실패:', (e && e.code) || 'unknown'); }
};
window.__calcSignOut = doSignOut;

const loginErrText = (code) => {
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
        || code === 'auth/invalid-email' || code === 'auth/missing-password') return '이메일 또는 비밀번호가 잘못되었습니다.';
    if (code === 'auth/too-many-requests') return '로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도하세요.';
    if (code === 'auth/user-disabled') return '사용이 중지된 계정입니다 — 관리자에게 문의하세요.';
    if (code === 'auth/network-request-failed') return '인터넷 연결을 확인한 뒤 다시 시도하세요.';
    return `로그인 오류: ${code || '알 수 없음'}`;
};

/** 로그인 칸 */
const showLogin = () => {
    const el = showGate(`
        <div style="font-size:17px; font-weight:600;">로그인이 필요합니다</div>
        <div style="${NOTE_STYLE}">
            통합계산기는 로그인한 사용자만 쓸 수 있습니다.<br>업무관리와 같은 계정입니다 — 계정이 없거나 비밀번호를 잊었으면 관리자에게 문의하세요.
        </div>
        <form id="calc-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="calc-login-email" type="email" inputmode="email" autocomplete="username" placeholder="이메일" required style="${INPUT_STYLE}">
            <input id="calc-login-pw" type="password" autocomplete="current-password" placeholder="비밀번호" required style="${INPUT_STYLE}">
            <button type="submit" id="calc-login-btn" style="${BTN_STYLE}">로그인</button>
            <div id="calc-login-err" role="alert" style="font-size:12px; color:var(--c-risk-text,#A0525C); min-height:16px;"></div>
        </form>`);
    const form = el.querySelector('#calc-login-form');
    const err = el.querySelector('#calc-login-err');
    const btn = el.querySelector('#calc-login-btn');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.textContent = '로그인 중…'; err.textContent = '';
        try {
            await signInWithEmailAndPassword(auth,
                el.querySelector('#calc-login-email').value.trim(),
                el.querySelector('#calc-login-pw').value);
            // 성공하면 onAuthStateChanged 가 등록 확인으로 넘어간다
        } catch (e2) {
            err.textContent = loginErrText(e2 && e2.code ? e2.code : '');
            btn.disabled = false; btn.textContent = '로그인';
        }
    });
};

/** 막힘(명단 밖·퇴사)·확인 실패 — 둘 다 [로그아웃]. 실패는 [다시 시도]도. */
const showStop = (title, note, retry) => {
    const el = showGate(`
        <div style="font-size:17px; font-weight:700;">${title}</div>
        <div style="${NOTE_STYLE}">${note}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-top:4px;">
            ${retry ? `<button type="button" data-calc-gate-retry style="${BTN2_STYLE}">다시 시도</button>` : ''}
            <button type="button" data-calc-gate-logout style="${BTN2_STYLE}">로그아웃</button>
        </div>`);
    el.querySelector('[data-calc-gate-logout]').addEventListener('click', doSignOut);
    if (retry) el.querySelector('[data-calc-gate-retry]').addEventListener('click', retry);
};

let seq = 0;   // 로그인 상태가 빨리 바뀔 때 늦게 끝난 옛 확인이 화면을 덮지 않게

async function check(user) {
    const my = ++seq;
    if (!user) {
        publish('signed-out');
        showLogin();
        return;
    }
    publish('checking');
    showChecking();
    let cfg = null, failed = false;
    try {
        // 오프라인 등으로 응답이 안 오면 getDoc 이 오래 매달린다 — 15초 넘으면 '확인 실패'([다시 시도])
        let timer = null;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject({ code: 'timeout' }), CHECK_TIMEOUT_MS); });
        const snap = await Promise.race([getDoc(doc(db, CONFIG_PATH)), timeout]).finally(() => clearTimeout(timer));
        cfg = snap.exists() ? (snap.data() || {}) : null;
    } catch (e) {
        // 명단 밖·퇴사자는 규칙상 mainConfig 를 못 읽는다 → '등록 안 됨'. 그 밖(네트워크 등)은 '확인 실패'.
        if (!(e && e.code === 'permission-denied')) failed = true;
        console.warn('[계산기] 등록 확인 실패:', (e && e.code) || 'unknown');
    }
    if (my !== seq) return;
    if (failed) {
        publish('error');
        showStop('로그인 정보를 확인하지 못했습니다', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.', () => check(auth.currentUser));
        return;
    }
    const st = calcMemberStatus(cfg, user.email);
    if (st !== 'ok') {
        publish('denied');
        showStop(st === 'resigned' ? '퇴사 처리된 계정입니다' : '앱에 등록된 사용자가 아닙니다',
            '관리자에게 문의하세요.', null);
        return;
    }
    publish('ok');
    removeGate();
}

publish('checking');
showChecking();

if (db && auth) {
    onAuthStateChanged(auth, (user) => { check(user); });
} else {
    // Firebase 를 띄우지 못했다 — 확인할 방법이 없으므로 계산기를 열지 않는다(새로고침으로 다시).
    publish('error');
    showStop('로그인 정보를 확인하지 못했습니다', '페이지를 새로고침해 주세요.', () => location.reload());
}
