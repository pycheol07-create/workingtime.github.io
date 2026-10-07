// === js/lib/mibal-forecast.js ===
// 중국 입고분의 '미발수량'을 도착일별로 모은다 — 업무 예상이 그날 국내배송에 더한다(2026-10-07).
//
// 왜: 입고일에는 미발 상품을 바로 내보내서 국내배송 실적이 미발수량만큼 튄다.
//     실측(2026-09~10): 9/17 +743(미발 596) · 9/22 +211(238) · 9/29 +1,016(594) · 10/2 +215(97).
//     AI 예측은 요일 평균이라 이 튐을 전혀 모른다. 입고일은 1~2주에 한 번이라 요일 평균에 섞인
//     몫은 작다 — 그래서 미발을 그대로 더한다.
//
// 데이터: Firestore ChinaStockGoods/MIBAL_HISTORY 의 map. 미발계산기의 '미발전송' 버튼이 쌓는다.
//   키 "출고일|전송날짜" → { 출고일(=패킹일), 전송날짜, 입고일(빈 값 가능), 미발수량 }
// 규칙은 미발계산기(js/china-stock-goods.js computeAvgRise·buildPredictionRows)와 **같게** 둔다 —
// 두 화면이 다른 '예상미발' 을 내면 안 된다. 저쪽 규칙을 바꾸면 여기도 바꿀 것.
//
// 순수 모듈(import 0). 달력·도착일 조회는 인자로 받는다 — 테스트에서 가짜를 넣는다.

export const DEFAULT_RISE = 0.4;      // 상승률 표본이 없을 때 미발계산기가 쓰는 기본값
export const RISE_MIN = 0.01;         // 미발계산기와 같은 이상치 제외 범위(시트 AVERAGEIFS 1~100%)
export const RISE_MAX = 1.00;
export const MAX_SHIP_AGE_DAYS = 90;  // 출고일이 이보다 오래된 패킹은 잇지 않는다(연도 없는 'M/D' 매칭의 연말 충돌 방지)

const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

/** 출고일별로 전송 기록을 묶어 날짜순 정렬 */
function groupByShip(history) {
    const byShip = {};
    Object.values(history || {}).forEach(r => {
        if (r && r.출고일) (byShip[r.출고일] = byShip[r.출고일] || []).push(r);
    });
    Object.values(byShip).forEach(recs => recs.sort((a, b) => String(a.전송날짜).localeCompare(String(b.전송날짜))));
    return byShip;
}

/** 여러 전송 중 입고일이 채워진 것 우선 (미발계산기 Ver 8.54 와 같음) */
const 입고일Of = (recs) => (recs.find(r => r.입고일) || {}).입고일 || '';

/** 평균상승률 — 패킹별 (입고시점미발 − 출고시점미발) / 출고시점미발, 1~100% 만 평균. 없으면 null */
export function computeAvgRise(history) {
    const rates = [];
    Object.values(groupByShip(history)).forEach(recs => {
        const 입고일 = 입고일Of(recs);
        const before = recs.find(r => !입고일 || String(r.전송날짜) < 입고일);
        const arr = 입고일 ? recs.find(r => String(r.전송날짜) >= 입고일) : null;
        if (!before || !arr) return;
        const a = num(before.미발수량), b = num(arr.미발수량);
        if (a <= 0) return;
        const rate = (b - a) / a;
        if (rate >= RISE_MIN && rate <= RISE_MAX) rates.push(rate);
    });
    return rates.length ? { avg: rates.reduce((s, x) => s + x, 0) / rates.length, n: rates.length } : null;
}

/** 출고일(패킹)별 예측 — 입고미발이 있으면 그 값, 없으면 예상미발 = round(출고미발 × (1+평균상승률)) */
export function predictByShip(history) {
    const avg = computeAvgRise(history);
    const rate = avg ? avg.avg : DEFAULT_RISE;
    return Object.entries(groupByShip(history)).map(([출고일, recs]) => {
        const 입고일 = 입고일Of(recs);
        const before = recs.find(r => !입고일 || String(r.전송날짜) < 입고일) || recs[0];
        const arrRec = 입고일 ? recs.find(r => String(r.전송날짜) >= 입고일) : null;
        const 출고미발 = num(before.미발수량);
        const 입고미발 = arrRec ? num(arrRec.미발수량) : null;
        const 예상미발 = Math.round(출고미발 * (1 + rate));
        return {
            출고일, 입고일, 출고미발, 입고미발, 예상미발,
            값: 입고미발 !== null ? 입고미발 : 예상미발,
            종류: 입고미발 !== null ? '입고미발' : '예상미발',
            전송날짜: before.전송날짜 || ''
        };
    });
}

const addDays = (ds, n) => {
    const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayGap = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

const md = (ds) => { const [, m, d] = String(ds).split('-'); return `${Number(m)}/${Number(d)}`; };

/**
 * 도착일별 미발.
 * @param history   MIBAL_HISTORY.map
 * @param opts.arrivalOf(출고일) → 'YYYY-MM-DD' | ''
 *        입고일정에서 그 패킹의 **가장 이른** 도착일(지난 날짜 포함). 기록의 입고일보다 우선한다 —
 *        기록의 입고일은 전송할 때 값이라 일정이 밀려도 따라가지 않는다.
 *        가장 이른 도착이 이미 지났으면(나눠 들어오는 패킹의 첫 분량 등) 미발은 이미 나간 것으로 보고 뺀다.
 * @param opts.today  'YYYY-MM-DD' — 이날 이전 도착분은 뺀다
 * @param opts.isOffDay(date) → bool   도착일이 쉬는 날이면 다음 근무일로 넘긴다(그날 국내배송은 0 이라 사라진다)
 * @returns { [도착일]: { qty, lines: [string], rate: {avg,n}|null } }
 */
export function mibalByArrival(history, { arrivalOf, today, isOffDay } = {}) {
    const avg = computeAvgRise(history);
    const rate = avg ? avg.avg : DEFAULT_RISE;

    // '미발전송' 은 여러 출고일을 같이 고르면 **합계를 출고일마다 똑같이** 기록한다.
    // 같은 전송(전송날짜 + 출고미발)에서 나온 출고일들은 한 묶음으로 보고 한 번만 더한다.
    // 묶음 안에서 도착일이 갈리면 가장 이른 날에, 입고미발이 하나라도 있으면 그 값을 쓴다.
    const groups = new Map();
    predictByShip(history).forEach(p => {
        if (!(p.값 > 0)) return;
        if (today && p.출고일 && dayGap(p.출고일, today) > MAX_SHIP_AGE_DAYS) return;
        const key = `${p.전송날짜}|${p.출고미발}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(p);
    });

    const out = {};
    groups.forEach(members => {
        // 도착일 입고 당일에 다시 '미발전송' 한 기록(입고미발)이 이미 지난 날짜면, 그 패킹 미발은 나간 것이다.
        // 일정은 최근 7일까지만 지난 행을 보내므로, 나눠 오는 패킹의 첫 분량이 그보다 오래 전이면
        // 일정만으로는 '이미 도착' 을 모른다 — 이 기록이 그걸 알려 준다(뒤 분량에 또 더하지 않게).
        // 입고일도 쉬는 날이면 다음 근무일로 넘긴 날짜로 비교한다 — 토요일 입고분을 월요일에 전송하면
        // 넘기기 전 날짜(토)로는 '지났다' 가 되어, 바로 그 월요일 미발이 사라진다.
        const 넘긴날 = (ds) => { let d = ds; if (isOffDay) for (let i = 0; i < 14 && isOffDay(d); i++) d = addDays(d, 1); return d; };
        if (today && members.some(p => p.종류 === '입고미발' && p.입고일 && 넘긴날(p.입고일) < today)) return;
        // 도착일은 입고일정을 먼저 따르고(일정이 밀리면 따라간다), 없을 때만 기록의 입고일을 쓴다.
        const arrivals = members
            .map(p => (arrivalOf ? (arrivalOf(p.출고일) || '') : '') || p.입고일 || '')
            .filter(Boolean).sort();
        if (!arrivals.length) return;                 // 도착일을 모르면 어느 날에도 더하지 않는다
        let 도착 = arrivals[0];
        let 넘김 = false;
        // 쉬는 날 넘김을 **먼저** 한다 — 넘기기 전 날짜로 '지났다' 를 판정하면, 토요일 도착분이
        // 월요일로 넘어간 바로 그 월요일에 '이미 지남' 으로 사라진다.
        if (isOffDay) {
            for (let i = 0; i < 14 && isOffDay(도착); i++) { 도착 = addDays(도착, 1); 넘김 = true; }
        }
        if (today && 도착 < today) return;           // 이미 도착(첫 분량 포함) — 미발은 나갔다
        const 입고 = members.filter(p => p.종류 === '입고미발').sort((a, b) => b.값 - a.값)[0];
        const 대표 = 입고 || members[0];
        const 출고들 = members.map(p => md(p.출고일)).join('·');
        const o = out[도착] || (out[도착] = { qty: 0, lines: [], rate: avg });
        o.qty += 대표.값;
        o.lines.push((입고
            ? `${출고들} 패킹 입고미발 ${대표.값.toLocaleString()}`
            : `${출고들} 패킹 예상미발 ${대표.값.toLocaleString()} (출고 때 ${대표.출고미발.toLocaleString()} × ${(1 + rate).toFixed(2)})`)
            + (넘김 ? ' — 도착일이 쉬는 날이라 다음 근무일로' : ''));
    });
    return out;
}

/** 입고일정의 'M/D일자' 와 출고일(YYYY-MM-DD)을 이어 도착일을 찾는 함수를 만든다.
 *  같은 패킹이 여러 날로 나뉘어 오면 **가장 이른** 도착일을 돌려준다(지난 날짜여도) —
 *  첫 분량이 이미 도착했으면 mibalByArrival 이 '이미 나감' 으로 보고 뺀다(뒤 분량에 또 더하지 않게).
 *  그래서 지난 도착 행(최근 며칠)까지 담긴 자료를 넣어야 한다.
 *  @param detailsByDate  { 'YYYY-MM-DD': { entries:[{packDateText:'9/30일자'}] } } */
export function makeArrivalLookup(detailsByDate) {
    const first = {};
    Object.keys(detailsByDate || {}).sort().forEach(date => {
        ((detailsByDate[date] || {}).entries || []).forEach(e => {
            const m = String(e && e.packDateText || '').match(/^(\d{1,2})\/(\d{1,2})/);
            if (!m) return;
            const k = `${Number(m[1])}/${Number(m[2])}`;
            if (!first[k]) first[k] = date;
        });
    });
    return (출고일) => {
        const [, mm, dd] = String(출고일 || '').split('-');
        if (!mm || !dd) return '';
        return first[`${Number(mm)}/${Number(dd)}`] || '';
    };
}
