// === js/lib/inbound-fix.js ===
// 부족수량관리 '입고확인 수동 수정' — 순수 함수(DOM/Firebase 없음). 2026-11-04. tests/inbound-fix.test.js 가 본다.
//
// 입고확인 = 입고이력(ChinaStockGoods_InboundHistory) barcode 별 qty 합. 스캐너 문서(자동 id)에 더해
// 상품마다 고정 문서 하나(id = 'fix__' + 상품코드)를 둔다:
//   { barcode, qty: 누적 수정량(±정수), kind: 'fix', rev, updatedAt, log: [{ at(ms), by, before, after, d, note }] }  (log 최근 20건)
//   · 'timestamp' 칸은 쓰지 않는다 — live 의 '최근 스캔' 경고(china-mibal2-live.js readInbound)가 timestamp 최댓값을 본다.
//   · 합계를 내는 코드(기존 loadInboundHistory·lib/scan-link.js inboundMapOf·live readInbound)는 barcode·qty 만 보고 음수도
//     그대로 더하므로 입고확인 = 스캔 + 수정이 저절로 맞는다. 미발 초기화·live 작업 마감 때 입고이력과 함께 지워진다.
//   · log 의 d = after − before(입고확인 변화). 스캐너 남은 도착(ScanDB) 쪽 변화는 그 반대(scanDbFixOf 의 d).
// 실제 쓰기는 js/inbound-fix-write.js 한 곳.

export const FIX_PREFIX = 'fix__';
export const FIX_LOG_MAX = 20;

const int0 = (v) => parseInt(v) || 0;

/** 상품코드 → 수정 문서 id */
export function fixIdOf(code) { return FIX_PREFIX + String(code == null ? '' : code); }

/** 문서 id 가 수정 문서인가 */
export function isFixId(id) { return String(id == null ? '' : id).startsWith(FIX_PREFIX); }

/**
 * 입고이력 문서 [{ id, barcode, qty, rev?, log? }] → { map, scan, fix }
 *   map  = barcode 별 qty 합(스캔 + 수정 — 음수·0 합도 키를 남긴다. inboundMapOf 와 같은 합)
 *   scan = 스캔 문서만의 합
 *   fix  = { code: { qty, rev, log } }  (수정 문서 — log 는 받은 그대로, 없으면 [])
 * barcode 가 비면 건너뛴다(기존과 같이 trim 하지 않음).
 */
export function inboundSplitOf(docs) {
    const map = {}, scan = {}, fix = {};
    (docs || []).forEach(d => {
        const x = d || {};
        const code = x.barcode;
        if (!code) return;
        const qty = int0(x.qty);
        map[code] = (map[code] || 0) + qty;
        if (isFixId(x.id)) {
            const f = fix[code] || (fix[code] = { qty: 0, rev: 0, log: [] });
            f.qty += qty;
            f.rev = Math.max(f.rev, int0(x.rev));
            if (Array.isArray(x.log)) f.log = x.log;
        } else {
            scan[code] = (scan[code] || 0) + qty;
        }
    });
    return { map, scan, fix };
}

/** 입고확인 합 서명(같은 합이면 같은 글자) — live '확인창 사이에 바뀌었나' 비교용. 0 합 키도 넣는다 */
export function inboundSig(map) {
    const m = map || {};
    return Object.keys(m).sort().map(k => k + ':' + int0(m[k])).join('|');
}

/**
 * 입력 검사. before = 지금 입고이력 합(정수), after = 칸에 넣은 글자.
 *   → null                          고칠 것 없음(같은 값). 단 legacy=true(입고이력에 이 상품 키가 없고 옛 수동값만 보이던 칸)면
 *                                   같은 값이어도 delta 0 계획을 돌려준다 — 수정 문서가 생겨 입고확인이 그 값으로 고정된다
 *   → { error, silent? }            저장하지 않는다(빈칸은 silent — 알림 없이 되돌림)
 *   → { before, after, delta }      delta = after − before
 * after 는 0 이상 정수만(쉼표는 뺀다). 음수·소수·글자는 안 된다.
 */
export function planFix({ before, after, legacy } = {}) {
    const b = int0(before);
    const s = String(after == null ? '' : after).replace(/,/g, '').trim();
    if (s === '') return { error: '빈칸은 저장하지 않습니다 — 0 이면 0 을 넣으세요.', silent: true };
    if (!/^\d+$/.test(s)) return { error: '입고확인은 0 이상의 정수만 넣을 수 있습니다.' };
    const a = parseInt(s, 10);
    if (!Number.isSafeInteger(a) || a > 1000000) return { error: '수량이 너무 큽니다.' };
    if (a === b) return legacy ? { before: b, after: a, delta: 0 } : null;
    return { before: b, after: a, delta: a - b };
}

/**
 * 스캐너 남은 도착(ScanDB arrivalQty 또는 mibalQty) 새 값.
 *   cur  = 지금 ScanDB 값, base = 그 칸을 만든 기준(도착 또는 피킹 배정 — 모르면 null)
 *   before/after = 입고확인 합(수정 전/후)
 *   d = before − after (입고확인이 줄면 남은 도착이 는다)
 *   cur > 0              → cur + d
 *   cur ≤ 0 이고 base 앎 → min(cur, base − before) + d   (동기화가 0 으로 자른 실제 음수를 되살림)
 *   base 모름            → cur + d
 */
export function scanDbFixOf({ cur, base, before, after } = {}) {
    const c = int0(cur);
    const d = int0(before) - int0(after);
    const known = base !== null && base !== undefined && base !== '' && Number.isFinite(Number(base));
    if (c > 0 || !known) return c + d;
    return Math.min(c, int0(base) - int0(before)) + d;
}

/** ScanDB 문서 두 칸 새 값 { arrivalQty, mibalQty } — base = { arr, mibal } 또는 null */
export function scanDbPairOf({ cur, base, before, after } = {}) {
    const c = cur || {};
    const b = base || {};
    return {
        arrivalQty: scanDbFixOf({ cur: c.arrivalQty, base: base ? b.arr : null, before, after }),
        mibalQty: scanDbFixOf({ cur: c.mibalQty, base: base ? b.mibal : null, before, after })
    };
}

/**
 * 수정 문서 다음 모양(updatedAt 은 쓰는 쪽이 붙인다).
 *   old   = 지금 문서 데이터(없으면 null) · entry = { at, by, before, after, note } · code = 상품코드
 *   qty += after − before · rev + 1 · log 끝에 붙이고 최근 20건만
 */
export function nextFixDoc(old, entry, code) {
    const o = old || {};
    const e = entry || {};
    const d = int0(e.after) - int0(e.before);
    const log = (Array.isArray(o.log) ? o.log : []).concat([{
        at: Number(e.at) || 0, by: String(e.by || ''), before: int0(e.before), after: int0(e.after), d, note: String(e.note || '')
    }]).slice(-FIX_LOG_MAX);
    return { barcode: String(code != null ? code : (o.barcode || '')), qty: int0(o.qty) + d, kind: 'fix', rev: int0(o.rev) + 1, log };
}

/** 툴팁 한 줄 — "스캔 n · 수정 ±m · 11/4 14:05 이름" (마지막 기록이 없으면 날짜·이름 없음) */
export function fixTipOf(scanQty, fix) {
    if (!fix) return '';
    const q = int0(fix.qty);
    const last = Array.isArray(fix.log) && fix.log.length ? fix.log[fix.log.length - 1] : null;
    let when = '';
    if (last && last.at) {
        const t = new Date(Number(last.at));
        const p2 = (n) => String(n).padStart(2, '0');
        when = ` · ${t.getMonth() + 1}/${t.getDate()} ${p2(t.getHours())}:${p2(t.getMinutes())}${last.by ? ' ' + last.by : ''}`;
    }
    return `스캔 ${int0(scanQty)} · 수정 ${q > 0 ? '+' : ''}${q}${when}`;
}

/**
 * 단독 운영(live) 화면의 ScanDB 기준값 — [스캐너에 반영]이 지금 표와 같은 출고일로 만들었을 때만 안다.
 *   batchShips = mibal2/settings.batch.ships(작업 출고일, 없으면 작업 없음) · selected = 지금 고른 출고일
 *   피킹 배정(third)을 모르면 반영 때처럼 도착으로 쓴다(lib/mibal2-live.js scanApplyPlan). '선택 출고일 밖' 행은 모름.
 * → { arr, mibal } | null
 */
export function liveBaseOf({ batchShips, selected, arr, third, outside } = {}) {
    if (outside || !Array.isArray(batchShips) || !batchShips.length) return null;
    const key = (a) => JSON.stringify([...(a || [])].map(String).sort());
    if (key(batchShips) !== key(selected)) return null;
    const a = int0(arr);
    return { arr: a, mibal: third === null || third === undefined ? a : int0(third) };
}

/**
 * 기록하지 않은 이유(writeInboundFix 의 conflict) → 알림 문구
 *   rev   = 그사이 다른 사람이 이 상품 입고확인을 고침
 *   reset = 그사이 입고이력이 비워짐(미발 초기화·작업 마감)
 *   scan  = 그사이 스캔 입고·스캐너 반영으로 스캐너 남은 도착이 바뀜
 */
export function fixConflictText(reason) {
    const head = reason === 'reset' ? '그사이 입고이력이 비워졌습니다(미발 초기화·작업 마감)'
        : reason === 'scan' ? '그사이 스캔·반영이 있었습니다'
        : '그사이 다른 사람이 이 상품의 입고확인을 고쳤습니다';
    return `${head} — 기록하지 않았습니다.\n화면이 새 값을 보여 주면 다시 확인하고 고쳐 주세요.`;
}

/**
 * 확인창 문구.
 *   code, before(서버 합), after, screen(화면에 보이던 값), scanQty, fixQty,
 *   trial(시험 화면) · live(단독 운영) · legacyManual(기존 수동값 — 스캐너에 반영되지 않았던 값, 없으면 '')
 *   scanDb: null(스캐너 자료에 이 상품 없음) | { curArr, newArr, curMibal, newMibal, maybeOff }
 */
export function fixConfirmText(o = {}) {
    const n = (v) => Number(v || 0).toLocaleString();
    const sign = (v) => (v > 0 ? '+' : '') + n(v);
    const lines = [`[${o.code}] 입고확인을 고칠까요?`, ''];
    lines.push(`· 입고확인 ${n(o.before)} → ${n(o.after)} (${sign(int0(o.after) - int0(o.before))})`);
    lines.push(`  (스캔 ${n(o.scanQty)} · 지금까지 수정 ${sign(int0(o.fixQty))})`);
    const scr = String(o.screen == null ? '' : o.screen).trim();
    if (o.legacyManual !== undefined && o.legacyManual !== null && String(o.legacyManual).trim() !== '') {
        lines.push(`· 기존 수동값 ${String(o.legacyManual).trim()} 은 스캐너에 반영되지 않았던 값입니다 — 입고이력 합(${n(o.before)}) 기준으로 고칩니다.`);
    } else if (scr !== '' && scr !== String(int0(o.before)) && /^-?\d+$/.test(scr)) {
        lines.push(`· ⚠ 화면을 그린 뒤 입고가 바뀌었습니다(화면 ${scr} → 지금 ${n(o.before)}) — 지금 값 기준으로 고칩니다.`);
    }
    if (o.scanDb) {
        const s = o.scanDb;
        lines.push(`· 스캐너 남은 도착 ${n(s.curArr)} → ${n(s.newArr)} · 남은 미발 ${n(s.curMibal)} → ${n(s.newMibal)}`);
        if (s.maybeOff) lines.push(o.live
            ? '  ⚠ 스캐너 남은 도착이 0 이하라 정확하지 않을 수 있습니다 — [스캐너에 반영]을 다시 누르면 맞춰집니다.'
            : '  ⚠ 스캐너 남은 도착이 0 이하라 정확하지 않을 수 있습니다 — 기존 화면을 열면 맞춰집니다.');
    } else {
        lines.push('· 스캐너 자료에 이 상품이 없어 입고이력만 고칩니다.');
    }
    lines.push('· 비축창고 수량은 바뀌지 않습니다.');
    lines.push('· 스캐너에 아직 안 보낸 입고는 빠진 값입니다(보낸 뒤에는 그만큼 더해집니다).');
    if (o.trial) lines.push('', '⚠ 시험 화면이지만 이 수정은 운영 자료(입고이력·스캐너 남은 도착)에 바로 기록되고 기존 부족수량 관리 화면에도 똑같이 보입니다.');
    return lines.join('\n');
}
