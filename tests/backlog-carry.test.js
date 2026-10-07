// tests/backlog-carry.test.js — 휴일 다음 첫 근무일의 '밀린 물량' 규칙
// 실행:  npm test   (= node --test)
//
// 이 규칙이 왜 테스트로 묶여야 하나
//   국내배송 자동값은 요일평균에서 온다. 요일평균은 '월요일은 원래 크다'로 **주말 밀림을 이미
//   품고 있다.** 여기에 밀림 배수를 또 곱하면 평범한 월요일이 매주 부풀어, 쓰는 사람이 자동값을
//   믿지 않게 된다. '평범한 월요일은 배수 1.0' 이 이 기능의 생명선이라 회귀 테스트로 박는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    offDaysBefore, excessOffDays, learnCarryPerOffDay, backlogFactor,
    carryReason, carrySourceNote, dowOf,
    DEFAULT_CARRY, MAX_BACKLOG_FACTOR, CARRY_MIN, MIN_MONDAY_SAMPLES,
    DEFAULT_BACKLOG_TASKS, resolveBacklogTasks, carriedQty,
} from '../js/lib/backlog-carry.js?v=202610070958';

// 실제 달력 대신 '이 날짜들이 공휴일' 이라고 꽂아 둔다 — 공휴일 표가 바뀌어도 테스트는 안 흔들린다.
const 공휴일 = new Set([
    '2026-09-24', '2026-09-25', '2026-09-26',   // 추석 연휴 (목·금·토)
    '2026-02-16', '2026-02-17', '2026-02-18',   // 설날 연휴 (월·화·수)
    '2025-12-25',                               // 성탄절 (목)
    '2026-03-02',                               // 대체공휴일 (월)
]);
const 주말 = (d) => { const w = dowOf(d); return w === 0 || w === 6; };
const isOff = (d) => 주말(d) || 공휴일.has(d);

// ── 직전 연속 휴일 수 ────────────────────────────────────────
test('offDaysBefore — 평범한 화요일은 0, 평범한 월요일은 2', () => {
    assert.equal(dowOf('2026-10-13'), 2);                 // 화
    assert.equal(offDaysBefore('2026-10-13', isOff), 0);
    assert.equal(dowOf('2026-10-12'), 1);                 // 월
    assert.equal(offDaysBefore('2026-10-12', isOff), 2);
});

test('offDaysBefore — 추석(목·금·토)+일 뒤 월요일은 4일', () => {
    assert.equal(offDaysBefore('2026-09-28', isOff), 4);
});

test('offDaysBefore — 설(월·화·수) 뒤 목요일은 토·일 포함 5일', () => {
    assert.equal(offDaysBefore('2026-02-19', isOff), 5);
});

test('offDaysBefore — 달력이 전부 휴일이어도 maxLookback 에서 멈춘다(무한루프 금지)', () => {
    assert.equal(offDaysBefore('2026-10-13', () => true), 10);
    assert.equal(offDaysBefore('2026-10-13', () => true, 3), 3);
});

test('offDaysBefore — 날짜 형식이 아니면 0', () => {
    assert.equal(offDaysBefore('어제', isOff), 0);
    assert.equal(offDaysBefore('2026-10-13', null), 0);
});

// ── 초과 휴일 (이중계산 방지의 전부) ──────────────────────────
test('excessOffDays — 🔒 평범한 월요일은 0 이어야 한다 (요일평균에 이미 들어 있다)', () => {
    assert.equal(excessOffDays('2026-10-12', isOff), 0);
    assert.equal(excessOffDays('2026-10-19', isOff), 0);
});

test('excessOffDays — 평범한 수·목·금도 0', () => {
    ['2026-10-14', '2026-10-15', '2026-10-16'].forEach(d => {
        assert.equal(excessOffDays(d, isOff), 0, d);
    });
});

test('excessOffDays — 추석 뒤 월요일은 4-2 = 2', () => {
    assert.equal(excessOffDays('2026-09-28', isOff), 2);
});

test('excessOffDays — 설 뒤 목요일은 5일이지만 상한 4 로 잘린다', () => {
    assert.equal(excessOffDays('2026-02-19', isOff), 4);
});

test('excessOffDays — 토(공휴일)+일+월(대체공휴일) 뒤 화요일은 3 (2026-10-06 실제 달력)', () => {
    const 연휴 = (d) => {
        const w = dowOf(d);
        return w === 0 || w === 6 || d === '2026-10-05' || d === '2026-10-04';
    };
    assert.equal(offDaysBefore('2026-10-06', 연휴), 3);
    assert.equal(excessOffDays('2026-10-06', 연휴), 3);   // 화요일 기준선은 0
    assert.equal(backlogFactor('2026-10-06', 연휴, 0.3).factor, 1.9);
});

test('excessOffDays — 성탄절(목) 다음 금요일은 1', () => {
    assert.equal(excessOffDays('2025-12-26', isOff), 1);
});

test('excessOffDays — 쉬는 날 자체는 0 (휴일에 밀림을 걸지 않는다)', () => {
    assert.equal(excessOffDays('2026-09-25', isOff), 0);   // 추석 당일
    assert.equal(excessOffDays('2026-10-11', isOff), 0);   // 일요일
});

// ── 하루당 밀림 비율 학습 ────────────────────────────────────
/** 2026-10-05 월 부터 주차별로 월 1500 / 화~금 1000 을 깔아 둔다 */
const 표본 = (weeks, { mon = 1500, mid = 1000 } = {}) => {
    const out = [];
    for (let w = 0; w < weeks; w++) {
        const base = new Date(Date.UTC(2026, 9, 5 + w * 7));
        for (let i = 0; i < 5; i++) {
            const d = new Date(base.getTime() + i * 86400000);
            const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            out.push({ date: ymd, value: i === 0 ? mon : mid });
        }
    }
    return out;
};

test('learnCarryPerOffDay — 월 1500 / 화~금 1000 이면 하루당 25%', () => {
    const r = learnCarryPerOffDay(표본(10), isOff);
    assert.equal(r.source, 'learned');
    assert.equal(Math.round(r.carry * 100), 25);
    assert.equal(r.monDays, 10);
    assert.equal(r.midDays, 40);
});

test('learnCarryPerOffDay — 월요일 표본이 기준보다 적으면 기본값으로 물러난다', () => {
    const r = learnCarryPerOffDay(표본(MIN_MONDAY_SAMPLES - 1), isOff);
    assert.equal(r.source, 'fallback');
    assert.equal(r.carry, DEFAULT_CARRY);
    assert.equal(r.monDays, MIN_MONDAY_SAMPLES - 1);
});

test('learnCarryPerOffDay — 🔒 ratio 가 1 바로 위면 하한(5%)으로 튀어오르지 않는다', () => {
    // (ratio-1)/2 가 0 에 가까운데 clamp 하한에 걸려 0.05 가 되면
    // '사실상 밀림 없음' 이 '하루당 5%' 로 둔갑한다 — 4일 연휴에 1.2배가 된다.
    const r = learnCarryPerOffDay(표본(10, { mon: 1001, mid: 1000 }), isOff);
    assert.equal(r.source, 'no-signal');
    assert.equal(r.carry, 0);
    // 진입 지점(= 하한의 2배 비율)을 넘기면 그때부터 배운 값을 쓴다
    const r2 = learnCarryPerOffDay(표본(10, { mon: 1200, mid: 1000 }), isOff);
    assert.equal(r2.source, 'learned');
    assert.ok(r2.carry >= CARRY_MIN, `carry ${r2.carry} 가 하한 미만`);
});

test('learnCarryPerOffDay — 월요일이 오히려 낮으면 "배웠다"고 하지 않고 보정을 끈다', () => {
    // 데이터가 전제를 부정하는 경우다. 하한 5%로 눌러 '배운 값'이라 쓰면 숫자로 포장하는 것이 된다.
    const r = learnCarryPerOffDay(표본(10, { mon: 600, mid: 1000 }), isOff);
    assert.equal(r.source, 'no-signal');
    assert.equal(r.carry, 0);
    assert.equal(backlogFactor('2026-09-28', isOff, r.carry).factor, 1);
    assert.match(carrySourceNote(r), /보정하지 않습니다/);
});

test('learnCarryPerOffDay — 월요일이 화~금과 같으면(ratio 1) 보정하지 않는다', () => {
    const r = learnCarryPerOffDay(표본(10, { mon: 1000, mid: 1000 }), isOff);
    assert.equal(r.source, 'no-signal');
    assert.equal(r.carry, 0);
});

test('learnCarryPerOffDay — 쉬는 날인데 실적이 남은 날은 표본에서 뺀다', () => {
    // 출근한 대체공휴일처럼 물량이 작게 남은 날이 섞이면 중앙값이 끌려 내려간다
    const base = 표본(10);
    const r1 = learnCarryPerOffDay(base, isOff);
    const 오염 = [...base, { date: '2026-03-02', value: 50 }];   // 월요일 대체공휴일
    const r2 = learnCarryPerOffDay(오염, isOff);
    assert.equal(r1.carry, r2.carry);
    assert.equal(r1.monDays, r2.monDays);
});

test('learnCarryPerOffDay — 화~금 실적이 모두 0 이면 0 으로 나누지 않고 기본값', () => {
    const r = learnCarryPerOffDay(표본(10, { mid: 0 }), isOff);
    assert.equal(r.source, 'fallback');
    assert.ok(Number.isFinite(r.carry));
});

test('learnCarryPerOffDay — 입력이 비었거나 배열이 아니어도 터지지 않는다', () => {
    [[], null, undefined, '엉뚱한 값'].forEach(v => {
        const r = learnCarryPerOffDay(v, isOff);
        assert.equal(r.source, 'fallback');
    });
});

test('learnCarryPerOffDay — 연휴가 낀 날은 표본에서 빠진다(기준 오염 방지)', () => {
    // 추석 뒤 월요일(2026-09-28)에 평소의 3배를 넣어도 배운 값이 흔들리면 안 된다
    const base = 표본(10);
    const r1 = learnCarryPerOffDay(base, isOff);
    const r2 = learnCarryPerOffDay([...base, { date: '2026-09-28', value: 4500 }], isOff);
    assert.equal(r1.carry, r2.carry);
    assert.equal(r1.monDays, r2.monDays);
});

// ── 최종 배수 ───────────────────────────────────────────────
test('backlogFactor — 🔒 평범한 수요일은 정확히 1.0 (값이 변하지 않는다)', () => {
    const r = backlogFactor('2026-10-14', isOff, 0.25);
    assert.equal(r.factor, 1);
    assert.equal(r.excess, 0);
});

test('backlogFactor — 🔒 평범한 월요일도 정확히 1.0', () => {
    assert.equal(backlogFactor('2026-10-12', isOff, 0.25).factor, 1);
});

test('backlogFactor — 추석 뒤 월요일은 1 + 0.25×2 = 1.5', () => {
    const r = backlogFactor('2026-09-28', isOff, 0.25);
    assert.equal(r.factor, 1.5);
    assert.equal(r.excess, 2);
    assert.equal(r.gap, 4);
});

test('backlogFactor — 상한 2.0 을 넘지 않는다', () => {
    const r = backlogFactor('2026-02-19', isOff, 0.6);   // 1 + 0.6×4 = 3.4
    assert.equal(r.factor, MAX_BACKLOG_FACTOR);
});

test('backlogFactor — carry 가 없거나 이상하면 보정하지 않는다', () => {
    [0, -1, NaN, null, undefined, '많이'].forEach(c => {
        assert.equal(backlogFactor('2026-09-28', isOff, c).factor, 1, String(c));
    });
});

test('backlogFactor — 휴일 당일에는 배수를 걸지 않는다', () => {
    const r = backlogFactor('2026-09-25', isOff, 0.25);
    assert.equal(r.factor, 1);
    assert.equal(r.excess, 0);
});

// ── 사람이 읽는 문구 ─────────────────────────────────────────
test('carryReason — 보정이 없으면 빈 문자열', () => {
    assert.equal(carryReason(backlogFactor('2026-10-14', isOff, 0.25), { dow: 3 }), '');
    assert.equal(carryReason(null), '');
});

test('carryReason — 쉰 날 수·초과분·배수가 문장에 들어간다', () => {
    const info = backlogFactor('2026-09-28', isOff, 0.25);
    const s = carryReason(info, { holidayName: '추석 연휴', dow: 1, baseValue: 1000, finalValue: 1500 });
    assert.match(s, /추석 연휴/);
    assert.match(s, /4일 쉰 뒤/);
    assert.match(s, /2일 더 쉬어서/);
    assert.match(s, /1,500개/);
});

test('carryReason — dow 가 없거나 범위 밖이어도 undefined 가 찍히지 않는다', () => {
    const info = backlogFactor('2026-09-28', isOff, 0.25);
    [undefined, null, 7, -1].forEach(dow => {
        const s = carryReason(info, { dow });
        assert.ok(s.length > 0);
        assert.doesNotMatch(s, /undefined/);
    });
});

test('carryReason — 보정이 꺼진(no-signal) 날에는 근거 문장이 나오지 않는다', () => {
    const r = learnCarryPerOffDay(표본(10, { mon: 1000, mid: 1000 }), isOff);
    const info = backlogFactor('2026-09-28', isOff, r.carry);
    assert.equal(info.factor, 1);
    assert.equal(carryReason(info, { dow: 1 }), '');
});

test('learnCarryPerOffDay — 월요일 표본이 정확히 기준치면 배운다(경계)', () => {
    const r = learnCarryPerOffDay(표본(MIN_MONDAY_SAMPLES), isOff);
    assert.equal(r.source, 'learned');
    assert.equal(r.monDays, MIN_MONDAY_SAMPLES);
    assert.equal(Math.round(r.carry * 100), 25);   // 중앙값이 짝수개여도 1500/1000 유지
});

test('carrySourceNote — 배운 경우와 기본값인 경우를 구분해 쓴다', () => {
    assert.match(carrySourceNote(learnCarryPerOffDay(표본(10), isOff)), /월요일 10일 \/ 화~금 40일/);
    assert.match(carrySourceNote(learnCarryPerOffDay(표본(3), isOff)), /기본값/);
    assert.equal(carrySourceNote(null), '');
});


// ── 보정을 걸 업무 목록 ──────────────────────────────────────
test('resolveBacklogTasks — 설정이 없으면 기본값(국내배송·채우기)', () => {
    const r = resolveBacklogTasks(undefined);
    assert.deepEqual([...r].sort(), [...DEFAULT_BACKLOG_TASKS].sort());
    assert.ok(r.has('국내배송') && r.has('채우기'));
});

test('resolveBacklogTasks — 공백을 다듬고 빈 값을 버린다', () => {
    const r = resolveBacklogTasks(['채우기 ', '', null, undefined, '  교환반품']);
    assert.deepEqual([...r].sort(), ['교환반품', '채우기']);
});

test('resolveBacklogTasks — 🔒 빈 배열은 "전부 끄기"다 (기본값으로 되돌리지 않는다)', () => {
    assert.equal(resolveBacklogTasks([]).size, 0);
});

test('resolveBacklogTasks — 배열이 아니면 기본값 + 경고 한 번', () => {
    let 경고 = 0;
    const r = resolveBacklogTasks('채우기', { onBadConfig: () => { 경고++; } });
    assert.equal(경고, 1);
    assert.ok(r.has('국내배송'));
});

// ── 물량에 배수 적용 ─────────────────────────────────────────
test('carriedQty — 배수가 1 이하면 값을 바꾸지 않는다', () => {
    assert.equal(carriedQty(1000, 1), 1000);
    assert.equal(carriedQty(1000, 0.5), 1000);
    assert.equal(carriedQty(1000, NaN), 1000);
});

test('carriedQty — 🔒 0 이하에는 배수를 곱하지 않는다 (안 하는 날에 물량을 만들지 않는다)', () => {
    assert.equal(carriedQty(0, 1.6), 0);
    assert.equal(carriedQty(-5, 1.6), -5);
});

test('carriedQty — 올리고 반올림한다', () => {
    assert.equal(carriedQty(1000, 1.6), 1600);
    assert.equal(carriedQty(333, 1.3), 433);
});

test('carriedQty — backlogFactor 와 묶으면 최대 2배를 못 넘는다', () => {
    const f = backlogFactor('2026-02-19', isOff, 0.6).factor;   // 상한에 걸린다
    assert.equal(f, MAX_BACKLOG_FACTOR);
    assert.equal(carriedQty(1000, f), 2000);
});

test('carriedQty — 🔒 평범한 월요일에는 값이 그대로다', () => {
    const f = backlogFactor('2026-10-19', isOff, 0.3).factor;
    assert.equal(f, 1);
    assert.equal(carriedQty(1000, f), 1000);
});


test('carrySourceNote — 🔒 다른 업무에서 빌린 비율이면 그 사실을 숨기지 않는다', () => {
    // 채우기 행에 "채우기를 비교해 구했다"로 읽히면 거짓말이 된다.
    const learned = learnCarryPerOffDay(표본(10), isOff);
    const 자기값 = carrySourceNote(learned);
    const 빌린값 = carrySourceNote(learned, { fromTask: '국내배송' });
    assert.doesNotMatch(자기값, /국내배송/);
    assert.match(빌린값, /국내배송/);
    assert.match(빌린값, /표본이 모자라/);
});

test('carrySourceNote — 기본값·보정꺼짐 문구에도 출처가 붙는다', () => {
    assert.match(carrySourceNote(learnCarryPerOffDay(표본(3), isOff), { fromTask: '국내배송' }), /국내배송/);
    assert.match(carrySourceNote(learnCarryPerOffDay(표본(10, { mon: 1000, mid: 1000 }), isOff),
                                 { fromTask: '국내배송' }), /국내배송/);
});
