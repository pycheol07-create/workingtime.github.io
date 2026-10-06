// 'import React'와 'export' 키워드를 모두 삭제합니다.

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
                환율 불러오기 실패.
            </div>
        );
    }
    if (rates.krw && rates.cny) {
        return (
            <div className="bg-slate-100 rounded-lg divide-y divide-slate-200 border border-slate-200">
                <RateItem label="원-달러 (KRW)" value={`1 $ = ${rates.krw.toFixed(2)} ₩`} />
                <RateItem label="원-위안 (CNY)" value={`1 ¥ = ${(rates.krw / rates.cny).toFixed(2)} ₩`} />
                <RateItem label="위안-달러 (USD)" value={`1 ¥ = ${(1 / rates.cny).toFixed(4)} $`} />
            </div>
        );
    }
    return null;
};