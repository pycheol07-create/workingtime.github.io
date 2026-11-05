// === js/lib/ops-report-route.js ===
// 운영 리포트(데이터 관리 '분석' 화면 하나, 2026-11-05 운영 리포트 통합 2단계) — 탭 목록·탭 권한·옛 주소 이동표. 의존성 없는 순수 모듈.
//   옛 화면 6개(요약·생산성·인력 적정성·업무 리포트·팀 결산·업무 담당 변화)는 레일에서 빠졌다.
//   옛 주소(#tab=dashboard, #tab=rawdata&sub=report, #tab=settlement …)·저장해 둔 화면 기억·Ctrl+K 옛 목적지는 여기서 운영 리포트 탭으로 바꾼다.
//   쓰는 곳: js/view-state.js(해시·기억 복원), js/listeners-history-tabs.js(showSection), js/ui-history-ops-report.js(탭 그리기).
//   테스트: tests/ops-report-route.test.js

export const OPS_MAIN = 'ops';

// 탭 순서 = 화면 순서
export const OPS_TABS = ['summary', 'productivity', 'tasks', 'staffing', 'cost'];
export const OPS_TAB_LABELS = {
    summary: '요약', productivity: '생산성', tasks: '업무별', staffing: '인력', cost: '비용'
};
// 탭 권한(js/lib/feature-catalog.js 의 기능 id). 업무별(리포트 인건비 표)·비용·결산은 인건비가 보이므로 data.reports(옛 업무 리포트와 같음), 나머지는 data.analysis.
export const OPS_TAB_FEATURE = {
    summary: 'data.analysis', productivity: 'data.analysis', tasks: 'data.reports', staffing: 'data.analysis', cost: 'data.reports'
};
export const SETTLE_FEATURE = 'data.reports';

// 옛 화면 → 운영 리포트. 키는 'main' 또는 'main/sub'.
//   settle: 비용 탭 위에 팀 결산 화면(자체 기간 선택)을 연다 · owner: 업무별 탭의 '업무 담당 변화' 칸으로 내려간다.
export const LEGACY_REDIRECTS = {
    'dashboard':      { sub: 'summary' },
    'productivity':   { sub: 'productivity' },
    'staffing':       { sub: 'staffing' },
    'rawdata/report': { sub: 'tasks' },
    'settlement':     { sub: 'cost', settle: '1' },
    'taskowner':      { sub: 'tasks', owner: '1' }
};

/** 옛 화면이면 이동할 곳({ sub, settle?, owner? }), 아니면 null. */
export function legacyTarget(main, sub) {
    if (!main) return null;
    const r = LEGACY_REDIRECTS[main === 'rawdata' ? `rawdata/${sub || ''}` : main];
    return r ? { ...r } : null;
}

/** 화면 상태({ main, sub, gran, dateKey, fview, settle, owner }) → 옛 화면이면 운영 리포트로 바꾼 사본, 아니면 그대로.
 *  기간(gran·dateKey)은 넘긴다. 팀 결산·업무 담당 변화는 날짜 트리를 안 써서 옛 주소에 날짜가 없다. */
export function redirectView(v) {
    if (!v || !v.main) return v;
    const t = legacyTarget(v.main, v.sub);
    if (!t) return v;
    const out = { ...v, main: OPS_MAIN, sub: t.sub };
    delete out.settle; delete out.owner; delete out.fview;
    if (t.settle) out.settle = t.settle;
    if (t.owner) out.owner = t.owner;
    return out;
}

/** 이 사람이 볼 수 있는 탭(순서 유지). can = (기능 id) => boolean */
export function allowedTabs(can) {
    const ok = typeof can === 'function' ? can : () => false;
    return OPS_TABS.filter(t => !!ok(OPS_TAB_FEATURE[t]));
}

/** 열 탭 고르기 — 모르는 탭·권한 없는 탭이면 요약(요약도 못 보면 볼 수 있는 첫 탭, 하나도 없으면 null). */
export function pickTab(want, allowed) {
    const list = Array.isArray(allowed) ? allowed : [];
    if (want && list.includes(want)) return want;
    if (list.includes('summary')) return 'summary';
    return list[0] || null;
}

/** 팀 결산을 열 수 있나 — 비용 탭과 같은 권한. */
export const canSettle = (can) => typeof can === 'function' && !!can(SETTLE_FEATURE);

/** 날짜 트리를 안 쓰는 상태인가 — 팀 결산(자체 월·분기·년 선택)만. 업무별 탭의 업무 담당 변화 칸은 최근 12개월을 따로 본다(문구로 알림). */
export const isOpsTreeless = (v) => !!(v && v.main === OPS_MAIN && String(v.settle || '') === '1');

/** 날짜 트리의 선택(단위·키) → 팀 결산 선택기에 넣을 기간. 월·년만 넘기고 일·주는 null(결산 기본 = 이번 달). */
export function settlePresetOf(gran, key) {
    const k = String(key || '');
    if (gran === 'month') {
        const m = /^(\d{4})-(\d{2})$/.exec(k);
        if (m) return { granularity: 'month', year: Number(m[1]), sub: Number(m[2]) };
    }
    if (gran === 'year' && /^\d{4}$/.test(k)) return { granularity: 'year', year: Number(k), sub: null };
    return null;
}
