// === js/lib/calc-settings.js ===
// 통합계산기 공용 설정 — 순수 함수(브라우저·Firebase 없음). calculator/shared-settings.js 가 쓰고 tests/calc-settings.test.js 가 본다.
//
// 공용 문서 artifacts/team-work-logger-v2/persistent_data/calculatorSettings
//   { settings: {common, import, customs, warehouse, shipping}   ← 통관비 기본값 3개(AUTO_KEYS)는 넣지 않는다(logis 평균 자동값)
//     meta:     {common: {docsFee: {at, by}}, …}                 ← 칸마다 마지막 변경
//     history:  [{at, by, key, label, before, after}, …]         ← 최근 순, HISTORY_MAX 건
//     rev, updatedAt, updatedBy }
// '칸' = 'common.docsFee' 처럼 분류.키 하나. 옵션 목록(수수료율·관세율·파레트 …)은 목록 전체가 한 칸이다.

export const AUTO_KEYS = ['defaultUnitPrice', 'defaultQuantityPerBox', 'defaultWeightPerBox'];   // customs 안
export const HISTORY_MAX = 300;
export const INITIAL_KEY = '*';

// 사람이 읽는 이름 — 설정 화면(calculator/AdminPage.js)의 탭·칸 이름과 맞춘다. 없는 키는 키 그대로 보인다.
export const SETTING_LABELS = {
    'common.docsFee': '기본 수수료 · 서류비',
    'common.coFee': '기본 수수료 · CO 발급비',
    'common.oceanFreightPerCbm': '기본 수수료 · 해운비 기준가',
    'common.minCbm': '기본 수수료 · LCL 최소 CBM',
    'common.cbmWeightDivisor': '기본 수수료 · CBM 무게 나누기 기준',
    'common.vatRate': '기본 수수료 · 부가세율',
    'import.commissionRates': '수입가 옵션 · 수수료율',
    'import.customsFeeRates': '수입가 옵션 · 통관비율',
    'import.packagingOptions': '수입가 옵션 · 포장비',
    'import.labelOptions': '수입가 옵션 · 라벨비',
    'customs.tariffRates': '통관비 옵션 · 관세율',
    'customs.shippingTypes': '통관비 옵션 · 운송 형태',
    'customs.commissionTypes': '통관비 옵션 · 수수료 타입',
    'warehouse.ratePerCBMPerDay': '창고료 · 창고료 단가',
    'warehouse.freeDays': '창고료 · 무료보관일수',
    'warehouse.surchargeRate': '창고료 · 가산세율',
    'warehouse.paymentDueDays': '창고료 · 납부마감기한',
    'warehouse.dailyInterestRate': '창고료 · 일 지연이자율',
    'shipping.container20': '선적 옵션 · 20ft 컨테이너',
    'shipping.container40': '선적 옵션 · 40ft 컨테이너',
    'shipping.palletTypes': '선적 옵션 · 파레트 규격',
};
export const labelOf = (key) => (key === INITIAL_KEY ? '처음 이전' : (SETTING_LABELS[key] || key));

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** 키 순서와 상관없이 같은 값인가 (JSON 으로 표현되는 값만) */
export const same = (a, b) => canon(a) === canon(b);
function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    if (v === undefined) return 'undefined';
    if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
    return JSON.stringify(v);
}

/** 계산기 설정 → 공용 부분(통관비 기본값 3개 뺀 사본) */
export const sharedPart = (settings) => {
    const out = {};
    if (!isObj(settings)) return out;
    for (const cat of Object.keys(settings)) {
        if (!isObj(settings[cat])) continue;
        out[cat] = {};
        for (const k of Object.keys(settings[cat])) {
            if (cat === 'customs' && AUTO_KEYS.includes(k)) continue;
            out[cat][k] = clone(settings[cat][k]);
        }
    }
    return out;
};

/** 'cat.key' 목록 — 두 설정의 합집합(새 키·없어진 키도 칸으로 본다). 통관비 기본값 3개 제외. */
export const settingKeys = (...list) => {
    const keys = new Set();
    for (const s of list) {
        if (!isObj(s)) continue;
        for (const cat of Object.keys(s)) {
            if (!isObj(s[cat])) continue;
            for (const k of Object.keys(s[cat])) {
                if (cat === 'customs' && AUTO_KEYS.includes(k)) continue;
                keys.add(cat + '.' + k);
            }
        }
    }
    return [...keys].sort();
};

export const getAt = (obj, key) => {
    const [cat, k] = key.split('.');
    return isObj(obj) && isObj(obj[cat]) ? obj[cat][k] : undefined;
};
export const setAt = (obj, key, value) => {
    const [cat, k] = key.split('.');
    if (!isObj(obj[cat])) obj[cat] = {};
    if (value === undefined) delete obj[cat][k];
    else obj[cat][k] = clone(value);
    return obj;
};

/** 바뀐 칸 목록 (a → b) */
export const diffKeys = (a, b) => settingKeys(a, b).filter(k => !same(getAt(a, k), getAt(b, k)));

/** 이력에 보일 짧은 글 */
export const formatValue = (v) => {
    if (v === undefined || v === null) return '(없음)';
    if (Array.isArray(v)) {
        if (!v.length) return '(빈 목록)';
        return v.map(it => {
            if (!isObj(it)) return String(it);
            const name = it.label ?? it.value ?? '';
            if ('length' in it || 'width' in it || 'height' in it) return `${name} ${it.length}×${it.width}×${it.height}`;
            return (it.value !== undefined && String(it.value) !== String(name)) ? `${name}=${it.value}` : String(name);
        }).join(', ');
    }
    if (isObj(v)) {
        if ('length' in v || 'width' in v || 'height' in v) return `${v.length}×${v.width}×${v.height}`;
        return JSON.stringify(v);
    }
    return String(v);
};

/**
 * 저장 계획 — 트랜잭션 안에서 읽은 공용 값(remote)에 이 사람의 변경(base → local)만 얹는다.
 *   remote: 공용 settings | null(문서·settings 없음 = 처음 이전)
 *   base:   설정 화면을 열 때의 값 · local: 저장하려는 값
 * 칸마다: remote 가 base 와 같으면 local 로 바꾼다(applied) · remote 가 이미 local 과 같으면 그대로(같은 변경) ·
 *         그 밖(그사이 다른 사람이 바꿈)은 덮지 않는다(conflicts).
 *         remote 에 그 칸이 아예 없으면(새로 생긴 설정 칸 — 공용 문서가 옛 모양) remote == base 로 보고 바꾼다.
 * 처음 이전(remote 없음): local 공용 부분 전체로 시작한다(initial). applied 는 base 대비 바꾼 칸.
 *   applied 가 비어 있으면(바뀐 칸 없음) 쓰지 않는다 — 호출하는 쪽(shared-settings.js)이 거른다.
 * → { next, applied: [key], conflicts: [{key, remote, mine}], initial }
 */
export const planSave = ({ remote, base, local }) => {
    const b = sharedPart(base), l = sharedPart(local);
    const changed = diffKeys(b, l);
    if (!isObj(remote) || !Object.keys(remote).length) {
        return { next: l, applied: changed, conflicts: [], initial: true };
    }
    const next = sharedPart(remote);
    const applied = [], conflicts = [];
    for (const key of changed) {
        const r = getAt(next, key);
        if ((r === undefined && getAt(l, key) !== undefined) || same(r, getAt(b, key))) { setAt(next, key, getAt(l, key)); applied.push(key); }
        else if (same(r, getAt(l, key))) { /* 다른 사람이 똑같이 바꿔 둠 */ }
        else conflicts.push({ key, remote: clone(r), mine: clone(getAt(l, key)) });
    }
    return { next, applied, conflicts, initial: false };
};

/** 이력 줄 — 칸마다 한 줄. 처음 이전이면 맨 앞(시간상 먼저)에 '처음 이전' 한 줄. 최근 순으로 돌려준다. */
export const historyEntries = ({ applied, before, after, at, by, initial }) => {
    const rows = [];
    if (initial) rows.push({ at, by, key: INITIAL_KEY, label: labelOf(INITIAL_KEY), before: '', after: '이 사람의 PC 설정으로 공용 설정 시작' });
    for (const key of applied) {
        rows.push({ at, by, key, label: labelOf(key), before: formatValue(getAt(before, key)), after: formatValue(getAt(after, key)) });
    }
    return rows.reverse();
};

/** 새 이력(최근 순)을 앞에 붙이고 HISTORY_MAX 건으로 자른다 */
export const appendHistory = (old, entries, max = HISTORY_MAX) =>
    [...(entries || []), ...(Array.isArray(old) ? old : [])].slice(0, max);

/** 칸별 마지막 변경 표시 갱신 */
export const updateMeta = (meta, keys, at, by) => {
    const out = clone(isObj(meta) ? meta : {}) || {};
    for (const key of keys) setAt(out, key, { at, by });
    return out;
};

/** 지금 설정에 공용 값을 얹는다. 통관비 기본값 3개는 지금 값을 그대로 둔다. 공용에 없는 칸도 지금 값 유지. */
export const applyShared = (current, shared) => {
    const out = clone(current) || {};
    if (!isObj(shared)) return out;
    for (const key of settingKeys(shared)) setAt(out, key, getAt(shared, key));
    return out;
};

/** mainConfig 의 memberEmails(이름 → 이메일)·systemAccounts([{email, name}]) 로 이메일 → 이름. 못 찾으면 '알 수 없음'. */
export const nameForEmail = (cfg, email) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !isObj(cfg)) return '알 수 없음';
    const me = cfg.memberEmails;
    if (isObj(me)) {
        for (const [name, v] of Object.entries(me)) {
            if (name && typeof v === 'string' && v.trim().toLowerCase() === e) return name;
        }
    }
    if (Array.isArray(cfg.systemAccounts)) {
        const a = cfg.systemAccounts.find(x => x && typeof x.email === 'string' && x.email.trim().toLowerCase() === e);
        if (a && a.name) return String(a.name);
    }
    return '알 수 없음';
};
