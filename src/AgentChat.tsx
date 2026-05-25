import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import {
  useDocxAgentTools,
  AgentChatLog,
  AgentComposer,
  AgentSuggestionChip,
  type EditorRefLike,
} from '@eigenpal/docx-editor-agents/react';
import { toAgentMessages } from '@eigenpal/docx-editor-agents/ai-sdk/react';

const SUGGESTIONS = [
  'Summarize this document',
  'Fix grammar and spelling',
  'Add a table of contents',
  'Make it more formal',
  'Simplify the language',
];

const READ_TOOL_NAMES = new Set(['read_page', 'read_pages']);
const MAX_READ_TOOL_CALLS_PER_USER_TURN = 8;
const LOOP_GUARD_ERROR_PREFIX = '[tool-loop-guard]';

type ToolPartLike = {
  type?: string;
  state?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  args?: unknown;
  providerExecuted?: boolean;
  errorText?: string;
};

function isToolPart(part: unknown): part is ToolPartLike {
  if (!part || typeof part !== 'object') return false;

  const type = (part as ToolPartLike).type;
  return type === 'dynamic-tool' || (typeof type === 'string' && type.startsWith('tool-'));
}

function getToolName(toolPart: ToolPartLike): string | null {
  if (toolPart.toolName) return toolPart.toolName;
  if (typeof toolPart.type === 'string' && toolPart.type.startsWith('tool-')) {
    return toolPart.type.slice('tool-'.length);
  }
  return null;
}

function getToolInput(toolPart: ToolPartLike): Record<string, unknown> {
  const input = toolPart.input ?? toolPart.args ?? {};
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function getLastUserTurnKey(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') return message.id ?? `user-${index}`;
  }
  return 'initial-turn';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function getReadToolSignature(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${stableStringify(input)}`;
}

function getLoopGuardToolCallId(message: any): string | null {
  if (message?.role !== 'assistant') return null;

  for (const part of message.parts ?? []) {
    if (!isToolPart(part)) continue;
    if (part.state === 'output-error' && part.errorText?.startsWith(LOOP_GUARD_ERROR_PREFIX)) {
      return part.toolCallId ?? null;
    }
  }

  return null;
}

interface AgentChatProps {
  editorRef: React.RefObject<EditorRefLike | null>;
  selectedModel: string;
}

export default function AgentChat({ editorRef, selectedModel }: AgentChatProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { tools, executeToolCall, getContext } = useDocxAgentTools({
    editorRef,
    author: 'AI Assistant',
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            messages,
            context: getContext(),
            model: selectedModel,
          },
        }),
      }),
    [getContext, selectedModel]
  );

  const chat = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const chatRef = useRef(chat);
  chatRef.current = chat;

  const executedToolCallIdsRef = useRef(new Set<string>());
  const readToolCallCountsRef = useRef(new Map<string, number>());
  const readToolSignaturesRef = useRef(new Map<string, Set<string>>());

  const runToolCall = useCallback(
    async (toolCall: ToolPartLike) => {
      const toolName = getToolName(toolCall);
      const toolCallId = toolCall.toolCallId;
      const input = getToolInput(toolCall);
      const userTurnKey = getLastUserTurnKey(chatRef.current.messages);

      if (!toolName || !toolCallId) return;
      if (executedToolCallIdsRef.current.has(toolCallId)) return;

      executedToolCallIdsRef.current.add(toolCallId);

      console.log('🛠️ Tool call received:', toolName, input);

      try {
        if (READ_TOOL_NAMES.has(toolName)) {
          const readToolCallCount = readToolCallCountsRef.current.get(userTurnKey) ?? 0;
          const readToolSignatures = readToolSignaturesRef.current.get(userTurnKey) ?? new Set<string>();
          const readToolSignature = getReadToolSignature(toolName, input);

          if (readToolSignatures.has(readToolSignature)) {
            throw new Error(
              `${LOOP_GUARD_ERROR_PREFIX} Duplicate ${toolName} call for ${stableStringify(input)}. ` +
                'You already have this page content in the conversation. Use the previous tool result and answer the user instead of reading it again.'
            );
          }

          if (readToolCallCount >= MAX_READ_TOOL_CALLS_PER_USER_TURN) {
            throw new Error(
              `${LOOP_GUARD_ERROR_PREFIX} Too many document read calls in one turn (${MAX_READ_TOOL_CALLS_PER_USER_TURN}). ` +
                'Stop reading more pages. Use the content already returned by the read tools to answer or edit the document.'
            );
          }

          readToolSignatures.add(readToolSignature);
          readToolSignaturesRef.current.set(userTurnKey, readToolSignatures);
          readToolCallCountsRef.current.set(userTurnKey, readToolCallCount + 1);
        }

        const result = await executeToolCall(toolName, input);
        console.log('✅ Tool result:', result);

        await chatRef.current.addToolOutput({
          tool: toolName,
          toolCallId,
          output: result,
        } as any);
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        console.error('❌ Tool execution failed:', err);

        await chatRef.current.addToolOutput({
          tool: toolName,
          toolCallId,
          state: 'output-error',
          errorText,
        } as any);
      }
    },
    [executeToolCall]
  );

  useEffect(() => {
    const currentToolCallIds = new Set<string>();
    const pendingToolCalls: ToolPartLike[] = [];

    for (const message of chat.messages) {
      if (message.role !== 'assistant') continue;

      for (const part of message.parts ?? []) {
        if (!isToolPart(part)) continue;

        const toolPart = part as ToolPartLike;
        if (!toolPart.toolCallId) continue;

        currentToolCallIds.add(toolPart.toolCallId);

        if (
          toolPart.state === 'input-available' &&
          !toolPart.providerExecuted &&
          !executedToolCallIdsRef.current.has(toolPart.toolCallId)
        ) {
          pendingToolCalls.push(toolPart);
        }
      }
    }

    for (const toolCallId of executedToolCallIdsRef.current) {
      if (!currentToolCallIds.has(toolCallId)) {
        executedToolCallIdsRef.current.delete(toolCallId);
      }
    }

    for (const toolCall of pendingToolCalls) {
      void runToolCall(toolCall);
    }
  }, [chat.messages, runToolCall]);

  useEffect(() => {
    const activeUserTurnKeys = new Set<string>();
    for (const message of chat.messages) {
      if (message.role === 'user') {
        activeUserTurnKeys.add(message.id ?? `user-${activeUserTurnKeys.size}`);
      }
    }

    for (const userTurnKey of readToolCallCountsRef.current.keys()) {
      if (!activeUserTurnKeys.has(userTurnKey)) readToolCallCountsRef.current.delete(userTurnKey);
    }

    for (const userTurnKey of readToolSignaturesRef.current.keys()) {
      if (!activeUserTurnKeys.has(userTurnKey)) readToolSignaturesRef.current.delete(userTurnKey);
    }
  }, [chat.messages]);

  useEffect(() => {
    const loopGuardToolCallId = getLoopGuardToolCallId(chat.messages[chat.messages.length - 1]);
    if (loopGuardToolCallId && chat.status !== 'ready' && chat.status !== 'error') {
      void chat.stop();
    }
  }, [chat.messages, chat.status, chat.stop]);

  const agentMessages = useMemo(() => {
    const baseMessages = toAgentMessages(chat.messages, chat.status);
    
    return baseMessages.map((msg, idx) => {
      const original = chat.messages[idx];
      let thinking = '';
      
      if (original?.parts) {
        // @ts-ignore
        const thoughtParts = original.parts.filter(p => p.type === 'reasoning' || p.type === 'thought');
        // @ts-ignore
        thinking = thoughtParts.map(p => p.text || p.reasoning).filter(Boolean).join('\n');
      }

      if (thinking) {
        return {
          ...msg,
          text: `> *Thinking:*\n> ${thinking.split('\n').join('\n> ')}\n\n${msg.text}`
        };
      }
      return msg;
    });
  }, [chat.messages, chat.status]);

  const isLoading = chat.status === 'submitted' || chat.status === 'streaming';

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isLoading) return;
    chat.sendMessage({ text: input.trim() });
    setInput('');
  }, [input, isLoading, chat.sendMessage]);

  const handleSuggestion = useCallback(
    (text: string) => {
      chat.sendMessage({ text });
    },
    [chat.sendMessage]
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agentMessages, isLoading]);

  return (
    <div style={styles.container}>
      <div ref={scrollRef} style={styles.messages}>
        <AgentChatLog
          messages={agentMessages}
          loading={isLoading}
          error={chat.error?.message ?? null}
          emptyState={
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>✦</div>
              <div style={styles.emptyTitle}>AI Document Assistant</div>
              <div style={styles.emptyText}>
                Using <strong>{selectedModel}</strong>
              </div>
              <div style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <AgentSuggestionChip
                    key={s}
                    label={s}
                    onClick={() => handleSuggestion(s)}
                    disabled={isLoading}
                  />
                ))}
              </div>
            </div>
          }
        />
      </div>

      <div style={styles.composer}>
        <AgentComposer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabled={isLoading}
          placeholder="Ask about your document..."
          footnote="Edits are applied as tracked changes"
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#fafafa' },
  messages: { flex: 1, overflow: 'auto', padding: '12px' },
  composer: { borderTop: '1px solid #e5e7eb', padding: '8px' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', textAlign: 'center', color: '#6b7280' },
  emptyIcon: { fontSize: '32px', marginBottom: '12px' },
  emptyTitle: { fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '6px' },
  emptyText: { fontSize: '13px', lineHeight: '1.5', marginBottom: '20px' },
  suggestions: { display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' },
};
