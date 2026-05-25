import express from 'express';
import cors from 'cors';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, stepCountIs, convertToModelMessages } from 'ai';
import { getAiSdkTools } from '@eigenpal/docx-editor-agents/ai-sdk/server';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': 'https://localhost:5173',
    'X-Title': 'Docx Editor Agent',
  },
});

const MODELS = [
  { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', fast: true },
  { id: 'xiaomi/mimo-v2.5-pro', name: 'MiMo v2.5 Pro', fast: false },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', fast: true },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', fast: true },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', fast: false },
  { id: 'openai/gpt-4o', name: 'GPT-4o', fast: false },
];

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

GUIDELINES:
- Use read_pages (e.g. pages 1-3) instead of read_document to avoid loading the entire document at once
- Do not read the same page or page range twice in the same user request. Once a read_page/read_pages result is returned, use that content to answer or edit.
- For broad document tasks, read only the minimum range needed first, then stop and produce a useful result instead of scanning forever.
- read_document is expensive for large documents — prefer reading specific pages or using find_text
- When editing, use paragraph IDs (paraId) from read operations to target specific locations
- Prefer tracked changes over direct edits so the user can review your suggestions
- Be concise in your responses — explain what you did, not every step
- If a task is ambiguous, ask for clarification rather than guessing
- When fixing grammar/style, preserve the author's voice and intent`;

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, context, model: modelId } = req.body;

    const tools = getAiSdkTools();

    const contextHint = context
      ? `\n\nCurrent editor context: ${JSON.stringify(context)}`
      : '';

    // Convert UI messages to model messages
    const modelMessages = await convertToModelMessages(messages);

    const selectedModel = MODELS.find(m => m.id === modelId)?.id || 'google/gemini-3-flash-preview';

    const result = streamText({
      model: openrouter(selectedModel),
      system: SYSTEM_PROMPT + contextHint + "\n\nImportant: Use internal reasoning (thinking) before responding or calling tools. Explain your steps.",
      messages: modelMessages,
      tools,
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
  console.log(`Default model: google/gemini-3-flash-preview`);
  console.log(`Available: ${MODELS.map(m => m.name).join(', ')}`);
});
