// === js/lib/ship-settings.js ===
// 플랫폼 출고 공용 설정(persistent_data/shipPlatformSettings, 2026-11-10 사용자 결정 — PC 별이 아니라 모두 같은 값).
//   { zikjinLimit: 직진 봉투당 최대 수량, ablyLimit: 에이블리 봉투당 최대 수량,
//     specialRules: [{ name: 상품명에 든 글자, limit: 한 봉 최대(0 = 꺼짐) }], transmit: 로케이션 실적·봉 수 전송 켬, updatedAt: ISO 글자 }
//   규칙(firestore.rules)과 같은 칸·범위 — 칸 이름·범위를 바꾸면 규칙과 규칙테스트.js 를 같이 고친다.
//   transmit 은 관리자만 바꾼다(규칙도 막는다). 병행 초기에는 false(옛 exe 가 기록) — 문서가 없으면 false.
//   직원 이름은 넣지 않는다(직원 전원이 읽는 문서).
// 순수 모듈(DOM·Firestore 없음). 테스트: tests/ship-settings.test.js

export const SETTINGS_PATH = ['artifacts', 'team-work-logger-v2', 'persistent_data', 'shipPlatformSettings'];
export const LIMIT_MIN = 1;
export const LIMIT_MAX = 999;
export const RULE_LIMIT_MAX = 999;
export const MAX_RULES = 10;
export const RULE_NAME_MAX = 40;
// 옛 Python 판 기본값(직진배송_자동화.py DEFAULT_CONFIG — 4개 모두 0 = 꺼짐) · 실제 설정도 같았다(설계 요약)
export const DEFAULT_RULES = Object.freeze([
    Object.freeze({ name: '웜베이직', limit: 0 }), Object.freeze({ name: '코트', limit: 0 }),
    Object.freeze({ name: '패딩', limit: 0 }), Object.freeze({ name: '무스탕', limit: 0 }),
]);
export const DEFAULTS = Object.freeze({ zikjinLimit: 30, ablyLimit: 25, transmit: false });

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

/** 저장된 문서 값(없으면 null) → 화면이 쓰는 설정. 모양이 틀린 칸은 기본값 */
export function normalizeSettings(data) {
    const d = (data && typeof data === 'object') ? data : {};
    const rules = Array.isArray(d.specialRules)
        ? d.specialRules.filter(r => r && typeof r === 'object' && typeof r.name === 'string')
            .slice(0, MAX_RULES)
            .map(r => ({ name: r.name, limit: inRange(r.limit, 0, RULE_LIMIT_MAX) ? r.limit : 0 }))
        : DEFAULT_RULES.map(r => ({ ...r }));
    return {
        exists: !!data,
        zikjinLimit: inRange(d.zikjinLimit, LIMIT_MIN, LIMIT_MAX) ? d.zikjinLimit : DEFAULTS.zikjinLimit,
        ablyLimit: inRange(d.ablyLimit, LIMIT_MIN, LIMIT_MAX) ? d.ablyLimit : DEFAULTS.ablyLimit,
        specialRules: rules,
        transmit: d.transmit === true,
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '',
    };
}

/** 칸 글자 → 정수(앞뒤 빈칸 허용, 그 밖은 null) */
export function parseIntText(text) {
    const s = String(text == null ? '' : text).trim();
    if (!/^\d{1,4}$/.test(s)) return null;
    return Number(s);
}

/** 봉투 한도 글자 검사 — 정수 1~999 면 숫자, 아니면 null */
export function parseLimit(text) {
    const n = parseIntText(text);
    return n !== null && inRange(n, LIMIT_MIN, LIMIT_MAX) ? n : null;
}

/**
 * 화면 입력 → { value, errors }. edit = { zikjinLimit: 글자, ablyLimit: 글자, specialRules: [{ name: 글자, limit: 글자 }] }
 * 이름이 빈 줄은 버린다. 같은 이름이 두 번이면 오류(어느 쪽이 먼저인지 헷갈린다).
 */
export function validateEdit(edit) {
    const e = edit || {};
    const errors = [];
    const zikjinLimit = parseLimit(e.zikjinLimit);
    if (zikjinLimit === null) errors.push(`직진배송 봉투당 최대 수량은 ${LIMIT_MIN}~${LIMIT_MAX} 사이 정수여야 합니다.`);
    const ablyLimit = parseLimit(e.ablyLimit);
    if (ablyLimit === null) errors.push(`에이블리 봉투당 최대 수량은 ${LIMIT_MIN}~${LIMIT_MAX} 사이 정수여야 합니다.`);
    const rules = [];
    const seen = new Set();
    (Array.isArray(e.specialRules) ? e.specialRules : []).forEach((r, i) => {
        const name = String((r && r.name) == null ? '' : r.name).trim();
        if (!name) return;
        if (name.length > RULE_NAME_MAX) { errors.push(`지정상품 ${i + 1}번째 이름이 ${RULE_NAME_MAX}자를 넘습니다.`); return; }
        if (seen.has(name)) { errors.push(`지정상품 '${name}' 이 두 번 있습니다.`); return; }
        seen.add(name);
        const limit = parseIntText(r && r.limit);
        if (limit === null || limit > RULE_LIMIT_MAX) { errors.push(`지정상품 '${name}' 의 최대 수량은 0~${RULE_LIMIT_MAX} 정수여야 합니다(0 = 끔).`); return; }
        rules.push({ name, limit });
    });
    if (rules.length > MAX_RULES) errors.push(`지정상품 규칙은 ${MAX_RULES}개까지입니다.`);
    return { value: { zikjinLimit, ablyLimit, specialRules: rules }, errors };
}

/**
 * 저장할 칸(setDoc merge 용). transmit 은 관리자가 바꿀 때만 넣는다 — 담당자 저장이 transmit 을 건드리지 않게(규칙도 막음).
 * @param {object} value  validateEdit 의 value
 * @param {{ isAdmin: boolean, transmit?: boolean, before?: object, nowIso: string }} o
 */
export function settingsWrite(value, { isAdmin = false, transmit, before = null, nowIso }) {
    const out = {
        zikjinLimit: value.zikjinLimit,
        ablyLimit: value.ablyLimit,
        specialRules: value.specialRules.map(r => ({ name: r.name, limit: r.limit })),
        updatedAt: String(nowIso || ''),
    };
    const was = !!(before && before.transmit === true);
    if (isAdmin && typeof transmit === 'boolean' && transmit !== was) out.transmit = transmit;
    return out;
}

/** 지정상품 규칙 중 켜진 것(이름 있고 한도 > 0) 수 */
export const activeRuleCount = (rules) => (rules || []).filter(r => r && String(r.name || '').trim() && Number(r.limit) > 0).length;
