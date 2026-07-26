#!/usr/bin/env node
// tps-watch.mjs — живой TPS-виджет для Kimi Code (одна строка, обновляется на месте).
//
//   ⠹ 12s   TPS 24.3   avg5 25.9   tok 191     — шаг генерируется, идёт секундомер
//   · idle  TPS 24.3   avg5 25.9   tok 191     — ожидание следующего шага
//
// ВАЖНО: Kimi Code пишет токены в wire.jsonl только в момент окончания шага
// (проверено по таймстемпам: content.part и usage.record имеют одинаковое время).
// Поэтому live-TPS во время генерации невозможен в принципе — во время шага
// виджет показывает секундомер, цифра появляется сразу после завершения.
//
// Запуск:  node tps-watch.mjs
// Опции:   --avg N    окно скользящего среднего (по умолчанию 5)
//          --replay   сначала вывести статистику по уже прошедшим шагам

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// pidfile: лаунчер плагина по нему понимает, что виджет уже запущен
const PIDFILE = path.join(os.tmpdir(), "kimi-tps-widget.pid");
fs.writeFileSync(PIDFILE, String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(PIDFILE); } catch {} });

const HOME = process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
const SESSIONS = path.join(HOME, "sessions");
const arg = (name) => process.argv.indexOf(name);
const AVG_WINDOW = arg("--avg") > -1 ? Number(process.argv[arg("--avg") + 1]) : 5;
const REPLAY = process.argv.includes("--replay");

function newestWireFile() {
	let best = null;
	let bestMtime = 0;
	for (const wd of fs.readdirSync(SESSIONS, { withFileTypes: true })) {
		if (!wd.isDirectory()) continue;
		const wdDir = path.join(SESSIONS, wd.name);
		for (const s of fs.readdirSync(wdDir, { withFileTypes: true })) {
			const wire = path.join(wdDir, s.name, "agents", "main", "wire.jsonl");
			try {
				const mtime = fs.statSync(wire).mtimeMs;
				if (mtime > bestMtime) {
					bestMtime = mtime;
					best = wire;
				}
			} catch { /* нет файла — пропускаем */ }
		}
	}
	return best;
}

let currentFile = null;
let offset = 0;
let buffer = "";
let started = false;

let stepBegin = null; // мс — начало текущего/последнего шага
let working = false; // идёт ли шаг прямо сейчас
let lastTps = null; // TPS последнего завершённого шага
let lastTokens = null;
const recent = []; // последние TPS для среднего

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function handleLine(line, silent) {
	let rec;
	try {
		rec = JSON.parse(line);
	} catch {
		return;
	}
	if (rec.type === "context.append_loop_event" && rec.event?.type === "step.begin" && rec.time) {
		stepBegin = rec.time;
		working = true;
		return;
	}
	if (rec.type === "usage.record" && rec.time && rec.usage?.output != null) {
		working = false;
		const durationSec = stepBegin ? (rec.time - stepBegin) / 1000 : null;
		if (!durationSec || durationSec <= 0.05) return;
		lastTps = rec.usage.output / durationSec;
		lastTokens = rec.usage.output;
		recent.push(lastTps);
		if (recent.length > AVG_WINDOW) recent.shift();
		if (silent) {
			console.log(
				`  history: ${String(lastTokens).padStart(5)} tok за ${durationSec.toFixed(1)}s → ${lastTps.toFixed(1)} tok/s`,
			);
		}
	}
}

function pump() {
	if (!currentFile) return;
	let fd;
	try {
		fd = fs.openSync(currentFile, "r");
		const size = fs.fstatSync(fd).size;
		if (size < offset) offset = 0;
		if (size === offset) return;
		const chunk = Buffer.alloc(size - offset);
		fs.readSync(fd, chunk, 0, chunk.length, offset);
		offset = size;
		buffer += chunk.toString("utf8");
	} catch {
		return;
	} finally {
		if (fd !== undefined) try { fs.closeSync(fd); } catch {}
	}
	const lines = buffer.split("\n");
	buffer = lines.pop();
	for (const line of lines) if (line.trim()) handleLine(line, REPLAY && !started);
}

function rescan() {
	const latest = newestWireFile();
	if (latest && latest !== currentFile) {
		currentFile = latest;
		offset = 0;
		buffer = "";
		working = false;
	}
	pump();
	if (!started) {
		// без --replay пропускаем историю, смотрим только новые шаги
		if (!REPLAY) {
			recent.length = 0;
			lastTps = null;
			lastTokens = null;
		}
		started = true;
	}
}

// --- TUI: одна строка, перерисовывается на месте через ANSI ---

const out = process.stdout;

// ANSI-цвета
const C = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	magenta: "\x1b[35m",
};

// видимая длина строки без ANSI-кодов
const vlen = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

function tpsColor(v) {
	if (v === null) return C.dim;
	if (v >= 30) return C.green;
	if (v >= 18) return C.yellow;
	return C.red;
}

function render() {
	const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
	const spin = SPINNER[Math.floor(Date.now() / 120) % SPINNER.length];

	const status = working && stepBegin
		? `${C.magenta}${spin}${C.reset} ${C.bold}${((Date.now() - stepBegin) / 1000).toFixed(0)}s${C.reset}`
		: `${C.dim}· idle${C.reset}`;
	const tps = lastTps !== null
		? `${tpsColor(lastTps)}${C.bold}${lastTps.toFixed(1)}${C.reset}`
		: `${C.dim}—${C.reset}`;
	const avgStr = avg !== null
		? `${C.cyan}${avg.toFixed(1)}${C.reset}`
		: `${C.dim}—${C.reset}`;
	const tok = lastTokens !== null
		? `${C.yellow}${lastTokens}${C.reset}`
		: `${C.dim}—${C.reset}`;

	let line = ` ${status}  ${C.dim}TPS${C.reset} ${tps}  ${C.dim}avg${C.reset} ${avgStr}  ${C.dim}tok${C.reset} ${tok}`;
	// обрезаем по ВИДИМОЙ ширине, чтобы ANSI-коды не ломали перенос
	const width = (out.columns || 80) - 1;
	while (vlen(line) > width) line = line.slice(0, -1);
	out.write(`\r\x1b[K${line}`); // CR + стереть строку + текст
}

function cleanup() {
	out.write("\x1b[?25h\n"); // вернуть курсор
	process.exit(0);
}

out.write("\x1b[?25l"); // скрыть курсор
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

console.log("TPS-виджет Kimi Code (Ctrl+C для выхода)");
rescan();
setInterval(rescan, 1000);
setInterval(render, 150);
