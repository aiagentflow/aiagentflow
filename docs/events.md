# Run events

Every workflow run emits a stream of typed events. You can consume them in two ways:

- **`--output json`**: `aiagentflow run` and `aiagentflow resume` print one JSON object per line (NDJSON) on **stdout**. Logs, spinners, and the streaming preview go to **stderr**, so stdout stays machine-readable.
- **Event log**: every run also appends its events to `.aiagentflow/sessions/<session-id>.events.ndjson`. The `aiagentflow ui` activity feed tails this file.

```bash
aiagentflow run "Add a /health endpoint" --auto --output json | jq -c 'select(.type == "step.finished")'
```

Every event has a `type` and an ISO-8601 `time`. The TypeScript definitions are `RunEvent` and `TimedRunEvent` in [`src/core/events.ts`](../src/core/events.ts).

| Type | Fields | When |
|---|---|---|
| `run.started` | `sessionId`, `task`, `workflow`, `resumed` | Before the first step |
| `step.started` | `step`, `agent` | Before a step's agent runs |
| `tool.called` | `step`, `agent`, `tool`, `input` | After an agent's tool call ran (paired with `tool.result`) |
| `tool.result` | `step`, `agent`, `tool`, `isError` | Outcome of that tool call |
| `check.finished` | `step`, `check` (`lint` or `test`), `passed` | After a step's lint or test check |
| `verdict` | `step`, `agent`, `verdict` (`{ verdict, summary, issues[] }`) | When a reviewer, security, or judge agent submits its verdict |
| `step.finished` | `step`, `agent`, `outcome` (`passed`, `failed`, `aborted`), `detail?`, `usage?`, `costUsd?` | After a step, once its checks and gate ran |
| `run.finished` | `sessionId`, `status` (`passed` or `failed`), `failureReason?`, `iterations`, `files`, `testFiles`, `totalTokens`, `costUsd`, `durationMs` | After the last step |

A `step.finished` with `outcome: "failed"` means a check or gate failed and the workflow routed to the step's `onFail` target (or ended, if it has none).

## Example

```json
{"type":"run.started","sessionId":"20261004-add-a-health-endpoint","task":"Add a /health endpoint","workflow":"standard","resumed":false,"time":"2026-10-04T02:52:16.276Z"}
{"type":"step.started","step":"plan","agent":"architect","time":"2026-10-04T02:52:16.301Z"}
{"type":"step.finished","step":"plan","agent":"architect","outcome":"passed","usage":{"promptTokens":1840,"completionTokens":412,"totalTokens":2252},"costUsd":0.0117,"time":"2026-10-04T02:52:24.010Z"}
{"type":"step.started","step":"implement","agent":"coder","time":"2026-10-04T02:52:24.020Z"}
{"type":"tool.called","step":"implement","agent":"coder","tool":"read_file","input":{"path":"src/server.ts"},"time":"2026-10-04T02:52:27.115Z"}
{"type":"tool.result","step":"implement","agent":"coder","tool":"read_file","isError":false,"time":"2026-10-04T02:52:27.116Z"}
{"type":"run.finished","sessionId":"20261004-add-a-health-endpoint","status":"passed","iterations":0,"files":["src/server.ts"],"testFiles":["tests/health.test.ts"],"totalTokens":48211,"costUsd":0.21,"durationMs":96000,"time":"2026-10-04T02:53:52.276Z"}
```
