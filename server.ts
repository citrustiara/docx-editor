import express from 'express';
import cors from 'cors';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import { getAiSdkTools } from '@eigenpal/docx-editor-agents/ai-sdk/server';
import { createCodexOpenAIOptions } from './codex-auth.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DEFAULT_MODEL_ID = 'openai-codex/gpt-5.5';

const MODELS = [
  { id: 'openai-codex/gpt-5.5', name: 'Codex GPT-5.5', fast: false },
  { id: 'openai-codex/gpt-5.3-codex', name: 'Codex GPT-5.3', fast: false },
  { id: 'openai-codex/gpt-5.3-codex-spark', name: 'Codex GPT-5.3 Spark', fast: true },
  { id: 'openai-codex/gpt-5.4-mini', name: 'Codex GPT-5.4 Mini', fast: true },
  { id: 'openai-codex/gpt-5.4', name: 'Codex GPT-5.4', fast: false },
];

async function resolveSelectedModel(modelId: string | undefined, instructions: string) {
  const selectedModel = MODELS.find((model) => model.id === modelId)?.id || DEFAULT_MODEL_ID;

  if (selectedModel.startsWith('openai-codex/')) {
    const codexOptions = await createCodexOpenAIOptions();
    const codex = createOpenAI({
      name: 'openai-codex',
      ...codexOptions,
    });

    return {
      model: codex.responses(selectedModel.slice('openai-codex/'.length)),
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: 'medium',
          reasoningSummary: 'auto',
          instructions,
          systemMessageMode: 'remove',
        },
      },
    };
  }

  throw new Error(`Unsupported model: ${selectedModel}`);
}

app.get('/api/models', (_req, res) => {
  res.json(MODELS);
});

const SYSTEM_PROMPT = `You are an expert document editing assistant embedded inside a Word document editor. You have direct access to tools that let you read, search, edit, comment on, and propose tracked changes to the live document.

CAPABILITIES:
- Read document content page by page
- Search for text anywhere in the document
- Add comments anchored to specific paragraphs
- Suggest tracked changes (insertions/deletions) that the user can accept or reject
- Apply formatting (bold, italic, color, font size, etc.)
- Set paragraph styles (headings, quotes, etc.)
- Get info about the user's current cursor position and selection
- Edit table cell content (read the instructions below carefully)

GUIDELINES:
- Use read_pages (e.g. pages 1-3) instead of read_document to avoid loading the entire document at once
- Do not read the same page or page range twice in the same user request. Once a read_page/read_pages result is returned, use that content to answer or edit.
- For broad document tasks, read only the minimum range needed first, then stop and produce a useful result instead of scanning forever.
- read_document is expensive for large documents — prefer reading specific pages or using find_text
- When editing, use paragraph IDs (paraId) from read operations to target specific locations
- Prefer tracked changes over direct edits so the user can review your suggestions
- Be concise in your responses — explain what you did, not every step
- If a task is ambiguous, ask for clarification rather than guessing
- When fixing grammar/style, preserve the author's voice and intent

TABLE EDITING:
- read_page / read_pages do NOT include table cell content. Do not rely on them for table work.
- To read or edit tables, ALWAYS use read_document (optionally with fromIndex/toIndex to scope it) or find_text to locate the relevant content.
- read_document returns table cell lines in this format: [paraId] (table, row N, col M) cell text
- Each table cell paragraph has a stable paraId. Use that paraId with suggest_change to edit cell content.
- When editing a cell, use suggest_change with the cell's paraId and the exact search text from the cell.
- To fill in an empty cell, use suggest_change with search="" (empty string) and replaceWith="the new value" — this inserts at the end of the paragraph.
- If a cell already has content you want to replace, use suggest_change with the full cell text as search and the new value as replaceWith.`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context, model: modelId } = req.body;

    const tools = getAiSdkTools();

    const contextHint = context
      ? `\n\nCurrent editor context: ${JSON.stringify(context)}`
      : '';

    // Convert UI messages to model messages
    const modelMessages = await convertToModelMessages(messages);

    const system = SYSTEM_PROMPT + contextHint + "\n\nImportant: Use internal reasoning (thinking) before responding or calling tools. Explain your steps.";
    const { model, providerOptions } = await resolveSelectedModel(modelId, system);

    const result = streamText({
      model,
      system: providerOptions ? undefined : system,
      messages: modelMessages,
      tools,
      providerOptions,
      maxSteps: 8,
      stopWhen: stepCountIs(8),
      abortSignal: AbortSignal.timeout(120_000),
    });

    result.pipeUIMessageStreamToResponse(res);
  } catch (err: any) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Agent API server running on http://localhost:${PORT}`);
  console.log(`Default model: ${DEFAULT_MODEL_ID}`);
  console.log(`Available: ${MODELS.map(m => m.name).join(', ')}`);
});
