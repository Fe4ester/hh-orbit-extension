import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, type Browser, type Page } from "playwright-core";
import { z } from "zod";

const cdpUrl = process.env.HH_CDP_URL ?? "http://127.0.0.1:9222";
const allowedHosts = new Set(["hh.ru", "www.hh.ru", "chatik.hh.ru", "websocket.hh.ru"]);
const maxEvents = 1_000;
const sensitiveKey =
  /authorization|cookie|token|xsrf|csrf|secret|password|session|credential|phone|email|message|text/i;

type CapturedEvent = {
  at: string;
  kind: "request" | "response" | "websocket-open" | "websocket-frame";
  method?: string;
  resourceType?: string;
  status?: number;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  direction?: "sent" | "received";
};

let browser: Browser | undefined;
let activePage: Page | undefined;
let captureEnabled = false;
const events: CapturedEvent[] = [];
const instrumentedPages = new WeakSet<Page>();

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function assertAllowedUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new Error(`Only HTTPS URLs on ${[...allowedHosts].join(", ")} are allowed`);
  }
  return url;
}

function safeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? "<redacted>" : value,
    ]),
  );
}

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function safeUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const path = url.pathname
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\/\d{5,}(?=\/|$)/g, "/<id>")
    .replace(/\/[0-9a-f]{24,}(?=\/|$)/gi, "/<id>");
  for (const [key, value] of url.searchParams) {
    if (sensitiveKey.test(key) || /hash|guid|uid|chat|topic|resume/i.test(key)) {
      url.searchParams.set(key, `<redacted:${fingerprint(value)}>`);
    }
  }
  return `${url.origin}${path}${url.search}`;
}

function redact(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    return { redacted: true, length: raw.length, sha256_16: fingerprint(raw) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redact(childValue, childKey),
      ]),
    );
  }
  return value;
}

function safeBody(rawBody: string | null) {
  if (!rawBody) return undefined;
  try {
    return redact(JSON.parse(rawBody));
  } catch {
    const params = new URLSearchParams(rawBody);
    if ([...params.keys()].length > 0) {
      return Object.fromEntries(
        [...params.entries()].map(([key, value]) => [key, redact(value, key)]),
      );
    }
    return { length: rawBody.length, sha256_16: fingerprint(rawBody) };
  }
}

function pushEvent(event: CapturedEvent) {
  events.push(event);
  if (events.length > maxEvents) events.shift();
}

function instrument(page: Page) {
  if (instrumentedPages.has(page)) return;
  instrumentedPages.add(page);

  page.on("request", (request) => {
    if (!captureEnabled) return;
    const url = new URL(request.url());
    if (!allowedHosts.has(url.hostname)) return;
    pushEvent({
      at: new Date().toISOString(),
      kind: "request",
      method: request.method(),
      resourceType: request.resourceType(),
      url: safeUrl(request.url()),
      headers: safeHeaders(request.headers()),
      body: safeBody(request.postData()),
    });
  });

  page.on("response", (response) => {
    if (!captureEnabled) return;
    const url = new URL(response.url());
    if (!allowedHosts.has(url.hostname)) return;
    pushEvent({
      at: new Date().toISOString(),
      kind: "response",
      status: response.status(),
      url: safeUrl(response.url()),
      headers: safeHeaders(response.headers()),
    });
  });

  page.on("websocket", (socket) => {
    if (!captureEnabled) return;
    const url = new URL(socket.url());
    if (!allowedHosts.has(url.hostname)) return;
    pushEvent({ at: new Date().toISOString(), kind: "websocket-open", url: safeUrl(socket.url()) });
    const captureFrame = (direction: "sent" | "received", payload: string | Buffer) => {
      const raw = payload.toString();
      pushEvent({
        at: new Date().toISOString(),
        kind: "websocket-frame",
        direction,
        url: safeUrl(socket.url()),
        body: { length: raw.length, sha256_16: fingerprint(raw) },
      });
    };
    socket.on("framesent", ({ payload }) => captureFrame("sent", payload));
    socket.on("framereceived", ({ payload }) => captureFrame("received", payload));
  });
}

async function connect() {
  if (!browser?.isConnected()) {
    browser = await chromium.connectOverCDP(cdpUrl);
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error("The CDP browser has no default context");
  for (const page of context.pages()) instrument(page);
  context.on("page", instrument);
  activePage ??= context.pages().find((page) => page.url().includes("hh.ru")) ?? context.pages()[0];
  activePage ??= await context.newPage();
  instrument(activePage);
  return { context, page: activePage };
}

async function pageByIndex(index?: number) {
  const { context, page } = await connect();
  if (index === undefined) return page;
  const selected = context.pages()[index];
  if (!selected) throw new Error(`Page index ${index} does not exist`);
  activePage = selected;
  return selected;
}

const server = new McpServer({ name: "hh-browser-contracts", version: "1.0.0" });

server.registerTool(
  "hh_pages",
  { description: "List open pages without exposing cookies or browser storage.", inputSchema: {} },
  async () => {
    const { context } = await connect();
    return text(
      await Promise.all(
        context.pages().map(async (page, index) => ({
          index,
          active: page === activePage,
          url: page.url(),
          title: await page.title(),
        })),
      ),
    );
  },
);

server.registerTool(
  "hh_navigate",
  {
    description: "Navigate the active page to an allow-listed HH URL.",
    inputSchema: { url: z.string().url(), waitUntil: z.enum(["domcontentloaded", "load", "networkidle"]).default("domcontentloaded") },
  },
  async ({ url, waitUntil }) => {
    assertAllowedUrl(url);
    const page = await pageByIndex();
    await page.goto(url, { waitUntil });
    return text({ url: page.url(), title: await page.title() });
  },
);

server.registerTool(
  "hh_snapshot",
  {
    description: "Inspect visible HH DOM, including open Magritte dialogs, without browser secrets.",
    inputSchema: {
      selector: z.string().default("body"),
      pageIndex: z.number().int().nonnegative().optional(),
      maxItems: z.number().int().min(1).max(500).default(150),
    },
  },
  async ({ selector, pageIndex, maxItems }) => {
    const page = await pageByIndex(pageIndex);
    const frames = page.frames();
    const output = [];
    for (const [frameIndex, frame] of frames.entries()) {
      const items = await frame.locator(selector).evaluateAll(
        (nodes, limit) =>
          nodes.slice(0, limit).map((node) => {
            const element = node as HTMLElement;
            const attributes = Object.fromEntries(
              [...element.attributes]
                .filter(({ name }) => /^(data-qa|role|aria-|name$|type$|href$)/.test(name))
                .map(({ name, value }) => [name, value]),
            );
            const qa = element.getAttribute("data-qa") ?? "";
            const rawText = (element.innerText || element.textContent || "").trim();
            const containsMessageBody =
              /chat-message|message-(body|text|content)|message_body|message_text/i.test(qa);
            return {
              tag: element.tagName.toLowerCase(),
              attributes,
              text: containsMessageBody
                ? `<redacted message text; length=${rawText.length}>`
                : rawText.slice(0, 1_000),
            };
          }),
        maxItems,
      );
      if (items.length > 0) output.push({ frameIndex, url: frame.url(), items });
    }
    return text({ pageUrl: page.url(), frames: output });
  },
);

server.registerTool(
  "hh_click",
  {
    description: "Click one HH element by CSS selector. Does not bypass confirmations or CAPTCHA.",
    inputSchema: {
      selector: z.string().min(1),
      pageIndex: z.number().int().nonnegative().optional(),
      frameUrlIncludes: z.string().optional(),
    },
  },
  async ({ selector, pageIndex, frameUrlIncludes }) => {
    const page = await pageByIndex(pageIndex);
    const frame = frameUrlIncludes
      ? page.frames().find((candidate) => candidate.url().includes(frameUrlIncludes))
      : page.mainFrame();
    if (!frame) throw new Error(`Frame containing "${frameUrlIncludes}" was not found`);
    const locator = frame.locator(selector).first();
    await locator.click();
    return text({ clicked: selector, pageUrl: page.url() });
  },
);

server.registerTool(
  "hh_fill",
  {
    description: "Fill a visible HH form control. Values are never logged or returned.",
    inputSchema: {
      selector: z.string().min(1),
      value: z.string(),
      pageIndex: z.number().int().nonnegative().optional(),
      frameUrlIncludes: z.string().optional(),
    },
  },
  async ({ selector, value, pageIndex, frameUrlIncludes }) => {
    const page = await pageByIndex(pageIndex);
    const frame = frameUrlIncludes
      ? page.frames().find((candidate) => candidate.url().includes(frameUrlIncludes))
      : page.mainFrame();
    if (!frame) throw new Error(`Frame containing "${frameUrlIncludes}" was not found`);
    await frame.locator(selector).first().fill(value);
    return text({ filled: selector, valuePersisted: false });
  },
);

server.registerTool(
  "hh_capture",
  {
    description: "Start, stop, clear, or read a redacted HH fetch/XHR/WebSocket contract log.",
    inputSchema: {
      action: z.enum(["start", "stop", "clear", "read"]),
      kinds: z.array(z.enum(["request", "response", "websocket-open", "websocket-frame"])).optional(),
    },
  },
  async ({ action, kinds }) => {
    await connect();
    if (action === "start") captureEnabled = true;
    if (action === "stop") captureEnabled = false;
    if (action === "clear") events.length = 0;
    const selected = kinds ? events.filter((event) => kinds.includes(event.kind)) : events;
    return text({ captureEnabled, count: selected.length, events: action === "read" ? selected : undefined });
  },
);

await server.connect(new StdioServerTransport());
