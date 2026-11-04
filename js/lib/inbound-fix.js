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
    const map = {}, scan = {}, fix = {}, probe = {};
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
            if (!probe[code] && x.id) probe[code] = String(x.id);   // 스캔 문서 id 하나 — 대기 항목에 적어 두고 [저장] 때 아직 있는지 본다
        }
    });
    return { map, scan, fix, probe };
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
    if (o.trial) lines.push('', TRIAL_WARN);
    return lines.join('\n');
}

const TRIAL_WARN = '⚠ 시험 화면이지만 이 수정은 운영 자료(입고이력·스캐너 남은 도착)에 바로 기록되고 기존 부족수량 관리 화면에도 똑같이 보입니다.';

// ── 여러 칸 고친 뒤 한 번에 [저장] (2026-11-04 사용자 요청) ──────────────────────────
// 대기 값 pending = { code: { after(정수), shown(칸에 보이던 서버 값 글자), at(ms), reason?(지난 저장 때 못 쓴 이유) } }
// 표 자료와 따로 둔다 — 칸을 그릴 때 대기 값을 덧칠한다. 일치색·차이 칸은 서버 값 기준 그대로.

/**
 * 칸에서 나갈 때 대기 값 넣기. text = 칸 글자, shown = 서버 값으로 보이던 글자.
 *   같은 값(shown 과 같음)·빈칸 → 대기에서 뺌(removed) · 글자·음수·소수 → error(대기 그대로)
 * → { pending(새 객체), error?, removed? }
 */
export function pendingSet(pending, code, text, shown, at, base) {
    const p = { ...(pending || {}) };
    const s = String(text == null ? '' : text).replace(/,/g, '').trim();
    const sh = String(shown == null ? '' : shown).trim();
    if (s === '' || s === sh) { const had = code in p; delete p[code]; return { pending: p, removed: had }; }
    const chk = planFix({ before: -1, after: s });   // 검사만(before 는 쓰지 않는 값)
    if (chk && chk.error) return { pending: pending || {}, error: chk.error };
    const a = parseInt(s, 10);
    if (p[code] && p[code].after === a) return { pending: pending || {} };   // 같은 값 — 처음 고칠 때의 원래 값·기준·지난 이유 그대로
    // base = 고칠 때 본 입고이력 기준 { probe(스캔 문서 id 하나 — 없으면 ''), rev(수정 문서 rev) } — [저장] 때 비워졌는지 본다(batchRowsOf)
    const b = base || {};
    p[code] = { after: a, shown: sh, at: Number(at) || 0, probe: String(b.probe || ''), rev: int0(b.rev) };
    return { pending: p };
}

/**
 * 대기 항목이 고친 뒤 입고이력이 비워졌는지(미발 초기화·작업 마감 — 다른 탭·다른 PC 포함).
 *   probe 가 있으면 서버 스캔 문서 id 목록(srv.scanIds)에 아직 있어야 하고, 없으면(스캔 없던 상품) 수정 문서 rev 가 줄면 비워진 것
 */
export function pendingReset(pd, srv) {
    const x = pd || {}, s = srv || {};
    if (x.probe) return !(Array.isArray(s.scanIds) && s.scanIds.includes(x.probe));
    return int0(s.rev) < int0(x.rev);
}

/**
 * 대기 + 서버에서 새로 읽은 값 → 저장할 줄.
 *   srvByCode = { code: readServerInbound 결과 } · legacy = { code: 옛 수동값 글자 }(입고이력에 키가 없던 칸)
 *   → { rows: [{ code, before, after, delta, shown, warn, legacy, srv }], same: [code], reset: [code] }
 *   warn = 칸에 보이던 값 ≠ 지금 서버 합(그사이 스캔 등) · same = 서버 합이 이미 대기 값과 같음('이미 같음' — 대기에서 뺀다)
 *   reset = 고친 뒤 입고이력이 비워짐(pendingReset — 미발 초기화·작업 마감, 다른 탭·PC 포함) → 기록하지 않고 대기에서 뺀다
 *   옛 수동값은 서버에 이 상품 기록이 하나도 없을 때만 같은 값이어도 기록한다(planFix legacy)
 */
export function batchRowsOf(pending, srvByCode, legacy) {
    const rows = [], same = [], reset = [];
    Object.keys(pending || {}).sort().forEach(code => {
        const pd = pending[code] || {};
        const srv = (srvByCode || {})[code];
        if (!srv) return;
        if (pendingReset(pd, srv)) { reset.push(code); return; }
        const lg = legacy && legacy[code] ? String(legacy[code]) : '';
        const useLegacy = !!lg && int0(srv.sum) === 0 && !srv.rev && !srv.scan;
        const plan = planFix({ before: srv.sum, after: pd.after, legacy: useLegacy });
        if (!plan) { same.push(code); return; }
        if (plan.error) return;
        const shown = String(pd.shown == null ? '' : pd.shown);
        rows.push({ code, before: plan.before, after: plan.after, delta: plan.delta, shown,
            warn: !useLegacy && shown !== String(plan.before), legacy: useLegacy ? lg : '', srv });
    });
    return { rows, same, reset };
}

/**
 * 묶음 저장 확인창. rows = batchRowsOf 의 rows(+ maybeOff: 스캐너 남은 도착이 0 이하라 정확하지 않을 수 있음)
 *   o = { rows, same(이미 같음 수), reset(비워져 뺀 수), trial, live, max(보여 줄 줄 수, 기본 15) }
 *   살펴볼 줄(⚠ 그사이 바뀜·옛 수동값·남은 도착 0 이하)을 먼저 보여 준다 — '외 n건' 에 숨지 않게
 */
export function batchConfirmText(o = {}) {
    const rows = o.rows || [];
    const max = o.max || 15;
    const n = (v) => Number(v || 0).toLocaleString();
    const sign = (v) => (v > 0 ? '+' : '') + n(v);
    const flagged = (r) => !!(r.warn || r.legacy || r.maybeOff);
    const ordered = rows.filter(flagged).concat(rows.filter(r => !flagged(r)));
    const warnN = rows.filter(r => r.warn).length;
    const lines = [`입고확인 ${n(rows.length)}건을 기록할까요?`];
    if (warnN) lines.push(`⚠ 그사이 바뀐 상품 ${n(warnN)}건 — 화면에 보이던 값과 지금 값이 다릅니다(아래 ⚠ 줄)`);
    lines.push('');
    ordered.slice(0, max).forEach(r => {
        let t = `· [${r.code}] ${n(r.before)} → ${n(r.after)} (${sign(r.delta)})`;
        if (r.legacy) t += ` — 기존 수동값 ${r.legacy} 은 스캐너에 반영되지 않았던 값(입고이력 0 기준)`;
        else if (r.warn) t += ` — ⚠ 화면 ${r.shown === '' ? '빈칸' : r.shown} → 지금 ${n(r.before)}`;
        if (r.maybeOff) t += ' — 스캐너 남은 도착 0 이하';
        lines.push(t);
    });
    if (ordered.length > max) lines.push(`  … 외 ${n(ordered.length - max)}건`);
    if (o.same) lines.push(`· 이미 같은 값 ${n(o.same)}건은 대기에서 뺍니다.`);
    if (o.reset) lines.push(`· ⚠ 고친 뒤 입고이력이 비워진(미발 초기화·작업 마감) ${n(o.reset)}건은 기록하지 않고 대기에서 뺍니다.`);
    lines.push('');
    const withSd = rows.filter(r => r.srv && r.srv.scanDb).length;
    if (withSd) lines.push(`· 스캐너 남은 도착도 함께 맞춥니다(${n(withSd)}건). 스캐너 자료에 없는 ${n(rows.length - withSd)}건은 입고이력만 고칩니다.`);
    else lines.push('· 스캐너 자료에 없는 상품이라 입고이력만 고칩니다.');
    const off = rows.filter(r => r.maybeOff).length;
    if (off) lines.push(o.live
        ? `  ⚠ 스캐너 남은 도착이 0 이하인 ${n(off)}건은 정확하지 않을 수 있습니다 — [스캐너에 반영]을 다시 누르면 맞춰집니다.`
        : `  ⚠ 스캐너 남은 도착이 0 이하인 ${n(off)}건은 정확하지 않을 수 있습니다 — 기존 화면을 열면 맞춰집니다.`);
    lines.push('· 비축창고 수량은 바뀌지 않습니다.');
    lines.push('· 스캐너에 아직 안 보낸 입고는 빠진 값입니다(보낸 뒤에는 그만큼 더해집니다).');
    lines.push('· 건마다 따로 기록합니다 — 그사이 바뀐 상품은 기록하지 않고 대기에 남깁니다.');
    if (o.trial) lines.push('', TRIAL_WARN);
    return lines.join('\n');
}

/**
 * 건마다 차례로 기록. writeFn(item) → { ok, conflict? }(writeInboundFix 결과) · onProgress(done, total)
 * 한 건이 실패(충돌·오류)해도 나머지는 계속한다.
 * → { ok: [code], failed: { code: 'rev'|'reset'|'scan'|'error' }, results: { code: 결과 } }
 */
export async function runBatch(items, writeFn, onProgress) {
    const list = items || [];
    const ok = [], failed = {}, results = {};
    for (let i = 0; i < list.length; i++) {
        const it = list[i];
        try {
            const res = await writeFn(it);
            results[it.code] = res;
            if (res && res.ok) ok.push(it.code);
            else failed[it.code] = (res && res.conflict) || 'error';
        } catch (e) {
            failed[it.code] = 'error';
            results[it.code] = { ok: false, error: e };
        }
        if (onProgress) { try { onProgress(i + 1, list.length); } catch (e) { /* 표시 실패는 무시 */ } }
    }
    return { ok, failed, results };
}

/** 실패 이유 → 칸 툴팁·결과에 붙일 짧은 말 */
export function failReasonText(reason) {
    return reason === 'rev' ? '그사이 다른 사람이 고침'
        : reason === 'reset' ? '그사이 입고이력이 비워짐'
        : reason === 'scan' ? '그사이 스캔·반영이 있었음'
        : '기록 오류';
}

/** 대기 남은 줄에 실패 이유 붙이기 · 성공한 줄·이미 같은 줄·입고이력이 비워진 줄(reset — 지난 작업 기준이라 새 작업에 쓰면 안 됨)은 뺀다 → 새 pending */
export function pendingAfterBatch(pending, { ok, failed, same } = {}) {
    const p = { ...(pending || {}) };
    (ok || []).forEach(c => { delete p[c]; });
    (same || []).forEach(c => { delete p[c]; });
    Object.keys(failed || {}).forEach(c => {
        if (failed[c] === 'reset') delete p[c];
        else if (p[c]) p[c] = { ...p[c], reason: failed[c] };
    });
    return p;
}

/** 실패 목록 줄(알림용) — reset 은 대기에서 뺐다고 적는다 */
export function failLinesOf(failed, max = 15) {
    const codes = Object.keys(failed || {});
    const lines = codes.slice(0, max).map(c => `· [${c}] ${failReasonText(failed[c])}${failed[c] === 'reset' ? ' — 대기에서 뺐습니다' : ''}`);
    if (codes.length > max) lines.push(`… 외 ${codes.length - max}건`);
    return lines.join('\n');
}

/** 결과 한 줄 — '저장 n건 · 다시 확인 m건 · 이미 같음 k건'(0 건 항목은 뺌, 다 0 이면 '바뀐 것 없음') */
export function batchResultText({ saved, failed, same } = {}) {
    const parts = [];
    if (saved) parts.push(`저장 ${saved}건`);
    if (failed) parts.push(`다시 확인 ${failed}건`);
    if (same) parts.push(`이미 같음 ${same}건`);
    return parts.length ? parts.join(' · ') : '바뀐 것 없음';
}
