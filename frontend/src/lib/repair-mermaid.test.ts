import { describe, it, expect } from "vitest";
import {
  extractMarkdownPipeTable,
  looksLikeMarkdownPipeTable,
  mermaidRenderCandidates,
  pickPreferredMermaidSource,
  salvageAsFlowchart,
  salvageAsPie,
  salvageAsXyChart,
  unwrapMermaidPipeTablesInMarkdown,
} from "@/lib/repair-mermaid";

const PIPE_TABLE = `| Model | Speed | Quality |
|---|---|---|
| gpt-image-1 | Fast | High |
| Gemini Flash Image | Very fast | Good |
| DALL·E 3 | Medium | Excellent |`;

describe("looksLikeMarkdownPipeTable", () => {
  it("detects a classic GFM pipe table", () => {
    expect(looksLikeMarkdownPipeTable(PIPE_TABLE)).toBe(true);
  });

  it("detects a pipe table even if flowchart TD was prepended", () => {
    expect(
      looksLikeMarkdownPipeTable(`flowchart TD\n${PIPE_TABLE}`),
    ).toBe(true);
  });

  it("returns false for real Mermaid flowcharts", () => {
    expect(
      looksLikeMarkdownPipeTable("flowchart TD\n  A-->B\n  B-->C"),
    ).toBe(false);
  });

  it("returns false for pie charts", () => {
    expect(
      looksLikeMarkdownPipeTable('pie showData\n  "Coding" : 40'),
    ).toBe(false);
  });
});

describe("pipe table must never become flowchart TD", () => {
  it("salvageAsFlowchart does not prepend flowchart TD to pipe tables", () => {
    const out = salvageAsFlowchart(PIPE_TABLE);
    expect(out).not.toMatch(/^flowchart/i);
    expect(out).toContain("| Model |");
    expect(out).toContain("|---|");
  });

  it("pickPreferredMermaidSource does not invent flowchart TD", () => {
    const out = pickPreferredMermaidSource(PIPE_TABLE);
    expect(out).not.toMatch(/flowchart\s+TD/i);
    expect(out).toContain("| Model | Speed |");
  });

  it("mermaidRenderCandidates stays as table body only", () => {
    const cands = mermaidRenderCandidates(PIPE_TABLE);
    expect(cands.length).toBe(1);
    expect(cands[0]).not.toMatch(/flowchart/i);
    expect(cands[0]).toContain("| gpt-image-1 |");
  });

  it("extractMarkdownPipeTable strips junk flowchart header", () => {
    const out = extractMarkdownPipeTable(`flowchart TD\n${PIPE_TABLE}`);
    expect(out.startsWith("| Model |")).toBe(true);
    expect(out).not.toMatch(/flowchart/i);
  });

  it("unwrapMermaidPipeTablesInMarkdown removes the fence", () => {
    const md = `Here is a comparison:\n\n\`\`\`mermaid\n${PIPE_TABLE}\n\`\`\`\n\n### Quick takeaways\n- Prefer Flash for speed.`;
    const out = unwrapMermaidPipeTablesInMarkdown(md);
    expect(out).not.toMatch(/```mermaid/i);
    expect(out).toContain("| Model | Speed | Quality |");
    expect(out).toContain("Quick takeaways");
  });

  it("unwrap leaves real mermaid diagrams alone", () => {
    const md = "```mermaid\nflowchart TD\n  A-->B\n```";
    expect(unwrapMermaidPipeTablesInMarkdown(md)).toBe(md);
  });
});

describe("existing pie/xy salvage still works", () => {
  it("salvages pie with %", () => {
    const out = salvageAsPie("pie\n  Coding : 40%\n  Meetings : 25%");
    expect(out).toContain('"Coding" : 40');
    expect(out).not.toContain("%");
  });

  it("salvages broken xychart", () => {
    const out = salvageAsXyChart(
      'xychart-beta\n  title Monthly Deploys\n  xaxis label "Month"\n  yaxis label "Deployments"\n  bar Jan: 1\n  bar Feb: 2',
    );
    expect(out).toContain("xychart-beta");
    expect(out).toContain("x-axis");
    expect(out).toContain("bar [1, 2]");
  });
});
