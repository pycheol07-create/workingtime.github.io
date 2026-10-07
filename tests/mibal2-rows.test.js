// node --test — js/lib/mibal2-rows.js (신규 미발계산기 '입력 묶음 → 행' 순수 함수)
// 실행:  node --test tests/      (또는  npm test)
// 상품코드·로케이션은 가짜(S000001 …). 실제 상품·고객 정보를 넣지 말 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    withinGrace, arrivalFor, buildLocIndex, computeRows, summarize, compareRowsOf,
    graceDaysFrom, legacyDatesFrom, selectedDatesFrom,
    oldMapFromScan, oldMapFromDaily, editedFromDaily, locFromDaily
} from '../js/lib/mibal2-rows.js?v=202610071540';

const NOW = new Date(2026, 9, 7, 9, 0, 0);   // 2026-10-07 09:00 (로컬)

/** 기본 입력 묶음 — 필요한 칸만 덮어써서 쓴다 */
function bundle(over = {}) {
    return {
        stockRows: { S000001: { n: 18, r: 12, i: 3 } },
        shipItems: { S000001: { nm: '가짜상품', op: '블랙', s: [['2026-10-01', '', 40]] } },
        oldMap: { S000001: { mibal: 20, arr: 40 } },
        zoneConfig: { zoneCapacity: {} },
        edited: {},
        loc: { S000001: { id: 'A-1-1', count: 1, etcOnly: false } },
        selectedDates: ['2026-10-01'],
        graceDays: 1,
        now: NOW,
        ...over
    };
}

test('withinGrace: now 기준 — 도착일+유예가 오늘 이후(포함)면 유지', () => {
    assert.equal(withinGrace('2026-10-06', 1, NOW), true);    // 10/6+1 = 10/7 → 오늘 포함
    assert.equal(withinGrace('2026-10-05', 1, NOW), false);
    assert.equal(withinGrace('2026-10-05', 1, new Date(2026, 9, 6, 9)), true);   // 기준일을 바꾸면 결과도 바뀐다(날짜별 보기)
    assert.equal(withinGrace('깨진날짜아님!', 1, NOW), false);
});

test('arrivalFor: 선택한 출고일만, 유예 지난 차수는 빼고 더한다', () => {
    const it = { s: [['2026-10-01', '', 10], ['2026-10-01', '2026-10-01', 5], ['2026-09-20', '', 7], ['2026-10-01', '2026-10-06', 3]] };
    const a = arrivalFor(it, new Set(['2026-10-01']), 1, NOW);
    assert.equal(a.qty, 13);           // 10 + 3 (10/1 도착분은 유예 지남, 9/20 은 미선택)
    assert.equal(a.skipped.length, 1);
});

test('computeRows: 신규·기존공식×신규입력·차이·피킹/비축', () => {
    const [r] = computeRows(bundle());
    assert.equal(r.code, 'S000001');
    assert.equal(r.cap, 20);           // A 구역 기본 20
    assert.equal(r.arr, 40);
    assert.equal(r.out, 15);
    assert.equal(r.remain, 3);
    assert.equal(r.mibal, 17);         // max(20−3,0)
    assert.equal(r.pick, 17);
    assert.equal(r.reserve, 23);
    assert.equal(r.shortage, 0);       // max(12+3−18,0)
    assert.equal(r.oldNew, 0);         // 기존 3조건: 40+18>20, 0+0>18 아님 → 0
    assert.equal(r.old, 20);
    assert.equal(r.diff, -3);
    assert.deepEqual(r.flags, []);
});

test('computeRows: 개별 적재량(EDITED_CELLS) 이 구역값보다 먼저, null 은 0', () => {
    assert.equal(computeRows(bundle({ edited: { S000001: { capacity: '30' } } }))[0].cap, 30);
    assert.equal(computeRows(bundle({ edited: { S000001: { capacity: null } } }))[0].cap, 0);
    assert.equal(computeRows(bundle({ edited: { S000001: { capacity: '' } } }))[0].cap, 20);
});

test('computeRows: 기존에만 / 신규에만 / 로케이션 없음 플래그, oldMap 없으면 비교 플래그 없음', () => {
    const rows = computeRows(bundle({
        shipItems: { S000001: { s: [['2026-10-01', '', 5]] } },
        oldMap: { S000002: { mibal: 4, arr: 4 } },
        loc: {}
    }));
    const a = rows.find(r => r.code === 'S000001'), b = rows.find(r => r.code === 'S000002');
    assert.ok(a.flags.includes('noOld') && a.flags.includes('noLoc') && a.flags.includes('zeroCapacity'));
    assert.ok(b.flags.includes('onlyOld'));
    assert.equal(b.arr, 0);
    assert.equal(b.diff, null);        // 재고 모름 → 신규 계산 안 함
    const none = computeRows(bundle({ oldMap: null }));
    assert.equal(none.length, 1);
    assert.ok(!none[0].flags.includes('noOld'));
    assert.equal(none[0].old, null);
});

test('computeRows: 도착다름 — 기존 쪽 도착을 알 때만', () => {
    assert.ok(computeRows(bundle({ oldMap: { S000001: { mibal: 20, arr: 30 } } }))[0].flags.includes('arrDiff'));
    assert.ok(!computeRows(bundle({ oldMap: { S000001: { mibal: 20, arr: null } } }))[0].flags.includes('arrDiff'));
});

test('buildLocIndex: 피킹용 우선, 문서·키 정렬 순서의 첫 자리, 코드=자리id 는 빈칸', () => {
    const idx = buildLocIndex([
        { id: 'ZONE_B', data: { 'B-2': { code: 'S000001' }, 'B-1': { code: 'S000001' } } },
        { id: 'ZONE_A', data: { 'SAM-1': { code: 'S000001' }, 'A-9': { code: 'S000003', category: '기타' }, 'A-5': { code: 'A-5' }, note: 'x' } },
    ]);
    assert.deepEqual(idx.S000001, { id: 'B-1', count: 3, etcOnly: false });   // SAM 은 기타 → 피킹용 B-1·B-2 중 첫 자리
    assert.deepEqual(idx.S000003, { id: 'A-9', count: 1, etcOnly: true });
    assert.equal(idx['A-5'], undefined);
});

test('설정 정규화: graceDays·출고일 — china-stock-goods.js loadConfig 와 같은 규칙', () => {
    assert.equal(graceDaysFrom({}), 1);
    assert.equal(graceDaysFrom({ graceDays: null }), 1);
    assert.equal(graceDaysFrom({ graceDays: '3' }), 3);
    assert.equal(graceDaysFrom({ graceDays: 'x' }), 0);
    assert.deepEqual(legacyDatesFrom({ savedDates: ['2026-09-01'] }), ['2026-09-01']);
    assert.deepEqual(legacyDatesFrom({ savedDatesMibal: ['2026-10-01'], savedDates: ['2026-09-01'] }), ['2026-10-01']);
    assert.deepEqual(selectedDatesFrom({ savedDatesMibal: ['a'] }, { useOwnDates: true, shipDates: ['b'] }), { dates: ['b'], source: 'own' });
    assert.deepEqual(selectedDatesFrom({ savedDatesMibal: ['a'] }, { useOwnDates: false, shipDates: ['b'] }), { dates: ['a'], source: 'legacy' });
});

test('날짜별 사본 형식으로 바꿔도 실시간과 같은 미발이 나온다', () => {
    const scan = { S000001: { mibalQty: '20', arrivalQty: 40, name: '버림' }, S000002: { mibalQty: 4 } };
    const cells = { S000001: { capacity: '25', memo: '버림' } };
    const live = computeRows(bundle({ oldMap: oldMapFromScan(scan), edited: cells }));
    // 수집기가 저장하는 모양: {code: mibalQty}, {code: capacity}, {code: 대표자리}
    const daily = computeRows(bundle({
        oldMap: oldMapFromDaily({ S000001: 20, S000002: 4 }),
        edited: editedFromDaily({ S000001: '25' }),
        loc: locFromDaily({ S000001: 'A-1-1' })
    }));
    const pick = rows => rows.map(r => [r.code, r.cap, r.mibal, r.old, r.oldNew, r.diff, r.pick, r.reserve]);
    assert.deepEqual(pick(daily), pick(live));
});

test('summarize · compareRowsOf', () => {
    const rows = computeRows(bundle());
    assert.deepEqual(summarize(rows), { sku: 1, arr: 40, mibal: 17, old: 20, diff: -3, pick: 17, reserve: 23, backlog: 0, refill: 0 });
    assert.deepEqual(compareRowsOf(rows), { S000001: [20, 0, 17, 40, 17, 23] });
});
