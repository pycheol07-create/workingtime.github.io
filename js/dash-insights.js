// === js/dash-insights.js — 대시보드 하단 세 카드(2026-11-26 사용자 선택: 1+3, 2, 7 을 한 줄로) ===
// '오늘의 업무 분석'(업무별 요약·개인별 통계 — 데이터 관리와 겹침) 자리를 대신한다.
//   ① 내일·이번 주 준비  — 업무 예상 엔진 getStaffingOutlook(데이터 관리 인력 운영·운영 계획과 같은 계산) 다음 업무일부터 5일
//   ② 오늘 시간대별 흐름 — 오늘 업무 기록(실시간 구독 값)으로 시간대별 투입 인원 + 누적 진행(오늘 진행 띠와 같은 %로 맞춤)
//   ③ 평소 속도 대비 오늘 — 처리량을 넣은 업무만: 오늘 시간당 처리량 ÷ 최근 기준 속도(UPH) × 100
// 새 Firestore 읽기 없음 — 오늘 진행 띠(js/widget-today-progress.js)가 실은 이력·예정 물량·보정 자료를 그대로 쓴다
// ('dash-forecast-ready' 이벤트를 받은 뒤 그린다). 이름은 보이지 않는다(인원 수·업무명·숫자만).
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { escapeHtml as esc, formatHM, getTodayDateString } from './utils.js?v=65bb3512764f-e315797c';
import { getStaffingOutlook, getTodayProgressSummary, getTodayTaskPaceInputs } from './ui-history-prediction.js?v=0e333fe7c86f-91ee5358';
import { canonicalTaskName } from './lib/task-ids.js?v=9c41e71742ef-83b1f46d';
import { hhmmToMin } from './lib/long-run.js?v=86da0817a440-f9ae51b8';
import { workMinutesBetween, paceDoneQty } from './lib/task-pace.js?v=da341b20b6b9-41f49a23';
import { morningAutoToday, morningForecastToday } from './ship-auto-sync.js?v=18944e3040fa-fe881227';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const md = (ds) => { const d = new Date(ds + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };
const n1 = (v) => (Math.round((Number(v) || 0) * 10) / 10).toString();
let ready = false, prepAt = 0, prepRows = null, wired = false;
const last = {};
const put = (id, html) => { const el = document.getElementById(id); if (el && last[id] !== html) { el.innerHTML = html; last[id] = html; } };
const empty = (msg) => `<p class="text-sm t-3 py-6 text-center">${esc(msg)}</p>`;

// ── ① 내일·이번 주 준비 ────────────────────────────────────────────
function tomorrowStr() {
    const d = new Date(getTodayDateString() + 'T00:00:00'); d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function renderPrep() {
    if (!prepRows || Date.now() - prepAt > 10 * 60 * 1000) {   // 무거운 계산(하루씩 모의) — 10분마다만
        try { prepRows = (getStaffingOutlook(5, { from: tomorrowStr() }) || []).filter(r => r && !r.failed); }
        catch (e) { console.warn('[dash-insights] 전망 실패:', e); prepRows = []; }
        prepAt = Date.now();   // 실패해도 10분은 다시 안 함(무거운 계산을 매번 되풀이하지 않게)
    }
    const rows = prepRows || [];
    if (!rows.length) return put('di-prep-body', empty('예상할 자료가 아직 없습니다'));
    const t = rows[0];
    const need = Number(t.rawRequiredFTE ?? t.requiredFTE) || 0, avail = Number(t.available) || 0, gap = avail - need;
    const tone = gap < -0.05 ? 't-risk' : gap < 0.5 ? 't-warn' : 't-ok';
    const top = Object.entries(t.taskHours || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const html = `
        <div class="text-xs t-3">${esc(md(t.date))}${t.holidayName ? ' · ' + esc(t.holidayName) : ''}${t.hasPlanned ? '' : ' · 예정 물량 없음(자동 추정)'}</div>
        <div class="flex items-end gap-4 mt-1">
            <div><div class="text-[11px] t-3">필요 / 가용</div><div class="text-[26px] font-semibold tabular-nums t-1 leading-tight">${esc(n1(need))}<span class="text-base t-3"> / ${esc(n1(avail))}명</span></div></div>
            <div class="pb-1"><div class="text-sm font-semibold ${tone}">${gap < -0.05 ? esc(n1(-gap)) + '명 부족' : '여유 ' + esc(n1(gap)) + '명'}</div><div class="text-[11px] t-3">휴가 ${esc(t.onLeave || 0)}명 반영 · 총 ${esc(formatHM(t.totalHours))}</div></div>
        </div>
        ${top.length ? `<div class="mt-3 space-y-1">${top.map(([k, h]) => `<div class="flex justify-between text-xs"><span class="t-2 truncate">${esc(k)}</span><span class="tabular-nums t-1">${esc(formatHM(h))}</span></div>`).join('')}</div>` : ''}
        ${rows.length > 1 ? `<div class="mt-3 pt-3 border-t d-line grid grid-cols-${Math.min(4, rows.length - 1)} gap-2">${rows.slice(1, 5).map(r => {
            const g = (Number(r.available) || 0) - (Number(r.rawRequiredFTE ?? r.requiredFTE) || 0);
            return `<div class="text-center rounded-lg px-1 py-1.5 ${g < -0.05 ? 'd-pill-risk' : 'd-sub'}"><div class="text-[11px] t-3">${esc(md(r.date))}</div><div class="text-sm font-semibold tabular-nums ${g < -0.05 ? 't-risk' : 't-1'}">${g < -0.05 ? '−' + esc(n1(-g)) : '+' + esc(n1(g))}</div></div>`;
        }).join('')}</div><div class="text-[11px] t-3 mt-1">이후 업무일 — 가용 − 필요(명)</div>` : ''}`;
    put('di-prep-body', html);
}

// ── ② 오늘 시간대별 흐름 ───────────────────────────────────────────
function activeMinutesInHour(rec, h0, h1, nowMin) {
    const s = hhmmToMin(rec.startTime); if (s == null) return 0;
    let e = rec.status === 'completed' ? hhmmToMin(rec.endTime) : nowMin; if (e == null) e = nowMin;
    const a = Math.max(s, h0), b = Math.min(e, h1, nowMin);
    if (b <= a) return 0;
    let paused = 0;
    for (const p of Array.isArray(rec.pauses) ? rec.pauses : []) {
        const ps = hhmmToMin(p && p.start); if (ps == null) continue;
        let pe = hhmmToMin(p && p.end); if (pe == null) pe = nowMin;
        paused += Math.max(0, Math.min(pe, b) - Math.max(ps, a));
    }
    return Math.max(0, b - a - paused);
}
function renderFlow(s, inp) {
    const recs = (State.appState.workRecords || []).filter(r => r && r.startTime);
    const d = new Date(); const nowMin = d.getHours() * 60 + d.getMinutes();
    if (!s || !s.started || !recs.length) return put('di-flow-body', empty('아직 시작된 업무가 없습니다'));
    const startMin = Math.min(...recs.map(r => hhmmToMin(r.startTime)).filter(v => v != null));
    const h0 = Math.floor(startMin / 60), hNow = Math.floor(nowMin / 60);
    const endH = Math.max(hNow, inp && inp.baseFinishMin != null ? Math.ceil(inp.baseFinishMin / 60) - 1 : hNow);
    const hours = []; let cumRaw = 0;
    for (let h = h0; h <= endH; h++) {
        const mins = h <= hNow ? recs.reduce((t, r) => t + activeMinutesInHour(r, h * 60, h * 60 + 60, nowMin), 0) : null;
        if (mins != null) cumRaw += mins / 60;
        // 평균 인원 = 그 시간대에 실제로 지난 분으로 나눈다(지금 시간대·첫 시간대가 낮게 보이지 않게)
        const span = Math.max(1, Math.min(nowMin, h * 60 + 60) - Math.max(h * 60, startMin));
        hours.push({ h, people: mins == null ? null : mins / span, cum: mins == null ? null : cumRaw });
    }
    // 누적 진행 = 오늘 진행 띠와 같은 %(제외 업무 등)로 맞춘다: 마지막 값이 s.pct 가 되게 비율로
    const scale = cumRaw > 0 ? (Number(s.pct) || 0) / cumRaw : 0;
    const planPct = (h) => {   // 정시까지 고르게 갔다면(점심 무시한 단순 기준)
        if (!inp || inp.baseFinishMin == null || inp.startMin == null) return null;
        const span = inp.baseFinishMin - inp.startMin; if (!(span > 0)) return null;
        return Math.max(0, Math.min(100, ((h * 60 + 60) - inp.startMin) / span * 100));
    };
    const W = 300, H = 120, pad = 18, n = hours.length, bw = (W - pad * 2) / n;
    const maxP = Math.max(4, ...hours.map(x => x.people || 0));
    const y = (pct) => H - 16 - (pct / 100) * (H - 30);
    const bars = hours.map((x, i) => x.people == null ? '' : `<rect x="${pad + i * bw + 2}" y="${H - 16 - (x.people / maxP) * (H - 30)}" width="${Math.max(2, bw - 4)}" height="${(x.people / maxP) * (H - 30)}" rx="2" fill="var(--c-accent-soft, #D7E3FA)"><title>${x.h}시 · 평균 ${n1(x.people)}명</title></rect>`).join('');
    const cumPts = hours.map((x, i) => x.cum == null ? null : `${pad + i * bw + bw / 2},${y(Math.min(100, x.cum * scale))}`).filter(Boolean).join(' ');
    const planPts = hours.map((x, i) => { const p = planPct(x.h); return p == null ? null : `${pad + i * bw + bw / 2},${y(p)}`; }).filter(Boolean).join(' ');
    const labels = hours.map((x, i) => (n <= 10 || i % 2 === 0) ? `<text x="${pad + i * bw + bw / 2}" y="${H - 3}" font-size="9" text-anchor="middle" fill="currentColor" opacity=".6">${x.h}</text>` : '').join('');
    const leftH = Math.max(0, (Number(s.planHours) || 0) - (Number(s.spentHours) || 0));
    // 남은 시간은 점심을 뺀 작업 시간(진행 띠·처리량 카드와 같은 workMinutesBetween). 지금 일하는 사람이 없으면(점심·쉬는 중) 계산하지 않는다
    const workers = Number(s.activeWorkers) || 0;
    const leftCap = inp && inp.baseFinishMin != null && workers > 0
        ? Math.max(0, workMinutesBetween(nowMin, inp.baseFinishMin, inp.skipLunch) / 60) * workers : null;
    const short = leftCap == null ? null : leftH - leftCap;
    put('di-flow-body', `
        <div class="grid grid-cols-2 gap-3">
            <div><div class="text-[11px] t-3">남은 일</div><div class="text-[20px] font-semibold tabular-nums t-1">${esc(formatHM(leftH))}</div></div>
            <div><div class="text-[11px] t-3">남은 시간 × 지금 ${esc(s.activeWorkers || 0)}명</div><div class="text-[20px] font-semibold tabular-nums t-1">${leftCap == null ? '—' : esc(formatHM(leftCap))}</div>
                ${short == null ? '' : `<div class="text-[11px] ${short > 0.25 ? 't-risk' : 't-ok'}">${short > 0.25 ? esc(formatHM(short)) + ' 모자람' : '정시 안에 가능'}</div>`}</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="w-full mt-2 t-2" role="img" aria-label="시간대별 투입 인원과 누적 진행">
            ${bars}
            ${planPts ? `<polyline points="${planPts}" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="4 4" stroke-width="1.5"/>` : ''}
            ${cumPts ? `<polyline points="${cumPts}" fill="none" stroke="var(--c-accent, #2F62C9)" stroke-width="2.2" stroke-linejoin="round"/>` : ''}
            ${labels}
        </svg>
        <div class="flex gap-3 text-[11px] t-3 mt-1 flex-wrap"><span>막대 = 시간대 평균 투입 인원(최대 ${esc(n1(maxP))}명)</span><span style="color:var(--c-accent,#2F62C9)">— 누적 진행 ${esc(s.pct)}%</span><span>- - 고르게 갔다면</span></div>`);
}

// ── ③ 평소 속도 대비 오늘 ─────────────────────────────────────────
function renderSpeed(inp) {
    if (!inp || !inp.tasks) return put('di-speed-body', empty('기준 속도를 불러오는 중입니다'));
    const auto = morningAutoToday();          // 아침 자동 입력값(처리할 양)은 실적이 아니다 — 처리량 카드와 같은 규칙
    const forecast = morningForecastToday();
    const q = {};
    const src = State.appState.taskQuantities || {};
    for (const k in src) { const t = canonicalTaskName(k, State.appConfig); if (!(t in q) || t === k) q[t] = Number(src[k]) || 0; }
    const rows = [];
    Object.entries(inp.tasks).forEach(([k, t]) => {
        const doneH = (Number(t.spentHours) || 0) - (Number(t.activeHours) || 0);   // 끝난 기록의 인시(처리량은 끝낼 때 들어온다)
        const { done: qty } = paceDoneQty(q[k], t.ended && !forecast.has(k) ? undefined : auto[k]);
        if (!(t.uph > 0) || !(qty > 0) || !(doneH >= 0.5)) return;
        rows.push({ k, v: Math.round((qty / doneH) / t.uph * 100) });
    });
    if (!rows.length) return put('di-speed-body', empty('처리량을 넣은 업무가 생기면 보입니다(업무를 끝낼 때 입력)'));
    rows.sort((a, b) => a.v - b.v);
    put('di-speed-body', rows.slice(0, 7).map(({ k, v }) => {
        const tag = v >= 110 ? ['빠름', 't-ok'] : v <= 90 ? ['느림', 't-risk'] : ['보통', 't-3'];
        const w = Math.min(100, v / 1.5);
        return `<div class="flex items-center gap-2 py-1.5 text-sm">
            <span class="w-20 truncate t-2">${esc(k)}</span>
            <span class="relative flex-1 h-2 rounded d-sub"><span class="absolute left-0 top-0 bottom-0 rounded" style="width:${w}%;background:var(--c-accent,#2F62C9)"></span><span class="absolute top-[-3px] bottom-[-3px]" style="left:${100 / 1.5}%;width:1.5px;background:currentColor;opacity:.4"></span></span>
            <span class="w-9 text-right tabular-nums t-1">${esc(v)}</span><span class="w-9 text-right text-xs font-semibold ${tag[1]}">${tag[0]}</span></div>`;
    }).join('') + '<div class="text-[11px] t-3 mt-1">최근 기준 속도 = 100 · 처리량을 넣은 업무만(끝난 기록 기준)</div>');
}

export function renderDashInsights() {
    if (!ready || document.hidden || !document.getElementById('dash-insights')) return;
    // 오늘 재료는 한 번만 구해 ②·③ 이 같이 쓴다(오늘 계획 모의 계산을 여러 번 돌리지 않게)
    let s = null, inp = null;
    try { s = getTodayProgressSummary(); } catch (_) {}
    try { inp = getTodayTaskPaceInputs(); } catch (_) {}
    for (const [fn, id] of [[() => renderPrep(), 'di-prep-body'], [() => renderFlow(s, inp), 'di-flow-body'], [() => renderSpeed(inp), 'di-speed-body']]) {
        try { fn(); } catch (e) { console.warn('[dash-insights]', id, e); put(id, empty('계산하지 못했습니다')); }
    }
}

/** 대시보드에서 한 번. 오늘 진행 띠가 그릴 때마다('dash-forecast-ready' — 자료 로드 뒤·1.5/4/8/15초·1분·탭 다시 보임) 같이 그린다. */
export function initDashInsights() {
    if (wired || !document.getElementById('dash-insights')) return;
    wired = true;
    document.addEventListener('dash-forecast-ready', () => { ready = true; renderDashInsights(); });
    window.addEventListener('forecast-correction-ready', () => { prepRows = null; renderDashInsights(); });
}
