# kimi-tps-widget

English | **[Русский](README.md)**

Live **TPS (tokens per second)** widget for [Kimi Code CLI](https://www.kimi.com/code/docs/en/).

Kimi Code does not expose streaming token stats to its UI or plugin API. This plugin works around it: on every session start it opens a small watcher in a bottom Windows Terminal split that tails the active session's `wire.jsonl` and renders a single live line:

```
 ⠹ 12s  TPS 24.3  avg 25.9  tok 191
```

- `⠹ Ns` — a step is generating right now (spinner + timer)
- `TPS` — tokens/sec of the last finished step (green ≥ 30, yellow 18–30, red < 18)
- `avg` — rolling average over the last 5 steps (`--avg N` to change)
- `tok` — output tokens of the last step

**Known limitation:** Kimi Code writes token counts to disk only when a step finishes (verified: `content.part` and `usage.record` share the same timestamp). True per-token live TPS is impossible from outside — during generation you see the timer, the number appears the moment the step completes.

## Install

```
/plugins install https://github.com/gor-dey/kimi-tps-widget
```

Then `/reload` or `/new`. The widget opens automatically on every session start (no duplicates — guarded by a pidfile).

## Manual run (no plugin)

```
node ~/.kimi-code/plugins/managed/kimi-tps-widget/watcher/tps-watch.mjs
```

Options: `--avg N` (rolling window), `--replay` (print stats for already finished steps first).

## How it works

- `kimi.plugin.json` declares a `SessionStart` hook.
- `hooks/on-session-start.mjs` opens the watcher in a **bottom split pane (25% of height) of the current Windows Terminal window** (`wt -w last split-pane -H --size 0.25`) and returns focus to the main pane. Falls back to a plain new window when Windows Terminal is unavailable. On macOS/Linux it opens a new terminal window.
- `watcher/tps-watch.mjs` finds the newest `~/.kimi-code/sessions/*/*/agents/main/wire.jsonl`, tails it once per second, and computes `TPS = output tokens / step duration` from `step.begin` → `usage.record` events.

The watcher is read-only: it never talks to the Kimi Code process and adds zero load to it.

## Update

The CLI runs the managed copy under `plugins/managed/`, so updating means reinstalling:

```
/plugins install https://github.com/gor-dey/kimi-tps-widget
/reload
```

## Uninstall

```
/plugins remove kimi-tps-widget
```
