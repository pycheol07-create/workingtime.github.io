// [수정됨] 4가지 환율을 모두 관리하도록 상태 구조 변경

// 보던 탭을 주소 뒤 해시(#tab=import|customs|shipping|warehouse)에 기억한다 — 새로고침·Ctrl+K 빠른 이동(UI 1단계 1c).
// window.HashState 는 ../js/hash-state.js(모듈)가 붙인다. 없으면(불러오기 실패) 예전처럼 '수입가' 로 시작하고 기억하지 않는다.
const CALC_TAB_IDS = ['import', 'customs', 'shipping', 'warehouse'];
const calcTabFromHash = () => {
    const t = window.HashState ? window.HashState.readHash().tab : null;
    return CALC_TAB_IDS.includes(t) ? t : null;
};

const App = () => {
    const [activeTabId, setActiveTabId] = React.useState(() => calcTabFromHash() || 'import');

    // 탭이 바뀌면(버튼·스와이프) 해시를 고친다(기록 안 쌓임). 해시로 들어오면(Ctrl+K·뒤로가기) 그 탭으로.
    React.useEffect(() => {
        if (window.HashState) window.HashState.writeHash({ tab: activeTabId }, { replace: true });
    }, [activeTabId]);
    React.useEffect(() => {
        if (!window.HashState) return undefined;
        return window.HashState.onHashNav(() => setActiveTabId(calcTabFromHash() || 'import'));
    }, []);
    
    // [수정됨] 환율 데이터를 하나의 객체로 통합 관리
    // 관세청 고시환율(customs)은 관세청 자동값이 채운다(2026-10-16, customs-fxrt-doc.js → js/lib/customs-fxrt.js).
    //   출처 customsOrigin = { by:'auto', start, end } | { by:'manual' } 를 같이 저장한다 — 지난주 자동값은 열 때 비운다.
    //   첫 사용자 기본값은 빈칸(예전 '1350' 은 실제 고시값처럼 보이는 가짜 값이었다 — 자동값 또는 '고시환율을 입력하세요').
    const [exchangeRates, setExchangeRates] = React.useState(() => {
        let saved = null;
        try {
            const s = localStorage.getItem('appExchangeRatesData');
            if (s) saved = JSON.parse(s);
        } catch(e){}
        const init = window.CustomsFxrt.initialCustoms(saved, window.CustomsFxrt.kstToday(Date.now()));
        if (saved && typeof saved === 'object') return { ...saved, customs: init.customs, customsOrigin: init.origin };
        return {
            mode: 'fixed',
            customs: '',
            usdKrw: '1350',
            cnyKrw: '190',
            usdCny: '0.14',
            customsOrigin: null
        };
    });
    const [isAdminOpen, setIsAdminOpen] = React.useState(false);

    // 환율 데이터가 변경될 때마다 로컬 스토리지에 저장
    React.useEffect(() => {
        localStorage.setItem('appExchangeRatesData', JSON.stringify(exchangeRates));
    }, [exchangeRates]);

    // 관세청 고시환율 자동값 — 모듈이 먼저 끝났을 수도, 나중에 끝날 수도 있다(지금 값 확인 + 이벤트 구독)
    const [fxState, setFxState] = React.useState(() => window.__customsFxrt || { status: 'loading', doc: null });
    React.useEffect(() => {
        const on = (e) => setFxState((e && e.detail) || window.__customsFxrt);
        window.addEventListener('customs-fxrt', on);
        if (window.__customsFxrt) setFxState(window.__customsFxrt);
        return () => window.removeEventListener('customs-fxrt', on);
    }, []);
    // 오늘(한국 날짜) — 1분마다·탭이 다시 보일 때 다시 본다. 문서 이벤트가 안 와도(Firebase 를 못 받아도)
    //   열어 둔 탭에서 주가 넘어가면 아래 fillAuto 가 지난주 자동값을 비운다(같은 날이면 상태가 안 바뀌어 다시 그리지 않는다).
    const [today, setToday] = React.useState(() => window.CustomsFxrt.kstToday(Date.now()));
    React.useEffect(() => {
        const check = () => setToday(window.CustomsFxrt.kstToday(Date.now()));
        const onVis = () => { if (document.visibilityState === 'visible') check(); };
        const t = setInterval(check, 60 * 1000);
        document.addEventListener('visibilitychange', onVis);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
    }, []);
    // 이번 주 값인지는 문서가 올 때·날짜가 바뀔 때 오늘로 판정한다
    const fx = React.useMemo(() => window.CustomsFxrt.resolveFxrt(fxState.status === 'ok' ? fxState.doc : null, today), [fxState, today]);
    const customsTouchedRef = React.useRef(false);     // 이번 세션(페이지를 연 뒤)에 사람이 고시환율 칸을 고쳤나 — 고쳤으면 덮지 않는다
    const fillAuto = React.useCallback((touched) => {
        setExchangeRates(prev => {
            const r = window.CustomsFxrt.applyAuto({ customs: prev.customs, origin: prev.customsOrigin, touched }, fx, today);
            return r.changed ? { ...prev, customs: r.customs, customsOrigin: r.origin } : prev;
        });
    }, [fx, today]);
    React.useEffect(() => { fillAuto(customsTouchedRef.current); }, [fillAuto]);
    // [고시값으로] — 자동값으로 되돌리고 다시 자동 채움을 받는다
    const resetCustoms = React.useCallback(() => {
        customsTouchedRef.current = false;
        fillAuto(false);
    }, [fillAuto]);

    // 환율 개별 업데이트 핸들러
    const handleRateChange = (field, value) => {
        if (field === 'customs') {
            customsTouchedRef.current = true;
            setExchangeRates(prev => ({ ...prev, customs: value, customsOrigin: { by: 'manual' } }));
            return;
        }
        setExchangeRates(prev => ({ ...prev, [field]: value }));
    };
    // 고시환율 칸 아래 표시줄(자동·직접 입력·[고시값으로]·노란 안내) — 수입가·통관비 탭, 칩 출처는 세 탭
    const customsInfo = React.useMemo(() => window.CustomsFxrt.customsView(
        { customs: exchangeRates.customs, origin: exchangeRates.customsOrigin, touched: customsTouchedRef.current }, fx, fxState.status),
        [exchangeRates.customs, exchangeRates.customsOrigin, fx, fxState.status]);
    
    // short: 휴대폰 탭 이름(한 줄) · title: 넓은 화면 '… 계산기'
    const tabs = React.useMemo(() => [
        {
            id: 'import',
            title: '수입가', short: '수입가',
            component: <ImportCalculator exchangeRates={exchangeRates} onRateChange={handleRateChange} customsInfo={customsInfo} onCustomsReset={resetCustoms} />
        },
        {
            id: 'customs',
            title: '통관비', short: '통관비',
            component: <CustomsCalculator exchangeRates={exchangeRates} onRateChange={handleRateChange} isActive={activeTabId === 'customs'} customsInfo={customsInfo} onCustomsReset={resetCustoms} />
        },
        {
            id: 'shipping',
            title: '선적', short: '선적',
            component: <ShippingCalculator />
        },
        {
            id: 'warehouse',
            title: '창고료&가산세', short: '창고료',
            component: <WarehouseFeeCalculator exchangeRates={exchangeRates} customsSource={customsInfo.source === 'auto' ? 'auto' : 'manual'} />
        },
    ], [exchangeRates, activeTabId, customsInfo, resetCustoms]);

    // --- Swipe Logic ---
    const touchStartX = React.useRef(null); const touchDeltaX = React.useRef(0); const [isSwiping, setIsSwiping] = React.useState(false);
    const activeTabIndex = React.useMemo(() => tabs.findIndex(tab => tab.id === activeTabId), [tabs, activeTabId]);
    // 스와이프 예외: 입력·버튼·링크·라벨(세그먼트 선택) 위, 가로 스크롤 영역(관세율 칸·표) 안
    const handleTouchStart = (e) => { if (['INPUT', 'SELECT', 'BUTTON', 'A', 'LABEL'].includes(e.target.tagName) || e.target.closest('[role="button"], label, .overflow-x-auto')) return; touchStartX.current = e.touches[0].clientX; touchDeltaX.current = 0; setIsSwiping(true); };
    const handleTouchMove = (e) => { if (!isSwiping || touchStartX.current === null) return; touchDeltaX.current = e.touches[0].clientX - touchStartX.current; };
    const handleTouchEnd = () => { if (!isSwiping) return; const swipeThreshold = 50; if (Math.abs(touchDeltaX.current) > swipeThreshold) { if (touchDeltaX.current < 0) { if (activeTabIndex < tabs.length - 1) setActiveTabId(tabs[activeTabIndex + 1].id); } else { if (activeTabIndex > 0) setActiveTabId(tabs[activeTabIndex - 1].id); } } setIsSwiping(false); touchStartX.current = null; touchDeltaX.current = 0; };
    // --- End Swipe Logic ---

    const tabStyles = "flex-1 min-w-0 py-2.5 px-2 sm:px-4 text-center text-sm font-semibold whitespace-nowrap rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors";

    // 탭마다 제 높이 — 보이는 탭 높이로 main 을 맞춘다(짧은 탭 아래 빈 공간 없음)
    const panelRefs = React.useRef({});
    const [panelHeight, setPanelHeight] = React.useState(null);
    React.useLayoutEffect(() => {
        const el = panelRefs.current[activeTabId];
        if (!el) return undefined;
        const update = () => setPanelHeight(el.offsetHeight);
        update();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [activeTabId]);

    // 탭 목록 키보드: ←/→ 로 옆 탭
    const handleTabKeyDown = (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = (activeTabIndex + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        setActiveTabId(tabs[next].id);
        const btn = document.getElementById(`calc-tab-${tabs[next].id}`);
        if (btn) btn.focus();
    };
    const activeTabStyles = "bg-white text-emerald-700";
    const inactiveTabStyles = "text-slate-600 hover:text-slate-900";
    
    const dragOffset = isSwiping ? touchDeltaX.current : 0;
    const transformValue = `translateX(calc(-${activeTabIndex * 100}% + ${dragOffset}px))`;

    return (
        <SettingsProvider>
            {isAdminOpen && <AdminPage onClose={() => setIsAdminOpen(false)} />}
            
            <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
                <div className="w-full max-w-6xl mx-auto flex flex-col h-full relative">
                    <button onClick={() => setIsAdminOpen(true)} className="absolute top-0 right-0 p-2 text-gray-400 hover:text-gray-600" title="설정 관리">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                    <header className="text-center mb-6"><h1 className="text-2xl sm:text-3xl font-bold text-gray-900">비용 계산기</h1><p className="mt-1 text-sm text-slate-500">수입에 필요한 비용을 간편하게 계산해보세요.</p></header>
                    <div className="w-full max-w-4xl mx-auto"><div role="tablist" aria-label="계산기 종류" onKeyDown={handleTabKeyDown} className="flex mb-4 p-1 bg-slate-200/60 rounded-full">{tabs.map(tab => (<button key={tab.id} id={`calc-tab-${tab.id}`} role="tab" aria-controls={`calc-panel-${tab.id}`} tabIndex={activeTabId === tab.id ? 0 : -1} onClick={() => setActiveTabId(tab.id)} className={`${tabStyles} ${activeTabId === tab.id ? activeTabStyles : inactiveTabStyles}`} aria-selected={activeTabId === tab.id}><span className="sm:hidden">{tab.short}</span><span className="hidden sm:inline">{tab.title} 계산기</span></button>))}</div></div>
                    <main className="w-full overflow-hidden" style={{ height: panelHeight ? `${panelHeight}px` : undefined }} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}><div className="flex items-start" style={{ transform: transformValue, transition: isSwiping ? 'none' : 'transform 0.4s cubic-bezier(0.4, 0.2, 1)' }}>{tabs.map(tab => (<div key={tab.id} id={`calc-panel-${tab.id}`} role="tabpanel" aria-labelledby={`calc-tab-${tab.id}`} aria-hidden={activeTabId === tab.id ? undefined : true} inert={activeTabId === tab.id ? undefined : ''} ref={el => { panelRefs.current[tab.id] = el; }} className="w-full flex-shrink-0">{tab.component}</div>))}</div></main>
                </div>
            </div>
        </SettingsProvider>
    );
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");
const root = ReactDOM.createRoot(rootElement);
root.render(<React.StrictMode><App /></React.StrictMode>);