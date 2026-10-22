// 계산기 탭 공통 도구(2026-10-22) — 입력값 기억 · [결과 복사] · [입력 초기화]
// 이름: text/babel 의 맨 위 const 는 페이지 전역이라 다른 파일과 겹치지 않게 calc/Calc 접두.
//
// 입력값 기억: 탭마다 localStorage 'calc.inputs.v1.<탭 id>'(app.js CALC_TAB_IDS 와 같은 id)에 사람이 친 칸만 둔다.
//   - 값은 문자열·참거짓만 받는다(모양이 다른 옛 값·망가진 값은 버리고 기본값).
//   - 기본값과 같으면 지운다 → 손대지 않은 탭은 저장이 없다.
//   - 환율(appExchangeRatesData, app.js)·공용 설정값·logis 평균(손대지 않은 칸)은 여기 넣지 않는다 — 서버 값이 먼저다.
//   - localStorage 를 못 쓰면(사생활 보호 모드·용량) 조용히 기억만 안 한다. 계산은 그대로.

const CALC_MEM_PREFIX = 'calc.inputs.v1.';

// 저장된 값 중 keys 에 있는 것만(문자열·참거짓) — 없거나 깨졌으면 {}
const calcMemLoad = (tab, keys) => {
    try {
        const raw = localStorage.getItem(CALC_MEM_PREFIX + tab);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
        const out = {};
        keys.forEach(k => {
            const v = obj[k];
            if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
        });
        return out;
    } catch (e) {
        return {};
    }
};

// obj 를 저장한다. base(기본값)와 칸·값이 모두 같으면 저장 대신 지운다.
const calcMemSave = (tab, obj, base) => {
    try {
        const keys = Object.keys(obj);
        const same = base && keys.length === Object.keys(base).length && keys.every(k => base[k] === obj[k]);
        if (same) localStorage.removeItem(CALC_MEM_PREFIX + tab);
        else localStorage.setItem(CALC_MEM_PREFIX + tab, JSON.stringify(obj));
    } catch (e) { /* 기억 못 해도 계산기는 그대로 */ }
};

const calcMemClear = (tab) => {
    try { localStorage.removeItem(CALC_MEM_PREFIX + tab); } catch (e) { /* 무시 */ }
};

// obj 에서 keys 만 뽑는다(저장·비교용)
const calcMemPick = (obj, keys) => {
    const out = {};
    keys.forEach(k => { out[k] = obj[k]; });
    return out;
};

// --- 결과 복사 ---
// 숫자 칸 글자 → 천 단위 쉼표(빈칸이면 '-')
const calcCopyNum = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return '-';
    try { return window.CalcNum.formatThousands(s); } catch (e) { return s; }
};
// 옵션 값 → 화면 이름(목록에 없으면 값 그대로)
const calcCopyOpt = (options, value) => {
    const o = (options || []).find(x => String(x.value) === String(value));
    return o ? String(o.label) : String(value ?? '-');
};
// 머리줄 '[수입가 계산] 2026-10-22 15:30'
const calcCopyHead = (title) => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `[${title}] ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

// 클립보드에 글자를 넣는다 → 성공 여부. navigator.clipboard(https·localhost) 가 안 되면 숨긴 textarea + execCommand.
const calcCopyText = async (text) => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) { /* 아래 대체 방법으로 */ }
    let ta = null;
    try {
        ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        return !!document.execCommand('copy');
    } catch (e) {
        return false;
    } finally {
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    }
};

const CALC_TOOL_BTN = 'inline-flex items-center gap-1 flex-shrink-0 px-3 py-1.5 rounded-lg border text-xs sm:text-sm font-semibold transition-colors';

// [결과 복사] — getText() 가 만든 글자를 복사하고 2초 동안 '복사됨' / '복사 실패'
const CalcCopyButton = ({ getText }) => {
    const [state, setState] = React.useState(null);     // null | 'ok' | 'fail'
    React.useEffect(() => {
        if (!state) return undefined;
        const t = setTimeout(() => setState(null), 2000);
        return () => clearTimeout(t);
    }, [state]);
    const onClick = async () => {
        let ok = false;
        try { ok = await calcCopyText(getText()); } catch (e) { ok = false; }
        setState(ok ? 'ok' : 'fail');
    };
    const tone = state === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : state === 'fail' ? 'bg-red-50 border-slate-200 text-red-600'
        : 'bg-white border-slate-300 text-gray-700 hover:bg-gray-100';
    return (
        <>
            <button type="button" onClick={onClick} data-k="calc-copy" className={`${CALC_TOOL_BTN} ${tone}`} title="주요 입력값과 결과를 글자로 복사합니다">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={state === 'ok' ? 'M5 13l4 4L19 7' : 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'} /></svg>
                <span>{state === 'ok' ? '복사됨' : state === 'fail' ? '복사 실패' : '결과 복사'}</span>
            </button>
            <span role="status" className="sr-only">{state === 'ok' ? '결과를 복사했습니다' : state === 'fail' ? '복사하지 못했습니다' : ''}</span>
        </>
    );
};

// [입력 초기화] — 확인 한 번 뒤 onReset(). note: 확인창 둘째 줄
const CalcResetButton = ({ onReset, note }) => {
    const onClick = () => {
        const msg = `이 탭의 입력값을 처음 값으로 되돌릴까요?\n기억해 둔 입력값도 지웁니다.${note ? `\n${note}` : ''}`;
        if (window.confirm(msg)) onReset();
    };
    return (
        <button type="button" onClick={onClick} data-k="calc-reset" className={`${CALC_TOOL_BTN} bg-white border-slate-300 text-gray-600 hover:bg-gray-100`} title="이 탭의 입력값을 처음 값으로 되돌립니다">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            <span>입력 초기화</span>
        </button>
    );
};
