# Plan

1. Inspect the current chat/tool-loop handling to confirm why completed `read_pages` outputs are being resubmitted or why the model keeps choosing read tools.
2. Check AI SDK v6 tool-output flow and message part states used by this app.
3. Patch the client so each tool call is executed exactly once and its output is attached once.
4. Add a safety guard for repeated `read_page` / `read_pages` calls in one assistant turn so the agent gets a clear error instead of looping forever.
5. Run `npx tsc --noEmit` to verify the fix.
