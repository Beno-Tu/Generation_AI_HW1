const submitButton = document.querySelector("#submit");
const outputElement = document.querySelector("#output");
const conversationElement = document.querySelector(".conversation");
const promptElement = document.querySelector("#prompt");
const historyElement = document.querySelector(".history");
const newChatButton = document.querySelector(".new-chat");
const newFolderButton = document.querySelector("#new-folder");
const exportButton = document.querySelector("#export-chats");
const importInput = document.querySelector("#import-chats");
const renameChatButton = document.querySelector("#rename-chat");
const deleteChatButton = document.querySelector("#delete-chat");
const modal = document.querySelector("#modal");
const modalTitle = document.querySelector("#modal-title");
const modalMessage = document.querySelector("#modal-message");
const modalInput = document.querySelector("#modal-input");
const modalCancel = document.querySelector("#modal-cancel");
const modalConfirm = document.querySelector("#modal-confirm");

const modelSelect = document.querySelector("#model");
const customModelInput = document.querySelector("#custom-model");
const systemPromptInput = document.querySelector("#system-prompt");
const temperatureInput = document.querySelector("#temperature");
const topPInput = document.querySelector("#top-p");
const maxTokensInput = document.querySelector("#max-tokens");
const memoryTurnsInput = document.querySelector("#memory-turns");

const temperatureValue = document.querySelector("#temperature-value");
const topPValue = document.querySelector("#top-p-value");
const maxTokensValue = document.querySelector("#max-tokens-value");
const memoryTurnsValue = document.querySelector("#memory-turns-value");
const imageInput = document.querySelector("#image-input");
const imagePreview = document.querySelector("#image-preview");
const clearImageButton = document.querySelector("#clear-image");

let isLoading = false;
let chatIdCounter = 1;
let messageIdCounter = 1;
let folderIdCounter = 1;
const chats = [];
const folders = [];
let activeChatId = null;
const STORAGE_KEY = "beno-gpt-chats-v1";
const LEGACY_STORAGE_KEY = "anya-gpt-chats-v1";
let modalConfirmHandler = null;
let currentImageDataUrl = null;

function setLoadingState(loading) {
  isLoading = loading;
  submitButton.classList.toggle("loading", loading);
  submitButton.textContent = loading ? "Loading..." : "Send";
  promptElement.disabled = loading;
}

function getSelectedModel() {
  const custom = customModelInput.value.trim();
  return custom || modelSelect.value;
}

function isVisionModel(modelName) {
  const name = (modelName || "").toLowerCase();
  return name.includes("vision") || name.includes("llama-4-scout") || name.includes("llava");
}

function createChat() {
  const chat = {
    id: chatIdCounter++,
    title: "New chat",
    messages: [],
    folderId: null
  };
  chats.unshift(chat);
  activeChatId = chat.id;
  renderChatList();
  renderConversation();
  saveState();
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId);
}

function setActiveChat(chatId) {
  activeChatId = chatId;
  renderChatList();
  renderConversation();
  saveState();
}

function renderChatList() {
  historyElement.innerHTML = "";
  const unfiledLabel = document.createElement("div");
  unfiledLabel.className = "drop-zone";
  unfiledLabel.textContent = "Drop here to unfile";
  unfiledLabel.dataset.folderId = "";
  bindDropZone(unfiledLabel, null);
  historyElement.append(unfiledLabel);

  const unfiledChats = chats.filter((chat) => !chat.folderId);
  unfiledChats.forEach((chat) => {
    historyElement.append(createChatItem(chat));
  });

  folders.forEach((folder) => {
    const wrapper = document.createElement("div");
    wrapper.className = "folder";
    wrapper.dataset.folderId = String(folder.id);

    const header = document.createElement("div");
    header.className = "folder-header";
    header.textContent = folder.name;

    const count = document.createElement("span");
    count.className = "count";
    const folderChats = chats.filter((chat) => chat.folderId === folder.id);
    count.textContent = `${folderChats.length}`;

    header.append(count);
    header.addEventListener("click", () => {
      folder.isOpen = !folder.isOpen;
      renderChatList();
      saveState();
    });
    bindDropTarget(header, folder.id);

    const body = document.createElement("div");
    body.className = folder.isOpen ? "folder-body" : "folder-body hidden";
    folderChats.forEach((chat) => {
      body.append(createChatItem(chat));
    });

    wrapper.append(header, body);
    historyElement.append(wrapper);
  });
}

function renderConversation() {
  const chat = getActiveChat();
  outputElement.innerHTML = "";
  if (!chat) return;

  chat.messages.forEach((message) => {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${message.role}`;
    wrapper.dataset.messageId = String(message.id);

    const role = document.createElement("div");
    role.className = "role";
    role.textContent = message.role === "user" ? "You" : "Assistant";

    const content = document.createElement("div");
    content.className = "content";
    if (message.imageDataUrl) {
      const img = document.createElement("img");
      img.src = message.imageDataUrl;
      img.alt = "User uploaded";
      img.className = "message-image";
      content.append(img);
    }
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = message.content;
    content.append(text);

    wrapper.append(role, content);
    outputElement.append(wrapper);
  });

  scrollConversationToBottom();
}

function openModal({ title, message, inputValue, showInput, confirmLabel }) {
  modalTitle.textContent = title || "";
  modalMessage.textContent = message || "";
  modalInput.value = inputValue || "";
  modalInput.style.display = showInput ? "block" : "none";
  modalConfirm.textContent = confirmLabel || "Confirm";
  modal.classList.remove("hidden");
  if (showInput) {
    modalInput.focus();
    modalInput.select();
  }
}

function closeModal() {
  modal.classList.add("hidden");
  modalConfirmHandler = null;
}

modalCancel.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.classList.contains("hidden")) {
    closeModal();
  }
});
modalConfirm.addEventListener("click", () => {
  if (typeof modalConfirmHandler === "function") {
    modalConfirmHandler();
  }
  closeModal();
});

function showInfoModal(title, message) {
  modalConfirmHandler = null;
  openModal({
    title,
    message,
    showInput: false,
    confirmLabel: "OK"
  });
}

function createChatItem(chat) {
  const item = document.createElement("p");
  item.className = "chat-item";
  item.textContent = chat.title;
  item.draggable = true;
  item.dataset.chatId = String(chat.id);
  if (chat.id === activeChatId) {
    item.classList.add("active");
  }
  item.addEventListener("click", () => setActiveChat(chat.id));
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/chat-id", String(chat.id));
  });
  return item;
}

function bindDropTarget(element, folderId) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("drop-target");
  });
  element.addEventListener("dragleave", () => {
    element.classList.remove("drop-target");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("drop-target");
    const chatId = Number(event.dataTransfer.getData("text/chat-id"));
    if (!chatId) return;
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return;
    chat.folderId = folderId;
    renderChatList();
    saveState();
  });
}

function bindDropZone(element, folderId) {
  bindDropTarget(element, folderId);
}

function saveState() {
  const chatsForStorage = chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    folderId: chat.folderId || null,
    messages: chat.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      // Avoid localStorage quota issues by not persisting base64 images.
      imageDataUrl: null
    }))
  }));
  const payload = {
    chats: chatsForStorage,
    folders,
    activeChatId,
    chatIdCounter,
    messageIdCounter,
    folderIdCounter
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadState() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      localStorage.setItem(STORAGE_KEY, raw);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.chats)) return false;
    chats.length = 0;
    data.chats.forEach((chat) => chats.push(chat));
    folders.length = 0;
    if (Array.isArray(data.folders)) {
      data.folders.forEach((folder) => folders.push(folder));
    }
    activeChatId = data.activeChatId || (chats[0] && chats[0].id) || null;
    chatIdCounter = data.chatIdCounter || 1;
    messageIdCounter = data.messageIdCounter || 1;
    folderIdCounter = data.folderIdCounter || 1;
    renderChatList();
    renderConversation();
    return true;
  } catch (error) {
    return false;
  }
}

function updateMessageContent(messageId, content) {
  const target = outputElement.querySelector(`[data-message-id="${messageId}"] .content .text`);
  if (target) {
    target.textContent = content;
    scrollConversationToBottom();
  }
}

function buildMessagesForRequest(chat, allowImages) {
  const memoryTurns = Math.max(1, parseInt(memoryTurnsInput.value, 10) || 6);
  const maxMessages = memoryTurns * 2;
  const recentMessages = chat.messages.slice(-maxMessages).map((msg) => {
    if (msg.role === "user" && msg.imageDataUrl && allowImages) {
      return {
        role: msg.role,
        content: [
          { type: "text", text: msg.content },
          { type: "image_url", image_url: { url: msg.imageDataUrl } }
        ]
      };
    }
    if (msg.role === "user" && msg.imageDataUrl && !allowImages) {
      return { role: msg.role, content: `[Image attached] ${msg.content}`.trim() };
    }
    return { role: msg.role, content: msg.content };
  });

  const messages = [];
  const systemPrompt = systemPromptInput.value.trim();
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push(...recentMessages);
  return messages;
}

function bindRangeDisplay(input, output, formatter) {
  const format = formatter || ((value) => value);
  const update = () => {
    output.textContent = format(input.value);
  };
  update();
  input.addEventListener("input", update);
}

function scrollConversationToBottom() {
  if (!conversationElement) return;
  requestAnimationFrame(() => {
    conversationElement.scrollTop = conversationElement.scrollHeight;
  });
}

bindRangeDisplay(temperatureInput, temperatureValue, (value) => Number(value).toFixed(1));
bindRangeDisplay(topPInput, topPValue, (value) => Number(value).toFixed(2));
bindRangeDisplay(maxTokensInput, maxTokensValue);
bindRangeDisplay(memoryTurnsInput, memoryTurnsValue);

function resetImageSelection() {
  currentImageDataUrl = null;
  imagePreview.classList.add("hidden");
  imagePreview.src = "";
  imageInput.value = "";
}

imageInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Please select an image file.");
    resetImageSelection();
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    alert("Image is too large. Please use a file under ~3MB.");
    resetImageSelection();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    currentImageDataUrl = reader.result;
    imagePreview.src = currentImageDataUrl;
    imagePreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

clearImageButton.addEventListener("click", () => {
  resetImageSelection();
});

async function streamMessage(payload, assistantMessageId) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(errorText || "Network error");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const json = line.replace("data:", "").trim();
        if (!json) continue;

        const payload = JSON.parse(json);
        if (payload.type === "delta") {
          assistantText += payload.content;
          updateMessageContent(assistantMessageId, assistantText);
        } else if (payload.type === "done") {
          return assistantText;
        } else if (payload.type === "error") {
          throw new Error(payload.message || "Server error");
        }
      }
    }
  }

  return assistantText;
}

async function getMessage() {
  const userInput = promptElement.value.trim();
  if ((!userInput && !currentImageDataUrl) || isLoading) return;

  const chat = getActiveChat();
  if (!chat) {
    createChat();
  }

  const selectedModel = getSelectedModel();
  const allowImages = isVisionModel(selectedModel);
  if (currentImageDataUrl && !allowImages) {
    showInfoModal(
      "Vision model required",
      "This message includes an image. Please select a vision-capable model (e.g., Llama 4 Scout) or remove the image."
    );
    return;
  }

  setLoadingState(true);

  const safeText = userInput || "Describe this image.";
  const userMessage = {
    id: messageIdCounter++,
    role: "user",
    content: safeText,
    imageDataUrl: currentImageDataUrl
  };
  chat.messages.push(userMessage);

  if (chat.title === "New chat") {
    const titleSource = userInput || "Image chat";
    chat.title = titleSource.length > 24 ? `${titleSource.slice(0, 24)}...` : titleSource;
    renderChatList();
  }

  const payload = {
    model: selectedModel,
    params: {
      temperature: Number(temperatureInput.value),
      top_p: Number(topPInput.value),
      max_tokens: Number(maxTokensInput.value)
    },
    messages: buildMessagesForRequest(chat, allowImages)
  };

  const assistantMessage = { id: messageIdCounter++, role: "assistant", content: "" };
  chat.messages.push(assistantMessage);
  renderConversation();

  try {
    const aiMessage = await streamMessage(payload, assistantMessage.id);
    assistantMessage.content = aiMessage;
    saveState();
  } catch (error) {
    assistantMessage.content = error?.message || "Something went wrong. Please try again.";
    updateMessageContent(assistantMessage.id, assistantMessage.content);
    saveState();
  } finally {
    setLoadingState(false);
    promptElement.value = "";
    promptElement.focus();
    currentImageDataUrl = null;
    imagePreview.classList.add("hidden");
    imagePreview.src = "";
    imageInput.value = "";
  }
}

submitButton.addEventListener("click", getMessage);

promptElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    getMessage();
  }
});

newChatButton.addEventListener("click", () => {
  createChat();
  promptElement.value = "";
  promptElement.focus();
});

renameChatButton.addEventListener("click", () => {
  const chat = getActiveChat();
  if (!chat) return;
  modalConfirmHandler = () => {
    const newTitle = modalInput.value.trim();
    if (!newTitle) return;
    chat.title = newTitle;
    renderChatList();
    saveState();
  };
  openModal({
    title: "Rename chat",
    message: "Set a new name for this chat.",
    inputValue: chat.title,
    showInput: true,
    confirmLabel: "Rename"
  });
});

deleteChatButton.addEventListener("click", () => {
  const chat = getActiveChat();
  if (!chat) return;
  modalConfirmHandler = () => {
    const index = chats.findIndex((item) => item.id === chat.id);
    if (index >= 0) {
      chats.splice(index, 1);
    }
    if (chats.length === 0) {
      createChat();
      return;
    }
    activeChatId = chats[0].id;
    renderChatList();
    renderConversation();
    saveState();
  };
  openModal({
    title: "Delete chat",
    message: `Delete \"${chat.title}\"? This cannot be undone.`,
    showInput: false,
    confirmLabel: "Delete"
  });
});

newFolderButton.addEventListener("click", () => {
  const name = prompt("Folder name:");
  if (!name) return;
  const folder = {
    id: folderIdCounter++,
    name: name.trim() || "Untitled",
    isOpen: true
  };
  folders.unshift(folder);
  renderChatList();
  saveState();
});

exportButton.addEventListener("click", () => {
  const payload = {
    chats,
    folders,
    activeChatId,
    chatIdCounter,
    messageIdCounter,
    folderIdCounter,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `beno-gpt-chats-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

importInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  // Refresh from storage in case another tab has newer state.
  loadState();
  const reader = new FileReader();
  reader.onerror = () => {
    showInfoModal("Import failed", "Unable to read the file. Please try again.");
  };
  reader.onload = () => {
    try {
      let data = JSON.parse(reader.result);
      if (typeof data === "string") {
        data = JSON.parse(data);
      }
      let chatsPayload = null;
      let foldersPayload = null;
      if (Array.isArray(data)) {
        chatsPayload = data;
      } else if (Array.isArray(data.chats)) {
        chatsPayload = data.chats;
        foldersPayload = Array.isArray(data.folders) ? data.folders : null;
      } else if (Array.isArray(data.data)) {
        chatsPayload = data.data;
      }

      if (!Array.isArray(chatsPayload)) {
        const keys = data && typeof data === "object" ? Object.keys(data).join(", ") : "unknown";
        throw new Error(`Invalid file format. Keys: ${keys}`);
      }
      const folderMap = new Map();
      if (Array.isArray(foldersPayload)) {
        foldersPayload.forEach((folder) => {
          const newFolder = {
            id: folderIdCounter++,
            name: folder.name || "Imported folder",
            isOpen: typeof folder.isOpen === "boolean" ? folder.isOpen : true
          };
          folders.push(newFolder);
          folderMap.set(folder.id, newFolder.id);
        });
      }

      chatsPayload.forEach((chat) => {
        const newChat = {
          id: chatIdCounter++,
          title: chat.title || "Imported chat",
          messages: [],
          folderId: folderMap.get(chat.folderId) || null
        };

        if (Array.isArray(chat.messages)) {
          chat.messages.forEach((msg) => {
            newChat.messages.push({
              id: messageIdCounter++,
              role: msg.role || "user",
              content: msg.content || "",
              imageDataUrl: msg.imageDataUrl || null
            });
          });
        }

        chats.push(newChat);
      });

      if (!activeChatId && chats[0]) {
        activeChatId = chats[0].id;
      }
      renderChatList();
      renderConversation();
      saveState();
    } catch (error) {
      showInfoModal("Import failed", error?.message || "Please check the file format.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
});

if (chats.length === 0 && !loadState()) {
  createChat();
}
