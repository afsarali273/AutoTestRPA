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

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [suites, setSuites] = useState<SuiteInfo[]>([]);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [functions, setFunctions] = useState<FunctionItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [selectedRunLogs, setSelectedRunLogs] = useState<string[]>([]);
  const [mcpIntent, setMcpIntent] = useState("Validate login in browser, verify auth API, then check Android app login");
  const [mcpPlan, setMcpPlan] = useState<IntentPlan | null>(null);
  const [createSuiteName, setCreateSuiteName] = useState("");
  const [createSuiteChannel, setCreateSuiteChannel] = useState<Channel>("web");
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
            createSuiteName,
            createSuiteChannel,
            onCreateSuiteName: setCreateSuiteName,
            onCreateSuiteChannel: setCreateSuiteChannel,
            onCreateSuite: createSuite,
            onRun: startRun,
          })}
        {view === "functions" && renderFunctions({ functions })}
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
            onIntentChange: setMcpIntent,
            onGeneratePlan: generatePlan,
            onRunAction: runPlanAction,
          })}
      </main>
    </div>
  );

  async function refreshAll(): Promise<void> {
    setErrorMessage("");
    try {
      await Promise.all([loadSuites(), loadRuns(), loadFunctions()]);
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

    setFunctions(data.functions || []);
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

  async function runPlanAction(action: PlanAction): Promise<void> {
    setErrorMessage("");

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: action.channel,
          specPath: action.suggestedSpecPath,
        }),
      });

      const data = (await response.json()) as { run?: RunInfo; error?: string };
      if (!response.ok || !data.run) {
        throw new Error(data.error || "Failed to run MCP action");
      }

      setSelectedRunId(data.run.id);
      await Promise.all([loadRuns(), loadRunLogs(data.run.id)]);
      setView("runs");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    }
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
  createSuiteName: string;
  createSuiteChannel: Channel;
  onCreateSuiteName: (value: string) => void;
  onCreateSuiteChannel: (value: Channel) => void;
  onCreateSuite: () => Promise<void>;
  onRun: (suiteId: string) => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>Suite Inventory</h2>
      <p className="caption">Create YAML starter suites and launch CLI runs directly from the UI.</p>

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
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {input.suites.map((suite) => (
              <tr key={suite.id}>
                <td>{suite.name}</td>
                <td>{suite.channel}</td>
                <td>{suite.specPath}</td>
                <td>
                  <button onClick={() => void input.onRun(suite.id)}>Run</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderFunctions(input: { functions: FunctionItem[] }) {
  return (
    <section className="single-view">
      <h2>Reusable Functions</h2>
      <p className="caption">Shared building blocks loaded from `examples/functions/reusable.yaml`.</p>

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
  onIntentChange: (value: string) => void;
  onGeneratePlan: () => Promise<void>;
  onRunAction: (action: PlanAction) => Promise<void>;
}) {
  return (
    <section className="single-view">
      <h2>MCP Planner</h2>
      <p className="caption">Intent to execution-plan mapping using your existing CLI channels.</p>

      <div className="card form-card">
        <label>
          Intent
          <textarea value={input.intent} onChange={(event) => input.onIntentChange(event.target.value)} rows={4} />
        </label>
        <button onClick={() => void input.onGeneratePlan()}>Generate Plan</button>
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
    </section>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
