// === js/admin-todo-logic.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼: ID 생성
const createId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// 헬퍼: 날짜 포맷 (MM/DD HH:mm)
const formatDateTimeShort = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${m}/${d} ${h}:${min}`;
};

// Firestore 참조
const getTodoDocRef = () => doc(State.db, 'artifacts', 'team-work-logger-v2', 'persistent_data', 'adminTodos');

// 1. 데이터 로드
export const loadAdminTodos = async () => {
    try {
        const docSnap = await getDoc(getTodoDocRef());
        if (docSnap.exists()) {
            State.appState.adminTodos = docSnap.data().tasks || [];
        } else {
            State.appState.adminTodos = [];
        }
        renderAdminTodoList();
    } catch (e) {
        console.error("Error loading admin todos:", e);
        showToast("할 일 목록을 불러오지 못했습니다.", true);
    }
};

// 2. 데이터 저장
const saveAdminTodos = async () => {
    try {
        await setDoc(getTodoDocRef(), { tasks: State.appState.adminTodos }, { merge: true });
    } catch (e) {
        console.error("Error saving admin todos:", e);
        // showToast("저장 중 오류가 발생했습니다.", true); // 잦은 저장 알림 방지
    }
};

// 3. 리스트 렌더링
export const renderAdminTodoList = () => {
    const listEl = document.getElementById('admin-todo-list');
    if (!listEl) return;

    const todos = State.appState.adminTodos || [];
    listEl.innerHTML = '';

    if (todos.length === 0) {
        listEl.innerHTML = '<li class="text-center text-gray-400 text-xs py-10">등록된 할 일이 없습니다.<br>일정을 설정하여 추가해보세요!</li>';
        return;
    }

    // 정렬: 미완료 상단 > 날짜 임박순 > 최신순
    const sortedTodos = [...todos].sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        // 둘 다 미완료이거나 둘 다 완료인 경우
        const dateA = a.dueDateTime ? new Date(a.dueDateTime).getTime() : Infinity;
        const dateB = b.dueDateTime ? new Date(b.dueDateTime).getTime() : Infinity;
        if (dateA !== dateB) return dateA - dateB; // 날짜 빠른 순
        return b.createdAt - a.createdAt; // 생성 최신 순
    });

    const now = new Date();

    sortedTodos.forEach(todo => {
        const li = document.createElement('li');
        li.className = `flex items-center justify-between p-3 rounded-lg border transition ${todo.completed ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-300 shadow-sm hover:border-indigo-300'}`;
        
        let dateBadge = '';
        if (todo.dueDateTime) {
            const dueDate = new Date(todo.dueDateTime);
            const isOverdue = !todo.completed && dueDate < now;
            const dateClass = isOverdue ? 'text-red-600 bg-red-50 border-red-200' : (todo.completed ? 'text-gray-400 bg-gray-50 border-gray-200' : 'text-blue-600 bg-blue-50 border-blue-200');
            const icon = isOverdue ? '🚨' : '⏰';
            dateBadge = `<span class="text-[10px] px-1.5 py-0.5 rounded border ml-2 whitespace-nowrap ${dateClass}">${icon} ${formatDateTimeShort(todo.dueDateTime)}</span>`;
        }

        li.innerHTML = `
            <div class="flex flex-col flex-grow min-w-0 cursor-pointer todo-item-click" data-id="${todo.id}">
                <div class="flex items-center">
                    <div class="flex-shrink-0 text-lg mr-2">
                        ${todo.completed ? '✅' : '⬜'}
                    </div>
                    <span class="text-sm truncate ${todo.completed ? 'text-gray-400 line-through' : 'text-gray-800 font-medium'}">
                        ${todo.text}
                    </span>
                </div>
                ${dateBadge ? `<div class="ml-7 mt-1">${dateBadge}</div>` : ''}
            </div>
            <button class="delete-todo-btn text-gray-400 hover:text-red-500 p-2 transition flex-shrink-0 ml-2" data-id="${todo.id}" title="삭제">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        `;
        listEl.appendChild(li);
    });
};

// 4. 액션: 추가 (일정 포함)
export const addTodo = async (text, dateStr) => {
    if (!text.trim()) {
        showToast("내용을 입력해주세요.", true);
        return;
    }
    const newTodo = {
        id: createId(),
        text: text.trim(),
        completed: false,
        dueDateTime: dateStr || null, // 'YYYY-MM-DDTHH:mm'
        alertSent: false, // 알림 발송 여부 초기화
        createdAt: Date.now()
    };
    State.appState.adminTodos.push(newTodo);
    renderAdminTodoList();
    await saveAdminTodos();
};

// 5. 액션: 토글
export const toggleTodo = async (id) => {
    const todo = State.appState.adminTodos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        renderAdminTodoList();
        await saveAdminTodos();
    }
};

// 6. 액션: 삭제
export const deleteTodo = async (id) => {
    if (!confirm("이 할 일을 삭제하시겠습니까?")) return;
    State.appState.adminTodos = State.appState.adminTodos.filter(t => t.id !== id);
    renderAdminTodoList();
    await saveAdminTodos();
};

// ✅ [신규] 7. 알림 체크 로직 (app.js에서 주기적으로 호출)
export const checkAdminTodoNotifications = async () => {
    const todos = State.appState.adminTodos || [];
    const now = new Date();
    let hasUpdates = false;

    todos.forEach(todo => {
        // 미완료, 일정 있음, 아직 알림 안 보냄, 현재 시간이 마감 시간 지남
        if (!todo.completed && todo.dueDateTime && !todo.alertSent) {
            const dueDate = new Date(todo.dueDateTime);
            if (dueDate <= now) {
                // 알림 발송
                showToast(`🔔 [알림] 할 일 마감: "${todo.text}"`, false); // false = green toast, true = red
                // 브라우저 알림 (옵션)
                if (Notification.permission === "granted") {
                    new Notification("업무 마감 알림", { body: todo.text });
                }
                
                todo.alertSent = true; // 알림 보냄 처리
                hasUpdates = true;
            }
        }
    });

    if (hasUpdates) {
        renderAdminTodoList(); // 🚨 아이콘 업데이트 등을 위해 렌더링
        await saveAdminTodos(); // 알림 상태 저장
    }
};