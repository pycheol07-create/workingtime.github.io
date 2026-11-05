// js/lib/member-title.js — 직책(2026-11-05)
// 직급(memberRanks: 사원·대리…)과 별개로 맡은 자리(memberPositions)를 둔다.
// 직책은 정해진 4가지 중 하나(사용자 결정 2026-11-05) — 저장값이 없거나 목록 밖이면 '사원'.
// DOM·Firebase 를 import 하지 않는다(tests/member-title.test.js).

export const POSITIONS = ['사원', '파트장', '부팀장', '팀장'];
export const DEFAULT_POSITION = '사원';

/** 직책 값 정리 — 목록에 있는 값만, 아니면 '사원' */
export function cleanPosition(v) {
    const s = String(v == null ? '' : v).trim();
    return POSITIONS.includes(s) ? s : DEFAULT_POSITION;
}

/** config 에서 그 사람의 직책(없으면 '사원') */
export function positionOf(config, name) {
    return cleanPosition(config && config.memberPositions && config.memberPositions[name]);
}

/** 인사말용 이름 — '홍길동 팀장' */
export function nameWithPosition(config, name) {
    const n = String(name || '');
    return n ? `${n} ${positionOf(config, n)}` : n;
}

/** 직원 관리 창 제목 — '홍길동 대리 · 팀장' (직급과 직책이 같으면 한 번만) */
export function nameWithRankPosition(config, name) {
    const n = String(name || '');
    const r = String((config && config.memberRanks && config.memberRanks[n]) || '').trim();
    const p = positionOf(config, n);
    const head = r ? `${n} ${r}` : n;
    return p && p !== r ? `${head} · ${p}` : head;
}
