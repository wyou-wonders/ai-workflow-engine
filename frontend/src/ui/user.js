import { apiCall, apiCallStream, AuthError } from "../api.js";
import { getState, setState } from "../state.js";
import DOMPurify from "dompurify";
import { marked } from "marked";
import * as icons from "./icons.js";
import { findModelByKey } from "../config/models.js";
import { handleLogout } from "../auth.js";

async function logErrorToServer(details) {
  try {
    await apiCall("/logs/error", { method: "POST", body: details });
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    console.error("Failed to log error to server:", error);
  }
}

const MAX_TOTAL_SIZE_MB = 10;
const MAX_PER_FILE_SIZE_MB = 5;
const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024;
const MAX_PER_FILE_SIZE_BYTES = MAX_PER_FILE_SIZE_MB * 1024 * 1024;

const stepFileCache = new Map();

async function fetchBookmarkedWorkflows() {
  try {
    const bookmarked = await apiCall("/workflows/bookmarked");
    setState({ bookmarkedWorkflows: bookmarked || [] });
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    console.error("Failed to fetch bookmarked workflows:", error);
  }
}

export async function fetchInitialUserData() {
  try {
    const [templates, workflows, bookmarkedWorkflows, llmModels] =
      await Promise.all([
        apiCall("/templates"),
        apiCall("/workflows"),
        apiCall("/workflows/bookmarked"),
        apiCall("/models"),
      ]);
    setState({
      templates: templates || [],
      workflows: workflows || [],
      bookmarkedWorkflows: bookmarkedWorkflows || [],
      llmModels: llmModels || {},
    });

    const { user } = getState();
    if (templates && templates.length > 0) {
      const templateToLoad = templates[0];
      if (user.role === "user" && templates.length === 1) {
        await createNewWorkflowAndStart(templateToLoad, false);
      } else {
        await handleUserTemplateChange(templateToLoad.id, false);
      }
    } else {
      setState({
        workflow: {
          activeTemplate: null,
          currentWorkflowId: null,
          executionContext: null,
        },
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    alert(`초기 데이터 로딩 실패: ${error.message}`);
  }
}

async function loadWorkflowFromHistory(workflowId) {
  try {
    const workflowData = await apiCall(`/workflows/${workflowId}`);
    if (workflowData) {
      stepFileCache.clear();
      setState({
        workflow: {
          activeTemplate: {
            ...workflowData.template_snapshot,
            id: `history_${workflowId}`,
            name: workflowData.bookmark_title || workflowData.title,
          },
          currentWorkflowId: workflowData.id,
          executionContext: workflowData.execution_context,
        },
        ui: { isHistoryVisible: false },
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    alert(`워크플로우 불러오기 실패: ${error.message}`);
  }
}

async function createNewWorkflowAndStart(template) {
  const payload = {
    title: `${template.name} - ${new Date().toLocaleTimeString()}`,
    template_snapshot: template,
  };
  try {
    const newWorkflow = await apiCall("/workflows", {
      method: "POST",
      body: payload,
    });
    if (newWorkflow) {
      stepFileCache.clear();
      setState({
        workflow: {
          currentWorkflowId: newWorkflow.id,
          executionContext: newWorkflow.execution_context,
          activeTemplate: template,
        },
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    alert(`워크플로우 시작 실패: ${error.message}`);
  }
}

async function handleUserTemplateChange(templateId) {
  if (String(templateId).startsWith("history_")) return;

  const { templates } = getState();
  const activeTemplate =
    templates.find((t) => t.id === parseInt(templateId, 10)) || null;

  if (activeTemplate) {
    await createNewWorkflowAndStart(activeTemplate);
  }
}

function handleNewSession() {
  if (!confirm("현재 진행중인 내용을 모두 지우고 새로 시작하시겠습니까?"))
    return;

  const { workflow, user } = getState();
  if (workflow.activeTemplate && workflow.activeTemplate.id) {
    if (
      user.role === "user" ||
      typeof workflow.activeTemplate.id !== "number"
    ) {
      createNewWorkflowAndStart(workflow.activeTemplate);
    } else {
      handleUserTemplateChange(workflow.activeTemplate.id);
    }
  }
}

function toggleHistoryPanel() {
  const { ui } = getState();
  setState({ ui: { isHistoryVisible: !ui.isHistoryVisible } });
}

async function updateWorkflowOnServer() {
  const { workflow } = getState();
  if (!workflow.currentWorkflowId || !workflow.executionContext) return;
  try {
    await apiCall(`/workflows/${workflow.currentWorkflowId}`, {
      method: "PUT",
      body: { execution_context: workflow.executionContext },
    });
    const workflows = await apiCall("/workflows");
    setState({ workflows: workflows || [] });
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    console.error("워크플로우 상태 저장 실패:", error);
  }
}

async function invalidateStepsFrom(startIndex) {
  const { workflow } = getState();
  if (!workflow.executionContext) return;

  const newExecutionContext = JSON.parse(
    JSON.stringify(workflow.executionContext),
  );

  for (let i = startIndex; i < newExecutionContext.results.length; i++) {
    newExecutionContext.results[i] = {
      content: "",
      mode: "view",
      status: "pending",
      userInput: "",
    };
  }
  newExecutionContext.currentStepIndex = startIndex;

  setState({ workflow: { executionContext: newExecutionContext } });
  await updateWorkflowOnServer();
}

const MEMORY_WINDOW_SIZE = 2;

async function getConversationSummary(messagesToSummarize) {
  if (messagesToSummarize.length === 0) return "";

  const { workflow, llmModels } = getState();
  const tpl = workflow.activeTemplate.config;

  const modelString = tpl.model || Object.values(llmModels)[0]?.[0]?.key;
  if (!modelString)
    throw new Error("요약에 사용할 LLM 모델을 찾을 수 없습니다.");

  const [provider, modelId] = modelString.split("__");
  const modelConfig = findModelByKey(modelString);
  if (!modelConfig)
    throw new Error(`모델 설정(${modelString})을 찾을 수 없습니다.`);

  const summaryPrompt =
    "다음 대화 내용을 핵심만 간결하게 요약해줘:\n\n" +
    messagesToSummarize.map((m) => `[${m.role}]: ${m.content}`).join("\n");

  const requestBody = {
    provider,
    modelId,
    apiConfig: { ...modelConfig.api, stream: false },
    globalInstruction:
      "You are a helpful assistant that summarizes conversations.",
    body: { messages: [{ role: "user", content: summaryPrompt }] },
    workflow_id: workflow.currentWorkflowId,
    template_name: `[요약] ${workflow.activeTemplate.name}`,
    step_index: null,
  };

  const response = await apiCall(
    "/llm/proxy",
    { method: "POST", body: requestBody },
    true,
  );

  return (
    response.choices?.[0]?.message?.content ||
    response.candidates?.[0]?.content?.parts?.[0]?.text ||
    ""
  );
}

async function generateStep(index, currentUserInput) {
  let workflow = getState().workflow;
  const tpl = workflow.activeTemplate.config;
  if (index >= tpl.steps.length) return;

  const newResults = [...workflow.executionContext.results];
  newResults[index] = {
    ...newResults[index],
    status: "generating",
    userInput: currentUserInput,
  };
  setState({
    workflow: {
      executionContext: {
        ...workflow.executionContext,
        currentStepIndex: index,
        results: newResults,
      },
    },
  });

  await new Promise((resolve) => requestAnimationFrame(resolve));
  document
    .getElementById(`step-${index}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });

  await updateWorkflowOnServer();

  workflow = getState().workflow;
  const ctx = workflow.executionContext;

  const messages = [];
  let summaryForLog = ctx.summary || "";

  try {
    if (index >= MEMORY_WINDOW_SIZE) {
      const stepsToSummarize = [];
      const summaryEndIndex = index - MEMORY_WINDOW_SIZE;
      for (let i = 0; i <= summaryEndIndex; i++) {
        if (ctx.results[i]?.userInput)
          stepsToSummarize.push({
            role: "user",
            content: ctx.results[i].userInput,
          });
        if (ctx.results[i]?.content)
          stepsToSummarize.push({
            role: "assistant",
            content: ctx.results[i].content,
          });
      }
      if (stepsToSummarize.length > 0) {
        summaryForLog = await getConversationSummary(
          stepsToSummarize.filter((m) => m.content),
        );
        const currentCtx = getState().workflow.executionContext;
        const newCtx = { ...currentCtx, summary: summaryForLog };
        setState({ workflow: { executionContext: newCtx } });
        await updateWorkflowOnServer();
      }
    }
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    alert(error.message);
    const finalResults = [...getState().workflow.executionContext.results];
    finalResults[index] = {
      ...finalResults[index],
      status: "error",
      content: `**오류:** ${error.message}`,
    };
    setState({
      workflow: {
        executionContext: {
          ...getState().workflow.executionContext,
          results: finalResults,
        },
      },
    });
    await logErrorToServer({
      action_type: "SUMMARIZE_STEP",
      workflow_id: workflow.currentWorkflowId,
      step_index: index,
      error_message: error.message,
      context: { templateName: workflow.activeTemplate.name },
    });
    return;
  }

  if (summaryForLog) {
    messages.push({
      role: "user",
      content: `--- 이전 대화 요약 ---\n${summaryForLog}\n--- 요약 끝 ---`,
    });
  }

  const windowStartIndex = Math.max(0, index - MEMORY_WINDOW_SIZE);
  for (let i = windowStartIndex; i < index; i++) {
    const prevResult = ctx.results[i];
    if (prevResult?.userInput)
      messages.push({ role: "user", content: prevResult.userInput });
    if (prevResult?.content)
      messages.push({ role: "assistant", content: prevResult.content });
  }

  const finalUserPrompt =
    `${tpl.steps[index].prompt || ""}\n\n${currentUserInput}`.trim();
  messages.push({ role: "user", content: finalUserPrompt });

  const modelString = tpl.steps[index].model || tpl.model;
  const [provider, modelId] = modelString.split("__");
  const modelConfig = findModelByKey(modelString);
  if (!modelConfig) {
    alert(`모델 설정(${modelString})을 찾을 수 없습니다.`);
    const finalResults = [...getState().workflow.executionContext.results];
    finalResults[index] = {
      ...finalResults[index],
      status: "error",
      content: `**오류:** 모델 설정(${modelString})을 찾을 수 없습니다.`,
    };
    setState({
      workflow: {
        executionContext: {
          ...getState().workflow.executionContext,
          results: finalResults,
        },
      },
    });
    return;
  }

  const promptDetails = {
    template: tpl.steps[index].prompt || "N/A",
    summary: summaryForLog,
    history: messages
      .slice(0, -1)
      .map((m) => `[${m.role.toUpperCase()}]\n${m.content}`)
      .join("\n\n"),
    variables: { "[현재 단계 사용자 입력]": currentUserInput },
    finalUserPrompt,
  };

  const requestBody = {
    provider,
    modelId,
    apiConfig: modelConfig.api,
    globalInstruction: tpl.globalInstruction,
    body: { messages },
    workflow_id: workflow.currentWorkflowId,
    template_name: workflow.activeTemplate.name,
    step_index: index,
    promptDetails,
  };

  if (modelConfig.api.stream === false) {
    try {
      const response = await apiCall(
        "/llm/proxy",
        { method: "POST", body: requestBody },
        true,
      );
      const fullResponse =
        response.choices?.[0]?.message?.content ||
        response.candidates?.[0]?.content?.parts?.[0]?.text ||
        "[비스트리밍 응답에서 콘텐츠를 찾을 수 없습니다]";

      const currentWorkflow = getState().workflow;
      const finalResults = [...currentWorkflow.executionContext.results];
      finalResults[index] = {
        ...finalResults[index],
        content: fullResponse,
        status: "success",
      };
      setState({
        workflow: {
          executionContext: {
            ...currentWorkflow.executionContext,
            currentStepIndex: index + 1,
            results: finalResults,
          },
        },
      });
      await updateWorkflowOnServer();
    } catch (error) {
      if (error instanceof AuthError) {
        handleLogout();
        return;
      }
      const currentWorkflow = getState().workflow;
      const finalResults = [...currentWorkflow.executionContext.results];
      finalResults[index] = {
        ...finalResults[index],
        status: "error",
        content: `**오류 발생:** ${error.message}`,
      };
      setState({
        workflow: {
          executionContext: {
            ...currentWorkflow.executionContext,
            results: finalResults,
          },
        },
      });
      await updateWorkflowOnServer();
    }
  } else {
    let fullResponse = "";
    let buffer = "";
    await apiCallStream(
      "/llm/proxy",
      { method: "POST", body: requestBody },
      (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const jsonString = line.substring(6);
            if (!jsonString || jsonString.trim() === "[DONE]") continue;
            const parsed = JSON.parse(jsonString);
            let content = "";
            if (provider === "OpenAI")
              content = parsed.choices?.[0]?.delta?.content || "";
            else if (provider === "Anthropic") {
              if (parsed.type === "content_block_delta")
                content = parsed.delta?.text || "";
            } else if (provider === "Google")
              content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";

            if (content) {
              fullResponse += content;
              const proseContent = document.querySelector(
                `#step-${index} .prose-content`,
              );
              if (proseContent)
                proseContent.innerHTML = DOMPurify.sanitize(
                  marked.parse(fullResponse + "▋"),
                );
            }
          } catch (e) {
            buffer = line + "\n" + buffer;
          }
        }
      },
      () => {
        // onEnd
        const currentWorkflow = getState().workflow;
        const finalResults = [...currentWorkflow.executionContext.results];
        finalResults[index] = {
          ...finalResults[index],
          content: fullResponse,
          status: "success",
        };
        setState({
          workflow: {
            executionContext: {
              ...currentWorkflow.executionContext,
              currentStepIndex: index + 1,
              results: finalResults,
            },
          },
        });
        updateWorkflowOnServer();
      },
      (error) => {
        // onError
        const currentWorkflow = getState().workflow;
        const finalResults = [...currentWorkflow.executionContext.results];
        finalResults[index] = {
          ...finalResults[index],
          status: "error",
          content: `**오류 발생:** ${error.message}`,
        };
        setState({
          workflow: {
            executionContext: {
              ...currentWorkflow.executionContext,
              results: finalResults,
            },
          },
        });
        logErrorToServer({
          action_type: "GENERATE_STEP",
          workflow_id: currentWorkflow.currentWorkflowId,
          step_index: index,
          error_message: error.message,
          context: {
            templateName: currentWorkflow.activeTemplate.name,
            model: modelString,
          },
        });
        updateWorkflowOnServer();
      },
    );
  }
}

async function handleFileAttachment(e, index) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  const generateBtn = document.querySelector(`#step-${index}-generate-btn`);
  if (generateBtn) generateBtn.disabled = true;

  const currentFiles = stepFileCache.get(index) || [];
  let currentTotalSize = currentFiles.reduce((acc, f) => acc + f.size, 0);

  for (const file of Array.from(files)) {
    if (file.size > MAX_PER_FILE_SIZE_BYTES) {
      alert(`[용량 초과] '${file.name}' (${MAX_PER_FILE_SIZE_MB}MB 초과)`);
      continue;
    }
    if (currentTotalSize + file.size > MAX_TOTAL_SIZE_BYTES) {
      alert(
        `[용량 초과] '${file.name}' 추가 시 총 용량 ${MAX_TOTAL_SIZE_MB}MB를 초과합니다.`,
      );
      break;
    }
    if (currentFiles.some((f) => f.name === file.name)) {
      alert(`[중복 파일] '${file.name}'`);
      continue;
    }

    let fileData = null;
    try {
      if (
        file.type === "application/pdf" ||
        file.name.split(".").pop().toLowerCase() === "pdf"
      ) {
        const buffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument(buffer).promise;
        let textContent = "";
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const text = await page.getTextContent();
          textContent += text.items.map((item) => item.str).join(" ");
        }
        fileData = { name: file.name, content: textContent, size: file.size };
      } else if (
        file.type.startsWith("text/") ||
        ["txt", "md", "csv", "json", "xml", "html", "js", "css"].includes(
          file.name.split(".").pop().toLowerCase(),
        )
      ) {
        const content = await file.text();
        fileData = { name: file.name, content, size: file.size };
      } else {
        alert(`[지원 불가] '${file.name}'`);
        continue;
      }

      if (fileData) {
        currentFiles.push(fileData);
        currentTotalSize += fileData.size;
      }
    } catch (error) {
      alert(`'${file.name}' 처리 중 오류: ${error.message}`);
    }
  }
  stepFileCache.set(index, currentFiles);

  renderFileAttachmentBadges(index);
  updateFileSizeGauge(index);

  if (generateBtn) generateBtn.disabled = false;
  e.target.value = "";
}

function renderFileAttachmentBadges(index) {
  const files = stepFileCache.get(index) || [];
  const container = document.getElementById(
    `file-attachment-badge-container-${index}`,
  );
  if (container) {
    container.innerHTML = files
      .map(
        (file) => `
            <div class="inline-flex items-center gap-2 bg-border text-primary text-sm font-semibold pl-3 pr-2 py-1 rounded-full">
                <span class="max-w-[120px] truncate" title="${file.name}">${file.name}</span>
                <button class="remove-attachment-btn p-0.5 rounded-full hover:bg-disabled/50" data-filename="${file.name}" data-index="${index}">
                    <i data-lucide="x" class="w-3.5 h-3.5" style="pointer-events: none;"></i>
                </button>
            </div>`,
      )
      .join("");
    icons.create();
  }
}

function updateFileSizeGauge(index) {
  const files = stepFileCache.get(index) || [];
  const currentTotalSize = files.reduce((acc, f) => acc + f.size, 0);
  const percentage = (currentTotalSize / MAX_TOTAL_SIZE_BYTES) * 100;
  const currentSizeMB = (currentTotalSize / 1024 / 1024).toFixed(1);
  const sizeBar = document.getElementById(`file-size-bar-${index}`);
  const sizeText = document.getElementById(`file-size-text-${index}`);
  if (!sizeBar || !sizeText) return;
  sizeBar.style.width = `${Math.min(percentage, 100)}%`;
  sizeText.textContent = `${currentSizeMB} MB / ${MAX_TOTAL_SIZE_MB.toFixed(1)} MB`;
  sizeBar.classList.remove("bg-primaryLight", "bg-warning", "bg-error");
  if (percentage > 95) {
    sizeBar.classList.add("bg-error");
  } else if (percentage > 70) {
    sizeBar.classList.add("bg-warning");
  } else {
    sizeBar.classList.add("bg-primaryLight");
  }
}

export function renderUserView() {
  return `
        ${renderUserSidebarHTML()}
        <section class="flex-1 flex flex-col h-screen bg-panelBackground relative">
            ${renderUserMainContentHTML()}
        </section>
        <input type="file" id="workflow-file-input" class="hidden" accept=".json" />
    `;
}

function renderUserSidebarHTML() {
  const { user, workflow } = getState();
  const isAdmin = user.role === "admin" || user.role === "master";

  const logoHTML = workflow.activeTemplate?.config?.logoData
    ? `<img src="${workflow.activeTemplate.config.logoData}" class="max-h-full max-w-full object-contain" alt="템플릿 로고">`
    : `<div class="font-bold text-lg text-primary">${workflow.activeTemplate?.name || "Workflow Engine"}</div>`;

  return `
        <aside class="w-[240px] flex-shrink-0 bg-background border-r border-border flex flex-col p-4">
            <div class="h-10 mb-6 px-2 flex items-center justify-center">
                ${logoHTML}
            </div>
            ${isAdmin ? renderTemplateSelectorHTML() : ""}
            <ul id="step-sidebar-list" class="flex-grow overflow-y-auto pr-2 ${isAdmin ? "" : "mt-4"}">
                ${renderSidebarHTML()}
            </ul>
            <div id="history-container" class="border-t border-border pt-2 mt-2 flex-shrink-0">
                ${renderSidebarPanelHTML()}
            </div>
            <div class="mt-auto w-full flex-shrink-0 space-y-2 pt-2 border-t border-border">
                <div class="flex items-center justify-between">
                    <div class="text-sm p-2 text-primary truncate" title="${user.username}">${user.username}</div>
                    <div class="flex items-center gap-1">
                        <button id="toggle-history-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="히스토리/북마크 보기">
                            <i data-lucide="history" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-1">
                    ${
                      isAdmin
                        ? `
                    <button id="mode-toggle-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="관리자 모드">
                        <i data-lucide="settings-2" class="w-4 h-4"></i>
                    </button>`
                        : ""
                    }
                    <button id="import-workflow-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="워크플로우 불러오기">
                        <i data-lucide="upload" class="w-4 h-4"></i>
                    </button>
                    <div class="flex-grow"></div>
                    <button id="logout-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="로그아웃">
                        <i data-lucide="log-out" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        </aside>
    `;
}

function renderTemplateSelectorHTML() {
  const { templates, workflow } = getState();
  if (!templates || templates.length === 0) return "";
  return `
        <div class="mb-4">
            <label for="user-template-select" class="text-sm font-semibold mb-1 block">워크플로우 선택</label>
            <select id="user-template-select" class="form-input !p-2 !text-sm">
                ${templates.map((t) => `<option value="${t.id}" ${workflow.activeTemplate?.id === t.id ? "selected" : ""}>${t.name}</option>`).join("")}
            </select>
        </div>`;
}

function renderSidebarHTML() {
  const { workflow } = getState();
  if (!workflow.activeTemplate?.config?.steps)
    return '<li class="text-sm text-info p-2">진행할 워크플로우가 없습니다.</li>';

  const steps = workflow.activeTemplate.config.steps;
  const ctx = workflow.executionContext;

  return steps
    .map((step, index) => {
      const result = ctx?.results?.[index];
      const status = result?.status || "pending";
      let iconHtml, textClass, statusText, lineColorClass, iconBgClass;

      switch (status) {
        case "success":
          iconHtml = '<i data-lucide="check" class="w-4 h-4 text-white"></i>';
          textClass = "text-primary font-semibold";
          statusText = "완료됨";
          lineColorClass = "bg-success";
          iconBgClass = "bg-success";
          break;
        case "generating":
          iconHtml =
            '<div class="w-3 h-3 bg-white rounded-full animate-pulse"></div>';
          textClass = "text-primaryLight font-bold";
          statusText = "생성 중";
          lineColorClass = "bg-success";
          iconBgClass = "bg-primaryLight";
          break;
        case "error":
          iconHtml =
            '<i data-lucide="alert-triangle" class="w-4 h-4 text-white"></i>';
          textClass = "text-error font-bold";
          statusText = "오류";
          lineColorClass = "bg-border";
          iconBgClass = "bg-error";
          break;
        default:
          iconHtml = `<span class="font-bold text-sm text-info">${index + 1}</span>`;
          textClass = "text-info";
          statusText = "대기 중";
          lineColorClass = "bg-border";
          iconBgClass = "bg-panelBackground border-2 border-border";
      }

      const isClickable = status === "success" || status === "error";
      const linkTag = isClickable ? "a" : "div";

      return `
            <li class="relative pl-10 pb-8">
                ${index < steps.length - 1 ? `<div class="absolute left-4 top-5 h-full w-0.5 ${lineColorClass}"></div>` : ""}
                <div class="absolute left-0 top-0">
                    <${linkTag} href="#" data-index="${index}" class="sidebar-step-icon z-10 flex h-8 w-8 items-center justify-center rounded-full ${iconBgClass} ${isClickable ? "cursor-pointer hover:scale-110 transition-transform" : ""}" title="${isClickable ? `${step.name} 다시 시작` : ""}">
                        ${iconHtml}
                    </${linkTag}>
                </div>
                <div class="pt-1">
                    <p class="sidebar-link-text text-body ${textClass}">${step.name}</p>
                    <p class="text-caption ${status === "error" ? "text-error" : status === "success" ? "text-success" : "text-info"}">${statusText}</p>
                </div>
            </li>`;
    })
    .join("");
}

function renderSidebarPanelHTML() {
  const { ui } = getState();
  const tabStyle = (tabName) =>
    ui.activeSidebarTab === tabName
      ? "bg-panelBackground text-primary font-semibold"
      : "text-info hover:bg-panelBackground";

  return ui.isHistoryVisible
    ? `
        <div class="flex items-center border border-border rounded-lg p-1 mb-2">
            <button data-tab="history" class="sidebar-tab-btn flex-1 text-sm rounded-md px-2 py-1 ${tabStyle("history")}">History</button>
            <button data-tab="bookmarks" class="sidebar-tab-btn flex-1 text-sm rounded-md px-2 py-1 ${tabStyle("bookmarks")}">Bookmarks</button>
        </div>
        <div id="sidebar-panel-content" class="max-h-40 overflow-y-auto">
            ${renderSidebarPanelContentHTML()}
        </div>
    `
    : "";
}

function renderSidebarPanelContentHTML() {
  const { workflows, bookmarkedWorkflows, ui } = getState();
  if (!ui.isHistoryVisible) return "";

  if (ui.activeSidebarTab === "history") {
    if (workflows.length === 0)
      return '<p class="text-sm text-center text-info p-2">최근 내역이 없습니다.</p>';
    return `
            <ul class="space-y-1">
                ${workflows.map((wf) => `<li><button data-workflow-id="${wf.id}" class="history-item-btn w-full text-left text-sm p-2 rounded hover:bg-panelBackground truncate" title="${wf.title}">${wf.title}</button></li>`).join("")}
            </ul>`;
  } else {
    // bookmarks tab
    if (bookmarkedWorkflows.length === 0)
      return '<p class="text-sm text-center text-info p-2">북마크가 없습니다.</p>';
    return `
            <ul class="space-y-1">
                ${bookmarkedWorkflows
                  .map(
                    (wf) => `
                    <li class="flex items-center group">
                        <button data-workflow-id="${wf.id}" class="history-item-btn flex-grow text-left text-sm p-2 rounded hover:bg-panelBackground truncate" title="${wf.bookmark_title}">
                            ${wf.bookmark_title}
                        </button>
                        <button data-workflow-id="${wf.id}" class="delete-bookmark-btn flex-shrink-0 p-1 rounded-full hover:bg-error/20 opacity-0 group-hover:opacity-100 transition-opacity" title="북마크 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5 text-error" style="pointer-events: none;"></i>
                        </button>
                    </li>
                `,
                  )
                  .join("")}
            </ul>`;
  }
}

function renderUserMainContentHTML() {
  const { workflow } = getState();

  if (!workflow.activeTemplate) {
    return '<div class="flex-1 flex items-center justify-center p-8"><div class="p-8 text-center text-info">할당된 워크플로우가 없습니다.<br>관리자에게 문의하세요.</div></div>';
  }

  const title = workflow.activeTemplate?.name || "워크플로우";
  return `
        <div class="flex-1 overflow-y-auto p-8" id="document-view">
            <div class="max-w-7xl mx-auto">
                <div class="flex justify-between items-center mb-6 pb-4 border-b border-border">
                    <h2 class="text-title font-bold text-primary">${title}</h2>
                    <div class="flex items-center gap-2">
                        <button id="new-session-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="새 세션 시작">
                            <i data-lucide="plus-square" class="w-4 h-4"></i>
                        </button>
                        ${
                          workflow.currentWorkflowId
                            ? `
                        <button id="bookmark-workflow-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="북마크에 저장">
                            <i data-lucide="bookmark" class="w-4 h-4"></i>
                        </button>`
                            : ""
                        }
                        <button id="export-results-btn" class="btn btn-secondary !h-9 !w-9 !p-0" title="JSON 내보내기">
                            <i data-lucide="download" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
                <div id="document-container">${renderDocumentViewContentHTML()}</div>
            </div>
        </div>`;
}

function renderDocumentViewContentHTML() {
  const { workflow } = getState();
  if (!workflow.executionContext) {
    return '<div class="text-center p-10"><i data-lucide="loader-2" class="w-8 h-8 animate-spin text-primary"></i></div>';
  }

  return workflow.activeTemplate.config.steps
    .map((_, index) => createStepBlock(index))
    .join("");
}

function createStepBlock(index) {
  const { workflow } = getState();
  const step = workflow.activeTemplate.config.steps[index];
  const result = workflow.executionContext.results[index];
  const { mode, status, content, userInput } = result;
  const isCurrentStepForInput =
    workflow.executionContext.currentStepIndex === index &&
    status === "pending";

  let conversationHtml = "";
  if (userInput) {
    const sanitizedInput = DOMPurify.sanitize(userInput).replace(/\n/g, "<br>");
    conversationHtml += `<div class="user-input-bubble bg-primary/5 border border-primary/10 text-primary p-4 rounded-lg mb-4 text-sm">${sanitizedInput}</div>`;
  }

  if (status !== "pending") {
    let aiContent = "";
    if (status === "generating") {
      aiContent =
        '<div class="prose prose-content text-info">AI가 답변을 생성하고 있습니다...<span class="inline-block animate-pulse">▋</span></div>';
    } else if (mode === "edit") {
      aiContent = `<textarea class="w-full rounded-lg border-0 bg-panelBackground text-sm p-3 font-mono" rows="15">${content}</textarea>`;
    } else {
      const sanitizedContent = DOMPurify.sanitize(marked.parse(content || ""));
      aiContent = `<div class="prose prose-content ${status === "error" ? "text-error" : ""}">${sanitizedContent}</div>`;
    }

    conversationHtml += `
            <div class="ai-response-bubble flex gap-4">
                <div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center mt-1">
                    <i data-lucide="sparkles" class="w-5 h-5"></i>
                </div>
                <div class="flex-grow bg-panelBackground p-4 rounded-lg">
                    ${aiContent}
                </div>
            </div>`;
  }

  let footerHtml = "";
  if (status === "success") {
    if (mode === "edit") {
      footerHtml =
        '<div class="flex-grow"></div><button data-action="save" class="btn btn-sm btn-primary"><i data-lucide="save" class="w-4 h-4"></i> 저장</button><button data-action="cancel" class="btn btn-sm btn-secondary">취소</button>';
    } else {
      footerHtml =
        '<div class="flex items-center gap-2"><button data-action="copy" class="btn btn-secondary !h-9 !w-9 !p-0" title="복사"><i data-lucide="copy" class="w-4 h-4"></i></button><button data-action="regenerate" class="btn btn-secondary !h-9 !w-9 !p-0" title="다시 생성"><i data-lucide="sparkles" class="w-4 h-4"></i></button><button data-action="edit" class="btn btn-secondary !h-9 !w-9 !p-0" title="편집"><i data-lucide="pencil" class="w-4 h-4"></i></button></div>';
    }
  } else if (status === "error") {
    footerHtml =
      '<div class="flex-grow"></div><button data-action="retry" class="btn btn-sm btn-destructive"><i data-lucide="refresh-cw" class="w-4 h-4"></i>재시도</button>';
  }

  let inputSectionHtml = "";
  if (isCurrentStepForInput) {
    inputSectionHtml = `
            <div id="step-${index}-input-panel" class="p-4 bg-background border-t border-border space-y-3">
                <textarea id="step-${index}-input" placeholder="${step.instruction || "여기에 내용을 입력하세요..."}" class="w-full p-[14px] resize-none border-0 text-body placeholder-disabled focus:outline-none transition-shadow form-input" rows="4"></textarea>
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <button data-action="attach-file" class="btn btn-secondary">
                            <i data-lucide="paperclip" class="w-4 h-4"></i><span>파일 첨부</span>
                        </button>
                        <input type="file" id="step-${index}-file-input" class="hidden" multiple />
                        <div id="file-attachment-badge-container-${index}" class="flex flex-wrap gap-2"></div>
                    </div>
                    <button id="step-${index}-generate-btn" data-action="generate" class="btn btn-primary min-w-[120px] active:scale-105">
                        <i data-lucide="sparkles" class="w-4 h-4 mr-1"></i>
                        <span>${index === 0 ? "생성 시작" : "다음 단계 생성"}</span>
                    </button>
                </div>
                <div id="file-size-gauge-container" class="mt-3">
                    <div class="flex justify-between mb-1"><span class="text-caption font-medium text-primary">첨부 파일 용량</span><span id="file-size-text-${index}" class="text-caption font-medium text-info">0.0 MB / 10.0 MB</span></div>
                    <div class="w-full bg-border rounded-full h-2"><div id="file-size-bar-${index}" class="bg-primaryLight h-2 rounded-full transition-all duration-300" style="width: 0%"></div></div>
                </div>
            </div>`;
  }

  const shouldShowBlock = status !== "pending" || isCurrentStepForInput;
  if (!shouldShowBlock) return "";

  return `
        <div id="step-${index}" class="step-block bg-white border border-border rounded-card" data-index="${index}">
            <div class="flex justify-between items-center p-4">
                <h3 class="text-section font-bold text-primary">${step.name}</h3>
            </div>
            ${conversationHtml ? `<div class="p-6 content-wrapper">${conversationHtml}</div>` : ""}
            ${footerHtml ? `<div class="actions-footer p-4 border-t border-border flex items-center justify-between gap-3">${footerHtml}</div>` : ""}
            ${inputSectionHtml}
        </div>`;
}

async function handleDeleteBookmark(workflowId) {
  if (!confirm("이 북마크를 삭제하시겠습니까?")) return;
  try {
    await apiCall(`/workflows/${workflowId}/bookmark`, { method: "DELETE" });
    await fetchBookmarkedWorkflows();
  } catch (error) {
    if (error instanceof AuthError) {
      handleLogout();
      return;
    }
    alert(`북마크 삭제에 실패했습니다: ${error.message}`);
  }
}

function handleWorkflowImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedData = JSON.parse(event.target.result);
      if (
        !importedData.metadata ||
        !importedData.results ||
        !Array.isArray(importedData.results.steps)
      ) {
        throw new Error("Invalid workflow file format.");
      }
      stepFileCache.clear();
      const activeTemplate = {
        id: `imported_${Date.now()}`,
        name: importedData.metadata.name,
        config: importedData.metadata.config,
      };
      const executionContext = {
        currentStepIndex: importedData.results.steps.length,
        summary: importedData.results.summary || "",
        results: importedData.results.steps.map((s) => ({
          content: s.content,
          mode: "view",
          status: s.status || "success",
          userInput: s.userInput || "",
        })),
      };

      if (
        confirm(
          `'${importedData.metadata.name}' 워크플로우를 불러오시겠습니까?\n현재 작업 내용은 사라집니다.`,
        )
      ) {
        setState({
          workflow: {
            activeTemplate,
            executionContext,
            currentWorkflowId: null,
          },
          ui: { isHistoryVisible: false },
        });
      }
    } catch (error) {
      alert(`워크플로우 파일 처리 중 오류가 발생했습니다: ${error.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

export function attachUserEventListeners(container) {
  container.addEventListener("change", (e) => {
    if (e.target.id === "user-template-select") {
      handleUserTemplateChange(e.target.value);
    }
    if (e.target.id.includes("-file-input")) {
      const index = parseInt(e.target.id.split("-")[1], 10);
      handleFileAttachment(e, index);
    }
    if (e.target.id === "workflow-file-input") {
      handleWorkflowImport(e);
    }
  });

  container.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    const sidebarIcon = e.target.closest(".sidebar-step-icon");

    if (sidebarIcon && sidebarIcon.tagName === "A") {
      e.preventDefault();
      const index = parseInt(sidebarIcon.dataset.index, 10);
      if (confirm(`이 단계부터 다시 시작하시겠습니까?`)) {
        await invalidateStepsFrom(index);
      }
      return;
    }

    if (!button) return;

    const actionMap = {
      "import-workflow-btn": () =>
        document.getElementById("workflow-file-input").click(),
      "toggle-history-btn": toggleHistoryPanel,
      "new-session-btn": handleNewSession,
    };
    if (actionMap[button.id]) return actionMap[button.id]();

    if (button.classList.contains("sidebar-tab-btn")) {
      const tab = button.dataset.tab;
      setState({ ui: { activeSidebarTab: tab } });
      return;
    }

    if (button.classList.contains("delete-bookmark-btn"))
      return handleDeleteBookmark(button.dataset.workflowId);
    if (button.classList.contains("history-item-btn"))
      return loadWorkflowFromHistory(button.dataset.workflowId);

    if (button.classList.contains("remove-attachment-btn")) {
      const index = parseInt(button.dataset.index, 10);
      let files = stepFileCache.get(index) || [];
      files = files.filter((f) => f.name !== button.dataset.filename);
      stepFileCache.set(index, files);
      renderFileAttachmentBadges(index);
      updateFileSizeGauge(index);
      return;
    }

    if (button.id === "bookmark-workflow-btn") {
      const { workflow } = getState();
      const currentTitle = workflow.activeTemplate?.name || "새 북마크";
      const bookmarkTitle = prompt(
        "이 워크플로우를 어떤 이름으로 저장하시겠습니까?",
        currentTitle,
      );

      if (bookmarkTitle && bookmarkTitle.trim() !== "") {
        try {
          await apiCall(`/workflows/${workflow.currentWorkflowId}/bookmark`, {
            method: "PUT",
            body: { bookmark_title: bookmarkTitle.trim() },
          });
          alert("북마크에 저장되었습니다!");
          await fetchBookmarkedWorkflows();
        } catch (error) {
          if (error instanceof AuthError) {
            handleLogout();
            return;
          }
          alert(`북마크 저장에 실패했습니다: ${error.message}`);
        }
      }
      return;
    }

    if (button.id === "export-results-btn") {
      const { workflow } = getState();
      if (!workflow.executionContext)
        return alert("내보낼 워크플로우 결과가 없습니다.");

      const exportData = {
        metadata: {
          ...workflow.activeTemplate,
          exportedAt: new Date().toISOString(),
          originalWorkflowId: workflow.currentWorkflowId,
        },
        results: {
          summary: workflow.executionContext.summary,
          steps: workflow.activeTemplate.config.steps.map((step, index) => ({
            step: index + 1,
            name: step.name,
            status: workflow.executionContext.results[index].status,
            userInput: workflow.executionContext.results[index].userInput,
            content: workflow.executionContext.results[index].content,
          })),
        },
      };
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeTitle = (workflow.activeTemplate.name || "workflow")
        .replace(/[^a-z0-9]/gi, "_")
        .toLowerCase();
      a.download = `${safeTitle}_${workflow.currentWorkflowId || "imported"}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    const block = button.closest(".step-block");
    if (!block) return;

    const index = parseInt(block.dataset.index, 10);
    const action = button.dataset.action;
    handleStepAction(button, block, index, action);
  });
}

async function handleStepAction(button, block, index, action) {
  const { workflow } = getState();
  const newResults = [...workflow.executionContext.results];

  switch (action) {
    case "generate": {
      const textInput = document
        .getElementById(`step-${index}-input`)
        .value.trim();
      const files = stepFileCache.get(index) || [];
      const fileContents = files.map(
        (f) => `--- 첨부 파일: ${f.name} ---\n${f.content}`,
      );
      const combinedInput = [textInput, ...fileContents]
        .filter(Boolean)
        .join("\n\n");

      await generateStep(index, combinedInput);
      stepFileCache.delete(index);
      break;
    }
    case "attach-file":
      document.getElementById(`step-${index}-file-input`)?.click();
      break;
    case "copy": {
      navigator.clipboard.writeText(newResults[index].content).then(() => {
        const originalHTML = button.innerHTML;
        button.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i>';
        icons.create();
        setTimeout(() => {
          button.innerHTML = originalHTML;
          icons.create();
        }, 2000);
      });
      break;
    }
    case "edit":
      newResults[index].mode = "edit";
      setState({
        workflow: {
          executionContext: {
            ...workflow.executionContext,
            results: newResults,
          },
        },
      });
      break;
    case "save": {
      const textarea = block.querySelector("textarea");
      newResults[index].content = textarea ? textarea.value : "";
      newResults[index].mode = "view";
      setState({
        workflow: {
          executionContext: {
            ...workflow.executionContext,
            results: newResults,
          },
        },
      });
      await invalidateStepsFrom(index + 1);
      break;
    }
    case "cancel":
      newResults[index].mode = "view";
      setState({
        workflow: {
          executionContext: {
            ...workflow.executionContext,
            results: newResults,
          },
        },
      });
      break;
    case "retry":
    case "regenerate": {
      if (
        confirm(
          `'${workflow.activeTemplate.config.steps[index].name}' 단계를 다시 생성하시겠습니까?`,
        )
      ) {
        await invalidateStepsFrom(index);
        await generateStep(index, newResults[index].userInput);
      }
      break;
    }
  }
}
