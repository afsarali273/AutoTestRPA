#!/usr/bin/env node
import { Command } from "commander";

interface PlanAction {
  channel: "web" | "api" | "device";
  command: string;
  suggestedSpecPath: string;
  reason: string;
}

interface IntentPlan {
  intent: string;
  actions: PlanAction[];
  nextStep: string;
}

const program = new Command();

program
  .name("uap-orchestrator")
  .description("MCP-oriented orchestration helper for UAP CLIs")
  .version("0.1.0");

program
  .command("plan")
  .description("Generate a CLI execution plan from natural-language intent")
  .argument("<intent>", "User intent text")
  .option("--json", "Print JSON only", false)
  .action((intent: string, options: { json?: boolean }) => {
    const plan = buildPlan(intent);

    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    console.log(`Intent: ${plan.intent}`);
    console.log("Recommended actions:");
    for (const action of plan.actions) {
      console.log(`- [${action.channel}] ${action.command}`);
      console.log(`  reason: ${action.reason}`);
      console.log(`  spec:   ${action.suggestedSpecPath}`);
    }
    console.log(`Next step: ${plan.nextStep}`);
  });

void program.parseAsync(process.argv);

function buildPlan(intent: string): IntentPlan {
  const normalized = intent.toLowerCase();
  const actions: PlanAction[] = [];

  if (includesAny(normalized, ["web", "ui", "browser", "playwright", "frontend"])) {
    actions.push({
      channel: "web",
      command: "uap-web run examples/web/basic-login.yaml",
      suggestedSpecPath: "examples/web/basic-login.yaml",
      reason: "Intent includes web/browser automation context.",
    });
  }

  if (includesAny(normalized, ["api", "rest", "soap", "service", "endpoint"])) {
    actions.push({
      channel: "api",
      command: "uap-api run examples/api/rest-soap.yaml",
      suggestedSpecPath: "examples/api/rest-soap.yaml",
      reason: "Intent includes API/service automation context.",
    });
  }

  if (includesAny(normalized, ["mobile", "appium", "android", "ios", "desktop app", "device"])) {
    actions.push({
      channel: "device",
      command: "uap-device run examples/device/basic-android.yaml",
      suggestedSpecPath: "examples/device/basic-android.yaml",
      reason: "Intent includes mobile/desktop device automation context.",
    });
  }

  if (actions.length === 0) {
    actions.push(
      {
        channel: "web",
        command: "uap-web validate examples/web/basic-login.yaml",
        suggestedSpecPath: "examples/web/basic-login.yaml",
        reason: "No clear channel detected, starting with web validation by default.",
      },
      {
        channel: "api",
        command: "uap-api validate examples/api/rest-soap.yaml",
        suggestedSpecPath: "examples/api/rest-soap.yaml",
        reason: "No clear channel detected, validating API sample in parallel.",
      },
    );
  }

  return {
    intent,
    actions,
    nextStep: "Replace sample spec paths with generated specs from MCP and execute selected commands.",
  };
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}
