// === calculator/auth-gate.js ===
// 🔒 통합계산기 로그인 게이트 (2026-10-22, 2026-10-23 외부 열람) — 로그인한 사람이면 계산기를 쓴다. 퇴사자는 막는다.
//   등록 직원이 아닌 외부 사용자(guest)도 이 화면에서 바로 로그인해 계산기를 쓴다(대시보드를 거치지 않는다).
//   모양·문구는 js/china-stock-gate.js 와 같은 틀(상단바 자리는 비운다).
//
// 동작
//   1. 곧바로 '확인 중' 가림막. 로그아웃이면 로그인 칸(이메일·비밀번호 — 표준 signInWithEmailAndPassword)
//      + [Google 계정으로 로그인](signInWithPopup — 팝업이 막히면 '팝업을 허용한 뒤 다시 누르세요'. redirect 로는 넘기지 않는다.
//        예전 방식으로 돌아온 경우를 위해 getRedirectResult 는 한 번 처리한다).
//      ⚠️ 업무관리(대시보드) 직원은 이메일 로그인을 쓴다 — 이메일 미인증 비밀번호 계정(gmail 등)에 구글로 로그인하면
//         Firebase 가 비밀번호 로그인을 떼어 낼 수 있다(버튼 옆 안내). 운영 시험 계정으로 확인 필요.
//      콘솔에서 가입을 꺼 두므로 처음 오는 구글 계정은 auth/admin-restricted-operation → '등록되지 않은 계정입니다'.
//      로그인한 뒤의 판정은 이메일·구글 구분 없이 같다(구글 토큰에도 email 이 있다).
//   2. 로그인 → mainConfig 1회 읽기 → js/lib/calc-member.js calcAccess 로 판정.
//      · 읽히면(직원) calcMemberStatus 기준: 퇴사 → 막음, 명단에 있음 → member, 이름 없음 → guest.
//      · permission-denied(명단 밖·퇴사자는 규칙상 못 읽는다)면 공개 사본 calcPublic/settings 를 읽어 본다
//        (규칙 isCalcUser — 퇴사자·이메일 없는 토큰은 거부). 허용이면(문서가 없어도) guest, 거부면 막음.
//      · 막힘: 퇴사 '퇴사 처리된 계정입니다' / 그 밖 '이 계정은 계산기를 쓸 수 없습니다' + [로그아웃].
//      · 네트워크 등으로 못 읽으면 '확인하지 못했습니다' + [다시 시도]·[로그아웃].
//   2-1. 직원(member)이면 이미 읽은 mainConfig 로 계산기 사용 권한(calculator.view)을 본다 — js/lib/calc-member.js calcPermDecision
//      (firestore.rules hasFeature 와 같은 식 — 관리자 또는 역할·개인 allow, deny 우선, 옛 메뉴 권한은 안 봄).
//      · 권한 없음 → 막지 않는다(사용자 결정: 계산은 누구나, 공용 설정 저장만 권한 받은 직원). permEnforce 와 상관없이
//        role 'member-readonly' — 공용 설정은 보기 전용(shared-settings.js), 직원 데이터 읽기는 그대로.
//   3. 통과하면 가림막을 걷고 window.__calcAuth = { status:'ok', role:'member'|'member-readonly'|'guest' } + 'calc-auth' 이벤트 — app.js 가 그때 React 를 그린다
//      (그 전에는 그리지 않으므로 localStorage 의 설정·입력 기억값이 화면에 나오지 않는다). 로그아웃되면 app.js 가 내린다.
//   4. 기능 권한(calculator.view) 가드(js/page-gate.js)는 2026-10-23 계산기에서 뺐다 — guest 는 권한 판정이 없어 늘 띠가 뜨기 때문.
//      팀 공용 설정 저장은 직원만(shared-settings.js — guest 는 보기 전용), 계산기 밖 데이터·모든 쓰기는 firestore.rules 가 직원만 허용한다.
//   상태: 'checking' | 'signed-out' | 'denied' | 'error' | 'ok'
// 로그아웃: window.__calcSignOut() — 계산기 머리의 [로그아웃]·이 가림막의 [로그아웃]이 부른다(공통 상단바에는 로그아웃이 없다).
//   입력 기억값(localStorage)은 로그아웃해도 지우지 않는다(같은 PC 에서 다시 로그인하면 이어서 쓴다).
// 비밀번호 재설정은 두지 않는다(관리자에게 문의).
// ⚠️ 화면 가림만 한다. 데이터는 firestore.rules 가 지킨다. 이름·이메일은 화면·로그에 남기지 않는다.
// ⚠️ role="dialog"·data-act 를 쓰지 않는다(page-gate.js 와 같은 이유 — 봇이 그 선택자로 확인창을 찾는다).
import { db, auth } from './firebase-init.js?v=202610291628';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut,
    GoogleAuthProvider, signInWithPopup, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { calcAccess, calcPermDecision } from '../js/lib/calc-member.js?v=202610291628';
import { clearShellMenuCache } from '../js/app-shell-bridge.js?v=202610291628';

const CONFIG_PATH = 'artifacts/team-work-logger-v2/config/mainConfig';
const PUBLIC_PATH = 'artifacts/team-work-logger-v2/calcPublic/settings';   // 공개 사본 — 명단 밖이면 이걸로 '퇴사자 아님' 을 확인
const OVERLAY_ID = 'calc-auth-gate';
const CHECK_TIMEOUT_MS = 15000;      // 확인 읽기(mainConfig · 공개 사본) 한 번의 제한 시간

// china-stock-gate.js 와 같은 틀 — 바깥은 스크롤 상자, 안쪽은 margin:auto 가운데 정렬(휴대폰 키보드가 올라와도 버튼이 보이게).
// 위쪽은 공통 상단바(--as-h) 자리를 비운다. z-index 는 다른 페이지의 page-gate.js 가림막·띠(2147483590)와 같은 기준으로 그보다 위.
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

const publish = (status, role) => {
    window.__calcAuth = role ? { status, role } : { status };
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
    // 구글 로그인(2026-10-23)
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';   // 사용자가 닫음 — 표시 없음
    if (code === 'auth/admin-restricted-operation') return '등록되지 않은 계정입니다 — 관리자에게 계정 생성을 요청하세요.';
    if (code === 'auth/unauthorized-domain') return '이 주소에서는 구글 로그인이 설정되지 않았습니다 — 관리자에게 문의하세요.';
    if (code === 'auth/account-exists-with-different-credential') return '같은 이메일로 이메일/비밀번호 계정이 있습니다 — 이메일로 로그인하세요.';
    if (code === 'auth/operation-not-allowed') return '구글 로그인이 꺼져 있습니다 — 관리자에게 문의하세요.';
    if (code === 'auth/popup-blocked') return '팝업이 막혔습니다 — 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 누르세요.';
    if (code === 'auth/operation-not-supported-in-this-environment')
        return '이 화면(앱 안 브라우저 등)에서는 구글 팝업을 열 수 없습니다 — 크롬 등 일반 브라우저에서 팝업을 허용한 뒤 다시 누르세요.';
    return `로그인 오류: ${code || '알 수 없음'}`;
};

// 구글 로그인 리디렉트에서 돌아왔을 때의 오류 — 로그인 칸이 아직 없으면 들고 있다가 띄운다
let pendingLoginErr = '';
const showLoginErr = (code) => {
    const text = loginErrText(code || '');
    const err = document.getElementById('calc-login-err');
    if (err) err.textContent = text;
    else pendingLoginErr = text;
};
const GOOGLE_LABEL = 'Google 계정으로 로그인';

/** 로그인 칸 */
const showLogin = () => {
    const el = showGate(`
        <div style="font-size:17px; font-weight:600;">로그인이 필요합니다</div>
        <div style="${NOTE_STYLE}">
            통합계산기는 로그인한 사용자만 쓸 수 있습니다.<br>받은 이메일 계정이나 등록된 Google 계정으로 로그인하세요 — 계정이 없거나(Google 계정 포함) 비밀번호를 잊었으면 관리자에게 문의하세요.
        </div>
        <form id="calc-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="calc-login-email" type="email" inputmode="email" autocomplete="username" placeholder="이메일" required style="${INPUT_STYLE}">
            <input id="calc-login-pw" type="password" autocomplete="current-password" placeholder="비밀번호" required style="${INPUT_STYLE}">
            <button type="submit" id="calc-login-btn" style="${BTN_STYLE}">로그인</button>
        </form>
        <div style="display:flex; align-items:center; gap:8px; width:100%; max-width:300px; font-size:12px; color:var(--c-text-2,#646B75);">
            <span style="flex:1; height:1px; background:var(--c-line-strong,#D6DAE0);"></span>또는<span style="flex:1; height:1px; background:var(--c-line-strong,#D6DAE0);"></span>
        </div>
        <div data-k="calc-google-note" style="font-size:12px; line-height:1.6; max-width:300px; padding:8px 10px; border-radius:10px;
            background:var(--c-warn-bg,#FFF6E0); color:var(--c-warn-text,#7A5B00); border:1px solid var(--c-warn-line,#F0D58A);">
            업무관리(대시보드)를 쓰는 직원은 위 이메일 로그인을 쓰세요 — 구글로 로그인하면 대시보드 비밀번호 로그인이 풀릴 수 있습니다.
        </div>
        <button type="button" id="calc-login-google" style="${BTN2_STYLE} width:100%; max-width:300px;">${GOOGLE_LABEL}</button>
        <div id="calc-login-err" role="alert" style="font-size:12px; color:var(--c-risk-text,#A0525C); min-height:16px; max-width:300px;"></div>`);
    const form = el.querySelector('#calc-login-form');
    const err = el.querySelector('#calc-login-err');
    const btn = el.querySelector('#calc-login-btn');
    const gbtn = el.querySelector('#calc-login-google');
    if (pendingLoginErr) { err.textContent = pendingLoginErr; pendingLoginErr = ''; }
    gbtn.addEventListener('click', async () => {
        gbtn.disabled = true; gbtn.textContent = '로그인 중…'; err.textContent = '';
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });   // 여러 구글 계정 중 고르게
        try {
            await signInWithPopup(auth, provider);
            // 성공하면 onAuthStateChanged 가 판정으로 넘어간다
        } catch (e2) {
            // 팝업 막힘도 redirect 로 넘기지 않고 안내만(loginErrText) — 사용자가 허용한 뒤 다시 누른다
            err.textContent = loginErrText(e2 && e2.code ? e2.code : '');
            gbtn.disabled = false; gbtn.textContent = GOOGLE_LABEL;
        }
    });
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

/** 막힘(퇴사·쓸 수 없는 계정)·확인 실패 — 둘 다 [로그아웃]. 실패는 [다시 시도]도. */
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

// 한 번 읽기 — 오프라인 등으로 응답이 안 오면 getDoc 이 오래 매달린다. 제한 시간을 넘으면 { code:'timeout' } 로 실패.
const readOnce = async (path) => {
    let timer = null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject({ code: 'timeout' }), CHECK_TIMEOUT_MS); });
    return Promise.race([getDoc(doc(db, path)), timeout]).finally(() => clearTimeout(timer));
};

async function check(user) {
    const my = ++seq;
    if (!user) {
        publish('signed-out');
        showLogin();
        return;
    }
    publish('checking');
    showChecking();
    let cfg = null, cfgDenied = false, probe = null, failed = false;
    if (user.email) {           // 이메일 없는 토큰은 읽어 볼 것 없이 막는다(calcAccess → 'blocked')
        try {
            const snap = await readOnce(CONFIG_PATH);
            cfg = snap.exists() ? (snap.data() || {}) : null;
        } catch (e) {
            // 명단 밖·퇴사자는 규칙상 mainConfig 를 못 읽는다 → 공개 사본으로 확인. 그 밖(네트워크 등)은 '확인 실패'.
            if (e && e.code === 'permission-denied') cfgDenied = true;
            else { failed = true; console.warn('[계산기] 로그인 확인 실패:', (e && e.code) || 'unknown'); }
        }
        if (cfgDenied && my === seq) {
            try {
                await readOnce(PUBLIC_PATH);      // 문서가 없어도 읽기가 허용되면 된다
                probe = 'allow';
            } catch (e) {
                probe = (e && e.code === 'permission-denied') ? 'deny' : 'error';
                if (probe === 'error') console.warn('[계산기] 로그인 확인 실패:', (e && e.code) || 'unknown');
            }
        }
    }
    if (my !== seq) return;
    const access = failed ? 'error' : calcAccess({ cfg, cfgDenied, probe, email: user.email });
    if (access === 'error') {
        publish('error');
        showStop('로그인 정보를 확인하지 못했습니다', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.', () => check(auth.currentUser));
        return;
    }
    if (access === 'resigned' || access === 'blocked') {
        publish('denied');
        showStop(access === 'resigned' ? '퇴사 처리된 계정입니다' : '이 계정은 계산기를 쓸 수 없습니다',
            '관리자에게 문의하세요.', null);
        return;
    }
    let role = access;          // 'member' | 'guest'
    if (access === 'member') {
        if (calcPermDecision(cfg, user.email) !== 'allow') role = 'member-readonly';
    }
    publish('ok', role);
    removeGate();
}

publish('checking');
showChecking();

if (db && auth) {
    // 구글 리디렉트 로그인에서 돌아왔으면 결과를 한 번 처리한다(지금은 redirect 를 쓰지 않지만 남겨 둔다. 성공은 onAuthStateChanged 가 받는다 — 여기서는 오류만)
    getRedirectResult(auth).catch((e) => {
        console.warn('[계산기] 구글 로그인 실패:', (e && e.code) || 'unknown');
        showLoginErr(e && e.code);
    });
    onAuthStateChanged(auth, (user) => { check(user); });
} else {
    // Firebase 를 띄우지 못했다 — 확인할 방법이 없으므로 계산기를 열지 않는다(새로고침으로 다시).
    publish('error');
    showStop('로그인 정보를 확인하지 못했습니다', '페이지를 새로고침해 주세요.', () => location.reload());
}
