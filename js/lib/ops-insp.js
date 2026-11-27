// === js/lib/ops-insp.js ===
// 운영 리포트 '통계' 탭의 '검수' 장·팀 결산 '검수 이력' 장(2026-11-27) — 고른 기간의 샘플·전량 검수 숫자(순수, node --test 대상).
//   기준 = 검수 이력 '품질 통계'(js/ui-history-inspection.js renderQCStatsMode)와 같다:
//     product_history 문서 + 전량검수 기록(total_inspection_logs)을 js/lib/total-insp.js mergeIntoProductHistory 로 합친 뒤 log 마다 센다.
//     수량 = 입고 수량(inboundQty, 없으면 qty) · 불량 = 상태 '불량' 또는 불량 사유 있음 또는 체크리스트(두께 빼고)에 정상 아닌 값
//     · 불량 수량 = logDefectQty(전량은 그 저장의 불량 개수, 샘플은 입고 수량) · 불량률 = 불량 ÷ 전체(건수·수량 각각, %).
//   품질 통계는 연·월·주 하나를 고르고, 여기는 날짜 범위(from~to, 'YYYY-MM-DD' 포함)를 받는다.
//   읽기·캐시는 js/ops-insp-store.js, 그리기는 js/ui-ops-stats.js(장·카드)·js/ui-history-settlement.js(결산). 시험 tests/ops-insp.test.js
// ⚠️ 보안(업무자동화 CLAUDE.md 3절): 결과에는 상품명·상품코드·숫자·불량 사유만 — 검수자(inspector)·메모(note)·저장 시각은 넣지 않는다.

import { mergeIntoProductHistory, logDefectQty } from './total-insp.js?v=d83d978fa87f-5334595d';

export const INSP_FEATURE = 'data.analysis';   // 데이터 관리 안 장 = 데이터 관리 권한(11/27 사용자 결정)
export const INSP_LOG_MAX = 3000;              // 전량검수 기록 한 번에 읽는 상한(검수 이력 TOTAL_LOG_LIMIT 와 같음) — 넘으면 '일부만'
export const INSP_TOP_N = 10;

// 품질 통계와 같은 정상 값·체크리스트 이름(js/ui-history-inspection.js renderQCStatsMode)
const NORMAL = ['정상', '양호', '동일', '없음', '해당없음', '통과', '-', ''];
const LABEL = { fabric: '원단', color: '컬러', distortion: '뒤틀림', unraveling: '올풀림', finishing: '마감', zipper: '지퍼', button: '단추', lining: '안감', pilling: '보풀', dye: '이염', brushed: '기모' };
const OTHER = '상태 불량/기타';

const str = (v) => (v == null ? '' : String(v));
const codeOf = (v) => { const c = str(v).trim(); return c === '-' ? '' : c; };
const rate = (a, b) => (b > 0 ? a / b * 100 : null);

/** log 하나의 불량 여부·사유(품질 통계와 같은 판정) */
export function logDefect(log) {
    const l = log || {};
    let bad = l.status === '불량';
    const reasons = [];
    if (Array.isArray(l.defects) && l.defects.length > 0) { bad = true; reasons.push(...l.defects.map(str)); }
    if (l.checklist && typeof l.checklist === 'object') {
        Object.entries(l.checklist).forEach(([k, v]) => {
            if (k === 'thickness' || !v) return;
            const t = String(v).trim();
            if (t && !NORMAL.includes(t)) { bad = true; reasons.push(`${LABEL[k] || k}: ${t}`); }
        });
    }
    return { bad, reasons: bad ? (reasons.length ? reasons : [OTHER]) : [] };
}

const blank = () => ({ n: 0, qty: 0, defectN: 0, defectQty: 0 });

/**
 * 검수 리포트 모델.
 * @param {{ productDocs:object[], totalLogs?:object[], from:string, to:string, topN?:number }} a
 *   productDocs = product_history 문서들({ id(상품명), logs, lastCode }), totalLogs = total_inspection_logs 기록(기간 쿼리 결과)
 * @returns {{ from, to, n, qty, defectN, defectQty, countRate, qtyRate, productTypes,
 *   sample:{n,qty,sampled,defectN,defectQty}, total:{n,qty,defectN,defectQty},
 *   reasons:{reason,n}[], products:{name,code,n,qty,defectN,defectQty,countRate,qtyRate,reason}[] }}
 *   비율은 % (분모 0 이면 null). products = 불량 건수 → 불량 수량 많은 순 상위 topN.
 */
export function buildInspReport({ productDocs = [], totalLogs = [], from = '', to = '', topN = INSP_TOP_N } = {}) {
    const docs = mergeIntoProductHistory(Array.isArray(productDocs) ? productDocs : [], Array.isArray(totalLogs) ? totalLogs : []);
    const all = blank();
    const sample = { ...blank(), sampled: 0 };
    const total = blank();
    const reasonN = new Map();
    const per = new Map();   // 상품명 → { name, code, codeAt, n, qty, defectN, defectQty, reasons:Map }
    for (const d of docs) {
        const name = str(d && d.id);
        for (const log of (Array.isArray(d && d.logs) ? d.logs : [])) {
            const date = str(log && log.date);
            if (!date || (from && date < from) || (to && date > to)) continue;
            const isTotal = log.inspectionType === 'total';
            const bucket = isTotal ? total : sample;
            const qty = Number(log.inboundQty) || Number(log.qty) || 0;
            let p = per.get(name);
            if (!p) { p = { name, code: '', codeAt: '', ...blank(), reasons: new Map() }; per.set(name, p); }
            const c = codeOf(log.code);
            if (c && date >= p.codeAt) { p.code = c; p.codeAt = date; }
            for (const o of [all, bucket, p]) { o.n += 1; o.qty += qty; }
            if (!isTotal) sample.sampled += log.sampleQty !== undefined ? (Number(log.sampleQty) || 0) : 1;
            const df = logDefect(log);
            if (!df.bad) continue;
            const dq = logDefectQty(log);
            for (const o of [all, bucket, p]) { o.defectN += 1; o.defectQty += dq; }
            df.reasons.forEach(r => {
                reasonN.set(r, (reasonN.get(r) || 0) + 1);
                p.reasons.set(r, (p.reasons.get(r) || 0) + 1);
            });
        }
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
    const docCode = new Map(docs.map(d => [str(d && d.id), codeOf(d && d.lastCode)]));
    const products = [...per.values()]
        .filter(p => p.defectN > 0 || p.defectQty > 0)
        .sort((a, b) => b.defectN - a.defectN || b.defectQty - a.defectQty || a.name.localeCompare(b.name, 'ko'))
        .slice(0, topN)
        .map(p => ({
            name: p.name, code: p.code || docCode.get(p.name) || '',
            n: p.n, qty: p.qty, defectN: p.defectN, defectQty: p.defectQty,
            countRate: rate(p.defectN, p.n), qtyRate: rate(p.defectQty, p.qty),
            reason: (top(p.reasons)[0] || [''])[0]
        }));
    return {
        from, to,
        n: all.n, qty: all.qty, defectN: all.defectN, defectQty: all.defectQty,
        countRate: rate(all.defectN, all.n), qtyRate: rate(all.defectQty, all.qty),
        productTypes: per.size,
        sample, total,
        reasons: top(reasonN).slice(0, topN).map(([reason, n]) => ({ reason, n })),
        products
    };
}

/** 팀 결산(js/ui-history-settlement.js)의 옛 검수 요약 칸 이름으로 — 종합 의견·요약 카드·엑셀이 이 이름을 쓴다. 비율은 % (없으면 0). */
export function toSettleInsp(r) {
    const m = r || buildInspReport();
    return {
        totalInspectionCount: m.n, totalInspectedQty: m.qty, totalDefectCount: m.defectN, totalDefectQty: m.defectQty,
        qtyDefectRate: m.qtyRate || 0, countDefectRate: m.countRate || 0,
        productTypeCount: m.productTypes,
        topReasons: m.reasons.slice(0, 5).map(x => [x.reason, x.n]),
        topDefective: m.products.map(p => ({ name: p.name, code: p.code, defectCount: p.defectN, defectQty: p.defectQty, totalQty: p.qty, commonReason: p.reason || '-' })),
        sample: m.sample, total: m.total
    };
}
