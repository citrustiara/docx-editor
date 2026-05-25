# Docx Editor + AI Agent

A visual Word document editor with an integrated AI agent powered by OpenRouter (`xiaomi/mimo-v2.5-pro`).

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
- **API Server**: http://localhost:3001 (Express + OpenRouter)

## Environment

The OpenRouter API key must be set in your environment:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
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
                               │    model: 'mimo-v2.5',  │
                               │    tools: getAiSdkTools │
                               │  })                     │
                               └────────────────────────┘
```

1. User sends a message in the agent chat
2. Frontend sends messages to `/api/chat` with editor context
3. Server streams response from OpenRouter using AI SDK
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
