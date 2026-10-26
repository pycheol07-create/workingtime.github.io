// 통관비 탭 [HS코드로 찾기] 패널 (2026-10-26) — 관세 칸 아래 접힘 패널.
//   자료: hs-tariff-doc.js(window.HsTariff, 'hs-tariff' 이벤트) — 패널을 처음 열 때 읽고 이 탭 메모리에 둔다.
//   검색·세율 판정: ../js/lib/hs-search.js(window.HsSearch, index.html 의 모듈이 붙인다).
//   흐름: 검색어 → 1단계 소호(6자리) 묶음 최대 30개 → 고르면 2단계 그 소호의 10자리 전부 → 세율 버튼(일반·한중FTA·RCEP)
//         → onPick(code, kind, rate, ver) — CustomsCalculator 가 관세 칸을 채우고 패널을 접는다.
//   늘 보이는 것: 관세율표 기준일 · '참고용 — 최종 확인은 관세사·UNI-PASS'.
// 이름: text/babel 의 맨 위 const 는 페이지 전역이라 다른 파일과 겹치지 않게 Hs 접두.

const HS_STATUS_TEXT = {
    idle: 'HS 자료를 불러오는 중...',
    loading: 'HS 자료를 불러오는 중...',
    missing: 'HS 자료 준비 중',
    denied: 'HS 조회는 아직 직원만 쓸 수 있습니다',
};

// window.HsTariff 상태 구독
const useHsTariff = (active) => {
    const get = () => (window.HsTariff && window.HsTariff.state) || { status: 'idle', meta: null, index: null, error: null };
    const [st, setSt] = React.useState(get);
    React.useEffect(() => {
        const on = () => setSt(get());
        window.addEventListener('hs-tariff', on);
        on();
        return () => window.removeEventListener('hs-tariff', on);
    }, []);
    // 패널이 열려 있는데 아직 안 읽었으면(처음·계정이 바뀜) 읽는다
    React.useEffect(() => {
        if (active && st.status === 'idle' && window.HsTariff) window.HsTariff.load();
    }, [active, st.status]);
    // '준비 중'·'직원만' 이었으면 패널을 다시 열 때 한 번 더 읽는다(그사이 자료가 올라왔거나 규칙이 게시됐을 수 있다)
    React.useEffect(() => {
        if (!active || !window.HsTariff) return;
        const s = window.HsTariff.state.status;
        if (s === 'missing' || s === 'denied') window.HsTariff.load({ force: true });
    }, [active]);
    return st;
};

const HsKstToday = () => {
    try { return window.CustomsFxrt.kstToday(Date.now()); } catch (e) { return ''; }
};

const HsNote = ({ children, tone = 'gray' }) => (
    <p className={`text-xs ${tone === 'warn' ? 'text-yellow-800' : 'text-gray-500'}`}>{children}</p>
);

// 세율 버튼 3개 + 안내 — 10자리 하나
const HsRateButtons = ({ row, meta, today, selected, onPick }) => {
    const H = window.HsSearch;
    const view = H.hsRateView(row.item, meta, today);
    return (
        <div className="mt-2">
            <div className="grid grid-cols-3 gap-1.5">
                {view.buttons.map(b => {
                    const on = !!selected && selected.code === row.code && selected.kind === b.kind && selected.rate === b.rate;   // 세율까지 같을 때만(관세율표가 바뀌면 꺼진다)
                    return (
                        <button key={b.kind} type="button" disabled={b.disabled}
                            onClick={() => onPick(row.code, b.kind, b.rate, meta && meta.version)}
                            data-k={`hs-rate-${b.kind}`}
                            title={b.note}
                            className={`rounded-md border px-1.5 py-1.5 text-center leading-tight transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                on ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-300 bg-white text-gray-700 hover:border-emerald-500 hover:bg-emerald-50'}`}>
                            <span className="block text-[11px] text-gray-500">{b.label}</span>
                            <span className="block text-sm font-bold">{b.rate === null ? '—' : `${b.rate}%`}</span>
                            <span className="block text-[10px] text-gray-500 truncate">{b.note}</span>
                        </button>
                    );
                })}
            </div>
            {view.notes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5" data-k="hs-notes">
                    {view.notes.map((n, i) => <li key={i} className="text-[11px] text-yellow-800">※ {n}</li>)}
                </ul>
            )}
        </div>
    );
};

const HsLookupPanel = ({ open, onToggle, selected, onPick }) => {
    const H = window.HsSearch;
    const st = useHsTariff(open);
    const [query, setQuery] = React.useState('');
    const [group, setGroup] = React.useState(null);           // 2단계로 고른 소호(6자리)
    const [fromList, setFromList] = React.useState(false);    // 2단계에 목록에서 왔는가([목록으로] 표시)
    // 검색은 입력이 300ms 멈춘 뒤에 한다(한 글자마다 1만 개를 훑지 않게)
    const [deferred, setDeferred] = React.useState('');
    React.useEffect(() => {
        const t = setTimeout(() => setDeferred(query), 300);
        return () => clearTimeout(t);
    }, [query]);
    const ok = st.status === 'ok' && st.index;
    const today = HsKstToday();

    const found = React.useMemo(() => (ok ? H.hsSearchGroups(st.index, deferred) : null), [ok, st.index, deferred]);
    // 코드 6자리 이상 → 바로 2단계 · 그 밖은 검색어가 바뀌면 1단계로
    React.useEffect(() => {
        if (!found) return;
        if (found.direct) { setGroup(found.direct); setFromList(false); }
        else setGroup(null);
    }, [found && found.direct, deferred]);
    // 처음 열 때 고른 HS 가 있으면 그 소호를 보여 준다
    React.useEffect(() => {
        if (open && ok && selected && !query) { setGroup(selected.code.slice(0, 6)); setFromList(false); }
    }, [open, ok]);
    const items = React.useMemo(() => (ok && group ? H.hsGroupItems(st.index, group) : null), [ok, st.index, group]);

    const meta = st.meta || {};
    const pick = (code, kind, rate, ver) => {
        if (rate === null || rate === undefined) return;
        onPick(code, kind, rate, ver || '');
    };

    return (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50" data-k="hs-lookup">
            <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="hs-lookup-body" className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                <span className="min-w-0">
                    <span className="block text-sm font-bold text-gray-800">HS코드로 찾기</span>
                    <span className="block text-xs text-gray-500 mt-0.5 truncate" data-k="hs-summary">
                        {selected ? `${H.hsRateText(selected)} 적용 중` : '품명이나 HS코드로 관세율을 찾아 칸에 넣습니다'}
                    </span>
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 flex-shrink-0 text-gray-400 transform transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {open && (
                <div id="hs-lookup-body" className="px-4 pb-4 space-y-3">
                    <p className="text-xs text-gray-500" data-k="hs-basis">
                        {ok && meta.ruleDate ? `기준 ${meta.ruleDate} 관세율표 (출처 관세청) · ` : ''}
                        <span className="font-semibold text-yellow-800">참고용 — 최종 확인은 관세사·UNI-PASS</span>
                    </p>

                    {!ok && (
                        <div role="status" className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-gray-600 flex items-center justify-between gap-2" data-k="hs-status" data-status={st.status}>
                            <span>{st.status === 'error' ? `HS 자료를 불러오지 못했습니다${st.error ? ` (${st.error})` : ''}` : HS_STATUS_TEXT[st.status] || HS_STATUS_TEXT.idle}</span>
                            {st.status === 'error' && (
                                <button type="button" onClick={() => window.HsTariff && window.HsTariff.load({ force: true })} className="flex-shrink-0 px-3 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-100">다시 시도</button>
                            )}
                        </div>
                    )}

                    {ok && (
                        <>
                            <div>
                                <label htmlFor="hs-query" className="sr-only">품명 또는 HS코드</label>
                                <input id="hs-query" type="search" data-enter-skip="1" autoComplete="off" value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                                    placeholder="품명 또는 HS코드 (예: 티셔츠, T-shirt, 6109.10)"
                                    className="w-full rounded-md border-gray-300 py-2 px-3 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm" />
                            </div>

                            {/* 2단계 — 소호의 10자리 전부 */}
                            {items ? (
                                <div data-k="hs-step2">
                                    {fromList && (
                                        <button type="button" onClick={() => setGroup(null)} className="mb-2 text-xs font-semibold text-emerald-600 hover:text-emerald-700">← 목록으로</button>
                                    )}
                                    <div className="mb-2">
                                        <p className="text-sm font-bold text-gray-800">{H.hsFormatCode(items.code6)} {items.n6 || items.n4}</p>
                                        {items.n4 && items.n6 && <p className="text-xs text-gray-500 line-clamp-2">{H.hsFormatCode(items.code6.slice(0, 4))} {items.n4}</p>}
                                    </div>
                                    <ul className="space-y-2">
                                        {items.rows.map(r => (r.type === 'head' ? (
                                            <li key={`h${r.code}`} className="pt-1 text-xs font-semibold text-gray-600" style={{ paddingLeft: `${r.depth * 12}px` }}>
                                                {H.hsFormatCode(r.code)} {r.name}
                                            </li>
                                        ) : (
                                            <li key={r.code} data-k="hs-item" data-code={r.code}
                                                className={`rounded-lg border bg-white p-2.5 ${selected && selected.code === r.code ? 'border-emerald-500' : 'border-slate-200'}`}
                                                style={{ marginLeft: `${r.depth * 12}px` }}>
                                                <p className="text-sm text-gray-800"><span className="font-mono font-semibold">{H.hsFormatCode(r.code)}</span> {r.name}</p>
                                                {r.nameEn && <p className="text-[11px] text-gray-500">{r.nameEn}</p>}
                                                <HsRateButtons row={r} meta={meta} today={today} selected={selected} onPick={pick} />
                                            </li>
                                        )))}
                                    </ul>
                                </div>
                            ) : found && deferred.trim() ? (
                                /* 1단계 — 소호 묶음 */
                                <div data-k="hs-step1">
                                    {found.tooMany && (
                                        <HsNote tone="warn">결과가 {found.total.toLocaleString('ko-KR')}개로 많아 위 {found.groups.length}개만 보입니다 — 더 자세히 입력하세요</HsNote>
                                    )}
                                    {!found.groups.length ? (
                                        <HsNote>찾은 것이 없습니다 — 다른 말이나 HS코드 앞자리로 찾아 보세요</HsNote>
                                    ) : (
                                        <ul className="space-y-1.5">
                                            {found.groups.map(g => (
                                                <li key={g.code6}>
                                                    <button type="button" onClick={() => { setGroup(g.code6); setFromList(true); }} data-k="hs-group" data-code={g.code6}
                                                        className="w-full text-left rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-emerald-500 hover:bg-emerald-50">
                                                        <span className="block text-sm text-gray-800"><span className="font-mono font-semibold">{H.hsFormatCode(g.code6)}</span> {g.n6 || g.n4} <span className="text-xs text-gray-500">· {g.count}개</span></span>
                                                        <span className="block text-[11px] text-gray-500 truncate">{g.n4}{g.n2 ? ` — ${g.n2}` : ''}</span>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ) : (
                                <HsNote>품명(한글·영문)이나 HS코드를 입력하세요. 6자리 이상 코드는 바로 세부 목록이 나옵니다.</HsNote>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
