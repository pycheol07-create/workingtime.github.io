// === js/page-gate.js ===
// 🔒 페이지 입장 가드 (권한 개편 5단계, 2026-10-19 — 설계 4.3)
//
// 쓰는 법 — 각 페이지에 한 줄, 공통 상단바(app-shell.js) 스크립트 바로 앞에:
//   <script type="module" src="js/page-gate.js?v=202610291637" data-perm-page="location.view"></script>
//   이름 붙은 Firebase 앱을 쓰는 페이지(scan.html)는 data-perm-app="scanApp" 을 더한다.
//   ⚠️ 주소 뒤 ?f=… 로 넘기지 않는다 — 배포.py 가 내부 .js 주소의 ? 뒤를 ?v=빌드번호 로 갈아 끼워 값이 사라진다.
//   data-perm-page 가 없으면 주소(파일 이름)로 기능을 찾는다(js/lib/perm-gate.js pageFeatureFromPath).
//
// 동작
//   1. 곧바로 '확인 중' 가림막을 띄운다(상단바 자리는 비운다).
//   2. 페이지가 Firebase 앱을 만들 때까지 기다린다(최대 10초, 같은 firebasejs 10.12.2 주소 — 같은 인스턴스·에뮬레이터 연결을 따른다).
//   3. 로그인 확인 → mainConfig 1회 읽기 → perm.resolve.
//   4. window.__perm 에 결과를 두고 <html class="perm-ready"> + 'perm:ready' 이벤트(window)를 낸다 — js/feature-gate.js 가 이것을 본다.
//   5. 허용이면 가림막을 걷는다. 거부면 mainConfig.permEnforce 를 따른다:
//        warn  → 가림막을 걷고 위쪽에 안내 띠만(들여보낸다)
//        block → 가림막에 '권한이 필요합니다' + 대시보드 링크
//   6. 설정을 못 읽으면 '권한을 확인하지 못했습니다 [다시 시도]'. 모드는 마지막으로 읽은 값(이 브라우저 localStorage)을 따른다
//      — 마지막 값이 block 일 때만 가림막, 아니면 띠(지금 운영값 warn 에서 네트워크 문제로 업무가 멈추지 않게).
//   7. 로그아웃 상태면 아무것도 띄우지 않는다 — 각 페이지의 로그인 처리(미발 게이트·스캐너 로그인 칸)와 겹치지 않게.
//
// ⚠️ 화면 가림만 한다. 페이지 스크립트는 멈추지 않는다(업무예상알림의 history.html 훅이 그대로 돈다).
//    데이터는 firestore.rules 가 지킨다(읽기는 등록 직원 전원 — 설계 A2).
// ⚠️ role="dialog"·data-act 를 쓰지 않는다 — 업무마감봇·업무예상알림이 그 선택자로 자기 확인창을 찾는다.
// ⚠️ 관리자는 resolve 가 전체 기능을 주므로 그대로 통과한다(업무마감봇·업무예상알림 프로필 = 관리자).
// 이름·이메일은 화면·로그에 남기지 않는다.
import { getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, FieldPath } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { resolve, can } from './lib/perm.js?v=202610291637';
import { featureLabel, isFeatureId } from './lib/feature-catalog.js?v=202610291637';
import { enforceModeOf, gateDecision, pageFeatureFromPath, hitDayKey, HIT_KEY_RE, HIT_COLLECTION,
    isAdminOnlyNow, DATA_ADMIN_ONLY_NOTE } from './lib/perm-gate.js?v=202610291637';

const APP_ID = 'team-work-logger-v2';
const MAIN_PROJECT = 'work-tool-e2943';     // 다른 서버를 고른 스캐너(scan.html QR 설정)는 가드하지 않는다
const OVERLAY_ID = 'perm-gate';
const BANNER_ID = 'perm-gate-banner';
const MODE_KEY = 'permGate.mode';           // 마지막으로 읽은 집행 모드('warn'|'block') — 값만, 사람 정보 없음
const WAIT_APP_MS = 10000;
// 설정 읽기가 이 시간 안에 안 끝나면 '확인 실패'로 본다. Firestore 가 내부 오류로 멈추면 getDoc 이 영영 안 끝나
// '권한을 확인하는 중…' 이 무한히 남았다(2026-10-27, 저장공간 가득 → INTERNAL ASSERTION). 이때 [다시 시도]는 새로고침.
const READ_TIMEOUT_MS = 15000;
const HOME = new URL('../index.html', import.meta.url).href;

const tag = document.querySelector('script[data-perm-page]');
const FEATURE = (tag && tag.dataset.permPage) || pageFeatureFromPath(location.pathname);
const APP_NAME = (tag && tag.dataset.permApp) || '[DEFAULT]';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// china-stock-gate.js 와 같은 틀 — 바깥은 스크롤 상자, 안쪽은 margin:auto 가운데 정렬. 위쪽은 공통 상단바(--as-h) 자리를 비운다.
// z-index 는 미발·스캐너 로그인 게이트(2147483600)보다 낮게 — 로그인 칸이 이 가림막 위에 보이게.
const BASE_STYLE = `position:fixed; inset:var(--as-h,0px) 0 0 0; z-index:2147483590; background:var(--c-bg,#F5F6F8);
    display:flex; overflow-y:auto; -webkit-overflow-scrolling:touch;
    font-family:var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); color:var(--c-text,#23272E); text-align:center;`;
const INNER_STYLE = `margin:auto; display:flex; flex-direction:column; align-items:center; gap:10px; padding:24px; width:100%; max-width:420px;`;
const LINK_STYLE = `font-size:13px; color:var(--c-accent-deep,#1E4699);`;
const BTN_STYLE = `padding:10px 18px; border:0; border-radius:999px; background:var(--c-accent,#2F62C9); color:var(--c-on-fill,#fff);
    font-size:14px; font-weight:600; font-family:inherit; cursor:pointer;`;

const removeOverlay = () => {
    document.getElementById(OVERLAY_ID)?.remove();
    document.documentElement.classList.remove('perm-gate-lock');
    document.documentElement.style.overflow = '';
};
const removeBanner = () => document.getElementById(BANNER_ID)?.remove();

const showOverlay = (html) => {
    removeBanner();
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = OVERLAY_ID;
        el.style.cssText = BASE_STYLE;
        document.body.appendChild(el);
    }
    el.innerHTML = `<div style="${INNER_STYLE}">${html}</div>`;
    document.documentElement.classList.add('perm-gate-lock');
    document.documentElement.style.overflow = 'hidden';
    return el;
};

/** warn 모드 안내 띠 — 위쪽(상단바 아래)에 한 줄. 닫을 수 있다. 화면은 막지 않는다. */
const showBanner = (html) => {
    removeOverlay();
    let el = document.getElementById(BANNER_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = BANNER_ID;
        el.setAttribute('role', 'status');
        el.style.cssText = `position:fixed; top:var(--as-h,0px); left:0; right:0; z-index:2147483590;
            display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; padding:6px 40px 6px 12px;
            background:var(--c-warn-soft,#FBF3E2); color:var(--c-warn-text,#7A5410); border-bottom:1px solid var(--c-warn,#C9932E);
            font:600 12.5px/1.5 var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); text-align:center;`;
        document.body.appendChild(el);
    }
    el.innerHTML = `<span>${html}</span>
        <button type="button" data-perm-gate-close aria-label="안내 닫기"
            style="position:absolute; right:8px; top:50%; transform:translateY(-50%); border:0; background:transparent;
                   color:inherit; font-size:18px; line-height:1; cursor:pointer; padding:4px 8px;">×</button>`;
    el.querySelector('[data-perm-gate-close]').addEventListener('click', removeBanner);
    return el;
};

const showChecking = () => showOverlay(`<div style="font-size:15px; font-weight:600;">권한을 확인하는 중…</div>`);

const deniedText = () => `이 화면은 「${esc(featureLabel(FEATURE))}」 권한이 필요합니다 — 관리자에게 요청하세요.`;

const showBlocked = () => showOverlay(`
    <div style="font-size:17px; font-weight:700;">권한이 필요합니다</div>
    <div style="font-size:13px; color:var(--c-text-2,#646B75); line-height:1.7;">${deniedText()}</div>
    <a href="${esc(HOME)}" style="${LINK_STYLE}">대시보드로 가기</a>`);

const showWarn = () => showBanner(`${deniedText()} <span style="font-weight:400;">(지금은 안내만 합니다)</span>`);

/** 설정을 못 읽음 — 마지막 모드가 block 이면 가림막, 아니면 띠. 둘 다 [다시 시도]. */
const showFailed = (retry) => {
    const msg = '권한을 확인하지 못했습니다.';
    const el = (readMode() === 'block')
        ? showOverlay(`<div style="font-size:16px; font-weight:700;">${msg}</div>
              <div style="font-size:12.5px; color:var(--c-text-2,#646B75);">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</div>
              <button type="button" data-perm-gate-retry style="${BTN_STYLE}">다시 시도</button>
              <a href="${esc(HOME)}" style="${LINK_STYLE}">대시보드로 가기</a>`)
        : showBanner(`${msg} <button type="button" data-perm-gate-retry
              style="margin-left:6px; border:1px solid currentColor; background:transparent; color:inherit; border-radius:999px;
                     padding:1px 10px; font:inherit; cursor:pointer;">다시 시도</button>`);
    el.querySelector('[data-perm-gate-retry]')?.addEventListener('click', retry);
};

function readMode() {
    try { return localStorage.getItem(MODE_KEY) === 'block' ? 'block' : 'warn'; } catch (e) { return 'warn'; }
}
function saveMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 저장 못 해도 판정은 된다 */ }
}

/** 판정 결과를 페이지에 알린다(js/feature-gate.js 가 받는다). resolved 가 null 이면 '판정 없음'(로그아웃·실패). */
function publish(resolved, mode) {
    if (!resolved) {
        window.__perm = null;
        document.documentElement.classList.remove('perm-ready');
        return;
    }
    const r = resolved;
    window.__perm = Object.freeze({
        isAdmin: r.isAdmin, resigned: r.resigned, source: r.source, roleId: r.roleId, set: r.set,
        mode, page: FEATURE, can: (id) => can(r, id)
    });
    document.documentElement.classList.add('perm-ready');
    try { window.dispatchEvent(new CustomEvent('perm:ready', { detail: window.__perm })); } catch (e) { /* 무시 */ }
}

/** 페이지가 Firebase 앱을 만들 때까지 기다린다. 못 찾으면 null. */
function waitForApp() {
    return new Promise((done) => {
        const t0 = Date.now();
        const tick = () => {
            const app = getApps().find(a => a.name === APP_NAME);
            if (app) return done(app);
            if (Date.now() - t0 >= WAIT_APP_MS) return done(null);
            setTimeout(tick, 100);
        };
        tick();
    });
}

let seq = 0;   // 로그인 상태가 빨리 바뀔 때 늦게 끝난 옛 확인이 화면을 덮지 않게

async function check(db, user) {
    const my = ++seq;
    if (!user) {               // 7. 로그아웃 — 페이지의 로그인 처리에 맡긴다
        removeOverlay(); removeBanner(); publish(null);
        return;
    }
    if (!document.getElementById(BANNER_ID)) showChecking();
    let cfg = null, failed = false, timedOut = false;
    const read = getDoc(doc(db, 'artifacts', APP_ID, 'config', 'mainConfig'));
    try {
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('timeout')); }, READ_TIMEOUT_MS); });
        const snap = await Promise.race([read, timeout]).finally(() => clearTimeout(timer));
        cfg = snap.exists() ? snap.data() : {};
    } catch (e) {
        // 명단 밖·퇴사자는 규칙상 mainConfig 를 못 읽는다 → '권한 없음'으로 본다. 그 밖(네트워크 등)은 '확인 실패'.
        if (!timedOut && e && e.code === 'permission-denied') cfg = null;
        else failed = true;
        console.warn('[권한] 설정 읽기 실패:', timedOut ? 'timeout' : ((e && e.code) || 'unknown'));
    }
    if (my !== seq) return;

    if (failed) {
        publish(null);
        // 시간 초과면 같은 Firestore 로 다시 읽어도 또 멈출 수 있어 새로고침으로 다시 시작한다
        showFailed(timedOut ? () => location.reload() : () => check(db, user));
        // 망이 느렸을 뿐이면 늦게라도 온 결과로 정상 판정을 이어 간다(실패 띠·가림막을 바꾼다)
        if (timedOut) read.then(
            (snap) => { if (my === seq) applyConfig(db, user, snap.exists() ? snap.data() : {}); },
            (e) => { if (my === seq && e && e.code === 'permission-denied') applyConfig(db, user, null); });
        return;
    }
    applyConfig(db, user, cfg);
}

/** 설정(cfg, 못 읽으면 null)으로 판정해 화면에 반영한다. */
function applyConfig(db, user, cfg) {
    const mode = cfg ? enforceModeOf(cfg) : readMode();
    if (cfg) saveMode(mode);
    const resolved = cfg ? resolve(cfg, user.email) : resolve({}, user.email);
    publish(resolved, mode);

    const d = gateDecision(resolved, FEATURE, mode);
    if (d === 'allow' && !resolved.isAdmin && isAdminOnlyNow(FEATURE)) showBanner(esc(DATA_ADMIN_ONLY_NOTE));   // history.html 이 되돌려 보낸다
    else if (d === 'allow') { removeOverlay(); removeBanner(); }
    else if (d === 'block') showBlocked();
    else showWarn();
    if (d !== 'allow' && cfg) recordHit(db);
}

/** 막힐 뻔한(warn)·막힌(block) 입장을 기능 id 별 건수로 센다 — permGateHits/{yyyymmdd} 의 키 하나 +1.
 *  이메일·이름은 남기지 않는다. 같은 탭·같은 기능은 하루 1회(sessionStorage). 실패해도 화면에는 영향 없음.
 *  기능 id 에 점(.)이 있어 updateDoc 은 FieldPath 로 한 칸을 가리킨다(문자열이면 경로로 풀려 하위 칸이 생긴다).
 *  그날 문서가 아직 없으면(updateDoc 실패) setDoc merge 로 만든다 — setDoc 의 키는 경로로 풀리지 않는다.
 *  ⚠️ setDoc(…, { mergeFields: [FieldPath] }) 는 쓰지 않는다 — 에뮬레이터에서 increment 가 1 로 덮였다. */
function recordHit(db) {
    if (!HIT_KEY_RE.test(FEATURE)) return;
    const day = hitDayKey();
    const flag = `permGate.hit.${day}.${FEATURE}`;
    try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch (e) { return; }
    const ref = doc(db, HIT_COLLECTION, day);
    updateDoc(ref, new FieldPath(FEATURE), increment(1))
        .catch(() => setDoc(ref, { [FEATURE]: increment(1) }, { merge: true }))
        .catch((e) => console.warn('[권한] 입장 집계 실패:', (e && e.code) || 'unknown'));
}

async function main() {
    if (!isFeatureId(FEATURE)) {
        console.warn('[권한] 페이지 기능을 알 수 없어 가드를 건너뜁니다:', FEATURE);
        return;
    }
    showChecking();
    const app = await waitForApp();
    if (!app) {
        // 페이지가 Firebase 를 띄우지 못했다(오류·오프라인). 확인할 방법이 없으므로 '확인 실패'로 둔다 — 새로고침으로 다시.
        console.warn('[권한] Firebase 앱을 찾지 못했습니다:', APP_NAME);
        publish(null);
        showFailed(() => location.reload());
        return;
    }
    if (app.options && app.options.projectId && app.options.projectId !== MAIN_PROJECT) {
        removeOverlay();       // 다른 서버(스캐너 QR 설정) — 그 서버의 규칙을 따른다
        return;
    }
    const auth = getAuth(app);
    const db = getFirestore(app);
    onAuthStateChanged(auth, (user) => { check(db, user); });
}

main().catch((e) => {
    console.warn('[권한] 가드 오류 — 가림막을 걷습니다:', (e && (e.code || e.name)) || 'unknown');
    removeOverlay();
});
