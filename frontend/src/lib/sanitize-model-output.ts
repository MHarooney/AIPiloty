/**
 * Strip leaked ChatML / tool-call control tokens some models print in plain text
 * (e.g. <|tool_calls_begin|>, <|tool_sep|>) so the UI stays readable.
 */
export function stripModelControlTokens(text: string): string {
  if (!text) return text;
  return (
    text
      // <| ... |> style (common in DeepSeek / Qwen style)
      .replace(/<\|[^|]*\|>/g, "")
      // stray fragments
      .replace(/<\|[^>\n]{0,120}/g, "")
      .replace(/\|>/g, "")
      // collapse excessive blank lines left behind
      .replace(/\n{4,}/g, "\n\n\n")
      .trim()
  );
}
