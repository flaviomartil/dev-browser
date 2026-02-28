/**
 * CDPRouter - Routes CDP commands to the correct tab.
 */

import type { Logger } from "../utils/logger";
import type { TabManager } from "./TabManager";
import type { ExtensionCommandMessage, TabInfo } from "../utils/types";

export interface CDPRouterDeps {
  logger: Logger;
  tabManager: TabManager;
}

export class CDPRouter {
  private logger: Logger;
  private tabManager: TabManager;
  private devBrowserGroupId: number | null = null;

  constructor(deps: CDPRouterDeps) {
    this.logger = deps.logger;
    this.tabManager = deps.tabManager;
  }

  /**
   * Gets or creates the "Dev Browser" tab group, returning its ID.
   */
  private async getOrCreateDevBrowserGroup(tabId: number): Promise<number> {
    if (!chrome.tabGroups) {
      throw new Error("tabGroups API not available");
    }

    if (this.devBrowserGroupId !== null) {
      try {
        await chrome.tabGroups.get(this.devBrowserGroupId);
        await chrome.tabs.group({ tabIds: [tabId], groupId: this.devBrowserGroupId });
        return this.devBrowserGroupId;
      } catch {
        this.devBrowserGroupId = null;
      }
    }

    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, {
      title: "Dev Browser",
      color: "blue",
    });
    this.devBrowserGroupId = groupId;
    return groupId;
  }

  async handleCommand(msg: ExtensionCommandMessage): Promise<unknown> {
    switch (msg.method) {
      case "listTabs": {
        const tabs = await chrome.tabs.query({});
        const attachedTabIds = new Set(this.tabManager.getAllTabIds());
        return {
          tabs: tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) => ({
              tabId: tab.id!,
              title: tab.title || "",
              url: tab.url || "",
              active: tab.active,
              attached: attachedTabIds.has(tab.id!),
            })),
        };
      }

      case "attachTab": {
        const tabId = (msg.params as unknown as { tabId: number }).tabId;
        if (!tabId) throw new Error("tabId is required");
        if (this.tabManager.has(tabId)) {
          const existing = this.tabManager.get(tabId)!;
          return { targetId: existing.targetId, sessionId: existing.sessionId };
        }
        const targetInfo = await this.tabManager.attach(tabId);
        try {
          await this.getOrCreateDevBrowserGroup(tabId);
        } catch {
          this.logger.debug("Tab grouping not supported, skipping");
        }
        return { targetId: targetInfo.targetId };
      }

      case "forwardCDPCommand":
        return this.handleCDPCommand(msg);

      default:
        return undefined;
    }
  }

  private async handleCDPCommand(msg: ExtensionCommandMessage): Promise<unknown> {
    let targetTabId: number | undefined;
    let targetTab: TabInfo | undefined;

    if (msg.params.sessionId) {
      const found = this.tabManager.getBySessionId(msg.params.sessionId);
      if (found) {
        targetTabId = found.tabId;
        targetTab = found.tab;
      }
    }

    if (!targetTab && msg.params.sessionId) {
      const parentTabId = this.tabManager.getParentTabId(msg.params.sessionId);
      if (parentTabId) {
        targetTabId = parentTabId;
        targetTab = this.tabManager.get(parentTabId);
        this.logger.debug(
          "Found parent tab for child session:",
          msg.params.sessionId,
          "tabId:",
          parentTabId
        );
      }
    }

    if (
      !targetTab &&
      msg.params.params &&
      typeof msg.params.params === "object" &&
      "targetId" in msg.params.params
    ) {
      const found = this.tabManager.getByTargetId(msg.params.params.targetId as string);
      if (found) {
        targetTabId = found.tabId;
        targetTab = found.tab;
      }
    }

    const debuggee = targetTabId ? { tabId: targetTabId } : undefined;

    switch (msg.params.method) {
      case "Runtime.enable": {
        if (!debuggee) {
          throw new Error(
            `No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`
          );
        }
        try {
          await chrome.debugger.sendCommand(debuggee, "Runtime.disable");
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch {
        }
        return await chrome.debugger.sendCommand(debuggee, "Runtime.enable", msg.params.params);
      }

      case "Target.createTarget": {
        const url = (msg.params.params?.url as string) || "about:blank";
        this.logger.debug("Creating new tab with URL:", url);
        const tab = await chrome.tabs.create({ url, active: false });
        if (!tab.id) throw new Error("Failed to create tab");

        try {
          await this.getOrCreateDevBrowserGroup(tab.id);
        } catch {
          this.logger.debug("Tab grouping not supported, skipping");
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
        const targetInfo = await this.tabManager.attach(tab.id);
        return { targetId: targetInfo.targetId };
      }

      case "Target.closeTarget": {
        if (!targetTabId) {
          this.logger.log(`Target not found: ${msg.params.params?.targetId}`);
          return { success: false };
        }
        await chrome.tabs.remove(targetTabId);
        return { success: true };
      }

      case "Target.activateTarget": {
        if (!targetTabId) {
          this.logger.log(`Target not found for activation: ${msg.params.params?.targetId}`);
          return {};
        }
        await chrome.tabs.update(targetTabId, { active: true });
        return {};
      }
    }

    if (!debuggee || !targetTab) {
      throw new Error(
        `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId}`
      );
    }

    this.logger.debug("CDP command:", msg.params.method, "for tab:", targetTabId);

    const debuggerSession: chrome.debugger.DebuggerSession = {
      ...debuggee,
      sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : undefined,
    };

    return await chrome.debugger.sendCommand(debuggerSession, msg.params.method, msg.params.params);
  }

  /**
   * Handle debugger events from Chrome.
   */
  handleDebuggerEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown,
    sendMessage: (msg: unknown) => void
  ): void {
    const tab = source.tabId ? this.tabManager.get(source.tabId) : undefined;
    if (!tab) return;

    this.logger.debug("Forwarding CDP event:", method, "from tab:", source.tabId);

    // Track child sessions
    if (
      method === "Target.attachedToTarget" &&
      params &&
      typeof params === "object" &&
      "sessionId" in params
    ) {
      const sessionId = (params as { sessionId: string }).sessionId;
      this.tabManager.trackChildSession(sessionId, source.tabId!);
    }

    if (
      method === "Target.detachedFromTarget" &&
      params &&
      typeof params === "object" &&
      "sessionId" in params
    ) {
      const sessionId = (params as { sessionId: string }).sessionId;
      this.tabManager.untrackChildSession(sessionId);
    }

    sendMessage({
      method: "forwardCDPEvent",
      params: {
        sessionId: source.sessionId || tab.sessionId,
        method,
        params,
      },
    });
  }
}
