// === js/inspection-segments.js ===
// 설명: 샘플검수 창 체크리스트의 '선택 버튼'.
//   select(data-seg, sr-only)는 값 보관용으로 그대로 두고(저장·판정·이전 기록 불러오기가 select 값을 쓴다),
//   option 마다 큰 버튼을 만들어 누르면 select 값을 바꾸고 change 이벤트를 보낸다.
//   코드가 select 값을 직접 바꾼 뒤에는 syncInspSegments() 로 버튼 표시를 다시 맞춘다.

import { ALL_NORMAL, hasBrushed } from './lib/insp-flow.js?v=202611240908';

const BTN_BASE = 'insp-seg-btn border rounded-lg text-sm font-bold px-3 py-2 min-h-[44px] transition';
const BTN_ON = ['bg-indigo-600', 'border-indigo-600', 'text-white'];
const BTN_OFF = ['bg-white', 'border-gray-300', 'text-gray-700', 'hover:bg-gray-50'];

const modalRoot = () => document.getElementById('inspection-manager-modal');

const segSelects = () => {
    const root = modalRoot();
    return root ? Array.from(root.querySelectorAll('select[data-seg]')) : [];
};

const buttonBox = (sel) => {
    const root = modalRoot();
    return root ? root.querySelector(`[data-seg-buttons="${sel.dataset.seg}"]`) : null;
};

const clearMissing = (sel) => {
    const field = sel.closest('[data-insp-field]');
    if (field) field.classList.remove('insp-missing');
};

const setSelectValue = (sel, value) => {
    sel.value = value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    clearMissing(sel);
};

const paint = (sel) => {
    const box = buttonBox(sel);
    if (!box) return;
    box.querySelectorAll('button[data-value]').forEach(btn => {
        const on = btn.dataset.value === sel.value;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.remove(...(on ? BTN_OFF : BTN_ON));
        btn.classList.add(...(on ? BTN_ON : BTN_OFF));
    });
};

/** 기모 칸 — 상품명에 '기모'가 있을 때만 보인다. 숨길 때는 값도 비운다(저장·'모두 정상'·바뀐 내용 비교에 안 섞이게). */
export function syncBrushedField(name) {
    const field = document.getElementById('insp-brushed-field');
    if (!field) return;
    const nm = name !== undefined ? name : (document.getElementById('insp-product-name')?.value || '');
    const show = hasBrushed(nm);
    field.classList.toggle('hidden', !show);
    if (!show) {
        const sel = document.getElementById('insp-check-brushed');
        if (sel && sel.value) sel.value = '';
        field.classList.remove('insp-missing');
    }
}

/** select 값으로 버튼 상태를 다시 그린다(폼 초기화·이전 기록 불러오기 뒤에 부른다). 기모 칸 보이기도 같이 맞춘다. */
export function syncInspSegments() {
    syncBrushedField();
    segSelects().forEach(paint);
}

/** 버튼을 만든다(한 번만). 창 HTML 이 로드된 뒤 부른다. */
export function initInspSegments() {
    segSelects().forEach(sel => {
        const box = buttonBox(sel);
        if (!box || box.dataset.segReady) return;
        box.dataset.segReady = '1';

        Array.from(sel.options).forEach(opt => {
            if (!opt.value) return; // '선택...' 자리표시
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = BTN_BASE;
            btn.dataset.value = opt.value;
            btn.textContent = opt.value;
            const label = (opt.textContent || '').trim();
            if (label && label !== opt.value) btn.title = label; // 긴 설명은 title 로
            btn.addEventListener('click', () => {
                setSelectValue(sel, opt.value);
                paint(sel);
            });
            box.appendChild(btn);
        });

        // 키보드·다른 코드로 select 가 바뀌어도 표시를 맞춘다
        sel.addEventListener('change', () => paint(sel));
        paint(sel);
    });

    // 상품명을 직접 고칠 때도 기모 칸을 바로 맞춘다
    const nameInput = document.getElementById('insp-product-name');
    if (nameInput && !nameInput.dataset.brushedBound) {
        nameInput.dataset.brushedBound = '1';
        nameInput.addEventListener('input', () => syncBrushedField());
    }

    const allNormalBtn = document.getElementById('insp-all-normal-btn');
    if (allNormalBtn && !allNormalBtn.dataset.segReady) {
        allNormalBtn.dataset.segReady = '1';
        allNormalBtn.addEventListener('click', () => {
            // 두께(thickness)는 ALL_NORMAL 에 없어서 건드리지 않는다
            segSelects().forEach(sel => {
                const field = sel.closest('[data-insp-field]');
                if (field && field.classList.contains('hidden')) return;   // 숨은 칸(기모 아닌 상품의 기모)은 채우지 않는다
                const v = ALL_NORMAL[sel.dataset.seg];
                if (v === undefined) return;
                if (!Array.from(sel.options).some(o => o.value === v)) return; // option 에 없는 값은 넣지 않는다
                setSelectValue(sel, v);
            });
            syncInspSegments();
        });
    }
}
