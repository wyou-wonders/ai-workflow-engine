import "./styles.css";
import { initializeAuth } from "./auth.js";
import { renderApp } from "./ui/common.js";
import { fetchInitialUserData } from "./ui/user.js";
import { setState, setRenderCallback } from "./state.js"; // --- FIX ---: setRenderCallback 임포트

async function startApp() {
  // --- FIX ---
  // state.js에 renderApp 함수를 콜백으로 등록합니다.
  // 이제부터 setState가 호출되면 자동으로 renderApp이 실행됩니다.
  setRenderCallback(renderApp);

  setState({ ui: { isLoading: true } });

  const isAuthenticated = await initializeAuth();

  if (isAuthenticated) {
    try {
      await fetchInitialUserData();
    } catch (error) {
      console.error("초기 데이터 로딩에 실패했습니다:", error);
    }
  }

  setState({ ui: { isLoading: false } });
  // 초기 렌더링은 startApp 마지막에서 직접 호출하지 않고, 마지막 setState에 의해 트리거됩니다.
}

document.addEventListener("DOMContentLoaded", startApp);
