// === js/products.js ===
// 상품 관리(products.html) 진입점 — 로그인 게이트 · 관리자 판정 · 화면 전환(해시) · 머리 버튼. 2026-10-13. 설계: 상품DB_설계_v2.md
//
// 화면: #            목록         (js/products-list.js)
//       #p=<품목코드> 상세         (js/products-detail.js)
//       #log          기본정보 변경 이력(전원)
//       #sup · #costlog  공급처 대장 · 단가 변경 이력(관리자, js/products-cost.js)
// 관리자 판정 = mainConfig.memberRoles[소문자 이메일]==='admin' (규칙 isAdmin() 과 같음, 서버에서 1회 읽기).
//   화면을 가리는 장치일 뿐이고 원가·공급처 데이터는 firestore.rules 가 막는다. 팀원 화면에는 관리자 영역 DOM 을 만들지 않는다.
// 계정이 바뀌면(로그아웃·다른 계정) location.reload() — 메모리의 원가를 확실히 버린다.
//
// ⚠️ china-stock-config.js / china-stock-gate.js 를 import 하지 않는다(영속 캐시 → 원가가 디스크에 남음).
//    로그인 칸 UI 는 china-stock-gate.js 를 **복사**했다.
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202610190921';
import { emulatorEnabled } from './firebase-emulator.js?v=202610190921';
import { S, loadAll, countRead, fmtDateTime, tsMs } from './products-store.js?v=202610190921';
import { renderList, exportCatalog } from './products-list.js?v=202610190921';
import { renderDetail, renderCatalogLog } from './products-detail.js?v=202610190921';
import { loadCosts, renderSuppliers, renderCostLog } from './products-cost.js?v=202610190921';
import { openUpload } from './products-excel.js?v=202610190921';
import { setShellContext } from './app-shell-bridge.js?v=202610190921';
import { memberNameFor } from './app-shell-data.js?v=202610190921';

const $ = (id) => document.getElementById(id);
const APP_BASE = 'artifacts/team-work-logger-v2';
const LOC_OLD_MS = 3 * 86400000;           // 위치 요약이 3일 넘게 안 바뀌면 '오래됨'

let toastTimer = null;
export function toast(msg, ms = 2600) {
    const el = $('pd-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
export function setLoading(on, text) {
    $('pd-loading').style.display = on ? 'flex' : 'none';
    if (text) $('pd-loading-text').textContent = text;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 로그인 게이트 (china-stock-gate.js 복사) ─────────────────
const GATE_ID = 'pd-auth-gate';
// 위쪽은 공통 상단바(--as-h) 자리를 비워 둔다 — 로그인 전에도 홈 버튼이 보이게
const GATE_STYLE = `position:fixed; inset:var(--as-h,0px) 0 0 0; z-index:2147483600; background:var(--c-bg,#F5F6F8);
    display:flex; overflow-y:auto; -webkit-overflow-scrolling:touch;
    font-family:var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); color:var(--c-text,#23272E); text-align:center;`;
const GATE_INNER = `margin:auto; display:flex; flex-direction:column; align-items:center; gap:10px; padding:24px; width:100%; box-sizing:border-box;`;
const removeGate = () => { $(GATE_ID)?.remove(); document.documentElement.style.overflow = ''; };
function showGate(html) {
    removeGate();
    const el = document.createElement('div');
    el.id = GATE_ID;
    el.style.cssText = GATE_STYLE;
    el.innerHTML = `<div style="${GATE_INNER}">${html}</div>`;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    return el;
}
function showLogin(auth) {
    const inStyle = 'padding:11px 12px; border:1px solid var(--c-line-strong,#D6DAE0); border-radius:10px; font-size:15px; font-family:inherit; background:var(--c-surface,#FFFFFF); color:var(--c-text,#23272E);';
    const el = showGate(`
        <div style="font-size:17px; font-weight:600;">로그인이 필요합니다</div>
        <div style="font-size:12.5px; color:var(--c-text-2,#646B75); line-height:1.7; max-width:320px;">업무관리와 같은 계정입니다.</div>
        <form id="pd-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="pd-email" type="email" inputmode="email" autocomplete="username" placeholder="이메일" style="${inStyle}">
            <input id="pd-pw" type="password" autocomplete="current-password" placeholder="비밀번호" style="${inStyle}">
            <button type="submit" id="pd-login-btn" style="padding:12px; border:0; border-radius:999px; background:var(--c-accent,#2F62C9); color:#fff; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer;">로그인</button>
            <div id="pd-login-err" style="font-size:12px; color:var(--c-risk-text,#A0525C); min-height:16px;"></div>
        </form>
        <a href="index.html" style="font-size:12.5px; color:var(--c-accent-deep,#1E4699);">업무관리 열기</a>`);
    el.querySelector('#pd-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#pd-login-btn'), err = el.querySelector('#pd-login-err');
        btn.disabled = true; btn.textContent = '로그인 중…'; err.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, el.querySelector('#pd-email').value.trim(), el.querySelector('#pd-pw').value);
        } catch (e2) {
            const code = e2 && e2.code ? e2.code : '';
            err.textContent = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)
                ? '이메일 또는 비밀번호가 잘못되었습니다.' : `로그인 오류: ${code || '알 수 없음'}`;
            btn.disabled = false; btn.textContent = '로그인';
        }
    });
}

// ── 머리 ─────────────────────────────────────────────────
export function renderBasis() {
    const parts = [];
    const lu = S.meta && S.meta.lastUpload;
    if (S.meta) parts.push(`기본정보 ${lu ? fmtDateTime(tsMs(lu.at)) + ' 업로드' : '있음'}`);
    else parts.push('기본정보 없음');
    let old = false;
    if (S.locMeta && S.locMeta.at) {
        const at = tsMs(S.locMeta.at);
        old = Date.now() - at > LOC_OLD_MS;
        parts.push(`위치·재고 ${fmtDateTime(at)} 기준${old ? '(오래됨)' : ''}`);
    } else parts.push('위치·재고 요약 없음');
    if (!S.isAdmin) parts.push('원가·공급처는 관리자만 보입니다');
    $('pd-basis').textContent = parts.join(' · ');
    document.querySelector('.pd-head-sub .pd-dot').classList.toggle('is-old', old || !S.meta);
}
export const isLocOld = () => !!(S.locMeta && S.locMeta.at && Date.now() - tsMs(S.locMeta.at) > LOC_OLD_MS);

export function setHead({ title = '상품 관리', code = '', crumb = '', back = false } = {}) {
    $('pd-title').innerHTML = esc(title) + (code ? `<span class="pd-code num">${esc(code)}</span>` : '');
    $('pd-crumb').style.display = crumb ? 'block' : 'none';
    $('pd-crumb').textContent = crumb;
    $('pd-back').style.display = back ? 'inline-block' : 'none';
    $('pd-head-sub').style.display = back ? 'none' : 'flex';
    $('pd-tabs').style.display = back ? 'none' : 'flex';
    document.title = back ? `${title} — 상품 관리` : '상품 관리';
}

// ── 화면 전환 ─────────────────────────────────────────────
export function route() {
    const h = location.hash.replace(/^#/, '');
    const main = $('pd-main');
    const tab = h.startsWith('p=') ? 'detail' : (['log', 'sup', 'costlog'].includes(h) ? h : 'list');
    document.querySelectorAll('#pd-tabs .d-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    if ((tab === 'sup' || tab === 'costlog') && !S.isAdmin) { location.hash = ''; return; }
    if (tab === 'detail') {
        const pid = decodeURIComponent(h.slice(2));
        renderDetail(main, pid);
    } else {
        setHead();
        if (tab === 'log') renderCatalogLog(main);
        else if (tab === 'sup') renderSuppliers(main);
        else if (tab === 'costlog') renderCostLog(main);
        else renderList(main);
    }
}

export async function refresh({ force = false } = {}) {
    setLoading(true, '불러오는 중…');
    try {
        const fails = await loadAll({ force });
        if (S.isAdmin) await loadCosts().catch(e => { console.error('[products] 원가 읽기 실패:', e && e.code); toast('원가를 읽지 못했습니다(권한·네트워크)'); });
        if (fails.length) toast('일부를 읽지 못했습니다: ' + fails.join(', '));
    } catch (e) {
        console.error('[products] 기본정보 읽기 실패:', e && e.code);
        toast('기본정보를 읽지 못했습니다 — 새로고침해 보세요' + (e && e.code === 'permission-denied' ? ' (권한: 규칙 게시 전일 수 있음)' : ''), 6000);
    } finally {
        setLoading(false);
    }
    renderBasis();
    route();
}

async function checkAdmin(user) {
    const snap = await getDocFromServer(doc(S.db, APP_BASE + '/config/mainConfig'));
    countRead('관리자 확인');
    const roles = (snap.exists() && snap.data().memberRoles) || {};
    // 공통 상단바 개인 알림(P2) — 같은 문서의 memberEmails 로 이름을 찾아 넘긴다(추가 읽기 없음). 이름은 메모리에만.
    const memberName = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
    if (memberName && auth.currentUser && auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName });
    return roles[(user.email || '').toLowerCase()] === 'admin';
}

let startedUid = null;
async function start(user) {
    startedUid = user.uid;
    S.user = user;
    S.email = (user.email || '').toLowerCase();
    setLoading(true, '권한 확인 중…');
    try { S.isAdmin = await checkAdmin(user); }
    catch (e) { console.error('[products] 관리자 확인 실패:', e && e.code); S.isAdmin = false; toast('권한을 확인하지 못해 팀원 화면으로 엽니다'); }
    document.body.classList.toggle('is-admin', S.isAdmin);
    if (!S.isAdmin) document.querySelectorAll('.pd-adm').forEach(el => el.remove());   // 팀원 화면엔 관리자 버튼·탭 자체를 두지 않는다
    $('pd-app').style.display = 'block';
    $('pd-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b) return;
        location.hash = b.dataset.tab === 'list' ? '' : b.dataset.tab;
    });
    $('pd-back').addEventListener('click', () => { if (history.length > 1 && document.referrer.includes('products.html')) history.back(); else location.hash = ''; });
    $('pd-refresh').addEventListener('click', () => refresh());
    $('pd-export').addEventListener('click', () => exportCatalog());
    if (S.isAdmin) {
        $('pd-up-catalog').addEventListener('click', () => openUpload('catalog'));
        $('pd-up-cost').addEventListener('click', () => openUpload('cost'));
    }
    window.addEventListener('hashchange', route);
    await refresh();
}

// ── 시작 ─────────────────────────────────────────────────
const { db, auth } = initializeFirebase();
S.db = db; S.auth = auth;
// 🧪 ?emu=1 인데 에뮬레이터 연결이 안 됐으면(띠가 없으면) 운영으로 붙을 위험 — 멈춘다
const emuBad = emulatorEnabled() && !document.getElementById('emulator-banner');
if (!db || !auth || emuBad) {
    setLoading(false);
    showGate(`<div style="font-size:16px; font-weight:600;">${emuBad ? '에뮬레이터 연결 실패 — 창을 닫으세요(운영 데이터 보호)' : 'Firebase 초기화 실패 — 새로고침해 보세요'}</div>`);
} else {
    onAuthStateChanged(auth, (user) => {
        if (startedUid && (!user || user.uid !== startedUid)) { location.reload(); return; }
        if (!user) { setShellContext({ signedIn: false }); setLoading(false); showLogin(auth); return; }
        setShellContext({ signedIn: true, uid: user.uid });   // 공통 상단바 — uid 만(메뉴는 대시보드에서 채운 캐시)
        removeGate();
        if (!startedUid) start(user);
    });
}
