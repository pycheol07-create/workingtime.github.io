// === js/lib/locrec-view.js ===
// 로케이션관리 대시보드 '로케이션 변경 추천' 카드(js/locrec-card.js)의 순수 함수 — node --test 대상.
// 문서는 이 PC 프로그램(업무자동화\앱\로케이션추천)이 매일 06:40 쓴다. 모양(설계 로케이션추천_설계.md 1.6절):
//   integrations/locRecLatest       { schema, latestDay, days:{YYYYMMDD:{status: ok|rest|fail, n, gainSum, verdict}},
//                                     metrics:{top100Front(0~1), inversions, gainSum, gainSumPrevWeek, top100FrontPrevWeek?, inversionsPrevWeek?,
//                                              routeScore(0~100)?, routeScoreAfter?, frontQty(0~1)?, frontQtyAfter?, routeCoverage?, routeItems?,
//                                              routeConflicts?, routeScorePrevWeek?}  ← 동선 점수(2026-10-26~, 옛 문서엔 없음)
//                                              routeHeat?{v, zones, dongs, q(줄 우선 1차원), sum}  ← 구역 × 동 출고 격자(색인에만, routeHeatView)
//                                     days[k].metrics 에도 routeScore·routeScoreAfter·frontQty·frontQtyAfter(그래프 js/lib/locrec-trend.js)
//                                     행에는 scoreGain(점수)·frontGain(%p) — 그 줄만 적용했을 때의 차이. 기타 자리 상품 줄은 routeOut: true(기여도 없음)
//                                     open:{recKey:{type, code, state: open|done|expired|stale|partial, firstDay, lastDay, alertedDay?, doneDay?}},
//                                     dataState:{daysCollected, pairDays?, lastOutDay, lastOrderDay, warnings:[], stockDataAt, locUpdatedAt}, settings }
//                                     stockDataAt = INFO_CONFIG.lastDataUpdate(재고 엑셀 올린 시각) — '재고 자료 기준'·오래됨 판단은 이것만.
//                                     locUpdatedAt(Locations 문서 갱신 시각)은 참고용이라 카드에서 쓰지 않는다.
//   integrations/locRec_YYYYMMDD    { rowsJson: JSON 문자열 {schema, single:[행], swap:[행], pair:[행]}, metrics, basedOn:{stockDataAt, …}, warn }
//                                     행 = 로케이션추천\추천실행.mjs(js/lib/loc-recommend.js runRecommend) 출력 행 그대로
//   locRecWork/marks                { marks:{recKey:{state: done|skip, by(직원 이름), at, applied?}} }   ← 직원이 쓴다
//                                     applied = {v:1, at(ms), day:'YYYYMMDD'(KST), moves:[{code, src, dst}], skipped:[{code, src, dst}]}
//                                     ← [처리함]이 데이터 리스트(Locations) 상품 칸을 옮겼을 때만(2026-10-29, js/lib/locrec-apply.js · js/locrec-store.js).
//                                       코드·자리 id 만. 없으면 '표시만'(옛 표시·반영 못 해 표시만 한 것). 서버 저장소.load_marks 는 state·at 만 읽는다.
//                                     옮긴 자리에는 Locations 자리 맵 안 locRecMove{day, at, role:in|out, code, peer, recKey} — 화면은 그날(KST)만 보인다.
//   locRecWork/request              { requestedAt, by, day }   ← 머리줄 [지금 재고로 다시 만들기](js/rebuild-bar.js, 덮어쓰기 — 채우기 권한이
//                                     있으면 refillWork/request 에). 서버는 두 문서 중 늦은 쪽 · 채우기요청(5분)이 추천.py --요청확인 을 부른다
//   locRecLatest.req                { state: running|done|failed|rejected|waiting, note, day, count, autoCount, lastReqAt, startedAt, at,
//                                     source: request|auto, autoStockAt(ms), max, cooldownMin, autoMax, waitUntil(ms), lastRun }
//                                     ← 다시 만들기 상태(서버 다시만들기.py). waiting 칸·문구는 채우기 refillLatest.req 와 같다
//   다시 만든 locRec_오늘           + rev(1부터) · source · requestedBy · 행 carried:true(이월 — 지금 기준 추천에서 빠졌지만 오늘 손댄 행)
//                                     · 행 addedAt:'HH:MM'(다시 만든 판에 처음 들어온 시각 — 표 배지 '추가 HH:MM', 2026-10-28 다시만들기.carry_rows)
//                                     이월 행은 띠 건수·요약·엑셀·[전체 처리함]에서 뺀다(표에는 흐리게 보인다).
// import 는 같은 lib 의 refill-view.js(날짜·시각, KST)·loc-recommend.js(엑셀 5열) 만 — 같은 규칙을 두 벌 두지 않는다.

import { tsMs, dayKey, keyMs, lastDays, dayLabel, fmtHM, kstParts, waitInfo } from './refill-view.js?v=202610291723';
import { excelRows, EXCEL_COLS } from './loc-recommend.js?v=202610291723';

export { tsMs, dayKey, keyMs, lastDays, dayLabel, fmtHM, excelRows, EXCEL_COLS };

const DAY_MS = 24 * 60 * 60 * 1000;
export const TABS = ['single', 'swap', 'pair'];
export const TAB_LABEL = { single: '단독', swap: '맞바꾸기', pair: '페어' };
export const SHEET_NAME = { single: '단독추천', swap: '맞바꾸기', pair: '페어추천' };
export const DAYS_SHOWN = 14;            // 날짜 선택 칸 수(결과 문서 보관 14일)
export const SKIP_HIDE_DAYS = 30;        // '안 함' 은 30일 숨김
export const MARK_STALE_DAYS = 7;        // '처리함' 표시 뒤 7일 안에 서버가 위치 변화를 못 보면 '위치 미반영'
export const LOC_OLD_DAYS = 3;           // 재고 자료가 3일 넘게 오래되면 경고
const p2 = (n) => String(n).padStart(2, '0');

/** 'YYYYMMDD' 두 개 사이 일수(b - a). 못 읽으면 0 */
export function daysBetween(a, b) {
    if (!/^\d{8}$/.test(String(a || '')) || !/^\d{8}$/.test(String(b || ''))) return 0;
    return Math.round((keyMs(b) - keyMs(a)) / DAY_MS);
}

/** ms → 'MM/DD HH:MM'(KST). 없으면 '' */
export function fmtMDHM(v) {
    const ms = tsMs(v);
    if (!ms) return '';
    const k = kstParts(ms);
    return `${p2(k.m)}/${p2(k.d)} ${p2(k.hh)}:${p2(k.mm)}`;
}

const str = (v) => (v == null ? '' : String(v));
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function cleanRow(r, type) {
    if (!r || typeof r !== 'object' || !str(r.code).trim()) return null;
    const out = {
        type: r.type || type, recKey: str(r.recKey), rank: num(r.rank),
        code: str(r.code), name: str(r.name), option: str(r.option), from: str(r.from), to: str(r.to),
        qty: num(r.qty), daily: num(r.daily), gain: num(r.gain), capWarn: r.capWarn === true, pairNear: str(r.pairNear),
        scoreGain: num(r.scoreGain), frontGain: num(r.frontGain),       // 동선 점수 기여도(옛 문서는 null)
        routeOut: r.routeOut === true,                                    // 기타·SAM 자리 상품 줄 — 동선 점수 계산 대상 밖
        fromSize: str(r.fromSize).trim(), toSize: str(r.toSize).trim(),   // 자리 칸수(옛 문서는 '')
        reserve: num(r.reserve),                                          // 비축 수량(2026-10-27~, 비축 없거나 옛 문서는 null)
        carried: r.carried === true,                                      // 다시 만들 때 이월한 행(지금 기준 추천에서 빠짐)
        addedAt: /^\d{2}:\d{2}$/.test(str(r.addedAt)) ? str(r.addedAt) : ''   // 다시 만든 판에 처음 들어온 시각(없으면 '')
    };
    if (r.code2 != null && str(r.code2)) {
        Object.assign(out, { code2: str(r.code2), name2: str(r.name2), option2: str(r.option2), from2: str(r.from2), to2: str(r.to2),
            qty2: num(r.qty2), daily2: num(r.daily2), fromSize2: str(r.fromSize2).trim(), toSize2: str(r.toSize2).trim(),
            reserve2: num(r.reserve2) });
    }
    if (!out.recKey) out.recKey = `${out.type}:${out.code}:${out.from}>${out.to}`;
    return out;
}

/** 결과 문서 → { single, swap, pair, error }. rowsJson 이 깨지면 빈 표 + error */
export function parseRecDay(doc) {
    const empty = (error) => ({ single: [], swap: [], pair: [], error });
    if (!doc || typeof doc.rowsJson !== 'string') return empty(doc ? '표 자료가 없습니다' : '');
    let d;
    try { d = JSON.parse(doc.rowsJson); } catch (e) { return empty('표 자료가 깨졌습니다'); }
    if (!d || typeof d !== 'object') return empty('표 자료가 깨졌습니다');
    const out = { error: '' };
    TABS.forEach(t => {
        const list = Array.isArray(d[t]) ? d[t] : [];
        out[t] = list.map(r => cleanRow(r, t)).filter(Boolean)
            .sort((a, b) => (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank));
    });
    return out;
}

/** 'YYYYMMDD' 또는 'YYYY-MM-DD' → 'YYYYMMDD'. 못 읽으면 '' */
export function normDay(v) {
    const s = str(v).trim().replace(/-/g, '').slice(0, 8);
    return /^\d{8}$/.test(s) ? s : '';
}

/**
 * 판정 → 배지 {label, tone}. 서버가 '필요|주의|양호|관찰 중' 또는 'need|warn|ok|observe' 로 쓴다.
 * 관찰 중이면 서버의 observeUntil(locRecLatest, 'YYYY-MM-DD')을 'MM/DD까지' 로 붙인다.
 */
export function verdictBadge(v, observeUntil) {
    const s = str(v).trim().toLowerCase();
    if (s === '관찰 중' || s === '관찰중' || s === 'observe' || s === 'observing') {
        const d = normDay(observeUntil);
        return { label: d ? `관찰 중 (${d.slice(4, 6)}/${d.slice(6, 8)}까지)` : '관찰 중', tone: 'none' };
    }
    if (s === '필요' || s === 'need') return { label: '필요', tone: 'risk' };
    if (s === '주의' || s === 'warn') return { label: '주의', tone: 'warn' };
    if (s === '양호' || s === 'ok') return { label: '양호', tone: 'ok' };
    return { label: '판정 없음', tone: 'none' };
}

/** 0~1 → '68%'. 없으면 '-' */
export function fmtPct(v) {
    const n = num(v);
    return n == null ? '-' : `${Math.round(n * 100)}%`;
}

/** 숫자 → 소수 1자리(정수면 그대로). 없으면 '-' */
export function fmtNum(v, digits = 1) {
    const n = num(v);
    if (n == null) return '-';
    return Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toFixed(digits);
}

/** 지표 3개 → [{label, value, prev}] (지난주 값이 없으면 prev '') */
export function metricItems(m) {
    const x = m || {};
    return [
        { label: '좋은 자리 점유율', value: fmtPct(x.top100Front), prev: x.top100FrontPrevWeek != null ? fmtPct(x.top100FrontPrevWeek) : '' },
        { label: '순위 역전', value: x.inversions == null ? '-' : `${fmtNum(x.inversions)}쌍`, prev: x.inversionsPrevWeek != null ? `${fmtNum(x.inversionsPrevWeek)}쌍` : '' },
        { label: '추천 이득', value: fmtNum(x.gainSum), prev: x.gainSumPrevWeek != null ? fmtNum(x.gainSumPrevWeek) : '' }
    ];
}

/** 동선 점수 설명(카드 툴팁) */
export const ROUTE_HELP = '동선 점수: 출고 많은 상품이 앞자리(동·위치 순위)에 있을수록 높다. 100 = 이론상 완벽(인기 순으로 앞자리부터), 0 = 정반대. '
    + '화살표 뒤는 오늘 추천을 모두 적용했을 때(안 함 제외).';
export const FRONT_HELP = '앞쪽 자리 출고: 하루 출고량 중 앞쪽 자리(구역마다 앞 20% 칸)에 있는 상품의 몫. 화살표 뒤는 오늘 추천을 모두 적용했을 때.';

/** 표 점수 칸 — 계산 대상 밖 줄의 글자·툴팁 */
export const ROUTE_OUT_LABEL = '대상 밖';
export const ROUTE_OUT_HELP = '기타 자리 상품이라 동선 점수 계산 대상 밖(옮기면 다음 날부터 점수에 들어감)';

/** 점수 차이 → '+0.4' · 0.05 미만 '+<0.1' · 없거나 0 '-' · 음수 '-0.3' */
export function fmtGain(v) {
    const n = num(v);
    if (n == null || Math.abs(n) < 0.005) return '-';
    if (n > 0) return n < 0.05 ? '+<0.1' : `+${n.toFixed(1)}`;
    return n > -0.05 ? '-<0.1' : n.toFixed(1);
}

/**
 * 동선 지표 2개(카드 kpis 앞) → [{label, value, title}]. 옛 문서(칸 없음)면 value '-'.
 *   '동선 점수 77.4 → 78.6 (+1.2)' · '앞쪽 자리 출고 57% → 58%'
 */
export function routeItems(m) {
    const x = m || {};
    const s0 = num(x.routeScore), s1 = num(x.routeScoreAfter);
    const f0 = num(x.frontQty), f1 = num(x.frontQtyAfter);
    const one = (v) => (v == null ? '-' : v.toFixed(1));
    let score = one(s0);
    if (s0 != null && s1 != null) score += ` → ${one(s1)}` + (fmtGain(s1 - s0) === '-' ? '' : ` (${fmtGain(s1 - s0)})`);
    let front = fmtPct(f0);
    if (f0 != null && f1 != null) front += ` → ${fmtPct(f1)}`;
    const cov = num(x.routeCoverage), items = num(x.routeItems);
    const covTxt = cov == null ? '' : ` 계산 대상: 출고의 ${fmtPct(cov)}${items == null ? '' : `(${fmtNum(items)}개 상품)`} — 기타·비축에만 있는 상품은 빠진다.`;
    const prev = num(x.routeScorePrevWeek);
    return [
        { label: '동선 점수', value: score, prev: prev == null ? '' : one(prev), title: ROUTE_HELP + covTxt },
        { label: '앞쪽 자리 출고', value: front, prev: '', title: FRONT_HELP }
    ];
}

/**
 * 인사이트 줄 '동선 효율' 카드(js/locrec-route-card.js) — 색인 locRecLatest 의 최신 지표(metrics) 하나만 본다.
 *   → { has, score('77.4'|'-'), after(''|'추천 모두 적용 시 78.6 (+1.2)'), front('57% → 58%'|'57%'|'-'),
 *       day('10/26(월)'|''), prev(''|'76.8'), scoreTitle, frontTitle }
 *   has = 동선 점수가 있음(옛 문서·자료 없음이면 false → 카드는 '-' 와 '매일 06:40 계산' 안내).
 */
export function routeCardInfo(latest) {
    const L = latest && typeof latest === 'object' ? latest : {};
    const x = L.metrics || {};
    const s0 = num(x.routeScore), s1 = num(x.routeScoreAfter);
    const f0 = num(x.frontQty), f1 = num(x.frontQtyAfter);
    const one = (v) => v.toFixed(1);
    const g = s0 != null && s1 != null ? fmtGain(s1 - s0) : '-';
    const cov = num(x.routeCoverage), items = num(x.routeItems);
    const covTxt = cov == null ? '' : ` 계산 대상: 출고의 ${fmtPct(cov)}${items == null ? '' : `(${fmtNum(items)}개 상품)`} — 기타·비축에만 있는 상품은 빠진다.`;
    const prev = num(x.routeScorePrevWeek);
    const day = normDay(L.latestDay);
    return {
        has: s0 != null,
        score: s0 == null ? '-' : one(s0),
        after: s0 != null && s1 != null ? `추천 모두 적용 시 ${one(s1)}${g === '-' ? '' : ` (${g})`}` : '',
        front: f0 == null ? '-' : fmtPct(f0) + (f1 == null ? '' : ` → ${fmtPct(f1)}`),
        day: day ? dayLabel(day) : '',
        prev: prev == null ? '' : one(prev),
        scoreTitle: ROUTE_CARD_HELP + covTxt,
        frontTitle: FRONT_HELP
    };
}
export const ROUTE_CARD_HELP = '동선 점수: 출고 많은 상품이 앞자리(동·위치 순위)에 있을수록 높다. 100 = 이론상 완벽(인기 순으로 앞자리부터), 0 = 정반대. '
    + "'추천 모두 적용 시'는 그날 변경 추천을 모두 처리했을 때(안 함 제외).";

/** 열지도 칸 진하기 — 0 = 출고 0, 그 밖은 r = √(값/최대값) 을 1(≤0.25)·2(≤0.5)·3(≤0.75)·4 로 */
export function heatLevel(v, max) {
    const n = num(v), m = num(max);
    if (n == null || !(n > 0) || !(m > 0)) return 0;
    const r = Math.sqrt(Math.min(1, n / m));
    return Math.max(1, Math.min(4, Math.ceil(r * 4)));
}

/**
 * 동선 효율 카드 열지도 — 색인 metrics.routeHeat {v, zones, dongs, q(줄 우선 1차원), sum} → 그리기용
 *   → { has, rows:[{zone, sum, cells:[{dong, q(null = 자리 없음), pct(0~100|null), level(0~4|null), title}]}], more }
 *   rows 는 구역 순위 순. maxRows 를 넘으면 출고 합이 큰 구역 maxRows 개만 남기고(순서는 그대로) more = 뺀 구역 수.
 *   title = '구역 A · 3동 · 하루 120개(8%)'. 모양이 틀리거나(옛 문서·길이 안 맞음) 출고가 하나도 없으면 has false.
 */
export function routeHeatView(heat, { maxRows = 10 } = {}) {
    const no = { has: false, rows: [], more: 0 };
    const h = heat && typeof heat === 'object' ? heat : null;
    if (!h || !Array.isArray(h.zones) || !Array.isArray(h.dongs) || !Array.isArray(h.q)) return no;
    const nZ = h.zones.length, nD = h.dongs.length;
    if (!nZ || !nD || h.q.length !== nZ * nD) return no;
    if (h.q.some(v => v != null && (typeof v === 'object' || num(v) == null))) return no;
    const vals = h.q.map(v => (v == null ? null : Math.max(0, num(v))));
    const max = Math.max(0, ...vals.map(v => v || 0));
    if (!(max > 0)) return no;
    const total = num(h.sum) > 0 ? num(h.sum) : vals.reduce((s, v) => s + (v || 0), 0);
    const qty = (v) => (v >= 10 || Number.isInteger(v) ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1));
    const pctTxt = (p) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`);
    let rows = h.zones.map((z, zi) => {
        const zone = str(z);
        const cells = h.dongs.map((dg, di) => {
            const dong = str(dg);
            const v = vals[zi * nD + di];
            const head = `구역 ${zone} · ${dong}동`;
            if (v == null) return { dong, q: null, pct: null, level: null, title: `${head} · 자리 없음` };
            const pct = total > 0 ? (v / total) * 100 : 0;
            return { dong, q: v, pct: Math.round(pct * 10) / 10, level: heatLevel(v, max), title: `${head} · 하루 ${qty(v)}개(${pctTxt(pct)})` };
        });
        return { zone, sum: cells.reduce((s, c) => s + (c.q || 0), 0), cells, i: zi };
    });
    let more = 0;
    if (maxRows > 0 && rows.length > maxRows) {
        const keep = new Set(rows.slice().sort((a, b) => (b.sum - a.sum) || (a.i - b.i)).slice(0, maxRows).map(r => r.i));
        more = rows.length - keep.size;
        rows = rows.filter(r => keep.has(r.i));
    }
    return { has: true, rows: rows.map(({ zone, sum, cells }) => ({ zone, sum: Math.round(sum * 10) / 10, cells })), more };
}

/** 열지도 설명(카드 title·상세 창) */
export const HEAT_HELP = '피킹 자리 기준 — 상품마다 가장 앞쪽 피킹 자리 1곳에 하루 평균 출고를 더했습니다(기타·비축 자리는 빠짐).';

/**
 * 동선 효율 상세 창(js/locrec-route-modal.js) 머리 숫자 — routeCardInfo 와 같은 문서(locRecLatest)를 본다.
 *   → { has, score, after(''|'78.6'), gain(''|'+1.2'), front, prev(''|'76.8'), prevDiff(''|'+0.6'),
 *       coverage(''|'93%'), items(''|'1,234'), day('10/26(월)'|'') }
 */
export function routeDetailHead(latest) {
    const L = latest && typeof latest === 'object' ? latest : {};
    const x = L.metrics || {};
    const s0 = num(x.routeScore), s1 = num(x.routeScoreAfter), prev = num(x.routeScorePrevWeek);
    const f0 = num(x.frontQty), f1 = num(x.frontQtyAfter);
    const cov = num(x.routeCoverage), items = num(x.routeItems);
    const g = s0 != null && s1 != null ? fmtGain(s1 - s0) : '-';
    const pd = s0 != null && prev != null ? fmtGain(s0 - prev) : '-';
    const day = normDay(L.latestDay);
    return {
        has: s0 != null,
        score: s0 == null ? '-' : s0.toFixed(1),
        after: s1 == null ? '' : s1.toFixed(1),
        gain: g === '-' ? '' : g,
        front: f0 == null ? '-' : fmtPct(f0) + (f1 == null ? '' : ` → ${fmtPct(f1)}`),
        prev: prev == null ? '' : prev.toFixed(1),
        prevDiff: pd === '-' ? '' : pd,
        coverage: cov == null ? '' : fmtPct(cov),
        items: items == null ? '' : Math.round(items).toLocaleString('ko-KR'),
        day: day ? dayLabel(day) : ''
    };
}

/**
 * 동선 효율 상세 창 열지도 — routeHeatView 를 자르지 않고(maxRows 0) 숫자·합계를 더한다.
 *   → { has, total, totalTxt, rows:[{zone, sum, sumTxt, pct, cells:[{…routeHeatView 칸, text('' = 자리 없음)}]}],
 *       dongs:[{dong, sum, sumTxt, pct}] }
 *   비율 분모 total = routeHeatView 와 같다(heat.sum, 없으면 칸 합) — 카드 title 의 % 와 맞는다. 자리 없는 칸(null)은 합에서 빠진다.
 */
export function routeHeatDetail(heat) {
    const v = routeHeatView(heat, { maxRows: 0 });
    if (!v.has) return { has: false, total: 0, totalTxt: '', rows: [], dongs: [] };
    const qty = (n) => (n >= 10 || Number.isInteger(n) ? Math.round(n).toLocaleString('ko-KR') : n.toFixed(1));
    const cellSum = v.rows.reduce((s, r) => s + r.cells.reduce((t, c) => t + (c.q || 0), 0), 0);
    const total = num(heat.sum) > 0 ? num(heat.sum) : cellSum;
    const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const rows = v.rows.map(r => ({
        zone: r.zone, sum: r.sum, sumTxt: qty(r.sum), pct: pct(r.sum),
        cells: r.cells.map(c => ({ ...c, text: c.q == null ? '' : c.q > 0 ? qty(c.q) : '0' }))
    }));
    const dongs = (v.rows[0] ? v.rows[0].cells : []).map((c, di) => {
        const sum = Math.round(v.rows.reduce((s, r) => s + (r.cells[di].q || 0), 0) * 10) / 10;
        return { dong: c.dong, sum, sumTxt: qty(sum), pct: pct(sum) };
    });
    return { has: true, total, totalTxt: qty(total), rows, dongs };
}

/** 재고 자료 기준 시각(ms) — stockDataAt(= lastDataUpdate, 엑셀 올린 시각). 옛 문서는 lastDataUpdate 칸. locUpdatedAt 은 쓰지 않는다 */
export function stockAtOf(obj) {
    const o = obj || {};
    return tsMs(o.stockDataAt) || tsMs(o.lastDataUpdate);
}

/** 자료 상태 → 경고 문구 목록. 재고 자료(엑셀 올린 시각 stockDataAt)가 LOC_OLD_DAYS 일 넘게 오래되면 맨 앞에 */
export function dataWarnings(latest, nowMs) {
    const ds = (latest && latest.dataState) || {};
    const out = [];
    const at = stockAtOf(ds);
    if (at && nowMs - at > LOC_OLD_DAYS * DAY_MS) out.push(`재고 자료 오래됨(${fmtMDHM(at)}) — 엑셀을 올리면 추천이 정확해집니다`);
    (Array.isArray(ds.warnings) ? ds.warnings : []).forEach(w => { if (str(w).trim()) out.push(str(w).trim()); });
    return out;
}

/** 자료 상태 한 줄 '출고 28일 · 페어 61일 · 재고 자료 10/18 17:20 기준' */
export function dataLine(latest) {
    const ds = (latest && latest.dataState) || {};
    const parts = [];
    if (ds.daysCollected != null) parts.push(`출고 ${fmtNum(ds.daysCollected)}일`);
    if (ds.pairDays != null) parts.push(`페어 ${fmtNum(ds.pairDays)}일`);
    const at = fmtMDHM(stockAtOf(ds));
    if (at) parts.push(`재고 자료 ${at} 기준`);
    return parts.join(' · ');
}

/**
 * 행 상태 — 서버 판정이 우선, 그다음 직원 표시.
 *   '안 함' 숨김: 서버 open[recKey] 가 state 'skip' 이고 skipUntil(YYYYMMDD) 이 오늘 이후면 숨김(서버 기준).
 *   직원 표시(mark)는 이럴 때 무시한다(버튼이 처음처럼 보인다):
 *     · open.firstDay 가 mark 를 누른 날(KST)보다 뒤 — 지났다가 새로 다시 나온 추천
 *     · skip 표시인데 서버 skipUntil 이 지남 — 서버 숨김 기간 끝
 *   서버가 아직 반영 안 한 skip(방금 누름)은 바로 숨긴다(누른 지 30일 안).
 * @returns {{label, tone, hidden, mark}}  tone: ok|warn|accent|muted|none · mark: 이 행에 유효한 표시(없으면 null)
 */
export function rowState({ row, open, mark, viewDay, todayKey, nowMs }) {
    const o = open || null;
    const today = todayKey || dayKey(nowMs);
    let m = mark && (mark.state === 'done' || mark.state === 'skip') ? mark : null;
    const markDay = m && tsMs(m.at) ? dayKey(tsMs(m.at)) : '';
    if (m && o && markDay && normDay(o.firstDay) && normDay(o.firstDay) > markDay) m = null;
    if (m && m.state === 'skip' && o && normDay(o.skipUntil) && normDay(o.skipUntil) < today) m = null;
    const markAgeDays = m ? (nowMs - tsMs(m.at)) / DAY_MS : 0;
    if (o && o.state === 'done') return { label: '처리됨', tone: 'ok', hidden: false, mark: m };
    if (o && o.state === 'skip' && (!normDay(o.skipUntil) || normDay(o.skipUntil) >= today)) {
        return { label: '안 함', tone: 'muted', hidden: true, mark: m };
    }
    if (m && m.state === 'skip') {
        const live = !tsMs(m.at) || markAgeDays <= SKIP_HIDE_DAYS;
        return { label: '안 함', tone: 'muted', hidden: live, mark: m };
    }
    if (o && (o.state === 'partial' || o.state === 'progress')) return { label: '진행 중', tone: 'warn', hidden: false, mark: m };
    if (m && m.state === 'done') {
        if (tsMs(m.at) && markAgeDays > MARK_STALE_DAYS) return { label: '표시는 됐지만 위치 미반영', tone: 'warn', hidden: false, mark: m };
        return { label: '처리함 표시', tone: 'ok', hidden: false, mark: m };
    }
    if (o && o.state === 'expired') return { label: '만료', tone: 'muted', hidden: false, mark: m };
    if (o && o.state === 'stale') return { label: '자리 바뀜', tone: 'muted', hidden: false, mark: m };
    if (o && o.alertedDay) return { label: '알림됨', tone: 'accent', hidden: false, mark: m };
    const first = (o && o.firstDay) || viewDay;
    const n = daysBetween(first, viewDay || todayKey) + 1;
    if (!o || n <= 1) return { label: '새로', tone: 'accent', hidden: false, mark: m };
    return { label: `${n}일째`, tone: 'none', hidden: false, mark: m };
}

/** 날짜 선택 목록(오늘부터 DAYS_SHOWN 일) → [{key, label, status}] — status 는 locRecLatest.days 의 것, 없으면 'none' */
export function dayOptions(latest, todayKey) {
    const days = (latest && latest.days) || {};
    return lastDays(todayKey, DAYS_SHOWN).map(k => {
        const e = days[k];
        const status = e && e.status ? String(e.status) : 'none';
        const tail = (k === todayKey ? ' · 오늘' : '') + (status === 'rest' ? ' (쉬는 날)' : status === 'fail' ? ' (실패)' : status === 'none' ? ' (없음)' : '');
        return { key: k, label: dayLabel(k) + tail, status };
    });
}

/** 처음 보여 줄 날짜 — 오늘 결과가 있으면 오늘, 없으면 latestDay, 그것도 없으면 오늘 */
export function defaultDay(latest, todayKey) {
    const days = (latest && latest.days) || {};
    if (days[todayKey] && days[todayKey].status === 'ok') return todayKey;
    const ld = latest && latest.latestDay;
    if (ld && lastDays(todayKey, DAYS_SHOWN).includes(ld)) return ld;
    return todayKey;
}

/** 그날 상태 문구(결과가 없을 때) */
export function dayMessage(entry) {
    if (!entry) return '이 날짜의 추천이 없습니다';
    if (entry.status === 'rest') return '쉬는 날이라 추천을 만들지 않았습니다';
    if (entry.status === 'fail') return '이 날짜의 추천을 만들지 못했습니다(PC 로케이션추천 로그 확인)';
    if (entry.status === 'ok') return '';
    return '이 날짜의 추천이 없습니다';
}

/** 엑셀 파일 이름 */
export function fileNameOf(tab, key) {
    return `로케이션변경추천리스트_자동_${TAB_LABEL[tab] || '단독'}_${key}.xlsx`;
}

/**
 * 접힌 띠 한 줄 요약(js/locrec-card.js) → { verdict:{label,tone}, dayText, n, newN, msg, tone, warns:[] }
 *   n = 그날 추천 중 숨기지 않은('안 함' 아닌) 행 수(세 탭 합) · newN = 그중 상태 '새로'. parsed 를 아직 못 읽었으면 n·newN null.
 *   dayText = 오늘이면 '오늘', 아니면 '10/18(일)'(오늘 결과가 없어 최신 날짜를 보여 줄 때).
 *   msg = 그날 결과가 없을 때 문구(dayMessage). warns = 자료 경고(dataWarnings) + 표 자료 오류 + extraWarns.
 */
/**
 * 그날 추천 전체(단독 → 맞바꾸기 → 페어 순, 탭 안은 순위 순) 중 숨기지 않은('안 함' 아닌) 행 → [{r, st}]
 * 접힌 띠의 건수와 띠 [엑셀 받기](전체 한 파일)가 같은 목록을 쓴다.
 */
export function stripRows({ latest, key, todayKey, parsed, marks, nowMs }) {
    if (!parsed) return [];
    const open = (latest && latest.open) || {};
    const mk = marks || {};
    const out = [];
    TABS.forEach(t => (Array.isArray(parsed[t]) ? parsed[t] : []).forEach(r => {
        if (r.carried) return;                                     // 이월 행은 건수·엑셀에서 뺀다
        const st = rowState({ row: r, open: open[r.recKey], mark: mk[r.recKey], viewDay: key, todayKey, nowMs });
        if (!st.hidden) out.push({ r, st });
    }));
    return out;
}

/** 띠에서 받는 전체 엑셀 이름(탭별 파일과 구분) */
export function fileNameAll(key) {
    return `로케이션변경추천리스트_자동_전체_${key}.xlsx`;
}

export function recStrip({ latest, key, todayKey, parsed, marks, nowMs, extraWarns }) {
    const e = (latest && latest.days && latest.days[key]) || null;
    const verdict = verdictBadge(e && e.verdict, latest && latest.observeUntil);
    const warns = dataWarnings(latest, nowMs);
    (Array.isArray(extraWarns) ? extraWarns : []).forEach(w => { if (str(w).trim()) warns.push(str(w).trim()); });
    const dayText = key === todayKey ? '오늘' : (normDay(key) ? dayLabel(key) : '');
    const msg = dayMessage(e);
    const base = { verdict, dayText, n: null, newN: null, msg, tone: msg && e && e.status === 'fail' ? 'warn' : '', warns };
    if (msg || !parsed) return base;
    if (parsed.error) warns.push(parsed.error);
    const rows = stripRows({ latest, key, todayKey, parsed, marks, nowMs });
    return { ...base, n: rows.length, newN: rows.filter(x => x.st.label === '새로').length };
}

/**
 * 업무 예상 '로케이션 동선관리' 수량에 쓸 추천 날짜(js/ui-history-prediction.js) → 'YYYYMMDD' 또는 ''(쓸 추천 없음)
 *   대상 날짜 추천이 ok 면 그날. 대상이 오늘 이후(미래·06:40 전 오늘)면 latestDay(ok 이고 최근 DAYS_SHOWN 일 안, 대상보다 앞)를 쓴다.
 *   지난 날짜는 그날 것만(다른 날 추천을 끌어오지 않는다).
 */
export function pickRecDay(latest, targetKey, todayKey) {
    const days = (latest && latest.days) || {};
    const t = normDay(targetKey), today = normDay(todayKey);
    if (!t || !today) return '';
    if (days[t] && days[t].status === 'ok') return t;
    if (t < today) return '';
    const ld = normDay(latest && latest.latestDay);
    if (!ld || ld > t || !days[ld] || days[ld].status !== 'ok') return '';
    return lastDays(today, DAYS_SHOWN).includes(ld) ? ld : '';
}

/** 이월 행 중 그날 일한 몫으로 세는 상태(서버 done·progress · 직원 처리함 표시) — recCount */
const CARRIED_WORK_LABELS = new Set(['처리됨', '진행 중', '처리함 표시', '표시는 됐지만 위치 미반영']);

/**
 * 그날 추천 건수 — 접힌 띠 'N건'(stripRows)과 같은 기준('안 함' 숨김 제외, 세 탭 합). 표 자료가 없거나 깨졌으면 null
 *   + 이월 행 중 처리됨·진행 중·처리함 표시 — 아침 판에서 이 행들도 셌으므로, 다시 만들기만으로 업무 예상 건수가 줄지 않게.
 *   (띠·엑셀·탭 숫자에서는 이월 행을 계속 뺀다)
 */
export function recCount({ latest, key, todayKey, parsed, marks, nowMs }) {
    if (!parsed || parsed.error) return null;
    const open = (latest && latest.open) || {};
    const mk = marks || {};
    let carriedN = 0;
    TABS.forEach(t => (Array.isArray(parsed[t]) ? parsed[t] : []).forEach(r => {
        if (!r.carried) return;
        const st = rowState({ row: r, open: open[r.recKey], mark: mk[r.recKey], viewDay: key, todayKey, nowMs });
        if (!st.hidden && CARRIED_WORK_LABELS.has(st.label)) carriedN++;
    }));
    return stripRows({ latest, key, todayKey, parsed, marks, nowMs }).length + carriedN;
}

/**
 * 업무 예상 '로케이션 동선관리' 값에 추천 건수를 입힌다(js/ui-history-prediction.js locRecValueFor) → 새 결과 또는 null(base 그대로)
 *   base = 기존 자동 추정 { value, source, detail, dayValue?, prob?, uncertain? } — 하는 날·안 하는 날 판정은 base 그대로 둔다.
 *   info = { days, latestDay, day, n } (읽은 추천) · null 이면 null.
 *   하는 날(base.value > 0) → { value: n, source: 'locrec', dayValue: n } (n 이 0 이면 0)
 *   안 하는 날·애매한 날(값 0, dayValue > 0) → 값·uncertain 그대로, dayValue 만 n
 *   그 밖(공휴일 holiday-off 등 dayValue 없음)·쓸 추천 날짜가 info.day 와 다름(지난 날짜 등) → null
 *   ⚠️ 추천은 밀린 목록이라 오늘 이후 하는 날마다 같은 건수가 깔린다 — 주간 합계는 실제보다 클 수 있다(사용자 요구대로 둠).
 */
export function applyLocRecCount(base, info, targetKey, todayKey) {
    if (!base || !info || !Number.isFinite(Number(info.n))) return null;
    const day = pickRecDay({ days: info.days, latestDay: info.latestDay }, targetKey, todayKey);
    if (!day || day !== info.day) return null;
    const n = Math.max(0, Math.round(Number(info.n)));
    const note = `로케이션 변경 추천 ${n.toLocaleString('ko-KR')}건(${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} 추천, 안 함 제외) — 하는 날 판정은 지난 기록 빈도`;
    if ((Number(base.value) || 0) > 0) {
        return { value: n, source: 'locrec', prob: base.prob, dayValue: n,
                 detail: note + (base.detail ? `\n\n[하는 날 판정]\n${base.detail}` : '') };
    }
    if ((Number(base.dayValue) || 0) > 0) {
        return { ...base, dayValue: n, detail: (base.detail ? `${base.detail}\n` : '') + `진행한다면 ${note}` };
    }
    return null;
}

/** 탭 행 수 요약(이월 행 제외 — 카드·띠 건수와 같은 기준. 이월은 tabCarried 로 따로) */
export function tabCounts(parsed) {
    const p = parsed || {};
    return Object.fromEntries(TABS.map(t => [t, Array.isArray(p[t]) ? p[t].filter(r => !(r && r.carried)).length : 0]));
}

/** 탭별 이월 행 수 — 표 탭에 '(+이월 N)' 으로 따로 보인다 */
export function tabCarried(parsed) {
    const p = parsed || {};
    return Object.fromEntries(TABS.map(t => [t, Array.isArray(p[t]) ? p[t].filter(r => r && r.carried).length : 0]));
}

/**
 * 펼친 본문 요약 줄 '단독 n · 맞바꾸기 n · 페어 n, 새로 k' → { counts:{single,swap,pair}, total, newN, hiddenN }
 *   counts·total·newN 은 숨기지 않은('안 함' 아닌) 행만 — 띠 건수(stripRows)와 같은 기준. hiddenN = 숨긴 행 수(세 탭 합).
 */
export function tabSummary({ latest, key, todayKey, parsed, marks, nowMs }) {
    const counts = Object.fromEntries(TABS.map(t => [t, 0]));
    if (!parsed) return { counts, total: 0, newN: 0, hiddenN: 0 };
    const open = (latest && latest.open) || {};
    const mk = marks || {};
    let newN = 0, hiddenN = 0;
    TABS.forEach(t => (Array.isArray(parsed[t]) ? parsed[t] : []).forEach(r => {
        if (r.carried) return;                                     // 이월 행은 요약에서 뺀다
        const st = rowState({ row: r, open: open[r.recKey], mark: mk[r.recKey], viewDay: key, todayKey, nowMs });
        if (st.hidden) { hiddenN++; return; }
        counts[t]++;
        if (st.label === '새로') newN++;
    }));
    return { counts, total: TABS.reduce((s, t) => s + counts[t], 0), newN, hiddenN };
}

/**
 * 표 창 [전체 처리함] 대상 — 지금 탭의 [{r, st}] 중 아직 표시가 없고 처리할 수 있는 추천의 recKey.
 *   빼는 것: 숨긴 행(안 함) · 이미 표시한 행 · 서버가 확인한 '처리됨' · '만료' · '자리 바뀜'(옮길 대상이 사라짐) · 이월 행.
 */
export function bulkDoneKeys(items) {
    const skip = new Set(['처리됨', '만료', '자리 바뀜']);
    return (Array.isArray(items) ? items : [])
        .filter(x => x && x.r && x.r.recKey && !x.r.carried && x.st && !x.st.hidden && !x.st.mark && !skip.has(x.st.label))
        .map(x => x.r.recKey);
}

/** [처리함]/[안 함]/되돌리기를 누를 수 있는 날짜 — 처음 보여 주는 날짜(defaultDay: 오늘, 오늘 결과가 없으면 최신)만. 지난 날짜는 볼 수만 */
export function canMark(latest, key, todayKey) {
    return !!key && key === defaultDay(latest, todayKey);
}

/**
 * 표 창 메타 줄 — 지금 탭의 [{st}] 목록 → '단독 12행 · 처리됨 2 · 처리함 표시 3 · 안 함 1(숨김)'
 *   처리됨 = 서버가 위치 변화를 확인 · 처리함 표시 = 직원 표시(위치 미반영 포함) · 안 함 = 숨긴 행.
 */
export function tabMeta(tab, items) {
    const list = Array.isArray(items) ? items : [];
    const cnt = (f) => list.filter(x => x && x.st && f(x.st)).length;
    const done = cnt(s => s.label === '처리됨');
    const marked = cnt(s => s.label === '처리함 표시' || s.label === '표시는 됐지만 위치 미반영');
    const hidden = cnt(s => s.hidden);
    const parts = [`${TAB_LABEL[tab] || TAB_LABEL.single} ${list.length}행`];
    if (done) parts.push(`처리됨 ${done}`);
    if (marked) parts.push(`처리함 표시 ${marked}`);
    if (hidden) parts.push(`안 함 ${hidden}(숨김)`);
    return parts.join(' · ');
}

/**
 * 로케이션 표시 — 칸수가 있으면 '★★-003(4)', 없으면 '★★-003'(데이터 리스트 엑셀 '로케이션1' 과 같은 모양). 자리가 없으면 ''.
 */
export function locLabel(id, size) {
    const i = str(id).trim(), s = str(size).trim();
    if (!i) return '';
    return s ? `${i}(${s})` : i;
}

/**
 * 표 한 추천의 상품 줄 — 단독은 1줄, 맞바꾸기·페어(code2 있음)는 2줄 [A, B].
 *   줄 = { code, name, option, from, to, fromSize, toSize, qty, daily, reserve }. 표는 줄마다 <tr> 하나(상품·현재·추천·이동수량·일출고), 순위·이득·상태·표시는 rowspan.
 */
export function rowLines(r) {
    if (!r || typeof r !== 'object') return [];
    const pick = (s) => ({ code: r['code' + s], name: r['name' + s], option: r['option' + s], from: r['from' + s], to: r['to' + s],
        fromSize: str(r['fromSize' + s]).trim(), toSize: str(r['toSize' + s]).trim(),
        qty: r['qty' + s] == null ? null : r['qty' + s], daily: r['daily' + s] == null ? null : r['daily' + s],
        reserve: r['reserve' + s] == null ? null : r['reserve' + s] });
    const lines = [pick('')];
    if ((r.type === 'swap' || r.type === 'pair') && r.code2) lines.push(pick('2'));
    return lines;
}

export const RESERVE_HINT = '비축에서 채워 함께 옮기기';
export const RESERVE_HINT_MAX = 3;      // 이동수량이 이만큼 이하(또는 일출고 이하)면 안내를 붙인다

/**
 * 이동수량 칸 — { text: '1개', reserve: '비축 29' | '', hint: '' | RESERVE_HINT, title }.
 *   비축이 0·없음(옛 문서 포함)이면 지금처럼 '1개'만. 피킹 수량이 적고(≤ 일출고 또는 ≤ 3) 비축이 있으면 짧은 안내.
 */
export function qtyCellOf(line) {
    const l = line || {};
    const q = num(l.qty), rv = num(l.reserve), d = num(l.daily);
    const n0 = (v) => v.toLocaleString('ko-KR');                     // 표의 다른 숫자 칸과 같은 모양
    const text = q == null ? '' : `${n0(q)}개`;
    if (!(rv > 0)) return { text, reserve: '', hint: '', title: '옮길 수량' };
    const hint = q != null && q > 0 && (q <= RESERVE_HINT_MAX || (d != null && q <= d)) ? RESERVE_HINT : '';
    return { text, reserve: `비축 ${n0(rv)}`, hint, title: `옮길 수량(피킹 자리) · 비축 ${n0(rv)}개${hint ? ` — ${hint}` : ''}` };
}

// ── 다시 만들기 ──────────────────────────────────────────────────────────────
export const REBUILD_LABEL = '지금 기준으로 다시 만들기';
export const CARRIED_LABEL = '(지금 기준 추천에서 빠짐)';
export const REQ_OPEN_MIN = 7 * 60, REQ_CLOSE_MIN = 18 * 60 + 50;   // 요청 받는 시각 07:00~18:50 — 서버 다시만들기.py REQ_OPEN_MIN·REQ_CLOSE_MIN 과 같게
export const REQ_HOURS_TEXT = '07:00~18:50';                          // (서버 마지막 확인 18:55 — 마감 직전 요청도 처리된다)
export const REQ_PENDING_MS = 15 * 60 * 1000;               // 요청이 이만큼 처리되지 않으면 'PC 가 꺼져 있을 수 있음'
export const REQ_RUNNING_MS = 25 * 60 * 1000;               // 다시 만드는 중이 이만큼 그대로면 멈춘 것 — 서버 다시만들기.py RUNNING_STALE_MS 와 같게
export const REQ_NOTE_MS = 60 * 60 * 1000;                  // 거절·실패·대기 사유를 보여 주는 시간
export const AUTO_NOTE = '재고 자료가 새로 올라왔습니다 — 몇 분 안에 자동으로 다시 만듭니다';
const DEF_REQ = { max: 6, cooldownMin: 15, autoMax: 3 };    // 서버 설정.json rerun 기본값(req 칸이 없을 때)

/**
 * [지금 기준으로 다시 만들기] 버튼 상태 → { show, enabled, label, note, tone('' | accent | warn) }
 *   req = locRecLatest.req · requestMs = locRecWork/request 의 requestedAt(ms, 없으면 0) · entry = locRecLatest.days[오늘]
 *   lastDataMs = Locations/INFO_CONFIG.lastDataUpdate(재고 엑셀 올린 시각) · stockDataMs = locRecLatest.stockDataAt(지금 판의 기준)
 *   서버 규칙(다시만들기.decide)과 같게: 오늘 · 정기 판(ok|fail) 뒤 · 07:00~18:50 · 하루 max · cooldownMin 간격(직전 실패면 면제).
 *   phase·stage·startedMs·waitUntil·doneMs 는 refill-view.js reqUi 와 같은 뜻(머리줄 진행 띠용).
 */
export function recReqUi({ req, requestMs, nowMs, isToday, entry, lastDataMs, stockDataMs, todayKey }) {
    const label = REBUILD_LABEL;
    const r = req && typeof req === 'object' ? req : {};
    const sameDay = r.day === todayKey;
    const atMs = tsMs(r.at);
    const doneMs = sameDay ? tsMs(r.doneAt) : 0;          // 실제 다시 만들기 완료 시각(서버) — 없으면 완료 표시 안 함
    const res = (enabled, note = '', tone = '', extra = {}) => ({ show: true, enabled, label, note, tone, phase: '', doneMs, ...extra });
    if (!isToday) return { show: false, enabled: false, label, note: '', tone: '', phase: '', doneMs: 0 };
    const status = entry && entry.status;
    if (status === 'rest') return res(false, '쉬는 날에는 다시 만들지 않습니다');
    if (status !== 'ok' && status !== 'fail') return res(false, '06:40 정기 추천 뒤에 다시 만들 수 있습니다');
    const lastMs = tsMs(r.lastReqAt);
    const intOr = (v, d) => (Number.isInteger(v) ? v : d);
    const max = intOr(r.max, DEF_REQ.max), autoMax = intOr(r.autoMax, DEF_REQ.autoMax);
    const cool = intOr(r.cooldownMin, DEF_REQ.cooldownMin) * 60 * 1000;
    const autoN = sameDay ? intOr(r.autoCount, 0) : 0;
    const dataMs = tsMs(lastDataMs);
    const autoPending = dataMs > 0 && dataMs > Math.max(tsMs(stockDataMs), tsMs(r.autoStockAt)) && autoN < autoMax;
    const withAuto = (o) => (autoPending && o.tone !== 'warn'
        ? { ...o, note: AUTO_NOTE + (o.note ? ` · ${o.note}` : ''), tone: o.tone || 'accent', phase: o.phase || 'pending' } : o);
    // 1) 다시 만드는 중 — 25분(서버가 멈춘 것으로 보는 시간) 넘게 그대로면 PC 가 꺼졌을 수 있다(다음 요청 허용)
    if (r.state === 'running' && sameDay && nowMs - atMs < REQ_RUNNING_MS) {
        return res(false, r.source === 'auto' ? '재고 자료가 새로 올라와 자동으로 다시 만드는 중… (보통 3~6분)' : '다시 만드는 중… (보통 3~6분)', 'accent',
            { phase: 'running', stage: typeof r.stage === 'string' ? r.stage : '', startedMs: tsMs(r.startedAt) || atMs });
    }
    // 2) 대기 — 서버가 남긴 사유, 서버 상태가 아직 없으면 화면이 계산(쉬는 시간·올린 직후) — refill-view.js waitInfo
    const pending = requestMs > 0 && requestMs > lastMs;
    const count = sameDay ? intOr(r.count, 0) : 0;
    const started = sameDay ? tsMs(r.startedAt) : 0;
    const failedLast = r.state === 'failed' || r.lastRun === 'failed';
    const cooling = !!started && nowMs - started < cool && !failedLast;
    const w = waitInfo({ r, sameDay, nowMs, pending, autoPending, dataMs, cooling, reqOk: count < max });
    if (w) return res(false, `대기 중 — ${w.note}`, '', { phase: 'waiting', waitUntil: w.until });
    if (pending && nowMs - requestMs < REQ_PENDING_MS) {
        return res(false, '요청함 — 처리 대기 중 (이 PC 프로그램이 5분마다 확인)', 'accent', { phase: 'pending' });
    }
    const k = kstParts(nowMs);
    const hm = k.hh * 60 + k.mm;
    const recentNote = sameDay && (r.state === 'rejected' || r.state === 'failed') && r.note && nowMs - atMs < REQ_NOTE_MS;
    const lastNote = () => res(true, r.state === 'failed' ? `다시 만들지 못했습니다: ${r.note}` : `지난 요청이 처리되지 않았습니다: ${r.note}`,
        'warn', { phase: r.state });
    if (hm < REQ_OPEN_MIN || hm >= REQ_CLOSE_MIN) {
        // 마감 뒤에도 방금 거절된 사유(예: 서버 '마감 — 내일 다시 요청하세요')는 보여 준다
        return recentNote ? { ...lastNote(), enabled: false } : res(false, `${REQ_HOURS_TEXT}에만 다시 만들 수 있습니다`);
    }
    if (count >= max) return withAuto(res(false, `오늘 다시 만들기 한도(${max}회)를 다 썼습니다`));
    if (cooling) {
        return withAuto(res(false, `${fmtHM(started + cool)} 이후 다시 만들 수 있습니다(${cool / 60000}분 간격)`));
    }
    if (pending) return res(true, '요청이 15분 넘게 처리되지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn', { phase: 'stale' });
    if (r.state === 'running' && sameDay) {
        return res(true, '다시 만들기가 25분 넘게 끝나지 않았습니다 — PC 가 꺼져 있을 수 있습니다', 'warn', { phase: 'stale' });
    }
    if (recentNote) return lastNote();
    return withAuto(res(true));
}

/**
 * 그날 추천 문서 → 기준 줄 { text, head, layout, stock, warn }
 *   '10:42 다시 만듦 · 배치: 업로드 10/26 10:31 · 재고: 이지어드민 10:40' (정기 판은 '06:40 만듦 · …', 자동은 '자동으로 다시 만듦')
 *   warn = 재고가 업로드 기준(서버가 이지어드민 재고를 못 받아 대체 — basedOn.stockSource 'upload')이면 true → 노랗게.
 *   stockSource 가 없는 옛 문서(이지어드민 재고를 쓰기 전)는 '재고: 업로드 …' 로 두고 노랗게 하지 않는다.
 */
export function rebuildLine(doc) {
    const d = doc && typeof doc === 'object' ? doc : {};
    const b = d.basedOn && typeof d.basedOn === 'object' ? d.basedOn : {};
    const atMs = tsMs(d.at);
    const rev = Number.isInteger(d.rev) ? d.rev : 0;
    const head = atMs ? `${fmtHM(atMs)} ${rev > 0 ? (d.source === 'auto' ? '자동으로 다시 만듦' : '다시 만듦') : '만듦'}` : '';
    const up = fmtMDHM(stockAtOf(b) || tsMs(d.stockDataAt));
    const layout = up ? `배치: 업로드 ${up}` : '';
    const ez = b.stockSource === 'ezadmin' && tsMs(b.ezStockAt);
    const stock = ez ? `재고: 이지어드민 ${fmtHM(b.ezStockAt)}` : `재고: 업로드 ${up || '시각 없음'}`;
    const warn = b.stockSource === 'upload';
    return { text: [head, layout, stock].filter(Boolean).join(' · '), head, layout, stock, warn };
}
