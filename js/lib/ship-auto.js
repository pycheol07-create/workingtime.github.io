// === js/lib/ship-auto.js ===
// 플랫폼 출고 — 파일을 놓았을 때 저절로 [만들기]를 할지(2026-11-13 '올리면 자동' 사용자 요청). 통합·개별 선택 같은 규칙.
//   순수 모듈 — 화면(js/ship.js dropMany·dropLegacy·dropOnSlot)이 사실만 모아 넘기고, 여기서 시작/멈춤과 이유를 정한다.
//   만들기·저장·전송 계산은 건드리지 않는다(같은 run()). 테스트: tests/ship-auto.test.js
//
// 결정 표
//   필요한 파일이 모자람                         → 기다림(더 넣을 파일 안내)
//   어느 플랫폼인지 모름(출고전표만, 기다리는 쪽 없음) → 멈춤(묻기)
//   같은 종류 파일 둘(앞의 것만 넣음)             → 멈춤(어느 것을 쓸지 확인)
//   칸에 직접 넣은 파일 모양이 칸과 다름           → 멈춤(확인)
//   섞어 올리기 출고전표 코드 중 짝 출고요청에 없는 것 → 멈춤(ship-mixed missing, 2026-11-13 리뷰)
//   섞어 올리기 짝 출고요청 상품 중 출고전표에 있는 것이 95% 미만 → 멈춤(ship-mixed cover, 재리뷰 사례 D)
//   사람이 고친 패키지명 날짜가 오늘이 아님(7일 안이어도) → 멈춤(2026-11-13 리뷰 — 고치지 않은 기본값은 화면이 오늘로 다시 채운다)
//   패키지명 베이스가 날짜(YYMMDD)가 아님          → 멈춤
//   패키지명 날짜가 오늘과 MAX_GAP 일보다 멂        → 멈춤(오타로 봄 — ship-core.packDay 가 오늘로 바꾸는 범위와 같음)
//   패키지명 날짜가 오늘과 다름(MAX_GAP 일 안, 사람이 안 고친 값) → 시작 + 경고(결과 카드·진행 기록) — 화면은 이 값을 오늘로 다시 채우므로 거의 안 생김
//   오늘 이미 만든 묶음                          → 화면이 확인창으로 묻는다(madeAsk) — 확인하면 시작
//   저장 폴더를 안 골랐거나 권한을 다시 받아야 함   → 시작(다운로드로 받고 결과 카드에 안내) — 화면이 처리
//   그 밖의 안내(모르는 파일·쓰지 않는 파일)        → 시작(안내는 진행 기록·결과 카드에)

import { kstDay, baseDatePart, PACK_BASE_MAX_DIFF } from './ship-core.js?v=202611131118';
import { COVER_OK } from './ship-mixed.js?v=202611131118';

export const MAX_GAP = PACK_BASE_MAX_DIFF;

/**
 * 패키지명 베이스(앞 ZG·AB 는 뗌) 날짜가 오늘과 며칠 차이인가.
 * @returns {{ valid: boolean, days: number|null, date: string }}  days = 베이스 - 오늘(+ 면 미래)
 */
export function baseGap(base, now = new Date()) {
    const date = baseDatePart(base);
    if (!/^\d{6}$/.test(date)) return { valid: false, days: null, date };
    const yy = Number(date.slice(0, 2)), mm = Number(date.slice(2, 4)), dd = Number(date.slice(4, 6));
    const y = yy <= 68 ? 2000 + yy : 1900 + yy;   // ship-core.packDay 와 같은 읽기(strptime %y)
    const ms = Date.UTC(y, mm - 1, dd);
    const back = new Date(ms);
    if (mm < 1 || mm > 12 || back.getUTCMonth() !== mm - 1 || back.getUTCDate() !== dd) return { valid: false, days: null, date };
    return { valid: true, days: Math.round((ms - kstDay(now).ms) / 86400000), date };
}

const dayWord = (d) => (d < 0 ? `${-d}일 전` : `${d}일 뒤`);

/**
 * @param {object} p
 * @param {boolean} p.put            이번에 이 단계 칸에 파일을 하나라도 넣었나(아니면 아무것도 안 함)
 * @param {1|2} p.step
 * @param {string[]} [p.missing]     아직 빈 필수 칸 이름
 * @param {string|null} [p.ambiguous] 어느 플랫폼인지 모름 안내(ship-assign.routeFiles note)
 * @param {number} [p.dupes]         같은 종류 파일이 둘이라 뒤의 것을 뺀 수
 * @param {boolean} [p.mismatch]     칸에 직접 넣은 파일 모양이 칸과 다름
 * @param {number} [p.notInRequest]  섞어 올리기 — 출고전표 코드 중 짝 출고요청에 없는 수
 * @param {number|null} [p.cover]    섞어 올리기 — 짝 출고요청 코드 중 출고전표에 있는 비율(0~1)
 * @param {string} [p.base]          2단계 패키지명 베이스(칸 값)
 * @param {boolean} [p.touched]      패키지명 베이스를 사람이 (오늘) 고쳤나
 * @param {Date} [p.now]
 * @returns {{ action: 'none'|'wait'|'stop'|'start', why: string, warn: string }}
 *   why = 멈춘 이유('… 확인한 뒤' — 화면이 '[만들기]를 눌러 주세요'를 붙임) · warn = 시작하되 남길 경고
 */
export function autoDecision({ put, step, missing = [], ambiguous = null, dupes = 0, mismatch = false, notInRequest = 0, cover = null, base = '', touched = false, now = new Date() }) {
    if (!put) return { action: 'none', why: '', warn: '' };
    if (missing.length) return { action: 'wait', why: '', warn: '' };
    if (ambiguous) return { action: 'stop', why: '어느 플랫폼 파일인지 가릴 수 없어(출고전표만) 맞는지 확인한 뒤', warn: '' };
    if (dupes > 0) return { action: 'stop', why: '같은 종류 파일이 둘이라 앞의 것만 넣었습니다 — 맞는지 확인한 뒤', warn: '' };
    if (mismatch) return { action: 'stop', why: '넣은 파일 모양이 칸과 달라 확인한 뒤', warn: '' };
    if (cover !== null && cover !== undefined && cover < COVER_OK) return { action: 'stop', why: `짝지은 출고요청 상품 중 출고전표에 있는 것이 ${Math.round(cover * 100)}%뿐이라(다른 묶음일 수 있음) 확인한 뒤`, warn: '' };
    if (notInRequest > 0) return { action: 'stop', why: `출고전표 상품 ${notInRequest}개가 짝지은 출고요청에 없어(다른 묶음일 수 있음) 확인한 뒤`, warn: '' };
    let warn = '';
    if (step === 2) {
        const g = baseGap(base, now);
        if (!g.valid) return { action: 'stop', why: `패키지명 베이스(${String(base).trim()})가 날짜(YYMMDD)가 아니라 확인한 뒤`, warn: '' };
        if (touched && g.days !== 0) return { action: 'stop', why: `직접 고친 패키지명 날짜(${g.date})가 오늘(${kstDay(now).yymmdd})이 아니라 확인한 뒤`, warn: '' };
        if (Math.abs(g.days) > MAX_GAP) return { action: 'stop', why: `패키지명 날짜(${g.date})가 오늘과 ${Math.abs(g.days)}일 차이 나 확인한 뒤`, warn: '' };
        if (g.days !== 0) warn = `패키지명 날짜(${g.date})가 오늘(${kstDay(now).yymmdd})이 아닌데(${dayWord(g.days)}) 저절로 만들었습니다 — 날짜가 맞는지 확인하세요. 봉 수는 그날(${g.date})로 들어갑니다.`;
    }
    return { action: 'start', why: '', warn };
}

/** 진행 기록·큰 상자 표시 — '자동 시작 — 파일 n개 인식 · 직진배송 2단계' */
export function autoStartText(n, tabName, step) {
    return `자동 시작 — 파일 ${n}개 인식 · ${tabName} ${step}단계`;
}
