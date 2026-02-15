# Unified Automation Platform (UAP)

Unified automation stack for web, API, and device testing with:
- CLI runners (`Playwright`, `REST/SOAP`, `Appium`)
- Reusable function library (`useFunction` across channels)
- Control Center backend API for run orchestration
- Control Center UI for suite management, execution, logs, and MCP planning

## Architecture docs
- Product roadmap: `docs/master-plan.md`
- MCP blueprint: `docs/mcp-integration.md`

## Monorepo packages
- `packages/cli-web`: `uap-web` CLI (web automation)
- `packages/cli-api`: `uap-api` CLI (REST + SOAP)
- `packages/cli-appium`: `uap-device` CLI (Appium mobile/desktop)
- `packages/cli-shared`: path resolution, env interpolation, reusable function expansion
- `packages/contracts`: shared DSL/report contracts
- `packages/mcp-orchestrator`: intent planner CLI
- `apps/control-center-api`: backend API for suite discovery and run orchestration
- `apps/control-center`: React UI for management and monitoring

## Example assets
- Web suite: `examples/web/basic-login.yaml`
- API suite: `examples/api/rest-soap.yaml`
- Device suite: `examples/device/basic-android.yaml`
- Reusable functions: `examples/functions/reusable.yaml`

## Quick start
1. Install dependencies
```bash
pnpm install
```

2. Validate suites
```bash
pnpm --filter @uap/cli-web dev validate examples/web/basic-login.yaml
pnpm --filter @uap/cli-api dev validate examples/api/rest-soap.yaml
pnpm --filter @uap/cli-appium dev validate examples/device/basic-android.yaml
```

3. Run suites
```bash
pnpm --filter @uap/cli-web dev run examples/web/basic-login.yaml
pnpm --filter @uap/cli-api dev run examples/api/rest-soap.yaml
pnpm --filter @uap/cli-appium dev run examples/device/basic-android.yaml
```

4. Run Control Center API (terminal 1)
```bash
pnpm dev:control-api
```

5. Run Control Center UI (terminal 2)
```bash
pnpm dev:ui
```

6. Open UI
- `http://localhost:4173`

## CLI capabilities implemented
- Common spec formats: `.yaml`, `.yml`, `.json`
- Env interpolation: `{{env.KEY}}`
- Suite variables: `{{var.name}}`
- Function params: `{{arg.param}}`
- Reusable function expansion with nested `useFunction` (depth-limited)
- Channel reports in JSON format

## Control Center API endpoints
- `GET /api/health`
- `GET /api/suites`
- `POST /api/suites`
- `GET /api/functions`
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/logs`
- `GET /api/runs/:id/report`
- `POST /api/runs/:id/cancel`
- `POST /api/mcp/plan`
