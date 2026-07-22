/**
 * InlineEditProvider — Cmd-K inline edit command.
 *
 * Flow:
 *  1. User selects code in the editor and presses Cmd+K
 *  2. VS Code input box appears with the edit instruction prompt
 *  3. On submit: streams the edit via AIPiloty backend
 *  4. Extracts the edited code from the response
 *  5. Shows a diff using VS Code's built-in diffEditor or applyEdit API
 *  6. Applies the change
 */

import * as vscode from "vscode";
import { streamChat, type SSEEvent } from "./streaming";
import type { KeychainService } from "../keychain";

export function registerInlineEditCommand(
  context: vscode.ExtensionContext,
  backendUrl: string,
  keychain: KeychainService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("aipiloty.inlineEdit", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText.trim()) {
        vscode.window.showInformationMessage(
          "Select some code first, then press Cmd+K"
        );
        return;
      }

      // Show instruction input
      const instruction = await vscode.window.showInputBox({
        prompt: "Edit instruction (e.g. add type annotations, extract function, fix bug…)",
        placeHolder: "What should AIPiloty do with the selected code?",
        validateInput: (v) => (v.trim().length < 3 ? "Please describe the edit" : null),
      });
      if (!instruction) return;

      // Build context: lines around selection
      const contextLines = vscode.workspace
        .getConfiguration("aipiloty")
        .get<number>("contextLines", 50);
      const doc = editor.document;
      const beforeStart = Math.max(0, selection.start.line - contextLines);
      const afterEnd = Math.min(doc.lineCount - 1, selection.end.line + contextLines);
      const beforeCtx = doc.getText(new vscode.Range(beforeStart, 0, selection.start.line, 0));
      const afterCtx = doc.getText(
        new vscode.Range(selection.end.line + 1, 0, afterEnd + 1, 0)
      );

      const prompt =
        `You are an expert code editor. Apply ONLY this instruction to the selected code:\n` +
        `Instruction: "${instruction}"\n\n` +
        `File: ${vscode.workspace.asRelativePath(doc.uri)}\n` +
        `Language: ${doc.languageId}\n\n` +
        (beforeCtx
          ? `Context before:\n\`\`\`${doc.languageId}\n${beforeCtx}\n\`\`\`\n\n`
          : "") +
        `Selected code to edit:\n\`\`\`${doc.languageId}\n${selectedText}\n\`\`\`\n\n` +
        (afterCtx
          ? `Context after:\n\`\`\`${doc.languageId}\n${afterCtx}\n\`\`\`\n\n`
          : "") +
        `Return ONLY the edited replacement for the selected code (no explanations, ` +
        `no surrounding context). Preserve indentation. Wrap in a code fence.`;

      // Progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "AIPiloty: Generating edit…",
          cancellable: true,
        },
        async (progress, token) => {
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());

          let fullResponse = "";

          try {
            await streamChat(backendUrl, keychain, {
              messages: [{ role: "user", content: prompt }],
              mode: "ask",
              autoApprove: true,
              signal: abort.signal,
              onEvent: (event: SSEEvent) => {
                if (event.type === "token" && event.data["token"]) {
                  fullResponse += event.data["token"] as string;
                  progress.report({ message: `${fullResponse.length} chars…` });
                }
              },
            });
          } catch (err: unknown) {
            if (err instanceof Error && err.message === "Aborted") return;
            throw err;
          }

          if (!fullResponse.trim()) {
            vscode.window.showWarningMessage("AIPiloty returned an empty edit");
            return;
          }

          // Extract code from response
          const editedCode = extractCodeBlock(fullResponse, doc.languageId) ?? fullResponse.trim();

          // Apply the edit
          await applyInlineEdit(editor, selection, selectedText, editedCode, doc.languageId);
        }
      );
    })
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCodeBlock(text: string, language: string): string | null {
  // Try ```<lang> ... ```
  const fenced = new RegExp(
    "```(?:" + language + "|[a-zA-Z0-9_+-]*)\\s*\\n([\\s\\S]*?)\\n```",
    "i"
  );
  const m = text.match(fenced);
  if (m) return m[1];

  // Try bare ``` ... ```
  const bare = text.match(/```\s*\n([\s\S]*?)\n```/);
  if (bare) return bare[1];

  return null;
}

async function applyInlineEdit(
  editor: vscode.TextEditor,
  selection: vscode.Selection,
  original: string,
  edited: string,
  language: string,
): Promise<void> {
  // Show a quick-pick to accept or review
  const choice = await vscode.window.showInformationMessage(
    "AIPiloty generated an edit. Apply it?",
    { modal: false },
    "Apply",
    "Preview Diff",
    "Discard",
  );

  if (choice === "Discard" || !choice) return;

  if (choice === "Preview Diff") {
    await previewDiff(editor.document.uri, original, edited, language);
    // After preview, ask again
    const confirm = await vscode.window.showInformationMessage(
      "Apply the edit?",
      "Apply",
      "Discard"
    );
    if (confirm !== "Apply") return;
  }

  // Apply as a workspace edit
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(editor.document.uri, selection, edited);
  await vscode.workspace.applyEdit(workspaceEdit);

  // Select the applied region for visibility
  const lines = edited.split("\n");
  const newEnd = new vscode.Position(
    selection.start.line + lines.length - 1,
    lines.length === 1
      ? selection.start.character + edited.length
      : lines[lines.length - 1].length
  );
  editor.selection = new vscode.Selection(selection.start, newEnd);
}

async function previewDiff(
  docUri: vscode.Uri,
  original: string,
  edited: string,
  language: string,
): Promise<void> {
  // Create a temporary untitled document with the edited content
  const originalDoc = await vscode.workspace.openTextDocument({
    content: original,
    language,
  });
  const editedDoc = await vscode.workspace.openTextDocument({
    content: edited,
    language,
  });
  await vscode.commands.executeCommand(
    "vscode.diff",
    originalDoc.uri,
    editedDoc.uri,
    "AIPiloty: Original ↔ Edited",
    { preview: true }
  );
}
