// === js/lib/ops-report-route.js ===
// 운영 리포트(데이터 관리 '분석' 화면 하나) — 탭 목록·탭 권한·옛 주소 이동표. 의존성 없는 순수 모듈.
//   2026-11-05 통합 2단계: 옛 화면 6개(요약·생산성·인력 적정성·업무 리포트·팀 결산·업무 담당 변화)를 레일에서 뺐다.
//   2026-11-05 내용 통합(3단계): 탭 5 → 4(요약·생산성·인력·비용) + [보고서 만들기](팀 결산). 옛 '업무별' 탭은 생산성으로 —
//     업무 표(시간·처리 속도, 금액 없음)는 생산성 탭 안, 인건비가 보이는 상세 표는 생산성 탭의 '상세 표' 펼침(data.reports),
//     업무 담당 변화는 업무 표 행을 누르면 뜨는 업무 상세 화면.
//   옛 주소(#tab=dashboard, #tab=rawdata&sub=report, #tab=settlement, #tab=ops&sub=tasks …)·저장해 둔 화면 기억·Ctrl+K 옛 목적지는 여기서 바꾼다.
//   2026-11-05 운영 계획 MVP-1: 탭 'plan'(운영 계획 — 다음 주 주간 계획서, data.analysis)을 맨 뒤에 더했다. 날짜 트리를 안 쓴다(isOpsTreeless).
//   쓰는 곳: js/view-state.js(해시·기억 복원), js/listeners-history-tabs.js(showSection), js/ui-history-ops-report.js(탭 그리기).
//   테스트: tests/ops-report-route.test.js

export const OPS_MAIN = 'ops';
/** 운영 계획 탭 — 날짜 트리를 숨기고 자기 기간(다음 주)으로 그린다 */
export const PLAN_TAB = 'plan';

// 탭 순서 = 화면 순서
export const OPS_TABS = ['summary', 'productivity', 'staffing', 'cost', 'plan'];
export const OPS_TAB_LABELS = {
    summary: '요약', productivity: '생산성', staffing: '인력', cost: '비용', plan: '운영 계획'
};
// 탭 권한(js/lib/feature-catalog.js 의 기능 id). 비용(인건비·원가·손실 금액)은 data.reports, 나머지는 data.analysis(운영 계획은 시간·인원만 — 금액 없음).
export const OPS_TAB_FEATURE = {
    summary: 'data.analysis', productivity: 'data.analysis', staffing: 'data.analysis', cost: 'data.reports', plan: 'data.analysis'
};
/** [보고서 만들기](팀 결산)·생산성 탭의 '상세 표'(인건비 열) — 금액이 보이므로 data.reports */
export const SETTLE_FEATURE = 'data.reports';
export const DETAIL_FEATURE = 'data.reports';
/** 업무 상세의 '담당 변화'(직원 이름·사람별 UPH) — 사람별 숫자가 보이므로 data.reports(옛 업무 담당 변화 화면과 같음) */
export const OWNER_FEATURE = 'data.reports';
/** 생산성 탭의 업무 표(시간·처리 속도, 금액 없음) — 데이터 관리 입장 권한이면 보인다(2026-11-05 사용자 결정) */
export const TASK_TABLE_FEATURE = 'data.view';

/** 없어진 탭 이름 → 지금 탭 (#tab=ops&sub=tasks — 통합 2단계 주소·기억) */
export const SUB_ALIAS = { tasks: 'productivity' };

// 옛 화면 → 운영 리포트. 키는 'main' 또는 'main/sub'.
//   settle: [보고서 만들기](팀 결산 화면, 자체 기간 선택) · detail: 생산성 탭 '상세 표' 펼침 · owner: 업무 상세(담당 변화) 화면.
export const LEGACY_REDIRECTS = {
    'dashboard':      { sub: 'summary' },
    'productivity':   { sub: 'productivity' },
    'staffing':       { sub: 'staffing' },
    'rawdata/report': { sub: 'productivity', detail: 'tables' },
    'settlement':     { sub: 'cost', settle: '1' },
    'taskowner':      { sub: 'productivity', owner: '1' }
};

/** 옛 화면이면 이동할 곳({ sub, settle?, detail?, owner? }), 아니면 null. */
export function legacyTarget(main, sub) {
    if (!main) return null;
    const r = LEGACY_REDIRECTS[main === 'rawdata' ? `rawdata/${sub || ''}` : main];
    return r ? { ...r } : null;
}

/** 탭 이름 → 지금 탭 이름(없어진 탭은 SUB_ALIAS 로). */
export const tabOf = (sub) => (sub && SUB_ALIAS[sub]) || sub;

/** 화면 상태({ main, sub, gran, dateKey, fview, settle, detail, owner }) → 옛 화면·없어진 탭이면 바꾼 사본, 아니면 그대로.
 *  기간(gran·dateKey)은 넘긴다. 팀 결산·업무 담당 변화는 날짜 트리를 안 써서 옛 주소에 날짜가 없다. */
export function redirectView(v) {
    if (!v || !v.main) return v;
    if (v.main === OPS_MAIN) {
        if (!v.sub || !SUB_ALIAS[v.sub]) return v;
        return { ...v, sub: SUB_ALIAS[v.sub] };
    }
    const t = legacyTarget(v.main, v.sub);
    if (!t) return v;
    const out = { ...v, main: OPS_MAIN, sub: t.sub };
    delete out.settle; delete out.owner; delete out.detail; delete out.fview;
    if (t.settle) out.settle = t.settle;
    if (t.detail) out.detail = t.detail;
    if (t.owner) out.owner = t.owner;
    return out;
}

/** 이 사람이 볼 수 있는 탭(순서 유지). can = (기능 id) => boolean */
export function allowedTabs(can) {
    const ok = typeof can === 'function' ? can : () => false;
    return OPS_TABS.filter(t => !!ok(OPS_TAB_FEATURE[t]));
}

/** 열 탭 고르기 — 없어진 탭은 지금 이름으로, 모르는 탭·권한 없는 탭이면 요약(요약도 못 보면 볼 수 있는 첫 탭, 하나도 없으면 null). */
export function pickTab(want, allowed) {
    const list = Array.isArray(allowed) ? allowed : [];
    const w = tabOf(want);
    if (w && list.includes(w)) return w;
    if (list.includes('summary')) return 'summary';
    return list[0] || null;
}

/** 팀 결산([보고서 만들기])을 열 수 있나 — 비용 탭과 같은 권한. */
export const canSettle = (can) => typeof can === 'function' && !!can(SETTLE_FEATURE);
/** 생산성 탭 '상세 표'(인건비 열)를 볼 수 있나. */
export const canDetail = (can) => typeof can === 'function' && !!can(DETAIL_FEATURE);
/** 업무 상세의 담당 변화(직원 이름)를 볼 수 있나. */
export const canOwner = (can) => typeof can === 'function' && !!can(OWNER_FEATURE);
/** 생산성 탭 업무 표(금액 없음)를 볼 수 있나. */
export const canTaskTable = (can) => typeof can === 'function' && !!can(TASK_TABLE_FEATURE);

/** 날짜 트리를 안 쓰는 상태인가 — 팀 결산(자체 월·분기·년 선택)과 운영 계획(다음 주 고정). 업무 상세의 담당 변화는 최근 13개월을 따로 본다(문구로 알림). */
export const isOpsTreeless = (v) => !!(v && v.main === OPS_MAIN && (String(v.settle || '') === '1' || tabOf(v.sub) === PLAN_TAB));

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
