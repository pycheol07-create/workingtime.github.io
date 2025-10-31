// === js/listeners/auth.js ===

import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { showToast } from '../utils.js';

export function attachAuthListeners() {
    const auth = getAuth(); // Firebase auth 인스턴스 가져오기

    // --- 1. 로그인 폼 ---
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
          e.preventDefault(); 
          
          const loginEmailInput = document.getElementById('login-email');
          const loginPasswordInput = document.getElementById('login-password');
          const loginErrorMsg = document.getElementById('login-error-message');
          const loginSubmitBtn = document.getElementById('login-submit-btn');
          const loginButtonText = document.getElementById('login-button-text');
          const loginButtonSpinner = document.getElementById('login-button-spinner');

          const email = loginEmailInput.value;
          const password = loginPasswordInput.value;

          if (!email || !password) {
              if (loginErrorMsg) {
                  loginErrorMsg.textContent = '이메일과 비밀번호를 모두 입력하세요.';
                  loginErrorMsg.classList.remove('hidden');
              }
              return;
          }

          if (loginSubmitBtn) loginSubmitBtn.disabled = true;
          if (loginButtonText) loginButtonText.classList.add('hidden');
          if (loginButtonSpinner) loginButtonSpinner.classList.remove('hidden');
          if (loginErrorMsg) loginErrorMsg.classList.add('hidden');

          try {
              await signInWithEmailAndPassword(auth, email, password);
              // 성공 시 onAuthStateChanged 리스너가 감지 (init.js)
          } catch (error) {
              console.error('Login failed:', error.code);
              if (loginErrorMsg) {
                  if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                      loginErrorMsg.textContent = '이메일 또는 비밀번호가 잘못되었습니다.';
                  } else if (error.code === 'auth/invalid-email') {
                      loginErrorMsg.textContent = '유효하지 않은 이메일 형식입니다.';
                  } else {
                      loginErrorMsg.textContent = '로그인에 실패했습니다. 다시 시도하세요.';
                  }
                  loginErrorMsg.classList.remove('hidden');
              }
          } finally {
              if (loginSubmitBtn) loginSubmitBtn.disabled = false;
              if (loginButtonText) loginButtonText.classList.remove('hidden');
              if (loginButtonSpinner) loginButtonSpinner.classList.add('hidden');
          }
      });
    }

    // --- 2. 로그아웃 버튼 (데스크탑) ---
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await signOut(auth);
          showToast('로그아웃되었습니다.');
          // onAuthStateChanged 리스너가 감지 (init.js)
        } catch (error) {
          console.error('Logout failed:', error);
          showToast('로그아웃에 실패했습니다.', true);
        }
      });
    }

    // --- 3. 로그아웃 버튼 (모바일) ---
    const logoutBtnMobile = document.getElementById('logout-btn-mobile');
    if (logoutBtnMobile) {
      logoutBtnMobile.addEventListener('click', async () => {
        try {
          await signOut(auth);
          showToast('로그아웃되었습니다.');
        } catch (error) {
          console.error('Logout failed (mobile):', error);
          showToast('로그아웃에 실패했습니다.', true);
        }
      });
    }
}