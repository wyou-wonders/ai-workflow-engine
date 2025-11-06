let renderCallback = () => {};

export function setRenderCallback(callback) {
  renderCallback = callback;
}

const initialState = {
  token: null,
  user: null,
  llmModels: {},
  isUserMode: true,
  templates: [],
  workflows: [],
  bookmarkedWorkflows: [],
  admin: {
    allTemplates: [],
    users: [],
    apiKeys: {},
    selectedUserId: null,
    selectedUserPermissions: [],
    userSearchTerm: "",
    permissionTemplateSearchTerm: "",
    errorLogs: [],
    errorLogsPage: 1,
    totalErrorLogs: 0,
    viewingErrorLog: null,
    llmLogs: [],
    llmLogsPage: 1,
    totalLlmLogs: 0,
    viewingLlmLogId: null,
    viewingLlmLogDetail: null,
  },
  workflow: {
    activeTemplate: null,
    currentWorkflowId: null,
    executionContext: null,
  },
  ui: {
    isLoading: true,
    errorMessage: "",
    isHistoryVisible: false,
    activeSidebarTab: "history",
  },
};

const state = JSON.parse(JSON.stringify(initialState));

export function setState(newState) {
  Object.keys(newState).forEach((key) => {
    if (
      typeof newState[key] === "object" &&
      newState[key] !== null &&
      !Array.isArray(newState[key])
    ) {
      state[key] = { ...state[key], ...newState[key] };
    } else {
      state[key] = newState[key];
    }
  });

  // --- FIX ---
  // requestAnimationFrame을 제거하고, 상태 변경 후 즉시 렌더링 콜백을 호출합니다.
  // 이것이 가장 직관적이고 예측 가능한 방식입니다.
  renderCallback();
}

export function getState() {
  return JSON.parse(JSON.stringify(state));
}

export function getInitialState() {
  return JSON.parse(JSON.stringify(initialState));
}
