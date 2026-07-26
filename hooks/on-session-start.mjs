#!/usr/bin/env node
// on-session-start.mjs — hook плагина: открывает окно терминала с TPS-виджетом.
// Запускается событием SessionStart; cwd = корень плагина, KIMI_PLUGIN_ROOT тоже доступен.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.env.KIMI_PLUGIN_ROOT || process.cwd();
const WATCHER = path.join(ROOT, "watcher", "tps-watch.mjs");
const PIDFILE = path.join(os.tmpdir(), "kimi-tps-widget.pid");

// уже запущен? (виджет пишет сюда свой pid)
try {
	const pid = Number(fs.readFileSync(PIDFILE, "utf8"));
	if (pid) {
		process.kill(pid, 0); // бросит, если процесса нет
		process.exit(0);
	}
} catch { /* не запущен — продолжаем */ }

function detached(cmd, args) {
	const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
	child.unref();
}

try {
	if (process.platform === "win32") {
		// Windows Terminal в новом окне; если wt нет — conhost через start
		try {
			detached("wt", ["-w", "new", "node", WATCHER]);
		} catch {
			detached("cmd", ["/c", "start", "", "node", WATCHER]);
		}
	} else if (process.platform === "darwin") {
		detached("osascript", [
			"-e",
			`tell application "Terminal" to do script "node ${WATCHER.replace(/"/g, '\\"')}"`,
		]);
	} else {
		detached("x-terminal-emulator", ["-e", "node", WATCHER]);
	}
} catch { /* fail-open: не мешаем сессии */ }

process.exit(0);
