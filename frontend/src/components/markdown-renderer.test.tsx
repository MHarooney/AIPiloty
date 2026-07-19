import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MarkdownRenderer from "@/components/markdown-renderer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/stores/editor-store", () => ({
  useEditorStore: (sel: (s: { setPendingCode: () => void }) => unknown) =>
    sel({ setPendingCode: vi.fn() }),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      isStreaming: false,
      sendQuickPrompt: vi.fn(),
      retryLastMessage: vi.fn(),
    }),
}));

vi.mock("mermaid", () => {
  const isBroken = (source: string) =>
    source.includes("BROKEN") ||
    /style\s+\S+\s+-->/.test(source) ||
    /:\s*[\d.]+\s*%/.test(source) ||
    /\bxaxis\b/i.test(source) ||
    /\byaxis\b/i.test(source) ||
    /^\s*bar\s+\S+:\s*[\d.]+/m.test(source);

  const render = vi.fn(async (_id: string, source: string) => {
    if (isBroken(source)) throw new Error("Parse error");
    return {
      svg: `<svg data-testid="mermaid-svg"><text>${source.slice(0, 40)}</text></svg>`,
    };
  });
  return {
    default: {
      initialize: vi.fn(),
      render,
      parse: vi.fn(async (source: string) => {
        if (isBroken(source)) throw new Error("Parse error");
      }),
    },
  };
});

describe("MarkdownRenderer rich visuals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a GFM table", () => {
    const md = `
| Model | Speed |
|---|---|
| Fast | High |
| Slow | Low |
`;
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("unwraps mermaid fence containing a pipe table into an HTML table", () => {
    const md = `\`\`\`mermaid
| Model | Speed | Quality | Best For | Notes |
|---|---|---|---|---|
| gpt-image-1 | Fast | High | Product shots | Strong prompt adherence |
| Gemini Flash Image | Very fast | Good | Drafts | Low latency |
| DALL·E 3 | Medium | Excellent | Creative art | Mature ecosystem |
\`\`\`

### Quick takeaways
- Prefer Flash when speed matters.`;
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("gpt-image-1")).toBeInTheDocument();
    expect(screen.getByText("Gemini Flash Image")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    // Must NOT go through MermaidBlock error UI
    expect(screen.queryByText(/Could not render this diagram/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Diagram")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mermaid-svg")).not.toBeInTheDocument();
  });

  it("unwraps mermaid fence even when salvage junk flowchart TD is present", () => {
    const md = `\`\`\`mermaid
flowchart TD
| Model | Speed |
|---|---|
| A | Fast |
| B | Slow |
\`\`\``;
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.queryByText(/Could not render/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mermaid-svg")).not.toBeInTheDocument();
  });

  it("unwraps ```markdown fence and renders HTML table", () => {
    const md = `\`\`\`markdown
| Model | Speed |
|---|---|
| gpt-image-1 | Fast |
| DALL·E 3 | Medium |
\`\`\`

### Quick takeaways
- Prefer Flash for drafts.`;
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("gpt-image-1")).toBeInTheDocument();
    expect(screen.getByText("Quick takeaways")).toBeInTheDocument();
  });

  it("repairs vertical one-cell-per-line pipe tables into HTML table", () => {
    const md = `|
| Model
|
| Speed
|
| ---
|
| A
|
| Fast
|
| B
|
| Slow
`;
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Fast")).toBeInTheDocument();
    expect(screen.getByText("Slow")).toBeInTheDocument();
  });

  it("inserts missing GFM separator so header+rows render as table", () => {
    const md = `| Model | Speed | Quality |
| gpt-image-1 | Fast | High |
| DALL·E 3 | Medium | Excellent |`;
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("gpt-image-1")).toBeInTheDocument();
  });

  it("renders Mermaid when not streaming", async () => {
    const md = "```mermaid\nflowchart TD\n  A-->B\n```";
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });
    expect(screen.getByText("Diagram")).toBeInTheDocument();
  });

  it("auto-repairs invalid style→edge Mermaid and still renders", async () => {
    const md =
      "```mermaid\nflowchart TD\n  style Containers --> Docker\n  Docker --> K8s\n```";
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });
    // Preferred source is salvaged before render — silent success (no error UI)
    expect(screen.queryByText(/Could not render/i)).not.toBeInTheDocument();
  });

  it("auto-repairs pie charts with % before render", async () => {
    const md = "```mermaid\npie\n  Coding : 40%\n  Meetings : 25%\n```";
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Could not render/i)).not.toBeInTheDocument();
  });

  it("auto-repairs xychart-beta before render", async () => {
    const md =
      "```mermaid\nxychart-beta\n  title Monthly Deploys\n  xaxis label \"Month\"\n  yaxis label \"Deployments\"\n  bar Jan: 1\n  bar Feb: 2\n```";
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Could not render/i)).not.toBeInTheDocument();
  });

  it("defers Mermaid SVG while streaming", async () => {
    const md = "```mermaid\nflowchart TD\n  A-->B\n```";
    render(<MarkdownRenderer content={md} isStreaming />);
    expect(screen.getByText(/streaming/i)).toBeInTheDocument();
    expect(screen.queryByTestId("mermaid-svg")).not.toBeInTheDocument();
  });

  it("shows fallback with Fix/Retry when Mermaid is invalid", async () => {
    const md = "```mermaid\nBROKEN diagram\n```";
    render(<MarkdownRenderer content={md} isStreaming={false} />);
    await waitFor(() => {
      expect(screen.getByText(/Could not render this diagram/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Fix diagram/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry reply/i })).toBeInTheDocument();
  });

  it("renders math fence via KaTeX", () => {
    const md = "```math\nE = mc^2\n```";
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector(".katex-display, .katex")).toBeTruthy();
  });

  it("renders inline and display math dollars", () => {
    const md = "Energy is $E=mc^2$ and in display:\n\n$$\\int_0^1 x dx$$\n";
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector(".katex")).toBeTruthy();
  });
});
