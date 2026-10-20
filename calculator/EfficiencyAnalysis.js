// [수정됨] 단일 exchangeRate 대신 currentRates 객체를 받아 다중 환율 처리

// 열려 있을 때만 본체를 mount 한다 — 본체 안에서 hook 앞에 return null 을 두면 닫을 때 effect 정리(cleanup)가
// 돌지 않아 ESC 키 리스너가 남는다. 이름: text/babel 의 맨 위 const 는 페이지 전역이라 겹치지 않게.
const EfficiencyAnalysis = (props) => (props.show ? <EfficiencyAnalysisModal {...props} /> : null);

const EfficiencyAnalysisModal = ({ onClose, formData, currentRates, calculationMode }) => {
    const { settings } = React.useContext(SettingsContext);
    
    const printRef = React.useRef(null);
    const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false);
    const [showAllSplit, setShowAllSplit] = React.useState(false);    // 분할 표: 기본은 최적 3개 + 현재(1회)
    const [showAllBoxes, setShowAllBoxes] = React.useState(false);    // 박스표: 기본은 현재 박스 앞뒤 구간

    // ESC 로 닫기(이 페이지는 js/modal-esc.js 를 안 쓴다). 열려 있는 동안만 mount 되므로 그동안만 듣는다.
    React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleDownloadPDF = async () => {
        if (!printRef.current) return;
        
        try {
            setIsGeneratingPdf(true);
            const input = printRef.current;
            // PDF 에는 [전체 보기]와 상관없이 모든 행을 담는다 — 잠깐 전부 펼쳐 그린 뒤(flushSync) 복제하고 바로 원래대로.
            // 펼치기·접기 버튼(data-pdf-hide)은 복제본에서 뺀다.
            const prevShow = { split: showAllSplit, boxes: showAllBoxes };
            ReactDOM.flushSync(() => { setShowAllSplit(true); setShowAllBoxes(true); });
            const clone = input.cloneNode(true);
            ReactDOM.flushSync(() => { setShowAllSplit(prevShow.split); setShowAllBoxes(prevShow.boxes); });
            clone.querySelectorAll('[data-pdf-hide]').forEach(el => el.remove());
            
            Object.assign(clone.style, {
                position: 'fixed',
                top: '-10000px',
                left: '-10000px',
                width: `${input.offsetWidth}px`,
                height: 'auto',
                maxHeight: 'none',
                overflow: 'visible',
                zIndex: '-1000'
            });

            document.body.appendChild(clone);
            const canvas = await window.html2canvas(clone, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: clone.scrollWidth, windowHeight: clone.scrollHeight });
            document.body.removeChild(clone);
            
            const imgData = canvas.toDataURL('image/png');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgWidth = 210;
            const pageHeight = 297;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            
            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft > 0) {
                position = heightLeft - imgHeight; 
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            
            const dateStr = new Date().toISOString().slice(0,10);
            pdf.save(`운송효율분석리포트_${dateStr}.pdf`);
            
        } catch (error) {
            console.error("PDF 생성 중 오류 발생:", error);
            alert("PDF 생성에 실패했습니다. (관리자에게 문의하세요)");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const simulateCost = (targetQty) => {
        const { docsFee, coFee, oceanFreightPerCbm, minCbm, cbmWeightDivisor, vatRate } = settings.common;
        
        // [수정] 세금용 환율과 물품대금용 환율을 엄격하게 분리하여 반영
        // `|| 1` 은 남겨 둔다 — 이 창은 통관비 탭 결과가 있을 때만 여는 버튼으로 열린다. 고시환율·원-달러가 비면
        //   결과가 null(CustomsCalculator remitMissing·customsRateMissing)이라 버튼이 안 보여 1원 환율로 계산될 일이 없다.
        const customsRate = currentRates?.customs || 1;
        const usdKrwRate = currentRates?.usdKrw || 1;
        
        const tariffRateValue = parseNum(formData.tariffRate) / 100;
        const weightPerBox = parseNum(formData.weightPerBox) || 0;

        let currentBoxes, currentProductPriceUSD;

        if (calculationMode === 'product') {
            const unitPrice = parseNum(formData.unitPrice) || 0;
            const quantityPerBox = parseNum(formData.quantityPerBox) || 1;
            currentBoxes = Math.ceil(targetQty / quantityPerBox);
            currentProductPriceUSD = targetQty * unitPrice;
        } else { 
            currentBoxes = targetQty;
            const totalOriginalPrice = parseNum(formData.totalProductPrice) || 0;
            const originalBoxes = parseNum(formData.boxQuantity) || 1;
            const pricePerBox = totalOriginalPrice / originalBoxes;
            currentProductPriceUSD = currentBoxes * pricePerBox;
        }

        const totalWeight = currentBoxes * weightPerBox;
        const rawCbm = totalWeight / cbmWeightDivisor;
        const chargeableCbm = formData.shippingType === 'LCL' ? Math.max(rawCbm, minCbm || 0) : rawCbm;
        
        let oceanFreightKRW;
        if (formData.shippingType === 'FCL') {
             oceanFreightKRW = parseNum(formData.containerCost) || 0;
        } else {
            oceanFreightKRW = chargeableCbm * oceanFreightPerCbm;
        }

        // 과세표준은 관세청 고시환율을 적용
        const oceanFreightUSDForTax = oceanFreightKRW / customsRate;
        const taxableBaseUSD = currentProductPriceUSD + oceanFreightUSDForTax;
        
        const taxableBaseKRW = taxableBaseUSD * customsRate;
        const tariffAmount = taxableBaseKRW * tariffRateValue;
        const vatBaseKRW = taxableBaseKRW + tariffAmount;
        const vatAmount = vatBaseKRW * vatRate;

        // 물품 대금은 실제 결제용 송금환율(원-달러) 적용
        const totalProductPriceKRW = currentProductPriceUSD * usdKrwRate;

        let commissionAmountKRW = 0;
        const commissionValueNum = parseNum(formData.commissionValue) || 0;
        if (formData.commissionType === 'percentage') {
            commissionAmountKRW = totalProductPriceKRW * (commissionValueNum / 100);
        } else if (formData.commissionType === 'perItem' && calculationMode === 'product') {
            commissionAmountKRW = commissionValueNum * targetQty;
        }

        const totalCost = docsFee + coFee + oceanFreightKRW + tariffAmount + vatAmount + commissionAmountKRW;
        const validQty = targetQty > 0 ? targetQty : 1;
        const perUnitCost = totalCost / validQty; 
        const finalCostPerUnit = (totalProductPriceKRW + totalCost) / validQty;

        return {
            qty: targetQty,
            boxes: currentBoxes,
            cbm: rawCbm,
            chargeableCbm,
            oceanFreightKRW,
            totalCost,
            perUnitCost,
            finalCostPerUnit,
            onlyShippingCost: totalCost 
        };
    };

    const generateData = () => {
        const baseQty = calculationMode === 'product' ? parseNum(formData.productQuantity) : parseNum(formData.boxQuantity);
        if (!baseQty) return [];

        const data = [];
        const quantityPerBox = parseNum(formData.quantityPerBox) || 1;
        
        const pointsToCheck = new Set();
        for(let i=1; i<=10; i++) pointsToCheck.add(i);
        
        const currentBoxCount = calculationMode === 'product' ? Math.ceil(baseQty / quantityPerBox) : baseQty;
        pointsToCheck.add(currentBoxCount);
        pointsToCheck.add(currentBoxCount + 1);
        pointsToCheck.add(currentBoxCount + 5);
        
        const weightPerBox = parseNum(formData.weightPerBox) || 0;
        const cbmWeightDivisor = settings.common.cbmWeightDivisor;
        const minCbm = settings.common.minCbm || 1;
        if (weightPerBox > 0) {
            const boxesForMinCbm = Math.ceil((minCbm * cbmWeightDivisor) / weightPerBox);
            pointsToCheck.add(boxesForMinCbm);
            pointsToCheck.add(boxesForMinCbm + 1);
        }

        const sortedBoxes = Array.from(pointsToCheck).sort((a, b) => a - b).filter(b => b > 0);
        sortedBoxes.forEach(boxes => {
            const qty = calculationMode === 'product' ? boxes * quantityPerBox : boxes;
            data.push(simulateCost(qty));
        });

        return data;
    };

    const analyzeSplitScenarios = (totalBoxes) => {
        if (!totalBoxes || totalBoxes <= 0) return [];
        const scenarios = [];
        const quantityPerBox = parseNum(formData.quantityPerBox) || 1;
        
        let minShipmentSize = 1;
        if (totalBoxes >= 20) minShipmentSize = 10; 
        else if (totalBoxes >= 10) minShipmentSize = 5;

        let maxSplits = Math.floor(totalBoxes / minShipmentSize);
        if (maxSplits < 1) maxSplits = 1;
        maxSplits = Math.min(maxSplits, 50);

        for (let splitCount = 1; splitCount <= maxSplits; splitCount++) {
            const baseBoxes = Math.floor(totalBoxes / splitCount);
            const remainder = totalBoxes % splitCount;
            if (baseBoxes === 0) break;

            const countCeil = remainder;          
            const countFloor = splitCount - remainder;

            const getQty = (boxes) => calculationMode === 'product' ? boxes * quantityPerBox : boxes;

            let costFloor = 0; let costCeil = 0;
            if (countFloor > 0) costFloor = simulateCost(getQty(baseBoxes)).onlyShippingCost;
            if (countCeil > 0) costCeil = simulateCost(getQty(baseBoxes + 1)).onlyShippingCost;

            const totalScenarioCost = (costFloor * countFloor) + (costCeil * countCeil);

            let displayBoxes = `${baseBoxes}박스`;
            if (remainder > 0) displayBoxes = `${baseBoxes}~${baseBoxes + 1}박스`;

            scenarios.push({ splitCount: splitCount, displayBoxes: displayBoxes, totalScenarioCost: totalScenarioCost });
        }
        scenarios.sort((a, b) => a.totalScenarioCost - b.totalScenarioCost);
        return scenarios;
    };

    const data = generateData();
    const currentBoxCount = calculationMode === 'product' 
        ? Math.ceil(parseNum(formData.productQuantity)/parseNum(formData.quantityPerBox)) 
        : parseNum(formData.boxQuantity);
    
    const currentItem = data.find(d => d.boxes === currentBoxCount);
    // 박스표 — 현재 박스 기준 앞뒤 BOX_WINDOW 줄만 먼저(나머지는 [전체 보기])
    const BOX_WINDOW = 3;
    const currentIdx = currentItem ? data.indexOf(currentItem) : -1;
    const boxHidden = currentIdx >= 0 ? data.length - (Math.min(data.length - 1, currentIdx + BOX_WINDOW) - Math.max(0, currentIdx - BOX_WINDOW) + 1) : 0;
    const splitScenarios = React.useMemo(() => { return analyzeSplitScenarios(currentBoxCount); }, [currentBoxCount, formData, settings, currentRates, calculationMode]);

    const formatCurrency = (val) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(val);

    const renderSplitAnalysis = () => {
        if (!splitScenarios || splitScenarios.length === 0) return null;
        const bestScenario = splitScenarios[0]; 
        const currentScenario = splitScenarios.find(s => s.splitCount === 1); 
        if (!currentScenario) return null;

        const saving = currentScenario.totalScenarioCost - bestScenario.totalScenarioCost;
        const isCurrentBest = bestScenario.splitCount === 1;
        // 기본: 비용이 낮은 3개 + 현재(1회) 를 먼저. [전체 보기] 면 예전처럼 횟수 순 전체.
        const topRows = splitScenarios.slice(0, 3);
        if (!topRows.some(s => s.splitCount === 1)) topRows.push(currentScenario);
        const splitRows = showAllSplit ? [...splitScenarios].sort((a, b) => a.splitCount - b.splitCount) : topRows;
        const splitHidden = splitScenarios.length - topRows.length;

        return (
            <div className="mb-8">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-lg">분할 운송 시나리오 분석<span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">1회 ~ {splitScenarios.length}회 분할</span></h3>
                <div className={`p-4 rounded-xl border-2 mb-4 ${isCurrentBest ? 'bg-green-50 border-green-100' : 'bg-blue-50 border-blue-100'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`flex-shrink-0 ${isCurrentBest ? 'text-green-500' : 'text-blue-500'}`}>{isCurrentBest ? (<svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>) : (<svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>)}</div>
                        <div>
                            <h4 className={`font-bold text-lg ${isCurrentBest ? 'text-green-800' : 'text-blue-800'}`}>{isCurrentBest ? "한 번에 보내는 것이 가장 저렴합니다!" : `${bestScenario.splitCount}번에 나눠서 보내는 것을 추천합니다!`}</h4>
                            <p className={`text-sm mt-1 ${isCurrentBest ? 'text-green-600' : 'text-blue-600'}`}>{isCurrentBest ? `나눠서 보내면 고정 비용이 중복 발생하여 비용이 증가합니다.` : `총 ${formatCurrency(saving)}원을 절약할 수 있습니다.`}</p>
                        </div>
                    </div>
                </div>
                <div className="overflow-x-auto border rounded-lg shadow-sm">
                    <table className="w-full text-sm text-center border-collapse">
                        <thead className="bg-gray-100 text-gray-600"><tr><th className="p-2 border-b">횟수</th><th className="p-2 border-b">1회당 물량</th><th className="p-2 border-b">부대비용(상품가 제외, 원)</th><th className="p-2 border-b">비고</th></tr></thead>
                        <tbody>
                            {splitRows.map((row, idx) => {
                                const isBest = row.splitCount === bestScenario.splitCount;
                                const diff = row.totalScenarioCost - currentScenario.totalScenarioCost;
                                return (
                                    <tr key={idx} className={`${isBest ? 'bg-green-50 font-bold' : 'hover:bg-gray-50'} border-b last:border-0 transition-colors`}>
                                        <td className="p-2 border-r text-gray-700">{row.splitCount}회</td>
                                        <td className="p-2 border-r text-gray-600">{row.displayBoxes}</td>
                                        <td className={`p-2 border-r font-mono ${isBest ? 'text-green-700' : 'text-gray-800'}`}>{formatCurrency(row.totalScenarioCost)}</td>
                                        <td className="p-2 text-xs">
                                            {row.splitCount === 1 && <span className="inline-block px-2 py-0.5 rounded bg-gray-200 text-gray-600">기준</span>}
                                            {isBest && row.splitCount !== 1 && <span className="inline-block px-2 py-0.5 rounded bg-green-100 text-green-700">최적</span>}
                                            {!isBest && diff > 0 && <span className="text-red-400">+{formatCurrency(diff)}</span>}
                                            {!isBest && diff < 0 && <span className="text-blue-400">{formatCurrency(diff)}</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {splitHidden > 0 && (
                    <button type="button" data-pdf-hide onClick={() => setShowAllSplit(v => !v)} aria-expanded={showAllSplit} className="mt-2 text-sm font-semibold text-emerald-700 hover:text-emerald-600 underline">
                        {showAllSplit ? '최적 3개만 보기' : `전체 보기 (${splitScenarios.length}개)`}
                    </button>
                )}
            </div>
        );
    };

    const recommend = () => {
        if (!currentItem) return null;
        const betterOption = data.find(d => d.boxes > currentItem.boxes && d.finalCostPerUnit < currentItem.finalCostPerUnit);
        if (betterOption) {
            const savePerUnit = currentItem.finalCostPerUnit - betterOption.finalCostPerUnit;
            const addBoxes = betterOption.boxes - currentItem.boxes;
            return (
                <div className="bg-indigo-50 p-4 rounded-lg mb-8 border border-indigo-200">
                    <p className="text-indigo-800 font-bold text-lg">더 모아서 보내면 이득!</p>
                    <p className="text-indigo-700 text-sm mt-1"><span className="font-bold">{addBoxes}박스</span>만 더 추가({betterOption.boxes}박스)하면, 개당 원가가 <span className="font-bold text-indigo-600">{formatCurrency(savePerUnit)}원</span> 더 저렴해집니다.</p>
                </div>
            );
        }
        return null;
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 animate-fade-in" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col animate-fade-in-slide-up max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center border-b p-4 bg-white rounded-t-2xl z-20 flex-shrink-0">
                    <h2 className="text-xl font-bold text-gray-800">운송 효율 분석 리포트</h2>
                    <div className="flex items-center gap-2">
                        <button onClick={handleDownloadPDF} disabled={isGeneratingPdf} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:bg-gray-400 transition-colors">
                            {isGeneratingPdf ? (<svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>) : (<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>)}
                            PDF 저장
                        </button>
                        <button onClick={onClose} aria-label="운송 효율 분석 닫기" title="닫기" className="text-gray-400 hover:text-gray-600 text-2xl px-2">&times;</button>
                    </div>
                </div>
                
                <div ref={printRef} className="p-6 overflow-y-auto custom-scrollbar bg-white flex-grow">
                    {renderSplitAnalysis()}
                    {recommend()}
                    <h3 className="font-bold text-gray-700 mb-3 border-t pt-6">박스 수량별 단가 변화표</h3>
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full text-sm text-center border-collapse">
                            <thead className="bg-gray-100 text-gray-600 sticky top-0">
                                <tr><th className="p-2 border">박스수</th><th className="p-2 border">부대비용(상품가 제외, 원)</th><th className="p-2 border bg-blue-50 text-blue-800">개당 최종원가(원)</th><th className="p-2 border">비고</th></tr>
                            </thead>
                            <tbody>
                                {data.map((row, idx) => {
                                    if (!showAllBoxes && currentIdx >= 0 && (idx < currentIdx - BOX_WINDOW || idx > currentIdx + BOX_WINDOW)) return null;
                                    const isCurrent = row.boxes === currentItem?.boxes;
                                    const isMin = row.boxes === 1;
                                    const minCbmVal = settings.common.minCbm || 1;
                                    const isUnderMinCbm = row.cbm < minCbmVal; 
                                    return (
                                        <tr key={idx} className={`${isCurrent ? 'bg-emerald-50 border-emerald-200 font-bold' : 'hover:bg-gray-50'} border-b transition-colors`}>
                                            <td className="p-2 border">{row.boxes} {isCurrent && <span className="block text-[10px] text-emerald-600 font-bold">(현재)</span>}</td>
                                            <td className="p-2 border text-gray-600">{formatCurrency(row.totalCost)} {isUnderMinCbm && <div className="text-[10px] text-orange-400">최소CBM 적용됨</div>}</td>
                                            <td className="p-2 border font-semibold text-gray-800 bg-blue-50/30">{formatCurrency(row.finalCostPerUnit)}</td>
                                            <td className="p-2 border text-xs text-gray-500">{isMin && <span className="text-red-500 font-bold">최대 비용</span>}{!isMin && idx > 0 && row.finalCostPerUnit < data[idx-1].finalCostPerUnit && <span className="text-emerald-500">▼ 절감</span>}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {boxHidden > 0 && (
                        <button type="button" data-pdf-hide onClick={() => setShowAllBoxes(v => !v)} aria-expanded={showAllBoxes} className="mt-2 text-sm font-semibold text-emerald-700 hover:text-emerald-600 underline">
                            {showAllBoxes ? '현재 앞뒤만 보기' : `전체 보기 (${data.length}줄)`}
                        </button>
                    )}
                    <div className="mt-4 text-right text-xs text-gray-400">Generated by 비용계산기 | {new Date().toLocaleDateString()}</div>
                </div>
            </div>
        </div>,
        document.body
    );
};