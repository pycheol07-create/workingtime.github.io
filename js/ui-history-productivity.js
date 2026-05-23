// === js/ui-history-productivity.js ===
import * as State from './state.js';

let productivityChartInstance = null;

export function renderProductivityTab(filteredData, appConfig) {
    const taskTypes = ['국내배송', '중국제작', '직진배송'];
    const summary = {
        '종합': { duration: 0, qty: 0 },
        '국내배송': { duration: 0, qty: 0 },
        '중국제작': { duration: 0, qty: 0 },
        '직진배송': { duration: 0, qty: 0 }
    };

    const wageMap = { ...(appConfig.memberWages || {}) };
    let nonWorkDurationMin = 0;
    let nonWorkCost = 0;

    // 1. 데이터 집계 및 파트별 UPH 계산
    filteredData.forEach(day => {
        // 비업무시간 집계
        let dayTotalWork = 0;
        (day.workRecords || []).forEach(r => {
            dayTotalWork += (r.duration || 0);
            
            // 파트별 시간 분류
            const matchedType = taskTypes.find(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
            if (matchedType) {
                summary[matchedType].duration += (r.duration || 0);
            }
            summary['종합'].duration += (r.duration || 0);
        });

        // 파트별 수량 분류
        Object.entries(day.taskQuantities || {}).forEach(([taskKey, qty]) => {
            const numQty = Number(qty) || 0;
            const matchedType = taskTypes.find(t => taskKey.includes(t));
            if (matchedType) {
                summary[matchedType].qty += numQty;
            }
            summary['종합'].qty += numQty;
        });

        // 표준 노동시간(1인당 480분) 대비 누수시간 역산 (COQ 산출용)
        const uniqueMembers = new Set((day.workRecords || []).map(r => r.member));
        const potentialMinutes = uniqueMembers.size * 480;
        if (potentialMinutes > dayTotalWork) {
            const loss = potentialMinutes - dayTotalWork;
            nonWorkDurationMin += loss;
            nonWorkCost += (loss / 60) * 10000; // 평균 시급 10,000원 가정
        }
    });

    // UPM, UPH, UPD 계산 및 화면 출력
    const setProductivityText = (typeId, data) => {
        const mins = data.duration;
        const hours = mins / 60;
        
        const upm = mins > 0 ? (data.qty / mins) : 0;
        const uph = hours > 0 ? (data.qty / hours) : 0;
        const upd = uph * 8; // 일당 (8시간 기준)

        const upmEl = document.getElementById(`prod-upm-${typeId}`);
        const uphEl = document.getElementById(`prod-uph-${typeId}`);
        const updEl = document.getElementById(`prod-upd-${typeId}`);

        if (upmEl) upmEl.textContent = upm > 0 ? `${upm.toFixed(2)} 개` : '0';
        if (uphEl) uphEl.textContent = uph > 0 ? `${uph.toFixed(1)} 개` : '0';
        if (updEl) updEl.textContent = upd > 0 ? `${Math.round(upd).toLocaleString()} 개` : '0';
    };

    setProductivityText('general', summary['종합']);
    setProductivityText('domestic', summary['국내배송']);
    setProductivityText('china', summary['중국제작']);
    setProductivityText('direct', summary['직진배송']);

    // 2. 리소스 투입 대비 효율 차트 (시각화)
    const ctx = document.getElementById('chart-productivity-efficiency');
    if (ctx) {
        if (productivityChartInstance) productivityChartInstance.destroy();

        const colors = { '국내배송': '#10b981', '중국제작': '#ef4444', '직진배송': '#a855f7' };
        const datasets = taskTypes.map(type => {
            const hours = summary[type].duration / 60;
            return {
                label: type,
                data: [{ x: parseFloat(hours.toFixed(1)), y: summary[type].qty, r: hours > 0 ? 15 : 0 }],
                backgroundColor: colors[type] || '#3b82f6'
            };
        });

        productivityChartInstance = new Chart(ctx, {
            type: 'bubble',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: '총 투입 시간 (Hours)', font: { weight: 'bold' } }, beginAtZero: true },
                    y: { title: { display: true, text: '총 생산량 (개수)', font: { weight: 'bold' } }, beginAtZero: true }
                },
                plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.x}시간, ${ctx.raw.y}개 생산` } } }
            }
        });
    }

    // 3. COQ 품질 비용 테이블 구성 (유지)
    const tbody = document.getElementById('prod-coq-table-body');
    if (tbody) {
        tbody.innerHTML = `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">⏳ 대기 및 비업무 시간 누수</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">${Math.round(nonWorkDurationMin).toLocaleString()} 분</td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round(nonWorkCost).toLocaleString()} 원</td>
            </tr>
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">📦 불량 검수 및 조정 Overhead</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">${Math.round(summary['종합'].duration * 0.05)} 분</td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round((summary['종합'].duration * 0.05 / 60) * 11000).toLocaleString()} 원</td>
            </tr>
        `;
    }
}