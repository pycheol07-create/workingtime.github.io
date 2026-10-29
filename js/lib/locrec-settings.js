// === js/lib/locrec-settings.js ===
// 로케이션관리 환경설정 '추천·채우기' 탭(js/locset-panel.js)의 순수 함수 — import 없음(node --test 대상). (2026-10-27)
//
// 추천 양 3칸(maxRows·weeklyMoves·minGain)은 location.settings 권한자가 Locations/INFO_CONFIG.locRecSettings 에 쓴다.
//   서버 앱\로케이션추천\입력.py apply_app_settings 가 다음 추천(06:40 또는 [지금 재고로 다시 만들기])부터 쓴다.
//   칸마다 앱 값(범위 안) → 서버 설정.json → loc-recommend.js SERVER_DEFAULTS 순.
// ⚠️ LIMITS 는 서버 입력.APP_LIMITS 와 같아야 한다(서버 tests\test_입력.py 가 node 로 이 파일을 읽어 비교) — 한쪽만 바꾸지 말 것.
// 하루 출고 기준·재고 빼기·판정 기준·점수 비율·자리 고르는 순서(orderBy, 2026-10-29~ daily)는 서버 설정.json 이 정한다 — 화면은 integrations/locRecLatest.settings 를 읽기만 한다
//   (모양: 서버 입력.latest_settings).

export const LIMITS = Object.freeze({
    maxRows: Object.freeze({ min: 1, max: 50, int: true }),
    weeklyMoves: Object.freeze({ min: 1, max: 100, int: true }),
    minGain: Object.freeze({ min: 0, max: 50, int: false })
});
export const KEYS = Object.freeze(['maxRows', 'weeklyMoves', 'minGain']);

// 칸 이름·단위·한 줄 설명(화면 표시용)
export const FIELD_TEXT = Object.freeze({
    maxRows: { label: '하루 추천 행 수', unit: '행', help: '변경 추천 표에 하루에 보여 줄 단독·맞바꾸기 행의 최대 개수입니다(페어는 따로).' },
    weeklyMoves: { label: '주간 이동 수', unit: '회', help: '월요일 주간 요약에 담는 이동 수입니다. 단독은 1회, 맞바꾸기는 2회로 셉니다.' },
    minGain: { label: '최소 이득', unit: '', help: '옮겨서 줄어드는 걸음(하루 출고 × 앞당기는 정도)이 이보다 작으면 추천하지 않습니다.' }
});

const 범위글 = (k) => `${LIMITS[k].min}~${LIMITS[k].max}${LIMITS[k].int ? ' 사이 정수' : ''}`;

/** 한 칸 → 숫자 또는 null. 입력칸 문자열('15', ' 0.5 ')도 받는다. 빈칸·bool·범위 밖·정수 칸의 소수는 null */
export function valueOf(key, v) {
    const lim = LIMITS[key];
    if (!lim || v == null || typeof v === 'boolean') return null;
    if (typeof v === 'string') { if (v.trim() === '') return null; v = Number(v.trim()); }
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    if (lim.int && !Number.isInteger(v)) return null;
    return v >= lim.min && v <= lim.max ? v : null;
}

/**
 * 추천 양 정리 → { value: {maxRows, weeklyMoves, minGain}, errors: [{key, text}], ok }
 *   raw: 입력칸 값 또는 저장된 locRecSettings. fallback: 틀린 칸에 채울 값(보통 서버가 지금 쓰는 값 → 없으면 SERVER_DEFAULTS 와 같은 15·20·0.5).
 *   저장 전 검사(ok 가 거짓이면 저장하지 않는다)와 저장된 값 불러오기에 같이 쓴다.
 */
export function normalize(raw, fallback) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const fb = { maxRows: 15, weeklyMoves: 20, minGain: 0.5, ...(fallback && typeof fallback === 'object' ? fallback : {}) };
    const value = {}, errors = [];
    for (const k of KEYS) {
        const v = valueOf(k, src[k]);
        if (v == null) {
            errors.push({ key: k, text: `${FIELD_TEXT[k].label}: ${범위글(k)}로 넣으세요` });
            value[k] = valueOf(k, fb[k]) ?? null;
        } else value[k] = v;
    }
    return { value, errors, ok: errors.length === 0 };
}

/** 두 값이 같은가(저장 안 한 변경 판정). 숫자 문자열과 숫자는 같은 값으로 본다 */
export function sameValues(a, b) {
    return KEYS.every(k => String(a && a[k] != null ? a[k] : '').trim() === String(b && b[k] != null ? b[k] : '').trim());
}

const SOURCE_TEXT = { app: '앱 설정', file: '서버 파일', default: '기본값' };
const pct = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x * 100)}%` : null);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * 서버가 정하는 값(읽기 전용 표시) — locRecLatest.settings → [{label, value, note?}]. 설정이 없으면 [].
 *   판정 기준 칸이 null 이면 '미정, 관찰 중'.
 */
export function serverRows(s) {
    if (!s || typeof s !== 'object') return [];
    const out = [];
    const half = num(s.halfLifeDays);
    if (s.dailyBasis === 'ew') out.push({ label: '하루 출고 기준', value: `최근 흐름(반감기 ${half ?? 7}일, 최근 28일)` });
    else if (s.dailyBasis === 'avg28') out.push({ label: '하루 출고 기준', value: '28일 평균' });
    const lo = s.lowStock && typeof s.lowStock === 'object' ? s.lowStock : null;
    if (lo) {
        out.push({ label: '재고 적은 상품 빼기', value: lo.enabled === true
            ? `켬 — 재고 ${num(lo.maxStock) ?? '?'}개 이하이거나 ${num(lo.minCoverDays) ?? '?'}일 안에 다 나갈 상품은 앞으로 옮기지 않음(입고대기 있으면 뺌 안 함)`
            : '끔' });
    }
    const r = s.ratios && typeof s.ratios === 'object' ? s.ratios : null;
    if (s.orderBy === 'daily') out.push({ label: '자리 고르는 순서', value: '하루 출고 많은 순(플랫폼·국내 구분 없이)' });
    else if (r) out.push({ label: '점수 반영 비율', value: `플랫폼 출고 ${num(r.zikjin) ?? '?'}% · 주차별 ${num(r.weekly) ?? '?'}% · 상승세 ${num(r.trend) ?? '?'}%` });
    const p = s.pair && typeof s.pair === 'object' ? s.pair : null;
    if (p) out.push({ label: '페어 기준', value: `같이 주문된 횟수 ${num(p.minCount) ?? '?'}번 이상 · 같이 나갈 가능성(lift) ${num(p.minLift) ?? '?'}배 이상` });
    const v = s.verdict && typeof s.verdict === 'object' ? s.verdict : null;
    if (v) {
        // 서버 판정.verdict — 넷 중 하나라도 비어 있으면 판정은 '관찰 중'
        const 미정 = '미정, 관찰 중';
        out.push({ label: '판정 필요 — 좋은 자리 점유율', value: pct(v.needShare) == null ? 미정 : `${pct(v.needShare)} 미만` });
        out.push({ label: '판정 주의 — 좋은 자리 점유율', value: pct(v.warnShare) == null ? 미정 : `${pct(v.warnShare)} 미만` });
        out.push({ label: '판정 필요 — 추천 이득 증가', value: pct(v.needGainRise) == null ? 미정 : `지난주보다 ${pct(v.needGainRise)} 이상` });
        out.push({ label: '판정 주의 — 추천 이득 합', value: num(v.warnGain) == null ? 미정 : `${num(v.warnGain)} 이상` });
    }
    return out;
}

/**
 * 계산 방식 안내(쉬운 말) → { refill: [문장], locrec: [문장] }. 숫자는 서버 값(locRecLatest.settings)으로 채운다 — 없으면 '?'.
 *   채우기 쪽 고정 숫자(28일·14일·08:20)는 채우기자동화 README '무엇을 하는가'·규칙.py(DAILY_WINDOW·MIN_DAILY_DAYS)와 같다.
 *   s 가 없으면(아직 서버 기록 전) 하루 출고 기준 문장은 '서버 기록이 아직 없음'.
 */
export function guideLines(s) {
    const S = s && typeof s === 'object' ? s : {};
    const q = (x) => (num(x) == null ? '?' : String(num(x)));
    const lo = S.lowStock && typeof S.lowStock === 'object' ? S.lowStock : {};
    const p = S.pair && typeof S.pair === 'object' ? S.pair : {};
    const r = S.ratios && typeof S.ratios === 'object' ? S.ratios : {};
    const daily = S.dailyBasis === 'ew'
        ? `최근 28일 출고를 요즘 날일수록 크게 쳐서(반감기 ${q(S.halfLifeDays)}일) 낸 하루 평균`
        : S.dailyBasis === 'avg28' ? '최근 28일 출고 합 ÷ 출고 자료가 있는 날 수' : '(서버 기록이 아직 없음)';
    const refill = [
        '매일 08:20(위 채우기 설정의 요일, 공휴일 쉼)에 비축창고 → 피킹 자리로 채울 상품을 지시서로 만듭니다.',
        '피킹재고 = 정상재고 − 비축재고. 주문(접수+송장)이 피킹재고보다 많은 상품은 밀린 주문을 반드시 채우고, 적재량까지 채웁니다(비축재고 안에서).',
        '판매량 대비 부족: 하루 출고가 1개 이상인데 피킹재고가 하루치보다 적거나, 1개 미만인데 피킹재고가 0 이하인 상품도 하루치 이상·적재량까지 채웁니다.',
        `하루 출고 = ${daily}. 출고 자료가 14일 미만인 날은 이 기준을 빼고 만듭니다.`,
        '비축 위치는 로케이션관리 자료의 옵션추가항목1 에서 읽습니다(재고 엑셀을 올릴 때 갱신).'
    ];
    const locrec = [
        '매일 06:40(또는 [지금 재고로 다시 만들기])에 많이 나가는 상품을 동선 기준(구역 순위·동/위치 순서)에서 더 앞 자리로 옮기도록 권합니다.',
        `하루 출고는 채우기와 같은 기준(${daily})을 씁니다.`,
        `이득 = 하루 출고 × 앞당기는 정도. 최소 이득 ${q(S.minGain)} 미만은 빼고, 이득이 큰 순서로 하루 ${q(S.maxRows)}행까지 보여 줍니다. 주간 요약은 ${q(S.weeklyMoves)}회까지 담습니다.`,
        '단독은 빈 자리로 옮기기, 맞바꾸기는 앞 자리의 덜 나가는 상품과 서로 바꾸기입니다(맞바꾸기는 2회로 셉니다).',
        `페어: 같이 주문된 횟수 ${q(p.minCount)}번 이상, 같이 나갈 가능성(lift) ${q(p.minLift)}배 이상인 상품끼리 가까이 둡니다.`,
        lo.enabled === true
            ? `재고 적은 상품 빼기(켬): 재고 ${q(lo.maxStock)}개 이하이거나 ${q(lo.minCoverDays)}일 안에 다 나갈 상품은 앞으로 옮기지 않습니다(입고대기가 있으면 뺌 안 함).`
            : '재고 적은 상품 빼기: 꺼져 있습니다.',
        S.orderBy === 'daily'
            ? '빈 자리는 하루 출고가 많은 상품부터 먼저 고릅니다(어디로 출고되는지는 구분하지 않음).'
            : `상품 순서를 정할 때 점수 반영 비율(플랫폼 출고 ${q(r.zikjin)}% · 주차별 ${q(r.weekly)}% · 상승세 ${q(r.trend)}%)을 씁니다.`,
        '구역 등급이 지금보다 낮은 자리로는 옮기지 않고, 예약·당일지정·선지정 빈 자리는 추천하지 않습니다.'
    ];
    return { refill, locrec };
}

/** 추천 양 칸별 출처 글('앱 설정'·'서버 파일'·'기본값') — locRecLatest.settings.source. 모르면 '' */
export function sourceText(s, key) {
    const src = s && s.source && typeof s.source === 'object' ? s.source[key] : null;
    return SOURCE_TEXT[src] || '';
}
