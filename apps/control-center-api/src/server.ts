#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import YAML from "yaml";

type Channel = "web" | "api" | "device";
type RunStatus = "queued" | "running" | "passed" | "failed" | "canceled";
type SpecFormat = "yaml" | "json";

interface SuiteInfo {
  id: string;
  name: string;
  channel: Channel;
  specPath: string;
}

interface RunRecord {
  id: string;
  channel: Channel;
  suiteName: string;
  specPath: string;
  command: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  reportPath?: string;
  logs: string[];
}

interface PlanAction {
  channel: Channel;
  command: string;
  suggestedSpecPath: string;
  reason: string;
}

interface IntentPlan {
  intent: string;
  actions: PlanAction[];
  nextStep: string;
}

interface GeneratedSuite {
  channel: Channel;
  suiteName: string;
  specPath: string;
  content: string;
}

const PORT = Number(process.env.UAP_API_PORT || 8787);
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const EXAMPLES_DIR = resolve(ROOT_DIR, "examples");
const REPORTS_DIR = resolve(ROOT_DIR, "reports");
const FUNCTIONS_FILE = resolve(EXAMPLES_DIR, "functions", "reusable.yaml");
const GENERATED_DIR = resolve(EXAMPLES_DIR, "generated");

const CHANNEL_EXAMPLE_DIR: Record<Channel, string> = {
  web: "web",
  api: "api",
  device: "device",
};

const CHANNEL_FILTER: Record<Channel, string> = {
  web: "@uap/cli-web",
  api: "@uap/cli-api",
  device: "@uap/cli-appium",
};

const runs = new Map<string, RunRecord>();
type ActiveRunProcess = ReturnType<typeof spawn>;
const runProcesses = new Map<string, ActiveRunProcess>();
let sequence = 1;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "control-center-api", now: new Date().toISOString() });
});

app.get("/api/suites", async (_req, res) => {
  try {
    const suites = await discoverSuites();
    res.json({ suites });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/suites", async (req, res) => {
  try {
    const body = req.body as {
      channel?: Channel;
      suiteName?: string;
      filename?: string;
    };

    if (!body.channel || !isChannel(body.channel)) {
      res.status(400).json({ error: "channel must be one of: web, api, device" });
      return;
    }

    if (!body.suiteName || typeof body.suiteName !== "string") {
      res.status(400).json({ error: "suiteName is required" });
      return;
    }

    const suiteName = body.suiteName.trim();
    if (!suiteName) {
      res.status(400).json({ error: "suiteName cannot be empty" });
      return;
    }

    const fileStem = sanitizeFilename(body.filename || suiteName);
    const channelDir = resolve(EXAMPLES_DIR, CHANNEL_EXAMPLE_DIR[body.channel]);
    await mkdir(channelDir, { recursive: true });

    const filePath = resolve(channelDir, `${fileStem}.yaml`);
    if (existsSync(filePath)) {
      res.status(409).json({ error: `Suite file already exists: ${relative(ROOT_DIR, filePath)}` });
      return;
    }

    await writeFile(filePath, buildSuiteTemplate(body.channel, suiteName), "utf-8");

    res.status(201).json({
      suite: {
        id: `${body.channel}:${relative(ROOT_DIR, filePath)}`,
        name: suiteName,
        channel: body.channel,
        specPath: relative(ROOT_DIR, filePath),
      },
    });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/suite-content", async (req, res) => {
  try {
    const suite = await resolveSuiteFromBody({
      suiteId: toString(req.query.suiteId),
      channel: toChannel(req.query.channel),
      specPath: toString(req.query.specPath),
    });

    if (!suite) {
      res.status(400).json({ error: "Provide suiteId or { channel, specPath }" });
      return;
    }

    const fullPath = resolve(ROOT_DIR, suite.specPath);
    const content = await readFile(fullPath, "utf-8");
    const format = detectFormat(suite.specPath);

    res.json({ suite, content, format });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.put("/api/suite-content", async (req, res) => {
  try {
    const body = req.body as {
      suiteId?: string;
      channel?: Channel;
      specPath?: string;
      content?: string;
    };

    if (typeof body.content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const suite = await resolveSuiteFromBody(body);
    if (!suite) {
      res.status(400).json({ error: "Provide suiteId or { channel, specPath }" });
      return;
    }

    const format = detectFormat(suite.specPath);
    assertContentParses(body.content, format);

    const fullPath = resolve(ROOT_DIR, suite.specPath);
    await writeFile(fullPath, body.content, "utf-8");

    const parsedName = extractSuiteName(body.content, format);
    if (parsedName) {
      suite.name = parsedName;
      suite.id = `${suite.channel}:${suite.specPath}`;
    }

    res.json({ suite, saved: true });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/functions", async (_req, res) => {
  try {
    const { functions, source } = await loadFunctionsFromFile();
    res.json({ functions, source });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/functions/content", async (_req, res) => {
  try {
    await ensureFunctionsFile();
    const content = await readFile(FUNCTIONS_FILE, "utf-8");
    const parsed = YAML.parse(content) as { functions?: unknown[] } | unknown[];
    const functions = Array.isArray(parsed) ? parsed : parsed.functions || [];

    res.json({
      source: relative(ROOT_DIR, FUNCTIONS_FILE),
      content,
      functions,
    });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.put("/api/functions/content", async (req, res) => {
  try {
    const body = req.body as { content?: string };
    if (typeof body.content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const parsed = YAML.parse(body.content) as { functions?: unknown[] } | unknown[];
    const functions = Array.isArray(parsed) ? parsed : parsed.functions;
    if (!Array.isArray(functions)) {
      res.status(400).json({ error: "functions content must include a functions array" });
      return;
    }

    await ensureFunctionsFile();
    await writeFile(FUNCTIONS_FILE, body.content, "utf-8");

    res.json({ source: relative(ROOT_DIR, FUNCTIONS_FILE), count: functions.length, saved: true });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/runs", async (req, res) => {
  try {
    const body = req.body as {
      suiteId?: string;
      channel?: Channel;
      specPath?: string;
      envFile?: string;
      functionsFile?: string;
      headless?: boolean;
    };

    const suite = await resolveSuiteFromBody(body);
    if (!suite) {
      res.status(400).json({ error: "Provide a valid suiteId or { channel, specPath }" });
      return;
    }

    const runId = nextRunId();
    await mkdir(REPORTS_DIR, { recursive: true });
    const reportPath = relative(ROOT_DIR, resolve(REPORTS_DIR, `${runId}.json`));
    const reportAbsolutePath = resolve(ROOT_DIR, reportPath);
    const specAbsolutePath = resolve(ROOT_DIR, suite.specPath);

    const args = [
      "--filter",
      CHANNEL_FILTER[suite.channel],
      "dev",
      "run",
      specAbsolutePath,
      "--report",
      reportAbsolutePath,
    ];

    if (body.envFile) {
      args.push("--env", toAbsolutePath(body.envFile));
    }

    if (body.functionsFile) {
      args.push("--functions", toAbsolutePath(body.functionsFile));
    }

    if (suite.channel === "web" && typeof body.headless === "boolean") {
      args.push("--headless", String(body.headless));
    }

    const command = `pnpm ${args.map(escapeArg).join(" ")}`;
    const record: RunRecord = {
      id: runId,
      channel: suite.channel,
      suiteName: suite.name,
      specPath: suite.specPath,
      command,
      status: "queued",
      createdAt: new Date().toISOString(),
      reportPath,
      logs: [],
    };

    runs.set(runId, record);
    startRunProcess(record, args);

    res.status(201).json({ run: record });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.get("/api/runs", (_req, res) => {
  const list = [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ runs: list });
});

app.get("/api/runs/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json({ run });
});

app.get("/api/runs/:id/logs", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json({
    id: run.id,
    status: run.status,
    logs: run.logs,
    finishedAt: run.finishedAt,
  });
});

app.get("/api/runs/:id/report", async (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  if (!run.reportPath) {
    res.status(404).json({ error: "Run has no report path" });
    return;
  }

  const reportFile = resolve(ROOT_DIR, run.reportPath);
  if (!existsSync(reportFile)) {
    res.status(404).json({ error: "Report file not found" });
    return;
  }

  const report = JSON.parse(await readFile(reportFile, "utf-8"));
  res.json({ report });
});

app.post("/api/runs/:id/cancel", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const proc = runProcesses.get(run.id);
  if (!proc) {
    res.status(400).json({ error: "Run is not currently active" });
    return;
  }

  proc.kill("SIGTERM");
  run.status = "canceled";
  run.finishedAt = new Date().toISOString();
  appendLog(run, "[system] Run canceled by user");
  res.json({ run });
});

app.post("/api/mcp/plan", async (req, res) => {
  try {
    const body = req.body as { intent?: string };
    if (!body.intent || typeof body.intent !== "string") {
      res.status(400).json({ error: "intent is required" });
      return;
    }

    const suites = await discoverSuites();
    const plan = buildPlan(body.intent, suites);
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.post("/api/mcp/generate", async (req, res) => {
  try {
    const body = req.body as {
      intent?: string;
      channels?: Channel[];
      save?: boolean;
    };

    if (!body.intent || typeof body.intent !== "string") {
      res.status(400).json({ error: "intent is required" });
      return;
    }

    const inferredChannels: Channel[] = body.channels?.length
      ? body.channels.filter((channel): channel is Channel => isChannel(channel))
      : classifyChannels(body.intent);
    const channels: Channel[] = inferredChannels.length > 0 ? inferredChannels : ["web"];
    const save = body.save !== false;

    const generated = await generateSuitesFromIntent(body.intent, channels, save);
    const suites = await discoverSuites();
    const plan = buildPlan(body.intent, suites);

    res.json({ generated, plan });
  } catch (error) {
    res.status(500).json({ error: toErrorMessage(error) });
  }
});

app.listen(PORT, () => {
  console.log(`Control Center API listening on http://localhost:${PORT}`);
  console.log(`Workspace root: ${ROOT_DIR}`);
});

function startRunProcess(record: RunRecord, args: string[]): void {
  const child = spawn("pnpm", args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  record.status = "running";
  record.startedAt = new Date().toISOString();
  appendLog(record, `[system] Starting: ${record.command}`);

  runProcesses.set(record.id, child);

  child.stdout?.on("data", (chunk) => {
    appendChunk(record, chunk.toString("utf-8"));
  });

  child.stderr?.on("data", (chunk) => {
    appendChunk(record, chunk.toString("utf-8"));
  });

  child.on("error", (error) => {
    appendLog(record, `[error] ${error.message}`);
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    runProcesses.delete(record.id);
  });

  child.on("close", (code) => {
    if (record.status !== "canceled") {
      record.status = code === 0 ? "passed" : "failed";
    }

    record.exitCode = code;
    record.finishedAt = new Date().toISOString();
    appendLog(record, `[system] Finished with exit code ${String(code)}`);
    runProcesses.delete(record.id);
  });
}

async function discoverSuites(): Promise<SuiteInfo[]> {
  const suites: SuiteInfo[] = [];

  for (const channel of Object.keys(CHANNEL_EXAMPLE_DIR) as Channel[]) {
    const dir = resolve(EXAMPLES_DIR, CHANNEL_EXAMPLE_DIR[channel]);
    if (!existsSync(dir)) {
      continue;
    }

    const entries = await readdir(dir);
    for (const name of entries) {
      const fullPath = resolve(dir, name);
      const info = await stat(fullPath);
      if (!info.isFile()) {
        continue;
      }

      if (![".yaml", ".yml", ".json"].includes(extname(name).toLowerCase())) {
        continue;
      }

      const relSpecPath = relative(ROOT_DIR, fullPath);
      suites.push({
        id: `${channel}:${relSpecPath}`,
        name: await readSuiteName(fullPath),
        channel,
        specPath: relSpecPath,
      });
    }
  }

  return suites.sort((a, b) => a.name.localeCompare(b.name));
}

async function readSuiteName(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  const fallback = basename(filePath, ext);

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = ext === ".json" ? JSON.parse(content) : YAML.parse(content);
    if (parsed && typeof parsed.suiteName === "string" && parsed.suiteName.trim()) {
      return parsed.suiteName;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function resolveSuiteFromBody(body: {
  suiteId?: string;
  channel?: Channel;
  specPath?: string;
}): Promise<SuiteInfo | null> {
  if (body.suiteId) {
    const suites = await discoverSuites();
    const match = suites.find((item) => item.id === body.suiteId);
    return match || null;
  }

  if (body.channel && body.specPath && isChannel(body.channel)) {
    if (!isSafeRelativePath(body.specPath)) {
      throw new Error("specPath must be a workspace-relative path");
    }

    const fullPath = resolve(ROOT_DIR, body.specPath);
    if (!existsSync(fullPath)) {
      throw new Error(`specPath not found: ${body.specPath}`);
    }

    return {
      id: `${body.channel}:${body.specPath}`,
      name: await readSuiteName(fullPath),
      channel: body.channel,
      specPath: body.specPath,
    };
  }

  return null;
}

async function loadFunctionsFromFile(): Promise<{ functions: unknown[]; source: string }> {
  await ensureFunctionsFile();
  const parsed = YAML.parse(await readFile(FUNCTIONS_FILE, "utf-8")) as { functions?: unknown[] } | unknown[];
  const functions = Array.isArray(parsed) ? parsed : parsed.functions || [];

  return {
    functions,
    source: relative(ROOT_DIR, FUNCTIONS_FILE),
  };
}

async function ensureFunctionsFile(): Promise<void> {
  if (existsSync(FUNCTIONS_FILE)) {
    return;
  }

  await mkdir(dirname(FUNCTIONS_FILE), { recursive: true });
  await writeFile(FUNCTIONS_FILE, YAML.stringify({ functions: [] }), "utf-8");
}

async function generateSuitesFromIntent(intent: string, channels: Channel[], save: boolean): Promise<GeneratedSuite[]> {
  const slug = sanitizeFilename(intent).slice(0, 48) || "generated";
  const stamp = timestampToken();
  const url = extractFirstUrl(intent);
  const generated: GeneratedSuite[] = [];

  if (save) {
    await mkdir(GENERATED_DIR, { recursive: true });
  }

  for (const channel of channels) {
    const suiteName = `${slug}-${channel}-${stamp}`;
    const fileName = `${suiteName}.yaml`;
    const specPath = relative(ROOT_DIR, resolve(GENERATED_DIR, fileName));
    const content = buildGeneratedSuiteTemplate(channel, suiteName, intent, url);

    if (save) {
      await writeFile(resolve(ROOT_DIR, specPath), content, "utf-8");
    }

    generated.push({
      channel,
      suiteName,
      specPath,
      content,
    });
  }

  return generated;
}

function buildGeneratedSuiteTemplate(channel: Channel, suiteName: string, intent: string, url?: string): string {
  if (channel === "web") {
    const baseUrl = url || "{{env.BASE_URL}}";
    return `suiteName: ${suiteName}
baseUrl: '${baseUrl}'
headless: true
functionsFile: examples/functions/reusable.yaml
tests:
  - name: generated-web-smoke
    steps:
      - type: goto
        url: /
      - type: waitFor
        selector: body
      - type: screenshot
        value: artifacts/${suiteName}.png
`;
  }

  if (channel === "api") {
    const endpoint = url || "{{env.API_BASE_URL}}/health";
    const wantsSoap = includesAny(intent.toLowerCase(), ["soap", "wsdl", "envelope"]);

    if (wantsSoap) {
      return `suiteName: ${suiteName}
requests:
  - kind: soap
    name: generated-soap-request
    url: '${endpoint}'
    soapAction: GeneratedAction
    body: |
      <soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\">
        <soapenv:Body>
          <GeneratedAction xmlns=\"urn:example\"/>
        </soapenv:Body>
      </soapenv:Envelope>
    assertions:
      status: 200
`;
    }

    return `suiteName: ${suiteName}
requests:
  - kind: rest
    name: generated-rest-request
    method: GET
    url: '${endpoint}'
    assertions:
      status: 200
`;
  }

  return `suiteName: ${suiteName}
appiumServerUrl: '{{env.APPIUM_URL}}'
capabilities:
  platformName: Android
  appium:automationName: UiAutomator2
  appium:deviceName: emulator-5554
steps:
  - type: wait
    timeoutMs: 1000
`;
}

function buildPlan(intent: string, suites: SuiteInfo[]): IntentPlan {
  const normalized = intent.toLowerCase();
  const actions: PlanAction[] = [];

  const webSuite = pickSuite(suites, "web");
  const apiSuite = pickSuite(suites, "api");
  const deviceSuite = pickSuite(suites, "device");

  if (includesAny(normalized, ["web", "ui", "browser", "playwright", "frontend"]) && webSuite) {
    actions.push({
      channel: "web",
      command: `pnpm --filter @uap/cli-web dev run ${webSuite.specPath}`,
      suggestedSpecPath: webSuite.specPath,
      reason: "Intent includes web/browser automation context.",
    });
  }

  if (includesAny(normalized, ["api", "rest", "soap", "service", "endpoint"]) && apiSuite) {
    actions.push({
      channel: "api",
      command: `pnpm --filter @uap/cli-api dev run ${apiSuite.specPath}`,
      suggestedSpecPath: apiSuite.specPath,
      reason: "Intent includes API/service automation context.",
    });
  }

  if (includesAny(normalized, ["mobile", "appium", "android", "ios", "desktop", "device"]) && deviceSuite) {
    actions.push({
      channel: "device",
      command: `pnpm --filter @uap/cli-appium dev run ${deviceSuite.specPath}`,
      suggestedSpecPath: deviceSuite.specPath,
      reason: "Intent includes mobile/desktop device automation context.",
    });
  }

  if (actions.length === 0) {
    if (webSuite) {
      actions.push({
        channel: "web",
        command: `pnpm --filter @uap/cli-web dev validate ${webSuite.specPath}`,
        suggestedSpecPath: webSuite.specPath,
        reason: "No channel keywords detected, starting with web validation.",
      });
    }

    if (apiSuite) {
      actions.push({
        channel: "api",
        command: `pnpm --filter @uap/cli-api dev validate ${apiSuite.specPath}`,
        suggestedSpecPath: apiSuite.specPath,
        reason: "No channel keywords detected, also validating API suite.",
      });
    }
  }

  return {
    intent,
    actions,
    nextStep: "Run selected actions and refine generated specs before committing.",
  };
}

function classifyChannels(intent: string): Channel[] {
  const normalized = intent.toLowerCase();
  const channels: Channel[] = [];

  if (includesAny(normalized, ["web", "ui", "browser", "playwright", "frontend"])) {
    channels.push("web");
  }

  if (includesAny(normalized, ["api", "rest", "soap", "service", "endpoint"])) {
    channels.push("api");
  }

  if (includesAny(normalized, ["mobile", "appium", "android", "ios", "desktop", "device"])) {
    channels.push("device");
  }

  return dedupe<Channel>(channels);
}

function pickSuite(suites: SuiteInfo[], channel: Channel): SuiteInfo | undefined {
  return suites.find((suite) => suite.channel === channel);
}

function appendChunk(record: RunRecord, text: string): void {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    appendLog(record, line);
  }
}

function appendLog(record: RunRecord, line: string): void {
  record.logs.push(line);
  if (record.logs.length > 2000) {
    record.logs.splice(0, record.logs.length - 2000);
  }
}

function buildSuiteTemplate(channel: Channel, suiteName: string): string {
  if (channel === "web") {
    return `suiteName: ${suiteName}
baseUrl: https://example.com
tests:
  - name: open-home
    steps:
      - type: goto
        url: /
      - type: assertVisible
        selector: h1
`;
  }

  if (channel === "api") {
    return `suiteName: ${suiteName}
requests:
  - name: health
    kind: rest
    method: GET
    url: https://httpbin.org/status/200
    assertions:
      status: 200
`;
  }

  return `suiteName: ${suiteName}
appiumServerUrl: http://127.0.0.1:4723
capabilities:
  platformName: Android
  appium:automationName: UiAutomator2
  appium:deviceName: emulator-5554
steps:
  - type: wait
    timeoutMs: 1000
`;
}

function detectFormat(filePath: string): SpecFormat {
  return extname(filePath).toLowerCase() === ".json" ? "json" : "yaml";
}

function assertContentParses(content: string, format: SpecFormat): void {
  if (format === "json") {
    JSON.parse(content);
    return;
  }

  YAML.parse(content);
}

function extractSuiteName(content: string, format: SpecFormat): string | null {
  try {
    const parsed = format === "json" ? JSON.parse(content) : YAML.parse(content);
    if (parsed && typeof parsed.suiteName === "string" && parsed.suiteName.trim()) {
      return parsed.suiteName.trim();
    }

    return null;
  } catch {
    return null;
  }
}

function nextRunId(): string {
  const id = `run-${Date.now()}-${sequence}`;
  sequence += 1;
  return id;
}

function timestampToken(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function escapeArg(value: string): string {
  return value.includes(" ") ? `'${value.replace(/'/g, "'\\''")}'` : value;
}

function isChannel(value: string): value is Channel {
  return value === "web" || value === "api" || value === "device";
}

function toChannel(value: unknown): Channel | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return isChannel(value) ? value : undefined;
}

function sanitizeFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return slug || "suite";
}

function isSafeRelativePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || filePath.includes("..")) {
    return false;
  }

  const resolvedPath = resolve(ROOT_DIR, filePath);
  return resolvedPath.startsWith(ROOT_DIR);
}

function toAbsolutePath(filePath: string): string {
  if (filePath.startsWith("/")) {
    return filePath;
  }

  return resolve(ROOT_DIR, filePath);
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function extractFirstUrl(input: string): string | undefined {
  const match = input.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : undefined;
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
