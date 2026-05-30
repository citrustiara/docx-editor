import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const AUTH_PROVIDER_ID = 'openai-codex';
const AUTH_CLAIM_PATH = 'https://api.openai.com/auth';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function getAuthFilePath() {
  return (
    process.env.PI_CODEX_AUTH_FILE ||
    process.env.PI_AUTH_FILE ||
    path.join(os.homedir(), '.pi', 'agent', 'auth.json')
  );
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const base64 = parts[1]
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');

  try {
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function extractAccountId(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  return payload?.[AUTH_CLAIM_PATH]?.chatgpt_account_id;
}

async function readAuthFile(authPath) {
  try {
    return JSON.parse(await fs.readFile(authPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read Pi auth file at ${authPath}. Run "pi", then "/login", and choose "ChatGPT Plus/Pro (Codex)".`
    );
  }
}

async function writeAuthFile(authPath, auth) {
  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.writeFile(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
}

async function refreshCodexToken(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI Codex token refresh failed (${response.status}): ${body || response.statusText}`);
  }

  const json = await response.json();
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error(`OpenAI Codex token refresh response missing fields: ${JSON.stringify(json)}`);
  }

  const accountId = extractAccountId(json.access_token);
  if (!accountId) throw new Error('OpenAI Codex token did not include a ChatGPT account id');

  return {
    type: 'oauth',
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
  };
}

export async function getCodexAuth() {
  if (process.env.OPENAI_CODEX_ACCESS_TOKEN) {
    const accountId = process.env.OPENAI_CODEX_ACCOUNT_ID || extractAccountId(process.env.OPENAI_CODEX_ACCESS_TOKEN);
    if (!accountId) throw new Error('Set OPENAI_CODEX_ACCOUNT_ID or use a JWT OPENAI_CODEX_ACCESS_TOKEN');
    return { accessToken: process.env.OPENAI_CODEX_ACCESS_TOKEN, accountId };
  }

  const authPath = getAuthFilePath();
  const auth = await readAuthFile(authPath);
  let credentials = auth[AUTH_PROVIDER_ID];

  if (!credentials || credentials.type !== 'oauth' || !credentials.access || !credentials.refresh) {
    throw new Error(
      `No ChatGPT Codex subscription OAuth credentials found in ${authPath}. Run "pi", then "/login", and choose "ChatGPT Plus/Pro (Codex)".`
    );
  }

  if (!credentials.expires || Date.now() + REFRESH_SKEW_MS >= credentials.expires) {
    credentials = await refreshCodexToken(credentials.refresh);
    auth[AUTH_PROVIDER_ID] = credentials;
    await writeAuthFile(authPath, auth);
  }

  const accountId = credentials.accountId || extractAccountId(credentials.access);
  if (!accountId) throw new Error('OpenAI Codex credentials are missing a ChatGPT account id');

  return { accessToken: credentials.access, accountId };
}

function mapCodexSseFrame(frame) {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) return frame;

  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') return frame;

  try {
    const event = JSON.parse(data);
    if (event?.type === 'response.done') {
      event.type = 'response.completed';
      return `data: ${JSON.stringify(event)}`;
    }
  } catch {
    return frame;
  }

  return frame;
}

async function codexResponsesFetch(input, init) {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') || '';

  if (!response.body || !contentType.includes('text/event-stream')) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let separatorIndex = buffer.indexOf('\n\n');

          while (separatorIndex !== -1) {
            const frame = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            controller.enqueue(encoder.encode(`${mapCodexSseFrame(frame)}\n\n`));
            separatorIndex = buffer.indexOf('\n\n');
          }
        }

        if (buffer.trim()) {
          controller.enqueue(encoder.encode(`${mapCodexSseFrame(buffer)}\n\n`));
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      return reader.cancel();
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function createCodexOpenAIOptions() {
  const { accessToken, accountId } = await getCodexAuth();

  return {
    baseURL: 'https://chatgpt.com/backend-api/codex',
    apiKey: accessToken,
    headers: {
      'OpenAI-Beta': 'responses=experimental',
      'chatgpt-account-id': accountId,
      originator: 'pi',
    },
    fetch: codexResponsesFetch,
  };
}
