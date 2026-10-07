// node --test — js/lib/mibal-forecast.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvgRise, predictByShip, mibalByArrival, makeArrivalLookup, DEFAULT_RISE }
    from '../js/lib/mibal-forecast.js?v=202610071546';

// 2026-10-07 실측 MIBAL_HISTORY 와 같은 모양
const H = {
    '2026-09-05|2026-09-08': { 출고일: '2026-09-05', 전송날짜: '2026-09-08', 입고일: '', 미발수량: 61 },
    '2026-09-10|2026-09-17': { 출고일: '2026-09-10', 전송날짜: '2026-09-17', 입고일: '2026-09-17', 미발수량: 596 },
    '2026-09-11|2026-09-17': { 출고일: '2026-09-11', 전송날짜: '2026-09-17', 입고일: '2026-09-17', 미발수량: 596 },
    '2026-09-20|2026-09-22': { 출고일: '2026-09-20', 전송날짜: '2026-09-22', 입고일: '', 미발수량: 288 },
    '2026-09-20|2026-09-29': { 출고일: '2026-09-20', 전송날짜: '2026-09-29', 입고일: '2026-09-29', 미발수량: 594 },
    '2026-09-23|2026-09-28': { 출고일: '2026-09-23', 전송날짜: '2026-09-28', 입고일: '', 미발수량: 86 },
    '2026-09-23|2026-10-02': { 출고일: '2026-09-23', 전송날짜: '2026-10-02', 입고일: '2026-10-02', 미발수량: 97 },
    '2026-09-30|2026-10-02': { 출고일: '2026-09-30', 전송날짜: '2026-10-02', 입고일: '', 미발수량: 996 },
};
const 공휴일 = new Set(['2026-10-09']);
const isOffDay = (ds) => { const g = new Date(ds + 'T00:00:00').getDay(); return g === 0 || g === 6 || 공휴일.has(ds); };

test('평균상승률: 1~100% 만 (9/20 은 +106% 라 빠지고 9/23 +12.8% 만)', () => {
    const r = computeAvgRise(H);
    assert.equal(r.n, 1);
    assert.ok(Math.abs(r.avg - (97 - 86) / 86) < 1e-9);
});

test('표본이 없으면 기본 40%', () => {
    const p = predictByShip({ a: { 출고일: '2026-10-01', 전송날짜: '2026-10-02', 입고일: '', 미발수량: 100 } });
    assert.equal(p[0].예상미발, Math.round(100 * (1 + DEFAULT_RISE)));
    assert.equal(p[0].종류, '예상미발');
});

test('9/30 패킹 → 입고일정에서 10/8 도착을 찾아 예상미발을 더한다', () => {
    const lookup = makeArrivalLookup({ '2026-10-08': { entries: [{ packDateText: '9/30일자' }] } });
    const m = mibalByArrival(H, { arrivalOf: lookup, today: '2026-10-07', isOffDay });
    const rate = (97 - 86) / 86;
    assert.deepEqual(Object.keys(m), ['2026-10-08']);
    assert.equal(m['2026-10-08'].qty, Math.round(996 * (1 + rate)));
    assert.match(m['2026-10-08'].lines[0], /9\/30 패킹 예상미발/);
});

test('오늘 이전 도착분은 빼고, 도착일을 모르면 더하지 않는다', () => {
    const m = mibalByArrival(H, { arrivalOf: () => '', today: '2026-10-07', isOffDay });
    assert.deepEqual(m, {});
});

test('같은 날 같이 전송된 출고일 묶음(합계가 출고일마다 복제 기록)은 한 번만 더한다', () => {
    const h = {
        a: { 출고일: '2026-10-10', 전송날짜: '2026-10-12', 입고일: '2026-10-15', 미발수량: 500 },
        b: { 출고일: '2026-10-11', 전송날짜: '2026-10-12', 입고일: '2026-10-15', 미발수량: 500 },
        c: { 출고일: '2026-10-10', 전송날짜: '2026-10-15', 입고일: '2026-10-15', 미발수량: 600 },
        d: { 출고일: '2026-10-11', 전송날짜: '2026-10-15', 입고일: '2026-10-15', 미발수량: 600 },
    };
    const m = mibalByArrival(h, { today: '2026-10-13', isOffDay });
    assert.equal(m['2026-10-15'].qty, 600);                 // 입고미발 600 한 번 (1,200 아님)
    assert.equal(m['2026-10-15'].lines.length, 1);
    assert.match(m['2026-10-15'].lines[0], /10\/10·10\/11 패킹 입고미발 600/);
});

test('도착일이 쉬는 날이면 다음 근무일로 넘긴다 (10/9 한글날 금 → 10/12 월)', () => {
    const h = { a: { 출고일: '2026-10-01', 전송날짜: '2026-10-05', 입고일: '2026-10-09', 미발수량: 100 } };
    const m = mibalByArrival(h, { today: '2026-10-07', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-12']);
    assert.match(m['2026-10-12'].lines[0], /다음 근무일/);
});

test('같은 패킹이 여러 날로 나뉘어 오면 가장 이른 도착일 하나에만', () => {
    const lookup = makeArrivalLookup({
        '2026-10-12': { entries: [{ packDateText: '10/1일자' }] },
        '2026-10-08': { entries: [{ packDateText: '10/1일자' }] },
    });
    assert.equal(lookup('2026-10-01'), '2026-10-08');
    assert.equal(lookup('2026-10-02'), '');
});

test('90일보다 오래된 출고일은 잇지 않는다(연도 없는 M/D 매칭 충돌 방지)', () => {
    const h = { a: { 출고일: '2025-10-08', 전송날짜: '2025-10-09', 입고일: '', 미발수량: 100 } };
    const lookup = makeArrivalLookup({ '2026-10-12': { entries: [{ packDateText: '10/8일자' }] } });
    assert.deepEqual(mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-07', isOffDay }), {});
});

test('빈 이력·이상한 값', () => {
    assert.deepEqual(mibalByArrival({}, { today: '2026-10-07' }), {});
    assert.deepEqual(mibalByArrival(null, { today: '2026-10-07' }), {});
    assert.equal(computeAvgRise(null), null);
});

test('나눠 들어오는 패킹: 첫 분량이 이미 도착했으면 뒤 분량에 또 더하지 않는다', () => {
    const h = { a: { 출고일: '2026-09-30', 전송날짜: '2026-10-02', 입고일: '', 미발수량: 996 } };
    const lookup = makeArrivalLookup({
        '2026-10-08': { entries: [{ packDateText: '9/30일자' }] },   // 지난 날(이미 도착)
        '2026-10-13': { entries: [{ packDateText: '9/30일자' }] },
    });
    assert.deepEqual(mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-09', isOffDay }), {});
    // 첫 분량 도착 전에는 가장 이른 날 한 번만
    const m = mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-07', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-08']);
});

test('입고일정의 도착일이 기록의 입고일(전송 때 값)보다 우선 — 일정이 밀리면 따라간다', () => {
    const h = { a: { 출고일: '2026-09-30', 전송날짜: '2026-10-02', 입고일: '2026-10-08', 미발수량: 100 } };
    const lookup = makeArrivalLookup({ '2026-10-13': { entries: [{ packDateText: '9/30일자' }] } });
    const m = mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-07', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-13']);
});

test('같이 전송된 묶음이 다른 날로 갈려도 가장 이른 날 한 번만', () => {
    const h = {
        a: { 출고일: '2026-09-26', 전송날짜: '2026-10-02', 입고일: '2026-10-08', 미발수량: 600 },
        b: { 출고일: '2026-09-28', 전송날짜: '2026-10-02', 입고일: '', 미발수량: 600 },
    };
    const lookup = makeArrivalLookup({ '2026-10-12': { entries: [{ packDateText: '9/28일자' }] } });
    const m = mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-07', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-08']);
    assert.equal(m['2026-10-08'].lines.length, 1);
    assert.match(m['2026-10-08'].lines[0], /9\/26·9\/28 패킹/);
});

test('묶음 중 하나만 도착일에 다시 전송했으면(입고미발) 그 값 하나만 쓴다', () => {
    const h = {
        a1: { 출고일: '2026-09-26', 전송날짜: '2026-10-02', 입고일: '2026-10-08', 미발수량: 600 },
        b1: { 출고일: '2026-09-28', 전송날짜: '2026-10-02', 입고일: '2026-10-08', 미발수량: 600 },
        a2: { 출고일: '2026-09-26', 전송날짜: '2026-10-08', 입고일: '2026-10-08', 미발수량: 700 },
    };
    const m = mibalByArrival(h, { today: '2026-10-08', isOffDay });
    assert.equal(m['2026-10-08'].qty, 700);
    assert.equal(m['2026-10-08'].lines.length, 1);
});

test('쉬는 날 도착분은 넘겨진 근무일 당일에도 남아 있다 (토 10/10 도착 → 월 10/12, 오늘=10/12)', () => {
    const h = { a: { 출고일: '2026-10-01', 전송날짜: '2026-10-05', 입고일: '2026-10-10', 미발수량: 100 } };
    const m = mibalByArrival(h, { today: '2026-10-12', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-12']);
});

test('입고일에 다시 전송한 기록(입고미발)이 지난 날짜면, 일정에 뒤 분량이 남아 있어도 더하지 않는다', () => {
    const h = {
        a1: { 출고일: '2026-09-30', 전송날짜: '2026-09-28', 입고일: '2026-10-02', 미발수량: 900 },
        a2: { 출고일: '2026-09-30', 전송날짜: '2026-10-02', 입고일: '2026-10-02', 미발수량: 996 },
    };
    const lookup = makeArrivalLookup({ '2026-10-12': { entries: [{ packDateText: '9/30일자' }] } });
    assert.deepEqual(mibalByArrival(h, { arrivalOf: lookup, today: '2026-10-10', isOffDay }), {});
});

test('토요일 입고분을 월요일에 입고미발로 전송해도 그 월요일에 남아 있다', () => {
    const h = {
        a1: { 출고일: '2026-10-01', 전송날짜: '2026-10-05', 입고일: '2026-10-10', 미발수량: 100 },
        a2: { 출고일: '2026-10-01', 전송날짜: '2026-10-12', 입고일: '2026-10-10', 미발수량: 130 },
    };
    const m = mibalByArrival(h, { today: '2026-10-12', isOffDay });
    assert.deepEqual(Object.keys(m), ['2026-10-12']);
    assert.equal(m['2026-10-12'].qty, 130);
});
