// === js/history-sections.js ===
// 데이터 관리(history.html) 14개 화면 — 좌측 레일(4그룹)과 기존 메인탭·업무 기록 서브탭의 대응표. 의존성 없는 순수 모듈.
// (UI 2단계 H1·H2, 2026-10-16. 테스트: tests/history-sections.test.js)
// 화면 전환 함수는 js/listeners-history-tabs.js showSection, 레일 마크업은 components/modals-history.html #history-section-nav.
// 주소 뒤 해시는 예전 형식(#tab=메인탭&sub=서브탭, js/hash-state.js) 그대로 쓴다 — 옛 주소·Ctrl+K 목적지가 계속 동작한다.

export const SECTIONS = {
    insight:      { main: 'dashboard',    label: '요약' },
    productivity: { main: 'productivity', label: '생산성' },
    staffing:     { main: 'staffing',     label: '인력 적정성' },
    forecast:     { main: 'forecast',     label: '업무 예상' },
    prediction:   { main: 'prediction',   label: '물량 추세 예측' },
    work:         { main: 'rawdata', sub: 'work',       label: '업무 이력' },
    attendance:   { main: 'rawdata', sub: 'attendance', label: '근태 이력' },
    inspection:   { main: 'rawdata', sub: 'inspection', label: '검수 이력' },
    leave:        { main: 'rawdata', sub: 'leave',      label: '연차 관리' },
    report:       { main: 'rawdata', sub: 'report',     label: '업무 리포트' },
    personal:     { main: 'rawdata', sub: 'personal',   label: '개인 리포트' },
    management:   { main: 'rawdata', sub: 'management', label: '경영 지표' },
    settlement:   { main: 'settlement',   label: '팀 결산' },
    milestones:   { main: 'milestones',   label: '운영 마일스톤' }
};

export const SECTION_GROUPS = [
    { title: '분석',      ids: ['insight', 'productivity', 'staffing'] },
    { title: '예측·계획', ids: ['forecast', 'prediction'] },
    { title: '기록',      ids: ['work', 'attendance', 'inspection', 'leave'] },
    { title: '보고',      ids: ['report', 'personal', 'management', 'settlement', 'milestones'] }
];

// 날짜 트리(기간)를 쓰지 않는 화면 — 업무 예상(미래 기준)·물량 추세 예측(전체 이력)·마일스톤(자체 목록)·결산(자체 기간 선택)·검수·연차
export const TREELESS_MAINS = ['forecast', 'prediction', 'milestones', 'settlement'];
export const TREELESS_SUBS = ['inspection', 'leave'];
export const isTreelessMain = (main, sub) => TREELESS_MAINS.includes(main) || (main === 'rawdata' && TREELESS_SUBS.includes(sub));

/** 메인탭(+서브탭) → 화면 id. 'rawdata' 는 sub 로 고르고, 모르는 sub 면 fallbackSub(없으면 업무 이력). 모르는 메인탭이면 null. */
export function sectionIdFor(main, sub, fallbackSub = 'work') {
    if (main === 'rawdata') {
        for (const s of [sub, fallbackSub, 'work']) {
            if (s && SECTIONS[s] && SECTIONS[s].main === 'rawdata') return s;
        }
        return 'work';
    }
    for (const [id, s] of Object.entries(SECTIONS)) if (s.main === main && !s.sub) return id;
    return null;
}
