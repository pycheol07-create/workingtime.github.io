// === js/hangul-search.js ===
// Ctrl+K 빠른 이동(js/app-shell.js)의 검색 점수. 의존성 없는 순수 모듈(테스트: tests/quick-nav.test.js).
//   자음만 치면 초성 비교('ㄹㅋ' → 로케이션 관리), 아니면 공백을 빼고 대소문자 무시 부분 일치('로케').
//   앞쪽에서 맞을수록, 이름(label)에서 맞을수록 점수가 높다. 0 이면 안 맞음.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CONSONANTS_ONLY = /^[ㄱ-ㅎ]+$/;

/** 글자마다 초성으로 바꾼다(한글 음절이 아니면 그대로). '로케이션' → 'ㄹㅋㅇㅅ' */
export function chosung(s) {
    let out = '';
    for (const ch of String(s || '')) {
        const c = ch.charCodeAt(0);
        out += (c >= 0xAC00 && c <= 0xD7A3) ? CHO[Math.floor((c - 0xAC00) / 588)] : ch;
    }
    return out;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

function fieldScore(q, text, weight, initials) {
    const t = norm(text);
    if (!t) return 0;
    const hay = initials ? chosung(t) : t;
    const i = hay.indexOf(q);
    if (i < 0) return 0;
    return weight * 100 + (i === 0 ? 50 : 0) - Math.min(i, 40) + (q.length === hay.length ? 10 : 0);
}

/** 검색어 q 와 항목의 점수. label(이름) > parent(속한 화면) > keywords 순으로 무게를 둔다. q 가 비면 1. */
export function score(q, label, keywords = [], parent = '') {
    const nq = norm(q);
    if (!nq) return 1;
    const initials = CONSONANTS_ONLY.test(nq);
    let best = fieldScore(nq, label, 3, initials);
    best = Math.max(best, fieldScore(nq, parent, 2, initials));
    for (const k of (keywords || [])) best = Math.max(best, fieldScore(nq, k, 1, initials));
    return best;
}

/** 항목 목록을 점수순으로(같으면 원래 순서). 안 맞는 것은 뺀다. */
export function rank(q, items) {
    return (items || [])
        .map((it, i) => ({ it, i, s: score(q, it.label, it.keywords, it.parent) }))
        .filter(x => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (a.i - b.i))
        .map(x => x.it);
}
