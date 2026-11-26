// === js/history-sections.js ===
// 데이터 관리(history.html) 10개 화면 — 좌측 레일(4그룹)과 기존 메인탭·업무 기록 서브탭의 대응표. 의존성 없는 순수 모듈.
// (UI 2단계 H1·H2, 2026-10-16. 테스트: tests/history-sections.test.js)
// 화면 전환 함수는 js/listeners-history-tabs.js showSection, 레일 마크업은 components/modals-history.html #history-section-nav.
// 주소 뒤 해시는 예전 형식(#tab=메인탭&sub=서브탭, js/hash-state.js) 그대로 쓴다 — 옛 주소·Ctrl+K 목적지가 계속 동작한다.
// 2026-11-05 운영 리포트 통합 2단계: 요약·생산성·인력 적정성·업무 리포트·팀 결산·업무 담당 변화 → '운영 리포트'(main ops) 한 화면의 탭.
//   옛 화면은 레일에서 뺐고 LEGACY_SECTIONS 에 남긴다 — 옛 주소는 js/lib/ops-report-route.js 가 운영 리포트 탭으로 바꾼다.
import { OPS_MAIN, legacyTarget } from './lib/ops-report-route.js?v=bc1ec7e463eb-3f6f2065';

export const SECTIONS = {
    ops:          { main: OPS_MAIN,       label: '운영 리포트' },   // 탭: 요약·생산성·인력·비용 + [보고서 만들기] (js/ui-history-ops-report.js)
    personal:     { main: 'rawdata', sub: 'personal',   label: '개인 리포트' },
    forecast:     { main: 'forecast',     label: '업무 예상' },
    prediction:   { main: 'prediction',   label: '물량 추세 예측' },
    work:         { main: 'rawdata', sub: 'work',       label: '업무 이력' },
    attendance:   { main: 'rawdata', sub: 'attendance', label: '근태 이력' },
    inspection:   { main: 'rawdata', sub: 'inspection', label: '검수 이력' },
    leave:        { main: 'rawdata', sub: 'leave',      label: '연차 관리' },
    management:   { main: 'rawdata', sub: 'management', label: '경영 지표' },
    milestones:   { main: 'milestones',   label: '운영 마일스톤' }
};

// 레일에서 빠진 옛 화면 id(옛 코드·기억이 showSection('insight') 처럼 부른다) → 옛 메인탭·서브탭. 이동할 탭은 ops-report-route 가 정한다.
export const LEGACY_SECTIONS = {
    insight:      { main: 'dashboard',    label: '요약' },
    productivity: { main: 'productivity', label: '생산성' },
    staffing:     { main: 'staffing',     label: '인력 적정성' },
    report:       { main: 'rawdata', sub: 'report', label: '업무 리포트' },
    taskowner:    { main: 'taskowner',    label: '업무 담당 변화' },
    settlement:   { main: 'settlement',   label: '팀 결산' }
};

// 화면 아이콘(선 SVG 안쪽만, viewBox 0 0 24 24) — 데이터 관리 2차 메뉴(접힌 레일)와 대시보드 펼침 메뉴가 같이 쓴다(2026-11-26)
export const SECTION_ICONS = {
    ops:        '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    personal:   '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
    forecast:   '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>',
    prediction: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    work:       '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 11h6M9 15h4"/>',
    attendance: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    inspection: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    leave:      '<path d="M3 12a9 9 0 0 1 18 0zM12 12v6a2 2 0 0 0 4 0"/>',
    management: '<path d="M12 3v9h9A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    milestones: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'
};
/** 화면 id → <svg> 글(없으면 '') */
export const sectionIconSvg = (id, cls = 'pn-ico') => SECTION_ICONS[id]
    ? `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SECTION_ICONS[id]}</svg>`
    : '';

export const SECTION_GROUPS = [
    { title: '분석',      ids: ['ops', 'personal'] },
    { title: '예측·계획', ids: ['forecast', 'prediction'] },
    { title: '기록',      ids: ['work', 'attendance', 'inspection', 'leave'] },
    { title: '보고',      ids: ['management', 'milestones'] }
];

// 날짜 트리(기간)를 쓰지 않는 화면 — 업무 예상(미래 기준)·물량 추세 예측(전체 이력)·마일스톤(자체 목록)·검수·연차
// (운영 리포트 안의 팀 결산은 자체 기간 선택이라 트리를 숨긴다 — js/lib/ops-report-route.js isOpsTreeless)
export const TREELESS_MAINS = ['forecast', 'prediction', 'milestones'];
export const TREELESS_SUBS = ['inspection', 'leave'];
export const isTreelessMain = (main, sub) => TREELESS_MAINS.includes(main) || (main === 'rawdata' && TREELESS_SUBS.includes(sub));

/** 메인탭(+서브탭) → 화면 id. 'rawdata' 는 sub 로 고르고, 모르는 sub 면 fallbackSub(없으면 업무 이력). 모르는 메인탭이면 null.
 *  옛 화면(#tab=dashboard, #tab=rawdata&sub=report …)은 'ops'. */
export function sectionIdFor(main, sub, fallbackSub = 'work') {
    if (legacyTarget(main, sub)) return 'ops';
    if (main === 'rawdata') {
        for (const s of [sub, fallbackSub, 'work']) {
            if (s && SECTIONS[s] && SECTIONS[s].main === 'rawdata') return s;
        }
        return 'work';
    }
    for (const [id, s] of Object.entries(SECTIONS)) if (s.main === main && !s.sub) return id;
    return null;
}
