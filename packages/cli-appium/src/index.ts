#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import type { DeviceSpec, DeviceStep, ExecutionReport, ReusableFunction, StepResult } from "@uap/contracts";
import {
  expandFunctionCall,
  interpolateObject,
  loadEnvMap,
  loadFunctions,
  loadSpecFile,
  nowIso,
  resolveInputPath,
  writeJsonReport,
} from "@uap/cli-shared";

const W3C_ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

const program = new Command();

program
  .name("uap-device")
  .description("Unified Automation Platform - Appium CLI")
  .version("0.2.0");

program
  .command("validate")
  .description("Validate an Appium device spec")
  .argument("<spec>", "Path to .yaml/.yml/.json device spec")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (specPath, options) => {
    const resolvedSpecPath = await resolveInputPath(specPath);
    const spec = await loadSpecFile<DeviceSpec>(resolvedSpecPath);
    const env = await loadEnvMap(options.env);
    const functions = await loadFunctions(spec, {
      overrideFile: options.functions,
      specFilePath: resolvedSpecPath,
    });
    const errors = validateSpec(spec, functions, env);

    if (errors.length > 0) {
      console.error("Validation failed:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Spec is valid: ${spec.suiteName}`);
  });

program
  .command("run")
  .description("Run Appium-based mobile/desktop automation spec")
  .argument("<spec>", "Path to .yaml/.yml/.json device spec")
  .option("--report <file>", "Write JSON report", "reports/device-report.json")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (specPath, options) => {
    const resolvedSpecPath = await resolveInputPath(specPath);
    const spec = await loadSpecFile<DeviceSpec>(resolvedSpecPath);
    const env = await loadEnvMap(options.env);
    const functions = await loadFunctions(spec, {
      overrideFile: options.functions,
      specFilePath: resolvedSpecPath,
    });
    const errors = validateSpec(spec, functions, env);

    if (errors.length > 0) {
      console.error("Validation failed:");
      for (const error of errors) {
        console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }

    const report = await runSpec(spec, functions, env);
    await writeJsonReport(options.report, report);

    const { passed, failed, total } = report.summary;
    console.log(`Device run complete: ${passed}/${total} passed, ${failed} failed`);
    console.log(`Report written to ${options.report}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Print a starter Appium spec template")
  .action(() => {
    console.log(`suiteName: sample-device-suite
appiumServerUrl: '{{env.APPIUM_URL}}'
variables:
  username: qa-user
capabilities:
  platformName: Android
  appium:automationName: UiAutomator2
  appium:deviceName: emulator-5554
steps:
  - type: wait
    timeoutMs: 2000
  - type: tap
    selector:
      using: accessibility id
      value: Login
  - type: type
    selector:
      using: id
      value: com.example:id/username
    text: '{{var.username}}'
`);
  });

void program.parseAsync(process.argv);

function validateSpec(spec: DeviceSpec, functions: ReusableFunction[], env: Record<string, string>): string[] {
  const errors: string[] = [];

  if (!spec || typeof spec !== "object") {
    errors.push("Spec must be an object");
    return errors;
  }

  if (!spec.suiteName) {
    errors.push("suiteName is required");
  }

  if (!spec.appiumServerUrl) {
    errors.push("appiumServerUrl is required");
  }

  if (!spec.capabilities || typeof spec.capabilities !== "object") {
    errors.push("capabilities must be an object");
  }

  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    errors.push("steps must contain at least one step");
    return errors;
  }

  for (const [index, step] of spec.steps.entries()) {
    errors.push(...validateStep(step, index));
  }

  try {
    const expanded = expandDeviceSteps(spec, spec.steps, functions, env);
    for (const [index, step] of expanded.entries()) {
      errors.push(...validateStep(step, index));
    }
  } catch (error) {
    errors.push(`step expansion failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return errors;
}

function validateStep(step: DeviceStep, stepIndex: number): string[] {
  const errors: string[] = [];

  if (!step.type) {
    errors.push(`steps[${stepIndex}].type is required`);
  }

  if (["tap", "type", "assertText"].includes(step.type) && !step.selector) {
    errors.push(`steps[${stepIndex}].selector is required for ${step.type}`);
  }

  if (step.type === "type" && step.text === undefined) {
    errors.push(`steps[${stepIndex}].text is required for type`);
  }

  if (step.type === "assertText" && step.text === undefined) {
    errors.push(`steps[${stepIndex}].text is required for assertText`);
  }

  if (step.type === "useFunction" && !step.functionName) {
    errors.push(`steps[${stepIndex}].functionName is required for useFunction`);
  }

  return errors;
}

function expandDeviceSteps(
  spec: DeviceSpec,
  sourceSteps: DeviceStep[],
  functions: ReusableFunction[],
  env: Record<string, string>,
  depth = 0,
): DeviceStep[] {
  if (depth > 8) {
    throw new Error("Nested useFunction depth exceeded 8 levels");
  }

  const expanded: DeviceStep[] = [];
  const variables = spec.variables;

  for (const rawStep of sourceSteps) {
    const step = interpolateObject(rawStep, { variables, env });

    if (step.type !== "useFunction") {
      expanded.push(step);
      continue;
    }

    const functionName = step.functionName;
    if (!functionName) {
      throw new Error("useFunction step requires functionName");
    }

    const functionSteps = expandFunctionCall<DeviceStep>({
      channel: "device",
      functions,
      functionName,
      functionArgs: step.functionArgs,
      variables,
      env,
    });

    expanded.push(...expandDeviceSteps(spec, functionSteps, functions, env, depth + 1));
  }

  return expanded;
}

async function runSpec(
  spec: DeviceSpec,
  functions: ReusableFunction[],
  env: Record<string, string>,
): Promise<ExecutionReport> {
  const startedAt = nowIso();
  const runStart = performance.now();
  const variables = spec.variables;
  const appiumServerUrl = interpolateObject(spec.appiumServerUrl, { variables, env });
  const capabilities = interpolateObject(spec.capabilities, { variables, env });
  const steps = expandDeviceSteps(spec, spec.steps, functions, env);
  const stepResults: StepResult[] = [];

  let sessionId: string | undefined;
  let finalStatus: "passed" | "failed" = "passed";
  let finalError: string | undefined;

  try {
    sessionId = await createSession(appiumServerUrl, capabilities);

    for (const [index, step] of steps.entries()) {
      const stepStart = performance.now();
      try {
        await executeStep(appiumServerUrl, sessionId, step);
        stepResults.push({
          index,
          type: step.type,
          status: "passed",
          durationMs: Math.round(performance.now() - stepStart),
        });
      } catch (error) {
        finalStatus = "failed";
        finalError = error instanceof Error ? error.message : String(error);
        stepResults.push({
          index,
          type: step.type,
          status: "failed",
          durationMs: Math.round(performance.now() - stepStart),
          error: finalError,
        });
        break;
      }
    }
  } catch (error) {
    finalStatus = "failed";
    finalError = error instanceof Error ? error.message : String(error);
  } finally {
    if (sessionId) {
      try {
        await deleteSession(appiumServerUrl, sessionId);
      } catch {
        // Ignore cleanup failure to preserve original test outcome.
      }
    }
  }

  const durationMs = Math.round(performance.now() - runStart);

  return {
    metadata: {
      suiteName: spec.suiteName,
      channel: "device",
      startedAt,
      finishedAt: nowIso(),
      durationMs,
    },
    summary: {
      total: 1,
      passed: finalStatus === "passed" ? 1 : 0,
      failed: finalStatus === "failed" ? 1 : 0,
    },
    tests: [
      {
        name: spec.suiteName,
        status: finalStatus,
        durationMs,
        stepResults,
        error: finalError,
      },
    ],
  };
}

async function executeStep(appiumServerUrl: string, sessionId: string, step: DeviceStep): Promise<void> {
  switch (step.type) {
    case "wait": {
      await delay(step.timeoutMs ?? 1000);
      return;
    }

    case "tap": {
      const elementId = await findElement(appiumServerUrl, sessionId, step.selector!.using, step.selector!.value);
      await appiumRequest(appiumServerUrl, `/session/${sessionId}/element/${elementId}/click`, "POST", {});
      return;
    }

    case "type": {
      const elementId = await findElement(appiumServerUrl, sessionId, step.selector!.using, step.selector!.value);
      const text = step.text ?? "";
      await appiumRequest(appiumServerUrl, `/session/${sessionId}/element/${elementId}/value`, "POST", {
        text,
        value: [...text],
      });
      return;
    }

    case "assertText": {
      const elementId = await findElement(appiumServerUrl, sessionId, step.selector!.using, step.selector!.value);
      const response = await appiumRequest<{ value: string }>(
        appiumServerUrl,
        `/session/${sessionId}/element/${elementId}/text`,
        "GET",
      );
      const actualText = response.value ?? "";
      const expectedText = step.text ?? "";
      if (!actualText.includes(expectedText)) {
        throw new Error(`Expected '${expectedText}' in '${actualText}'`);
      }
      return;
    }

    case "useFunction": {
      throw new Error("useFunction should be expanded before execution");
    }

    default: {
      const exhaustive: never = step.type;
      throw new Error(`Unsupported step type: ${String(exhaustive)}`);
    }
  }
}

async function createSession(appiumServerUrl: string, capabilities: Record<string, unknown>): Promise<string> {
  const payload = {
    capabilities: {
      alwaysMatch: capabilities,
      firstMatch: [{}],
    },
  };

  const response = await appiumRequest<{
    value?: { sessionId?: string };
    sessionId?: string;
  }>(appiumServerUrl, "/session", "POST", payload);

  const sessionId = response.value?.sessionId || response.sessionId;
  if (!sessionId) {
    throw new Error("Appium did not return a sessionId");
  }

  return sessionId;
}

async function deleteSession(appiumServerUrl: string, sessionId: string): Promise<void> {
  await appiumRequest(appiumServerUrl, `/session/${sessionId}`, "DELETE");
}

async function findElement(
  appiumServerUrl: string,
  sessionId: string,
  using: string,
  value: string,
): Promise<string> {
  const response = await appiumRequest<{
    value?: Record<string, string>;
  }>(appiumServerUrl, `/session/${sessionId}/element`, "POST", {
    using,
    value,
  });

  const raw = response.value || {};
  const elementId = raw[W3C_ELEMENT_KEY] || raw.ELEMENT;
  if (!elementId) {
    throw new Error(`Element not found for locator ${using}=${value}`);
  }

  return elementId;
}

async function appiumRequest<T = unknown>(
  appiumServerUrl: string,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const url = new URL(path, appiumServerUrl.endsWith("/") ? appiumServerUrl : `${appiumServerUrl}/`).toString();
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: T & { value?: { error?: string; message?: string } };
  if (!text) {
    payload = {} as T & { value?: { error?: string; message?: string } };
  } else {
    try {
      payload = JSON.parse(text) as T & { value?: { error?: string; message?: string } };
    } catch {
      payload = { value: { message: text } } as T & { value?: { error?: string; message?: string } };
    }
  }

  if (!response.ok) {
    const details = payload.value?.message || payload.value?.error || text;
    throw new Error(`Appium request failed (${response.status}): ${details}`);
  }

  return payload;
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
