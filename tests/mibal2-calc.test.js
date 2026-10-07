// node --test — js/lib/mibal2-calc.js (신규 미발계산기 계산 모듈)
// 실행:  node --test tests/      (또는  npm test)
// 상품코드는 가짜(S000001 …). 실제 상품·고객 정보를 넣지 말 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcNew, calcOld, capacityFor, sumOrders, explain, zoneKey }
    from '../js/lib/mibal2-calc.js?v=202610071505';

// ---------- calcNew ----------
test('calcNew: 기본 — 도착이 미발보다 많으면 남는 건 비축', () => {
    const r = calcNew({ 정상: 18, 접수: 12, 송장: 3, 적재량: 30, 도착: 40 });
    assert.deepEqual(r, { 출고예정: 15, 남는양: 3, 미발: 27, 밀린주문: 0, 피킹행: 27, 비축행: 13, 보충필요: 0, flags: [] });
});

test('calcNew: 정상 0 + 밀린 주문 — 미발은 적재량까지만, 밀린주문은 따로', () => {
    const r = calcNew({ 정상: 0, 접수: 2, 송장: 1, 적재량: 20, 도착: 50 });
    assert.equal(r.남는양, -3);
    assert.equal(r.미발, 20);
    assert.equal(r.밀린주문, 3);
    assert.equal(r.피킹행, 20);
    assert.equal(r.비축행, 30);
    assert.deepEqual(r.flags, ['backlog']);
});

test('calcNew: 도착 < 미발 → 보충필요', () => {
    const r = calcNew({ 정상: 5, 접수: 0, 송장: 0, 적재량: 20, 도착: 10 });
    assert.equal(r.미발, 15);
    assert.equal(r.피킹행, 10);
    assert.equal(r.비축행, 0);
    assert.equal(r.보충필요, 5);
    assert.deepEqual(r.flags, ['needRefill']);
});

test('calcNew: 남는양 음수 → 미발은 적재량을 넘지 않는다(밀린 주문은 밀린주문 칸)', () => {
    const r = calcNew({ 정상: 4, 접수: 10, 송장: 4, 적재량: 15, 도착: 100 });
    assert.equal(r.남는양, -10);
    assert.equal(r.미발, 15);
    assert.equal(r.밀린주문, 10);
    assert.deepEqual(r.flags, ['backlog']);
});

test('calcNew: 정상이 적재량보다 많으면 미발 0, 도착 전부 비축', () => {
    const r = calcNew({ 정상: 50, 접수: 1, 송장: 0, 적재량: 20, 도착: 30 });
    assert.equal(r.미발, 0);
    assert.equal(r.피킹행, 0);
    assert.equal(r.비축행, 30);
});

test('calcNew: 적재량 0 → zeroCapacity (계산은 한다)', () => {
    const r = calcNew({ 정상: 3, 접수: 1, 송장: 0, 적재량: 0, 도착: 5 });
    assert.equal(r.미발, 0);
    assert.equal(r.비축행, 5);
    assert.ok(r.flags.includes('zeroCapacity'));
});

test('calcNew: 정상 null 은 모름(noStock, 계산 안 함) — 정상 0 과 다르다', () => {
    const r = calcNew({ 정상: null, 접수: 1, 송장: 1, 적재량: 20, 도착: 5 });
    assert.equal(r.미발, null);
    assert.equal(r.출고예정, null);
    assert.deepEqual(r.flags, ['noStock']);
    const u = calcNew({ 접수: 1, 송장: 1, 적재량: 20, 도착: 5 }); // undefined 도 모름
    assert.deepEqual(u.flags, ['noStock']);
    const z = calcNew({ 정상: 0, 접수: 1, 송장: 1, 적재량: 20, 도착: 5 });
    assert.equal(z.미발, 20);
    assert.equal(z.밀린주문, 2);
});

test('calcNew: 접수/송장 null 은 모름(noOrders, 계산 안 함) — 0 과 다르다', () => {
    const a = calcNew({ 정상: 5, 접수: null, 송장: 0, 적재량: 20, 도착: 5 });
    assert.equal(a.미발, null);
    assert.deepEqual(a.flags, ['noOrders']);
    const b = calcNew({ 정상: 5, 접수: 0, 송장: undefined, 적재량: 20, 도착: 5 });
    assert.deepEqual(b.flags, ['noOrders']);
    const c = calcNew({ 정상: 5, 접수: 0, 송장: 0, 적재량: 20, 도착: 5 });
    assert.equal(c.미발, 15);
    const d = calcNew({ 정상: null, 접수: null, 송장: null, 적재량: 0, 도착: 0 });
    assert.deepEqual(d.flags, ['zeroCapacity', 'noStock', 'noOrders']);
});

test('calcNew: NaN·소수·음수 방어', () => {
    const r = calcNew({ 정상: 10.9, 접수: '2', 송장: 1.5, 적재량: 20.7, 도착: -5 });
    // 정상 10, 접수 2, 송장 1, 적재량 20, 도착 0
    assert.deepEqual(r, { 출고예정: 3, 남는양: 7, 미발: 13, 밀린주문: 0, 피킹행: 0, 비축행: 0, 보충필요: 13, flags: ['needRefill'] });
    assert.deepEqual(calcNew({ 정상: NaN, 접수: 0, 송장: 0, 적재량: 20, 도착: 0 }).flags, ['noStock']);
    assert.deepEqual(calcNew({ 정상: 'abc', 접수: 0, 송장: 0, 적재량: 20, 도착: 0 }).flags, ['noStock']);
    assert.equal(calcNew({ 정상: 5, 접수: 0, 송장: 0, 적재량: 20, 도착: NaN }).피킹행, 0);
});

// ---------- calcOld (china-stock-goods.js:158 기본 공식) ----------
test('calcOld: 총재고 0 → 적재량', () => {
    assert.equal(calcOld({ 총재고: 0, 적재량: 20, 도착: 100, 부족수량: 5, 직진: 3 }), 20);
});
test('calcOld: 도착+총재고 <= 적재량 → 도착', () => {
    assert.equal(calcOld({ 총재고: 5, 적재량: 20, 도착: 15, 부족수량: 50, 직진: 0 }), 15);
});
test('calcOld: 부족+직진 > 총재고 → 부족+직진−총재고', () => {
    assert.equal(calcOld({ 총재고: 5, 적재량: 20, 도착: 30, 부족수량: 8, 직진: 2 }), 5);
});
test('calcOld: 셋 다 아니면 0', () => {
    assert.equal(calcOld({ 총재고: 10, 적재량: 20, 도착: 30, 부족수량: 3, 직진: 2 }), 0);
});
test('calcOld: 결과 음수는 0 (적재량 음수 + 총재고 0)', () => {
    assert.equal(calcOld({ 총재고: 0, 적재량: -5, 도착: 0, 부족수량: 0, 직진: 0 }), 0);
});

// ---------- capacityFor ----------
test('capacityFor: 구역 미설정 → 기본표, 없는 구역 0, 빈 로케이션 0', () => {
    assert.equal(capacityFor('A-01-01', {}, undefined), 20);
    assert.equal(capacityFor('e-02', null, null), 40);      // 소문자도 대문자로
    assert.equal(capacityFor('H-1', undefined), 15);
    assert.equal(capacityFor('X-1', {}), 0);
    assert.equal(capacityFor('', { zoneCapacity: { A: 99 } }), 0);
    assert.equal(capacityFor(null, {}), 0);
});

test('capacityFor: ★ 구역 — 별 개수 무관, 미설정 90, 설정값 우선', () => {
    assert.equal(zoneKey('★★-001'), '★');
    assert.equal(capacityFor('★-001', {}), 90);
    assert.equal(capacityFor('★★-001', {}), 90);
    assert.equal(capacityFor('★★-001', { zoneCapacity: { '★': 60 } }), 60);
    assert.equal(capacityFor('★-001', { zoneCapacity: { '★': '' } }), 90); // '' 는 미설정
});

test('capacityFor: 구역 설정값이 기본표보다 우선, 문자열 숫자 허용, 숫자 아니면 0', () => {
    assert.equal(capacityFor('A-01', { zoneCapacity: { A: 35 } }), 35);
    assert.equal(capacityFor('A-01', { zoneCapacity: { A: '25' } }), 25);
    assert.equal(capacityFor('A-01', { zoneCapacity: { A: 0 } }), 0);
    assert.equal(capacityFor('A-01', { zoneCapacity: { A: 'x' } }), 0);
    assert.equal(capacityFor('B-01', { zoneCapacity: { A: 35 } }), 20);
});

test('capacityFor: 개별 적재량(editedCell.capacity)이 최우선', () => {
    const cfg = { zoneCapacity: { A: 35 } };
    assert.equal(capacityFor('A-01', cfg, { capacity: 7 }), 7);
    assert.equal(capacityFor('A-01', cfg, { capacity: '12' }), 12);
    assert.equal(capacityFor('A-01', cfg, { capacity: 0 }), 0);
    assert.equal(capacityFor('', cfg, { capacity: 5 }), 5);           // 로케이션 없어도 개별값
    assert.equal(capacityFor('A-01', cfg, { capacity: '' }), 35);     // '' 는 미설정
    assert.equal(capacityFor('A-01', cfg, { shortage: '3' }), 35);    // capacity 없음
});

test('capacityFor: "/" 로 여러 로케이션이면 첫 칸 기준 (기존 :2251)', () => {
    assert.equal(capacityFor('E-01/★-002', {}), 40);
    assert.equal(capacityFor(' ★-002 / A-01', {}), 90);
});

// ---------- sumOrders ----------
test('sumOrders: 상품줄 order_cs 0·5 만, 1·3 제외, qty 문자열 합산', () => {
    const orders = [
        { order_products: [
            { product_id: 'S000001', qty: '2', order_cs: '0' },
            { product_id: 'S000002', qty: 1, order_cs: '5' },
            { product_id: 'S000001', qty: '3', order_cs: '1' },
        ] },
        { order_products: [
            { product_id: 'S000001', qty: '4', order_cs: 0 },
            { product_id: 'S000002', qty: '9', order_cs: '3' },
            { product_id: 'S000003', qty: 'abc', order_cs: '0' },
            { product_id: '', qty: '1', order_cs: '0' },
            { product_id: 'S000004', qty: '1' },                   // order_cs 없음 → 제외
        ] },
        { },                                                      // order_products 없음
        null,
    ];
    assert.deepEqual(sumOrders(orders), { S000001: 6, S000002: 1 });
});

test('sumOrders: okCs 를 바꿀 수 있고, 빈 입력은 빈 객체', () => {
    const orders = [{ order_products: [
        { product_id: 'S000001', qty: '2', order_cs: '0' },
        { product_id: 'S000001', qty: '3', order_cs: '1' },
    ] }];
    assert.deepEqual(sumOrders(orders, { okCs: ['1'] }), { S000001: 3 });
    assert.deepEqual(sumOrders(null), {});
    assert.deepEqual(sumOrders([]), {});
});

// ---------- explain ----------
test('explain: 기본 근거 문자열', () => {
    const input = { 정상: 18, 접수: 12, 송장: 3, 적재량: 30, 도착: 40 };
    assert.equal(explain(input, calcNew(input)),
        '출고예정 = 12+3 = 15 / 남는양 = 18−15 = 3 / 미발 = 30−max(3,0) = 27 / 도착 40 → 피킹 27, 비축 13');
});

test('explain: 남는양 음수·보충필요', () => {
    const input = { 정상: 4, 접수: 10, 송장: 4, 적재량: 15, 도착: 20 };
    assert.equal(explain(input, calcNew(input)),
        '출고예정 = 10+4 = 14 / 남는양 = 4−14 = (−10) / 미발 = 15−max((−10),0) = 15 / 도착 20 → 피킹 15, 비축 5 / 밀린주문 10(미발에 안 넣음 — 비축에서 꺼내 출고)');
});

test('explain: 모름이면 계산 안 함', () => {
    const a = { 정상: null, 접수: 1, 송장: 0, 적재량: 20, 도착: 0 };
    assert.equal(explain(a, calcNew(a)), '정상재고 모름 → 계산 안 함');
    const b = { 정상: null, 접수: null, 송장: 0, 적재량: 20, 도착: 0 };
    assert.equal(explain(b, calcNew(b)), '정상재고 모름, 접수/송장 모름 → 계산 안 함');
});
