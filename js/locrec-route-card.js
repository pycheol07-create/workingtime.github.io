// === js/locrec-route-card.js ===
// 로케이션관리 대시보드 인사이트 줄(재고 회전 · 다중 위치 · 데드 스톡 · 빈 자리 동, #dash-insight-row)의 '동선 효율' 카드.
//   큰 숫자 = 동선 점수(지금) · 추천 모두 적용 시 · 앞쪽 자리 출고(지금 → 적용 시) · 최근 60일 추이(js/lib/locrec-trend.js)
//   · 구역 × 동 출고 열지도(metrics.routeHeat, 옛 문서면 생략) · 기준일.
//   값은 integrations/locRecLatest 의 최신 지표 — 서버(업무자동화\앱\로케이션추천)가 매일 06:40 쓴다.
// 데이터: 변경 추천 카드(js/locrec-card.js)가 쓰는 js/locrec-store.js 싱글턴을 그대로 받는다(같은 문서를 두 번 구독하지 않는다).
//   그래서 이 카드는 변경 추천과 같은 권한(기능 location.locrec)일 때만 생긴다 — initLocRecCard 가 부른다.
// 그리는 때가 둘이다: ① store 가 바뀔 때(이 파일) ② location.js 가 인사이트 줄을 innerHTML 로 다시 그린 뒤(mountRouteSlot()).
//   인사이트 줄이 다시 그려지면 이 카드 칸도 사라지므로 location.js 가 그때마다 mountRouteSlot() 을 부른다.
// 모양은 인사이트 카드와 같은 클래스(insight-card · ins-big · ins-desc) — 색은 CSS 변수라 라이트·다크를 같이 따라간다.
import { escapeHtml } from './utils.js?v=202610291628';
import { routeCardInfo, routeHeatView, HEAT_HELP } from './lib/locrec-view.js?v=202610291628';
import { openRouteDetail } from './locrec-route-modal.js?v=202610291628';
import { trendSeries, trendPoints, trendSvg } from './lib/locrec-trend.js?v=202610291628';
import { todayKey } from './locrec-store.js?v=202610291628';

const SLOT_ID = 'dash-route-card';
const ROW_ID = 'dash-insight-row';
let store = null;

/** 변경 추천 카드가 시작될 때 한 번 — store 를 받아 두고 갱신 때마다 카드만 다시 그린다 */
export function initRouteCard({ store: s }) {
    if (store || !s) return;
    store = s;
    store.on(paintRouteCard);
    // 카드를 누르면 상세 창(js/locrec-route-modal.js) — 인사이트 줄은 innerHTML 로 다시 그려지므로 document 에 한 번만 위임
    const hit = (e) => e.target && e.target.closest && e.target.closest(`#${SLOT_ID}.is-clickable`);
    document.addEventListener('click', (e) => { if (hit(e) && !e.target.closest('a,button')) openRouteDetail(store); });
    document.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && hit(e) && e.target.id === SLOT_ID) { e.preventDefault(); openRouteDetail(store); }
    });
    mountRouteSlot();
}

/** 인사이트 줄에 카드 칸을 붙이고 그린다(없으면 붙인다). 권한이 없어 시작 안 했으면 아무것도 안 한다 */
export function mountRouteSlot() {
    if (!store) return;
    const row = document.getElementById(ROW_ID);
    if (!row) return;
    // 재고 자료가 없어 인사이트 카드가 안 그려졌으면(대시보드가 일찍 return) 이 카드 혼자 뜨지 않게 한다
    if (!row.querySelector('.insight-card:not(.route-card)')) return;
    row.classList.add('has-route');
    if (!document.getElementById(SLOT_ID)) {
        const el = document.createElement('div');
        el.className = 'insight-card route-card';
        el.id = SLOT_ID;
        row.appendChild(el);
    }
    paintRouteCard();
}

/** 구역 × 동 열지도(metrics.routeHeat) — 자료가 없거나 모양이 틀리면 '' (옛 문서) */
function heatHtml(heat) {
    const v = routeHeatView(heat);
    if (!v.has) return '';
    const cols = v.rows[0].cells.length;
    const body = v.rows.map(r => `<b title="${escapeHtml(`구역 ${r.zone} · 하루 ${Math.round(r.sum).toLocaleString('ko-KR')}개`)}">${escapeHtml(r.zone)}</b>`
        + r.cells.map(c => `<i class="${c.level == null ? 'hn' : 'h' + c.level}" title="${escapeHtml(c.title)}"></i>`).join('')).join('');
    const note = `왼쪽 = 앞쪽(좋은) 동 · 진할수록 출고 많음${v.more ? ` · 외 ${v.more}구역` : ''}`;   // 한 줄 — 좁으면 말줄임이라 전문을 title 에도
    return `<div class="route-heat" title="${escapeHtml(HEAT_HELP)}"><div class="rh-grid" style="--rh-cols:${cols};">${body}</div>`
        + `<div class="ins-desc rh-note" title="${escapeHtml(note + '\n' + HEAT_HELP)}">${escapeHtml(note)}</div></div>`;
}

let lastHtml = '';
function paintRouteCard() {
    const el = document.getElementById(SLOT_ID);
    if (!el || !store) return;
    const S = store.get();
    let inner;
    if (!S.signedIn) {
        inner = '<div class="ins-big">-</div><div class="ins-desc">로그인하면 보입니다.</div>';
    } else if (S.latest == null) {
        inner = S.latestErr
            ? `<div class="ins-big">-</div><div class="ins-desc">동선 점수를 읽지 못했습니다(${escapeHtml(S.latestErr)})</div>`
            : '<div class="ins-big">-</div><div class="ins-desc">불러오는 중…</div>';
    } else {
        const c = routeCardInfo(S.latest);
        if (!c.has) {
            inner = '<div class="ins-big">-</div><div class="ins-desc">매일 06:40 계산합니다(아직 동선 점수가 없습니다).</div>';
        } else {
            const series = trendSeries(S.latest.days, todayKey(), 60);
            inner = `<div class="route-split"><div class="route-main"><div class="ins-big" title="${escapeHtml(c.scoreTitle)}" style="cursor:help;">${escapeHtml(c.score)}<span class="kpi-unit"> 점</span></div>`
                + (c.after ? `<div class="ins-desc route-after">${escapeHtml(c.after)}</div>` : '')
                + `<div class="ins-desc" title="${escapeHtml(c.frontTitle)}" style="cursor:help;">앞쪽 자리 출고 <b>${escapeHtml(c.front)}</b></div>`
                + (trendPoints(series) ? `<div class="locrec-trend">${trendSvg(series, { w: 240, h: 64 })}`
                    + '<div class="ins-desc locrec-trend-legend"><span class="lg-now">━ 지금</span> <span class="lg-after">┅ 추천 모두 적용 후</span> · 최근 60일</div></div>' : '')
                + `<div class="ins-desc route-day">${c.day ? `${escapeHtml(c.day)} 기준` : ''}${c.prev ? `${c.day ? ' · ' : ''}지난주 ${escapeHtml(c.prev)}` : ''}</div></div>`
                + `<div class="route-side">${heatHtml(S.latest.metrics && S.latest.metrics.routeHeat)}</div></div>`;   // 오른쪽 = 열지도
        }
    }
    const clickable = !!(S.signedIn && S.latest != null && routeCardInfo(S.latest).has);
    el.classList.toggle('is-clickable', clickable);     // 클래스·tabindex 는 카드 요소에 — 아래 innerHTML 비교와 섞이지 않게
    if (clickable) el.tabIndex = 0; else el.removeAttribute('tabindex');
    const html = `<h4 title="출고 많은 상품이 앞자리에 있을수록 높습니다(100 = 이론상 완벽)${clickable ? ' — 누르면 자세히' : ''}">동선 효율${clickable ? '<span class="route-more">자세히 ›</span>' : ''}</h4>${inner}`;
    if (html === lastHtml && el.innerHTML) return;     // 같으면 다시 그리지 않는다
    lastHtml = html;
    el.innerHTML = html;
}
