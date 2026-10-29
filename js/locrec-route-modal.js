// === js/locrec-route-modal.js ===
// 인사이트 줄 '동선 효율' 카드(js/locrec-route-card.js)를 누르면 열리는 상세 창.
//   ① 머리 숫자(지금 · 추천 모두 적용 시 · 지난주 · 앞쪽 자리 출고 · 계산 대상 · 기준일)
//   ② 큰 추이 그래프(60일) + 날짜별 표  ③ 구역 × 동 열지도 전체(칸 숫자 · 구역 합 · 동 합)  ④ 계산 방법
// 자료는 카드와 같은 store(js/locrec-store.js)의 latest 하나 — 새로 구독하지 않는다. 구역·동·숫자만 나온다(상품 정보 없음).
// 창은 처음 열 때 body 에 만든다. 오버레이 자식 1개 · 첫 자식 .modal-header 라 공통 끌기(js/modal-drag.js)가 붙고,
//   닫기 버튼 [data-esc-close] 라 Esc 는 js/modal-esc.js 가 처리한다.
import { escapeHtml } from './utils.js?v=202610291646';
import { routeDetailHead, routeHeatDetail, HEAT_HELP, ROUTE_CARD_HELP, FRONT_HELP } from './lib/locrec-view.js?v=202610291646';
import { trendSeries, trendPoints, trendSvg, trendRows } from './lib/locrec-trend.js?v=202610291646';
import { todayKey } from './locrec-store.js?v=202610291646';

const MODAL_ID = 'locrec-route-modal';
let store = null;
let modal = null;

function close() { if (modal) modal.style.display = 'none'; }
const isOpen = () => !!modal && modal.style.display !== 'none';

function build() {
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="modal-content route-detail">'
        + '<div class="modal-header" style="display:flex; align-items:center; gap:10px;"><span>동선 효율 자세히</span>'
        + '<button class="modal-x" data-esc-close aria-label="닫기">×</button></div>'
        + '<div class="rd-body"></div></div>';
    // 바깥 클릭으로 닫기 — 누른 곳과 뗀 곳이 모두 바깥일 때만(창을 끌다 밖에서 놓으면 닫히지 않게)
    let downOnOverlay = false;
    modal.addEventListener('mousedown', (e) => { downOnOverlay = e.target === modal; });
    modal.addEventListener('click', (e) => {
        if (e.target === modal && downOnOverlay) close();
        else if (e.target.closest('[data-esc-close]')) close();
    });
    document.body.appendChild(modal);
}

const g = (v) => (v == null ? '-' : v.toFixed(1));

function headHtml(h) {
    const box = (label, value, sub, title) => `<div class="rd-kpi"${title ? ` title="${escapeHtml(title)}"` : ''}>`
        + `<div class="rd-kpi-label">${escapeHtml(label)}</div><div class="rd-kpi-value">${escapeHtml(value)}</div>`
        + `<div class="rd-kpi-sub">${escapeHtml(sub)}</div></div>`;
    return '<div class="rd-kpis">'
        + box('지금 동선 점수', h.score, h.day ? `${h.day} 기준` : '', ROUTE_CARD_HELP)
        + box('추천 모두 적용 시', h.after || '-', h.gain ? `지금보다 ${h.gain}` : '', ROUTE_CARD_HELP)
        + box('지난주', h.prev || '-', h.prevDiff ? `지금은 ${h.prevDiff}` : '')
        + box('앞쪽 자리 출고', h.front, '하루 출고 중 앞쪽 자리 몫', FRONT_HELP)
        + box('계산 대상', h.coverage ? `출고의 ${h.coverage}` : '-', h.items ? `상품 ${h.items}개` : '', '기타·비축 자리에만 있는 상품은 빠집니다.')
        + '</div>';
}

function trendHtml(latest) {
    const all = trendSeries(latest.days, todayKey(), 60);
    if (!trendPoints(all)) return '<div class="ins-desc">아직 추이 기록이 없습니다(2026-10-26 부터 쌓입니다).</div>';
    // 기록이 쌓이기 전에는 선이 오른쪽 끝에 몰리지 않게 첫 기록 날부터(최소 14일) 그린다
    const first = all.findIndex(p => p.now != null || p.after != null);
    const series = all.slice(Math.max(0, Math.min(first, all.length - 14)));
    const rows = trendRows(series);
    const body = rows.map(r => r.rest
        ? `<tr class="rd-rest"><td>${escapeHtml(r.label)}</td><td colspan="3">쉬는 날</td></tr>`
        : `<tr><td>${escapeHtml(r.label)}</td><td>${g(r.now)}</td><td>${g(r.after)}</td><td>${r.diff == null ? '-' : (r.diff > 0 ? '+' : '') + r.diff.toFixed(1)}</td></tr>`).join('');
    return '<div class="rd-trend">'
        + `<div class="rd-trend-chart">${trendSvg(series, { w: 640, h: 200 })}`
        + '<div class="ins-desc locrec-trend-legend"><span class="lg-now">━ 지금</span> <span class="lg-after">┅ 추천 모두 적용 후</span> · 최근 ' + series.length + '일</div></div>'
        + '<div class="table-box rd-trend-table"><table class="usage-table"><thead><tr><th>날짜</th><th>지금</th><th>적용 시</th><th>차이</th></tr></thead>'
        + `<tbody>${body}</tbody></table></div></div>`;
}

function heatHtml(heat) {
    const d = routeHeatDetail(heat);
    if (!d.has) return '<div class="ins-desc">구역 × 동 자료가 아직 없습니다(매일 06:40 계산).</div>';
    const pct = (p) => (p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`);
    const head = '<tr><th>구역</th>' + d.dongs.map(x => `<th>${escapeHtml(x.dong)}동</th>`).join('') + '<th>구역 합</th></tr>';
    const body = d.rows.map(r => `<tr><th>${escapeHtml(r.zone)}</th>`
        + r.cells.map(c => `<td class="${c.level == null ? 'hx' : 'h' + c.level}" title="${escapeHtml(c.title)}">${escapeHtml(c.text)}</td>`).join('')
        + `<td class="rd-sum">${escapeHtml(r.sumTxt)} <span>${pct(r.pct)}</span></td></tr>`).join('');
    const foot = '<tr><th>동 합</th>' + d.dongs.map(x => `<td class="rd-sum">${escapeHtml(x.sumTxt)} <span>${pct(x.pct)}</span></td>`).join('')
        + `<td class="rd-sum">${escapeHtml(d.totalTxt)}</td></tr>`;
    return `<div class="route-heat rd-heat"><table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`
        + `<div class="ins-desc">칸 숫자 = 하루 평균 출고 개수 · 진할수록 많음 · 왼쪽이 앞쪽(가까운) 동 · 빗금 칸은 자리 없음. ${escapeHtml(HEAT_HELP)}</div>`;
}

const HOW = [
    '동선 점수는 출고가 많은 상품이 앞자리(구역·동·위치 순위)에 있을수록 높습니다. 100 = 출고 많은 순서대로 앞자리부터 채운 이론상 최선, 0 = 정반대입니다.',
    '하루 출고는 최근 출고를 최근일수록 무겁게 본 하루 평균입니다(플랫폼·국내 구분 없음).',
    "'추천 모두 적용 시'는 그날 변경 추천을 모두 처리했을 때 점수입니다('안 함' 제외).",
    '앞쪽 자리는 구역마다 앞 20% 칸입니다. 매일 06:40, 그리고 [지금 재고로 다시 만들기] 때 다시 계산합니다.'
];

function render() {
    if (!modal || !store) return;
    const S = store.get();
    const L = S.latest;
    const h = routeDetailHead(L);
    const el = modal.querySelector('.rd-body');
    if (!h.has) { el.innerHTML = '<div class="ins-desc">아직 동선 점수가 없습니다(매일 06:40 계산).</div>'; return; }
    el.innerHTML = headHtml(h)
        + `<h4 class="rd-h">점수 추이</h4>${trendHtml(L)}`
        + `<h4 class="rd-h">구역 × 동 출고</h4>${heatHtml(L.metrics && L.metrics.routeHeat)}`
        + `<h4 class="rd-h">계산 방법</h4><ul class="rd-how">${HOW.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`;
}

/** 카드를 누르면 — 자료가 없으면 열지 않는다 */
export function openRouteDetail(s) {
    if (!s) return;
    if (!routeDetailHead(s.get().latest).has) return;
    if (!store) { store = s; store.on(() => { if (isOpen()) render(); }); }
    if (!modal) build();
    render();
    modal.style.display = 'flex';
}
