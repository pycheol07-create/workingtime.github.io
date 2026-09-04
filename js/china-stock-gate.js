// === js/china-stock-gate.js ===
// 🔒 화면 게이트 — 메인 앱(업무관리)에 로그인돼 있는지만 확인한다.
//
// 왜 이렇게 하나
//   이 페이지의 데이터는 china-stock 전용 프로젝트(location-e2ff9 등)를 쓰지만,
//   로그인 계정은 메인 앱 프로젝트(work-tool-e2943)에 있다. 그래서 로그인 확인만
//   메인 프로젝트로 따로 물어본다. 같은 사이트에서 이미 로그인했다면 다시 로그인할 필요가 없다.
//
// ⚠️ china-stock-config.js 가 기본 앱('[DEFAULT]')을 이미 쓰므로,
//    여기서는 반드시 다른 이름('MainAuthApp')으로 올린다. 같은 이름으로 올리면 충돌한다.
//
// ⚠️ 이건 '화면을 가리는' 장치다. 데이터 자체를 막지는 못한다(그건 Firestore 규칙의 몫).
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig as mainConfig } from './config.js?v=202609041543';

const OVERLAY_ID = 'cs-auth-gate';

const showGate = (msg) => {
    if (document.getElementById(OVERLAY_ID)) return;
    const el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.style.cssText = `position:fixed; inset:0; z-index:2147483600; background:#f5f5f5;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
        font-family:'Noto Sans KR',sans-serif; color:#37474f; text-align:center; padding:24px;`;
    el.innerHTML = `
        <div style="font-size:42px;">🔒</div>
        <div style="font-size:17px; font-weight:800;">로그인이 필요합니다</div>
        <div style="font-size:13px; color:#78909c; line-height:1.6;">${msg}</div>
        <a href="index.html" style="margin-top:8px; font-size:13px; font-weight:700; text-decoration:none;
           background:#1976d2; color:#fff; padding:9px 16px; border-radius:8px;">업무관리 열기</a>`;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
};

const hideGate = () => {
    document.getElementById(OVERLAY_ID)?.remove();
    document.documentElement.style.overflow = '';
};

// 확인이 끝나기 전까지는 우선 가려 둔다(로그인 상태면 곧 사라진다)
showGate('로그인 상태를 확인하는 중입니다…');

try {
    let app;
    try { app = getApp('MainAuthApp'); } catch (e) { app = initializeApp(mainConfig, 'MainAuthApp'); }
    onAuthStateChanged(getAuth(app), (user) => {
        if (user) hideGate();
        else {
            hideGate();
            showGate('업무관리(메인 앱)에서 먼저 로그인한 뒤 이 페이지를 열어 주세요.<br>이미 로그인돼 있으면 다시 입력하지 않아도 됩니다.');
        }
    });
} catch (e) {
    console.warn('[china-stock] 로그인 확인 실패 — 게이트를 해제합니다:', e);
    hideGate();   // 확인 자체가 안 되면 화면을 막아 업무를 멈추게 하지는 않는다
}
