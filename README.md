# paperclip-hermes-docker-shim

Drop-in `hermes` CLI binary that proxies to the Hermes HTTP API — for **Docker/container** Paperclip setups where Hermes runs in a separate container from Paperclip.

## Why?

The [hermes-paperclip-adapter](https://github.com/NousResearch/hermes-paperclip-adapter) spawns `hermes chat -q "..."` as a child process. In a containerized deployment, Hermes runs in its own container and the `hermes` CLI isn't available in Paperclip's container.

This shim intercepts the CLI call and proxies it to the Hermes API server over HTTP — same session persistence, same tools, same terminal/curl back-channel to Paperclip.

## Install

```bash
npm install -g paperclip-hermes-docker-shim
```

Or in your Paperclip Dockerfile:

```dockerfile
RUN npm install -g paperclip-hermes-docker-shim
```

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `HERMES_API_URL` | `http://127.0.0.1:8642` | Base URL of the Hermes API server |
| `HERMES_API_KEY` | _(none)_ | API key for authentication |

## How It Works

```
Paperclip → adapter → hermes chat -q "prompt" → this shim → HTTP → Hermes API
                                                                        │
                                                        Hermes runs full agent loop
                                                        (tools, memory, sessions)
                                                                        │
                                                        Paperclip API ← curl ←┘
                                                        (task management back-channel)
```

The adapter works completely unchanged — it just calls `hermes` and gets the expected response format.

## Supported CLI Flags

| Flag | Notes |
|---|---|
| `chat -q <prompt>` | The prompt text |
| `-Q` / `--quiet` | Quiet mode (adapter always passes this) |
| `-m <model>` | Model name |
| `-t <toolsets>` | Comma-separated toolsets |
| `--resume <session>` | Resume existing session |
| `--provider <provider>` | Provider name |
| `--yolo` | Bypass approval prompts (always passed) |
| `--source <source>` | Session source tag |
| `-v` / `--verbose` | Accepted, no-op |

## License

MIT
