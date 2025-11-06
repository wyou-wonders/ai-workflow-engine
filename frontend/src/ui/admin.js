import {
  apiCall,
  getUserPermissions,
  updateUserPermissions,
  updateUserRole,
} from "../api.js";
import { getState, setState } from "../state.js";
import { marked } from "marked";

let currentLogoDataURL = "";
let activeTab = "templates";
const LOGS_PER_PAGE = 20;

let logDetailActiveTab = "request";
const logDetailViewAsJson = {
  request: false,
  response: false,
};

function formatToKoreanTime(utcTimestamp) {
  if (!utcTimestamp) return "N/A";
  const date = new Date(utcTimestamp.replace(" ", "T") + "Z");
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Seoul",
  });
}

function renderPaginationControls(
  totalItems,
  currentPage,
  perPage,
  actionPrefix,
) {
  const totalPages = Math.ceil(totalItems / perPage);
  if (totalPages <= 1) return "";

  return `
        <div class="flex justify-between items-center mt-4">
            <span class="text-sm text-info">
                총 ${totalItems}개 중 ${(currentPage - 1) * perPage + 1} - ${Math.min(currentPage * perPage, totalItems)}
            </span>
            <div class="inline-flex -space-x-px rounded-md shadow-sm text-sm">
                <button 
                    data-action="${actionPrefix}-prev" 
                    class="btn btn-secondary !rounded-r-none" 
                    ${currentPage === 1 ? "disabled" : ""}>
                    이전
                </button>
                <button 
                    data-action="${actionPrefix}-next" 
                    class="btn btn-secondary !rounded-l-none" 
                    ${currentPage >= totalPages ? "disabled" : ""}>
                    다음
                </button>
            </div>
        </div>
    `;
}

export async function fetchAdminData() {
  try {
    const { user } = getState();
    const promises = [
      apiCall("/templates"),
      apiCall("/settings/keys"),
      apiCall("/models"),
    ];
    if (user.role === "master") {
      promises.push(apiCall("/users"));
    }
    const [templates, apiKeys, llmModels, users] = await Promise.all(promises);

    const currentAdminState = getState().admin;
    let selectedUserId = currentAdminState.selectedUserId;

    if (
      users &&
      (!selectedUserId || !users.some((u) => u.id === selectedUserId))
    ) {
      selectedUserId = users.length > 0 ? users[0].id : null;
    }

    setState({
      llmModels: llmModels || {},
      admin: {
        allTemplates: templates || [],
        apiKeys: apiKeys || {},
        users: users || [],
        selectedUserId,
      },
    });

    if (getState().admin.selectedUserId) {
      await fetchSelectedUserPermissions();
    }
  } catch (error) {
    alert(`관리자 데이터 로딩 실패: ${error.message}`);
  }
}

async function fetchSelectedUserPermissions() {
  const { admin } = getState();
  if (!admin.selectedUserId) return;
  try {
    const permissions = await getUserPermissions(admin.selectedUserId);
    setState({ admin: { selectedUserPermissions: permissions || [] } });
  } catch (error) {
    alert(`사용자 권한 정보 로딩 실패: ${error.message}`);
  }
}

async function fetchErrorLogs(page = 1) {
  try {
    const data = await apiCall(
      `/logs/errors?page=${page}&limit=${LOGS_PER_PAGE}`,
    );
    setState({
      admin: {
        errorLogs: data.logs || [],
        totalErrorLogs: data.total || 0,
        errorLogsPage: data.page || 1,
      },
    });
  } catch (error) {
    alert(`오류 로그를 불러오는 데 실패했습니다: ${error.message}`);
  }
}

async function fetchLlmLogs(page = 1) {
  try {
    const data = await apiCall(`/logs/llm?page=${page}&limit=${LOGS_PER_PAGE}`);
    setState({
      admin: {
        llmLogs: data.logs || [],
        totalLlmLogs: data.total || 0,
        llmLogsPage: data.page || 1,
      },
    });
  } catch (error) {
    alert(`AI 사용 로그를 불러오는 데 실패했습니다: ${error.message}`);
  }
}

function getTemplateFromForm() {
  const { llmModels } = getState();
  const name = document.getElementById("template-name")?.value.trim();
  if (!name) {
    alert("템플릿 이름은 필수입니다.");
    return null;
  }
  const steps = Array.from(
    document.querySelectorAll("#step-list .step-item"),
  ).map((div) => {
    const stepModel = div.querySelector(".step-model").value;
    const stepData = {
      name: div.querySelector(".step-name").value,
      instruction: div.querySelector(".step-instruction").value,
      prompt: div.querySelector(".step-prompt").value,
    };
    if (stepModel !== "global") {
      stepData.model = stepModel;
    }
    return stepData;
  });
  const templateIdStore = document.getElementById("template-id-store");
  const llmSelect = document.getElementById("llm-select");
  const globalInstruction = document.getElementById("global-instruction");

  return {
    id: templateIdStore ? templateIdStore.value : null,
    name,
    config: {
      logoData: currentLogoDataURL,
      model: llmSelect
        ? llmSelect.value
        : Object.values(llmModels)[0]?.[0]?.key || "",
      globalInstruction: globalInstruction ? globalInstruction.value : "",
      steps,
    },
  };
}

function getTemplateSchemaFromForm() {
  const templateData = getTemplateFromForm();
  if (!templateData) return null;
  const { id, ...schema } = templateData;
  return schema;
}

async function handleSaveTemplate() {
  const templateData = getTemplateFromForm();
  if (!templateData) return;
  const { id, ...payload } = templateData;
  if (!id) {
    alert("새 템플릿은 '새 템플릿으로 저장'을 이용해주세요.");
    return;
  }
  try {
    await apiCall(`/templates/${id}`, { method: "PUT", body: payload });
    alert("템플릿이 업데이트되었습니다.");
    await fetchAdminData();
  } catch (error) {
    alert(`템플릿 저장 실패: ${error.message}`);
  }
}

async function handleCreateNewTemplate() {
  const templateData = getTemplateFromForm();
  if (!templateData) return;
  const { id, ...payload } = templateData;
  try {
    const created = await apiCall("/templates", {
      method: "POST",
      body: payload,
    });
    alert("새 템플릿이 생성되었습니다.");
    await fetchAdminData();
    handleLoadTemplate(created.id);
  } catch (error) {
    alert(`템플릿 생성 실패: ${error.message}`);
  }
}

async function handleDeleteTemplate() {
  const templateId = document.getElementById("template-id-store")?.value;
  if (
    !templateId ||
    !confirm("현재 에디터에서 선택된 템플릿을 정말 삭제하시겠습니까?")
  )
    return;
  try {
    await apiCall(`/templates/${templateId}`, { method: "DELETE" });
    alert("템플릿이 삭제되었습니다.");
    currentLogoDataURL = "";
    await fetchAdminData();
  } catch (error) {
    alert(`템플릿 삭제 실패: ${error.message}`);
  }
}

function handleLoadTemplate(templateId) {
  const { llmModels } = getState();
  const defaultModel = Object.values(llmModels)[0]?.[0]?.key || "";

  if (templateId === -1 || templateId === "-1") {
    populateEditorFromData({
      id: "",
      name: "새 템플릿",
      config: {
        model: defaultModel,
        globalInstruction: "",
        logoData: "",
        steps: [{ name: "1단계", instruction: "", prompt: "" }],
      },
    });
    document
      .querySelectorAll(".template-list-item")
      .forEach((btn) => btn.classList.remove("bg-panelBackground"));
    return;
  }

  const id = parseInt(templateId, 10);
  const { admin } = getState();
  const template = admin.allTemplates.find((t) => t.id === id);

  if (template) {
    document.querySelectorAll(".template-list-item").forEach((btn) => {
      btn.classList.toggle(
        "bg-panelBackground",
        btn.dataset.templateId === String(id),
      );
    });
    populateEditorFromData(template);
  }
}

function populateEditorFromData(templateData) {
  const { llmModels } = getState();
  const defaultModel = Object.values(llmModels)[0]?.[0]?.key || "";
  document.getElementById("template-id-store").value = templateData.id || "";
  document.getElementById("template-name").value = templateData.name || "";
  document.getElementById("llm-select").value =
    templateData.config.model || defaultModel;
  document.getElementById("global-instruction").value =
    templateData.config.globalInstruction || "";

  currentLogoDataURL = templateData.config.logoData || "";
  renderLogoPreview();

  const stepList = document.getElementById("step-list");
  if (stepList) {
    stepList.innerHTML = "";
    if (templateData.config.steps && templateData.config.steps.length > 0) {
      templateData.config.steps.forEach((step) => addStepInput(step));
    } else {
      addStepInput({ name: "1단계", instruction: "", prompt: "" });
    }
  }
}

async function handleSaveApiKeys() {
  const payload = {
    openai_api_key: document.getElementById("openai-api-key").value.trim(),
    google_api_key: document.getElementById("google-api-key").value.trim(),
    anthropic_api_key: document
      .getElementById("anthropic-api-key")
      .value.trim(),
  };
  const filteredPayload = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v),
  );
  if (Object.keys(filteredPayload).length === 0) {
    alert("저장할 키를 입력해주세요.");
    return;
  }
  try {
    await apiCall("/settings/keys", { method: "PUT", body: payload });
    alert("API 키가 저장되었습니다.");
    await fetchAdminData();
  } catch (error) {
    alert(`API 키 저장 실패: ${error.message}`);
  }
}

function addStepInput(step = { name: "", instruction: "", prompt: "" }) {
  const { llmModels } = getState();
  const stepDiv = document.createElement("div");
  stepDiv.className =
    "step-item bg-panelBackground border border-border rounded-card p-4 space-y-3";

  stepDiv.innerHTML = `
        <div class="flex gap-2 items-start">
            <input type="text" class="step-name form-input !p-2 flex-grow" value="${step.name || ""}" placeholder="단계 이름">
            <select class="step-model form-input !p-2 !w-auto text-sm">
                <option value="global" ${!step.model ? "selected" : ""}>전역 모델</option>
                ${Object.entries(llmModels)
                  .map(
                    ([provider, models]) => `
                    <optgroup label="${provider}">
                        ${models.map((model) => `<option value="${provider}__${model.modelId}" ${step.model === `${provider}__${model.modelId}` ? "selected" : ""}>${model.name}</option>`).join("")}
                    </optgroup>
                `,
                  )
                  .join("")}
            </select>
        </div>
        <div>
            <label class="text-xs font-semibold text-primary">사용자 안내문</label>
            <textarea class="step-instruction form-input !p-2 text-sm mt-1" rows="2" placeholder="이 단계에서 사용자에게 보여줄 안내문">${step.instruction || ""}</textarea>
        </div>
        <div>
            <label class="text-xs font-semibold text-primary">프롬프트 (대화형 모드)</label>
            <textarea class="step-prompt form-input !p-2 text-sm mt-1" rows="4" placeholder="이 단계에서 사용자의 입력과 함께 전달될 추가 지시문 (선택 사항)">${step.prompt || ""}</textarea>
        </div>
        <div class="flex items-center justify-end">
            <button class="remove-step-btn text-xs text-error hover:underline">이 단계 삭제</button>
        </div>`;

  document.getElementById("step-list")?.appendChild(stepDiv);
}

async function handleUserSelectionChange(userId) {
  setState({
    admin: {
      selectedUserId: parseInt(userId, 10),
      permissionTemplateSearchTerm: "",
    },
  });
  await fetchSelectedUserPermissions();
}

async function handleSaveUserPermissions() {
  const { admin } = getState();
  const selectedUser = admin.users.find((u) => u.id === admin.selectedUserId);
  if (!selectedUser) return;

  let needsDataRefresh = false;
  const roleSelect = document.getElementById(`role-select-${selectedUser.id}`);
  if (roleSelect) {
    const newRole = roleSelect.value;
    if (newRole !== selectedUser.role) {
      try {
        await updateUserRole(selectedUser.id, newRole);
        needsDataRefresh = true;
      } catch (error) {
        alert(`${selectedUser.username} 역할 변경 실패: ${error.message}`);
        return;
      }
    }
  }

  const permissionList = document.getElementById("permission-list");
  if (permissionList) {
    let newTemplateIds = [];
    if (selectedUser.role === "user") {
      const checkedRadio = permissionList.querySelector(
        'input[type="radio"]:checked',
      );
      if (checkedRadio) {
        newTemplateIds.push(parseInt(checkedRadio.value, 10));
      }
    } else {
      newTemplateIds = Array.from(
        permissionList.querySelectorAll('input[type="checkbox"]:checked'),
      ).map((cb) => parseInt(cb.value, 10));
    }

    try {
      await updateUserPermissions(selectedUser.id, newTemplateIds);
      alert(`${selectedUser.username} 권한이 저장되었습니다.`);
      if (needsDataRefresh) {
        await fetchAdminData();
      } else {
        await fetchSelectedUserPermissions();
      }
    } catch (error) {
      alert(`${selectedUser.username} 권한 저장 실패: ${error.message}`);
    }
  }
}

async function handleDeleteUser() {
  const { admin } = getState();
  const selectedUser = admin.users.find((u) => u.id === admin.selectedUserId);
  if (!selectedUser) {
    alert("삭제할 사용자를 먼저 선택해주세요.");
    return;
  }
  if (
    !confirm(
      `정말로 '${selectedUser.username}' 사용자를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
    )
  ) {
    return;
  }
  try {
    await apiCall(`/users/${selectedUser.id}`, { method: "DELETE" });
    alert(`'${selectedUser.username}' 사용자가 삭제되었습니다.`);
    await fetchAdminData();
  } catch (error) {
    alert(`사용자 삭제 실패: ${error.message}`);
  }
}

function handleLogoFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1048576) {
    alert("로고 파일은 1MB를 초과할 수 없습니다.");
    return;
  }
  if (!file.type.startsWith("image/")) {
    alert("이미지 파일만 선택할 수 있습니다.");
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    currentLogoDataURL = event.target.result;
    renderLogoPreview();
  };
  reader.onerror = () => {
    alert("로고 파일을 읽는 중 오류가 발생했습니다.");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
}

function handleLogoRemove() {
  currentLogoDataURL = "";
  renderLogoPreview();
}

function handleImportTemplateFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedData = JSON.parse(event.target.result);
      if (
        !importedData.name ||
        !importedData.config ||
        !Array.isArray(importedData.config.steps)
      ) {
        throw new Error("Invalid template file format.");
      }
      populateEditorFromData({ ...importedData, id: "" });
      alert(
        `'${importedData.name}' 템플릿을 에디터로 불러왔습니다.\n저장하려면 '새 템플릿으로 저장' 버튼을 클릭하세요.`,
      );
    } catch (error) {
      alert(`템플릿 파일 처리 중 오류가 발생했습니다: ${error.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

function handleExportTemplate() {
  const templateData = getTemplateSchemaFromForm();
  if (!templateData) return;

  const jsonString = JSON.stringify(templateData, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${templateData.name}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderLogoPreview() {
  const previewContainer = document.getElementById("logo-preview");
  if (!previewContainer) return;
  if (currentLogoDataURL) {
    previewContainer.innerHTML = `<img src="${currentLogoDataURL}" class="max-h-16 max-w-full object-contain rounded-lg border border-border p-1" alt="로고 미리보기">`;
  } else {
    previewContainer.innerHTML =
      '<div class="h-16 w-24 flex items-center justify-center text-sm text-info bg-panelBackground rounded-lg">로고 없음</div>';
  }
}

function handleTabClick(tabName) {
  activeTab = tabName;
  const fetchMap = {
    errors: () => fetchErrorLogs(1),
    llm: () => fetchLlmLogs(1),
  };

  if (fetchMap[activeTab]) {
    fetchMap[activeTab]();
  } else {
    setState({});
  }
}

export function renderAdminView() {
  const { admin } = getState();

  if (admin.viewingLlmLogId) {
    return renderLlmLogDetailView();
  }

  const { user } = getState();
  return `
        <aside class="w-[240px] flex-shrink-0 bg-background border-r border-border flex flex-col p-4">
            <div class="h-10 mb-6 px-2 flex items-center justify-center font-bold text-lg">관리자 패널</div>
            <div class="flex-grow"></div>
            <div class="mt-auto w-full flex-shrink-0 space-y-2">
                <div class="text-sm text-center p-2 bg-panelBackground rounded-lg">${user.username} (${user.role})</div>
                <div class="flex items-center gap-2">
                    <button id="mode-toggle-btn" class="btn btn-secondary !h-9 !w-9 !p-0 flex-grow" title="사용자 모드로">
                        <i data-lucide="arrow-left" class="w-4 h-4"></i>
                    </button>
                    <button id="logout-btn" class="btn btn-secondary !h-9 !w-9 !p-0 flex-grow" title="로그아웃">
                        <i data-lucide="log-out" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        </aside>
        <main id="admin-main-section" class="flex-1 p-8 overflow-y-auto bg-panelBackground">
            ${renderAdminMainContentHTML()}
        </main>`;
}

function renderAdminMainContentHTML() {
  const { user, admin } = getState();

  if (admin.viewingErrorLog) {
    return renderErrorLogModal();
  }

  const tabStyle = (tabName) =>
    activeTab === tabName
      ? "border-primary text-primary"
      : "border-transparent text-info hover:text-primary hover:border-gray-300";

  return `
        <div class="max-w-7xl mx-auto">
            <div class="mb-8">
                <h1 class="text-title font-bold text-primary mb-2">관리자 설정</h1>
                <div class="border-b border-border">
                    <nav class="-mb-px flex space-x-6" aria-label="Tabs">
                        <button id="tab-templates" class="whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm ${tabStyle("templates")}">템플릿 관리</button>
                        ${user.role === "master" ? `<button id="tab-users" class="whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm ${tabStyle("users")}">사용자 및 권한</button>` : ""}
                        <button id="tab-keys" class="whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm ${tabStyle("keys")}">API 키 설정</button>
                        ${user.role === "master" ? `<button id="tab-errors" class="whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm ${tabStyle("errors")}">오류 로그</button>` : ""}
                        ${user.role === "master" ? `<button id="tab-llm" class="whitespace-nowrap py-4 px-1 border-b-2 font-semibold text-sm ${tabStyle("llm")}">AI 사용 로그</button>` : ""}
                    </nav>
                </div>
            </div>
            <div id="admin-content-container">
                ${activeTab === "templates" ? renderTemplatesView() : ""}
                ${activeTab === "users" ? renderUsersView() : ""}
                ${activeTab === "keys" ? renderApiKeysSection() : ""}
                ${activeTab === "errors" ? renderErrorLogView() : ""}
                ${activeTab === "llm" ? renderLlmLogView() : ""}
            </div>
        </div>`;
}

function renderTemplatesView() {
  const { admin } = getState();
  return `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="md:col-span-1 bg-background rounded-card border border-border p-4 h-fit">
                <div class="flex items-center justify-between mb-4">
                    <h2 class="text-section font-semibold">템플릿 목록</h2>
                    <button id="add-new-template-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="새 템플릿">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                    </button>
                </div>
                <ul id="template-list" class="space-y-1">
                    ${admin.allTemplates
                      .map(
                        (t) => `
                        <li>
                            <button data-template-id="${t.id}" class="template-list-item w-full text-left p-2 rounded-lg text-sm font-semibold text-primary hover:bg-panelBackground">
                                ${t.name}
                            </button>
                        </li>
                    `,
                      )
                      .join("")}
                </ul>
            </div>
            <div class="md:col-span-2 bg-background rounded-card border border-border">
                ${renderTemplateEditorSection()}
            </div>
        </div>
    `;
}

function renderUsersView() {
  return `
        <div class="bg-background rounded-card border border-border">
            <div class="p-6 flex flex-col md:flex-row gap-6">
                <div class="w-full md:w-1/3 border-b md:border-b-0 md:border-r border-border pb-6 md:pb-0 md:pr-6">
                    ${renderUserListHTML()}
                </div>
                <div class="w-full md:w-2/3" id="permission-editor-container">
                    ${getState().admin.selectedUserId ? renderPermissionEditor() : '<p class="text-info text-sm">왼쪽 목록에서 사용자를 선택하여 권한을 수정하세요.</p>'}
                </div>
            </div>
        </div>`;
}

function renderUserListHTML() {
  const { admin } = getState();
  const searchTerm = admin.userSearchTerm.toLowerCase();
  const filteredUsers = admin.users.filter((u) =>
    u.username.toLowerCase().includes(searchTerm),
  );
  return `
        <div>
            <label for="user-search-input" class="text-sm font-semibold text-primary">사용자 검색</label>
            <input type="search" id="user-search-input" placeholder="이름으로 검색..." class="mt-1 form-input !p-2 text-sm" value="${admin.userSearchTerm}">
        </div>
        <ul id="user-list" class="mt-4 space-y-1 max-h-96 overflow-y-auto">
            ${filteredUsers
              .map(
                (u) => `
                <li>
                    <button data-user-id="${u.id}" class="user-list-item w-full text-left p-2 rounded-lg transition-colors ${admin.selectedUserId === u.id ? "bg-primary text-white" : "hover:bg-panelBackground"}">
                        <span class="font-semibold">${u.username}</span>
                        <span class="text-sm opacity-70 ml-2">(${u.role})</span>
                    </button>
                </li>
            `,
              )
              .join("")}
        </ul>
    `;
}

function renderPermissionEditor() {
  const { admin } = getState();
  const selectedUser = admin.users.find((u) => u.id === admin.selectedUserId);
  if (!selectedUser) return "";

  return `
        <div class="space-y-4" id="permission-editor">
            <h3 class="font-bold text-lg text-primary">${selectedUser.username}님 권한 설정</h3>
            <div>
                <label for="role-select-${selectedUser.id}" class="text-sm font-semibold">역할</label>
                <select id="role-select-${selectedUser.id}" class="mt-1 form-input !py-2 !text-sm w-auto">
                    <option value="user" ${selectedUser.role === "user" ? "selected" : ""}>User</option>
                    <option value="admin" ${selectedUser.role === "admin" ? "selected" : ""}>Admin</option>
                </select>
            </div>
            <div class="space-y-2">
                 <div>
                    <label for="workflow-search-input" class="text-sm font-semibold text-primary">워크플로우 검색</label>
                    <input type="search" id="workflow-search-input" placeholder="이름으로 검색..." class="mt-1 form-input !p-2 text-sm" value="${admin.permissionTemplateSearchTerm}">
                </div>
                <p class="text-sm font-semibold">
                    ${selectedUser.role === "user" ? "할당된 워크플로우" : "접근 가능한 워크플로우"}
                </p>
                <div id="permission-list" class="space-y-2 max-h-64 overflow-y-auto border border-border p-3 rounded-lg bg-panelBackground">
                    ${renderPermissionListHTML(selectedUser)}
                </div>
            </div>
            <div class="flex justify-between items-center pt-4 border-t border-border mt-4">
                <button id="delete-user-btn" class="btn btn-destructive !h-9 !w-9 !p-0" title="사용자 삭제">
                    <i data-lucide="user-x" class="w-4 h-4"></i>
                </button>
                <button id="save-permissions-btn" class="btn btn-primary">권한 저장</button>
            </div>
        </div>`;
}

function renderPermissionListHTML(selectedUser) {
  const { admin } = getState();
  const searchTerm = admin.permissionTemplateSearchTerm.toLowerCase();
  const filteredTemplates = admin.allTemplates.filter((t) =>
    t.name.toLowerCase().includes(searchTerm),
  );

  const isUserRole = selectedUser.role === "user";
  const inputType = isUserRole ? "radio" : "checkbox";
  const nameAttr = isUserRole
    ? `name="user-permission-${selectedUser.id}"`
    : "";

  return `
        ${filteredTemplates
          .map(
            (template) => `
            <label class="flex items-center space-x-3 p-1 hover:bg-background rounded-lg">
                <input type="${inputType}" ${nameAttr} value="${template.id}" class="h-4 w-4 rounded-sm border-gray-300 text-primary focus:ring-primaryLight" 
                ${admin.selectedUserPermissions.includes(template.id) ? "checked" : ""}>
                <span class="text-sm">${template.name}</span>
            </label>
        `,
          )
          .join("")}
    `;
}

function renderApiKeysSection() {
  const { admin } = getState();
  return `
        <div class="bg-background rounded-card border border-border">
            <div class="p-6 border-b border-border"><h2 class="text-section font-semibold">API 키 설정</h2></div>
            <div class="p-6 space-y-4 max-w-xl mx-auto">
                <p class="text-caption text-info">API 키는 서버에 안전하게 저장됩니다. 새 키를 입력하면 기존 키를 덮어씁니다.</p>
                <div><label for="openai-api-key" class="text-sm font-semibold">OpenAI API Key</label><input type="password" id="openai-api-key" placeholder="${admin.apiKeys.openai_api_key || "설정된 키 없음"}" class="mt-1 form-input"></div>
                <div><label for="google-api-key" class="text-sm font-semibold">Google API Key</label><input type="password" id="google-api-key" placeholder="${admin.apiKeys.google_api_key || "설정된 키 없음"}" class="mt-1 form-input"></div>
                <div><label for="anthropic-api-key" class="text-sm font-semibold">Anthropic API Key</label><input type="password" id="anthropic-api-key" placeholder="${admin.apiKeys.anthropic_api_key || "설정된 키 없음"}" class="mt-1 form-input"></div>
                <div class="flex justify-end"><button id="save-keys-btn" class="btn btn-primary">API 키 저장</button></div>
            </div>
        </div>`;
}

function renderErrorLogView() {
  const { errorLogs, totalErrorLogs, errorLogsPage } = getState().admin;
  if (totalErrorLogs === 0) {
    return '<div class="bg-background rounded-card border border-border p-8 text-center text-info">기록된 오류가 없습니다.</div>';
  }
  return `
        <div class="bg-background rounded-card border border-border">
            <div class="p-6 border-b border-border flex justify-between items-center">
                <h2 class="text-section font-semibold">시스템 오류 로그</h2>
                <button id="refresh-errors-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="새로고침">
                    <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                </button>
            </div>
            <div class="p-6">
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left text-primary">
                        <thead class="text-xs text-primary uppercase bg-panelBackground">
                            <tr>
                                <th scope="col" class="py-3 px-6">시간</th>
                                <th scope="col" class="py-3 px-6">사용자</th>
                                <th scope="col" class="py-3 px-6">액션</th>
                                <th scope="col" class="py-3 px-6">오류 메시지</th>
                                <th scope="col" class="py-3 px-6"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${errorLogs
                              .map(
                                (log) => `
                                <tr class="bg-white border-b hover:bg-panelBackground">
                                    <td class="py-4 px-6 font-mono text-xs">${formatToKoreanTime(log.timestamp)}</td>
                                    <td class="py-4 px-6">${log.username} (ID: ${log.user_id})</td>
                                    <td class="py-4 px-6">${log.action_type}</td>
                                    <td class="py-4 px-6 text-error font-semibold truncate max-w-xs" title="${log.error_message}">${log.error_message}</td>
                                    <td class="py-4 px-6 text-right">
                                        <button data-log-id="${log.id}" data-action="view-error-log" class="btn btn-secondary !h-9 !w-9 !p-0" title="상세 보기">
                                            <i data-lucide="file-text" class="w-4 h-4" style="pointer-events: none;"></i>
                                        </button>
                                    </td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
                ${renderPaginationControls(totalErrorLogs, errorLogsPage, LOGS_PER_PAGE, "error-log")}
            </div>
        </div>
    `;
}

function renderLlmLogView() {
  const { llmLogs, totalLlmLogs, llmLogsPage } = getState().admin;

  const getStatusBadge = (isSuccess) => {
    return isSuccess
      ? '<span class="bg-success/20 text-success text-xs font-bold mr-2 px-2.5 py-0.5 rounded-full">성공</span>'
      : '<span class="bg-error/20 text-error text-xs font-bold mr-2 px-2.5 py-0.5 rounded-full">실패</span>';
  };

  return `
        <div class="bg-background rounded-card border border-border">
            <div class="p-6 border-b border-border flex justify-between items-center">
                <h2 class="text-section font-semibold">AI 사용 로그</h2>
                <button id="refresh-llm-logs-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="새로고침">
                    <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                </button>
            </div>
            <div class="p-6">
                 ${
                   totalLlmLogs === 0
                     ? '<div class="text-center text-info">기록된 AI 사용 내역이 없습니다.</div>'
                     : `
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left text-primary">
                        <thead class="text-xs text-primary uppercase bg-panelBackground">
                            <tr>
                                <th scope="col" class="py-3 px-6">시간</th>
                                <th scope="col" class="py-3 px-6">사용자</th>
                                <th scope="col" class="py-3 px-6">워크플로우</th>
                                <th scope="col" class="py-3 px-6">모델</th>
                                <th scope="col" class="py-3 px-6">결과</th>
                                <th scope="col" class="py-3 px-6"></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${llmLogs
                              .map(
                                (log) => `
                                <tr class="bg-white border-b hover:bg-panelBackground">
                                    <td class="py-4 px-6 font-mono text-xs">${formatToKoreanTime(log.timestamp)}</td>
                                    <td class="py-4 px-6 font-semibold">${log.username}</td>
                                    <td class="py-4 px-6">
                                        <div>${log.template_name || "N/A"}</div>
                                        <div class="text-xs text-info">Step: ${log.step_index !== null ? log.step_index + 1 : "N/A"}</div>
                                    </td>
                                    <td class="py-4 px-6 font-mono text-primaryLight">${log.provider} / ${log.model_id}</td>
                                    <td class="py-4 px-6">${getStatusBadge(log.is_success)}</td>
                                    <td class="py-4 px-6 text-right">
                                        <button data-log-id="${log.id}" data-action="view-llm-log" class="btn btn-secondary !h-9 !w-9 !p-0" title="상세 보기">
                                            <i data-lucide="file-text" class="w-4 h-4" style="pointer-events: none;"></i>
                                        </button>
                                    </td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
                ${renderPaginationControls(totalLlmLogs, llmLogsPage, LOGS_PER_PAGE, "llm-log")}
                 `
                 }
            </div>
        </div>
    `;
}

function renderErrorLogModal() {
  const { viewingErrorLog } = getState().admin;
  if (!viewingErrorLog) return "";
  let contextObject;
  try {
    contextObject = JSON.parse(viewingErrorLog.context);
  } catch (e) {
    contextObject = { raw: viewingErrorLog.context };
  }
  return `
        <div id="error-log-modal-overlay" class="fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-50">
            <div class="bg-white rounded-modal shadow-2xl w-full max-w-2xl">
                <div class="p-6 border-b border-border">
                    <h3 class="text-section font-bold">오류 상세 정보</h3>
                </div>
                <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div><strong class="font-semibold">오류 ID:</strong> ${viewingErrorLog.id}</div>
                    <div><strong class="font-semibold">발생 시간:</strong> ${formatToKoreanTime(viewingErrorLog.timestamp)}</div>
                    <div><strong class="font-semibold">사용자:</strong> ${viewingErrorLog.username} (ID: ${viewingErrorLog.user_id})</div>
                    <div><strong class="font-semibold">오류 메시지:</strong> <span class="text-error">${viewingErrorLog.error_message}</span></div>
                    <div>
                        <strong class="font-semibold">상세 컨텍스트:</strong>
                        <pre class="mt-1 bg-panelBackground p-4 rounded-lg text-sm overflow-auto max-h-60">${JSON.stringify(contextObject, null, 2)}</pre>
                    </div>
                </div>
                <div class="p-4 bg-panelBackground rounded-b-modal flex justify-end">
                    <button id="close-error-modal-btn" class="btn btn-secondary">닫기</button>
                </div>
            </div>
        </div>
    `;
}

function renderLlmLogDetailView() {
  const { admin } = getState();
  const { viewingLlmLogDetail: log, viewingLlmLogId } = admin;

  if (!log) {
    return '<div class="w-full h-screen bg-panelBackground flex items-center justify-center"><i data-lucide="loader-2" class="w-12 h-12 animate-spin text-primary"></i></div>';
  }

  const tabStyle = (tabName) =>
    logDetailActiveTab === tabName
      ? "bg-white border-border border-b-white text-primary"
      : "border-transparent text-info hover:text-primary";

  const llmLog = admin.llmLogs.find((l) => l.id === viewingLlmLogId) || {};

  return `
        <div class="w-full h-screen bg-panelBackground flex flex-col p-6">
            <header class="flex-shrink-0 flex items-center justify-between pb-4 border-b border-border">
                <div>
                    <button id="back-to-logs-btn" class="btn btn-secondary mb-2"><i data-lucide="arrow-left" class="w-4 h-4 mr-2"></i>로그 목록으로</button>
                    <h1 class="text-title font-bold text-primary">AI 상호작용 상세 로그 #${viewingLlmLogId}</h1>
                    <div class="text-sm text-info mt-1">
                        <span>${llmLog.template_name || "N/A"}</span>
                        <span class="mx-2">/</span>
                        <span>Step: ${llmLog.step_index !== null ? llmLog.step_index + 1 : "N/A"}</span>
                    </div>
                </div>
                <div class="text-right text-sm">
                    <p class="font-semibold">${llmLog.username || "N/A"}</p>
                    <p class="text-info">${formatToKoreanTime(llmLog.timestamp)}</p>
                </div>
            </header>
            
            <div class="flex-shrink-0 border-b border-border mt-4">
                <nav class="-mb-px flex space-x-4" aria-label="Tabs">
                    <button data-log-tab="request" class="log-detail-tab whitespace-nowrap py-3 px-4 border-b-2 font-semibold text-sm rounded-t-lg ${tabStyle("request")}">Request</button>
                    <button data-log-tab="response" class="log-detail-tab whitespace-nowrap py-3 px-4 border-b-2 font-semibold text-sm rounded-t-lg ${tabStyle("response")}">Response</button>
                    <button data-log-tab="raw" class="log-detail-tab whitespace-nowrap py-3 px-4 border-b-2 font-semibold text-sm rounded-t-lg ${tabStyle("raw")}">Raw Data</button>
                </nav>
            </div>

            <main class="flex-grow bg-white mt-[-1px] border border-border rounded-b-lg p-6 overflow-y-auto">
                ${logDetailActiveTab === "request" ? renderLogRequestView(log) : ""}
                ${logDetailActiveTab === "response" ? renderLogResponseView(log) : ""}
                ${logDetailActiveTab === "raw" ? renderLogRawDataView(log) : ""}
            </main>
        </div>
    `;
}

function renderLogRequestView(log) {
  const { finalApiBody } = log.request_payload;
  const viewAsJson = logDetailViewAsJson.request;

  const renderJsonView = () =>
    `<pre class="text-xs whitespace-pre-wrap break-words">${JSON.stringify(finalApiBody, null, 2)}</pre>`;

  const renderStructuredView = () => {
    const messages = finalApiBody.system
      ? [
          { role: "system", content: finalApiBody.system },
          ...finalApiBody.messages,
        ]
      : finalApiBody.system_instruction
        ? [
            {
              role: "system",
              content: finalApiBody.system_instruction.parts[0].text,
            },
            ...finalApiBody.contents,
          ]
        : finalApiBody.messages || finalApiBody.contents || [];

    return messages
      .map((msg) => {
        let role = msg.role || "system";
        if (role === "model") role = "assistant";

        const content = Array.isArray(msg.parts)
          ? msg.parts.map((p) => p.text).join("\n")
          : msg.content;

        let roleName, roleColor, icon;
        switch (role) {
          case "system":
            roleName = "Global Instruction (System)";
            roleColor = "bg-gray-100 border-gray-300";
            icon = "settings-2";
            break;
          case "assistant":
            roleName = "Context (Assistant)";
            roleColor = "bg-green-50 border-green-200";
            icon = "sparkles";
            break;
          default: // user
            roleName = "Context (User)";
            roleColor = "bg-blue-50 border-blue-200";
            icon = "user";
        }

        if (msg === messages[messages.length - 1] && role === "user") {
          roleName = "Final Instruction (User)";
          roleColor = "bg-primary/10 border-primary/20";
          icon = "terminal";
        }

        return `
                <details class="mb-4" open>
                    <summary class="font-semibold text-primary flex items-center gap-2 cursor-pointer p-2 hover:bg-panelBackground rounded-md">
                        <i data-lucide="${icon}" class="w-4 h-4"></i> ${roleName}
                    </summary>
                    <div class="mt-2 pl-8 border-l-2 ${roleColor} rounded-r-lg">
                        <pre class="p-4 text-sm whitespace-pre-wrap break-words">${content}</pre>
                    </div>
                </details>
            `;
      })
      .join("");
  };

  return `
        <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
            <h2 class="text-section font-bold">AI에 전달된 전체 요청</h2>
            <div class="flex items-center gap-2">
                <button data-action="toggle-json-request" class="btn btn-secondary btn-sm">${viewAsJson ? "Rendered 보기" : "JSON 보기"}</button>
                <button data-action="copy-request" class="btn btn-secondary btn-sm"><i data-lucide="copy" class="w-4 h-4 mr-1"></i>JSON 복사</button>
                <button data-action="download-request" class="btn btn-secondary btn-sm"><i data-lucide="download" class="w-4 h-4 mr-1"></i>JSON 다운로드</button>
            </div>
        </div>
        <div class="p-4 rounded-lg">
            ${viewAsJson ? renderJsonView() : renderStructuredView()}
        </div>
    `;
}

function formatResponsePayload(logData) {
  if (!logData.is_success && logData.response_payload) {
    try {
      return JSON.stringify(JSON.parse(logData.response_payload), null, 2);
    } catch (e) {
      return logData.response_payload || logData.error_message || "응답 없음.";
    }
  }
  if (!logData.response_payload) return logData.error_message || "응답 없음.";

  let fullText = "";
  const lines = logData.response_payload.trim().split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const jsonString = line.substring(6);
        if (jsonString.trim() === "[DONE]") continue;
        const json = JSON.parse(jsonString);
        const content =
          json.choices?.[0]?.delta?.content ||
          json.candidates?.[0]?.content?.parts?.[0]?.text ||
          json.delta?.text ||
          "";
        fullText += content;
      } catch (e) {
        /* 무시 */
      }
    }
  }
  if (fullText === "" && logData.response_payload) {
    try {
      const json = JSON.parse(logData.response_payload);
      fullText =
        json.choices?.[0]?.message?.content ||
        json.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
    } catch (e) {
      fullText = logData.response_payload;
    }
  }
  return (
    fullText.trim() || "[스트림 또는 응답에서 텍스트 콘텐츠를 찾을 수 없음]"
  );
}

function renderLogResponseView(log) {
  const viewAsJson = logDetailViewAsJson.response;
  const renderedContent = formatResponsePayload(log);

  return `
        <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
            <h2 class="text-section font-bold">AI의 최종 응답 결과</h2>
            <div class="flex items-center gap-2">
                <button data-action="toggle-json-response" class="btn btn-secondary btn-sm">${viewAsJson ? "Rendered 보기" : "JSON 보기"}</button>
                <button data-action="copy-response" class="btn btn-secondary btn-sm"><i data-lucide="copy" class="w-4 h-4 mr-1"></i>텍스트 복사</button>
                <button data-action="download-response" class="btn btn-secondary btn-sm"><i data-lucide="download" class="w-4 h-4 mr-1"></i>파일 다운로드</button>
            </div>
        </div>
        <div class="p-4 rounded-lg">
            ${
              viewAsJson && log.response_payload
                ? `<pre class="text-xs whitespace-pre-wrap break-words">${JSON.stringify(JSON.parse(log.response_payload), null, 2)}</pre>`
                : `<div class="prose max-w-none">${marked.parse(renderedContent)}</div>`
            }
        </div>
     `;
}

function renderLogRawDataView(log) {
  return `
        <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
            <h2 class="text-section font-bold">전체 로그 데이터 (JSON)</h2>
             <div class="flex items-center gap-2">
                <button data-action="copy-raw" class="btn btn-secondary btn-sm"><i data-lucide="copy" class="w-4 h-4 mr-1"></i>JSON 복사</button>
                <button data-action="download-raw" class="btn btn-secondary btn-sm"><i data-lucide="download" class="w-4 h-4 mr-1"></i>JSON 다운로드</button>
            </div>
        </div>
        <div class="p-4 rounded-lg">
            <pre class="text-xs whitespace-pre-wrap break-words">${JSON.stringify(log, null, 2)}</pre>
        </div>
    `;
}

function renderTemplateEditorSection() {
  const { llmModels } = getState();
  if (Object.keys(llmModels).length === 0) {
    return '<div class="p-6 text-center text-info">LLM 모델 목록을 불러오는 중입니다...</div>';
  }
  return `
        <div class="p-6 space-y-6">
            <input type="hidden" id="template-id-store">
            <div><label for="template-name" class="text-sm font-semibold">템플릿 이름</label><input type="text" id="template-name" placeholder="새 템플릿 이름" class="mt-1 form-input"></div>
            <div>
                <label class="text-sm font-semibold">로고 이미지 (선택)</label>
                <div class="mt-2 flex items-center gap-4">
                    <div id="logo-preview" class="w-24 h-16 flex items-center justify-center">
                        <div class="h-16 w-24 flex items-center justify-center text-sm text-info bg-panelBackground rounded-lg">로고 없음</div>
                    </div>
                    <div class="flex flex-col gap-2">
                        <button id="logo-upload-btn" class="btn btn-secondary btn-sm" title="로고 선택"><i data-lucide="upload" class="w-4 h-4"></i></button>
                        <button id="logo-remove-btn" class="btn btn-destructive btn-sm" title="로고 삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                        <input type="file" id="logo-file-input" class="hidden" accept="image/*">
                    </div>
                </div>
            </div>
            <div>
                <label for="llm-select" class="text-sm font-semibold">전역 LLM 모델 (요약 등 내부 작업에도 사용)</label>
                <select id="llm-select" class="mt-1 form-input py-2">
                    ${Object.entries(llmModels)
                      .map(
                        ([provider, models]) => `
                        <optgroup label="${provider}">
                            ${models.map((model) => `<option value="${provider}__${model.modelId}" ${model.status === "inactive" ? "disabled" : ""}>${model.name} (${model.description})</option>`).join("")}
                        </optgroup>
                    `,
                      )
                      .join("")}
                </select>
            </div>
            <div><label for="global-instruction" class="text-sm font-semibold">공통 지시문 (System Prompt)</label><textarea id="global-instruction" rows="5" placeholder="모든 단계에 공통적으로 적용될 지시문..." class="mt-1 form-input"></textarea></div>
            <div>
                <label class="text-sm font-semibold">워크플로우 단계 (Steps)</label>
                <div id="step-list" class="mt-2 space-y-4"></div>
                <button id="add-step-btn" class="mt-4 btn btn-secondary">단계 추가</button>
            </div>
            <div class="flex justify-between items-center border-t border-border pt-6">
                <div class="flex gap-2">
                    <button id="export-template-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="템플릿 내보내기">
                        <i data-lucide="download" class="w-4 h-4"></i>
                    </button>
                    <button id="import-template-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="템플릿 가져오기">
                         <i data-lucide="upload" class="w-4 h-4"></i>
                    </button>
                    <input type="file" id="import-file-input" class="hidden" accept=".json">
                </div>
                <div class="flex gap-2">
                    <button id="delete-template-btn" class="btn btn-destructive !h-9 !w-9 !p-0" title="템플릿 삭제">
                         <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                    <button id="create-new-template-btn" class="btn bg-primary/80 text-white hover:bg-primary">새 템플릿으로 저장</button>
                    <button id="save-template-btn" class="btn btn-primary">변경사항 저장</button>
                </div>
            </div>
        </div>
    `;
}

export function attachAdminEventListeners(container) {
  container.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button) return;

    const action = button.dataset.action;
    if (action) {
      const { admin } = getState();
      if (action === "error-log-prev" || action === "error-log-next") {
        const newPage =
          action === "error-log-prev"
            ? admin.errorLogsPage - 1
            : admin.errorLogsPage + 1;
        await fetchErrorLogs(newPage);
        return;
      }
      if (action === "llm-log-prev" || action === "llm-log-next") {
        const newPage =
          action === "llm-log-prev"
            ? admin.llmLogsPage - 1
            : admin.llmLogsPage + 1;
        await fetchLlmLogs(newPage);
        return;
      }
      if (action.startsWith("toggle-json-")) {
        const viewType = action.split("-")[2]; // 'request' or 'response'
        logDetailViewAsJson[viewType] = !logDetailViewAsJson[viewType];
        setState({}); // trigger re-render
        return;
      }
      const { viewingLlmLogDetail: log } = admin;
      if (log) {
        switch (action) {
          case "copy-request": {
            navigator.clipboard
              .writeText(
                JSON.stringify(log.request_payload.finalApiBody, null, 2),
              )
              .then(() => alert("API Body가 클립보드에 복사되었습니다."));
            return;
          }
          case "download-request": {
            const reqBlob = new Blob(
              [JSON.stringify(log.request_payload.finalApiBody, null, 2)],
              { type: "application/json" },
            );
            const reqUrl = URL.createObjectURL(reqBlob);
            const reqA = document.createElement("a");
            reqA.href = reqUrl;
            reqA.download = `request_${admin.viewingLlmLogId}.json`;
            reqA.click();
            URL.revokeObjectURL(reqUrl);
            return;
          }
          case "copy-response":
            navigator.clipboard
              .writeText(formatResponsePayload(log))
              .then(() => alert("결과 텍스트가 클립보드에 복사되었습니다."));
            return;
          case "download-response": {
            const resBlob = new Blob([formatResponsePayload(log)], {
              type: "text/plain",
            });
            const resUrl = URL.createObjectURL(resBlob);
            const resA = document.createElement("a");
            resA.href = resUrl;
            resA.download = `response_${admin.viewingLlmLogId}.txt`;
            resA.click();
            URL.revokeObjectURL(resUrl);
            return;
          }
          case "copy-raw":
            navigator.clipboard
              .writeText(JSON.stringify(log, null, 2))
              .then(() =>
                alert("전체 로그 데이터가 클립보드에 복사되었습니다."),
              );
            return;
          case "download-raw": {
            const rawBlob = new Blob([JSON.stringify(log, null, 2)], {
              type: "application/json",
            });
            const rawUrl = URL.createObjectURL(rawBlob);
            const rawA = document.createElement("a");
            rawA.href = rawUrl;
            rawA.download = `log_raw_${admin.viewingLlmLogId}.json`;
            rawA.click();
            URL.revokeObjectURL(rawUrl);
          }
        }
      }
    }

    if (button.dataset.action === "view-error-log") {
      const logId = parseInt(button.dataset.logId, 10);
      setState({
        admin: {
          viewingErrorLog: getState().admin.errorLogs.find(
            (l) => l.id === logId,
          ),
        },
      });
      return;
    }

    if (button.dataset.action === "view-llm-log") {
      const logId = parseInt(button.dataset.logId, 10);
      setState({
        admin: { viewingLlmLogId: logId, viewingLlmLogDetail: null },
      });
      try {
        const logDetails = await apiCall(`/logs/llm/${logId}`);
        setState({ admin: { viewingLlmLogDetail: logDetails } });
      } catch (error) {
        alert(`로그 상세 정보를 불러오는데 실패했습니다: ${error.message}`);
        setState({
          admin: { viewingLlmLogId: null, viewingLlmLogDetail: null },
        });
      }
      return;
    }

    if (button.id === "back-to-logs-btn") {
      logDetailActiveTab = "request";
      logDetailViewAsJson.request = false;
      logDetailViewAsJson.response = false;
      setState({ admin: { viewingLlmLogId: null, viewingLlmLogDetail: null } });
      return;
    }

    if (button.id === "close-error-modal-btn") {
      setState({ admin: { viewingErrorLog: null } });
      return;
    }

    if (button.classList.contains("log-detail-tab")) {
      logDetailActiveTab = button.dataset.logTab;
      setState({});
      return;
    }

    const actionMap = {
      "save-keys-btn": handleSaveApiKeys,
      "add-step-btn": () => addStepInput(),
      "save-template-btn": handleSaveTemplate,
      "create-new-template-btn": handleCreateNewTemplate,
      "save-permissions-btn": handleSaveUserPermissions,
      "logo-upload-btn": () =>
        document.getElementById("logo-file-input").click(),
      "logo-remove-btn": handleLogoRemove,
      "delete-template-btn": handleDeleteTemplate,
      "add-new-template-btn": () => handleLoadTemplate(-1),
      "tab-templates": () => handleTabClick("templates"),
      "tab-users": () => handleTabClick("users"),
      "tab-keys": () => handleTabClick("keys"),
      "tab-errors": () => handleTabClick("errors"),
      "tab-llm": () => handleTabClick("llm"),
      "delete-user-btn": handleDeleteUser,
      "import-template-btn": () =>
        document.getElementById("import-file-input").click(),
      "export-template-btn": handleExportTemplate,
      "refresh-llm-logs-btn": () => fetchLlmLogs(1),
      "refresh-errors-btn": () => fetchErrorLogs(1),
    };

    if (actionMap[button.id]) actionMap[button.id]();
    if (button.classList.contains("remove-step-btn"))
      button.closest(".step-item")?.remove();
    if (button.classList.contains("user-list-item"))
      handleUserSelectionChange(button.dataset.userId);
    if (button.classList.contains("template-list-item"))
      handleLoadTemplate(button.dataset.templateId);
  });

  container.addEventListener("change", (e) => {
    if (e.target.id === "logo-file-input") handleLogoFileSelect(e);
    if (e.target.id === "import-file-input") handleImportTemplateFile(e);
    if (e.target.id.startsWith("role-select-")) setState({});
  });

  container.addEventListener("input", (e) => {
    const targetId = e.target.id;
    if (targetId === "user-search-input")
      setState({ admin: { userSearchTerm: e.target.value } });
    if (targetId === "workflow-search-input")
      setState({ admin: { permissionTemplateSearchTerm: e.target.value } });
  });
}
