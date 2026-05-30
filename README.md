# Docx Editor + AI Agent

![App Showcase](images/Screenshot%202026-05-25%20at%2021-15-56%20Docx%20Editor%20AI%20Agent.png)

A visual Word document editor with an integrated AI agent.

## Features

- **Visual DOCX Editor** — Full Word-like editing experience with toolbar, tracked changes, comments
- **AI Agent Panel** — Chat with an AI that can directly edit your document
- **14 Agent Tools** — Read, search, comment, suggest changes, format text, and more
- **Client-side execution** — Tools run in the browser against the live editor
- **Tracked changes** — AI suggestions appear as tracked changes you can accept/reject

## Quick Start

```bash
# Install dependencies
npm install

# Start both the API server and frontend dev server
npm start
```

This starts:
- **Frontend**: http://localhost:5173 (Vite dev server)
- **API Server**: http://localhost:3001 (Express + ChatGPT Codex subscription by default)

## Codex Subscription Auth

The agent uses Pi's ChatGPT Plus/Pro Codex OAuth credentials from `~/.pi/agent/auth.json`.

```bash
pi
/login   # choose "ChatGPT Plus/Pro (Codex)"
npm start
```

Codex models are selected in the toolbar and use ids like `openai-codex/gpt-5.5`.

Optional overrides:

```bash
# Use a different Pi auth file
export PI_CODEX_AUTH_FILE=/path/to/auth.json

# Or provide a Codex access token directly
export OPENAI_CODEX_ACCESS_TOKEN=...
export OPENAI_CODEX_ACCOUNT_ID=... # only needed if the token is not a JWT with the account id
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                                    │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  DocxEditor          │  │  Agent Panel                 │ │
│  │  (visual editor)     │  │  (chat + tool execution)     │ │
│  │                      │  │                              │ │
│  │  ┌────────────────┐  │  │  useDocxAgentTools()         │ │
│  │  │ ProseMirror    │  │  │  ├─ executeToolCall()        │ │
│  │  │ document model │◄─┼──┼─┤  ├─ toolSchemas            │ │
│  │  └────────────────┘  │  │  └─ getContext()             │ │
│  └──────────────────────┘  └──────────────┬───────────────┘ │
│                                           │                 │
└───────────────────────────────────────────┼─────────────────┘
                                            │ POST /api/chat
                                            ▼
                               ┌────────────────────────┐
                               │  Express Server (3001)  │
                               │  streamText({           │
                               │    model: selectedModel,│
                               │    tools: getAiSdkTools │
                               │  })                     │
                               └────────────────────────┘
```

1. User sends a message in the agent chat
2. Frontend sends messages to `/api/chat` with editor context
3. Server streams response from ChatGPT Codex subscription auth using AI SDK
4. When the model calls a tool, AI SDK forwards it to the client
5. Client executes the tool against the live DocxEditor
6. Tool result goes back to the model for the next step

## Agent Tools

| Tool | Description |
|------|-------------|
| `read_document` | Get full document summary |
| `read_page` / `read_pages` | Read page contents |
| `find_text` | Search for text in the document |
| `read_selection` | Get current cursor selection |
| `add_comment` | Add a comment to a paragraph |
| `suggest_change` | Propose a tracked change |
| `apply_formatting` | Apply bold/italic/color/etc |
| `set_paragraph_style` | Set heading/quote/etc style |
| `reply_comment` | Reply to an existing comment |
| `resolve_comment` | Mark a comment as resolved |
| `read_comments` | List all comments |
| `read_changes` | List all tracked changes |
| `scroll` | Scroll to a page or paragraph |

## Standalone Agent Script

For headless/CLI usage without the visual editor:

```bash
node agent.js
```

This runs the agent programmatically against a .docx file and saves the result.
