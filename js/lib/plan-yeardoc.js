// === js/lib/plan-yeardoc.js ===
// 운영 계획 v2 D2 — 연간 계획서(문서형) 장 목록 + 사람이 쓰는 장별 문장(OpsPlan/yearDoc_YYYY) 정리·이름 검사 + 목표 연결 문서(OpsPlan/goals_YYYY) 정리.
//   장별 문장: 12장 이하, 장마다 1,000자 이하. 저장 전 namesLeak(plan-skills)로 직원 이름이 보이면 거부한다(어느 이름인지는 돌려주지 않음 — 장 id 만).
//     거래처 실명은 앱이 판별할 수 없어 화면 안내('거래처는 코드로만')로만 막는다.
//   목표 연결: kpis{ qtyPerDay|uph|oee|fillRate|effPct : { year, q1..q4, m01..m12 } }, mode 'auto'|'manual'. 있으면 targets 보다 우선(plan-quarter).
//   금액 없음(목표에 금액 칸 없음 — 인건비율·원가 목표는 관리자 adminPrivate 쪽).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-season.test.js

import { namesLeak } from './plan-skills.js?v=202611111506';

export const YEARDOC_SECTIONS = Object.freeze([
    { id: 's01', title: '작년 돌아보기' }, { id: 's02', title: '시즌 캘린더' }, { id: 's03', title: '수요 전망' },
    { id: 's04', title: '목표 KPI 연결' }, { id: 's05', title: '인력(월별 정원·채용·교육)' }, { id: 's06', title: '개선 과제' },
    { id: 's07', title: '자동화 로드맵' }, { id: 's08', title: '데이터 관리 과제' }, { id: 's09', title: '예산(관리자)', noText: true },
    { id: 's10', title: '위험' }, { id: 's11', title: '실행 일정(분기)' }, { id: 's12', title: '점검 리듬' }
]);
export const YEARDOC_TEXT_MAX = 1000;
/** 문장을 받는 장 — 9장(예산)은 받지 않는다(yearDoc 은 분석 권한 직원도 읽는다 — 금액 문장이 새지 않게, 규칙도 거부) */
export const YEARDOC_TEXT_IDS = Object.freeze(YEARDOC_SECTIONS.filter(s => !s.noText).map(s => s.id));
export const GOAL_METRICS = Object.freeze(['qtyPerDay', 'uph', 'oee', 'fillRate', 'effPct']);
export const GOAL_SLOTS = Object.freeze(['year', 'q1', 'q2', 'q3', 'q4', ...Array.from({ length: 12 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`)]);

/**
 * 장별 문장 정리 + 이름 검사.
 * @param {object} sections { s01: '…', … } (모르는 장·빈 문자열은 버림, 1,000자로 자름)
 * @param {Array}  names    직원 이름(메모리 — 팀 명부·기록 이름)
 * @returns {{ ok:boolean, sections:object, leaks:string[] }} leaks = 이름이 보인 장 id(이름 자체는 담지 않음)
 */
export function cleanYearDocSections(sections, names = []) {
    const ids = new Set(YEARDOC_TEXT_IDS);
    const out = {};
    const leaks = [];
    Object.entries(sections || {}).forEach(([id, t]) => {
        if (!ids.has(id)) return;
        const text = String(t == null ? '' : t).replace(/\r\n/g, '\n').trim().slice(0, YEARDOC_TEXT_MAX);
        if (!text) return;
        if (namesLeak(text, names)) leaks.push(id);
        out[id] = text;
    });
    return { ok: leaks.length === 0, sections: out, leaks };
}

/** 목표 연결 문서 정리 — 아는 지표·칸·숫자만 */
export function cleanGoals(input) {
    const o = input || {};
    const kpis = {};
    GOAL_METRICS.forEach(m => {
        const src = o.kpis && o.kpis[m];
        if (!src || typeof src !== 'object') return;
        const row = {};
        GOAL_SLOTS.forEach(s => { const v = Number(src[s]); if (src[s] != null && src[s] !== '' && Number.isFinite(v) && v >= 0 && v <= 1e7) row[s] = Math.round(v * 100) / 100; });
        if (Object.keys(row).length) kpis[m] = row;
    });
    return { v: 1, year: Number(o.year) || null, mode: o.mode === 'manual' ? 'manual' : 'auto', kpis };
}
