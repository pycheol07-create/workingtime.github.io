// === js/lib/ship-mixed.js ===
// 플랫폼 출고 통합 화면 — 직진·에이블리 파일을 한꺼번에 놓았을 때(2026-11-13 사용자 요청 '섞어 올리기').
//   예전에는 섞이면 아무것도 넣지 않고 '한 플랫폼씩 넣어 주세요'(ship-assign.routeFiles error)였다. 이제 파일마다 플랫폼·단계를
//   알아보고 (플랫폼, 단계) 묶음(job)으로 나눠 화면(js/ship.js dropMixed)이 차례로 저절로 만든다. 한 플랫폼만 놓으면 옛 길 그대로.
//   출고전표는 직진·에이블리 모양이 같아 상품코드가 어느 출고요청(이번에 놓은 것 · 1단계를 마치고 기다리는 것)과 겹치는지로 가린다.
//   순수 모듈 — 상품코드는 화면이 읽어 넘긴다(codes). 계산(만들기·전송)은 건드리지 않는다. 테스트: tests/ship-mixed.test.js
//
// 건너뛰는 묶음(나머지는 진행)
//   · 같은 플랫폼 출고요청·출고전표가 두 벌(어느 것을 쓸지 애매)
//   · 2단계(출고전표)에 맞는 출고요청이 없음
//   · 플랫폼을 모르는 파일(모르는 파일 · 1단계 결과 · 어느 출고요청과도 PAIR_MIN 만큼 겹치지 않거나, 넘는 후보가 둘 이상인 출고전표)
// 짝은 엄격하게(2026-11-13 리뷰 높음 1): 출고전표 상품코드의 PAIR_MIN(95%) 이상이 그 출고요청에 있어야 하고, 넘는 후보(이번 출고요청·기다리는
//   출고요청, 플랫폼 상관없이)가 하나뿐이어야 한다. 짝이 정해져도 출고요청에 없는 코드가 하나라도 있으면 missing > 0 — 화면은 저절로 시작하지 않고 멈춘다.
//   출고전표를 짝 없이 건너뛴 드롭에서는 1단계 묶음에 pairWait — 화면이 '오늘 이미 1단계를 만든 출고요청'이면 1단계를 다시 돌리지 않고 2단계 칸에서 짝을 기다리게 한다.

import { KIND, KIND_LABEL } from './ship-assign.js?v=202611131136';

export const TABS = ['zikjin', 'ably'];
const NAME = { zikjin: '직진', ably: '에이블리' };
const REQ = { zikjin: KIND.ZIKJIN_REQUEST, ably: KIND.ABLY_REQUEST };
const TMPL = { zikjin: KIND.ZIKJIN_TEMPLATE, ably: KIND.ABLY_TEMPLATE };
export const PAIR_MIN = 0.95;    // 출고전표 상품코드 중 이만큼 이상이 그 출고요청에 있어야 짝(넘는 후보가 둘 이상이면 건너뜀)
// 반대 방향(2026-11-13 재리뷰 사례 D) — 출고요청 상품코드 중 출고전표에 있는 비율. 큰 출고요청이 출고전표를 통째로 품어 짝으로 잡히지 않게
export const COVER_MIN = 0.8;    // 이보다 작으면 짝 아님(건너뜀)
export const COVER_OK = 0.95;    // COVER_MIN 이상 이보다 작으면 짝은 정하되 저절로 시작하지 않음(재고 부족으로 빠졌을 수도, 다른 묶음일 수도)

/** 출고요청 코드 중 출고전표에 있는 비율(0~1). 못 읽었으면 null */
export function coverOf(adminCodes, reqCodes) {
    return shareOf(reqCodes, adminCodes);
}

/**
 * pairWait 1단계(짝 없는 출고전표가 같이 들어온 드롭)를 어떻게 할지 — 화면(js/ship.js runQueue)이 사실을 넘긴다.
 * @param {{ made: boolean, waiting: boolean, sameAsWaiting: boolean }} p
 *   made = 이 출고요청으로 오늘 1단계를 이미 만듦 · waiting = 2단계 칸에 1단계를 마친 출고요청이 기다리는 중(출고전표 없음) · sameAsWaiting = 그게 이 파일
 * @returns {'run'|'place'|'keep'}  run = 1단계 만들기 · place = 2단계 칸에 넣고 짝 대기 · keep = 다른 묶음이 기다리는 중이라 칸을 덮지 않고 짝 대기 표시만
 */
export function pairWaitPlan({ made, waiting, sameAsWaiting }) {
    if (!made) return 'run';
    if (waiting && !sameAsWaiting) return 'keep';
    return 'place';
}

/** 출고전표 코드 중 출고요청 코드에 없는 것의 수(서로 다른 코드). 못 읽었으면 null */
export function missingOf(adminCodes, reqCodes) {
    if (!adminCodes || !reqCodes) return null;
    const r = reqCodes instanceof Set ? reqCodes : new Set(reqCodes);
    return [...new Set(adminCodes)].filter(c => !r.has(c)).length;
}

/** 출고전표 코드 중 출고요청 코드에 있는 비율(0~1). 못 읽었으면 null */
export function shareOf(adminCodes, reqCodes) {
    if (!adminCodes || !reqCodes) return null;
    const a = [...new Set(adminCodes)];
    if (!a.length) return null;
    const r = reqCodes instanceof Set ? reqCodes : new Set(reqCodes);
    return a.filter(c => r.has(c)).length / a.length;
}

/** 두 코드 목록이 (서로 다른 코드로) 같은가 */
export function sameCodes(a, b) {
    if (!a || !b) return false;
    const x = new Set(a), y = new Set(b);
    return x.size === y.size && [...x].every(c => y.has(c));
}

/** 여러 파일이 섞였나 — 출고요청·양식으로 알 수 있는 플랫폼이 둘 이상이면 섞어 올리기 */
export function isMixed(files) {
    const plats = new Set();
    for (const f of files || []) {
        for (const t of TABS) if (f.kind === REQ[t] || f.kind === TMPL[t]) plats.add(t);
    }
    return plats.size > 1;
}

/**
 * @param {Array<{ name, kind, codes?: string[]|null }>} files  판정된 파일(넣은 순서). codes = 출고요청·출고전표의 상품코드
 * @param {{ pending?: { zikjin?: string[]|null, ably?: string[]|null } }} [o]  1단계를 마치고 2단계를 기다리는 쪽 출고요청 코드
 * @returns {{ jobs: Array<{ tab, step: 1|2, request: object|null, admin: object|null, template: object|null, usePending: boolean, missing?: number, pairWait?: boolean }>,
 *             skipped: Array<{ tab: string|null, step: number|null, names: string[], why: string, note?: true }> }}
 *   skipped 의 note = 묶음은 진행하고 그 파일만 안 씀(안내)
 *   jobs 는 직진 → 에이블리, 같은 플랫폼이면 2단계(기다리던 묶음) → 1단계 순. request null + usePending = 기다리던 출고요청을 씀
 *   missing = 2단계 출고전표 코드 중 짝 출고요청에 없는 수(> 0 이면 멈춤) · pairWait = 짝 없는 출고전표가 같이 들어온 드롭의 1단계
 *   cover = 짝 출고요청 코드 중 출고전표에 있는 비율(COVER_OK 미만이면 화면이 멈춤)
 */
export function planMixed(files, { pending = {} } = {}) {
    const jobs = [], skipped = [];
    const list = files || [];
    const by = (k) => list.filter(f => f.kind === k);
    // 플랫폼을 모르는 파일
    for (const f of list) {
        if (f.kind === KIND.UNKNOWN) skipped.push({ tab: null, step: null, names: [f.name], why: '어떤 파일인지 알 수 없어 건너뛰었습니다(칸에 직접 넣어 주세요).' });
        else if (f.kind === KIND.STOCK_OUT) skipped.push({ tab: null, step: null, names: [f.name], why: '1단계 결과 파일(재고출고용)이라 건너뛰었습니다 — 이지어드민에서 받은 출고전표를 넣으세요.' });
    }
    // 출고전표 → 짝 출고요청(상품코드가 PAIR_MIN 이상 들어 있는 후보가 딱 하나일 때만). 후보 = 이번에 놓은 출고요청 · 기다리는 출고요청, 두 플랫폼 모두
    const reqs = { zikjin: by(REQ.zikjin), ably: by(REQ.ably) };
    const admins = { zikjin: [], ably: [] };
    let unpaired = false;
    for (const a of by(KIND.ADMIN)) {
        const cands = [];
        for (const t of TABS) {
            for (const r of reqs[t]) cands.push({ tab: t, req: r, codes: r.codes || null });
            // 기다리는 출고요청과 상품이 똑같은 출고요청을 다시 놓았으면(1단계 뒤 같은 파일을 같이 놓음) 한 후보로 — 이번에 놓은 것을 쓴다
            if (pending[t] && !reqs[t].some(r => sameCodes(r.codes, pending[t]))) cands.push({ tab: t, req: null, codes: pending[t] });
        }
        const fwd = cands.filter(c => { const sh = shareOf(a.codes, c.codes); return sh !== null && sh >= PAIR_MIN; });
        // 반대 방향 — 출고요청 상품 중 출고전표에 있는 것이 COVER_MIN 이 안 되면(더 큰 다른 묶음) 짝 아님
        const hits = fwd.filter(c => { const cv = coverOf(a.codes, c.codes); return cv !== null && cv >= COVER_MIN; });
        if (hits.length === 1) { admins[hits[0].tab].push({ admin: a, pair: hits[0], cover: coverOf(a.codes, hits[0].codes) }); continue; }
        unpaired = true;
        const why = hits.length > 1
            ? `상품이 거의 같은 출고요청이 ${hits.length}개라 어느 쪽 출고전표인지 가릴 수 없어 건너뛰었습니다 — 그 쪽 파일만 따로 놓아 주세요.`
            : fwd.length
                ? '출고전표 상품을 모두 담은 출고요청은 있지만, 그 출고요청 상품 중 출고전표에 있는 것이 80%가 안 돼(더 큰 다른 묶음으로 보임) 건너뛰었습니다 — 같은 묶음의 출고요청과 같이 놓거나, 따로 놓아 주세요.'
                : '상품이 맞는 출고요청(이번에 놓은 것·1단계를 마치고 기다리는 것)이 없어 건너뛰었습니다 — 같은 묶음의 출고요청과 같이 놓거나, 따로 놓아 주세요.';
        skipped.push({ tab: null, step: 2, names: [a.name], why });
    }
    for (const t of TABS) {
        const rq = reqs[t], ad = admins[t];
        const tmpls = by(TMPL[t]);
        const template = tmpls[0] || null;
        // 양식이 둘이면 앞의 것만(묶음은 그대로 진행 — note: 결과 카드 '건너뜀' 묶음으로 세지 않고 안내만)
        if (tmpls.length > 1) skipped.push({ tab: t, step: 2, note: true, names: tmpls.slice(1).map(f => f.name), why: `${KIND_LABEL[TMPL[t]]} 파일이 둘이라 앞의 '${tmpls[0].name}' 만 씁니다.` });
        if (rq.length > 1 || ad.length > 1) {
            const two = [rq.length > 1 ? '출고요청' : '', ad.length > 1 ? '출고전표' : ''].filter(Boolean).join('·');
            skipped.push({ tab: t, step: ad.length ? 2 : 1, names: [...rq, ...ad.map(x => x.admin)].map(f => f.name), why: `${NAME[t]} ${two} 파일이 두 벌이라 어느 것을 쓸지 몰라 ${NAME[t]} 묶음은 건너뛰었습니다 — 한 벌씩 놓아 주세요.` });
            continue;
        }
        const req = rq[0] || null;
        const pa = ad[0] || null;
        if (pa) {
            const missing = missingOf(pa.admin.codes, pa.pair.codes);
            const cover = pa.cover;
            if (pa.pair.req) {
                jobs.push({ tab: t, step: 2, request: pa.pair.req, admin: pa.admin, template, usePending: false, missing, cover });
            } else {
                jobs.push({ tab: t, step: 2, request: null, admin: pa.admin, template, usePending: true, missing, cover });
                if (req) jobs.push({ tab: t, step: 1, request: req, admin: null, template: null, usePending: false, pairWait: unpaired });   // 이번에 놓은 출고요청은 새 1단계
            }
        } else if (req) {
            jobs.push({ tab: t, step: 1, request: req, admin: null, template: t === 'ably' ? template : null, usePending: false, pairWait: unpaired });
        }
    }
    return { jobs, skipped };
}

/**
 * 묶음을 한 번에 하나씩 차례로 — 하나가 실패(예외)해도 다음 묶음은 한다.
 * @param {Array} jobs
 * @param {(job, i) => Promise<{status: 'ok'|'fail'|'skip'}>} step  묶음 하나 실행(화면 run). 예외면 status 'fail'
 * @returns {Promise<Array>}  step 결과에 job 을 붙인 것(jobs 순서)
 */
export async function runJobs(jobs, step) {
    const out = [];
    for (let i = 0; i < (jobs || []).length; i++) {
        let r;
        try { r = await step(jobs[i], i); } catch (e) { r = { status: 'fail', why: String((e && e.message) || e || '알 수 없는 오류') }; }
        out.push({ ...(r || { status: 'fail' }), job: jobs[i] });
    }
    return out;
}

/** 끝 요약 '완료 1 · 실패 1 · 건너뜀 0' */
export function queueCounts(done) {
    const c = { ok: 0, fail: 0, skip: 0 };
    for (const x of done || []) if (c[x.status] !== undefined) c[x.status]++;
    return { ...c, text: `완료 ${c.ok} · 실패 ${c.fail} · 건너뜀 ${c.skip}` };
}

/** 묶음 이름 '직진배송 1단계' */
export const jobLabel = (j, tabName) => `${tabName[j.tab] || j.tab} ${j.step}단계`;
