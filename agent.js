import fs from 'node:fs/promises';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { createEditorBridge } from '@eigenpal/docx-editor-agents/bridge';
import { createCodexOpenAIOptions } from './codex-auth.js';

async function runDocxAgent() {
  const inputFilePath = './document.docx'; // Update this to your file path
  const outputFilePath = './edited-document.docx';

  console.log(`Loading ${inputFilePath}...`);
  const fileBuffer = await fs.readFile(inputFilePath);

  const bridge = createEditorBridge({
    documentBuffer: fileBuffer.buffer
  });

  const userPrompt = "Review this document. Fix any grammatical errors in the introduction paragraph, and add a brief 2-sentence summary right after the title.";

  console.log("Starting agent loop via ChatGPT Codex subscription...");

  const codex = createOpenAI({
    name: 'openai-codex',
    ...(await createCodexOpenAIOptions()),
  });

  const system = `You are an expert document editor. You have direct access to tools that let you manipulate, replace text, and add comments to a live Microsoft Word document. Perform the tasks requested by the user cleanly.`;

  const response = streamText({
    model: codex.responses(process.env.CODEX_MODEL || 'gpt-5.3-codex'),
    prompt: userPrompt,
    tools: bridge.agentTools,
    providerOptions: {
      openai: {
        store: false,
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
        instructions: system,
        systemMessageMode: 'remove',
      },
    },
    maxSteps: 10,
  });

  console.log("\nAgent execution summary:\n", await response.text);

  console.log("Saving changes back to .docx file format...");
  const updatedArrayBuffer = await bridge.toBuffer();
  
  await fs.writeFile(outputFilePath, Buffer.from(updatedArrayBuffer));
  console.log(`Success! File saved to ${outputFilePath}`);
}

runDocxAgent().catch(console.error);