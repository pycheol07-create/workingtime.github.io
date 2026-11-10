// === js/lib/ship-mismatch.js ===
// 신규 부족수량관리 — 스캔 입고와 고른(작업) 출고일이 맞는지 본다(2026-11-10 사용자 승인). 순수 모듈(DOM/Firebase 없음).
// 입고 스캔(입고이력)에는 어느 패킹(출고일) 것인지 표시가 없다 — 다른 출고일을 고른 채 [작업 마감]하면 그 스캔이 엉뚱한 출고일 이름으로 보관된다.
// 그래서 스캔한 상품코드가 출고 기록(수집 자료 shipJson items[code].s = [[출고일, 도착일, 수량], …])의 어느 출고일과 가장 많이 겹치는지 찾는다.
//   · 표: '선택 출고일 밖 입고' 행을 빼고 경고 한 줄 + 가장 잘 맞는 출고일([그 출고일로 보기])
//   · [작업 마감]·[스캐너에 반영]: 스캔 상품의 절반을 넘게 출고일에 없으면 막고, 절반 이하면 확인창 맨 위에 경고 한 줄. 스캔 0건이면 아무것도 안 함

const fmtMD = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : String(s || ''); };
const int0 = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

/** 스캔 합 map {code: qty} → 입고가 있는(qty > 0) 상품코드 목록 */
export const scannedCodesOf = (scanMap) => Object.keys(scanMap || {}).filter(c => int0(scanMap[c]) > 0);

/** 상품코드 → 그 코드의 출고일 Set (shipItems[code].s 의 첫 칸) */
function shipDatesOf(item) {
    const out = new Set();
    ((item && Array.isArray(item.s)) ? item.s : []).forEach(e => { if (Array.isArray(e) && e[0]) out.add(String(e[0])); });
    return out;
}

/**
 * 가장 잘 맞는 출고일 — 스캔한 상품코드와 겹치는 상품 수가 가장 많은 날.
 * 동점이면 이미 고른 날(prefer) 우선 → 겹친 스캔 수량이 큰 쪽 → 최근 날짜.
 * @returns {{date, count, qty} | null} 겹치는 날이 없으면 null
 */
export function bestShipOf(scanMap, shipItems, prefer) {
    const pref = new Set((prefer || []).map(String));
    const by = new Map();
    scannedCodesOf(scanMap).forEach(code => {
        shipDatesOf((shipItems || {})[code]).forEach(d => {
            const x = by.get(d) || { date: d, count: 0, qty: 0 };
            x.count++; x.qty += int0(scanMap[code]);
            by.set(d, x);
        });
    });
    const better = (x, b) => {
        if (x.count !== b.count) return x.count > b.count;
        const px = pref.has(x.date), pb = pref.has(b.date);
        if (px !== pb) return px;
        if (x.qty !== b.qty) return x.qty > b.qty;
        return x.date > b.date;
    };
    let best = null;
    by.forEach(x => { if (!best || better(x, best)) best = x; });
    return best;
}

/**
 * 스캔 상품 중 출고일(ships)에 없는 상품.
 * @param {object} o { scanMap {code: qty}, shipItems, ships [출고일] }
 * @returns {{ scanned, outside, outsideCodes, best, bestInShips, block, warn }}
 *   block = 상품 수 기준 절반을 넘게 없음 · warn = 하나라도 없음 · 스캔 0건이면 둘 다 false
 */
export function shipMismatchOf({ scanMap, shipItems, ships }) {
    const set = new Set((ships || []).map(String));
    const scanned = scannedCodesOf(scanMap);
    const outsideCodes = scanned.filter(code => ![...shipDatesOf((shipItems || {})[code])].some(d => set.has(d)));
    const best = bestShipOf(scanMap, shipItems, ships);
    return {
        scanned: scanned.length,
        outside: outsideCodes.length,
        outsideCodes,
        best,
        bestInShips: !!best && set.has(best.date),
        block: scanned.length > 0 && outsideCodes.length * 2 > scanned.length,
        warn: outsideCodes.length > 0
    };
}

/** 경고 한 줄(버튼 글자 없이) — "⚠ 이 출고일에 없는 스캔이 N개 상품 있습니다 — 가장 잘 맞는 출고일: M/D (K개 일치)" */
export function mismatchLine(outsideCount, best, bestInShips) {
    const head = `⚠ 이 출고일에 없는 스캔이 ${outsideCount}개 상품 있습니다`;
    if (!best || bestInShips) return head;
    return `${head} — 가장 잘 맞는 출고일: ${fmtMD(best.date)} (${best.count}개 일치)`;
}

/** 출고일 밖 상품코드 목록 — 최대 max 개 + ' 외 n개' */
export function codeListText(codes, max = 20) {
    const list = (codes || []).map(String).sort();
    if (!list.length) return '';
    return list.slice(0, max).join(', ') + (list.length > max ? ` 외 ${list.length - max}개` : '');
}

/**
 * [작업 마감]·[스캐너에 반영] 막는 안내.
 * opts.jobShips — 마감이 작업 표시(batch)의 출고일로 막힐 때(그 출고일로 반영한 작업이라 출고일만 바꿔서는 풀리지 않는다)
 * opts.admin — 관리자는 '그래도 진행' 2차 확인을 받는다(문구 끝이 질문)
 */
export function mismatchBlockText(m, opts = {}) {
    const head = mismatchLine(m.outside, m.best, m.bestInShips)
        + `\n(스캔한 상품 ${m.scanned}개 중 ${m.outside}개가 이 출고일에 없습니다 — 다른 출고일 패킹의 스캔일 수 있습니다)`
        + (m.outsideCodes && m.outsideCodes.length ? `\n출고일 밖 상품: ${codeListText(m.outsideCodes)}` : '');
    const how = opts.jobShips
        ? `작업 출고일 ${opts.jobShips.map(fmtMD).join(', ')} 기준입니다 — 출고일을 바꾸고 [스캐너에 반영]을 다시 한 뒤 마감하세요.`
        : '출고일을 바꾼 뒤 다시 누르세요.';
    return `${head}\n\n${how}` + (opts.admin ? '\n\n[관리자] 그래도 진행할까요? ([취소] = 아무것도 바꾸지 않음)' : '\n(아무것도 바꾸지 않았습니다)');
}
