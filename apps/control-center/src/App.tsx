import { useEffect, useMemo, useState } from "react";

type View = "dashboard" | "suites" | "functions" | "runs" | "mcp";
type Channel = "web" | "api" | "device";

type SuiteInfo = {
  id: string;
  name: string;
  channel: Channel;
  specPath: string;
};

type RunInfo = {
  id: string;
  channel: Channel;
  suiteName: string;
  specPath: string;
  command: string;
  status: "queued" | "running" | "passed" | "failed" | "canceled";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  reportPath?: string;
  logs: string[];
};

type FunctionItem = {
  name: string;
  version: string;
  channel: string;
  description?: string;
};

type PlanAction = {
  channel: Channel;
  command: string;
  suggestedSpecPath: string;
  reason: string;
};

type IntentPlan = {
  intent: string;
  actions: PlanAction[];
  nextStep: string;
};

type GeneratedSuite = {
  channel: Channel;
  suiteName: string;
  specPath: string;
  content: string;
};

type SuiteEditor = {
  suiteId: string;
  suiteName: string;
  channel: Channel;
  specPath: string;
  format: "yaml" | "json";
  content: string;
};

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [suites, setSuites] = useState<SuiteInfo[]>([]);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [functions, setFunctions] = useState<FunctionItem[]>([]);

  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedRunLogs, setSelectedRunLogs] = useState<string[]>([]);

  const [mcpIntent, setMcpIntent] = useState("Validate login in browser, verify auth API, then check Android app login");
  const [mcpPlan, setMcpPlan] = useState<IntentPlan | null>(null);
  const [generatedSuites, setGeneratedSuites] = useState<GeneratedSuite[]>([]);

  const [createSuiteName, setCreateSuiteName] = useState("");
  const [createSuiteChannel, setCreateSuiteChannel] = useState<Channel>("web");

  const [suiteEditor, setSuiteEditor] = useState<SuiteEditor | null>(null);
  const [functionFileContent, setFunctionFileContent] = useState("");
  const [functionSourcePath, setFunctionSourcePath] = useState("");

  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      void loadRuns();
    }, 2500);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }

    const id = setInterval(() => {
      void loadRunLogs(selectedRunId);
    }, 1000);

    return () => clearInterval(id);
  }, [selectedRunId]);

  const passRate = useMemo(() => {
    const finished = runs.filter((run) => ["passed", "failed", "canceled"].includes(run.status));
    if (finished.length === 0) {
      return 0;
    }

    const passed = finished.filter((run) => run.status === "passed").length;
    return Math.round((passed / finished.length) * 100);
  }, [runs]);

  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;

  return (
    <div className="app-shell">
      <div className="ambient-glow ambient-one" />
      <div className="ambient-glow ambient-two" />

      <aside className="side-rail">
        <p className="product-kicker">Unified Automation Platform</p>
        <h1>Control Center</h1>
        <p className="caption">CLI-first automation across web, API, and device channels.</p>

        <nav>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
          <button className={view === "suites" ? "active" : ""} onClick={() => setView("suites")}>Suites</button>
          <button className={view === "functions" ? "active" : ""} onClick={() => setView("functions")}>Functions</button>
          <button className={view === "runs" ? "active" : ""} onClick={() => setView("runs")}>Runs</button>
          <button className={view === "mcp" ? "active" : ""} onClick={() => setView("mcp")}>MCP Planner</button>
        </nav>

        <button className="ghost-button" onClick={() => void refreshAll()}>
          Refresh Data
        </button>

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </aside>

      <main className="main-panel">
        {view === "dashboard" && renderDashboard({ suites, runs, passRate, onRun: startRun })}

        {view === "suites" &&
          renderSuites({
            suites,
            suiteEditor,
            createSuiteName,
            createSuiteChannel,
            onCreateSuiteName: setCreateSuiteName,
            onCreateSuiteChannel: setCreateSuiteChannel,
            onCreateSuite: createSuite,
            onLoadSuite: loadSuiteForEdit,
            onSuiteContentChange: updateSuiteEditorContent,
            onSaveSuite: saveSuiteEditor,
            onRun: startRun,
          })}

        {view === "functions" &&
          renderFunctions({
            functions,
            sourcePath: functionSourcePath,
            content: functionFileContent,
            onContentChange: setFunctionFileContent,
            onSave: saveFunctionsContent,
          })}

        {view === "runs" &&
          renderRuns({
            runs,
            selectedRun,
            selectedRunLogs,
            selectedRunId,
            onSelectRun: setSelectedRunId,
            onCancelRun: cancelRun,
            onLoadReport: loadReport,
          })}

        {view === "mcp" &&
          renderMcp({
            intent: mcpIntent,
            plan: mcpPlan,
            generatedSuites,
            onIntentChange: setMcpIntent,
            onGeneratePlan: generatePlan,
            onGenerateSuites: generateSuitesFromIntent,
            onRunAction: runPlanAction,
            onRunGenerated: runGeneratedSuite,
          })}
      </main>
    </div>
  );

  async function refreshAll(): Promise<void> {
    setErrorMessage("");
    try {
      await Promise.all([loadSuites(), loadRuns(), loadFunctions(), loadFunctionsContent()]);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function loadSuites(): Promise<void> {
    const response = await fetch("/api/suites");
    const data = (await response.json()) as { suites?: SuiteInfo[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch suites");
    }

    setSuites(data.suites || []);
  }

  async function loadRuns(): Promise<void> {
    const response = await fetch("/api/runs");
    const data = (await response.json()) as { runs?: RunInfo[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch runs");
    }

    setRuns(data.runs || []);

    if (selectedRunId) {
      const selected = (data.runs || []).find((run) => run.id === selectedRunId);
      if (!selected) {
        setSelectedRunId("");
        setSelectedRunLogs([]);
      }
    }
  }

  async function loadRunLogs(runId: string): Promise<void> {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/logs`);
    const data = (await response.json()) as { logs?: string[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch run logs");
    }

    setSelectedRunLogs(data.logs || []);
  }

  async function loadFunctions(): Promise<void> {
    const response = await fetch("/api/functions");
    const data = (await response.json()) as { functions?: FunctionItem[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch reusable functions");
    }

    setFunctions((data.functions || []) as FunctionItem[]);
  }

  async function loadFunctionsContent(): Promise<void> {
    const response = await fetch("/api/functions/content");
    const data = (await response.json()) as { source?: string; content?: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch functions content");
    }

    setFunctionSourcePath(data.source || "examples/functions/reusable.yaml");
    setFunctionFileContent(data.content || "functions: []\n");
  }

  async function createSuite(): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: createSuiteChannel,
          suiteName: createSuiteName,
        }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to create suite");
      }

      setCreateSuiteName("");
      await loadSuites();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function loadSuiteForEdit(suiteId: string): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch(`/api/suite-content?suiteId=${encodeURIComponent(suiteId)}`);
      const data = (await response.json()) as {
        suite?: SuiteInfo;
        content?: string;
        format?: "yaml" | "json";
        error?: string;
      };

      if (!response.ok || !data.suite || typeof data.content !== "string" || !data.format) {
        throw new Error(data.error || "Failed to load suite content");
      }

      setSuiteEditor({
        suiteId: data.suite.id,
        suiteName: data.suite.name,
        channel: data.suite.channel,
        specPath: data.suite.specPath,
        format: data.format,
        content: data.content,
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  function updateSuiteEditorContent(content: string): void {
    setSuiteEditor((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        content,
      };
    });
  }

  async function saveSuiteEditor(): Promise<void> {
    if (!suiteEditor) {
      return;
    }

    setErrorMessage("");

    try {
      const response = await fetch("/api/suite-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId: suiteEditor.suiteId,
          content: suiteEditor.content,
        }),
      });

      const data = (await response.json()) as { suite?: SuiteInfo; error?: string };
      if (!response.ok || !data.suite) {
        throw new Error(data.error || "Failed to save suite content");
      }

      setSuiteEditor((current) => {
        if (!current) {
          return null;
        }

        return {
          ...current,
          suiteName: data.suite!.name,
        };
      });

      await loadSuites();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function saveFunctionsContent(): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/functions/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: functionFileContent }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to save functions content");
      }

      await loadFunctions();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function startRun(suiteId: string): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId }),
      });

      const data = (await response.json()) as { run?: RunInfo; error?: string };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Failed to start run");
      }

      setSelectedRunId(data.run.id);
      await Promise.all([loadRuns(), loadRunLogs(data.run.id)]);
      setView("runs");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function startRunBySpec(channel: Channel, specPath: string): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, specPath }),
      });

      const data = (await response.json()) as { run?: RunInfo; error?: string };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Failed to start run");
      }

      setSelectedRunId(data.run.id);
      await Promise.all([loadRuns(), loadRunLogs(data.run.id)]);
      setView("runs");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function cancelRun(runId: string): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel run");
      }

      await Promise.all([loadRuns(), loadRunLogs(runId)]);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function loadReport(runId: string): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/report`);
      const data = (await response.json()) as { report?: unknown; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Failed to load report");
      }

      const text = JSON.stringify(data.report, null, 2);
      setSelectedRunLogs(text.split("\n"));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function generatePlan(): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/mcp/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: mcpIntent }),
      });

      const data = (await response.json()) as { plan?: IntentPlan; error?: string };
      if (!response.ok || !data.plan) {
        throw new Error(data.error || "Failed to generate MCP plan");
      }

      setMcpPlan(data.plan);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function generateSuitesFromIntent(): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/mcp/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: mcpIntent, save: true }),
      });

      const data = (await response.json()) as {
        generated?: GeneratedSuite[];
        plan?: IntentPlan;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate suites from intent");
      }

      setGeneratedSuites(data.generated || []);
      if (data.plan) {
        setMcpPlan(data.plan);
      }

      await loadSuites();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
  }

  async function runGeneratedSuite(item: GeneratedSuite): Promise<void> {
    await startRunBySpec(item.channel, item.specPath);
  }

  async function runPlanAction(action: PlanAction): Promise<void> {
    await startRunBySpec(action.channel, action.suggestedSpecPath);
  }
}

function renderDashboard(input: {
  suites: SuiteInfo[];
  runs: RunInfo[];
  passRate: number;
  onRun: (suiteId: string) => Promise<void>;
}) {
  const recentRuns = input.runs.slice(0, 8);
  const running = input.runs.filter((run) => run.status === "running" || run.status === "queued").length;

  return (
    <section className="view-grid">
      <div className="card metric-card">
        <p>Total Suites</p>
        <h2>{input.suites.length}</h2>
      </div>
      <div className="card metric-card">
        <p>Pass Rate</p>
        <h2>{input.passRate}%</h2>
      </div>
      <div className="card metric-card">
        <p>Active Runs</p>
        <h2>{running}</h2>
      </div>

      <div className="card wide">
        <h3>Recent Runs</h3>
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Suite</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {recentRuns.map((run) => (
              <tr key={run.id}>
                <td>{run.id}</td>
                <td>{run.suiteName}</td>
                <td>{run.channel}</td>
                <td className={run.status === "passed" ? "status-pass" : run.status === "failed" ? "status-fail" : "status-live"}>
                  {run.status}
                </td>
                <td>{run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card wide">
        <h3>Quick Run</h3>
        <div className="quick-actions">
          {input.suites.map((suite) => (
            <button key={suite.id} onClick={() => void input.onRun(suite.id)}>
              Run {suite.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function renderSuites(input: {
  suites: SuiteInfo[];
  suiteEditor: SuiteEditor | null;
  createSuiteName: string;
  createSuiteChannel: Channel;
  onCreateSuiteName: (value: string) => void;
  onCreateSuiteChannel: (value: Channel) => void;
  onCreateSuite: () => Promise<void>;
  onLoadSuite: (suiteId: string) => Promise<void>;
  onSuiteContentChange: (content: string) => void;
  onSaveSuite: () => Promise<void>;
  onRun: (suiteId: string) => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>Suite Inventory</h2>
      <p className="caption">Create suites, edit full YAML/JSON DSL, and run from one screen.</p>

      <div className="card form-card">
        <label>
          Suite Name
          <input
            value={input.createSuiteName}
            onChange={(event) => input.onCreateSuiteName(event.target.value)}
            placeholder="payment-regression"
          />
        </label>
        <label>
          Channel
          <select
            value={input.createSuiteChannel}
            onChange={(event) => input.onCreateSuiteChannel(event.target.value as Channel)}
          >
            <option value="web">Web</option>
            <option value="api">API</option>
            <option value="device">Device</option>
          </select>
        </label>
        <button onClick={() => void input.onCreateSuite()}>Create Suite</button>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>Spec Path</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {input.suites.map((suite) => (
              <tr key={suite.id}>
                <td>{suite.name}</td>
                <td>{suite.channel}</td>
                <td>{suite.specPath}</td>
                <td>
                  <div className="table-actions">
                    <button onClick={() => void input.onLoadSuite(suite.id)}>Edit</button>
                    <button onClick={() => void input.onRun(suite.id)}>Run</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {input.suiteEditor ? (
        <div className="card form-card">
          <h3>Suite Editor: {input.suiteEditor.suiteName}</h3>
          <p className="token">{input.suiteEditor.specPath}</p>
          <textarea
            className="large-text"
            value={input.suiteEditor.content}
            onChange={(event) => input.onSuiteContentChange(event.target.value)}
            rows={18}
          />
          <button onClick={() => void input.onSaveSuite()}>Save Suite</button>
        </div>
      ) : null}
    </section>
  );
}

function renderFunctions(input: {
  functions: FunctionItem[];
  sourcePath: string;
  content: string;
  onContentChange: (value: string) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>Reusable Functions</h2>
      <p className="caption">Manage function registry and update YAML directly.</p>

      <div className="function-grid">
        {input.functions.map((fn) => (
          <article className="card function-card" key={`${fn.channel}-${fn.name}-${fn.version}`}>
            <p className="token">{fn.channel.toUpperCase()}</p>
            <h3>{fn.name}</h3>
            <p>{fn.version}</p>
            <p className="caption">{fn.description || "No description"}</p>
          </article>
        ))}
      </div>

      <div className="card form-card">
        <h3>Function File Editor</h3>
        <p className="token">{input.sourcePath}</p>
        <textarea
          className="large-text"
          value={input.content}
          onChange={(event) => input.onContentChange(event.target.value)}
          rows={16}
        />
        <button onClick={() => void input.onSave()}>Save Function File</button>
      </div>
    </section>
  );
}

function renderRuns(input: {
  runs: RunInfo[];
  selectedRun: RunInfo | null;
  selectedRunLogs: string[];
  selectedRunId: string;
  onSelectRun: (id: string) => void;
  onCancelRun: (id: string) => Promise<void>;
  onLoadReport: (id: string) => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>Run Console</h2>
      <p className="caption">Execution tracking for all CLI channels with report retrieval.</p>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Suite</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {input.runs.map((run) => (
              <tr
                key={run.id}
                className={run.id === input.selectedRunId ? "row-selected" : ""}
                onClick={() => input.onSelectRun(run.id)}
              >
                <td>{run.id}</td>
                <td>{run.suiteName}</td>
                <td>{run.channel}</td>
                <td className={run.status === "passed" ? "status-pass" : run.status === "failed" ? "status-fail" : "status-live"}>
                  {run.status}
                </td>
                <td>
                  {run.status === "running" || run.status === "queued" ? (
                    <button onClick={() => void input.onCancelRun(run.id)}>Cancel</button>
                  ) : (
                    <button onClick={() => void input.onLoadReport(run.id)}>Load Report</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {input.selectedRun ? (
        <div className="card terminal">
          <p className="token">{input.selectedRun.command}</p>
          <pre>{input.selectedRunLogs.join("\n") || "No logs yet..."}</pre>
        </div>
      ) : null}
    </section>
  );
}

function renderMcp(input: {
  intent: string;
  plan: IntentPlan | null;
  generatedSuites: GeneratedSuite[];
  onIntentChange: (value: string) => void;
  onGeneratePlan: () => Promise<void>;
  onGenerateSuites: () => Promise<void>;
  onRunAction: (action: PlanAction) => Promise<void>;
  onRunGenerated: (suite: GeneratedSuite) => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>MCP Planner</h2>
      <p className="caption">Intent to action plan plus generated runnable suite drafts.</p>

      <div className="card form-card">
        <label>
          Intent
          <textarea value={input.intent} onChange={(event) => input.onIntentChange(event.target.value)} rows={4} />
        </label>
        <div className="table-actions">
          <button onClick={() => void input.onGeneratePlan()}>Generate Plan</button>
          <button onClick={() => void input.onGenerateSuites()}>Generate Draft Suites</button>
        </div>
      </div>

      {input.plan ? (
        <div className="card">
          <p className="token">Detected Actions</p>
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Command</th>
                <th>Reason</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {input.plan.actions.map((action, index) => (
                <tr key={`${action.channel}-${index}`}>
                  <td>{action.channel}</td>
                  <td>{action.command}</td>
                  <td>{action.reason}</td>
                  <td>
                    <button onClick={() => void input.onRunAction(action)}>Run</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="caption">{input.plan.nextStep}</p>
        </div>
      ) : null}

      {input.generatedSuites.length > 0 ? (
        <div className="card">
          <p className="token">Generated Suites</p>
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Suite Name</th>
                <th>Spec Path</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {input.generatedSuites.map((suite) => (
                <tr key={`${suite.channel}-${suite.specPath}`}>
                  <td>{suite.channel}</td>
                  <td>{suite.suiteName}</td>
                  <td>{suite.specPath}</td>
                  <td>
                    <button onClick={() => void input.onRunGenerated(suite)}>Run</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
