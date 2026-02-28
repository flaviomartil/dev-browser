import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { serveRelay } from "@/relay.js";
import { connect } from "@/client.js";
import type { RelayServer } from "@/relay.js";
import type { DevBrowserClient } from "@/client.js";
import type { Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function log(...args: unknown[]) {
  console.error("[mcp]", ...args);
}

let relay: RelayServer | null = null;
let client: DevBrowserClient | null = null;
let initializing: Promise<void> | null = null;

async function ensureReady(): Promise<DevBrowserClient> {
  if (client) return client;

  if (initializing) {
    await initializing;
    return client!;
  }

  initializing = (async () => {
    try {
      const res = await fetch("http://127.0.0.1:9222", {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        log("Relay already running on port 9222");
      }
    } catch {
      log("Starting relay server...");
      relay = await serveRelay({ port: 9222, host: "127.0.0.1" });
      log("Relay started");
    }

    client = await connect("http://127.0.0.1:9222");
    log("Client connected");
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }

  return client!;
}

async function resolvePageName(name?: string): Promise<{ page: Page; pageName: string }> {
  const c = await ensureReady();

  if (name) {
    const page = await c.page(name);
    return { page, pageName: name };
  }

  const targets = await c.snapshot();
  if (targets.length > 0) {
    const t = targets[0]!;
    const pageName = `target-${t.targetId.slice(0, 8)}`;
    const page = await c.page(pageName);
    return { page, pageName };
  }

  const tabs = await c.listTabs();
  const activeTab = tabs.find((t) => t.active);
  if (activeTab) {
    const result = await c.attachTab(activeTab.tabId);
    const pageName = `tab-${activeTab.tabId}`;
    const page = await c.page(pageName);
    return { page, pageName };
  }

  throw new Error("No tabs available. Open a tab in the browser first.");
}

const TOOLS = [
  {
    name: "browser_list_tabs",
    description: "List all browser tabs with their IDs, titles, URLs, and whether they are attached for automation.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "browser_attach_tab",
    description: "Attach to a browser tab by its tab ID to enable automation. Optionally assign a name for easy reference.",
    inputSchema: {
      type: "object" as const,
      properties: {
        tabId: { type: "number", description: "The tab ID to attach to" },
        name: { type: "string", description: "Optional name to assign to the attached tab" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_snapshot",
    description: "List all currently controlled (attached) targets with their session IDs, titles, and URLs.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "browser_navigate",
    description: "Navigate a page to a URL and wait for it to load.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to navigate to" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_read_page",
    description: "Read the text content of a page or a specific element. Returns innerText truncated to 50k characters.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        selector: { type: "string", description: "CSS selector to read from (defaults to body)" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Take a screenshot of a page. Returns the file path to the saved PNG image.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        fullPage: { type: "boolean", description: "Capture full scrollable page (default: false)" },
      },
    },
  },
  {
    name: "browser_click",
    description: "Click an element on a page by CSS selector or text content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector or text to click" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
      },
      required: ["selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input element on a page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        selector: { type: "string", description: "CSS selector of the input element" },
        text: { type: "string", description: "Text to type" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
        pressEnter: { type: "boolean", description: "Press Enter after typing (default: false)" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "browser_evaluate",
    description: "Execute JavaScript in the page context and return the result.",
    inputSchema: {
      type: "object" as const,
      properties: {
        script: { type: "string", description: "JavaScript code to evaluate" },
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
      },
      required: ["script"],
    },
  },
  {
    name: "browser_get_snapshot",
    description: "Get an ARIA accessibility tree snapshot of the page in YAML format. Useful for understanding page structure without screenshots.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Page name (auto-resolves if omitted)" },
      },
    },
  },
];

async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  try {
    switch (name) {
      case "browser_list_tabs": {
        const c = await ensureReady();
        const tabs = await c.listTabs();
        return text(JSON.stringify(tabs, null, 2));
      }

      case "browser_attach_tab": {
        const c = await ensureReady();
        const tabId = args.tabId as number;
        const tabName = args.name as string | undefined;
        const result = await c.attachTab(tabId, tabName);
        return text(JSON.stringify(result, null, 2));
      }

      case "browser_snapshot": {
        const c = await ensureReady();
        const targets = await c.snapshot();
        return text(JSON.stringify(targets, null, 2));
      }

      case "browser_navigate": {
        const url = args.url as string;
        const { page, pageName } = await resolvePageName(args.name as string | undefined);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const { waitForPageLoad } = await import("@/client.js");
        await waitForPageLoad(page, { timeout: 10000 });
        const title = await page.title();
        return text(`Navigated "${pageName}" to ${url}\nTitle: ${title}`);
      }

      case "browser_read_page": {
        const { page } = await resolvePageName(args.name as string | undefined);
        const selector = (args.selector as string) || "body";
        const content = await page.evaluate(
          (sel: string) => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const doc = (globalThis as any).document;
            /* eslint-enable @typescript-eslint/no-explicit-any */
            const el = doc.querySelector(sel);
            return el ? el.innerText : `Element not found: ${sel}`;
          },
          selector
        );
        const truncated = content.length > 50000 ? content.slice(0, 50000) + "\n...[truncated]" : content;
        return text(truncated);
      }

      case "browser_screenshot": {
        const { page, pageName } = await resolvePageName(args.name as string | undefined);
        const fullPage = (args.fullPage as boolean) ?? false;
        const screenshotDir = join(tmpdir(), "dev-browser-screenshots");
        mkdirSync(screenshotDir, { recursive: true });
        const filename = `screenshot-${Date.now()}.png`;
        const filepath = join(screenshotDir, filename);
        const buffer = await page.screenshot({ fullPage, type: "png" });
        writeFileSync(filepath, buffer);
        return text(`Screenshot saved: ${filepath}\nPage: ${pageName}\nUse the Read tool to view it.`);
      }

      case "browser_click": {
        const { page } = await resolvePageName(args.name as string | undefined);
        const selector = args.selector as string;
        try {
          await page.locator(selector).click({ timeout: 5000 });
        } catch {
          await page.getByText(selector, { exact: false }).first().click({ timeout: 5000 });
        }
        return text(`Clicked: ${selector}`);
      }

      case "browser_type": {
        const { page } = await resolvePageName(args.name as string | undefined);
        const selector = args.selector as string;
        const inputText = args.text as string;
        const pressEnter = (args.pressEnter as boolean) ?? false;
        const locator = page.locator(selector);
        await locator.fill(inputText, { timeout: 5000 });
        if (pressEnter) {
          await locator.press("Enter");
        }
        return text(`Typed "${inputText}" into ${selector}${pressEnter ? " + Enter" : ""}`);
      }

      case "browser_evaluate": {
        const { page } = await resolvePageName(args.name as string | undefined);
        const script = args.script as string;
        const result = await page.evaluate(script);
        const output = result === undefined ? "undefined" : JSON.stringify(result, null, 2);
        return text(output);
      }

      case "browser_get_snapshot": {
        const c = await ensureReady();
        const pageName = args.name as string | undefined;
        if (pageName) {
          const snapshot = await c.getAISnapshot(pageName);
          return text(snapshot);
        }
        const targets = await c.snapshot();
        if (targets.length === 0) {
          throw new Error("No controlled targets. Use browser_attach_tab first.");
        }
        const t = targets[0]!;
        const autoName = `target-${t.targetId.slice(0, 8)}`;
        await c.page(autoName);
        const snapshot = await c.getAISnapshot(autoName);
        return text(snapshot);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Tool error [${name}]:`, message);
    return { content: [{ type: "text", text: `Error: ${message}` }] };
  }
}

export async function startMcpServer() {
  const server = new Server(
    { name: "dev-browser", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  const shutdown = async () => {
    log("Shutting down...");
    if (client) {
      try { await client.disconnect(); } catch {}
      client = null;
    }
    if (relay) {
      try { await relay.stop(); } catch {}
      relay = null;
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running on stdio");
}
