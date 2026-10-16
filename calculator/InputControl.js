// 'import React'와 'export' 키워드를 모두 삭제합니다.

// 숫자 칸 공통 파서 — ../js/lib/calc-num.js (index.html 의 모듈이 window.CalcNum 에 붙인다).
// 쉼표만 빼고 parseFloat / parseInt(…, 10) 와 똑같이 읽는다. 계산기 탭·효율분석·설정 화면의 숫자 읽기는 모두 이 둘로 한다
// (tests/calc-num.test.js 가 calculator/*.js 에 parseFloat/parseInt 직접 호출이 남았는지 본다).
const parseNum = (v) => window.CalcNum.parseNum(v);
const parseIntNum = (v) => window.CalcNum.parseIntNum(v);

// 옵션 목록(공용 설정)이 바뀌어 지금 고른 값이 목록에 없으면 첫 옵션으로 옮기고 잠깐 안내한다.
//   fields: [{ name, label, options }] — formData[name] 이 options[].value 중 하나여야 한다(문자열로 비교).
//   → 안내 글(없으면 null). 안내는 몇 초 뒤 사라진다(<OptionFixNotice>).
const useOptionFix = (fields, formData, setFormData) => {
    const [notice, setNotice] = React.useState(null);
    const sig = JSON.stringify(fields.map(f => [f.name, (f.options || []).map(o => String(o.value))]));
    const cur = JSON.stringify(fields.map(f => String(formData[f.name])));
    React.useEffect(() => {
        const fixes = {};
        const msgs = [];
        fields.forEach(f => {
            const opts = f.options || [];
            if (!opts.length) return;
            if (opts.some(o => String(o.value) === String(formData[f.name]))) return;
            fixes[f.name] = String(opts[0].value);
            msgs.push(`${f.label} → ${opts[0].label}`);
        });
        if (!msgs.length) return;
        setFormData(prev => ({ ...prev, ...fixes }));
        setNotice(`설정의 옵션 목록이 바뀌어 첫 옵션으로 바꿨습니다: ${msgs.join(', ')}`);
    }, [sig, cur]);
    React.useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(t);
    }, [notice]);
    return notice;
};

const OptionFixNotice = ({ text }) => (text ? (
    <div role="status" className="mb-4 p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-sm text-yellow-800">{text}</div>
) : null);

// --- From components/InputControl.tsx ---
// 숫자 칸: type="text" + inputMode="decimal"(휴대폰 숫자 자판, 마우스 휠로 값이 바뀌지 않음).
//   포커스가 빠지면 천 단위 쉼표로 보이기만 하고(formatThousands), 입력값(value)은 친 글자 그대로다 → 읽을 때 parseNum.
// id: 같은 name 이 여러 탭에 있으면 따로 준다(label htmlFor) · ariaLabel: 보이는 label 이 없는 칸
// disabled · hint(칸 아래 안내 — 예: logis 평균 · [평균으로])
// 잘못된 칸 표시(빨간 테두리) — calc-d.css 의 #calc-root 입력칸 테두리 규칙(ID 명시도)을 이기도록 인라인 스타일. 설정 화면도 같이 쓴다.
const BAD_INPUT_STYLE = { borderColor: 'var(--c-risk, #C9808A)', boxShadow: '0 0 0 1px var(--c-risk, #C9808A)' };

const InputControl = ({ label, name, value, onChange, unit, placeholder, icon, onKeyDown, type = "text", hint, disabled, ariaLabel, id }) => {
  const [focused, setFocused] = React.useState(false);
  const inputId = id || name;
  const isNumText = type === "text";
  // '0,14' 처럼 쉼표를 소수점으로 친 칸 — parseNum 이 NaN 으로 읽으므로 빨갛게 표시하고 안내한다
  const badCommas = isNumText && window.CalcNum.hasBadCommas(value);
  const shown = (isNumText && !focused) ? window.CalcNum.formatThousands(value) : (value ?? '');
  // 포커스가 들어오면 쉼표 없는 원래 글자로 바로(flushSync) 바꾸고 전체 선택한다 — 글자가 바뀌면 선택·커서가 풀려
  // 새로 친 숫자가 옛 값 뒤에 붙기 때문(계산기 칸은 '눌러서 새 숫자 입력'이 대부분). 고치려면 한 번 더 눌러 커서를 놓는다.
  // select() 가 포커스보다 늦게 끝나는 경우가 있어 마이크로태스크에서 한 번 더 고른다.
  const handleFocus = (e) => {
    const el = e.target;
    if (isNumText && el.value !== String(value ?? '')) {
      ReactDOM.flushSync(() => setFocused(true));
      el.select();
      Promise.resolve().then(() => { if (document.activeElement === el) el.select(); });
    } else {
      setFocused(true);
    }
  };
  return (
    <div>
      {label ? (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {icon}
        </div>
        <input
          type={type}
          inputMode={isNumText ? "decimal" : undefined}
          autoComplete="off"
          id={inputId}
          name={name}
          value={shown}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={() => setFocused(false)}
          placeholder={placeholder || "0"}
          disabled={!!disabled}
          aria-label={ariaLabel || undefined}
          aria-invalid={badCommas || undefined}
          aria-describedby={badCommas ? `${inputId}-comma-err` : undefined}
          style={badCommas ? BAD_INPUT_STYLE : undefined}
          className="w-full rounded-md border-gray-300 py-2 pl-10 pr-12 sm:pr-16 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <span className="text-gray-500 sm:text-sm">{unit}</span>
        </div>
      </div>
      {badCommas && (
        <p id={`${inputId}-comma-err`} className="mt-1 text-xs font-semibold text-red-600" data-k="comma-error">
          쉼표(,)는 천 단위에만 씁니다 — 소수는 쉼표 대신 점(.)으로 입력하세요 (예: 0.14)
        </p>
      )}
      {hint}
    </div>
  );
};
