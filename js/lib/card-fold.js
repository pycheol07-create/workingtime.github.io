// === js/lib/card-fold.js ===
// 로케이션관리 대시보드 위쪽 띠(채우기 지시서·변경 추천)의 접기/펼치기 — 카드마다 이 PC·브라우저 localStorage 에 기억.
//   기본은 접힘. localStorage 를 못 쓰면(막힘·깨짐) 접힌 상태로 둔다. Firestore 에 쓰지 않는다.
//   import 0개 — DOM 요소·저장소는 밖에서 받는다(가짜로 시험 가능, node --test 대상).

export const FOLD_PREFIX = 'locdash.fold.';
export const OPEN_TEXT = '펼치기', CLOSE_TEXT = '접기';
export const OPEN_LABEL = `${OPEN_TEXT} ▾`;
export const CLOSE_LABEL = `${CLOSE_TEXT} ▴`;

/** 저장된 펼침 상태. 'open' 일 때만 true — 없거나 못 읽으면 false(접힘) */
export function readFold(storage, id) {
    try { return !!storage && storage.getItem(FOLD_PREFIX + id) === 'open'; } catch (e) { return false; }
}

/** 펼침 상태 저장. 실패해도 예외를 내지 않는다(이번 화면에서만 적용) → 저장했으면 true */
export function writeFold(storage, id, open) {
    try {
        if (!storage) return false;
        if (open) storage.setItem(FOLD_PREFIX + id, 'open');
        else storage.removeItem(FOLD_PREFIX + id);
        return true;
    } catch (e) { return false; }
}

/** 접기 버튼 접근성 이름 — '채우기 지시서 펼치기' / '변경 추천 접기' */
export function foldAria(name, open) {
    const n = typeof name === 'string' ? name.trim() : '';
    const verb = open ? CLOSE_TEXT : OPEN_TEXT;
    return n ? `${n} ${verb}` : verb;
}

/**
 * 접기 버튼 연결. btn = <button aria-controls=panel.id>, panel = 펼칠 상자(hidden 으로 숨김), card = 상태 class 를 붙일 상자.
 * 버튼 안에 .topcard-fold-txt · .topcard-fold-ico 가 있으면 그 둘만 바꾼다(좁은 카드에서 글자를 숨겨도 화살표는 남게).
 * aria-label 은 늘 '<카드 이름> 펼치기'/'<카드 이름> 접기'(name 이 없으면 '펼치기'/'접기') — 글자를 숨겨도, 두 버튼이 나란히 있어도 구분되게.
 * onChange(open) — 펼치거나 접은 뒤 부른다(선택).  → { isOpen(), set(open) }
 */
export function initFold({ btn, panel, card, id, name, storage, onChange }) {
    let open = readFold(storage, id);
    const part = (sel) => (typeof btn.querySelector === 'function' ? btn.querySelector(sel) : null);
    const txt = part('.topcard-fold-txt'), ico = part('.topcard-fold-ico');
    const apply = () => {
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', foldAria(name, open));
        if (txt && ico) { txt.textContent = `${open ? CLOSE_TEXT : OPEN_TEXT} `; ico.textContent = open ? '▴' : '▾'; }
        else btn.textContent = open ? CLOSE_LABEL : OPEN_LABEL;
        if (card && card.classList) card.classList.toggle('is-open', open);
    };
    const set = (v) => {
        open = !!v;
        writeFold(storage, id, open);
        apply();
        if (typeof onChange === 'function') onChange(open);
    };
    apply();
    btn.addEventListener('click', () => set(!open));
    return { isOpen: () => open, set };
}
