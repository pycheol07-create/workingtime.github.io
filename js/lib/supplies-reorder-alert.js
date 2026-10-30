// === js/lib/supplies-reorder-alert.js ===
// 대시보드 '주요 일정 및 알림' 의 비품 발주 알림 — 어떤 비품을 띄울지·문구(2026-10-20).
//
// 판정은 비품관리 화면과 같은 규칙(js/lib/supplies-forecast-view.js 의 effectiveStatus·reorderDaysLeft)을 그대로 쓴다.
//   - 발주 권장일까지 남은 달력일이 within(기본 5) 이하 — 지난 날짜(음수)도 넣는다
//   - 화면 상태가 '발주함'(ordered)·'입고됨'(received)이면 뺀다. 예측이 없는 비품(nocode·pending)도 뺀다
// 표시하는 것은 비품 이름과 남은 날뿐이다(단가·업체는 넣지 않는다).
// 순수 모듈 — 테스트: tests/supplies-reorder-alert.test.js

import { effectiveStatus, reorderDaysLeft, kstToday } from './supplies-forecast-view.js?v=202610301657';

export const ALERT_WITHIN_DAYS = 5;
const SKIP = new Set(['ordered', 'received', 'nocode', 'pending']);

/** 발주 알림 대상 [{ id, name, reorderDate, days }] — 남은 날 적은 순, 같으면 이름순.
 *  items = persistent_data/supplies 의 items, forecastDoc = integrations/suppliesForecast, ordersDoc = persistent_data/suppliesOrders */
export function reorderAlerts(items, forecastDoc, ordersDoc, today = kstToday(), within = ALERT_WITHIN_DAYS) {
    const fcs = (forecastDoc && typeof forecastDoc.items === 'object' && forecastDoc.items) || {};
    const orders = (ordersDoc && typeof ordersDoc.orders === 'object' && ordersDoc.orders) || {};
    const out = [];
    for (const it of (Array.isArray(items) ? items : [])) {
        if (!it || !it.id) continue;
        const fc = fcs[it.id] || null;
        const order = orders[it.id] || null;
        if (SKIP.has(effectiveStatus(it, fc, order))) continue;
        const days = reorderDaysLeft(fc, today);
        if (days == null || days > within) continue;
        out.push({ id: it.id, name: String(it.name || '').trim() || '(이름 없음)', reorderDate: fc.reorderDate, days });
    }
    return out.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}

/** 남은 날 → '3일 지남' · '오늘' · '내일' · '3일 뒤'. */
export function alertDayLabel(days) {
    const n = days == null || days === '' ? NaN : Number(days);
    if (!Number.isFinite(n)) return '';
    if (n < 0) return `${-n}일 지남`;
    if (n === 0) return '오늘';
    if (n === 1) return '내일';
    return `${n}일 뒤`;
}

/** 한 줄 '비품 발주 필요 3건 — 대봉투(오늘), 테이프(3일 뒤) 외 1건'. 대상이 없으면 ''. maxNames 개까지만 이름을 쓴다. */
export function alertSummaryText(alerts, maxNames = 3) {
    const list = Array.isArray(alerts) ? alerts : [];
    if (list.length === 0) return '';
    const shown = list.slice(0, Math.max(1, maxNames)).map(a => `${a.name}(${alertDayLabel(a.days)})`);
    const rest = list.length - shown.length;
    return `비품 발주 필요 ${list.length}건 — ${shown.join(', ')}${rest > 0 ? ` 외 ${rest}건` : ''}`;
}
