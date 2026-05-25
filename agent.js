import fs from 'node:fs/promises';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createEditorBridge } from '@eigenpal/docx-editor-agents/bridge';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'https://localhost:3000',
    'X-Title': 'Docx Editor Agent',
  },
});

async function runDocxAgent() {
  const inputFilePath = './document.docx'; // Update this to your file path
  const outputFilePath = './edited-document.docx';

  console.log(`Loading ${inputFilePath}...`);
  const fileBuffer = await fs.readFile(inputFilePath);

  const bridge = createEditorBridge({
    documentBuffer: fileBuffer.buffer
  });

  const userPrompt = "Review this document. Fix any grammatical errors in the introduction paragraph, and add a brief 2-sentence summary right after the title.";

  console.log("Starting agent loop via OpenRouter...");

  const response = await generateText({
    model: openrouter('xiaomi/mimo-v2.5-pro'), 
    system: `You are an expert document editor. You have direct access to tools that let you manipulate, replace text, and add comments to a live Microsoft Word document. Perform the tasks requested by the user cleanly.`,
    prompt: userPrompt,
    tools: bridge.agentTools, 
    maxSteps: 10,
  });

  console.log("\nAgent execution summary:\n", response.text);

  console.log("Saving changes back to .docx file format...");
  const updatedArrayBuffer = await bridge.toBuffer();
  
  await fs.writeFile(outputFilePath, Buffer.from(updatedArrayBuffer));
  console.log(`Success! File saved to ${outputFilePath}`);
}

runDocxAgent().catch(console.error);