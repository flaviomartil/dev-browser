import type { GetStateMessage, SetStateMessage, StateResponse } from "../../utils/types";

const toggle = document.getElementById("active-toggle") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const connectionStatus = document.getElementById("connection-status") as HTMLParagraphElement;
const relayUrlInput = document.getElementById("relay-url") as HTMLInputElement;
const autoAttachToggle = document.getElementById("auto-attach-toggle") as HTMLInputElement;

function updateUI(state: StateResponse): void {
  toggle.checked = state.isActive;
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

function refreshState(): void {
  chrome.runtime.sendMessage<GetStateMessage, StateResponse>({ type: "getState" }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
}

refreshState();

const pollInterval = setInterval(refreshState, 1000);

window.addEventListener("unload", () => {
  clearInterval(pollInterval);
});

toggle.addEventListener("change", () => {
  const isActive = toggle.checked;
  chrome.runtime.sendMessage<SetStateMessage, StateResponse>(
    { type: "setState", isActive },
    (response) => {
      if (response) {
        updateUI(response);
      }
    }
  );
});

let relayUrlTimeout: ReturnType<typeof setTimeout>;
relayUrlInput.addEventListener("input", () => {
  clearTimeout(relayUrlTimeout);
  relayUrlTimeout = setTimeout(() => {
    const relayUrl = relayUrlInput.value.trim();
    if (relayUrl) {
      chrome.runtime.sendMessage({ type: "setConfig", config: { relayUrl } });
    }
  }, 500);
});

autoAttachToggle.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: "setConfig",
    config: { autoAttach: autoAttachToggle.checked },
  });
});
