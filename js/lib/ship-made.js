// === js/lib/ship-made.js ===
// 같은 날 같은 묶음을 또 만드는 실수 막기 — 이 PC(localStorage 'ggsShipMade.v1')에 오늘 만든 묶음만 기억한다(2026-11-12).
//   { day:'YYYY-MM-DD'(KST), items:[{ k, at:'HH:MM', tab, step }] } 최대 40개. 날짜가 바뀌면 비운다.
//   k = tab|step|hash(주 파일) 앞 16자|hash(출고요청) 앞 16자 — 파일 내용 대신 해시만(상품 정보 없음).
//   성공했을 때만 기록한다(부르는 쪽 js/ship.js). 순수 모듈. 테스트: tests/ship-made.test.js

import { kstDay } from './ship-core.js?v=202611121504';

export const MADE_STORE_KEY = 'ggsShipMade.v1';
export const MADE_MAX = 40;
const p2 = (n) => String(n).padStart(2, '0');

/** 한국시간 'HH:MM' */
export function kstHHMM(now = new Date()) {
    const d = new Date((now instanceof Date ? now.getTime() : Number(now)) + 9 * 3600000);
    return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 묶음 표시 키 */
export function madeKey(tab, step, mainHash, requestHash) {
    return [tab, step, String(mainHash || '').slice(0, 16), String(requestHash || '').slice(0, 16)].join('|');
}

/** 저장된 값(글자·객체·아무것) → 오늘 것만 { day, items } */
export function loadMade(raw, now = new Date()) {
    const day = kstDay(now).ymd10;
    let v = raw;
    if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (_) { v = null; } }
    if (!v || typeof v !== 'object' || v.day !== day || !Array.isArray(v.items)) return { day, items: [] };
    const items = v.items.filter(x => x && typeof x.k === 'string' && typeof x.at === 'string'
        && (x.tab === 'zikjin' || x.tab === 'ably') && (x.step === 1 || x.step === 2)).slice(-MADE_MAX)
        .map(x => ({ k: x.k, at: x.at.slice(0, 5), tab: x.tab, step: x.step }));
    return { day, items };
}

/** 오늘 같은 묶음을 만든 기록(가장 늦은 것) 또는 null */
export function findMade(state, k) {
    const items = (state && Array.isArray(state.items)) ? state.items : [];
    for (let i = items.length - 1; i >= 0; i--) if (items[i].k === k) return items[i];
    return null;
}

/** 기록 더하기(같은 k 는 새 시각으로 옮김) → 새 상태 */
export function recordMade(state, { k, tab, step }, now = new Date()) {
    const base = loadMade(state, now);
    const items = base.items.filter(x => x.k !== k);
    items.push({ k, at: kstHHMM(now), tab, step });
    return { day: base.day, items: items.slice(-MADE_MAX) };
}

/** [만들기] 확인 문구 */
export function madeConfirmText(item, { step, transmit } = {}) {
    let s = `${item.at} 에 이미 만든 묶음입니다 — 다시 만들까요?`;
    if (step === 2 && transmit) s += '\n전송이 켜져 있어 이 묶음 몫만 다시 바꿉니다(두 번 더해지지 않음).';
    return s;
}
