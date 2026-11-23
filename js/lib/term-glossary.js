// === js/lib/term-glossary.js ===
// 어려운 용어 사전(2026-11-23 사용자 요청 — UPH·OEE 처럼 직관적이지 않은 이름은 늘 눌러서 설명을 본다).
// 화면 모듈 js/term-help.js 가 머리글류 글자에서 이 용어를 찾아 점선 밑줄로 표시하고, 누르면 설명을 띄운다.
// 설명·계산식은 실제 계산(js/lib/ops-metrics.js periodMetrics·dayStaff, js/lib/ops-view-model.js)과 같게 쓴다 — 계산을 바꾸면 여기도.
// ※ 순수 모듈(DOM 없음). 테스트: tests/term-glossary.test.js

/**
 * 용어 목록. words = 화면에서 찾을 글자(긴 것부터 맞춘다), name = 설명 창 제목, desc = 한두 문장, calc = 계산식(선택).
 * endCheck: 뒤 글자도 한글이 아니어야 함(짧은 단어가 다른 말 속에 섞여 잡히지 않게 — '인시간'·'효율성' 등).
 * notAfter: 바로 앞 낱말이 이것이면 다른 지표라 잡지 않는다('품질 효율'·'기준 대비 효율' 등).
 * notBefore: 바로 뒤 글자가 이것으로 시작하면 잡지 않는다('가동률 설정' = 설정값).
 * 한글 용어는 늘 앞 글자가 한글이 아니어야 잡힌다('확인시'의 '인시', '업무효율'의 '효율'은 안 잡힘).
 */
export const TERMS = Object.freeze([
    { key: 'uph', words: ['평상시 UPH', 'UPH'], name: 'UPH (시간당 처리량)',
        desc: '사람 1명이 1시간에 몇 개를 처리했는지입니다. Units Per Hour 의 줄임말입니다. 평상시 UPH 는 지난 기록으로 본 보통 속도입니다.',
        calc: '처리량 ÷ 업무 기록 시간 합(사람마다 더한 시간) — 예: 3명이 2시간씩(총 6시간) 1,200개 → 200개/시' },
    { key: 'oee', words: ['OEE'], name: 'OEE (종합 효율)',
        desc: '출근한 시간을 얼마나 일에 쓰고(가동률), 얼마나 평소 속도로 하고(효율), 다시 하는 일 없이 했는지(품질)를 한 숫자로 본 것입니다. 85% 이상이면 좋음, 70% 미만이면 낮음입니다.',
        calc: '가동률 × 효율 × 품질 (가동률·효율은 100% 까지만 셈)' },
    { key: 'fte', words: ['FTE'], name: 'FTE (환산 인원)',
        desc: '인원을 사람 수 단위로 나타낸 값입니다(Full-Time Equivalent — 하루 근무하는 1명 = 1). 출근 인원·필요 인원·유효 인력처럼 칸마다 무엇을 셌는지는 그 칸 이름을 따릅니다.' },
    { key: 'util', words: ['가동률'], notBefore: [' 설정', '설정'], name: '가동률',
        desc: '출근해 있던 시간 가운데 업무 기록이 있는 시간의 비율입니다. 낮으면 기록 없는 시간(대기·기록 누락)이 많다는 뜻입니다. 필요 인원을 계산할 때 쓰는 가동률 설정(기본 80%)과는 다릅니다.',
        calc: '업무 기록 시간 ÷ 출근해 있던 시간(출근~퇴근) × 100' },
    { key: 'eff', words: ['효율'], endCheck: true, notAfter: ['품질', '기준 대비', '생산', '인당', '배치', '업무', '작업', '종합'], name: '효율',
        desc: '평상시 속도로 했다면 걸렸을 시간과 실제 걸린 시간을 비교한 것입니다. 100% 면 평소와 같고, 높을수록 빠르게 처리했습니다.',
        calc: '평상시 속도로 걸릴 시간 ÷ 실제 업무 기록 시간 × 100' },
    { key: 'base', words: ['평상시 속도'], name: '평상시 속도',
        desc: '업무별로 지난 기록에서 본 보통 처리 속도입니다(오늘은 빼고 계산). 효율·필요 인원·손실 시간의 기준이 됩니다.' },
    { key: 'req', words: ['필요 인원', '필요인원'], name: '필요 인원',
        desc: '그날 물량을 평상시 속도로 처리하는 데 필요한 인원입니다. 사람이 하루 내내 일만 할 수는 없어서 가동률 설정(기본 80%)으로 나눠 여유를 둡니다.',
        calc: '평상시 속도로 걸릴 시간 ÷ (1인 출근 시간 × 가동률 설정)' },
    { key: 'gap', words: ['과부족'], name: '과부족',
        desc: '출근한 인원에서 필요 인원을 뺀 값입니다. + 면 사람이 남았고(여유), − 면 모자랐습니다(부족).',
        calc: '출근 인원 − 필요 인원' },
    { key: 'worker', words: ['실근무 인원'], name: '실근무 인원',
        desc: '그날 업무 기록에 이름이 있는 사람 수입니다. 출근했어도 업무 기록이 없으면 빠집니다.' },
    { key: 'effective', words: ['유효 인력'], name: '유효 인력',
        desc: '평상시 속도로 일했다고 볼 때 실제로 일을 해낸 몫을 사람 수로 바꾼 것입니다. 다시 한 일(재작업)은 뺍니다.',
        calc: '실작업 필요 인원 × 품질' },
    { key: 'manhour', words: ['인시'], endCheck: true, name: '인시',
        desc: '사람 수 × 시간입니다. 예: 2명이 3시간 일하면 6인시.' },
    { key: 'manday', words: ['인일'], endCheck: true, name: '인일',
        desc: '사람 수 × 일수입니다. 예: 2명이 3일 일하면 6인일.' },
    { key: 'unitcost', words: ['건당 원가', '건당 출고원가'], name: '건당 원가',
        desc: '물건 1개를 내보내는 데 드는 비용입니다. 인건비와 플랫폼 출고 고정비는 처리 물량으로 나누고, 부자재·배송비는 설정한 개당 금액을 더합니다.',
        calc: '(원가 업무 인건비 + 플랫폼 출고 고정비) ÷ 처리 물량 + 개당 부자재 + 개당 배송비' }
]);

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const byKey = new Map(TERMS.map(t => [t.key, t]));
// 긴 글자부터 — '평상시 UPH' 가 'UPH' 보다, '건당 출고원가' 가 '건당 원가' 보다 먼저
const WORDS = TERMS.flatMap(t => t.words.map(w => ({ w, t }))).sort((a, b) => b.w.length - a.w.length);

/** key → 용어(없으면 null) */
export function termOf(key) {
    return byKey.get(String(key || '')) || null;
}

/**
 * 글자에서 처음 나오는 용어 하나 → { term, start, end } 또는 null.
 * 같은 자리에서 시작하면 긴 것, 아니면 먼저 나오는 것. 한글 용어는 앞 글자가 한글이면 건너뛴다(endCheck 면 뒤 글자도).
 */
export function findTerm(text) {
    const s = String(text == null ? '' : text);
    if (!s) return null;
    let best = null;
    for (const { w, t } of WORDS) {
        let from = 0;
        while (from <= s.length) {
            const i = s.indexOf(w, from);
            if (i < 0) break;
            const hangulWord = HANGUL.test(w[0]);
            const prev = i > 0 ? s[i - 1] : '';
            const next = s[i + w.length] || '';
            const okPrev = !(hangulWord && prev && HANGUL.test(prev)) && !(/[A-Za-z]/.test(w[0]) && /[A-Za-z]/.test(prev));
            const okNext = !(t.endCheck && next && HANGUL.test(next)) && !(/[A-Za-z]$/.test(w) && /[A-Za-z]/.test(next));
            const before = s.slice(0, i).trimEnd();
            const after = s.slice(i + w.length);
            const okCtx = !(t.notAfter || []).some(x => before.endsWith(x)) && !(t.notBefore || []).some(x => after.startsWith(x));
            if (okPrev && okNext && okCtx) {
                if (!best || i < best.start || (i === best.start && w.length > best.end - best.start)) best = { term: t, start: i, end: i + w.length };
                break;
            }
            from = i + 1;
        }
    }
    return best;
}

/** 감싸지 않을 조상 — 눌러서 동작하는 요소·입력칸·기존 i 설명·직접 끈 곳 */
export const SKIP_TAGS = Object.freeze(['BUTTON', 'A', 'LABEL', 'SUMMARY', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'SVG', 'CANVAS', 'CODE', 'PRE']);
export const SKIP_ATTRS = Object.freeze(['onclick', 'data-act', 'contenteditable', 'data-term-off']);
// 이름에 'sort' 가 든 속성(data-sort·data-sort-key·data-sort-target·data-tf-sort 등) = 정렬 머리글 — 눌러서 정렬해야 한다
const SORT_ATTR = /sort/i;
// uph-term·uph-tip = 대시보드의 기존 UPH 설명(js/uph-tooltip.js) — 겹치지 않게
export const SKIP_CLASSES = Object.freeze(['info-tip', 'term-help', 'filter-btn', 'uph-term', 'uph-tip', 'sortable', 'cursor-pointer']);

/**
 * 조상 하나의 모양 {tag, attrs:[이름], classes:[이름]} 목록(가까운 것부터) → 감싸지 않을지.
 * 화면 모듈은 글자 노드에서 body 까지 올라가며 이 모양을 만든다.
 */
export function shouldSkip(chain) {
    return (Array.isArray(chain) ? chain : []).some(n => n && (
        SKIP_TAGS.includes(String(n.tag || '').toUpperCase())
        || (n.attrs || []).some(a => SKIP_ATTRS.includes(String(a).toLowerCase()) || SORT_ATTR.test(String(a)))
        || (n.classes || []).some(c => SKIP_CLASSES.includes(c))
    ));
}
