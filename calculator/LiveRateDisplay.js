// 'import React'와 'export' 키워드를 모두 삭제합니다.

// --- 실시간 환율 (수입가·통관비 탭이 같이 쓴다) ---
// exchangerate-api.com(USD 기준) 을 페이지에서 한 번만 부른다. at = API 의 갱신 시각(time_last_updated, 없으면 받은 시각).
// 실패하면 각 탭이 예전처럼 고정환율 칸 값을 쓰고, 결과 카드에 '고정값 사용 중' 배지를 띄운다(AppliedRateChip).
const LIVE_RATE_SOURCE = 'exchangerate-api.com';
let liveRatePromise = null;
const fetchLiveRatesOnce = () => {
    if (!liveRatePromise) {
        liveRatePromise = fetch('https://api.exchangerate-api.com/v4/latest/USD')
            .then(response => {
                if (!response.ok) throw new Error('API response was not ok');
                return response.json();
            })
            .then(data => {
                if (!(data && data.rates && data.rates.KRW && data.rates.CNY)) throw new Error('Invalid data format');
                const t = Number(data.time_last_updated);
                return { krw: data.rates.KRW, cny: data.rates.CNY, at: (Number.isFinite(t) && t > 0) ? t * 1000 : Date.now() };
            });
    }
    return liveRatePromise;
};
const useLiveRates = () => {
    const [liveRates, setLiveRates] = React.useState({ krw: null, cny: null, at: null });
    const [rateStatus, setRateStatus] = React.useState('loading');
    React.useEffect(() => {
        let alive = true;
        fetchLiveRatesOnce()
            .then(v => { if (alive) { setLiveRates(v); setRateStatus('success'); } })
            .catch(error => { console.warn('실시간 환율 불러오기 실패 — 고정환율을 씁니다:', error && error.message ? error.message : error); if (alive) setRateStatus('error'); });
        return () => { alive = false; };
    }, []);
    return { liveRates, rateStatus };
};

// 지금 적용되는 송금 환율의 출처 — 실시간을 골랐어도 값이 없으면(불러오는 중·실패) 고정값이 쓰인다
const liveRateState = (exchangeRates, liveRates, rateStatus) => {
    const wantLive = exchangeRates.mode === 'live';
    const liveOk = wantLive && !!(liveRates.krw && liveRates.cny);
    return {
        wantLive, liveOk, at: liveRates.at,
        liveFailed: wantLive && !liveOk && rateStatus === 'error',
        liveLoading: wantLive && !liveOk && rateStatus !== 'error',
    };
};
const fmtRate = (v) => (typeof v === 'number' && Number.isFinite(v)) ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(v) : '-';
const fmtRateTime = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const p2 = (n) => String(n).padStart(2, '0');
    const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    return d.toDateString() === new Date().toDateString() ? hm : `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${hm}`;
};
// 고시환율 출처 — 'auto'(관세청 자동, app.js customsInfo.source) | 그 밖(직접입력)
const customsSourceText = (customsSource) => (customsSource === 'auto' ? '관세청 자동' : '직접입력');

// 접힌 환율 칸의 한 줄 요약 — '적용 환율: 고시 ○ (관세청 자동|직접입력) / 송금 ○ (고정|실시간 HH:MM)'
const rateSummaryText = (customs, usdKrw, st, customsSource = 'manual') =>
    `적용 환율: 고시 ${fmtRate(customs)} (${customsSourceText(customsSource)}) / 송금 ${fmtRate(usdKrw)} (${st.liveOk ? `실시간 ${fmtRateTime(st.at)}` : st.wantLive ? '고정값 사용 중' : '고정'})`;

// 결과 카드의 '적용 환율' 칩 — 고시(관세청 자동|직접입력) / 송금(실시간 시각·출처 또는 고정). 실시간 실패·대기 중이면 노란 배지.
const AppliedRateChip = ({ customs, usdKrw, cnyKrw, state, showRemit = true, customsSource = 'manual' }) => (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs" data-k="rate-chip">
        <span className="inline-flex flex-wrap items-center justify-center gap-x-1 px-3 py-1 rounded-full bg-slate-100 text-slate-600">
            <span className="font-semibold">적용 환율</span>
            <span>· 고시 {fmtRate(customs)} ({customsSourceText(customsSource)})</span>
            {showRemit && <span>· 송금 {fmtRate(usdKrw)}{cnyKrw !== undefined ? ` / 위안 ${fmtRate(cnyKrw)}` : ''} ({state.liveOk ? `실시간 ${fmtRateTime(state.at)} · ${LIVE_RATE_SOURCE}` : '고정'})</span>}
        </span>
        {showRemit && (state.liveFailed || state.liveLoading) && (
            <span className="px-2 py-1 rounded-full border border-yellow-300 bg-yellow-50 text-yellow-800 font-semibold" data-k="rate-fallback">
                {state.liveFailed ? '실시간 환율 실패 — 고정값 사용 중' : '실시간 환율 불러오는 중 — 고정값 사용 중'}
            </span>
        )}
    </div>
);

// 고시환율 칸 아래 표시줄 — info = app.js customsInfo(js/lib/customs-fxrt.js customsView). 수입가·통관비 탭 공통.
//   '관세청 고시(수입) · 10/11~10/17 적용 · 자동' / '직접 입력 · 이번 주 고시 ○ [고시값으로]' / 노란 안내(자동값을 못 쓸 때)
const CustomsFxrtHint = ({ info, onReset }) => {
    if (!info) return null;
    return (
        <>
            {info.label && (
                <div className={`mt-1 flex items-center justify-between gap-2 text-xs ${info.source === 'auto' ? 'text-emerald-700' : 'text-gray-400'}`} data-k="customs-fxrt-hint">
                    <span className="min-w-0">{info.label}</span>
                    {info.canReset && onReset && <button type="button" onClick={onReset} className="flex-shrink-0 px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200" data-k="customs-fxrt-reset">고시값으로</button>}
                </div>
            )}
            {info.notice && (
                <p role="status" className="mt-1 px-2 py-1 rounded border border-yellow-300 bg-yellow-50 text-xs text-yellow-800" data-k="customs-fxrt-notice">{info.notice}</p>
            )}
        </>
    );
};

// 고시환율이 빈칸(또는 0)이면 결과 대신 보이는 안내 — 세 탭 공통
const CustomsRateMissing = ({ where }) => (
    <div className="bg-white p-6 md:p-8 rounded-2xl border border-slate-200 flex flex-col items-center justify-center text-center" data-k="customs-rate-missing">
        <h3 className="text-xl font-semibold text-gray-700">고시환율을 입력하세요</h3>
        <p className="text-gray-500 mt-2 text-sm">{where || '환율 칸의 관세청 고시환율'}이 비어 있어 계산하지 않았습니다.<br />수입가·통관비·창고료 탭이 같은 값을 씁니다.</p>
    </div>
);

// --- NEW COMPONENT: LiveRateDisplay ---
const LiveRateDisplay = ({ rates, status }) => {
    const SwitchHorizontalIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
    );

    const RateItem = ({ label, value }) => (
        <div className="flex items-center justify-between text-sm py-2 px-3">
            <span className="text-gray-600 font-medium flex items-center">
                <SwitchHorizontalIcon />
                <span className="ml-2">{label}</span>
            </span>
            <span className="font-semibold text-gray-800 text-base">{value}</span>
        </div>
    );

    if (status === 'loading') {
        return (
            <div className="p-3 bg-slate-100 rounded-lg text-gray-600 text-sm">
                <svg className="animate-spin h-5 w-5 text-gray-500 inline mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                환율을 불러오는 중...
            </div>
        );
    }
    if (status === 'error') {
        return (
            <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline mr-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                실시간 환율 불러오기 실패 — 고정환율 칸의 값을 씁니다.
            </div>
        );
    }
    if (rates.krw && rates.cny) {
        return (
            <div className="bg-slate-100 rounded-lg divide-y divide-slate-200 border border-slate-200">
                <RateItem label="원-달러 (KRW)" value={`1 $ = ${rates.krw.toFixed(2)} ₩`} />
                <RateItem label="원-위안 (CNY)" value={`1 ¥ = ${(rates.krw / rates.cny).toFixed(2)} ₩`} />
                <RateItem label="위안-달러 (USD)" value={`1 ¥ = ${(1 / rates.cny).toFixed(4)} $`} />
                <div className="px-3 py-1.5 text-xs text-gray-500">출처 {LIVE_RATE_SOURCE}{rates.at ? ` · ${fmtRateTime(rates.at)} 기준` : ''}</div>
            </div>
        );
    }
    return null;
};
