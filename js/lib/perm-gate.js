// === js/lib/perm-gate.js ===
// 페이지 입장 가드(js/page-gate.js)·페이지 안 기능 가림(js/feature-gate.js)이 같이 쓰는 순수 판정(권한 개편 5단계, 2026-10-19).
// ※ 의존성은 perm.js·feature-catalog.js 뿐 — node --test 로 시험한다(tests/perm-gate.test.js).

import { can } from './perm.js?v=202610261228';
import { FEATURES, isFeatureId } from './feature-catalog.js?v=202610261228';

/** mainConfig.permEnforce → 'warn' | 'block'. 모르는 값·없음은 'warn'(막지 않는 쪽 — 설계 4.3 기본값). */
export const enforceModeOf = (cfg) => ((cfg && cfg.permEnforce === 'block') ? 'block' : 'warn');

/** data-feature 값 'a|b c,d' → 기능 id 배열. 모르는 id 는 버린다. */
export const featureList = (attr) => String(attr || '').split(/[\s|,]+/).filter(isFeatureId);

/** 기능 가운데 하나라도 있으면 true. 목록이 비면 false(닫는 쪽). */
export const canAny = (resolved, ids) => (Array.isArray(ids) ? ids : []).some(id => can(resolved, id));

/** 주소 경로 → 그 페이지 입장 기능 id(없으면 null).
 *  '/x/v.수정본/calculator/index.html' → 'calculator.view', '/location.html' → 'location.view'.
 *  폴더 주소('calculator/')는 index.html 로 본다. 마지막 두 조각을 먼저, 그다음 마지막 한 조각으로 찾는다. */
export const pageFeatureFromPath = (pathname) => {
    const parts = String(pathname || '').split('?')[0].split('#')[0].split('/');
    let file = parts.pop();
    if (file === '') file = 'index.html';
    const dir = parts.length ? parts[parts.length - 1] : '';
    const pages = FEATURES.filter(f => f.kind === 'page');
    const two = dir ? `${decodeURIComponent(dir)}/${file}` : '';
    const hit = (two && pages.find(f => f.page === two)) || pages.find(f => f.page === file);
    return hit ? hit.id : null;
};

/** 입장 판정 → 'allow' | 'warn'(띠만) | 'block'(가림막). */
export const gateDecision = (resolved, featureId, mode) => {
    if (can(resolved, featureId)) return 'allow';
    return mode === 'block' ? 'block' : 'warn';
};

// ── 데이터 관리(data.*) — 지금은 관리자만 효과가 있다 ──
// history.html 이 관리자만 들여보낸다(사용자 결정: 데이터 관리는 기본 관리자만). 기능을 일반 직원에게 줘도
// 대시보드 버튼·페이지 가드는 열리지만 화면 안에서 되돌려 보낸다 — 관리 화면·history.html 이 이 문구를 같이 쓴다.
export const ADMIN_ONLY_NOW_GROUPS = ['data'];
export const isAdminOnlyNow = (id) => ADMIN_ONLY_NOW_GROUPS.some(g => String(id || '').startsWith(g + '.'));
export const DATA_ADMIN_ONLY_NOTE = '데이터 관리 화면은 지금 관리자만 들어갈 수 있습니다(일반 직원에게 데이터 관리 기능을 줘도 아직 효과가 없습니다).';

// ── warn 기간 '막힐 뻔한 입장' 집계 (top-level permGateHits/{yyyymmdd}, 기능 id 별 건수만) ──
// 이메일·이름은 남기지 않는다. 같은 탭·같은 기능은 하루 1회(sessionStorage).
export const HIT_KEY_RE = /^[A-Za-z0-9._]{1,40}$/;
export const HIT_COLLECTION = 'permGateHits';

/** 날짜 → 'yyyymmdd'(이 PC 시각 기준 — 한국 PC). */
export const hitDayKey = (d = new Date()) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** 오늘부터 거꾸로 n 일의 날짜 키(오늘 먼저). */
export const lastDayKeys = (n = 7, now = new Date()) => Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    return hitDayKey(d);
});

/** 하루치 문서들 → [{ id, n }] (건수 큰 순, 같으면 id 순). 모르는 키·숫자 아닌 값은 버린다. */
export const sumHits = (docs) => {
    const total = {};
    for (const d of (Array.isArray(docs) ? docs : [])) {
        for (const [k, v] of Object.entries(d || {})) {
            if (!HIT_KEY_RE.test(k) || typeof v !== 'number' || !(v > 0)) continue;
            total[k] = (total[k] || 0) + v;
        }
    }
    return Object.entries(total).map(([id, n]) => ({ id, n }))
        .sort((a, b) => (b.n - a.n) || (a.id < b.id ? -1 : 1));
};
