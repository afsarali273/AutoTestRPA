#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import type { ExecutionReport, ReusableFunction, StepResult, WebSpec, WebStep, WebTestCase } from "@uap/contracts";
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

const program = new Command();

program
  .name("uap-web")
  .description("Unified Automation Platform - Web CLI (Playwright)")
  .version("0.2.0");

program
  .command("validate")
  .description("Validate a web automation spec")
  .argument("<spec>", "Path to .yaml/.yml/.json web spec")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (specPath, options) => {
    const resolvedSpecPath = await resolveInputPath(specPath);
    const spec = await loadSpecFile<WebSpec>(resolvedSpecPath);
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
  .description("Run a web automation spec")
  .argument("<spec>", "Path to .yaml/.yml/.json web spec")
  .option("--report <file>", "Write JSON report", "reports/web-report.json")
  .option("--headless <value>", "Force headless true/false")
  .option("--env <file>", "Optional .env file for interpolation")
  .option("--functions <file>", "Optional reusable-function registry file")
  .action(async (specPath, options) => {
    const resolvedSpecPath = await resolveInputPath(specPath);
    const spec = await loadSpecFile<WebSpec>(resolvedSpecPath);
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

    const report = await runSpec(spec, functions, env, options.headless);
    await writeJsonReport(options.report, report);

    const { passed, failed, total } = report.summary;
    console.log(`Web run complete: ${passed}/${total} passed, ${failed} failed`);
    console.log(`Report written to ${options.report}`);

    if (failed > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("record")
  .description("Show Playwright codegen command for step recording")
  .argument("<url>", "Target URL")
  .action((url) => {
    console.log("Use Playwright codegen for recording:");
    console.log(`npx playwright codegen ${url}`);
    console.log("Then convert generated script into your UAP web DSL spec.");
  });

program
  .command("init")
  .description("Print a starter web spec template")
  .action(() => {
    console.log(`suiteName: web-login-smoke
baseUrl: https://example.com
variables:
  loginPath: /
tests:
  - name: open-home
    steps:
      - type: goto
        url: '{{var.loginPath}}'
      - type: assertVisible
        selector: h1
`);
  });

void program.parseAsync(process.argv);

function validateSpec(spec: WebSpec, functions: ReusableFunction[], env: Record<string, string>): string[] {
  const errors: string[] = [];

  if (!spec || typeof spec !== "object") {
    errors.push("Spec must be an object");
    return errors;
  }

  if (!spec.suiteName) {
    errors.push("suiteName is required");
  }

  if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
    errors.push("tests must contain at least one test case");
    return errors;
  }

  for (const [testIndex, test] of spec.tests.entries()) {
    if (!test.name) {
      errors.push(`tests[${testIndex}].name is required`);
    }

    if (!Array.isArray(test.steps) || test.steps.length === 0) {
      errors.push(`tests[${testIndex}].steps must contain at least one step`);
      continue;
    }

    for (const [stepIndex, step] of test.steps.entries()) {
      errors.push(...validateStep(step, testIndex, stepIndex));
    }

    try {
      const expanded = expandWebSteps(spec, test.steps, functions, env);
      for (const [expandedIndex, step] of expanded.entries()) {
        errors.push(...validateStep(step, testIndex, expandedIndex));
      }
    } catch (error) {
      errors.push(`tests[${testIndex}] expansion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return errors;
}

function validateStep(step: WebStep, testIndex: number, stepIndex: number): string[] {
  const errors: string[] = [];
  if (!step.type) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].type is required`);
    return errors;
  }

  const selectorTypes = ["click", "fill", "press", "assertText", "assertVisible"];
  if (selectorTypes.includes(step.type) && !step.selector) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].selector is required for ${step.type}`);
  }

  if (step.type === "goto" && !step.url) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].url is required for goto`);
  }

  if (step.type === "fill" && step.value === undefined) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].value is required for fill`);
  }

  if (step.type === "assertText" && step.value === undefined) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].value is required for assertText`);
  }

  if (step.type === "press" && !step.key) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].key is required for press`);
  }

  if (step.type === "useFunction" && !step.functionName) {
    errors.push(`tests[${testIndex}].steps[${stepIndex}].functionName is required for useFunction`);
  }

  return errors;
}

function expandWebSteps(
  spec: WebSpec,
  sourceSteps: WebStep[],
  functions: ReusableFunction[],
  env: Record<string, string>,
  depth = 0,
): WebStep[] {
  if (depth > 8) {
    throw new Error("Nested useFunction depth exceeded 8 levels");
  }

  const expanded: WebStep[] = [];
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

    const functionSteps = expandFunctionCall<WebStep>({
      channel: "web",
      functions,
      functionName,
      functionArgs: step.functionArgs,
      variables,
      env,
    });

    expanded.push(...expandWebSteps(spec, functionSteps, functions, env, depth + 1));
  }

  return expanded;
}

async function runSpec(
  spec: WebSpec,
  functions: ReusableFunction[],
  env: Record<string, string>,
  headlessOverride?: string,
): Promise<ExecutionReport> {
  const startedAt = nowIso();
  const suiteStart = performance.now();
  const tests = [] as ExecutionReport["tests"];

  const playwright = await import("playwright");
  const browser = await playwright.chromium.launch({
    headless: headlessOverride ? headlessOverride === "true" : spec.headless ?? true,
  });

  try {
    for (const test of spec.tests) {
      const expandedSteps = expandWebSteps(spec, test.steps, functions, env);
      tests.push(await runTest(browser, spec, { ...test, steps: expandedSteps }));
    }
  } finally {
    await browser.close();
  }

  const passed = tests.filter((test) => test.status === "passed").length;
  const failed = tests.length - passed;
  const durationMs = Math.round(performance.now() - suiteStart);

  return {
    metadata: {
      suiteName: spec.suiteName,
      channel: "web",
      startedAt,
      finishedAt: nowIso(),
      durationMs,
    },
    summary: {
      total: tests.length,
      passed,
      failed,
    },
    tests,
  };
}

async function runTest(browser: import("playwright").Browser, spec: WebSpec, test: WebTestCase) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const stepResults: StepResult[] = [];
  const testStart = performance.now();

  try {
    for (const [index, step] of test.steps.entries()) {
      const stepStart = performance.now();
      try {
        await executeStep(page, spec, step);
        stepResults.push({
          index,
          type: step.type,
          status: "passed",
          durationMs: Math.round(performance.now() - stepStart),
        });
      } catch (error) {
        stepResults.push({
          index,
          type: step.type,
          status: "failed",
          durationMs: Math.round(performance.now() - stepStart),
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          name: test.name,
          status: "failed" as const,
          durationMs: Math.round(performance.now() - testStart),
          stepResults,
          error: `Step ${index} failed: ${step.type}`,
        };
      }
    }

    return {
      name: test.name,
      status: "passed" as const,
      durationMs: Math.round(performance.now() - testStart),
      stepResults,
    };
  } finally {
    await context.close();
  }
}

async function executeStep(page: import("playwright").Page, spec: WebSpec, step: WebStep): Promise<void> {
  switch (step.type) {
    case "goto": {
      const target = resolveUrl(spec.baseUrl, step.url || "");
      await page.goto(target, { timeout: step.timeoutMs });
      return;
    }

    case "click": {
      await page.click(step.selector!, { timeout: step.timeoutMs });
      return;
    }

    case "fill": {
      await page.fill(step.selector!, step.value ?? "", { timeout: step.timeoutMs });
      return;
    }

    case "press": {
      await page.press(step.selector!, step.key!, { timeout: step.timeoutMs });
      return;
    }

    case "waitFor": {
      if (step.selector) {
        await page.waitForSelector(step.selector, { timeout: step.timeoutMs });
      } else {
        await page.waitForTimeout(step.timeoutMs ?? 1000);
      }
      return;
    }

    case "assertText": {
      const content = (await page.textContent(step.selector!)) ?? "";
      if (!content.includes(step.value ?? "")) {
        throw new Error(`Expected text '${step.value}' in '${content}'`);
      }
      return;
    }

    case "assertVisible": {
      const isVisible = await page.locator(step.selector!).first().isVisible({ timeout: step.timeoutMs });
      if (!isVisible) {
        throw new Error(`Element is not visible: ${step.selector}`);
      }
      return;
    }

    case "screenshot": {
      await page.screenshot({ path: step.value ?? `artifacts/${Date.now()}.png`, fullPage: true });
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

function resolveUrl(baseUrl: string | undefined, stepUrl: string): string {
  if (!baseUrl) {
    return stepUrl;
  }

  if (stepUrl.startsWith("http://") || stepUrl.startsWith("https://")) {
    return stepUrl;
  }

  return new URL(stepUrl, baseUrl).toString();
}
