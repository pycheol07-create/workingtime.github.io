// === js/ui-ops-stats.js ===
// 📈 운영 리포트 '통계' 탭(2026-11-27 — 비품·입고 오차 탭을 합침, 사용자 결정). 권한 data.analysis(비품 금액은 그 안에서 data.reports 일 때만).
//   맨 위 요약 카드 3장(#ops-stats-cards) — 입고 오차(오차율·부족·과입고) / 검수(샘플·전량 건수·수량 불량률) / 비품(안전재고 이하·발주 권장·기간 사용량).
//     카드를 누르면 그 장을 펼치고 그 자리로 옮긴다.
//   아래 펼침 장 3개(<details>, js/lib/ops-report-route.js STATS_SECTIONS 순서) — 입고 오차(js/ui-ops-inbound-diff.js) → 검수(여기) → 비품(js/ui-ops-supplies.js).
//     장 안은 펼친 뒤에만 그린다(숨은 칸 그래프 크기 0). 펼친 장은 기간을 바꿔 다시 그려도 열린 채(장 요소는 그대로 두고 안만 다시 그림).
//   읽기: 입고 오차·비품은 탭을 열 때 카드용으로 읽는다(각 저장소 10분 캐시 — 장을 펼쳐도 다시 읽지 않음).
//     검수는 장을 펼칠 때만 읽는다(js/ops-insp-store.js — product_history 통째라 무겁다). 그 전까지 검수 카드는 '펼치면 계산'.
//   탭 전환·권한·PDF 는 js/ui-history-ops-report.js (PDF 는 열린 장만 — 닫힌 장은 머리만, js/panel-pdf.js).
// ⚠️ 공급처는 코드만, 직원 이름(검수자·저장자)은 그리지 않는다. 콘솔에 상품·수량을 찍지 않는다. role=dialog·data-act 금지(업무마감봇 선택자).

import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';
import { periodBounds } from './lib/ops-supplies.js?v=f5cbd8a554cf-1a2dc6de';
import { STATS_SECTIONS } from './lib/ops-report-route.js?v=84b67615cb52-4715e3b0';
import { buildInspReport, INSP_LOG_MAX } from './lib/ops-insp.js?v=fe78bbb6adc1-f4bf8003';
import { mdw } from './lib/supplies-forecast-view.js?v=c308b964945e-6e807d3e';
import { loadInspData, invalidateInspData } from './ops-insp-store.js?v=03eafdd886ea-b6677284';
import { renderOpsSupplies, leaveOpsSupplies, isSuppliesLoading, suppliesSummary, setSuppliesReloadHook } from './ui-ops-supplies.js?v=c8dd5abe9b16-55e3ccef';
import { renderOpsInboundDiff, leaveOpsInboundDiff, isInboundDiffLoading, inboundSummary, setInboundReloadHook } from './ui-ops-inbound-diff.js?v=1ee217fda9b9-084944bd';

const $ = (id) => document.getElementById(id);
const ok = (v) => v != null && isFinite(v);
const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString() : '—');
const p1 = (v) => (ok(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—');   // % 값 → 소수 1자리
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

const panelShown = () => { const p = $('ops-stats-panel'); return !!p && !p.classList.contains('hidden'); };
const secEl = (s) => $(`ops-stats-sec-${s}`);
const secOpen = (s) => { const d = secEl(s); return !!d && d.open; };

let lastCtx = null;
let cardToken = 0;
let cardsLoading = 0;          // 읽는 중인 카드 수
let cards = {};                // 카드 이름 → { state: 'loading'|'ok'|'err'|'denied'|'none'|'wait', v }
let cardsFor = '';             // 카드가 어느 기간 것인가('gran|key')
let inspToken = 0;
let inspLoading = false;
const ctxKey = (c) => `${c.gran}|${c.key}`;

// ── 카드 ────────────────────────────────────────────────────
const CARD_TITLE = { inbound: '입고 오차', insp: '검수', supplies: '비품' };
function cardBody(name, c) {
    if (!c || c.state === 'loading') return kpi({ label: CARD_TITLE[name], value: '…', sub: '불러오는 중' });
    if (c.state === 'wait') return kpi({ label: CARD_TITLE[name], value: '—', sub: '펼치면 계산' });
    if (c.state === 'denied') return kpi({ label: CARD_TITLE[name], value: '—', sub: '권한이 없습니다' });
    if (c.state === 'err') return kpi({ label: CARD_TITLE[name], value: '—', sub: '못 읽음 — 펼쳐서 [새로 읽기]' });
    if (c.state === 'none') return kpi({ label: CARD_TITLE[name], value: '—', sub: '기간을 고르세요' });
    const v = c.v;
    if (name === 'inbound') {
        return kpi({ label: '입고 오차 · 오차율', value: v.packs ? esc(p1(v.rate == null ? null : v.rate * 100)) : '—', unit: '%',
            sub: v.packs ? `부족 <b class="opv-down">${esc(n0(v.short))}</b> · 과입고 <b class="opv-up">${esc(n0(v.over))}</b> · 패킹 ${esc(n0(v.packs))}건${v.full ? ' · 일부만' : ''}`
                : '기간 안 입고 오차 기록 없음',
            title: '기준 = 전체 · 미스캔은 오차에서 뺌(팀 결산과 같음). 장 안의 보기 기준을 바꿔도 카드는 그대로' });
    }
    if (name === 'insp') {
        return kpi({ label: '검수 · 수량 불량률', value: v.n ? esc(p1(v.qtyRate)) : '—', unit: '%',
            sub: v.n ? `샘플 ${esc(n0(v.sample.n))}건 · 전량 ${esc(n0(v.total.n))}건 · 건수 불량률 ${esc(p1(v.countRate))}%` : '기간 안 검수 기록 없음',
            title: '검수 이력 품질 통계와 같은 기준(불량 수량: 샘플은 입고 수량, 전량은 불량 개수)' });
    }
    return kpi({ label: '비품 · 안전재고 이하', value: v.low == null ? '—' : esc(n0(v.low)), unit: '종',
        sub: `발주 권장 ${esc(v.order == null ? '—' : n0(v.order))}종 · 기간 사용 ${esc(n0(v.outQty))}${v.outItems ? ` (${esc(v.outItems)}종, 단위 섞임)` : ''}`,
        title: '안전재고·발주 권장은 지금 기준, 사용량은 고른 기간' });
}
function drawCards() {
    const host = $('ops-stats-cards');
    if (!host) return;
    host.innerHTML = STATS_SECTIONS.map(s => `<button type="button" class="ops-stat-card" data-stats-card="${esc(s)}" aria-controls="ops-stats-sec-${esc(s)}"
        title="누르면 ${esc(CARD_TITLE[s])} 장을 펼칩니다">${cardBody(s, cards[s])}</button>`).join('');
}

// 카드 하나 읽기(입고 오차·비품). 늦게 온 결과는 버린다 — 옛 기간(cardToken)이거나, 같은 카드를 그 뒤에 또 읽기 시작했으면([새로 읽기] 직후 등, cardSeq).
const cardSeq = { inbound: 0, supplies: 0 };
async function loadCard(name) {
    const ctx = lastCtx;
    if (!ctx) return;
    const my = cardToken;
    const seq = ++cardSeq[name];
    const fresh = () => my === cardToken && seq === cardSeq[name];
    cards[name] = { state: 'loading' };
    drawCards();
    cardsLoading++;
    let next = null;
    try {
        const v = name === 'inbound' ? await inboundSummary({ ...ctx, canInbound: !!ctx.canStats })
            : await suppliesSummary({ ...ctx, canSupplies: !!ctx.canStats });
        next = v == null ? { state: 'none' } : !v.ok ? { state: v.denied ? 'denied' : 'err' } : { state: 'ok', v };
    } catch (e) {
        if (fresh()) console.error('통계 카드 읽기 실패:', name, e && (e.code || e.message));
        next = { state: 'err' };
    } finally {
        if (my === cardToken) cardsLoading--;   // 떠난 회차는 leaveOpsStats 가 0 으로 돌렸다
    }
    if (!fresh()) return;
    cards[name] = next;
    if (panelShown()) drawCards();
}

// ── 검수 장 ─────────────────────────────────────────────────
function inspHtml(m, data) {
    const notes = [];
    if (!data.ok.logs) notes.push('전량검수 기록을 읽지 못해 샘플검수만 셌습니다. 잠시 뒤 [새로 읽기]를 눌러 주세요.');
    if (data.truncated) notes.push(`전량검수 기록이 많아 최근 ${INSP_LOG_MAX}건만 셌습니다 — 기간 앞부분이 빠졌을 수 있습니다.`);
    notes.push('불량 수량: 샘플검수는 입고 수량, 전량검수는 불량 개수(검수 이력 품질 통계와 같은 기준). 검수일 기준.');
    const range = m.from === m.to ? mdw(m.from) : `${mdw(m.from)} ~ ${mdw(m.to)}`;
    const head = `<div class="opv-card-head" style="margin-bottom:0"><span class="opv-note">검수일 ${esc(range)}</span>
        <button type="button" class="opv-btn" data-insp-reload="1" title="검수 기록을 서버에서 다시 읽습니다">새로 읽기</button></div>`;
    const kpis = `<div class="opv-kpis">
        ${kpi({ label: '검수 건수', value: n0(m.n), unit: '건', sub: `샘플 ${esc(n0(m.sample.n))} · 전량 ${esc(n0(m.total.n))}` })}
        ${kpi({ label: '검수 수량', value: n0(m.qty), unit: '개', sub: `샘플 ${esc(n0(m.sample.qty))}(실제 샘플 ${esc(n0(m.sample.sampled))}) · 전량 ${esc(n0(m.total.qty))}`, title: '입고 수량 합' })}
        ${kpi({ label: '불량', value: n0(m.defectN), unit: '건', sub: `불량 수량 ${esc(n0(m.defectQty))}개` })}
        ${kpi({ label: '건수 불량률', value: p1(m.countRate), unit: '%', sub: `샘플 ${esc(n0(m.sample.defectN))}건 · 전량 ${esc(n0(m.total.defectN))}건` })}
        ${kpi({ label: '수량 불량률', value: p1(m.qtyRate), unit: '%', sub: `검수 상품 ${esc(n0(m.productTypes))}종` })}
    </div>`;
    const notesHtml = `<div class="opv-notes"><b>데이터 주의</b><ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
    if (!m.n) return head + kpis + notesHtml + card('불량 상위 상품', empty('이 기간 검수 기록이 없습니다.'));
    const prodRows = m.products.map((p, i) => `<tr><td class="r">${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.code || '—')}</td>
        <td class="r">${esc(n0(p.n))}</td><td class="r"><b class="opv-down">${esc(n0(p.defectN))}</b></td><td class="r">${esc(n0(p.defectQty))}</td>
        <td class="r">${esc(p1(p.countRate))}%</td><td class="r">${esc(p1(p.qtyRate))}%</td><td>${esc(p.reason || '—')}</td></tr>`).join('');
    const prod = m.products.length ? card('불량 상위 상품', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th class="r">순위</th><th>상품명</th><th>상품코드</th><th class="r">검수 건</th><th class="r">불량 건</th><th class="r">불량 수량</th><th class="r">건수 불량률</th><th class="r">수량 불량률</th><th>주요 사유</th></tr></thead>
        <tbody>${prodRows}</tbody></table></div>`, `상위 ${m.products.length}개 · 불량 건수 많은 순`)
        : card('불량 상위 상품', '<p class="opv-note">불량이 나온 상품이 없습니다.</p>');
    const max = m.reasons.length ? m.reasons[0].n : 1;
    const reasonRows = m.reasons.map((r, i) => `<tr><td class="r">${i + 1}</td><td>${esc(r.reason)}</td><td class="r">${esc(n0(r.n))}</td>
        <td style="min-width:120px"><div style="height:6px;border-radius:3px;background:var(--c-track)"><div style="height:100%;border-radius:3px;background:var(--c-risk);width:${Math.round(r.n / max * 100)}%"></div></div></td></tr>`).join('');
    const reasons = m.reasons.length ? card('불량 사유 상위', `<div class="opv-table-wrap"><table class="opv-table">
        <thead><tr><th class="r">순위</th><th>사유</th><th class="r">건수</th><th></th></tr></thead><tbody>${reasonRows}</tbody></table></div>`, `상위 ${m.reasons.length}개`)
        : '';
    return head + kpis + notesHtml + prod + reasons;
}

async function renderInspSection(ctx) {
    const host = $('ops-insp-body');
    if (!host) return;
    const my = ++inspToken;
    delete host.dataset.period;
    if (!panelShown() || !secOpen('insp')) { inspLoading = false; return; }
    if (!ctx.canStats) { inspLoading = false; host.innerHTML = card('검수', '<p class="opv-note">권한이 없습니다.</p>'); return; }
    const range = periodBounds(ctx.gran, ctx.key);
    if (!range) { inspLoading = false; host.innerHTML = empty('왼쪽 목록에서 기간을 고르세요.'); return; }
    if (!State.db) { inspLoading = false; host.innerHTML = empty('아직 연결 중입니다. 잠시 뒤 다시 열어 주세요.'); return; }
    inspLoading = true;
    host.innerHTML = empty('불러오는 중...');
    const ck = ctxKey(ctx);
    if (cardsFor === ck) { cards.insp = { state: 'loading' }; drawCards(); }
    try {
        const data = await loadInspData(State.db, range);
        if (my !== inspToken || !panelShown() || !secOpen('insp')) return;
        if (!data.ok.docs) {
            host.innerHTML = card('검수', `<p class="opv-note">${data.denied ? '권한이 없습니다.' : '검수 기록을 읽지 못했습니다. 잠시 뒤 [새로 읽기]를 눌러 주세요.'}</p>
                ${data.denied ? '' : '<button type="button" class="opv-btn" data-insp-reload="1">새로 읽기</button>'}`);
            if (cardsFor === ck) { cards.insp = { state: data.denied ? 'denied' : 'err' }; drawCards(); }
            return;
        }
        const m = buildInspReport({ productDocs: data.productDocs, totalLogs: data.ok.logs ? data.totalLogs : [], ...range });
        host.innerHTML = inspHtml(m, data);
        host.dataset.period = `${range.from}|${range.to}`;
        if (cardsFor === ck) { cards.insp = { state: 'ok', v: m }; drawCards(); }
    } catch (e) {
        if (my !== inspToken) return;
        console.error('검수 장 그리기 실패:', e && (e.code || e.message));
        host.innerHTML = empty('검수 자료를 불러오지 못했습니다.');
        if (cardsFor === ck) { cards.insp = { state: 'err' }; drawCards(); }
    } finally {
        if (my === inspToken) inspLoading = false;
    }
}
function leaveInsp() {
    inspToken++;
    inspLoading = false;
    if (cards.insp && cards.insp.state === 'loading') { cards.insp = { state: 'wait' }; if (panelShown()) drawCards(); }   // 읽다가 접음 → 다시 '펼치면 계산'
}

// ── 장 하나 그리기·떠나기 ─────────────────────────────────────
function drawSection(s, ctx) {
    if (!ctx) return;
    const done = (p, what) => p.catch(err => console.error(`통계 ${what} 장 그리기 실패:`, err && err.message));
    if (s === 'inbound') done(renderOpsInboundDiff({ ...ctx, canInbound: !!ctx.canStats }), '입고 오차');
    else if (s === 'supplies') done(renderOpsSupplies({ ...ctx, canSupplies: !!ctx.canStats }), '비품');
    else if (s === 'insp') done(renderInspSection(ctx), '검수');
}
function leaveSection(s) {
    if (s === 'inbound') leaveOpsInboundDiff();
    else if (s === 'supplies') leaveOpsSupplies();
    else if (s === 'insp') leaveInsp();
}

/** 카드를 눌렀을 때 — 그 장을 펼치고(펼침 → toggle 이 그린다) 그 자리로 옮긴다. */
export function openStatsSection(s) {
    const d = secEl(s);
    if (!d) return;
    if (!d.open) d.open = true;
    try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { d.scrollIntoView(); }
}

let bound = false;
function bindOnce() {
    if (bound) return;
    const cardsEl = $('ops-stats-cards');
    if (!cardsEl) return;
    bound = true;
    cardsEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-stats-card]');
        if (b) openStatsSection(b.dataset.statsCard);
    });
    // 장 펼침·접기 — toggle 은 버블링하지 않아 장마다 붙인다. 숨은 칸(다른 탭)일 때는 그리지 않는다(탭을 열 때 renderOpsStats 가 그림).
    STATS_SECTIONS.forEach(s => secEl(s)?.addEventListener('toggle', (e) => {
        if (e.currentTarget.open) { if (panelShown()) drawSection(s, lastCtx); }
        else leaveSection(s);
    }));
    $('ops-insp-body')?.addEventListener('click', (e) => {
        if (!e.target.closest('[data-insp-reload]')) return;
        invalidateInspData();
        if (lastCtx) drawSection('insp', lastCtx);
    });
    setSuppliesReloadHook(() => { if (lastCtx && panelShown()) loadCard('supplies'); });
    setInboundReloadHook(() => { if (lastCtx && panelShown()) loadCard('inbound'); });
}

/** 지금 읽는 중인가 — 카드나 펼친 장(탭 [PDF 받기]가 '불러오는 중' 화면을 받지 않게) */
export const isStatsLoading = () => cardsLoading > 0 || inspLoading || isSuppliesLoading() || isInboundDiffLoading();

/** 탭을 떠날 때(다른 탭·결산·다른 레일 화면) — 읽는 중인 결과를 버리고 장 그래프를 정리한다. 장은 펼친 채 두고, 돌아오면 다시 그린다. */
export function leaveOpsStats() {
    cardToken++;
    cardsLoading = 0;
    STATS_SECTIONS.forEach(leaveSection);
}

/**
 * 통계 탭 그리기. ctx = { gran, key, canCost, canStats(data.analysis) }. 카드(입고 오차·비품 읽기, 검수는 '펼치면 계산')와 펼친 장을 그린다.
 */
export function renderOpsStats(ctx = {}) {
    bindOnce();
    lastCtx = ctx;
    if (!panelShown()) return;
    leaveOpsStats();   // 앞 회차의 늦은 결과는 버린다
    const host = $('ops-stats-cards');
    if (!ctx.canStats) {
        if (host) host.innerHTML = card('통계', '<p class="opv-note">권한이 없습니다.</p>');
        return;
    }
    const ck = ctxKey(ctx);
    const keepInsp = cardsFor === ck && cards.insp && cards.insp.state === 'ok' ? cards.insp : null;   // 같은 기간이면 검수 카드는 그대로
    cardsFor = ck;
    cards = { inbound: { state: 'loading' }, insp: keepInsp || { state: 'wait' }, supplies: { state: 'loading' } };
    if (!periodBounds(ctx.gran, ctx.key)) cards = { inbound: { state: 'none' }, insp: { state: 'none' }, supplies: { state: 'none' } };
    drawCards();
    if (periodBounds(ctx.gran, ctx.key)) { loadCard('inbound'); loadCard('supplies'); }
    STATS_SECTIONS.forEach(s => { if (secOpen(s)) drawSection(s, ctx); });
}
