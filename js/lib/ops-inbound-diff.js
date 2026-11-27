// === js/lib/ops-inbound-diff.js ===
// 운영 리포트 '입고 오차' 탭·팀 결산 '입고 오차' 장(2026-11-27) — 부족수량관리 [입고 오차 통계]와 같은 숫자를 리포트 모양으로 묶는다(순수).
//   계산은 전부 js/lib/inbound-diff.js(summarizeByShip·overallSummary·monthlyTrend·topCodes·bySupplier) 그대로 — 여기서 새로 세지 않는다.
//   읽기·캐시는 js/ops-inbound-diff-store.js, 그리기는 js/ui-ops-inbound-diff.js(탭)·js/ui-history-settlement.js(결산). 시험 tests/ops-inbound-diff.test.js
// ⚠️ 보안(업무자동화 CLAUDE.md 3절): 공급처는 코드(AA9999 모양)만 — 모양이 아니면 '(코드 없음)'. 저장자(by — 직원)·저장 시각은 모델에 넣지 않는다.
//    원가·금액은 기록에 없다(다루지 않음).

import {
    summarizeByShip, overallSummary, monthlyTrend, topCodes, bySupplier, SUPPLIER_CODE_RE, NO_SUPPLIER
} from './inbound-diff.js?v=6028b21f8c15-bb911da2';

export const INBOUND_DIFF_FEATURE = 'data.analysis';   // 데이터 관리 안 탭 = 데이터 관리 권한(11/27 사용자 결정). 읽기 규칙은 등록 직원
export const INBOUND_DIFF_MAX_DOCS = 500;             // 한 번에 읽는 문서 상한(문서 = 출고일 하나, 하루 1건 안팎 — 1년 + 앞 30일도 안에 듦)
export const IDF_TOP_N = 10;
export const IDF_KINDS = { all: '전체', short: '부족만', over: '과입고만' };
// 부족수량관리 화면과 같은 문구(js/china-mibal2-scan.js INBOUND_DIFF_DENIED)
export const INBOUND_DIFF_DENIED = '입고 오차 기록 권한이 없습니다(서버 규칙 게시 전이거나 등록 직원이 아닙니다).';

const spCode = (v) => (SUPPLIER_CODE_RE.test(String(v || '')) ? String(v) : NO_SUPPLIER);
const pct1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);   // 비율 → % 소수 1자리

/** 추세 단위 — 기간이 62일 이하면 패킹(출고일)별, 넘으면 월별 */
export const trendUnitOfDays = (days) => (days <= 62 ? 'ship' : 'month');

/**
 * 리포트 모델. records = InboundDiff 문서들(기간 쿼리 결과), opts = { from, to, kind('all'|'short'|'over'), includeNoScan, days(기간 달력일) }
 * @returns {{ opts, overall, ships:[…], months:[…], codes:[…], suppliers:[…], trend:{unit, labels, short, over, rate}, docCount }}
 *   ships 줄에는 저장자·시각이 없다. codes·suppliers 의 공급처는 코드만.
 */
export function buildInboundDiffReport(records, opts = {}) {
    const recs = Array.isArray(records) ? records : [];
    const o = { from: opts.from || '', to: opts.to || '', kind: IDF_KINDS[opts.kind] ? opts.kind : 'all', includeNoScan: !!opts.includeNoScan };
    const shipsAll = summarizeByShip(recs, o);
    const overall = overallSummary(shipsAll);
    const ships = shipsAll.map(s => ({
        key: s.key, label: s.label, bundle: s.bundle, arrivals: (s.arrivals || []).slice(),
        n: s.n, arr: s.arr, conf: s.conf, errN: s.errN, short: s.short, over: s.over, abs: s.abs,
        noScanN: s.noScanN, noScanQ: s.noScanQ, rate: s.rate
    }));
    const months = monthlyTrend(recs, o);
    const codes = topCodes(recs, o, IDF_TOP_N).map(c => ({
        c: c.c, nm: c.nm, op: c.op, sp: spCode(c.sp), packs: c.packs, arr: c.arr, conf: c.conf, short: c.short, over: c.over, abs: c.abs, rate: c.rate
    }));
    const suppliers = bySupplier(recs, o).slice(0, IDF_TOP_N).map(s => ({
        sp: spCode(s.sp), codes: s.codes, errN: s.errN, arr: s.arr, conf: s.conf, short: s.short, over: s.over, abs: s.abs, rate: s.rate
    }));
    const unit = trendUnitOfDays(Number(opts.days) || 0);
    const src = unit === 'ship' ? ships.slice().reverse() : months;   // 패킹별은 출고일 오름차순으로
    const trend = {
        unit,
        labels: src.map(x => (unit === 'ship' ? x.label : `${Number(String(x.month).slice(5, 7))}월`)),
        short: src.map(x => x.short), over: src.map(x => x.over), rate: src.map(x => pct1(x.rate))
    };
    return { opts: o, overall, ships, months, codes, suppliers, trend, docCount: recs.length };
}

/** 결산 엑셀 줄 [구분, 항목, 값] — 공급처는 코드만, 저장자 없음 */
export function inboundDiffExcelRows(m) {
    if (!m) return [];
    const g = m.overall;
    const p = (v) => (v == null ? '' : pct1(v));
    const out = [
        ['입고 오차', '패킹(출고일) 수', g.packs],
        ['입고 오차', '묶음 줄', g.bundles],
        ['입고 오차', '도착 합', g.arr],
        ['입고 오차', '입고 합', g.conf],
        ['입고 오차', '오차 품목 수', g.errN],
        ['입고 오차', '부족 수량', g.short],
        ['입고 오차', '과입고 수량', g.over],
        ['입고 오차', '오차율(%)', p(g.rate)],
        ['입고 오차', '미스캔 품목 수', g.noScanN],
        ['입고 오차', '미스캔 수량', g.noScanQ],
        ['입고 오차', '기준', `${IDF_KINDS[m.opts.kind]} · 미스캔 ${m.opts.includeNoScan ? '오차에 포함' : '오차에서 뺌'}`]
    ];
    for (const x of m.months) out.push(['입고 오차 월별', x.month, `패킹 ${x.packs} · 부족 ${x.short} · 과입고 ${x.over} · 오차율 ${p(x.rate)}%`]);
    m.codes.forEach((c, i) => out.push(['입고 오차 상품 상위', `${i + 1}. ${c.c}${c.nm ? ' ' + c.nm : ''}${c.op ? ' (' + c.op + ')' : ''}`,
        `|차이| ${c.abs} · 부족 ${c.short} · 과입고 ${c.over} · 공급처 ${c.sp}`]));
    m.suppliers.forEach((s, i) => out.push(['입고 오차 공급처 코드 상위', `${i + 1}. ${s.sp}`, `|차이| ${s.abs} · 오차 ${s.errN}건 · 상품 ${s.codes}종 · 오차율 ${p(s.rate)}%`]));
    return out;
}
