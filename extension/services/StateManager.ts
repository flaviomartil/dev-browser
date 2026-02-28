const STORAGE_KEY = "devBrowserActiveState";
const CONFIG_KEY = "devBrowserConfig";

export interface ExtensionState {
  isActive: boolean;
}

export interface DevBrowserConfig {
  relayUrl: string;
  autoAttach: boolean;
}

const DEFAULT_CONFIG: DevBrowserConfig = {
  relayUrl: "ws://localhost:9222/extension",
  autoAttach: false,
};

export class StateManager {
  async getState(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const state = result[STORAGE_KEY] as ExtensionState | undefined;
    return state ?? { isActive: false };
  }

  async setState(state: ExtensionState): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  async getConfig(): Promise<DevBrowserConfig> {
    const result = await chrome.storage.local.get(CONFIG_KEY);
    const config = result[CONFIG_KEY] as Partial<DevBrowserConfig> | undefined;
    return { ...DEFAULT_CONFIG, ...config };
  }

  async setConfig(config: Partial<DevBrowserConfig>): Promise<DevBrowserConfig> {
    const current = await this.getConfig();
    const updated = { ...current, ...config };
    await chrome.storage.local.set({ [CONFIG_KEY]: updated });
    return updated;
  }
}
