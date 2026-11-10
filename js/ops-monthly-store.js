// === js/ops-monthly-store.js ===
// 📆 월 요약 저장소(운영 계획 v2 D1) — 최상위 OpsMonthly/{YYYY-MM}. 규칙: firestore.rules 'OpsMonthly' 블록
//   읽기 = data.analysis 권한, 쓰기 = 관리자(builtAt = 서버 시각, builtBy = 나, 칸 허용 목록·금액/이름 금지), 삭제 금지.
//   읽기: localStorage 1일 캐시(opsMonthlyCache) — 연간 탭 1회 36문서 이하, 한 번의 범위 쿼리.
//   자동 쓰기(관리자): 운영 계획을 열면 끝난 달 중 요약이 없거나 schema 가 옛것인 달 + 끝난 지 7일 안 된 지난달을, 이미 메모리에 있는 이력(13개월)으로 만든다(추가 읽기 없음).
//     값이 저장본과 같으면 쓰지 않는다(sameSummary). 휴무는 근태 일정(State.persistentLeaveSchedule — 읽기만)을 두 경로 같은 기준으로 펼친다.
//   [월 요약 다시 만들기](관리자): 그 달 원본 history 만(≈30문서) 다시 읽어 만든다.
// ⚠️ 금액·직원 이름 없음(js/lib/plan-monthly.js 가 골라 담은 것만). 콘솔에 문서 본문을 찍지 않는다.

import { doc, collection, getDocs, query, where, documentId, setDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import * as State from './state.js?v=202611100906';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611100906';
import { baselineSpeeds } from './lib/ops-metrics.js?v=202611100906';
import { monthlySummaryOf, needRebuild, finishedMonths, monthDates, sameSummary, MONTHLY_SCHEMA } from './lib/plan-monthly.js?v=202611100906';
import { getTodayDateString } from './utils.js?v=202611100906';

export const MONTHLY_COL = 'OpsMonthly';
const CACHE_KEY = 'opsMonthlyCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const myEmail = () => String((State.auth && State.auth.currentUser && State.auth.currentUser.email) || '').toLowerCase();
const isAdmin = () => !!(State.appState && State.appState.currentUserRole === 'admin');

function readCache() {
    try {
        const o = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (o && o.at && Date.now() - o.at < CACHE_TTL_MS && o.docs) return o;
    } catch (e) { /* 깨진 캐시는 무시 */ }
    return null;
}
function writeCache(docs, range) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), range, docs })); } catch (e) { /* 용량 — 캐시 없이 */ }
}
/** 캐시 비우기(다시 만들기 뒤) */
export const clearMonthlyCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* */ } };

// builtAt(Timestamp)은 캐시에 숫자(ms)로 — JSON 으로 못 넣는다
const plain = (d) => { const o = { ...d }; if (o.builtAt && typeof o.builtAt.toMillis === 'function') o.builtAt = o.builtAt.toMillis(); return o; };

/**
 * 월 요약 읽기 — yms(YYYY-MM 목록, 정렬 안 돼도 됨). 캐시가 그 범위를 덮으면 읽지 않는다.
 * @returns {Promise<Array>} 있는 달의 문서(ym 순). 권한이 없거나 실패하면 [](경고만).
 */
export async function loadMonthlies(yms, { force = false } = {}) {
    const want = [...new Set((yms || []).filter(Boolean))].sort();
    if (!want.length) return [];
    const from = want[0], to = want[want.length - 1];
    const c = !force ? readCache() : null;
    if (c && c.range && c.range[0] <= from && c.range[1] >= to) return want.map(y => c.docs[y]).filter(Boolean);
    try {
        const snap = await getDocs(query(collection(State.db, MONTHLY_COL), where(documentId(), '>=', from), where(documentId(), '<=', to)));
        // 오프라인이면 캐시(비었거나 일부) 결과가 온다 — 실패로 보고 캐시에 쓰지 않는다(이력 조회와 같은 확인)
        if (snap.metadata && snap.metadata.fromCache) throw Object.assign(new Error('월 요약 조회가 서버에 닿지 못함(오프라인)'), { code: 'offline' });
        const docs = {};
        snap.forEach(d => { docs[d.id] = plain(d.data()); });
        const prev = readCache();
        const merged = { ...((prev && prev.docs) || {}), ...docs };
        const range = prev && prev.range ? [prev.range[0] < from ? prev.range[0] : from, prev.range[1] > to ? prev.range[1] : to] : [from, to];
        writeCache(merged, range);
        return want.map(y => docs[y]).filter(Boolean);
    } catch (err) {
        console.warn('월 요약 읽기 실패:', err && err.code);
        return [];
    }
}

/** 그 달 예정 물량을 넣은 날 수 — plannedData/{날짜} 중 plannedQuantities 가 비지 않은 문서.
 *  메모리(State.plannedData — 보통 오늘 이후만 받는다)가 그 달을 덮으면 그것을 쓰고, 아니면 그 달만 읽는다(≈30문서). 실패하면 null(모름). */
async function plannedDaysOf(ym) {
    const dates = monthDates(ym);
    const has = (q) => q && Object.values(q).some(v => Number(v) > 0);
    const mem = (State.plannedData || []).filter(d => d && typeof d.id === 'string');
    const memFrom = mem.reduce((m, d) => (!m || d.id < m ? d.id : m), null);
    if (memFrom && memFrom <= dates[0]) return mem.filter(d => d.id.startsWith(ym + '-') && has(d.plannedQuantities)).length;
    try {
        const col = collection(State.db, 'artifacts', 'team-work-logger-v2', 'plannedData');
        const snap = await getDocs(query(col, where(documentId(), '>=', dates[0]), where(documentId(), '<=', dates[dates.length - 1])));
        if (snap.metadata && snap.metadata.fromCache) return null;
        let n = 0;
        snap.forEach(d => { const q = (d.data() || {}).plannedQuantities; if (q && Object.values(q).some(v => Number(v) > 0)) n++; });
        return n;
    } catch (e) { return null; }
}
// 입고(incoming): 입고일정 위젯 캐시는 최근 며칠 + 앞으로만 있어 지난달을 다 담지 못한다(과소·매일 바뀜).
//   그 달 전체 원본(예: 입고 이력 문서)이 생기기 전까지는 null 로 고정한다(schema 4). TODO: 입고 이력 원본이 생기면 연결.
/** 한 달 요약 만들기 — days 는 지금 이름 사본. 속도는 그 달 말일까지의 이력(allView)으로. 예정 물량 날 수는 plannedDaysOf. */
async function summaryFor(ym, days, allView, cfg) {
    const last = monthDates(ym).slice(-1)[0];
    const speeds = baselineSpeeds(allView, { until: last });
    const scheduleLeave = (State.persistentLeaveSchedule && State.persistentLeaveSchedule.onLeaveMembers) || [];
    return monthlySummaryOf(days, cfg, { ym, speeds, scheduleLeave, plannedDays: await plannedDaysOf(ym), incoming: null });
}
async function writeSummary(ym, body) {
    await setDoc(doc(State.db, MONTHLY_COL, ym), { ...body, builtAt: serverTimestamp(), builtBy: myEmail() });
}

/**
 * 관리자 자동 쓰기 — 끝난 달(최근 n개) 중 요약이 없거나 옛 schema 인 달을, 이미 메모리에 있는 이력으로 만든다.
 *   메모리 이력이 그 달 1일보다 늦게 시작하면(그 달 앞부분이 없음) 만들지 않는다 — 반쪽 요약을 남기지 않게.
 * @returns {Promise<{built:string[], skipped:string[]}>}
 */
export async function autoBuildMonthlies({ months = 13 } = {}) {
    if (!isAdmin()) return { built: [], skipped: [] };
    const today = getTodayDateString();
    const yms = finishedMonths(today, months);
    const have = await loadMonthlies(yms);
    const byYm = Object.fromEntries(have.map(d => [d.ym, d]));
    const cfg = State.appConfig || {};
    const view = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    const earliest = view.reduce((m, d) => (d && d.id && (!m || d.id < m) ? d.id : m), null);
    const built = [], skipped = [];
    for (const ym of yms) {
        if (!needRebuild(byYm[ym], { ym, today })) continue;
        if (!earliest || earliest > `${ym}-01`) { skipped.push(ym); continue; }
        const days = view.filter(d => d && typeof d.id === 'string' && d.id.startsWith(ym + '-'));
        if (!days.some(d => (d.workRecords || []).length || Object.keys(d.taskQuantities || {}).length)) { skipped.push(ym); continue; }
        try {
            const body = await summaryFor(ym, days, view, cfg);
            if (sameSummary(byYm[ym], body)) continue;   // 바뀐 값이 없으면 쓰지 않는다
            await writeSummary(ym, body);
            built.push(ym);
        } catch (err) {
            console.warn('월 요약 쓰기 실패:', ym, err && err.code);
            skipped.push(ym);
            break;   // 권한·연결 문제면 나머지도 실패한다
        }
    }
    if (built.length) clearMonthlyCache();
    return { built, skipped };
}

/** [월 요약 다시 만들기](관리자) — 그 달 원본 history 만(≈30문서) 다시 읽어 만든다. 이번 달·미래는 거부. */
export async function rebuildMonth(ym) {
    if (!isAdmin()) throw new Error('관리자만 다시 만들 수 있습니다');
    const today = getTodayDateString();
    if (!/^\d{4}-\d{2}$/.test(ym) || ym >= today.slice(0, 7)) throw new Error('끝난 달만 다시 만들 수 있습니다');
    const dates = monthDates(ym);
    const col = collection(State.db, 'artifacts', 'team-work-logger-v2', 'history');
    const snap = await getDocs(query(col, where(documentId(), '>=', dates[0]), where(documentId(), '<=', dates[dates.length - 1])));
    const raw = [];
    snap.forEach(d => raw.push({ id: d.id, ...d.data() }));
    const cfg = State.appConfig || {};
    const monthView = aliasHistoryView(raw, cfg) || [];
    // 평상시 속도는 메모리 이력(13개월) + 이 달 원본으로
    const memView = aliasHistoryView(State.allHistoryData || [], cfg) || [];
    const ids = new Set(monthView.map(d => d.id));
    const allView = memView.filter(d => !ids.has(d.id)).concat(monthView);
    const body = await summaryFor(ym, monthView, allView, cfg);
    await writeSummary(ym, body);
    clearMonthlyCache();
    return { ym, srcDocs: body.srcDocs, schema: MONTHLY_SCHEMA };
}
