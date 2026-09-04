// tests/calc.test.js — 핵심 계산 로직 단위 테스트
// 실행:  node --test tests/      (또는  npm test)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseAmount, inDateRange, resolvePeriodRange, calcWorkMinutes, weekendFairness,
    outingDeductibleMinutes, earlyLeaveDeductibleMinutes,
} from '../js/lib/calc.js?v=202609040933';

const H = (hh, mm = 0) => hh * 60 + mm; // 시:분 → 분

test('outingDeductibleMinutes: 점심(12:30~13:30) 외출은 차감 제외, 1시간까지 무차감', () => {
    // 점심 시간에 완전히 포함된 외출(12:30~13:30) → 차감 0
    assert.equal(outingDeductibleMinutes(H(12,30), H(13,30)), 0);
    // 12:00~13:00: 점심겹침 30분 제외 → 순30분, 1시간 이내 → 0
    assert.equal(outingDeductibleMinutes(H(12), H(13)), 0);
    // 11:00~14:00(180분): 점심겹침 60분 제외 → 순120분, 1시간 무차감 → 60분 차감
    assert.equal(outingDeductibleMinutes(H(11), H(14)), 60);
    // 점심과 무관한 09:00~11:00(120분): 겹침 0, 1시간 무차감 → 60분 차감
    assert.equal(outingDeductibleMinutes(H(9), H(11)), 60);
    // 종료시각 없음/역전 → 0
    assert.equal(outingDeductibleMinutes(H(10), null), 0);
    assert.equal(outingDeductibleMinutes(H(11), H(10)), 0);
});

test('earlyLeaveDeductibleMinutes: 종업(18:00)까지 빠진 시간 − 점심 겹침', () => {
    // 12:00 조퇴: 18:00까지 360분 − 점심 60분 = 300분
    assert.equal(earlyLeaveDeductibleMinutes(H(12), H(18)), 300);
    // 17:00 조퇴: 60분(점심 이후라 겹침 0)
    assert.equal(earlyLeaveDeductibleMinutes(H(17), H(18)), 60);
    // 종업 이후/미입력 → 0
    assert.equal(earlyLeaveDeductibleMinutes(H(18), H(18)), 0);
    assert.equal(earlyLeaveDeductibleMinutes(null, H(18)), 0);
});

test('parseAmount: 통화기호·콤마 제거, 빈값/플레이스홀더는 null', () => {
    assert.equal(parseAmount('1,234'), 1234);
    assert.equal(parseAmount('$ 1,000'), 1000);
    assert.equal(parseAmount('₩2,500원'), 2500);
    assert.equal(parseAmount(42), 42);
    assert.equal(parseAmount(''), null);
    assert.equal(parseAmount('-'), null);
    assert.equal(parseAmount('#REF!'), null);
    assert.equal(parseAmount('abc'), null);
});

test('inDateRange: 경계 포함, 형식 불량 제외', () => {
    assert.equal(inDateRange('2026-06-05', '2026-06-01', '2026-06-10'), true);
    assert.equal(inDateRange('2026-06-01', '2026-06-01', '2026-06-10'), true); // from 포함
    assert.equal(inDateRange('2026-06-10', '2026-06-01', '2026-06-10'), true); // to 포함
    assert.equal(inDateRange('2026-05-31', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('2026-06-11', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('bad-date', '2026-06-01', '2026-06-10'), false);
    assert.equal(inDateRange('2026-06-05', '', ''), true); // 무제한
});

test('resolvePeriodRange: 일/주/월/년 × 전·현·후 (오늘=목요일)', () => {
    const today = '2026-06-25'; // 목
    assert.deepEqual(resolvePeriodRange('day:-1', today), { from: '2026-06-24', to: '2026-06-24' });
    assert.deepEqual(resolvePeriodRange('day:0', today), { from: '2026-06-25', to: '2026-06-25' });
    assert.deepEqual(resolvePeriodRange('day:1', today), { from: '2026-06-26', to: '2026-06-26' });
    // 주 = 월~일
    assert.deepEqual(resolvePeriodRange('week:0', today), { from: '2026-06-22', to: '2026-06-28' });
    assert.deepEqual(resolvePeriodRange('week:-1', today), { from: '2026-06-15', to: '2026-06-21' });
    assert.deepEqual(resolvePeriodRange('week:1', today), { from: '2026-06-29', to: '2026-07-05' });
    // 월
    assert.deepEqual(resolvePeriodRange('month:0', today), { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(resolvePeriodRange('month:-1', today), { from: '2026-05-01', to: '2026-05-31' });
    assert.deepEqual(resolvePeriodRange('month:1', today), { from: '2026-07-01', to: '2026-07-31' });
    // 년
    assert.deepEqual(resolvePeriodRange('year:0', today), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(resolvePeriodRange('year:-1', today), { from: '2025-01-01', to: '2025-12-31' });
    // custom
    assert.deepEqual(resolvePeriodRange('custom', today, { from: '2026-01-05', to: '2026-02-10' }),
        { from: '2026-01-05', to: '2026-02-10' });
});

test('resolvePeriodRange: 월말/연말 경계', () => {
    assert.deepEqual(resolvePeriodRange('month:1', '2026-01-31'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(resolvePeriodRange('day:1', '2026-12-31'), { from: '2027-01-01', to: '2027-01-01' });
    // 윤년 2월
    assert.deepEqual(resolvePeriodRange('month:0', '2028-02-15'), { from: '2028-02-01', to: '2028-02-29' });
});

test('calcWorkMinutes: 휴식 차감, 미종료 휴식은 종료시각까지', () => {
    assert.equal(calcWorkMinutes('09:00', '11:00', []), 120);
    assert.equal(calcWorkMinutes('09:00', '12:00', [{ start: '10:00', end: '10:30' }]), 150);
    assert.equal(calcWorkMinutes('09:00', '12:00', [{ start: '11:30', end: null }]), 150); // 미종료→12:00
    assert.equal(calcWorkMinutes('', '12:00', []), 0);
    assert.equal(calcWorkMinutes('12:00', '09:00', []), 0); // 음수 방지
});

test('weekendFairness: 정원 중 관리자 1 고정 + 기본정원 3', () => {
    const dates = ['2026-06-06', '2026-06-07', '2026-06-13', '2026-06-14']; // 4일
    // 정원 미설정 → 기본 3. 팀원 몫=2/일, 합 8. 참여 4명 → 2회
    const r1 = weekendFairness(dates, () => undefined, 4);
    assert.equal(r1.openDays, 4);
    assert.equal(r1.totalCapacity, 12);
    assert.equal(r1.teamSlots, 8);
    assert.equal(r1.adminSlots, 4);
    assert.equal(r1.recommended, 2);

    // 일부 날짜 정원 5 설정
    const caps = { '2026-06-06': 5 };
    const r2 = weekendFairness(dates, (d) => caps[d], 4);
    assert.equal(r2.totalCapacity, 5 + 3 + 3 + 3); // 14
    assert.equal(r2.teamSlots, 4 + 2 + 2 + 2);      // 10
    assert.equal(r2.recommended, Math.round(10 / 4)); // 2.5 → 3(round)? -> Math.round(2.5)=3

    // 참여 0명 가드
    const r3 = weekendFairness(dates, () => undefined, 0);
    assert.equal(r3.avg, 0);
    assert.equal(r3.recommended, 0);
});
