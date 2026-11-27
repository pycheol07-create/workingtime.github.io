// === js/ui-ops-inbound-diff.js ===
// 📥 운영 리포트 '통계' 탭의 '입고 오차' 장(2026-11-27, 처음엔 따로 탭) — 부족수량관리 [입고 오차 통계]를 고른 기간(출고일)으로: 전체 요약(패킹·도착·입고·부족·과입고·오차율·미스캔),
//   추세 그래프(62일 이하 패킹별, 넘으면 월별), 패킹별 표, 상품코드 상위·공급처 코드 상위.
//   숫자는 js/lib/ops-inbound-diff.js(→ js/lib/inbound-diff.js 그대로), 읽기·캐시는 js/ops-inbound-diff-store.js. 탭 전환·권한은 js/ui-history-ops-report.js, 카드·장 펼침은 js/ui-ops-stats.js.
//   통계 칸이 보이고 '입고 오차' 장이 펼쳐져 있을 때만 그린다. 카드 숫자는 inboundSummary(같은 캐시, 기준은 결산과 같은 기본값 — 전체·미스캔 뺌).
//   보기 기준(전체/부족만/과입고만 · 미스캔 포함)은 화면에서만 바꾸고 다시 읽지 않는다(부족수량관리 통계와 같은 뜻).
//   권한: 탭은 데이터 관리 권한(data.analysis)일 때만. 규칙에 막히면 부족수량관리와 같은 '권한 없음' 문구.
// ⚠️ 공급처는 코드만, 저장자(직원)·저장 시각은 그리지 않는다. 콘솔에 상품·수량을 찍지 않는다. role=dialog·data-act 금지(업무마감봇 선택자).

import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';
import { D, alpha } from './d-chart.js?v=e918595219dd-dfe55644';
import { periodBounds, daysIncl } from './lib/ops-supplies.js?v=f5cbd8a554cf-1a2dc6de';
import { buildInboundDiffReport, IDF_KINDS, INBOUND_DIFF_DENIED, INBOUND_DIFF_MAX_DOCS } from './lib/ops-inbound-diff.js?v=624ad11b88d5-b9e1dbc8';
import { mdw } from './lib/supplies-forecast-view.js?v=c308b964945e-6e807d3e';
import { loadInboundDiffRange, invalidateInboundDiffData } from './ops-inbound-diff-store.js?v=0402b716870d-b56c6daa';

const $ = (id) => document.getElementById(id);
const ok = (v) => v != null && isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
const pct = (v) => (ok(v) ? (Math.round(v * 1000) / 10).toFixed(1) : '—');
const kpi = ({ label, value, unit = '', sub = '', title = '' }) => `<div class="opv-kpi"${title ? ` title="${esc(title)}"` : ''}>
    <div class="opv-kpi-label">${esc(label)}</div>
    <div class="opv-kpi-value">${value}${value === '—' || !unit ? '' : `<span class="opv-kpi-unit">${esc(unit)}</span>`}</div>
    ${sub ? `<div class="opv-note">${sub}</div>` : ''}
</div>`;
const card = (title, body, hint = '') => `<div class="opv-card">
    <div class="opv-card-head"><h4 class="opv-h">${esc(title)}</h4>${hint ? `<span class="opv-note">${hint}</span>` : ''}</div>
    ${body}
</div>`;
const empty = (msg) => `<div class="opv-empty">${esc(msg)}</div>`;

let chart = null;
let token = 0;
let loading = false;
let view = { kind: 'all', includeNoScan: false };   // 보기 기준(화면 안에서만)
let last = null;      // { ctx, range, data } — 보기 기준만 바꿀 때 다시 읽지 않고 다시 그린다

export function destroyInboundDiffCharts() {
    if (chart) { try { chart.destroy(); } catch (e) { /* */ } chart = null; }
}
export const isInboundDiffLoading = () => loading;
/** 장을 떠날 때(장 접기·다른 탭 등) — 읽는 중인 결과를 버리고 차트를 정리(다시 펼치면 다시 그림, 캐시라 다시 읽지 않음) */
export function leaveOpsInboundDiff() {
    token++;
    loading = false;
    destroyInboundDiffCharts();
}
const paneShown = () => {
    const p = $('ops-stats-panel'), sec = $('ops-stats-sec-inbound');
    return !!p && !p.classList.contains('hidden') && !!sec && sec.open;
};
let onReload = () => {};
/** [새로 읽기] 뒤 부를 함수(통계 카드 다시 그리기 — js/ui-ops-stats.js) */
export function setInboundReloadHook(fn) { onReload = typeof fn === 'function' ? fn : () => {}; }

/**
 * 통계 카드용 숫자 — { ok, denied?, packs, rate(비율 0~1 | null), short, over, full }. 기준 = 전체·미스캔은 오차에서 뺌(결산 장과 같음).
 *   권한·기간·연결이 없으면 null.
 */
export async function inboundSummary(ctx = {}) {
    if (!ctx.canInbound || !State.db) return null;
    const range = periodBounds(ctx.gran, ctx.key);
    if (!range) return null;
    const data = await loadInboundDiffRange(State.db, range);
    if (!data.ok) return { ok: false, denied: !!data.denied };
    const g = buildInboundDiffReport(data.records, { ...range, kind: 'all', includeNoScan: false, days: daysIncl(range.from, range.to) }).overall;
    return { ok: true, packs: g.packs, rate: g.rate, short: g.short, over: g.over, full: !!data.full };
}

function controlsHtml() {
    return `<div class="opv-card-head" style="margin-bottom:0">
        <label class="opv-note">보기 <select data-idf-kind="1" class="opv-btn">${Object.entries(IDF_KINDS).map(([k, l]) =>
            `<option value="${esc(k)}"${view.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="opv-note"><input type="checkbox" data-idf-noscan="1"${view.includeNoScan ? ' checked' : ''}> 미스캔도 오차로</label>
        <button type="button" class="opv-btn" data-idf-reload="1" title="입고 오차 기록을 서버에서 다시 읽습니다">새로 읽기</button>
    </div>`;
}

function kpisHtml(m) {
    const g = m.overall;
    return `<div class="opv-kpis">
        ${kpi({ label: '패킹(출고일)', value: n0(g.packs), unit: '건', sub: g.bundles ? `묶음 줄 ${esc(n0(g.bundles))}` : '' })}
        ${kpi({ label: '도착 / 입고', value: `${esc(n0(g.arr))}<span class="opv-kpi-unit">/ ${esc(n0(g.conf))}</span>` })}
        ${kpi({ label: '오차 품목', value: n0(g.errN), unit: '품목', sub: `부족 <b class="opv-down">${esc(n0(g.short))}</b> · 과입고 <b class="opv-up">${esc(n0(g.over))}</b>` })}
        ${kpi({ label: '오차율', value: pct(g.rate), unit: '%', title: '|차이| 합 ÷ 도착 합(미스캔을 빼면 그 도착수량도 분모에서 뺌)' })}
        ${kpi({ label: '미스캔', value: n0(g.noScanN), unit: '품목', sub: `${esc(n0(g.noScanQ))}장 · ${m.opts.includeNoScan ? '오차에 포함' : '오차에서 뺌'}` })}
    </div>`;
}

function trendHtml(m) {
    if (m.trend.labels.length < 2) return '';
    return card('입고 오차 추세', '<div class="opv-chart"><canvas id="ops-chart-inbound"></canvas></div>',
        m.trend.unit === 'ship' ? '패킹(출고일)별' : '월별(패킹의 마지막 출고일 기준)');
}
function drawTrend(m) {
    const canvas = $('ops-chart-inbound');
    if (!canvas || typeof Chart === 'undefined') return;
    destroyInboundDiffCharts();
    chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: m.trend.labels,
            datasets: [
                { label: '부족', data: m.trend.short, backgroundColor: D.risk, borderRadius: 4, maxBarThickness: 28, stack: 'q', yAxisID: 'y' },
                { label: '과입고', data: m.trend.over, backgroundColor: D.accentMid, borderRadius: 4, maxBarThickness: 28, stack: 'q', yAxisID: 'y' },
                { type: 'line', label: '오차율(%)', data: m.trend.rate, borderColor: D.warn, backgroundColor: alpha(D.warn, 0.15), pointRadius: 2, tension: 0.3, spanGaps: true, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true } } },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: '수량' } },
                y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: '오차율 (%)' } }
            }
        }
    });
}

function shipsHtml(m) {
    if (!m.ships.length) return card('패킹별', empty('기간 안에 입고 오차 기록이 없습니다.'));
    const rows = m.ships.map(s => `<tr class="${s.short > 0 ? 'is-short' : ''}">
        <td>${esc(s.label)}</td><td>${esc((s.arrivals || []).join(', '))}</td><td class="r">${esc(n0(s.n))}</td>
        <td class="r">${esc(n0(s.arr))}</td><td class="r">${esc(n0(s.conf))}</td><td class="r">${esc(n0(s.errN))}</td>
        <td class="r">${s.short ? `<b class="opv-down">${esc(n0(s.short))}</b>` : '0'}</td><td class="r">${s.over ? `<b class="opv-up">${esc(n0(s.over))}</b>` : '0'}</td>
        <td class="r">${esc(pct(s.rate))}%</td><td class="r">${esc(n0(s.noScanN))}</td></tr>`).join('');
    return card('패킹별', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>출고일</th><th>입고일</th><th class="r">품목</th><th class="r">도착</th><th class="r">입고</th><th class="r">오차 품목</th><th class="r">부족</th><th class="r">과입고</th><th class="r">오차율</th><th class="r">미스캔</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, `${m.ships.length}줄 · 출고일 늦은 순`);
}

function codesHtml(m) {
    if (!m.codes.length) return card('오차 큰 상품코드', '<p class="opv-note">오차가 있는 상품이 없습니다.</p>');
    const rows = m.codes.map((c, i) => `<tr><td class="r">${i + 1}</td><td>${esc(c.c)}</td><td>${esc(c.nm)}${c.op ? ` <span class="opv-note">${esc(c.op)}</span>` : ''}</td>
        <td>${esc(c.sp)}</td><td class="r">${esc(n0(c.packs))}</td><td class="r">${esc(n0(c.short))}</td><td class="r">${esc(n0(c.over))}</td><td class="r"><b>${esc(n0(c.abs))}</b></td><td class="r">${esc(pct(c.rate))}%</td></tr>`).join('');
    return card('오차 큰 상품코드', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th class="r">순위</th><th>상품코드</th><th>상품명</th><th>공급처 코드</th><th class="r">오차 패킹</th><th class="r">부족</th><th class="r">과입고</th><th class="r">|차이| 합</th><th class="r">오차율</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, `상위 ${m.codes.length}개`);
}

function suppliersHtml(m) {
    if (!m.suppliers.length) return card('공급처 코드별', '<p class="opv-note">오차가 있는 공급처가 없습니다.</p>');
    const rows = m.suppliers.map((s, i) => `<tr><td class="r">${i + 1}</td><td>${esc(s.sp)}</td><td class="r">${esc(n0(s.codes))}</td><td class="r">${esc(n0(s.errN))}</td>
        <td class="r">${esc(n0(s.short))}</td><td class="r">${esc(n0(s.over))}</td><td class="r"><b>${esc(n0(s.abs))}</b></td><td class="r">${esc(pct(s.rate))}%</td></tr>`).join('');
    return card('공급처 코드별', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th class="r">순위</th><th>공급처 코드</th><th class="r">오차 상품</th><th class="r">오차 건</th><th class="r">부족</th><th class="r">과입고</th><th class="r">|차이| 합</th><th class="r">오차율</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, `상위 ${m.suppliers.length}개 · 코드만 표시`);
}

function render(host, ctx, range, data) {
    const m = buildInboundDiffReport(data.records, { ...range, ...view, days: daysIncl(range.from, range.to) });
    const notes = [];
    if (data.full) notes.push(`기록이 많아 이른 출고일부터 ${INBOUND_DIFF_MAX_DOCS}개만 읽었습니다 — 기간 뒷부분이 빠졌을 수 있습니다.`);
    notes.push('기록은 부족수량관리 [작업 마감]·[입고 오차 기록] 때 쌓입니다. 기록이 없는 패킹은 여기 없습니다.');
    const range2 = range.from === range.to ? mdw(range.from) : `${mdw(range.from)} ~ ${mdw(range.to)}`;
    host.innerHTML = `
        <p class="opv-note">출고일 ${esc(range2)} · 기준 ${esc(IDF_KINDS[m.opts.kind])}</p>
        ${controlsHtml()}
        ${kpisHtml(m)}
        <div class="opv-notes"><b>데이터 주의</b><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
        ${trendHtml(m)}
        ${shipsHtml(m)}
        ${codesHtml(m)}
        ${suppliersHtml(m)}`;
    drawTrend(m);
}

let bound = false;
function bindOnce(host) {
    if (bound || !host) return;
    bound = true;
    host.addEventListener('click', (e) => {
        if (!e.target.closest('[data-idf-reload]')) return;
        invalidateInboundDiffData();
        if (last) renderOpsInboundDiff(last.ctx);
        onReload();   // 통계 카드도 새 자료로
    });
    host.addEventListener('change', (e) => {
        const k = e.target.closest('[data-idf-kind]');
        const ns = e.target.closest('[data-idf-noscan]');
        if (!k && !ns) return;
        if (k) view = { ...view, kind: k.value };
        if (ns) view = { ...view, includeNoScan: !!ns.checked };
        if (last && last.data && paneShown()) { destroyInboundDiffCharts(); render(host, last.ctx, last.range, last.data); }
    });
}

/** 입고 오차 장 그리기. ctx = { gran, key, canInbound }. 읽기는 비동기 — 늦게 온 옛 기간·떠난 탭의 결과는 버린다. */
export async function renderOpsInboundDiff(ctx = {}) {
    const host = $('ops-inbound-body');
    if (!host) return;
    bindOnce(host);
    destroyInboundDiffCharts();
    const my = ++token;
    delete host.dataset.period;
    if (!paneShown()) { loading = false; return; }
    if (!ctx.canInbound) { loading = false; host.innerHTML = card('입고 오차', '<p class="opv-note">권한이 없습니다.</p>'); return; }
    const range = periodBounds(ctx.gran, ctx.key);
    if (!range) { loading = false; host.innerHTML = empty('왼쪽 목록에서 기간을 고르세요.'); return; }
    if (!State.db) { loading = false; host.innerHTML = empty('아직 연결 중입니다. 잠시 뒤 다시 열어 주세요.'); return; }
    last = { ctx, range, data: null };
    loading = true;
    host.innerHTML = empty('불러오는 중...');
    try {
        const data = await loadInboundDiffRange(State.db, range);
        if (my !== token || !paneShown()) return;
        if (!data.ok) {
            host.innerHTML = card('입고 오차', `<p class="opv-note">${esc(data.denied ? INBOUND_DIFF_DENIED : '입고 오차 기록을 읽지 못했습니다. 잠시 뒤 [새로 읽기]를 눌러 주세요.')}</p>
                ${data.denied ? '' : '<button type="button" class="opv-btn" data-idf-reload="1">새로 읽기</button>'}`);
            return;
        }
        last = { ctx, range, data };
        render(host, ctx, range, data);
        host.dataset.period = `${range.from}|${range.to}`;   // 어느 기간으로 그렸나(화면 시험이 앞 기간 화면을 읽지 않게)
    } catch (e) {
        if (my !== token) return;
        console.error('입고 오차 탭 그리기 실패:', e && (e.code || e.message));
        host.innerHTML = empty('입고 오차 자료를 불러오지 못했습니다.');
    } finally {
        if (my === token) loading = false;
    }
}
