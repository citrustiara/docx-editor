# Plan

1. ✅ Inspect the current chat/tool-loop handling to confirm why completed `read_pages` outputs are being resubmitted or why the model keeps choosing read tools.
2. ✅ Check AI SDK v6 tool-output flow and message part states used by this app.
3. ✅ Patch the client so each tool call is executed exactly once and its output is attached once.
4. ✅ Add a safety guard for repeated `read_page` / `read_pages` calls in one assistant turn so the agent gets a clear error instead of looping forever.
5. ✅ Run `npx tsc --noEmit` to verify the fix.
6. ✅ **Table input — root cause found:**
   - `getPageContent()` in `@eigenpal/docx-editor-react` filters `E.kind !== "paragraph"`, so `read_page`/`read_pages` never return table cell content or paraIds.
   - `read_document` and `find_text` DO include table cell content with stable paraIds (format: `[paraId] (table, row N, col M) cell text`).
   - `suggest_change` works on any paraId, including table cell paraIds — the agent just needs to discover them via `read_document` or `find_text`.
7. ✅ Updated system prompt with explicit TABLE EDITING instructions:
   - Instructs agent to use `read_document` or `find_text` for table work (not page tools).
   - Documents the table cell line format from `read_document`.
   - Explains how to edit cells with `suggest_change` using cell paraIds.
   - Covers empty cell insertion (`search=""` + `replaceWith`).
8. ✅ `npx tsc --noEmit` passes.

## Potential future improvement (requires library change)
- Update `getPageContent()` in `@eigenpal/docx-editor-react` to also include table cell paragraphs as `PageParagraph` entries so `read_page`/`read_pages` can discover table content directly. This is a breaking change to the library's page content API.
