// === js/feature-gate.js ===
// 페이지 안 기능 가림 도구 (권한 개편 5단계, 2026-10-19 — 설계 4.4). 여러 페이지가 같이 쓴다.
// 판정은 js/page-gate.js 가 만든 window.__perm(+ 'perm:ready' 이벤트)을 본다. 판정 전에는 전부 '없음'(닫는 쪽).
//
//   whenPerm(id, fn)            권한이 확인되면 fn 을 한 번 부른다(없으면 끝내 안 부른다 — 구독·읽기도 안 한다)
//   onPerm(fn)                  판정이 나올 때마다(로그인 바뀜 포함) fn(perm)
//   applyFeatureVisibility()    [data-feature="a|b"] 요소를 판정대로 숨긴다(하나라도 있으면 보임)
//   guardFunctions(map, opts)   window.* 함수를 감싼다 — 권한 없으면 안내만 하고 원래 함수를 부르지 않는다
//   guardFileInputs(map)        파일 input 의 change 를 캡처 단계에서 끊는다(페이지 리스너보다 먼저)
//   guardClicks(map)            동적으로 그려지는 버튼의 click 을 캡처 단계에서 끊는다
//   guardDrags(map)             dragstart 를 캡처 단계에서 끊는다(열 머리 끌어 순서 저장 등)
//
// ⚠️ 화면·클라이언트 장치다. 콘솔에서 원래 동작을 직접 흉내 내는 것까지는 못 막는다 — 데이터는 firestore.rules 가 지킨다.
// ⚠️ 안내는 role="status" 토스트로만 띄운다(role="dialog"·data-act 금지 — 업무마감봇·업무예상알림 선택자).
import { can } from './lib/perm.js?v=202610301725';
import { featureLabel } from './lib/feature-catalog.js?v=202610301725';
import { featureList, canAny } from './lib/perm-gate.js?v=202610301725';

export const currentPerm = () => (typeof window !== 'undefined' && window.__perm) || null;
export const canFeature = (id) => can(currentPerm(), id);

/** 판정이 나올 때마다 fn(perm). 이미 나와 있으면 곧바로 한 번. */
export function onPerm(fn) {
    if (currentPerm()) { try { fn(currentPerm()); } catch (e) { console.warn('[권한] onPerm 오류:', e); } }
    window.addEventListener('perm:ready', () => {
        try { fn(currentPerm()); } catch (e) { console.warn('[권한] onPerm 오류:', e); }
    });
}

/** 권한이 확인되면 fn 을 한 번만 부른다. 권한이 없으면 부르지 않는다(나중에 다른 계정으로 로그인해 생기면 그때). */
export function whenPerm(id, fn) {
    let done = false;
    const tryRun = () => {
        if (done || !canFeature(id)) return;
        done = true;
        try { fn(); } catch (e) { console.error('[권한] whenPerm 실행 오류:', e); }
    };
    tryRun();
    if (!done) window.addEventListener('perm:ready', tryRun);
}

/** [data-feature] 요소 가림. 허용이 안 되면 display:none + inert. 다시 허용되면 원래 display 로 돌린다. */
export function applyFeatureVisibility(root = document) {
    const perm = currentPerm();
    root.querySelectorAll('[data-feature]').forEach(el => {
        const ok = canAny(perm, featureList(el.getAttribute('data-feature')));
        if (!ok) {
            if (el.dataset.permHidden !== '1') {
                el.dataset.permHidden = '1';
                el.dataset.permPrevDisplay = el.style.display || '';
            }
            el.style.display = 'none';
            el.inert = true;
        } else if (el.dataset.permHidden === '1') {
            el.style.display = el.dataset.permPrevDisplay || '';
            el.inert = false;
            delete el.dataset.permHidden;
            delete el.dataset.permPrevDisplay;
        }
    });
}

// ── 안내 토스트(페이지마다 토스트 함수가 달라 여기서 따로 그린다) ──
const TOAST_ID = 'perm-toast';
let toastTimer = null;
export function denyNotice(id) {
    const msg = `「${featureLabel(id)}」 권한이 필요합니다 — 관리자에게 요청하세요.`;
    let el = document.getElementById(TOAST_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = TOAST_ID;
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = `position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:2147483580;
            max-width:min(92vw,520px); padding:10px 16px; border-radius:12px; background:var(--c-text,#23272E); color:#fff;
            font:600 13px/1.5 var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); text-align:center;
            box-shadow:0 6px 20px rgba(0,0,0,.18); pointer-events:none;`;
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/** window.* 함수 감싸기. map = { 함수이름: 기능id }.
 *  opts.quiet = [이름] — 자동으로 불리는 함수(업로드 뒤 정리 등)는 안내 없이 콘솔에만 남긴다.
 *  원래 함수의 this·반환값은 그대로 넘긴다. 거부할 때 원래가 async 면 Promise 를 돌려준다(부르는 쪽 .then/.catch 가 깨지지 않게).
 *  없는 이름은 콘솔 경고 후 돌려준다(location.js 에서 이름이 바뀌면 감싸기가 조용히 꺼지는 것을 알리려고 — 설계 리스크 8). */
export function guardFunctions(map, { quiet = [] } = {}) {
    const missing = [];
    for (const [name, id] of Object.entries(map || {})) {
        const orig = window[name];
        if (typeof orig !== 'function') { missing.push(name); continue; }
        if (orig.__permGuarded) continue;
        const isAsync = !!(orig.constructor && orig.constructor.name === 'AsyncFunction');
        const wrapped = function (...args) {
            if (!canFeature(id)) {
                if (quiet.includes(name)) console.info(`[권한] ${name} 건너뜀 — ${id} 권한 없음`);
                else denyNotice(id);
                return isAsync ? Promise.resolve(undefined) : undefined;
            }
            return orig.apply(this, args);
        };
        wrapped.__permGuarded = true;
        wrapped.__permFeature = id;
        window[name] = wrapped;
    }
    if (missing.length) console.warn('[권한] 감쌀 함수를 찾지 못했습니다(이름이 바뀌었는지 확인):', missing.join(', '));
    return missing;
}

/** 파일 input change 를 캡처 단계(window)에서 끊는다. map = { inputId: 기능id }.
 *  페이지 리스너가 input 에 직접 붙어 있어도 window 캡처가 먼저 돈다(등록 순서와 무관). */
export function guardFileInputs(map) {
    window.addEventListener('change', (e) => {
        const t = e.target;
        if (!t || t.tagName !== 'INPUT' || t.type !== 'file' || !Object.prototype.hasOwnProperty.call(map, t.id)) return;
        const id = map[t.id];
        if (canFeature(id)) return;
        e.stopImmediatePropagation();
        try { t.value = ''; } catch (err) { /* 무시 */ }
        denyNotice(id);
    }, true);
}

/** dragstart 를 캡처 단계에서 끊는다(끌어서 순서 바꾸기 같은 저장 동작). map = { CSS선택자: 기능id }. */
export function guardDrags(map) {
    const entries = Object.entries(map || {});
    window.addEventListener('dragstart', (e) => {
        const t = e.target && e.target.closest ? e.target : (e.target && e.target.parentElement);
        if (!t) return;
        for (const [sel, id] of entries) {
            if (!t.closest(sel) || canFeature(id)) continue;
            e.preventDefault();
            e.stopImmediatePropagation();
            denyNotice(id);
            return;
        }
    }, true);
}

/** 동적 버튼 click 을 캡처 단계에서 끊는다. map = { CSS선택자: 기능id }. */
export function guardClicks(map) {
    const entries = Object.entries(map || {});
    window.addEventListener('click', (e) => {
        const t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        for (const [sel, id] of entries) {
            if (!t.closest(sel) || canFeature(id)) continue;
            e.stopImmediatePropagation();
            e.preventDefault();
            denyNotice(id);
            return;
        }
    }, true);
}
