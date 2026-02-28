/**
 * dev-browser Chrome Extension Background Script
 *
 * This extension connects to the dev-browser relay server and allows
 * Playwright automation of the user's existing browser tabs.
 */

import { createLogger } from "../utils/logger";
import { TabManager } from "../services/TabManager";
import { ConnectionManager } from "../services/ConnectionManager";
import { CDPRouter } from "../services/CDPRouter";
import { StateManager } from "../services/StateManager";
import type { PopupMessage, StateResponse, ConfigResponse } from "../utils/types";

export default defineBackground(() => {
  // Create connection manager first (needed for sendMessage)
  let connectionManager: ConnectionManager;

  // Create logger with sendMessage function
  const logger = createLogger((msg) => connectionManager?.send(msg));

  // Create state manager for persistence
  const stateManager = new StateManager();

  // Create tab manager
  const tabManager = new TabManager({
    logger,
    sendMessage: (msg) => connectionManager.send(msg),
  });

  // Create CDP router
  const cdpRouter = new CDPRouter({
    logger,
    tabManager,
  });

  // Create connection manager
  connectionManager = new ConnectionManager({
    logger,
    onMessage: (msg) => cdpRouter.handleCommand(msg),
    onDisconnect: () => tabManager.detachAll(),
  });

  // Keep-alive alarm name for Chrome Alarms API
  const KEEPALIVE_ALARM = "keepAlive";

  // Update badge to show active/inactive state
  function updateBadge(isActive: boolean): void {
    chrome.action.setBadgeText({ text: isActive ? "ON" : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
  }

  // Handle state changes
  async function handleStateChange(isActive: boolean): Promise<void> {
    await stateManager.setState({ isActive });
    if (isActive) {
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
      connectionManager.startMaintaining();
    } else {
      chrome.alarms.clear(KEEPALIVE_ALARM);
      connectionManager.disconnect();
    }
    updateBadge(isActive);
  }

  // Handle debugger events
  function onDebuggerEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown
  ): void {
    cdpRouter.handleDebuggerEvent(source, method, params, (msg) => connectionManager.send(msg));
  }

  function onDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: `${chrome.debugger.DetachReason}`
  ): void {
    const tabId = source.tabId;
    if (!tabId) return;

    logger.debug(`Debugger detached for tab ${tabId}: ${reason}`);
    tabManager.handleDebuggerDetach(tabId);
  }

  chrome.runtime.onMessage.addListener(
    (
      message: PopupMessage & { type: string; tabId?: number; config?: Record<string, unknown> },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      if (message.type === "getState") {
        (async () => {
          const state = await stateManager.getState();
          const isConnected = await connectionManager.checkConnection();
          const config = await stateManager.getConfig();
          sendResponse({
            isActive: state.isActive,
            isConnected,
            config,
          });
        })();
        return true;
      }

      if (message.type === "setState") {
        (async () => {
          await handleStateChange(message.isActive);
          const state = await stateManager.getState();
          const isConnected = await connectionManager.checkConnection();
          const config = await stateManager.getConfig();
          sendResponse({
            isActive: state.isActive,
            isConnected,
            config,
          });
        })();
        return true;
      }

      if (message.type === "getConfig") {
        (async () => {
          const config = await stateManager.getConfig();
          sendResponse({ config });
        })();
        return true;
      }

      if (message.type === "setConfig") {
        (async () => {
          const config = await stateManager.setConfig(message.config as Record<string, unknown>);
          connectionManager.setRelayUrl(config.relayUrl);
          sendResponse({ config });
        })();
        return true;
      }

      if (message.type === "listTabs") {
        (async () => {
          try {
            const tabs = await chrome.tabs.query({});
            const attachedTabIds = new Set(tabManager.getAllTabIds());
            sendResponse({
              tabs: tabs
                .filter((tab) => tab.id !== undefined)
                .map((tab) => ({
                  tabId: tab.id!,
                  title: tab.title || "",
                  url: tab.url || "",
                  active: tab.active,
                  attached: attachedTabIds.has(tab.id!),
                })),
            });
          } catch {
            sendResponse({ tabs: [] });
          }
        })();
        return true;
      }

      if (message.type === "attachTab" && message.tabId) {
        (async () => {
          try {
            if (tabManager.has(message.tabId!)) {
              sendResponse({ success: true });
              return;
            }
            await tabManager.attach(message.tabId!);
            sendResponse({ success: true });
          } catch (err) {
            sendResponse({ success: false, error: (err as Error).message });
          }
        })();
        return true;
      }

      return false;
    }
  );

  // Set up event listeners

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabManager.has(tabId)) {
      logger.debug("Tab closed:", tabId);
      tabManager.detach(tabId, false);
    }
  });

  chrome.tabs.onCreated.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      const state = await stateManager.getState();
      const config = await stateManager.getConfig();
      if (!state.isActive || !config.autoAttach) return;
      if (!connectionManager.isConnected()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (tabManager.has(tab.id)) return;
      await tabManager.attach(tab.id);
      logger.debug("Auto-attached new tab:", tab.id);
    } catch (err) {
      logger.debug("Auto-attach failed for tab:", tab.id, err);
    }
  });

  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);

  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }

  chrome.debugger.getTargets().then((targets) => {
    const attached = targets.filter((t) => t.tabId && t.attached);
    if (attached.length > 0) {
      logger.log(`Detaching ${attached.length} stale debugger connections`);
      for (const target of attached) {
        chrome.debugger.detach({ tabId: target.tabId }).catch(() => {});
      }
    }
  });

  logger.log("Extension initialized");

  Promise.all([stateManager.getState(), stateManager.getConfig()]).then(([state, config]) => {
    connectionManager.setRelayUrl(config.relayUrl);
    updateBadge(state.isActive);
    if (state.isActive) {
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
      connectionManager.startMaintaining();
    }
  });

  // Set up Chrome Alarms keep-alive listener
  // This ensures the connection is maintained even after service worker unloads
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      const state = await stateManager.getState();

      if (state.isActive) {
        const isConnected = connectionManager.isConnected();

        if (!isConnected) {
          logger.debug("Keep-alive: Connection lost, restarting...");
          connectionManager.startMaintaining();
        }
      }
    }
  });
});
