// js/lib/member-title.js — 직책(2026-11-05)
// 직급(memberRanks: 사원·대리…)과 별개로 맡은 자리(memberPositions: 팀장·파트장…)를 둔다. 비어 있으면 직책 없음.
// DOM·Firebase 를 import 하지 않는다(tests/member-title.test.js).

export const POSITION_SUGGESTIONS = ['팀장', '파트장', '센터장', '실장', '본부장', '조장', '반장'];

/** 직책 문자열 정리 — 앞뒤 공백 제거, 20자까지 */
export function cleanPosition(v) {
    return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, 20);
}

/** config 에서 그 사람의 직책('' = 없음) */
export function positionOf(config, name) {
    return cleanPosition(config && config.memberPositions && config.memberPositions[name]);
}

/** 인사말용 이름 — '홍길동 팀장' (직책 없으면 '홍길동') */
export function nameWithPosition(config, name) {
    const n = String(name || '');
    const p = positionOf(config, n);
    return p ? `${n} ${p}` : n;
}

/** 직원 관리 창 제목 — '홍길동 대리 · 팀장' (없는 칸은 뺀다) */
export function nameWithRankPosition(config, name) {
    const n = String(name || '');
    const r = String((config && config.memberRanks && config.memberRanks[n]) || '').trim();
    const p = positionOf(config, n);
    return [r ? `${n} ${r}` : n, p].filter(Boolean).join(' · ');
}
