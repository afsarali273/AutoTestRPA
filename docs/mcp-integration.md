# MCP Integration Blueprint

## Objective
Enable natural-language automation requests to produce executable test specs and run the correct CLI(s) automatically.

## Integration Contract

### Input
- `intent`: free-text prompt from user
- `context`: environment, app URLs, credentials references, selected project
- `constraints`: dry-run mode, allowed channels, execution limits

### Output
- `classifiedChannels`: `web`, `api`, `device`, or mixed
- `generatedSpecs`: one or more spec files in DSL format
- `executionPlan`: ordered CLI commands
- `safetyChecks`: confirmations required before execution

## Orchestration Steps
1. Intent classification.
2. Reusable function lookup.
3. DSL generation.
4. Spec validation via channel CLI.
5. Dry-run preview (optional).
6. Actual run and artifact collection.
7. Suggested refinements.

## Existing Starter Component
`/Users/afsarali/Documents/New project/packages/mcp-orchestrator` contains a starter planner that maps plain-language intent to initial CLI commands.

## Next Implementation Tasks
1. Add schema-backed intent payload (`zod` or JSON schema).
2. Add file writer to emit generated specs.
3. Add subprocess execution wrappers with timeout/cancellation.
4. Add artifact aggregation and unified run report.
5. Integrate planner with Control Center UI prompt panel.
