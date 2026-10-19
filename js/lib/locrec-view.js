// === js/lib/locrec-view.js ===
// 로케이션관리 대시보드 '로케이션 변경 추천' 카드(js/locrec-card.js)의 순수 함수 — node --test 대상.
// 문서는 이 PC 프로그램(업무자동화\앱\로케이션추천)이 매일 06:40 쓴다. 모양(설계 로케이션추천_설계.md 1.6절):
//   integrations/locRecLatest       { schema, latestDay, days:{YYYYMMDD:{status: ok|rest|fail, n, gainSum, verdict}},
//                                     metrics:{top100Front(0~1), inversions, gainSum, gainSumPrevWeek, top100FrontPrevWeek?, inversionsPrevWeek?},
//                                     open:{recKey:{type, code, state: open|done|expired|stale|partial, firstDay, lastDay, alertedDay?, doneDay?}},
//                                     dataState:{daysCollected, pairDays?, lastOutDay, lastOrderDay, warnings:[], stockDataAt, locUpdatedAt}, settings }
//                                     stockDataAt = INFO_CONFIG.lastDataUpdate(재고 엑셀 올린 시각) — '재고 자료 기준'·오래됨 판단은 이것만.
//                                     locUpdatedAt(Locations 문서 갱신 시각)은 참고용이라 카드에서 쓰지 않는다.
//   integrations/locRec_YYYYMMDD    { rowsJson: JSON 문자열 {schema, single:[행], swap:[행], pair:[행]}, metrics, basedOn:{stockDataAt, …}, warn }
//                                     행 = 로케이션추천\추천실행.mjs(js/lib/loc-recommend.js runRecommend) 출력 행 그대로
//   locRecWork/marks                { marks:{recKey:{state: done|skip, by(직원 이름), at}} }   ← 직원이 쓴다
// import 는 같은 lib 의 refill-view.js(날짜·시각, KST)·loc-recommend.js(엑셀 5열) 만 — 같은 규칙을 두 벌 두지 않는다.

import { tsMs, dayKey, keyMs, lastDays, dayLabel, fmtHM, kstParts } from './refill-view.js?v=202610191548';
import { excelRows, EXCEL_COLS } from './loc-recommend.js?v=202610191548';

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
        qty: num(r.qty), daily: num(r.daily), gain: num(r.gain), capWarn: r.capWarn === true, pairNear: str(r.pairNear)
    };
    if (r.code2 != null && str(r.code2)) {
        Object.assign(out, { code2: str(r.code2), name2: str(r.name2), option2: str(r.option2), from2: str(r.from2), to2: str(r.to2),
            qty2: num(r.qty2), daily2: num(r.daily2) });
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

/** 탭 행 수 요약 */
export function tabCounts(parsed) {
    const p = parsed || {};
    return Object.fromEntries(TABS.map(t => [t, Array.isArray(p[t]) ? p[t].length : 0]));
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
        const st = rowState({ row: r, open: open[r.recKey], mark: mk[r.recKey], viewDay: key, todayKey, nowMs });
        if (st.hidden) { hiddenN++; return; }
        counts[t]++;
        if (st.label === '새로') newN++;
    }));
    return { counts, total: TABS.reduce((s, t) => s + counts[t], 0), newN, hiddenN };
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
