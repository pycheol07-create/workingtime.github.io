// 'import'와 'export' 키워드를 모두 삭제합니다.

// --- From components/ResultCard.tsx ---
const ResultCard = ({ results }) => {
  // [수정됨] useState -> React.useState
  const [isTaxesExpanded, setIsTaxesExpanded] = React.useState(false);
  const [isFeesExpanded, setIsFeesExpanded] = React.useState(false);

  const formatCurrency = (value, currency = 'KRW') => {
    // Ensure value is a number, default to 0 if not
    const numericValue = typeof value === 'number' && !isNaN(value) ? value : 0;
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: currency === 'USD' ? 2 : 0,
    }).format(numericValue);
  };

  const formatNumber = (value, unit = '', digits = 2) => {
      // Ensure value is a number, default to 0 if not
      const numericValue = typeof value === 'number' && !isNaN(value) ? value : 0;
      return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(numericValue)} ${unit}`;
  }

  const AnimatedNumber = ({ value, formatter }) => {
      // Ensure value passed to formatter is valid
      const numericValue = typeof value === 'number' && !isNaN(value) ? value : 0;
      return <>{formatter(numericValue)}</>;
  };

  const ResultItem = ({ label, value, icon, isSub }) => (
    <div className={`flex items-center justify-between py-3 ${isSub ? 'pl-10' : ''}`}>
      <div className="flex items-center min-w-0"> {/* Added min-w-0 for flex shrink */}
        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${isSub ? 'bg-slate-100' : 'bg-emerald-100'}`}>
          {icon}
        </div>
        {/* Added truncate for long labels if needed */}
        <span className={`ml-4 font-medium truncate ${isSub ? 'text-sm text-gray-600' : 'text-gray-800'}`}>{label}</span>
      </div>
      {/* Added text-right and whitespace-nowrap */}
      <span className={`font-semibold text-right whitespace-nowrap ${isSub ? 'text-sm text-gray-700' : 'text-gray-900'}`}>{value}</span>
    </div>
  );

  const Icons = {
      Price: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
      Shipping: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 2h8a1 1 0 001-1z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 16h2a2 2 0 002-2V6a2 2 0 00-2-2h-1" /></svg>,
      Tax: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 14l-6-6m5.5.5h.01M4.99 9h.01" /></svg>,
      Fee: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
      Tariff: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7.014A8.003 8.003 0 0117.657 18.657z" /></svg>,
      Vat: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>,
      DocsFee: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
      CoFee: <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 4h3m-3 4h3" /></svg>,
      ChevronDown: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>,
      PriceTag: <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V3z" /></svg>,
      Receipt: <ReceiptIcon />, // Use the ReceiptIcon component
  };
  
  return (
    <div className="bg-gradient-to-br from-emerald-50/60 to-white/60 backdrop-blur-xl p-6 md:p-8 rounded-2xl shadow-lg border border-slate-200 w-full animate-fade-in-slide-up">
          <div className="text-center mb-6">
              <p className="text-lg text-gray-600">최종 통관 비용</p>
              <p className="text-5xl font-extrabold text-emerald-600 tracking-tight my-2">
                  <AnimatedNumber value={results.totalCost} formatter={formatCurrency} />
              </p>
          </div>
          
        <div className="space-y-1 divide-y divide-slate-200">
          <ResultItem 
              label="총 상품가" 
              value={<AnimatedNumber value={results.totalProductPriceKRW} formatter={formatCurrency} />} 
              icon={Icons.Price}
          />
          <ResultItem 
              label="해운비" 
              value={<AnimatedNumber value={results.oceanFreightKRW} formatter={formatCurrency} />} 
              icon={Icons.Shipping}
          />
          
          {/* --- NEW ITEM: Commission --- */}
          {results.commissionAmountKRW > 0 && (
              <ResultItem 
                  label="수수료" 
                  value={<AnimatedNumber value={results.commissionAmountKRW} formatter={formatCurrency} />} 
                  icon={Icons.Receipt} 
              />
          )}
          {/* --- END NEW --- */}
          
          {results.costPerItem > 0 && (
              <ResultItem 
                  label="개당 최종 원가" 
                  value={<AnimatedNumber value={results.costPerItem} formatter={formatCurrency} />} 
                  icon={Icons.PriceTag}
              />
          )}

          {/* Tax Group */}
          <div>
              <div 
                  onClick={() => setIsTaxesExpanded(!isTaxesExpanded)}
                  className="flex items-center justify-between py-3 md:cursor-auto cursor-pointer"
                  role="button"
                  aria-expanded={isTaxesExpanded}
              >
                  <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-emerald-100">
                          {Icons.Tax}
                      </div>
                      <span className="ml-4 font-medium text-gray-800">총 세금</span>
                  </div>
                  <div className="flex items-center">
                      <span className="font-semibold text-gray-900">
                          <AnimatedNumber value={results.totalTaxes} formatter={formatCurrency} />
                      </span>
                      <span className={`ml-2 transform transition-transform duration-200 md:hidden ${isTaxesExpanded ? 'rotate-180' : ''}`}>
                          {Icons.ChevronDown}
                      </span>
                  </div>
              </div>
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isTaxesExpanded ? 'max-h-40' : 'max-h-0'} md:max-h-40`}>
                  <ResultItem 
                      label="관세" 
                      value={<AnimatedNumber value={results.tariffAmount} formatter={formatCurrency} />} 
                      icon={Icons.Tariff}
                      isSub={true}
                  />
                  <ResultItem 
                      label="부가가치세" 
                      value={<AnimatedNumber value={results.vatAmount} formatter={formatCurrency} />} 
                      icon={Icons.Vat}
                      isSub={true}
                  />
              </div>
          </div>
          
          {/* Fee Group */}
          <div>
              <div 
                  onClick={() => setIsFeesExpanded(!isFeesExpanded)}
                  className="flex items-center justify-between py-3 md:cursor-auto cursor-pointer"
                  role="button"
                  aria-expanded={isFeesExpanded}
              >
                  <div className="flex items-center">
                      <div className="flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center bg-emerald-100">
                          {Icons.Fee}
                      </div>
                      <span className="ml-4 font-medium text-gray-800">기타 고정 수수료</span> {/* Label slightly changed */}
                  </div>
                  <div className="flex items-center">
                      <span className="font-semibold text-gray-900">
                          <AnimatedNumber value={results.docsFee + results.coFee} formatter={formatCurrency} />
                      </span>
                      <span className={`ml-2 transform transition-transform duration-200 md:hidden ${isFeesExpanded ? 'rotate-180' : ''}`}>
                          {Icons.ChevronDown}
                      </span>
                  </div>
              </div>
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isFeesExpanded ? 'max-h-40' : 'max-h-0'} md:max-h-40`}>
                  <ResultItem 
                      label="서류비" 
                      value={<AnimatedNumber value={results.docsFee} formatter={formatCurrency} />} 
                      icon={Icons.DocsFee}
                      isSub={true}
                  />
                  <ResultItem 
                      label="CO발급비" 
                      value={<AnimatedNumber value={results.coFee} formatter={formatCurrency} />} 
                      icon={Icons.CoFee}
                      isSub={true}
                  />
              </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-dashed border-slate-300">
          <h3 className="font-semibold text-gray-700 mb-3">참고 정보</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-gray-600">
              <div className="flex justify-between"><span className="font-medium text-gray-500">과세표준:</span> <span className="font-mono">{formatCurrency(results.taxableBase)}</span></div>
              <div className="flex justify-between"><span className="font-medium text-gray-500">총 상품가(USD):</span> <span className="font-mono">{formatCurrency(results.totalProductPriceUSD, 'USD')}</span></div>
              <div className="flex justify-between"><span className="font-medium text-gray-500">총 무게:</span> <span className="font-mono">{formatNumber(results.totalWeight, 'kg')}</span></div>
              <div className="flex justify-between"><span className="font-medium text-gray-500">CBM:</span> <span className="font-mono">{formatNumber(results.cbm, '', 4)}</span></div>
          </div>
        </div>
    </div>
  );
};