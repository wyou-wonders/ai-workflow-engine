import { handleLogin, handleRegister } from "../auth.js";
import { getState } from "../state.js";
import { renderApp } from "./common.js";

export function renderAuthView() {
  const { ui } = getState();
  return `
        <div id="auth-overlay">
            <div class="auth-card">
                <div id="login-view">
                    <h2 class="text-title font-bold text-center mb-6">로그인</h2>
                    <form id="login-form" class="space-y-4">
                        <input id="login-username" type="text" placeholder="사용자 이름" class="form-input" required>
                        <input id="login-password" type="password" placeholder="비밀번호" class="form-input" required>
                        <button type="submit" class="btn btn-primary w-full !h-12 !text-base">로그인</button>
                    </form>
                    <p class="text-center text-sm mt-6">계정이 없으신가요? <button id="show-register-btn" class="font-semibold text-primaryLight hover:underline">회원가입</button></p>
                </div>
                <div id="register-view" class="hidden">
                    <h2 class="text-title font-bold text-center mb-6">회원가입</h2>
                    <form id="register-form" class="space-y-4">
                        <input id="register-username" type="text" placeholder="사용자 이름" class="form-input" required>
                        <input id="register-password" type="password" placeholder="비밀번호" class="form-input" required>
                        <button type="submit" class="btn btn-primary w-full !h-12 !text-base">가입하기</button>
                    </form>
                    <p class="text-center text-sm mt-6">이미 계정이 있으신가요? <button id="show-login-btn" class="font-semibold text-primaryLight hover:underline">로그인</button></p>
                </div>
                <p id="auth-error-message" class="text-center text-error font-semibold mt-4 min-h-[1.2em]">${ui.errorMessage || ""}</p>
            </div>
        </div>
    `;
}

export function attachAuthEventListeners() {
  const loginView = document.getElementById("login-view");
  const registerView = document.getElementById("register-view");
  const showRegisterBtn = document.getElementById("show-register-btn");
  const showLoginBtn = document.getElementById("show-login-btn");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const errorMessageElement = document.getElementById("auth-error-message");

  const setErrorMessage = (message) => {
    if (errorMessageElement) {
      errorMessageElement.textContent = message;
    }
    // 에러 메시지 표시는 상태와 무관하게 직접 제어하므로 setState는 필요 없음
  };

  if (showRegisterBtn) {
    showRegisterBtn.addEventListener("click", () => {
      loginView.classList.add("hidden");
      registerView.classList.remove("hidden");
      setErrorMessage("");
    });
  }

  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      loginView.classList.remove("hidden");
      registerView.classList.add("hidden");
      setErrorMessage("");
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setErrorMessage("");
      const username = loginForm.querySelector("#login-username").value;
      const password = loginForm.querySelector("#login-password").value;
      try {
        await handleLogin(username, password);
        // 성공 시에만 전체 화면 전환
        renderApp();
      } catch (error) {
        // 실패 시, DOM을 직접 제어. renderApp() 호출 안 함.
        setErrorMessage(error.message);
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setErrorMessage("");
      const username = registerForm.querySelector("#register-username").value;
      const password = registerForm.querySelector("#register-password").value;
      try {
        const result = await handleRegister(username, password);
        if (result && result.success) {
          alert("회원가입 성공! 로그인해주세요.");
          loginView.classList.remove("hidden");
          registerView.classList.add("hidden");
          loginForm.querySelector("#login-username").value = result.username;
          loginForm.querySelector("#login-password").value = "";
        }
      } catch (error) {
        // 실패 시, DOM을 직접 제어. renderApp() 호출 안 함.
        setErrorMessage(error.message);
      }
    });
  }
}
