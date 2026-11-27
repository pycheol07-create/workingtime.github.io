// === js/ui-ops-supplies.js ===
// 📦 운영 리포트 '비품' 탭(2026-11-27) — 고른 기간의 비품 사용·입고·일평균, 지금 안전재고 이하 비품, 소진 예상·발주 권장(예측 문서),
//   기간 발주·입고 건수와 리드타임, 사용량 추세(일·주·월) 그래프.
//   숫자는 js/lib/ops-supplies.js buildSuppliesReport, 읽기·캐시는 js/ops-supplies-store.js. 탭 전환·권한은 js/ui-history-ops-report.js.
//   권한: 탭 자체가 비품 권한(supplies.view)일 때만 보인다. 금액(단가 × 수량)은 비용 권한(data.reports)일 때만.
//   읽기가 규칙에 막히면 조용히 '권한이 없습니다'.
// ⚠️ 공급처 이름·연락처는 그리지 않는다(단가와 같은 화면에 두지 않기). 콘솔에 비품 이름·수량을 찍지 않는다.
// ⚠️ role=dialog·data-act 금지(업무마감봇 선택자).

import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';
import { D, alpha } from './d-chart.js?v=e918595219dd-dfe55644';
import { buildSuppliesReport, periodBounds } from './lib/ops-supplies.js?v=6885f1ad3c7b-92bc58ee';
import { kstToday, mdw } from './lib/supplies-forecast-view.js?v=c308b964945e-6e807d3e';
import { loadSuppliesReportData, invalidateSuppliesData } from './ops-supplies-store.js?v=e21a3b62ecd2-ac3f581c';

const $ = (id) => document.getElementById(id);
const ok = (v) => v != null && isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
const n1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
const unitSpan = (u) => (u ? `<span class="opv-kpi-unit">${esc(u)}</span>` : '');
const kpi = ({ label, value, unit = '', sub = '', title = '' }) => `<div class="opv-kpi"${title ? ` title="${esc(title)}"` : ''}>
    <div class="opv-kpi-label">${esc(label)}</div>
    <div class="opv-kpi-value">${value}${value === '—' ? '' : unitSpan(unit)}</div>
    ${sub ? `<div class="opv-note">${sub}</div>` : ''}
</div>`;
const card = (title, body, hint = '') => `<div class="opv-card">
    <div class="opv-card-head"><h4 class="opv-h">${esc(title)}</h4>${hint ? `<span class="opv-note">${hint}</span>` : ''}</div>
    ${body}
</div>`;
const empty = (msg) => `<div class="opv-empty">${esc(msg)}</div>`;
const md = (ymd) => mdw(ymd);
const CHIP = { order: 'is-risk', watch: 'is-warn', ordered: '' };

let chart = null;
let token = 0;
let loading = false;

/** 이 탭이 만든 차트 정리(탭을 바꿀 때 — js/ui-history-ops-report.js) */
export function destroySuppliesCharts() {
    if (chart) { try { chart.destroy(); } catch (e) { /* */ } chart = null; }
}
/** 지금 읽는 중인가(탭 [PDF 받기]가 '불러오는 중' 화면을 받지 않게) */
export const isSuppliesLoading = () => loading;
/** 탭을 떠날 때(다른 탭·결산·다른 레일 화면) — 읽는 중인 결과를 버리고(token) 차트를 정리한다. 돌아오면 다시 그린다. */
export function leaveOpsSupplies() {
    token++;
    loading = false;
    destroySuppliesCharts();
}
/** 비품 칸이 지금 보이나(숨은 칸에 그리거나 차트를 만들지 않게) */
const paneShown = () => { const p = $('ops-supplies-panel'); return !!p && !p.classList.contains('hidden'); };

/** 머리 한 줄(글자만 — 부르는 쪽이 esc) */
function periodText(m) {
    const { from, to, elapsedDays } = m.meta;
    const range = from === to ? md(from) : `${md(from)} ~ ${md(to)}`;
    const basis = { ledger: '앱 원장', old: '이지어드민 이력', mixed: '앱 원장 + 전환 전 이지어드민 이력', none: '기록 없음' }[m.meta.basis] || '';
    return `${range} · 일평균은 오늘까지 ${elapsedDays}일(달력일) 기준 · 자료: ${basis}`;
}

function notesHtml(m) {
    return m.meta.notes.length ? `<div class="opv-notes"><b>데이터 주의</b><ul>${m.meta.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '';
}

function kpisHtml(m) {
    const T = m.totals;
    if (!m.meta.usageOk) {
        return `<div class="opv-kpis">${['사용(출고) 수량', '일평균 사용', '입고 수량', '실사'].map(l =>
            kpi({ label: l, value: '—', sub: '못 읽음' })).join('')}</div>`;
    }
    const out = [
        kpi({ label: '사용(출고) 수량', value: n0(T.outQty), sub: `비품 ${esc(T.outItems)}종 · 기록 ${esc(T.outEvents)}건`, title: '단위가 다른 비품을 더한 참고값' }),
        kpi({ label: '일평균 사용', value: n1(T.outPerDay), sub: '사용 수량 ÷ 지난 달력일' }),
        kpi({ label: '입고 수량', value: n0(T.inQty), sub: `비품 ${esc(T.inItems)}종` }),
        kpi({ label: '실사', value: n0(T.countN), unit: '건', sub: T.countN ? `증감 합 ${T.countNet > 0 ? '+' : ''}${esc(n0(T.countNet))}` : '',
            title: '사람이 센 실사만(앱 원장은 켠 뒤, 이지어드민 이력은 연동 자동 맞춤 제외)' })
    ];
    if (T.outAmount != null) {
        out.push(kpi({ label: '사용 금액(추정)', value: n0(T.outAmount), unit: '원',
            sub: T.pricedShare != null && T.pricedShare < 1 ? `단가 있는 비품만 · ${esc(Math.round(T.pricedShare * 100))}%` : '단가 × 사용 수량',
            title: '비품 상세의 단가 × 사용 수량. 단가가 없는 비품은 빠집니다' }));
    }
    return `<div class="opv-kpis">${out.join('')}</div>`;
}

function topHtml(m) {
    if (!m.meta.usageOk) return card('사용 상위 비품', '<p class="opv-note">못 읽음 — 위 「데이터 주의」를 보세요.</p>');
    if (!m.top.length) return card('사용 상위 비품', empty('이 기간 사용(출고) 기록이 없습니다.'));
    const money = m.totals.outAmount != null;
    const rows = m.top.map(t => `<tr>
        <td>${esc(t.name)}${t.category ? ` <span class="opv-note">${esc(t.category)}</span>` : ''}</td>
        <td class="r">${esc(n0(t.out))}${t.unit ? ` <span class="opv-note">${esc(t.unit)}</span>` : ''}</td>
        <td class="r">${esc(n1(t.perDay))}</td><td class="r">${esc(n0(t.outN))}</td><td class="r">${esc(t.in ? n0(t.in) : '—')}</td>
        ${money ? `<td class="r">${esc(t.amount != null ? n0(t.amount) : '—')}</td>` : ''}</tr>`).join('');
    return card('사용 상위 비품', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>비품</th><th class="r">사용 수량</th><th class="r">일평균</th><th class="r">기록(건)</th><th class="r">입고 수량</th>${money ? '<th class="r">사용 금액(원)</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>`, `상위 ${m.top.length}개`);
}

function trendHtml(m) {
    if (!m.meta.usageOk) return card('사용량 추세', '<p class="opv-note">못 읽음</p>');
    const t = m.trend;
    if (t.labels.length < 2) return card('사용량 추세', '<p class="opv-note">하루만 고르면 추세 그래프가 없습니다 — 주·월을 고르세요.</p>');
    if (!t.out.some(v => v > 0) && !t.in.some(v => v > 0)) return card('사용량 추세', empty('이 기간 사용·입고 기록이 없습니다.'));
    return card('사용량 추세', '<div class="opv-chart"><canvas id="ops-chart-supplies"></canvas></div>',
        { day: '일별', week: '주별(월요일 시작)', month: '월별' }[t.unit] + ' · 수량 합(단위 섞임, 참고)');
}

function drawTrend(m) {
    const canvas = $('ops-chart-supplies');
    if (!canvas || typeof Chart === 'undefined') return;
    destroySuppliesCharts();
    chart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: m.trend.labels,
            datasets: [
                { label: '사용(출고)', data: m.trend.out, backgroundColor: D.accent, borderRadius: 4, maxBarThickness: 28 },
                { type: 'line', label: '입고', data: m.trend.in, borderColor: D.ok, backgroundColor: alpha(D.ok, 0.15), pointRadius: 2, tension: 0.3, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true } } },
            scales: { y: { beginAtZero: true, title: { display: true, text: '수량' } } }
        }
    });
}

function lowHtml(m) {
    if (m.low == null) return card('안전재고 이하', '<p class="opv-note">못 읽음 — 재고 또는 재고 기준 스위치를 읽지 못했습니다.</p>', '지금 기준');
    if (!m.safetyCount) return card('안전재고 이하', '<p class="opv-note">안전재고를 정한 비품이 없습니다.</p>', '지금 기준');
    if (!m.low.length) return card('안전재고 이하', `<p class="opv-note">안전재고를 정한 비품 ${esc(m.safetyCount)}종 모두 안전재고보다 많습니다.</p>`, '지금 기준');
    const rows = m.low.map(l => `<tr class="is-short">
        <td>${esc(l.name)}</td><td class="r">${esc(n0(l.stock))}${l.unit ? ` <span class="opv-note">${esc(l.unit)}</span>` : ''}</td>
        <td class="r">${esc(n0(l.safety))}</td><td class="r"><b class="opv-down">${esc(l.gap < 0 ? '−' + n0(-l.gap) : '0')}</b></td>
        <td>${l.status && l.status !== 'nocode' ? `<span class="opv-chip ${CHIP[l.status] || ''}">${esc(l.statusLabel)}</span>` : ''}</td></tr>`).join('');
    return card('안전재고 이하', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>비품</th><th class="r">현재고</th><th class="r">안전재고</th><th class="r">차이</th><th>예측 상태</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`, `지금 기준(기간과 무관) · ${m.low.length}종 / 안전재고 정한 ${m.safetyCount}종`);
}

function forecastHtml(m) {
    const F = m.forecast;
    if (!F) return card('소진 예상 · 발주 권장', '<p class="opv-note">예측 문서를 읽지 못했습니다.</p>');
    const head = `<div class="opv-kpis">
        ${kpi({ label: '발주 필요', value: n0(F.counts.order), unit: '종' })}
        ${kpi({ label: '주의', value: n0(F.counts.watch), unit: '종' })}
        ${kpi({ label: '발주함(입고 대기)', value: n0(F.counts.ordered), unit: '종' })}
    </div>`;
    const stale = F.stale ? '<p class="opv-notes">예측이 2일 넘게 새로 만들어지지 않았습니다(예약작업 확인).</p>' : '';
    const rows = F.rows.map(f => `<tr>
        <td>${esc(f.name)}</td><td><span class="opv-chip ${CHIP[f.status] || ''}">${esc(f.statusLabel)}</span></td>
        <td class="r">${esc(n0(f.stock))}${f.unit ? ` <span class="opv-note">${esc(f.unit)}</span>` : ''}</td>
        <td>${esc(f.deplete)}</td><td>${esc(f.reorder)}</td><td class="r">${esc(f.recommend)}</td></tr>`).join('');
    const table = F.rows.length ? `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th>비품</th><th>상태</th><th class="r">현재고</th><th>소진 예상</th><th>발주 권장일</th><th class="r">권장 발주량</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="opv-note">발주 필요·주의·발주함인 비품이 없습니다.</p>';
    return card('소진 예상 · 발주 권장', head + stale + table,
        `지금 기준 · 예측 ${esc(F.basisDate ? md(F.basisDate) : '—')} (매일 08:30) · D-n = 남은 업무일`);
}

function ordersHtml(m) {
    const O = m.orders;
    if (!O) return card('발주 · 입고', '<p class="opv-note">발주 기록을 읽지 못했습니다.</p>');
    const L = O.lead;
    return card('발주 · 입고', `<div class="opv-kpis">
        ${kpi({ label: '기간 발주', value: n0(O.ordered), unit: '건', sub: O.cancelled ? `취소 ${esc(O.cancelled)}건 별도` : '' })}
        ${kpi({ label: '기간 입고 확인', value: n0(O.received), unit: '건' })}
        ${kpi({ label: '평균 리드타임', value: L.n ? n1(L.avg) : '—', unit: '일', sub: L.n ? `${esc(L.n)}건 · 최소 ${esc(L.min)}일 · 최대 ${esc(L.max)}일` : '기간 안 입고 건 없음', title: '발주일 → 입고 확인일(달력일), 기간 안에 입고된 건' })}
        ${kpi({ label: '지금 입고 대기', value: n0(O.open), unit: '건', sub: '기간과 무관' })}
    </div>`, '[발주함]·[입고 확인] 기록 기준(발주알림 자동 입고 포함)');
}

function render(host, m) {
    host.innerHTML = `
        <div class="opv-card-head" style="margin-bottom:0"><span class="opv-note">${esc(periodText(m))}</span>
            <button type="button" class="opv-btn" data-sup-reload="1" title="비품 자료를 서버에서 다시 읽습니다">새로 읽기</button></div>
        ${kpisHtml(m)}
        ${notesHtml(m)}
        ${trendHtml(m)}
        ${topHtml(m)}
        ${lowHtml(m)}
        ${forecastHtml(m)}
        ${ordersHtml(m)}`;
    drawTrend(m);
}

let bound = false;
let lastCtx = null;
function bindOnce(host) {
    if (bound || !host) return;
    bound = true;
    host.addEventListener('click', (e) => {
        if (!e.target.closest('[data-sup-reload]')) return;
        invalidateSuppliesData();
        if (lastCtx) renderOpsSupplies(lastCtx);
    });
}

/**
 * 비품 탭 그리기. ctx = { gran, key, canCost, canSupplies }. 읽기는 비동기 — 늦게 온 옛 기간 결과는 버린다.
 */
export async function renderOpsSupplies(ctx = {}) {
    const host = $('ops-supplies-body');
    if (!host) return;
    bindOnce(host);
    lastCtx = ctx;
    destroySuppliesCharts();
    const my = ++token;
    if (!paneShown()) { loading = false; return; }   // 숨은 칸에는 그리지 않는다(탭을 열 때 다시 부른다)
    if (!ctx.canSupplies) { loading = false; host.innerHTML = card('비품', '<p class="opv-note">권한이 없습니다.</p>'); return; }
    const range = periodBounds(ctx.gran, ctx.key);
    if (!range) { loading = false; host.innerHTML = empty('왼쪽 목록에서 기간을 고르세요.'); return; }
    if (!State.db) { loading = false; host.innerHTML = empty('아직 연결 중입니다. 잠시 뒤 다시 열어 주세요.'); return; }
    loading = true;
    host.innerHTML = empty('불러오는 중...');
    try {
        const data = await loadSuppliesReportData(State.db, range);
        if (my !== token || !paneShown()) return;   // 그사이 기간이 바뀌었거나 탭을 떠남
        if (!data.ok.items) {
            host.innerHTML = card('비품', `<p class="opv-note">${data.denied ? '권한이 없습니다.' : '비품 목록을 읽지 못했습니다. 잠시 뒤 [새로 읽기]를 눌러 주세요.'}</p>
                ${data.denied ? '' : '<button type="button" class="opv-btn" data-sup-reload="1">새로 읽기</button>'}`);
            return;
        }
        const m = buildSuppliesReport({
            ...data, ...range, today: kstToday(), now: Date.now(), canCost: !!ctx.canCost,
            ok: { items: data.ok.items, ledger: data.ok.ledger, stock: data.ok.stock, orders: data.ok.orders, forecast: data.ok.forecast }
        });
        if (!paneShown()) return;
        render(host, m);
    } catch (e) {
        if (my !== token) return;
        console.error('비품 탭 그리기 실패:', e && (e.code || e.message));
        host.innerHTML = empty('비품 자료를 불러오지 못했습니다.');
    } finally {
        if (my === token) loading = false;
    }
}
