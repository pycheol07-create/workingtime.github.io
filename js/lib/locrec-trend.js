// === js/lib/locrec-trend.js ===
// 로케이션 변경 추천 카드(js/locrec-card.js)의 '동선 점수' 추이 그래프 — 순수 함수(node --test 대상, DOM 없음).
//   자료: integrations/locRecLatest.days[YYYYMMDD].metrics.routeScore(지금) · routeScoreAfter(오늘 추천을 모두 적용하면)
//         서버(로케이션추천\추천.py)가 2026-10-26 부터 남긴다 — 그 전 날짜는 빈 칸(선이 끊긴다). 색인 days 는 60일 보관.
//   그림: 실선 = 지금, 점선 = 적용 후. 실패·기록 없는 날·옛 날짜는 null → 선을 끊는다. 쉬는 날(rest)은 끊지 않고 건너 잇는다.
//   색은 CSS 변수(라이트·다크 같이 따라감) — style 속성에 var(--…, 대체값) 으로 쓴다. 글자는 모두 escape.
import { lastDays, dayLabel } from './refill-view.js?v=202610281229';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** SVG 글자·속성용 escape(테스트에서도 쓴다) */
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 최근 n 일(오래된 날 → 오늘) → [{key, now, after, rest}] — 값이 없는 날은 null.
 *   status 가 ok 가 아니면(쉬는 날·실패) 값이 있어도 null. 쉬는 날(rest)은 rest: true — 선을 끊지 않고 건너 잇는다.
 */
export function trendSeries(days, todayKey, n = 60) {
    const d = days || {};
    return lastDays(todayKey, n).reverse().map(key => {
        const e = d[key];
        const m = e && e.status === 'ok' && e.metrics ? e.metrics : null;
        return { key, now: m ? num(m.routeScore) : null, after: m ? num(m.routeScoreAfter) : null, rest: !!(e && e.status === 'rest') };
    });
}

/** 값이 있는 점 수 */
export function trendPoints(series) {
    return (series || []).filter(p => p && (p.now != null || p.after != null)).length;
}

/** 점 목록 → null 에서 끊긴 path d 와 외톨이 점. 'skip'(쉬는 날)은 끊지 않고 건너뛴다 */
function pathOf(pts) {
    const segs = [];
    let cur = [];
    pts.forEach(p => {
        if (p === 'skip') return;
        if (!p) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push(p);
    });
    if (cur.length) segs.push(cur);
    const xy = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    return {
        d: segs.filter(s => s.length > 1).map(s => s.map((p, i) => (i ? 'L' : 'M') + xy(p)).join('')).join(''),
        dots: segs.filter(s => s.length === 1).map(s => s[0])
    };
}

/**
 * 추이 SVG 문자열. 점이 하나도 없으면 ''.
 *   세로 범위는 값의 최소~최대(±1, 0~100 안), 왼쪽에 위·아래 값, 아래에 첫날·마지막 날.
 * @param {Array<{key, now, after}>} series  trendSeries 결과
 * @param {{w?: number, h?: number}} [opt]
 */
export function trendSvg(series, { w = 320, h = 72 } = {}) {
    const list = Array.isArray(series) ? series : [];
    const vals = [];
    list.forEach(p => { [p && p.now, p && p.after].forEach(v => { if (v != null) vals.push(v); }); });
    if (!vals.length) return '';
    let lo = Math.max(0, Math.floor(Math.min(...vals) - 1));
    let hi = Math.min(100, Math.ceil(Math.max(...vals) + 1));
    if (hi - lo < 2) { lo = Math.max(0, hi - 2); hi = lo + 2; }
    const padL = 26, padR = 6, padT = 6, padB = 16;
    const iw = w - padL - padR, ih = h - padT - padB;
    const n = list.length;
    const x = (i) => padL + (n > 1 ? (iw * i) / (n - 1) : iw / 2);
    const y = (v) => padT + ih * (1 - (v - lo) / (hi - lo));
    const line = (k) => pathOf(list.map((p, i) => (p && p[k] != null ? [x(i), y(p[k])] : p && p.rest ? 'skip' : null)));
    const now = line('now'), after = line('after');
    const C_NOW = 'var(--c-accent, #2F62C9)', C_AFTER = 'var(--c-ok-text, #3D756F)', C_AXIS = 'var(--c-line, #E6E8EC)', C_TXT = 'var(--c-text-3, #69707A)';
    const first = list[0], last = list[n - 1];
    const lastVal = [...list].reverse().find(p => p && p.now != null);
    const title = `동선 점수 추이(최근 ${n}일) — 실선: 지금, 점선: 추천 모두 적용 후`
        + (lastVal ? ` · 최근 ${dayLabel(lastVal.key)} ${lastVal.now.toFixed(1)}${lastVal.after != null ? ` → ${lastVal.after.toFixed(1)}` : ''}` : '');
    const dot = (p, c) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" style="fill:${c}"/>`;
    return `<svg class="locrec-trend-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
        + `<title>${esc(title)}</title>`
        + `<line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" style="stroke:${C_AXIS};stroke-width:1"/>`
        + `<line x1="${padL}" y1="${padT + ih}" x2="${w - padR}" y2="${padT + ih}" style="stroke:${C_AXIS};stroke-width:1"/>`
        + `<text x="${padL - 4}" y="${padT + 4}" text-anchor="end" style="fill:${C_TXT};font-size:9px">${esc(hi)}</text>`
        + `<text x="${padL - 4}" y="${padT + ih}" text-anchor="end" style="fill:${C_TXT};font-size:9px">${esc(lo)}</text>`
        + `<text x="${padL}" y="${h - 3}" style="fill:${C_TXT};font-size:9px">${esc(first ? dayLabel(first.key) : '')}</text>`
        + `<text x="${w - padR}" y="${h - 3}" text-anchor="end" style="fill:${C_TXT};font-size:9px">${esc(last ? dayLabel(last.key) : '')}</text>`
        + (after.d ? `<path d="${after.d}" style="fill:none;stroke:${C_AFTER};stroke-width:1.5;stroke-dasharray:4 3" vector-effect="non-scaling-stroke"/>` : '')
        + (now.d ? `<path d="${now.d}" style="fill:none;stroke:${C_NOW};stroke-width:1.8" vector-effect="non-scaling-stroke"/>` : '')
        + after.dots.map(p => dot(p, C_AFTER)).join('') + now.dots.map(p => dot(p, C_NOW)).join('')
        + '</svg>';
}
