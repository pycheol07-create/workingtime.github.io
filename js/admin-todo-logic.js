// === js/admin-todo-logic.js ===
import * as State from './state.js';
import { showToast } from './utils.js';
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 헬퍼: ID 생성
const createId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

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
        showToast("저장 중 오류가 발생했습니다.", true);
    }
};

// 3. 리스트 렌더링
export const renderAdminTodoList = () => {
    const listEl = document.getElementById('admin-todo-list');
    if (!listEl) return;

    const todos = State.appState.adminTodos || [];
    listEl.innerHTML = '';

    if (todos.length === 0) {
        listEl.innerHTML = '<li class="text-center text-gray-400 text-xs py-10">등록된 할 일이 없습니다.<br>새로운 업무를 추가해보세요!</li>';
        return;
    }

    // 미완료 상단, 완료 하단 정렬
    const sortedTodos = [...todos].sort((a, b) => {
        if (a.completed === b.completed) return b.createdAt - a.createdAt; // 최신순
        return a.completed ? 1 : -1;
    });

    sortedTodos.forEach(todo => {
        const li = document.createElement('li');
        li.className = `flex items-center justify-between p-3 rounded-lg border transition ${todo.completed ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-300 shadow-sm hover:border-indigo-300'}`;
        
        li.innerHTML = `
            <div class="flex items-center gap-3 flex-grow min-w-0 cursor-pointer todo-item-click" data-id="${todo.id}">
                <div class="flex-shrink-0 text-xl">
                    ${todo.completed ? '✅' : '⬜'}
                </div>
                <span class="text-sm truncate ${todo.completed ? 'text-gray-400 line-through' : 'text-gray-800 font-medium'}">
                    ${todo.text}
                </span>
            </div>
            <button class="delete-todo-btn text-gray-400 hover:text-red-500 p-1 transition flex-shrink-0" data-id="${todo.id}" title="삭제">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
            </button>
        `;
        listEl.appendChild(li);
    });
};

// 4. 액션: 추가
export const addTodo = async (text) => {
    if (!text.trim()) {
        showToast("내용을 입력해주세요.", true);
        return;
    }
    const newTodo = {
        id: createId(),
        text: text.trim(),
        completed: false,
        createdAt: Date.now()
    };
    State.appState.adminTodos.push(newTodo);
    renderAdminTodoList();
    await saveAdminTodos();
};

// 5. 액션: 토글 (완료/미완료)
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