const activeToggle = document.getElementById("active-toggle") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const relayUrlInput = document.getElementById("relay-url") as HTMLInputElement;
const saveUrlBtn = document.getElementById("save-url") as HTMLButtonElement;
const autoAttachToggle = document.getElementById("auto-attach-toggle") as HTMLInputElement;
const tabsList = document.getElementById("tabs-list") as HTMLDivElement;

interface TabInfo {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
  attached: boolean;
}

interface StateResponse {
  isActive: boolean;
  isConnected: boolean;
  config?: {
    relayUrl: string;
    autoAttach: boolean;
  };
}

function updateUI(state: StateResponse): void {
  activeToggle.checked = state.isActive;
  statusText.textContent = state.isActive ? "Active" : "Inactive";

  if (state.isActive) {
    connectionStatus.textContent = state.isConnected ? "Connected to relay" : "Connecting...";
    connectionStatus.className = state.isConnected
      ? "connection-status connected"
      : "connection-status connecting";
  } else {
    connectionStatus.textContent = "";
    connectionStatus.className = "connection-status";
  }

  if (state.config) {
    if (!relayUrlInput.matches(":focus")) {
      relayUrlInput.value = state.config.relayUrl;
    }
    autoAttachToggle.checked = state.config.autoAttach;
  }
}

function renderTabs(tabs: TabInfo[]): void {
  if (tabs.length === 0) {
    tabsList.innerHTML = '<p class="empty-state">No tabs found</p>';
    return;
  }

  tabsList.innerHTML = tabs
    .map(
      (tab) => `
    <div class="tab-item ${tab.attached ? "attached" : ""}">
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(tab.title || "Untitled")}</div>
        <div class="tab-url">${escapeHtml(tab.url)}</div>
      </div>
      ${
        tab.attached
          ? '<span class="tab-status attached">attached</span>'
          : `<button class="tab-attach-btn" data-tab-id="${tab.tabId}">Attach</button>`
      }
    </div>
  `
    )
    .join("");

  tabsList.querySelectorAll(".tab-attach-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = parseInt((btn as HTMLElement).dataset.tabId!, 10);
      chrome.runtime.sendMessage({ type: "attachTab", tabId });
      setTimeout(refreshTabs, 500);
    });
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function refreshState(): void {
  chrome.runtime.sendMessage({ type: "getState" }, (response: StateResponse) => {
    if (response) {
      updateUI(response);
    }
  });
}

function refreshTabs(): void {
  chrome.runtime.sendMessage({ type: "listTabs" }, (response: { tabs: TabInfo[] } | null) => {
    if (response && response.tabs) {
      renderTabs(response.tabs);
    }
  });
}

refreshState();
refreshTabs();

const pollInterval = setInterval(() => {
  refreshState();
  refreshTabs();
}, 2000);

window.addEventListener("unload", () => {
  clearInterval(pollInterval);
});

activeToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage(
    { type: "setState", isActive: activeToggle.checked },
    (response: StateResponse) => {
      if (response) updateUI(response);
    }
  );
});

saveUrlBtn.addEventListener("click", () => {
  const relayUrl = relayUrlInput.value.trim();
  if (relayUrl) {
    chrome.runtime.sendMessage({ type: "setConfig", config: { relayUrl } });
  }
});

autoAttachToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "setConfig",
    config: { autoAttach: autoAttachToggle.checked },
  });
});
