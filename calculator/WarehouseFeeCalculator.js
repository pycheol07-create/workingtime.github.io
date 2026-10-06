// 창고료 & 통관비 납부지연가산세 계산기
// 예상수량을 입력하면 통관비 계산기 로직을 활용해 CBM/박스수/통관비를 자동 산출
// 참조: 구글 스프레드시트 '창고료&가산세' 시트

const WarehouseFeeCalculator = ({ exchangeRates }) => {
    const formRef = React.useRef(null);
    const { settings } = React.useContext(SettingsContext);

    const toDateStr = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    };
    const today = toDateStr(new Date());

    const [calculationMode, setCalculationMode] = React.useState('quantity'); // 'quantity' | 'amount'
    const [useManualBoxCbm, setUseManualBoxCbm] = React.useState(false);
    const [manualValues, setManualValues] = React.useState({ boxes: '', cbm: '' });

    const [formData, setFormData] = React.useState(() => ({
        // 상품수량 / 상품금액(USD) & 관세율 (통관비 자동 산출용)
        quantity: '1000',
        totalAmountUSD: '10000',
        tariffRate: '8',

        // 창고료 섹션
        warehouseRate: String(settings.warehouse?.ratePerCBMPerDay ?? 1200),
        arrivalDate: today,
        clearanceDate: today,
        freeDays: String(settings.warehouse?.freeDays ?? 7),

        // 가산세 섹션
        surchargeRate: String((settings.warehouse?.surchargeRate ?? 0.03) * 100),
        paymentDueDays: String(settings.warehouse?.paymentDueDays ?? 25),
        dailyInterestRate: String((settings.warehouse?.dailyInterestRate ?? 0.00025) * 100),
    }));

    // 설정관리에서 기본값 변경 시 폼에 반영
    React.useEffect(() => {
        setFormData(prev => ({
            ...prev,
            warehouseRate: String(settings.warehouse?.ratePerCBMPerDay ?? 1200),
            freeDays: String(settings.warehouse?.freeDays ?? 7),
            surchargeRate: String((settings.warehouse?.surchargeRate ?? 0.03) * 100),
            paymentDueDays: String(settings.warehouse?.paymentDueDays ?? 25),
            dailyInterestRate: String((settings.warehouse?.dailyInterestRate ?? 0.00025) * 100),
        }));
    }, [
        settings.warehouse?.ratePerCBMPerDay,
        settings.warehouse?.freeDays,
        settings.warehouse?.surchargeRate,
        settings.warehouse?.paymentDueDays,
        settings.warehouse?.dailyInterestRate,
    ]);

    const handleInputChange = React.useCallback((e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }, []);

    const handleKeyDown = React.useCallback((e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const form = formRef.current;
            if (!form) return;
            const focusable = Array.from(form.querySelectorAll('input, select'));
            const index = focusable.indexOf(e.target);
            if (index > -1 && index < focusable.length - 1) {
                focusable[index + 1].focus();
            } else if (index === focusable.length - 1) {
                document.activeElement?.blur();
            }
        }
    }, []);

    const daysBetween = (d1Str, d2Str) => {
        if (!d1Str || !d2Str) return 0;
        const d1 = new Date(d1Str);
        const d2 = new Date(d2Str);
        if (isNaN(d1) || isNaN(d2)) return 0;
        return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    };

    const addDays = (dateStr, days) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        if (isNaN(d)) return '';
        d.setDate(d.getDate() + Number(days || 0));
        return toDateStr(d);
    };

    const results = React.useMemo(() => {
        const tariffRateValue = (parseFloat(formData.tariffRate) || 0) / 100;

        // settings.customs 기본값 활용 (통관비 계산기와 동일한 defaults)
        const unitPriceUSD = parseFloat(settings.customs?.defaultUnitPrice ?? 10);
        const quantityPerBox = parseFloat(settings.customs?.defaultQuantityPerBox ?? 50) || 1;
        const weightPerBox = parseFloat(settings.customs?.defaultWeightPerBox ?? 12);

        // 계산 기준에 따라 수량 결정 (금액 기준일 경우 평균 단가로 역산)
        let quantity = 0;
        if (calculationMode === 'quantity') {
            quantity = parseFloat(formData.quantity) || 0;
        } else {
            const amountUSD = parseFloat(formData.totalAmountUSD) || 0;
            quantity = unitPriceUSD > 0 ? amountUSD / unitPriceUSD : 0;
        }

        // settings.common 기본값
        const cbmWeightDivisor = parseFloat(settings.common?.cbmWeightDivisor ?? 250);
        const oceanFreightPerCbm = parseFloat(settings.common?.oceanFreightPerCbm ?? 110000);
        const minCbm = parseFloat(settings.common?.minCbm ?? 1.0);
        const vatRate = parseFloat(settings.common?.vatRate ?? 0.1);

        // 관세청 고시환율
        const customsRate = parseFloat(exchangeRates?.customs) || 1350;

        // --- 자동 산출: 박스수, CBM, 통관비 ---
        const autoTotalBoxes = quantity > 0 ? Math.ceil(quantity / quantityPerBox) : 0;
        const autoCbm = (autoTotalBoxes * weightPerBox) / cbmWeightDivisor;

        // 수동 오버라이드 (실제값 입력 모드)
        const manualBoxesNum = parseFloat(manualValues.boxes);
        const manualCbmNum = parseFloat(manualValues.cbm);
        const totalBoxes = useManualBoxCbm && Number.isFinite(manualBoxesNum) && manualBoxesNum > 0
            ? manualBoxesNum : autoTotalBoxes;
        const cbm = useManualBoxCbm && Number.isFinite(manualCbmNum) && manualCbmNum > 0
            ? manualCbmNum : autoCbm;

        const chargeableCbm = Math.max(cbm, minCbm);
        const oceanFreightKRW = chargeableCbm * oceanFreightPerCbm;

        const totalProductUSD = quantity * unitPriceUSD;
        const oceanFreightUSDForTax = customsRate > 0 ? oceanFreightKRW / customsRate : 0;
        const taxableBaseUSD = totalProductUSD + oceanFreightUSDForTax;
        const taxableBaseKRW = taxableBaseUSD * customsRate;

        const tariff = taxableBaseKRW * tariffRateValue;
        const vat = (taxableBaseKRW + tariff) * vatRate;
        const customsFee = tariff + vat;  // 통관비 = 관세 + 부가세

        // --- 창고료 ---
        const warehouseRate = parseFloat(formData.warehouseRate) || 0;
        const freeDays = parseInt(formData.freeDays, 10) || 0;
        const totalStayDays = daysBetween(formData.arrivalDate, formData.clearanceDate);
        const storageDays = Math.max(0, totalStayDays - freeDays);
        const warehouseFeeTotal = warehouseRate * cbm * storageDays;
        const freeUntil = addDays(formData.arrivalDate, freeDays);

        // --- 가산세 ---
        const surchargeRate = (parseFloat(formData.surchargeRate) || 0) / 100;
        const paymentDueDays = parseInt(formData.paymentDueDays, 10) || 0;
        const dailyInterestRate = (parseFloat(formData.dailyInterestRate) || 0) / 100;
        const paymentDueDate = addDays(formData.arrivalDate, paymentDueDays);
        const delayDays = Math.max(0, daysBetween(paymentDueDate, formData.clearanceDate));
        // 지연일수가 0이면 가산세·이자 모두 미부과 (마감기한 내 납부)
        const surchargeAmount = delayDays > 0 ? customsFee * surchargeRate : 0;
        const lateInterest = delayDays > 0 ? customsFee * delayDays * dailyInterestRate : 0;
        const surchargeTotal = surchargeAmount + lateInterest;

        const grandTotal = warehouseFeeTotal + surchargeTotal;

        return {
            derivedQuantity: quantity, totalBoxes, cbm, autoTotalBoxes, autoCbm,
            tariff, vat, customsFee,
            totalStayDays, storageDays, warehouseFeeTotal, freeUntil,
            paymentDueDate, delayDays, surchargeAmount, lateInterest, surchargeTotal,
            grandTotal,
        };
    }, [formData, calculationMode, useManualBoxCbm, manualValues, settings, exchangeRates]);

    const formatKRW = (v) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(v || 0);
    const formatDays = (v) => `${new Intl.NumberFormat('ko-KR').format(v || 0)} 일`;
    const formatCBM = (v) => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(v || 0)} ㎥`;
    const formatBoxes = (v) => `${new Intl.NumberFormat('ko-KR').format(v || 0)} 박스`;
    const formatQty = (v) => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(v || 0)} 개`;
    const formatUSD = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v || 0);

    const CalendarIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
    const CurrencyWonIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7l4 8 4-8M6 12h12m-12 3h12" /></svg>);
    const CalcIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 14h.01M12 11h.01M15 11h.01M9 11h.01M12 21a9 9 0 110-18 9 9 0 010 18z" /></svg>);
    const PercentIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 16l-4-4m0 0l4-4m-4 4h18m-4 4l4-4m0 0l-4-4m-4 8a2 2 0 11-4 0 2 2 0 014 0zM5 8a2 2 0 100-4 2 2 0 000 4z" /></svg>);
    const HashIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" /></svg>);

    const ResultRow = ({ label, value, isSub, isTotal }) => (
        <div className={`flex items-center justify-between py-2 ${isSub ? 'pl-4 text-sm' : ''}`}>
            <span className={`${isSub ? 'text-gray-500' : isTotal ? 'font-bold text-gray-900' : 'text-gray-700 font-medium'}`}>{label}</span>
            <span className={`${isSub ? 'text-gray-600' : isTotal ? 'font-bold text-emerald-600 text-lg' : 'font-semibold text-gray-900'}`}>{value}</span>
        </div>
    );

    const tariffOptions = settings.customs?.tariffRates || [
        { label: '8%', value: 8 }, { label: '0%', value: 0 }, { label: '13%', value: 13 }
    ];
    const modeOptions = [
        { label: '상품수량 기준', value: 'quantity' },
        { label: '상품금액 기준', value: 'amount' },
    ];
    const avgUnitPrice = parseFloat(settings.customs?.defaultUnitPrice ?? 10);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 mt-8">
            <div ref={formRef} className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200">
                <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-slate-200 pb-4">기본 정보 입력</h2>
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">계산 기준</label>
                        <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60">
                            {modeOptions.map(option => (
                                <label key={option.value} className={`relative flex-1 cursor-pointer py-2.5 px-4 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${calculationMode === option.value ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                    <input type="radio" name="calculationMode" value={option.value} checked={calculationMode === option.value} onChange={(e) => setCalculationMode(e.target.value)} className="sr-only" />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </fieldset>
                    </div>

                    {calculationMode === 'quantity' ? (
                        <InputControl label="상품수량" name="quantity" value={formData.quantity} onChange={handleInputChange} unit="개" icon={<CalcIcon />} onKeyDown={handleKeyDown} placeholder="예: 1000" />
                    ) : (
                        <>
                            <InputControl label="상품금액" name="totalAmountUSD" value={formData.totalAmountUSD} onChange={handleInputChange} unit="USD" icon={<CurrencyWonIcon />} onKeyDown={handleKeyDown} placeholder="예: 10000" />
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                                <span>평균 상품단가 (설정관리 기준)</span>
                                <span className="font-semibold text-slate-800">{formatUSD(avgUnitPrice)} / 개</span>
                            </div>
                        </>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">입항일</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><CalendarIcon /></div>
                            <input type="date" name="arrivalDate" value={formData.arrivalDate} onChange={handleInputChange} onKeyDown={handleKeyDown} className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 text-gray-900 bg-white" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">통관일</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><CalendarIcon /></div>
                            <input type="date" name="clearanceDate" value={formData.clearanceDate} onChange={handleInputChange} onKeyDown={handleKeyDown} className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 text-gray-900 bg-white" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">관세율</label>
                        <fieldset className="flex rounded-lg shadow-sm p-1 bg-slate-200/60 overflow-x-auto">
                            {tariffOptions.map((option, idx) => (
                                <label key={idx} className={`relative flex-1 min-w-[60px] cursor-pointer py-2.5 px-4 text-center text-sm font-semibold focus-within:ring-2 focus-within:ring-emerald-500 focus-within:ring-offset-1 ${String(formData.tariffRate) === String(option.value) ? 'bg-white text-emerald-600 shadow-md rounded-md' : 'text-gray-600 hover:text-emerald-600/80'} transition-all duration-300 ease-in-out`}>
                                    <input type="radio" name="tariffRate" value={option.value} checked={String(formData.tariffRate) === String(option.value)} onChange={handleInputChange} className="sr-only" />
                                    <span>{option.label}</span>
                                </label>
                            ))}
                        </fieldset>
                    </div>

                    <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200 text-xs text-emerald-800">
                        ※ 상품 단가·박스당 수량·박스당 무게·해운비·관세청 고시환율은 설정관리 및 통관비 계산기 값을 자동 사용합니다.
                    </div>

                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <label className="flex items-center justify-between cursor-pointer">
                            <span className="text-sm font-bold text-gray-800">박스수량 & CBM 수동입력</span>
                            <span className="relative inline-flex items-center">
                                <input type="checkbox" checked={useManualBoxCbm} onChange={(e) => {
                                    const on = e.target.checked;
                                    setUseManualBoxCbm(on);
                                    if (on) {
                                        // 켤 때 현재 자동 산출값으로 초기 세팅
                                        setManualValues({
                                            boxes: String(results.autoTotalBoxes || ''),
                                            cbm: String((results.autoCbm ?? 0).toFixed(3)),
                                        });
                                    }
                                }} className="sr-only peer" />
                                <span className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:bg-emerald-500 transition-colors"></span>
                                <span className="absolute left-0.5 top-0.5 h-5 w-5 bg-white rounded-full shadow transform transition-transform peer-checked:translate-x-5"></span>
                            </span>
                        </label>
                        <p className="mt-1 text-xs text-slate-500">패킹리스트 등 실제값이 확인되면 켜서 직접 입력하세요.</p>

                        {useManualBoxCbm && (
                            <div className="mt-4 space-y-4">
                                <InputControl label="실제 박스수량" name="manualBoxes" value={manualValues.boxes} onChange={(e) => setManualValues(v => ({ ...v, boxes: e.target.value }))} unit="박스" icon={<CalcIcon />} onKeyDown={handleKeyDown} placeholder={`자동 산출: ${results.autoTotalBoxes}`} />
                                <InputControl label="실제 CBM" name="manualCbm" value={manualValues.cbm} onChange={(e) => setManualValues(v => ({ ...v, cbm: e.target.value }))} unit="㎥" icon={<CalcIcon />} onKeyDown={handleKeyDown} placeholder={`자동 산출: ${(results.autoCbm ?? 0).toFixed(3)}`} />
                            </div>
                        )}
                    </div>
                </div>

                <h2 className="text-2xl font-bold text-gray-800 mb-6 mt-10 border-b border-slate-200 pb-4">보세창고료 입력</h2>
                <div className="space-y-6">
                    <InputControl label="창고료 단가" name="warehouseRate" value={formData.warehouseRate} onChange={handleInputChange} unit="원/CBM/일" icon={<CurrencyWonIcon />} onKeyDown={handleKeyDown} />
                    <InputControl label="무료보관일수" name="freeDays" value={formData.freeDays} onChange={handleInputChange} unit="일" icon={<HashIcon />} onKeyDown={handleKeyDown} />
                </div>

                <h2 className="text-2xl font-bold text-gray-800 mb-6 mt-10 border-b border-slate-200 pb-4">가산세 입력</h2>
                <div className="space-y-6">
                    <InputControl label="가산세율" name="surchargeRate" value={formData.surchargeRate} onChange={handleInputChange} unit="%" icon={<PercentIcon />} onKeyDown={handleKeyDown} />
                    <InputControl label="납부마감기한 (입항일+N)" name="paymentDueDays" value={formData.paymentDueDays} onChange={handleInputChange} unit="일" icon={<HashIcon />} onKeyDown={handleKeyDown} />
                    <InputControl label="일 지연이자율" name="dailyInterestRate" value={formData.dailyInterestRate} onChange={handleInputChange} unit="%" icon={<PercentIcon />} onKeyDown={handleKeyDown} />
                </div>
            </div>

            <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 w-full animate-fade-in-slide-up">
                <div className="text-center mb-6">
                    <p className="text-lg text-gray-600">추가비용 총 합계</p>
                    <p className="text-5xl font-extrabold text-emerald-600 tracking-tight my-2">{formatKRW(results.grandTotal)}</p>
                </div>

                <div className="mt-6 space-y-3">
                    <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-200">
                        <h3 className="font-bold text-blue-900 mb-2">
                            자동 산출값
                            {useManualBoxCbm && <span className="ml-2 text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">박스/CBM 수동 적용중</span>}
                        </h3>
                        <div className="divide-y divide-blue-100">
                            {calculationMode === 'amount' && (
                                <ResultRow label="상품수량 (금액÷단가)" value={formatQty(results.derivedQuantity)} isSub />
                            )}
                            <ResultRow
                                label="박스 수량"
                                value={useManualBoxCbm
                                    ? <span><span className="text-slate-400 line-through mr-2 text-xs">{formatBoxes(results.autoTotalBoxes)}</span>{formatBoxes(results.totalBoxes)}</span>
                                    : formatBoxes(results.totalBoxes)}
                                isSub />
                            <ResultRow
                                label="CBM"
                                value={useManualBoxCbm
                                    ? <span><span className="text-slate-400 line-through mr-2 text-xs">{formatCBM(results.autoCbm)}</span>{formatCBM(results.cbm)}</span>
                                    : formatCBM(results.cbm)}
                                isSub />
                            <ResultRow label={`관세 (${formData.tariffRate}%)`} value={formatKRW(results.tariff)} isSub />
                            <ResultRow label="부가세 (10%)" value={formatKRW(results.vat)} isSub />
                            <ResultRow label="통관비 (관세+부가세)" value={formatKRW(results.customsFee)} />
                        </div>
                    </div>

                    <div className="p-4 bg-white/70 rounded-xl border border-slate-200">
                        <h3 className="font-bold text-gray-800 mb-2">보세창고료</h3>
                        <div className="divide-y divide-slate-200">
                            <ResultRow label="입항일 → 통관일" value={formatDays(results.totalStayDays)} isSub />
                            <ResultRow label="무료보관 만료일" value={results.freeUntil || '-'} isSub />
                            <ResultRow label="과금 보관기간" value={formatDays(results.storageDays)} isSub />
                            <ResultRow label="창고료 총액" value={formatKRW(results.warehouseFeeTotal)} />
                        </div>
                    </div>

                    <div className="p-4 bg-white/70 rounded-xl border border-slate-200">
                        <h3 className="font-bold text-gray-800 mb-2">통관비 납부지연가산세</h3>
                        <div className="divide-y divide-slate-200">
                            <ResultRow label="납부마감기한" value={results.paymentDueDate || '-'} isSub />
                            <ResultRow label="지연일수" value={formatDays(results.delayDays)} isSub />
                            <ResultRow label={`가산세 (${formData.surchargeRate}%)`} value={formatKRW(results.surchargeAmount)} isSub />
                            <ResultRow label="납부지연이자" value={formatKRW(results.lateInterest)} isSub />
                            <ResultRow label="가산세 총액" value={formatKRW(results.surchargeTotal)} />
                        </div>
                    </div>

                    <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                        <ResultRow label="총 합계" value={formatKRW(results.grandTotal)} isTotal />
                    </div>
                </div>
            </div>
        </div>
    );
};
