#!/usr/bin/env node

/**
 * paperclip-hermes-docker-shim
 *
 * Drop-in replacement for the `hermes` CLI that proxies to the Hermes
 * HTTP API server.  Designed for Docker/container setups where Hermes
 * runs in a separate container from Paperclip.
 *
 * Usage (called by hermes-paperclip-adapter):
 *   hermes chat -q "prompt" -Q --yolo --source tool -m model -t toolsets --resume session
 *
 * Environment:
 *   HERMES_API_URL    Base URL of Hermes API server (default: http://127.0.0.1:8642)
 *   HERMES_API_KEY    API key for authentication (optional if no key configured)
 */

import { parseArgs } from "node:util";
import { env, exit, stderr, stdout } from "node:process";

// ── Config ──────────────────────────────────────────────────────────────────
const API_URL = (env.HERMES_API_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const API_KEY = env.HERMES_API_KEY || "";

// ── Parse CLI args ──────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    query:     { type: "string",  short: "q" },
    quiet:     { type: "boolean", short: "Q" },
    model:     { type: "string",  short: "m" },
    toolsets:  { type: "string",  short: "t" },
    resume:    { type: "string",  short: "r" },
    provider:  { type: "string" },
    yolo:      { type: "boolean" },
    source:    { type: "string" },
    "max-turns":    { type: "string" },
    worktree:       { type: "boolean", short: "w" },
    checkpoints:    { type: "boolean" },
    verbose:        { type: "boolean", short: "v" },
  },
});

const subcommand = positionals[0];
if (subcommand !== "chat") {
  stderr.write(`[hermes-shim] Unknown subcommand: ${subcommand}. Only 'chat' is supported.\n`);
  exit(1);
}

const prompt = values.query || "";
const model = values.model || "";
const toolsets = values.toolsets || "";
const sessionId = values.resume || "";
const provider = values.provider || "";
const maxTurns = values["max-turns"];
const source = values.source || "tool";
const yolo = values.yolo;

// ── Build messages ──────────────────────────────────────────────────────────
const messages = [];
if (prompt) {
  messages.push({ role: "user", content: prompt });
}

// ── Build request ───────────────────────────────────────────────────────────
const body = {
  model: model || undefined,
  messages,
  stream: true,
};

const headers = {
  "Content-Type": "application/json",
};

if (API_KEY) {
  headers["Authorization"] = `Bearer ${API_KEY}`;
}

if (sessionId) {
  headers["X-Hermes-Session-Id"] = sessionId;
}

// ── Execute ─────────────────────────────────────────────────────────────────
try {
  const res = await fetch(`${API_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errorBody = "";
    try { errorBody = await res.text(); } catch {}
    stderr.write(`[hermes-shim] API error ${res.status}: ${errorBody}\n`);
    exit(1);
  }

  // ── Stream reading ──────────────────────────────────────────────────────
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let extractedSessionId = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const event = JSON.parse(data);
        const choices = event.choices;

        if (choices && choices.length > 0) {
          const delta = choices[0].delta || {};
          if (delta.content) {
            output += delta.content;
          }
        }

      } catch {
        // Skip unparseable SSE lines
      }
    }
  }

  // Flush remaining buffer
  if (buffer.startsWith("data: ")) {
    try {
      const event = JSON.parse(buffer.slice(6));
      const choices = event.choices;
      if (choices && choices.length > 0) {
        const delta = choices[0].delta || {};
        if (delta.content) output += delta.content;
      }
    } catch {}
  }

  // ── Extract session_id from response ─────────────────────────────────────
  // The API server includes a session_id in the SSE stream or we can use
  // X-Hermes-Session-Id from response headers
  const respSessionId = res.headers.get("X-Hermes-Session-Id");
  if (respSessionId) {
    extractedSessionId = respSessionId;
  } else if (sessionId) {
    // Use the session we passed in (already persisted)
    extractedSessionId = sessionId;
  }

  // ── Adapter-compatible output ───────────────────────────────────────────
  // hermes-paperclip-adapter expects:
  //   <response text>
  //
  //   session_id: <id>
  const trimmed = output.trim();
  if (trimmed) {
    stdout.write(trimmed + "\n");
  }
  if (extractedSessionId) {
    stdout.write(`\nsession_id: ${extractedSessionId}\n`);
  }

  exit(0);

} catch (err) {
  stderr.write(`[hermes-shim] Connection error: ${err.message}\n`);
  exit(1);
}
