// === js/lib/ship-summary.js ===
// 플랫폼 출고 결과 카드(#sp-result-card)·노란 경고 상자(#sp-warn) — 계산 lib 가 돌려준 결과 객체에서 다시 센다(2026-11-12).
//   진행 기록 글자를 읽어 숫자를 뽑지 않는다(문장이 바뀌어도 깨지지 않게) — ⚠ 줄 수만 센다.
//   상품명·코드는 돌려주지 않는다(숫자·건수만). 순수 모듈. 테스트: tests/ship-summary.test.js
//
// 입력(lib 반환값)
//   1단계(직진·에이블리): items [[코드, 수량]]
//   직진 2단계: location.rows [[코드, 이름, 수량]] · pkgRows [{admin_code, sku, qty, package}] · packageCount · packs(없으면 null)
//   에이블리 2단계: rows(대량입고 행 — 5번 칸 수량) · pickItems[].code · location.rows · packageCount
//   에이블리 요청 총량: ship-ably.readAblyRequest 의 qty 합(부르는 쪽이 넘긴다)

import { overBags, baseDateWarning, pyTruthy, toInt } from './ship-core.js?v=202611121504';
import { headerColumns } from './ship-read.js?v=202611121504';
import { zikjinStep1 } from './ship-zikjin.js?v=202611121504';
import { readAblyRequest } from './ship-ably.js?v=202611121504';

export const SUMMARY_MAX_BYTES = 3 * 1024 * 1024;   // 이보다 큰 파일은 칸 요약을 건너뜀(두 번 읽지 않게)

const NAME = { zikjin: '직진배송', ably: '에이블리' };
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const sum = (a, f) => (a || []).reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * 칸 요약 — 출고요청·출고전표를 넣을 때 한 번 읽어 '출고요청 · 60건 · 698개'. 원본 양식(template)은 하지 않는다. 못 읽으면 null.
 * @param {object} book  ship-read.readBook 결과
 * @param {{ tab: 'zikjin'|'ably', slot: 'request'|'admin' }} p
 * @returns {{ text: string, rows: number, qty: number }|null}
 */
export function fileSummary(book, { tab, slot }) {
    try {
        let rows = 0, qty = 0, label;
        if (slot === 'request') {
            label = '출고요청';
            if (tab === 'zikjin') {
                const items = zikjinStep1({ request: book }).items;
                rows = items.length;
                qty = sum(items, x => x[1]);
            } else {
                const r = readAblyRequest(book, []);
                rows = r.length;
                qty = sum(r, x => x.qty);
            }
        } else if (slot === 'admin') {
            label = '출고전표';
            const ws = book.active();
            const h = headerColumns(ws, 1);
            const cc = h.get('상품코드'), qc = h.get('수량');
            if (!cc || !qc) return null;
            for (let r = 2; r <= ws.maxRow; r++) {
                const q = toInt(ws.cell(r, qc));
                if (!pyTruthy(ws.cell(r, cc)) || q <= 0) continue;
                rows++;
                qty += q;
            }
        } else {
            return null;
        }
        return { text: `${label} · ${fmt(rows)}건 · ${fmt(qty)}개`, rows, qty };
    } catch (_) {
        return null;
    }
}

/**
 * @param {object} p
 * @param {'zikjin'|'ably'} p.tab
 * @param {1|2} p.step
 * @param {object} p.result     lib 결과 객체
 * @param {string} [p.base]     패키지명 베이스
 * @param {number} [p.limit]    봉투 한도
 * @param {Date}   [p.now]
 * @param {number|null} [p.requestTotal]  에이블리 2단계 — 출고요청 총량
 * @param {string[]} [p.log]    이번 실행의 진행 기록 줄(⚠ 줄 수만 센다)
 * @returns {{ title: string, kinds: number, qty: number, bags: number|null, warns: string[] }}
 */
export function summarizeRun({ tab, step, result, base = '', limit = 0, now = new Date(), requestTotal = null, log = [] }) {
    const r = result || {};
    const warns = [];
    let kinds = 0, qty = 0, bags = null;
    if (step === 1) {
        kinds = (r.items || []).length;
        qty = sum(r.items, x => x[1]);
    } else if (tab === 'zikjin') {
        const pkg = r.pkgRows || [];
        kinds = new Set(pkg.map(x => String(x.admin_code || x.sku || ''))).size;
        qty = sum(pkg, x => x.qty);
        bags = Number(r.packageCount) || 0;
        const sent = sum(r.location && r.location.rows, x => x[2]);
        if (sent > qty) warns.push(`출고요청에서 못 찾은 상품 ${fmt(sent - qty)}개가 출고리스트에서 빠졌습니다 — 출고요청과 전표가 같은 묶음인지 확인하세요.`);
        if (!(r.location && r.location.source)) warns.push('출고요청 파일이 없어 로케이션 전송·봉 수 기록을 하지 않았습니다(일반/즉시출고를 가릴 수 없음).');
    } else {
        const rows = r.rows || [];
        kinds = new Set((r.pickItems || []).map(x => String(x.code || ''))).size;
        qty = sum(rows, x => x[5]);
        bags = Number(r.packageCount) || 0;
        const locRows = (r.location && r.location.rows) || [];
        const adminTotal = sum(locRows, x => x[2]);
        if (requestTotal !== null && requestTotal !== undefined && Number(requestTotal) !== adminTotal) {
            const d = Number(requestTotal) - adminTotal;
            warns.push(`출고전표 총량(${fmt(adminTotal)}개)과 출고요청 총량(${fmt(requestTotal)}개)이 다릅니다(차이 ${d > 0 ? '+' : ''}${fmt(d)}개) — 재고 부족이면 정상, 아니면 전표를 새로 받으세요.`);
        }
        const picked = new Set((r.pickItems || []).map(x => String(x.code || '')));
        const unmatched = new Set(locRows.map(x => String(x[0])).filter(c => !picked.has(c))).size;
        if (unmatched) warns.push(`출고요청에 없는 상품코드 ${fmt(unmatched)}건은 대량입고에서 빠졌습니다.`);
    }
    if (step === 2) {
        const over = overBags(tab === 'zikjin' ? (r.pkgRows || []) : (r.pickItems || []), limit);
        if (limit > 0 && over.length) warns.push(`봉투 한도(${limit})를 넘은 봉이 ${fmt(over.length)}개 있습니다 — 진행 기록을 확인하세요.`);
        const dw = baseDateWarning(base, now);
        if (dw) warns.push(dw.replace(/^⚠\s*/, ''));
    }
    const warnLines = (log || []).filter(l => String(l).includes('⚠')).length;
    if (warnLines) warns.push(`진행 기록에 ⚠ 표시가 ${fmt(warnLines)}줄 있습니다 — '자세히 보기'에서 확인하세요.`);
    const title = `✅ ${NAME[tab] || ''} ${step}단계 완료 — 상품 ${fmt(kinds)}종 · ${fmt(qty)}개${bags !== null ? ` · ${fmt(bags)}봉` : ''}`;
    return { title, kinds, qty, bags, warns };
}
