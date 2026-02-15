export type Channel = "web" | "api" | "device";

export interface RunMetadata {
  suiteName: string;
  channel: Channel;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface StepResult {
  index: number;
  type: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error?: string;
}

export interface TestResult {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  stepResults: StepResult[];
  error?: string;
}

export interface ExecutionReport {
  metadata: RunMetadata;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  tests: TestResult[];
}

export interface ReusableFunction {
  name: string;
  version: string;
  channel: Channel | "cross-channel";
  description?: string;
  params?: Array<{
    name: string;
    required?: boolean;
      defaultValue?: string | number | boolean;
  }>;
  steps: unknown[];
}

export interface FunctionContainer {
  functions?: ReusableFunction[];
  functionsFile?: string;
}

export interface BaseTestCase {
  name: string;
  tags?: string[];
  retries?: number;
}

export interface WebStep {
  type:
    | "goto"
    | "click"
    | "fill"
    | "press"
    | "waitFor"
    | "assertText"
    | "assertVisible"
    | "screenshot"
    | "useFunction";
  selector?: string;
  value?: string;
  url?: string;
  key?: string;
  timeoutMs?: number;
  functionName?: string;
  functionArgs?: Record<string, string | number | boolean>;
}

export interface WebTestCase extends BaseTestCase {
  steps: WebStep[];
}

export interface WebSpec extends FunctionContainer {
  suiteName: string;
  baseUrl?: string;
  headless?: boolean;
  variables?: Record<string, string | number | boolean>;
  tests: WebTestCase[];
}

export interface ApiHttpRequest {
  kind: "rest" | "soap";
  name: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  soapAction?: string;
  assertions?: {
    status?: number;
    bodyContains?: string;
    headerEquals?: Record<string, string>;
  };
}

export interface ApiFunctionCall {
  kind: "useFunction";
  name?: string;
  functionName: string;
  functionArgs?: Record<string, string | number | boolean>;
}

export type ApiRequest = ApiHttpRequest | ApiFunctionCall;

export interface ApiSuite extends FunctionContainer {
  suiteName: string;
  variables?: Record<string, string | number | boolean>;
  requests: ApiRequest[];
}

export interface DeviceStep {
  type: "tap" | "type" | "wait" | "assertText" | "useFunction";
  selector?: {
    using: string;
    value: string;
  };
  text?: string;
  timeoutMs?: number;
  functionName?: string;
  functionArgs?: Record<string, string | number | boolean>;
}

export interface DeviceSpec extends FunctionContainer {
  suiteName: string;
  appiumServerUrl: string;
  variables?: Record<string, string | number | boolean>;
  capabilities: Record<string, unknown>;
  steps: DeviceStep[];
}
