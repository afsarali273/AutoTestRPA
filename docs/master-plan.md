# Unified Automation Platform - Detailed Plan

## 1. Vision
Build a single automation platform that covers:
- Web UI automation (`Playwright`-based CLI)
- API automation (`REST` + `SOAP` CLI)
- Device automation (`Appium`-based CLI for mobile and desktop drivers)
- A unified web UI for authoring, execution, monitoring, and reusable function management
- MCP integration so user intent can be converted into executable tests using existing CLIs

## 2. Product Goals
1. One platform for end-to-end test automation across channels.
2. CLI-first architecture so every action is scriptable and CI-friendly.
3. UI-driven authoring and management for non-CLI users.
4. Reusable functions and low-code building blocks similar to RPA/SaaS automation tools.
5. AI/MCP orchestration to generate and refine automation flows from natural language.

## 3. Non-Goals (Phase 1)
- Full visual drag-and-drop studio parity with commercial RPA tools.
- Self-hosted distributed execution cluster from day one.
- Autonomous healing for selectors and flaky tests in first release.

## 4. Core Personas
- QA Engineer: needs reliable CLI, version-controlled specs, CI integration.
- QA Lead: needs test management, reporting, and shared reusable assets.
- Business Analyst / Non-Developer: needs UI-guided flow creation and reusable templates.
- DevOps Engineer: needs deterministic command-based execution and environment control.

## 5. Capability Matrix

| Capability | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| Web automation CLI | Yes | Expanded | AI-assisted |
| API REST testing CLI | Yes | Expanded | AI-assisted |
| API SOAP testing CLI | Yes | Expanded | AI-assisted |
| Appium CLI (mobile) | Yes | Expanded | AI-assisted |
| Appium CLI (desktop drivers) | Yes (initial) | Expanded | AI-assisted |
| Reusable function registry | Basic | Mature | AI-generated |
| Unified UI | MVP | Feature-rich | Enterprise |
| MCP intent-to-test orchestration | Planning + prototype | Beta | Production |

## 6. Architecture Overview

### 6.1 High-Level Components
1. `CLI-Web`: executes browser test specs using Playwright runtime.
2. `CLI-API`: executes REST/SOAP suites with assertion engine.
3. `CLI-Appium`: executes mobile/desktop device specs via Appium server.
4. `Contracts`: shared schema/types for test specs, variables, reusable steps, execution reports.
5. `Control Center UI`: web app for test authoring, suite management, reusable functions, runs, and reports.
6. `Orchestrator Service` (future): coordinates runs, stores metadata, dispatches CLI jobs.
7. `MCP Adapter` (future): converts user intent into structured specs and invokes CLIs.

### 6.2 Design Principles
- CLI parity: anything doable in UI must be representable in CLI commands/spec.
- Deterministic specs: YAML/JSON DSL that is source-controlled.
- Pluggable engines: web/api/device engines expose common lifecycle hooks.
- Reusability-first: explicit function library, parameterized steps, environment variables.
- Auditability: run logs, artifacts, and change history.

## 7. CLI Product Design

### 7.1 Common CLI Conventions
Each CLI will follow consistent command style:
- `run`: execute a suite/spec
- `validate`: schema and static checks
- `record`: capture actions (where applicable)
- `list-functions`: show reusable functions
- `init`: generate starter suite

Global flags:
- `--env <file>` environment variables
- `--report-dir <dir>` output folder
- `--format <json|junit|html>` report format
- `--headless` (web/device where valid)
- `--debug` verbose logs

### 7.2 CLI-Web (Playwright)
Commands:
- `web run <spec>`
- `web record <target-url>`
- `web validate <spec>`

Core step types:
- `goto`, `click`, `fill`, `select`, `hover`, `press`, `waitFor`, `assertText`, `assertVisible`, `screenshot`

Artifacts:
- screenshots, traces, video (configurable), execution report

### 7.3 CLI-API (REST + SOAP)
Commands:
- `api run <suite>`
- `api validate <suite>`
- `api init`

REST features:
- methods: `GET/POST/PUT/PATCH/DELETE`
- auth: bearer/api-key/basic
- assertions: status, header, json-path (phase 2), body contains

SOAP features:
- envelope templates
- SOAPAction header support
- XML body assertions (contains/xpath phase 2)

### 7.4 CLI-Appium (Mobile + Desktop)
Commands:
- `device run <spec>`
- `device validate <spec>`
- `device init`

Capabilities:
- session creation from JSON capabilities
- step execution using element locators/actions
- initial support for Android/iOS + desktop Appium drivers via capability profiles

## 8. DSL and Reusable Function Model

### 8.1 Shared DSL Concepts
- `Suite`: metadata + list of tests
- `TestCase`: preconditions, steps, assertions
- `Step`: action + target + data + timeout + retry
- `Variables`: env/scoped variables and interpolation
- `ReusableFunction`: named parameterized step bundle

### 8.2 Reusable Functions
Required features:
- parameter definitions with default values
- versioning (`v1`, `v2`)
- channel-scoped (`web`, `api`, `device`, `cross-channel`)
- import/use inside test specs

Examples:
- `login_web(username, password)`
- `create_order_rest(baseUrl, token, payload)`
- `launch_and_login_mobile(user)`

## 9. UI Plan (Control Center)

### 9.1 MVP Screens
1. Dashboard: recent runs, pass/fail trend
2. Test Suites: list, search, tags, ownership
3. Test Editor: DSL + form editor
4. Reusable Function Library
5. Run Console: live logs, artifacts, rerun options
6. Environment Manager: secrets and environment profiles

### 9.2 UX Goals
- guided wizard for creating a suite
- one-click CLI command preview from UI
- copy/paste and diff-friendly DSL editor

## 10. MCP Integration Plan

### 10.1 Phase Goals
- Take natural-language intent and output valid DSL specs.
- Map intents to channel engine (`web/api/device`) automatically.
- Reuse stored functions before generating new steps.

### 10.2 Flow
1. User prompt enters MCP adapter.
2. Adapter classifies scope: web, api, device, or mixed.
3. Adapter resolves reusable functions from registry.
4. Adapter emits draft DSL.
5. Adapter invokes relevant CLI(s) in dry-run or record-assisted mode.
6. Adapter returns generated tests + execution results + improvement suggestions.

### 10.3 Guardrails
- require explicit confirmation before destructive actions
- enforce environment/secret access policies
- redact sensitive values in logs/artifacts

## 11. Delivery Roadmap

### Phase 0 - Foundation (Week 1-2)
- Monorepo setup and shared contracts
- Base CLI scaffolds for web/api/device
- Common report format and logger
- Draft DSL schema

### Phase 1 - CLI MVP (Week 3-6)
- Web CLI run/validate/record bootstrap
- API CLI REST+SOAP run/validate
- Device CLI session + basic actions
- CI pipeline + smoke tests

### Phase 2 - Unified UI MVP (Week 7-10)
- UI auth/project model
- suite management and run triggering
- reusable function library UI
- execution log and report viewer

### Phase 3 - Reusable Engine Maturity (Week 11-14)
- function versioning and dependency map
- advanced assertions and retries
- baseline flakiness controls

### Phase 4 - MCP Assisted Automation (Week 15-18)
- intent parser + DSL generator
- function-aware generation
- auto-run and step recording integration

### Phase 5 - Hardening and Scale (Week 19-24)
- distributed runners
- role-based access and audit logs
- performance tuning and plugin SDK

## 12. Quality and Test Strategy
- Unit tests: parsers, validators, assertion engine
- Integration tests: local mock targets and Appium sandbox
- Contract tests: DSL schema compatibility across CLI/UI
- End-to-end: create suite in UI, run via CLI, validate report
- Non-functional: reliability, retry behavior, parallelism controls

## 13. DevOps and Environments
- CI stages: lint -> test -> build -> package
- Artifact retention: logs, screenshots, traces, junit/json
- Environment layering: local, qa, staging, prod
- Secret strategy: env injection + vault integration (phase 2+)

## 14. Risks and Mitigations
1. Cross-channel complexity
   - Mitigation: strict shared contracts + plugin boundaries.
2. Flaky UI/device tests
   - Mitigation: wait strategies, retries, deterministic selectors, trace artifacts.
3. SOAP/XML edge cases
   - Mitigation: start with minimal assertions, expand via tested parser modules.
4. MCP hallucination risk
   - Mitigation: schema validation, dry-run mode, human confirmation.
5. Toolchain drift (Playwright/Appium updates)
   - Mitigation: compatibility matrix and version pinning.

## 15. KPIs
- Time-to-first-automated-test (< 20 minutes target)
- % suites using reusable functions (> 60%)
- CLI run success rate (> 95% stable in CI)
- MCP-generated test acceptance rate (> 70% with minor edits)

## 16. Immediate Execution Plan (What starts now)
1. Scaffold monorepo and shared contracts.
2. Implement starter CLIs (`web`, `api`, `device`) with `run` + `validate`.
3. Add sample DSL files for each channel.
4. Bootstrap Control Center UI shell.
5. Define MCP adapter interfaces and command contracts for later implementation.
