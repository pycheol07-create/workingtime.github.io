// === js/lib/ops-supplies.js ===
// 운영 리포트 '비품' 탭·팀 결산 '비품' 장(2026-11-27) — 기간 비품 사용·입고·현재고·예측·발주 숫자를 한 번에 만든다(순수, import 는 순수 모듈만).
//   읽기·캐시는 js/ops-supplies-store.js, 그리기는 js/ui-ops-supplies.js(탭)·js/ui-history-settlement.js(결산).
//   시험: tests/ops-supplies.test.js
//
// 자료(앱 기준 전환 2026-11-27 — 재고는 원장)
//   원장 suppliesLedger { itemId, kind in/out/count/revert, qty(부호 있음), at, ref? } — 기간만 읽어 온다(날짜 범위·limit)
//   재고 suppliesStock { itemId: qty } · 비품 목록 persistent_data/supplies items[] (name·category·unit·safetyStock·unitPrice·logs)
//   스위치 persistent_data/suppliesSettings { ledgerLive, liveAt } · 발주 persistent_data/suppliesOrders { orders, log }
//   예측 integrations/suppliesForecast { generatedAt, today, items }
// 기준
//   켜짐(ledgerLive) — 켠 시각(liveAt) 뒤는 원장, 그 전은 item.logs(전환 전 이지어드민 이력, 비품당 최근 30건)로 보충.
//   꺼짐 — item.logs 만(원장은 보지 않는다).
//   실사(count)는 사용·입고가 아니다(맞춤 건수·증감만). 되돌림(revert)은 원 기록이 같은 기간에 있으면 둘 다 뺀다,
//   원 기록이 기간 밖이면 건너뛰고 건수만 알린다.
//   수량 합계는 비품마다 단위가 달라 참고값 — 금액(단가 × 수량, 비용 권한일 때만)이 단위와 상관없는 합계다.
// ⚠️ 공급처 이름(vendor)·연락처는 모델에 넣지 않는다(단가와 같은 화면·보고서에 두지 않기 — 업무자동화 CLAUDE.md 3절).

import { atMs, isLive, isLowBy, stockOf } from './supplies-mode.js?v=5f016d6adc90-90c9a625';
import {
    effectiveStatus, forecastOpts, statusBadge, depleteText, depleteSortValue, reorderText, recommendText, isStale, kstToday
} from './supplies-forecast-view.js?v=c308b964945e-6e807d3e';

export const SUPPLIES_FEATURE = 'data.analysis';   // 데이터 관리 안 탭 = 데이터 관리 권한(11/27 사용자 결정). 원장 읽기 규칙은 등록 직원
/** 원장 한 번에 읽는 상한 — 넘으면 화면에 '일부만' 표시 */
export const LEDGER_MAX = 3000;
/** item.logs 보관 개수(js/supplies.js MAX_LOG · 비품재고연동 연동.py MAX_LOG 와 같음) */
export const OLD_LOG_MAX = 30;
export const TOP_N = 10;

const KST = 9 * 3600 * 1000;
const DAY = 86400000;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad = (n) => String(n).padStart(2, '0');
const ymdUtc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcOf = (ymd) => { const m = YMD.exec(String(ymd || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
export const addDays = (ymd, n) => { const t = utcOf(ymd); return Number.isFinite(t) ? ymdUtc(t + n * DAY) : ''; };
/** 두 날짜 사이 달력일(둘 다 포함). 못 읽으면 0 */
export const daysIncl = (a, b) => { const x = utcOf(a), y = utcOf(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / DAY) + 1 : 0; };

/** 시각 값(Timestamp·ISO·ms) → 한국 날짜 'YYYY-MM-DD'. 못 읽으면 '' */
export function kstDayOf(v) {
    const ms = atMs(v);
    return Number.isFinite(ms) ? ymdUtc(ms + KST) : '';
}

/** 운영 리포트 기간 키(일 'YYYY-MM-DD' · 주 'YYYY-Www'(ISO) · 월 'YYYY-MM' · 년 'YYYY') → { from, to }. 못 읽으면 null */
export function periodBounds(gran, key) {
    const k = String(key || '');
    if (gran === 'day' && YMD.test(k)) return { from: k, to: k };
    if (gran === 'week') {
        const m = /^(\d{4})-W(\d{2})$/.exec(k);
        if (!m) return null;
        const jan4 = Date.UTC(+m[1], 0, 4);
        const dow = (new Date(jan4).getUTCDay() + 6) % 7;   // 월=0
        const mon = jan4 - dow * DAY + (+m[2] - 1) * 7 * DAY;
        return { from: ymdUtc(mon), to: ymdUtc(mon + 6 * DAY) };
    }
    if (gran === 'month') {
        const m = /^(\d{4})-(\d{2})$/.exec(k);
        if (!m) return null;
        return { from: `${k}-01`, to: ymdUtc(Date.UTC(+m[1], +m[2], 0)) };
    }
    if (gran === 'year' && /^\d{4}$/.test(k)) return { from: `${k}-01-01`, to: `${k}-12-31` };
    return null;
}

/** 한국 날짜 범위 → 원장 쿼리 시각 { startMs(포함), endMs(미포함) } */
export function kstRangeMs(from, to) {
    const a = utcOf(from), b = utcOf(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { startMs: a - KST, endMs: b + DAY - KST };
}

/** 연동(비품재고연동 연동.py)이 자동으로 넣은 맞춤 줄인가 — '앱 값과 이지어드민 값 차이 맞춤'(시작 맞춤)·'현재고 맞춤'·수불 없이 현재고로 맞춘 줄.
 *  사람이 센 실사가 아니므로 '실사' 건수에서 뺀다(이지어드민 실사 수불 'arrange' 는 메모가 '… · 실사 N건' 이라 남는다). */
export const AUTO_ADJUST_MEMO = '이지어드민 불량창고 재고 자동 반영';
export function isAutoAdjust(l) {
    if (!l || l.op !== 'set') return false;
    const m = String(l.memo || '');
    return /맞춤/.test(m) || m === AUTO_ADJUST_MEMO;
}

/**
 * 원장 구간 — 원장으로 세는 시각 범위 { startMs, endMs }(둘 다 포함). 없으면 null.
 *   켜짐: 켠 시각 ~ 끝없음(켠 시각을 못 읽으면 startMs NaN = 원장 전부, 옛 이력은 안 씀)
 *   꺼짐(다시 끈 경우): 켠 시각(liveAt — 끌 때 지우지 않는다) ~ 끈 시각. 끈 시각은 스위치 문서 updatedAt(끌 때 서버 시각),
 *     못 읽으면 읽어 온 원장의 가장 늦은 기록 시각. 켠 적이 없으면 null.
 */
export function ledgerWindow(settings, ledger = []) {
    if (isLive(settings)) return { startMs: atMs(settings.liveAt), endMs: Infinity };
    const s = settings ? atMs(settings.liveAt) : NaN;
    if (!Number.isFinite(s)) return null;
    let e = atMs(settings.updatedAt);
    if (!(Number.isFinite(e) && e > s)) {
        e = NaN;
        for (const x of Array.isArray(ledger) ? ledger : []) { const t = atMs(x && x.at); if (Number.isFinite(t) && t >= s && !(t <= e)) e = t; }
    }
    return Number.isFinite(e) ? { startMs: s, endMs: e } : null;
}

/**
 * 기간 사용·입고 사건 목록. 원장 구간(ledgerWindow) 안은 원장, 그 밖은 item.logs(전환 전 이지어드민 이력) — 같은 때를 두 번 세지 않는다.
 * 실사(count/set)는 사용·입고가 아니라 건수·증감만: 원장은 켠 시각 뒤 것만(전환 때 시작 재고 실사는 뺌), 옛 이력은 연동 자동 맞춤을 뺀다.
 * @returns {{ events:{itemId,day,dir:'in'|'out',qty,src:'ledger'|'old'}[], countN, countNet, revertPairs, revertOrphan,
 *            basis:'ledger'|'old'|'mixed'|'none', live, liveDay, offDay, windowed, oldUsed, partial:{ n, before } }}
 *   partial = 전환 전 이력이 최근 30건만 남아 기간 앞부분이 빠졌을 수 있는 비품 수(n)와 그 날짜(before, 이 날 전은 빠졌을 수 있음)
 *   offDay = 다시 끈 경우 끈 날(한국 날짜), windowed = 원장 구간이 있나
 */
export function usageEvents({ items = [], ledger = [], settings = null, from, to } = {}) {
    const live = isLive(settings);
    const win = ledgerWindow(settings, ledger);
    const startMs = win ? win.startMs : NaN;
    const startOk = Number.isFinite(startMs);
    const liveDay = startOk ? kstDayOf(startMs) : '';
    const offDay = win && Number.isFinite(win.endMs) ? kstDayOf(win.endMs) : '';
    const inWin = (ms) => !!win && (!startOk || ms >= startMs) && ms <= win.endMs;
    const inRange = (d) => !!d && d >= from && d <= to;
    const events = [];
    let countN = 0, countNet = 0, revertPairs = 0, revertOrphan = 0;
    let ledgerUsed = false, oldUsed = false;

    if (win) {
        const list = (Array.isArray(ledger) ? ledger : []).filter(e => e && inWin(atMs(e.at)));
        const byId = new Map(list.map(e => [String(e.id || ''), e]));
        const cancelled = new Set();
        for (const e of list) {
            if (e.kind !== 'revert') continue;
            const orig = e.ref ? byId.get(String(e.ref)) : null;
            if (orig) { cancelled.add(String(orig.id)); revertPairs++; } else revertOrphan++;
        }
        for (const e of list) {
            if (e.kind === 'revert' || cancelled.has(String(e.id))) continue;
            const ms = atMs(e.at);
            const day = kstDayOf(ms);
            if (!inRange(day)) continue;
            const q = num(e.qty);
            if (e.kind === 'count') { if (startOk && ms >= startMs) { countN++; countNet += q; } continue; }
            if (e.kind === 'in' && q > 0) events.push({ itemId: String(e.itemId), day, dir: 'in', qty: q, src: 'ledger' });
            else if (e.kind === 'out' && q < 0) events.push({ itemId: String(e.itemId), day, dir: 'out', qty: -q, src: 'ledger' });
            else continue;
            ledgerUsed = true;
        }
    }

    // 원장 구간 밖 — item.logs. 켜짐인데 켠 시각을 못 읽으면 옛 이력을 쓰지 않는다(겹쳐 셀 수 있음).
    //   켜짐이면 켠 날 이후만 고른 기간은 볼 것이 없다(켠 날 당일의 켜기 전 사용은 센다 — from <= liveDay)
    const useOld = !win || startOk;
    let partialN = 0, partialBefore = '';
    if (useOld && (!live || from <= liveDay)) {
        for (const it of Array.isArray(items) ? items : []) {
            const logs = it && Array.isArray(it.logs) ? it.logs : [];
            let oldest = '';
            for (const l of logs) {
                const ms = atMs(l && l.at);
                if (!Number.isFinite(ms)) continue;
                const day = kstDayOf(ms);
                if (!oldest || day < oldest) oldest = day;
                if (inWin(ms)) continue;   // 원장 구간은 원장 몫
                if (!inRange(day)) continue;
                const d = num(l.delta);
                if (l.op === 'out' && d < 0) events.push({ itemId: String(it.id), day, dir: 'out', qty: -d, src: 'old' });
                else if (l.op === 'in' && d > 0) events.push({ itemId: String(it.id), day, dir: 'in', qty: d, src: 'old' });
                else if (l.op === 'set' && d !== 0) { if (!isAutoAdjust(l)) { countN++; countNet += d; } continue; }
                else continue;
                oldUsed = true;
            }
            // 30건이 꽉 찼고 가장 옛 줄이 기간 시작보다 뒤 — 그 앞은 잘렸을 수 있다(켜짐이면 켠 날까지만 옛 이력 몫)
            const cut = live && oldest > liveDay ? liveDay : oldest;
            if (logs.length >= OLD_LOG_MAX && cut && cut > from) {
                partialN++;
                if (!partialBefore || cut > partialBefore) partialBefore = cut;
            }
        }
    }
    const basis = ledgerUsed && oldUsed ? 'mixed' : ledgerUsed ? 'ledger' : oldUsed ? 'old' : 'none';
    return { events, countN, countNet, revertPairs, revertOrphan, basis, live, liveDay, offDay, windowed: !!win, oldUsed,
        partial: { n: partialN, before: partialBefore } };
}

/** 추세 단위 — 31일 이하 일, 120일 이하 주(월요일 시작), 그 위 월 */
export function trendUnitOf(from, to) {
    const n = daysIncl(from, to);
    return n <= 31 ? 'day' : n <= 120 ? 'week' : 'month';
}
function bucketOf(day, unit) {
    if (unit === 'day') return day;
    if (unit === 'month') return day.slice(0, 7);
    const t = utcOf(day);
    const dow = (new Date(t).getUTCDay() + 6) % 7;
    return ymdUtc(t - dow * DAY);
}
function bucketLabel(b, unit) {
    if (unit === 'month') return `${Number(b.slice(5, 7))}월`;
    const lab = `${Number(b.slice(5, 7))}/${Number(b.slice(8, 10))}`;
    return unit === 'week' ? `${lab}주` : lab;
}

const STATUS_RANK = { order: 0, watch: 1, ordered: 2 };
const LOW_STATUSES = Object.keys(STATUS_RANK);

/** 발주 기록 모으기 — 진행 중(orders)·지난 기록(log)을 itemId+발주일로 합친다(입고 확인하면 orders 와 log 에 같은 건이 둘 다 있다) */
export function orderRecords(ordersDoc) {
    const map = new Map();
    const take = (itemId, o, status) => {
        if (!o || typeof o !== 'object') return;
        const od = String(o.orderedDate || '').slice(0, 10);
        const k = `${itemId}|${od}`;
        const prev = map.get(k) || { itemId: String(itemId), orderedDate: od, receivedDate: '', status: '', qty: 0 };
        const rd = String(o.receivedDate || '').slice(0, 10);
        if (YMD.test(rd)) prev.receivedDate = rd;
        if (status) prev.status = status;
        else if (!prev.status && prev.receivedDate) prev.status = 'received';
        if (num(o.qty) > 0) prev.qty = num(o.qty);
        map.set(k, prev);
    };
    const orders = ordersDoc && ordersDoc.orders && typeof ordersDoc.orders === 'object' ? ordersDoc.orders : {};
    for (const [id, o] of Object.entries(orders)) take(id, o, o && o.status ? String(o.status) : '');
    for (const x of ordersDoc && Array.isArray(ordersDoc.log) ? ordersDoc.log : []) if (x && x.itemId) take(x.itemId, x, '');
    return [...map.values()];
}

/** 기간 발주·입고 건수와 리드타임(발주일 → 입고일 달력일, 기간 안에 입고된 건) */
export function orderStats(ordersDoc, from, to) {
    const recs = orderRecords(ordersDoc);
    const inP = (d) => YMD.test(d) && d >= from && d <= to;
    const ordered = recs.filter(r => inP(r.orderedDate) && r.status !== 'cancelled').length;
    const cancelled = recs.filter(r => inP(r.orderedDate) && r.status === 'cancelled').length;
    const recv = recs.filter(r => inP(r.receivedDate));
    const leads = recv.map(r => daysIncl(r.orderedDate, r.receivedDate) - 1).filter(n => n >= 0);
    const open = recs.filter(r => r.status === 'ordered').length;
    const lead = leads.length
        ? { n: leads.length, avg: leads.reduce((a, b) => a + b, 0) / leads.length, min: Math.min(...leads), max: Math.max(...leads) }
        : { n: 0, avg: null, min: null, max: null };
    return { ordered, cancelled, received: recv.length, open, lead };
}

/**
 * 비품 리포트 모델.
 * @param {object} a
 *   items, ledger(기간 원장), ledgerFull(LEDGER_MAX 만큼 찼나), stock({itemId: qty}), settings, ordersDoc, forecastDoc,
 *   from, to('YYYY-MM-DD'), today(한국 날짜), now(ms — 예측 오래됨 판정), canCost(금액 보이기 — data.reports),
 *   ok: { items, ledger, stock, orders, forecast }(각 문서를 읽었나 — false 면 그 칸은 '못 읽음')
 */
export function buildSuppliesReport(a = {}) {
    const items = Array.isArray(a.items) ? a.items.filter(it => it && it.id) : [];
    const from = a.from, to = a.to;
    const today = a.today || kstToday();
    const okOf = { items: true, settings: true, ledger: true, stock: true, orders: true, forecast: true, ...(a.ok || {}) };
    const live = isLive(a.settings);
    // 스위치를 못 읽으면 어느 기준(원장/옛 이력)인지 모른다 — 사용·입고·안전재고를 '못 읽음'으로. 원장이 필요한데 못 읽어도 사용·입고는 '못 읽음'
    const usageOk = okOf.settings && okOf.ledger;
    const byId = new Map(items.map(it => [String(it.id), it]));
    const ev = usageOk ? usageEvents({ items, ledger: a.ledger, settings: a.settings, from, to })
        : { events: [], countN: 0, countNet: 0, revertPairs: 0, revertOrphan: 0, basis: 'none', live, liveDay: '', offDay: '', windowed: false,
            oldUsed: false, partial: { n: 0, before: '' } };

    // 지난 날만 센다(오늘 포함) — 미래 날짜가 있는 기간(이번 달 등)은 오늘까지로 일평균
    const lastDay = to < today ? to : today;
    const elapsedDays = from <= lastDay ? daysIncl(from, lastDay) : 0;

    const per = new Map();
    const rowOf = (id) => {
        if (!per.has(id)) {
            const it = byId.get(id);
            per.set(id, { id, name: it ? String(it.name || '') : '(목록에 없는 비품)', category: it ? String(it.category || '') : '',
                unit: it ? String(it.unit || '') : '', out: 0, in: 0, outN: 0, price: it ? num(it.unitPrice) : 0 });
        }
        return per.get(id);
    };
    for (const e of ev.events) {
        const r = rowOf(e.itemId);
        if (e.dir === 'out') { r.out += e.qty; r.outN++; } else r.in += e.qty;
    }
    const rows = [...per.values()];
    const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
    const cost = !!a.canCost;
    const outQty = sum(r => r.out), inQty = sum(r => r.in);
    const top = rows.filter(r => r.out > 0)
        .sort((x, y) => y.out - x.out || x.name.localeCompare(y.name, 'ko'))
        .slice(0, TOP_N)
        .map(r => ({ id: r.id, name: r.name, category: r.category, unit: r.unit, out: r.out, in: r.in, outN: r.outN,
            perDay: elapsedDays > 0 ? r.out / elapsedDays : null, amount: cost && r.price > 0 ? r.out * r.price : null }));

    // 추세(사용·입고 수량 합) — 버킷은 기간 전체(앞뒤 빈 칸 포함, 오늘 뒤는 뺌)
    const unit = trendUnitOf(from, to);
    const buckets = [];
    for (let d = from; d && d <= lastDay; d = addDays(d, 1)) {
        const b = bucketOf(d, unit);
        if (buckets[buckets.length - 1] !== b) buckets.push(b);
    }
    const idx = new Map(buckets.map((b, i) => [b, i]));
    const tOut = buckets.map(() => 0), tIn = buckets.map(() => 0);
    for (const e of ev.events) {
        const i = idx.get(bucketOf(e.day, unit));
        if (i == null) continue;
        if (e.dir === 'out') tOut[i] += e.qty; else tIn[i] += e.qty;
    }

    // 현재고 vs 안전재고(지금 — 기간과 무관)
    const stockNow = (it) => stockOf(it, live, a.stock || {});
    const fcDoc = a.forecastDoc || null;
    const fcOf = (it) => {
        const fc = fcDoc && fcDoc.items ? fcDoc.items[it.id] : null;
        return fc && !fc.today && fcDoc.today ? { ...fc, today: fcDoc.today } : (fc || null);
    };
    const orderOf = (it) => (a.ordersDoc && a.ordersDoc.orders ? a.ordersDoc.orders[it.id] : null) || null;
    const fopts = forecastOpts(fcDoc, live);
    const statusOf = (it) => effectiveStatus(it, fcOf(it), okOf.orders ? orderOf(it) : null, fopts);
    const safetyItems = items.filter(it => num(it.safetyStock) > 0);
    const low = (okOf.items && okOf.settings && (okOf.stock || !live)) ? safetyItems
        .map(it => { const s = stockNow(it); return { it, s }; })
        .filter(x => isLowBy(x.it, x.s))
        .map(({ it, s }) => {
            const st = statusOf(it);
            return { id: it.id, name: String(it.name || ''), unit: String(it.unit || ''), stock: s, safety: num(it.safetyStock),
                gap: s - num(it.safetyStock), status: st, statusLabel: statusBadge(st).label };
        })
        .sort((x, y) => (x.stock / (x.safety || 1)) - (y.stock / (y.safety || 1)) || x.name.localeCompare(y.name, 'ko')) : null;

    // 예측(소진 예상·발주 권장) — 발주 필요·주의·발주함만 줄로
    let forecast = null;
    if (okOf.forecast && fcDoc) {
        const counts = { order: 0, watch: 0, ordered: 0 };
        const fRows = [];
        for (const it of items) {
            const st = statusOf(it);
            if (!LOW_STATUSES.includes(st)) continue;
            counts[st]++;
            const fc = fcOf(it);
            fRows.push({ id: it.id, name: String(it.name || ''), unit: String(it.unit || ''), status: st, statusLabel: statusBadge(st).label,
                deplete: depleteText(fc), reorder: reorderText(fc, today), recommend: recommendText(fc, it.unit),
                stock: stockNow(it), sortKey: depleteSortValue(fc) });
        }
        fRows.sort((x, y) => STATUS_RANK[x.status] - STATUS_RANK[y.status] || x.sortKey - y.sortKey || x.name.localeCompare(y.name, 'ko'));
        forecast = { generatedAt: fcDoc.generatedAt || '', stale: isStale(fcDoc.generatedAt, a.now == null ? Date.now() : a.now),
            basisDate: fcDoc.today || '', counts, rows: fRows };
    }

    const notes = [];
    const mdOf = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    if (!okOf.settings) notes.push('재고 기준 스위치 문서를 읽지 못해 사용·입고·안전재고를 셀 수 없습니다 — [새로 읽기]를 눌러 주세요.');
    else if (!live && ev.windowed) notes.push(`지금은 이지어드민 기준입니다. 앱 기준이 켜져 있던 ${mdOf(ev.liveDay)} ~ ${mdOf(ev.offDay)} 은 앱 원장, 그 밖은 비품별 이지어드민 이력(최근 30건)으로 셉니다.`);
    else if (!live && a.settings && Number.isFinite(atMs(a.settings.liveAt))) notes.push('앱 기준을 다시 끈 상태인데 켜져 있던 기간을 알 수 없어 이지어드민 이력으로만 셉니다(그 기간 앱 기록이 빠졌을 수 있음).');
    else if (!live) notes.push('지금은 이지어드민 기준(전환 전)이라 사용·입고는 비품별 이지어드민 이력(최근 30건)으로 셉니다.');
    else if (ev.liveDay && from <= ev.liveDay) notes.push(`앱 기준 전환(${Number(ev.liveDay.slice(5, 7))}/${Number(ev.liveDay.slice(8, 10))}) 전 기간은 비품별 이지어드민 이력(최근 30건)으로 보충했습니다.`);
    else if (!ev.liveDay) notes.push('앱 기준 전환 시각을 읽지 못해 원장 기록만 셉니다(전환 전 기간은 빠짐).');
    if (ev.partial.n > 0) notes.push(`${ev.partial.n}종은 전환 전 이력이 최근 30건만 남아 ${Number(ev.partial.before.slice(5, 7))}/${Number(ev.partial.before.slice(8, 10))} 전 사용량이 빠졌을 수 있습니다.`);
    if (a.ledgerFull) notes.push(`원장 기록이 많아 최근 ${LEDGER_MAX.toLocaleString('en-US')}건만 읽었습니다 — 기간 앞부분이 빠졌을 수 있습니다.`);
    if (ev.revertOrphan > 0) notes.push(`원 기록이 기간 밖인 되돌림 ${ev.revertOrphan}건은 사용·입고에 넣지 않았습니다.`);
    if (okOf.settings && !okOf.ledger) notes.push('원장을 읽지 못해 사용·입고를 셀 수 없습니다 — [새로 읽기]를 눌러 주세요.');
    notes.push('수량 합계는 비품마다 단위가 달라 참고용입니다(비품별 표를 보세요).');

    return {
        meta: { from, to, today, elapsedDays, live, liveDay: ev.liveDay, offDay: ev.offDay, basis: ev.basis, itemCount: items.length, usageOk, notes },
        // 사용·입고를 못 읽었으면(usageOk false) 숫자 칸은 null — 화면·엑셀이 '못 읽음'으로
        totals: !usageOk ? { outQty: null, inQty: null, outItems: 0, inItems: 0, outEvents: 0, outPerDay: null, countN: null, countNet: 0,
            revertPairs: 0, outAmount: null, inAmount: null, pricedShare: null } : {
            outQty, inQty, outItems: rows.filter(r => r.out > 0).length, inItems: rows.filter(r => r.in > 0).length,
            outEvents: sum(r => r.outN), outPerDay: elapsedDays > 0 ? outQty / elapsedDays : null,
            countN: ev.countN, countNet: ev.countNet, revertPairs: ev.revertPairs,
            outAmount: cost ? sum(r => r.out * r.price) : null, inAmount: cost ? sum(r => r.in * r.price) : null,
            pricedShare: cost && rows.some(r => r.out > 0) ? rows.filter(r => r.out > 0 && r.price > 0).length / rows.filter(r => r.out > 0).length : null
        },
        top,
        trend: { unit, labels: buckets.map(b => bucketLabel(b, unit)), out: tOut, in: tIn },
        low, safetyCount: safetyItems.length,
        forecast,
        orders: okOf.orders ? orderStats(a.ordersDoc, from, to) : null
    };
}

/** 결산 엑셀 줄 [구분, 항목, 값] — 금액은 모델에 있을 때만(비용 권한). 공급처는 없다. */
export function suppliesExcelRows(m) {
    if (!m) return [];
    const T = m.totals, r1 = (v) => (v == null ? '' : Math.round(v * 10) / 10);
    const U = m.meta.usageOk !== false;
    const out = !U ? [['비품', '사용·입고', '못 읽음']] : [
        ['비품', '사용(출고) 수량 합계', Math.round(T.outQty)],
        ['비품', '사용한 비품 수(종)', T.outItems],
        ['비품', '일평균 사용 수량', r1(T.outPerDay)],
        ['비품', '입고 수량 합계', Math.round(T.inQty)],
        ['비품', '실사(건)', T.countN]
    ];
    if (U && T.outAmount != null) out.push(['비품', '사용 금액(단가 기준, 원)', Math.round(T.outAmount)]);
    for (const t of m.top) out.push(['비품 사용 상위', `${t.name}${t.unit ? ` (${t.unit})` : ''}`, Math.round(t.out)]);
    if (m.low) {
        out.push(['비품', '안전재고 이하(종)', m.low.length]);
        for (const l of m.low) out.push(['비품 안전재고 이하', l.name, `${Math.round(l.stock)} / 안전 ${Math.round(l.safety)}${l.unit}`]);
    }
    if (m.forecast) {
        out.push(['비품', '발주 필요(종)', m.forecast.counts.order], ['비품', '주의(종)', m.forecast.counts.watch], ['비품', '발주함(종)', m.forecast.counts.ordered]);
        for (const f of m.forecast.rows) out.push(['비품 예측', `${f.name} [${f.statusLabel}]`, `소진 ${f.deplete} · 발주 권장 ${f.reorder} · 권장량 ${f.recommend}`]);
    }
    if (m.orders) {
        out.push(['비품', '기간 발주(건)', m.orders.ordered], ['비품', '기간 입고 확인(건)', m.orders.received],
            ['비품', '평균 리드타임(일)', m.orders.lead.n ? r1(m.orders.lead.avg) : '']);
    }
    for (const n of m.meta.notes) out.push(['비품 주의', '', n]);
    return out;
}
