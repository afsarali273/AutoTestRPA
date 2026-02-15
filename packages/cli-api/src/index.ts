#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import type {
  ApiFunctionCall,
  ApiHttpRequest,
  ApiRequest,
  ApiSuite,
  ExecutionReport,
  ReusableFunction,
  StepResult,
} from "@uap/contracts";
import {
  expandFunctionCall,
  interpolateObject,
  loadEnvMap,
  loadFunctions,
  loadSpecFile,
  nowIso,
  resolveInputPath,
  withQuery,
  writeJsonReport,
} from "@uap/cli-shared";

const program = new Command();

program
  .name("uap-api")
  .description("Unified Automation Platform - API CLI (REST + SOAP)")
  .version("0.2.0");

program
  .command("validate")
  .description("Validate an API suite")
  .argument("<suite>", "Path to .yaml/.yml/.json API suite")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (suitePath, options) => {
    const resolvedSuitePath = await resolveInputPath(suitePath);
    const suite = await loadSpecFile<ApiSuite>(resolvedSuitePath);
    const env = await loadEnvMap(options.env);
    const functions = await loadFunctions(suite, {
      overrideFile: options.functions,
      specFilePath: resolvedSuitePath,
    });
    const errors = validateSuite(suite, functions, env);

    if (errors.length > 0) {
      console.error("Validation failed:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Suite is valid: ${suite.suiteName}`);
  });

program
  .command("run")
  .description("Run API suite with REST and SOAP requests")
  .argument("<suite>", "Path to .yaml/.yml/.json API suite")
  .option("--report <file>", "Write JSON report", "reports/api-report.json")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (suitePath, options) => {
    const resolvedSuitePath = await resolveInputPath(suitePath);
    const suite = await loadSpecFile<ApiSuite>(resolvedSuitePath);
    const env = await loadEnvMap(options.env);
    const functions = await loadFunctions(suite, {
      overrideFile: options.functions,
      specFilePath: resolvedSuitePath,
    });
    const errors = validateSuite(suite, functions, env);

    if (errors.length > 0) {
      console.error("Validation failed:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    const report = await runSuite(suite, functions, env);
    await writeJsonReport(options.report, report);

    const { passed, failed, total } = report.summary;
    console.log(`API run complete: ${passed}/${total} passed, ${failed} failed`);
    console.log(`Report written to ${options.report}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Print a starter API suite template")
  .action(() => {
    console.log(`suiteName: sample-api-suite
variables:
  baseUrl: https://example.com
requests:
  - name: get-health
    kind: rest
    method: GET
    url: '{{var.baseUrl}}/health'
    assertions:
      status: 200
      bodyContains: ok
`);
  });

void program.parseAsync(process.argv);

function validateSuite(suite: ApiSuite, functions: ReusableFunction[], env: Record<string, string>): string[] {
  const errors: string[] = [];

  if (!suite || typeof suite !== "object") {
    errors.push("Suite must be an object");
    return errors;
  }

  if (!suite.suiteName) {
    errors.push("suiteName is required");
  }

  if (!Array.isArray(suite.requests) || suite.requests.length === 0) {
    errors.push("requests must contain at least one request");
    return errors;
  }

  for (const [index, request] of suite.requests.entries()) {
    errors.push(...validateRequestShape(request, index));
  }

  try {
    const expanded = expandApiRequests(suite, suite.requests, functions, env);
    for (const [index, request] of expanded.entries()) {
      errors.push(...validateHttpRequest(request, index));
    }
  } catch (error) {
    errors.push(`request expansion failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return errors;
}

function validateRequestShape(request: ApiRequest, index: number): string[] {
  const errors: string[] = [];

  if (!request.kind || !["rest", "soap", "useFunction"].includes(request.kind)) {
    errors.push(`requests[${index}].kind must be rest, soap, or useFunction`);
    return errors;
  }

  if (request.kind === "useFunction") {
    if (!request.functionName) {
      errors.push(`requests[${index}].functionName is required for useFunction`);
    }
    return errors;
  }

  errors.push(...validateHttpRequest(request, index));
  return errors;
}

function validateHttpRequest(request: ApiHttpRequest, index: number): string[] {
  const errors: string[] = [];

  if (!request.name) {
    errors.push(`requests[${index}].name is required`);
  }

  if (!request.url) {
    errors.push(`requests[${index}].url is required`);
  }

  if (request.kind === "rest" && !request.method) {
    errors.push(`requests[${index}].method is required for REST requests`);
  }

  if (request.kind === "soap" && request.method && request.method !== "POST") {
    errors.push(`requests[${index}].method for SOAP must be POST when provided`);
  }

  return errors;
}

function expandApiRequests(
  suite: ApiSuite,
  sourceRequests: ApiRequest[],
  functions: ReusableFunction[],
  env: Record<string, string>,
  depth = 0,
): ApiHttpRequest[] {
  if (depth > 8) {
    throw new Error("Nested useFunction depth exceeded 8 levels");
  }

  const expanded: ApiHttpRequest[] = [];
  const variables = suite.variables;

  for (const rawRequest of sourceRequests) {
    const request = interpolateObject(rawRequest, { variables, env });

    if (request.kind !== "useFunction") {
      expanded.push(request);
      continue;
    }

    const functionCall = request as ApiFunctionCall;
    const functionRequests = expandFunctionCall<ApiRequest>({
      channel: "api",
      functions,
      functionName: functionCall.functionName,
      functionArgs: functionCall.functionArgs,
      variables,
      env,
    });

    expanded.push(...expandApiRequests(suite, functionRequests, functions, env, depth + 1));
  }

  return expanded;
}

async function runSuite(
  suite: ApiSuite,
  functions: ReusableFunction[],
  env: Record<string, string>,
): Promise<ExecutionReport> {
  const startedAt = nowIso();
  const runStart = performance.now();
  const tests: ExecutionReport["tests"] = [];

  const requests = expandApiRequests(suite, suite.requests, functions, env);
  for (const request of requests) {
    tests.push(await runRequest(request));
  }

  const passed = tests.filter((test) => test.status === "passed").length;
  const failed = tests.length - passed;

  return {
    metadata: {
      suiteName: suite.suiteName,
      channel: "api",
      startedAt,
      finishedAt: nowIso(),
      durationMs: Math.round(performance.now() - runStart),
    },
    summary: {
      total: tests.length,
      passed,
      failed,
    },
    tests,
  };
}

async function runRequest(request: ApiHttpRequest): Promise<ExecutionReport["tests"][number]> {
  const started = performance.now();
  const stepResults: StepResult[] = [];

  try {
    const response = await executeRequest(request);
    const assertionErrors = evaluateAssertions(request, response.status, response.headers, response.bodyText);

    if (assertionErrors.length > 0) {
      stepResults.push({
        index: 0,
        type: `${request.kind}-assertions`,
        status: "failed",
        durationMs: Math.round(performance.now() - started),
        error: assertionErrors.join("; "),
      });

      return {
        name: request.name,
        status: "failed",
        durationMs: Math.round(performance.now() - started),
        stepResults,
        error: assertionErrors.join("; "),
      };
    }

    stepResults.push({
      index: 0,
      type: `${request.kind}-assertions`,
      status: "passed",
      durationMs: Math.round(performance.now() - started),
    });

    return {
      name: request.name,
      status: "passed",
      durationMs: Math.round(performance.now() - started),
      stepResults,
    };
  } catch (error) {
    stepResults.push({
      index: 0,
      type: `${request.kind}-request`,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      name: request.name,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      stepResults,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeRequest(request: ApiHttpRequest): Promise<{
  status: number;
  headers: Headers;
  bodyText: string;
}> {
  const method = resolveMethod(request);
  const url = withQuery(request.url, request.query);
  const headers = new Headers(request.headers || {});

  let body: string | undefined;
  if (request.body !== undefined) {
    if (typeof request.body === "string") {
      body = request.body;
    } else {
      body = JSON.stringify(request.body);
      if (!headers.has("Content-Type") && request.kind === "rest") {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  if (request.kind === "soap") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/xml; charset=utf-8");
    }
    if (request.soapAction) {
      headers.set("SOAPAction", request.soapAction);
    }
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  const bodyText = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    bodyText,
  };
}

function resolveMethod(request: ApiHttpRequest): string {
  if (request.kind === "soap") {
    return request.method || "POST";
  }

  if (!request.method) {
    throw new Error(`REST request '${request.name}' requires method`);
  }

  return request.method;
}

function evaluateAssertions(
  request: ApiHttpRequest,
  status: number,
  headers: Headers,
  bodyText: string,
): string[] {
  const errors: string[] = [];
  const assertions = request.assertions;

  if (!assertions) {
    return errors;
  }

  if (assertions.status !== undefined && status !== assertions.status) {
    errors.push(`Expected status ${assertions.status}, received ${status}`);
  }

  if (assertions.bodyContains && !bodyText.includes(assertions.bodyContains)) {
    errors.push(`Response body did not contain '${assertions.bodyContains}'`);
  }

  if (assertions.headerEquals) {
    for (const [key, expectedValue] of Object.entries(assertions.headerEquals)) {
      const actualValue = headers.get(key);
      if (actualValue !== expectedValue) {
        errors.push(`Expected header '${key}' = '${expectedValue}', received '${actualValue ?? "<missing>"}'`);
      }
    }
  }

  return errors;
}
