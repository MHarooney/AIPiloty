"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, FileCode, Sigma } from "lucide-react";
import {
  useMemo,
  useState,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
  Children,
} from "react";
import { useRouter } from "next/navigation";
import katex from "katex";
import { stripModelControlTokens } from "@/lib/sanitize-model-output";
import {
  looksLikeMarkdownPipeTable,
  pickPreferredMermaidSource,
} from "@/lib/repair-mermaid";
import { normalizeChatMarkdown } from "@/lib/normalize-chat-markdown";
import { useEditorStore } from "@/stores/editor-store";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

const MermaidBlock = dynamic(() => import("./mermaid-block"), {
  ssr: false,
  loading: () => (
    <div className="my-3 h-24 animate-pulse rounded-xl border border-indigo-500/20 bg-indigo-950/20" />
  ),
});

/** Highlight ★☆ like ChatGPT comparison score cells. */
function renderWithStarAccent(node: ReactNode): ReactNode {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node);
    if (!/[★☆]/.test(text)) return node;
    return text.split(/([★☆]+)/).map((part, i) =>
      /[★☆]/.test(part) ? (
        <span key={i} className="text-amber-300 tracking-tight">
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  }
  if (Array.isArray(node)) {
    return Children.map(node, (child, i) => (
      <span key={i}>{renderWithStarAccent(child)}</span>
    ));
  }
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children != null) {
    return cloneElement(
      node as ReactElement<{ children?: ReactNode }>,
      undefined,
      renderWithStarAccent(node.props.children),
    );
  }
  return node;
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const setPendingCode = useEditorStore((s) => s.setPendingCode);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = () => {
    setPendingCode({ language: language || "plaintext", content: children });
    router.push("/code-editor");
  };

  return (
    <div className="relative group my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-t-lg border border-b-0 border-gray-700">
        <span className="text-xs text-gray-500 font-mono">{language || "text"}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleApply}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-400 transition-colors"
            title="Open in editor"
          >
            <FileCode size={12} />
            Apply
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          borderBottomLeftRadius: "0.5rem",
          borderBottomRightRadius: "0.5rem",
          border: "1px solid #374151",
          borderTop: "none",
          fontSize: "0.8rem",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}

function MathBlock({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => {
    try {
      return katex.renderToString(source.trim(), {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      return "";
    }
  }, [source]);

  return (
    <div
      data-testid="math-block"
      className="my-3 mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950 shadow-md shadow-violet-950/30"
    >
      <div className="flex items-center justify-between border-b border-violet-500/20 bg-violet-950/30 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-violet-200">
          <Sigma className="h-3.5 w-3.5" />
          Formula
        </span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(source.trim());
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className="overflow-x-auto px-4 py-4 text-center text-gray-100 [&_.katex]:text-base sm:[&_.katex]:text-lg"
        dangerouslySetInnerHTML={{ __html: html || `<code>${source}</code>` }}
      />
    </div>
  );
}

export interface MarkdownRendererProps {
  content: string;
  /** Defer Mermaid SVG until the message finishes streaming. */
  isStreaming?: boolean;
}

export default function MarkdownRenderer({
  content,
  isStreaming = false,
}: MarkdownRendererProps) {
  const safe = useMemo(
    () => normalizeChatMarkdown(stripModelControlTokens(content)),
    [content],
  );
  if (!safe.trim()) {
    return null;
  }
  return (
    <div
      className={cn(
        "prose prose-invert max-w-none text-sm leading-relaxed overflow-hidden break-words",
        // rehype-katex emits .katex-display for ```math / $$...$$ — style like a formula card
        "[&_.katex-display]:my-3 [&_.katex-display]:mx-auto [&_.katex-display]:w-fit [&_.katex-display]:max-w-full [&_.katex-display]:overflow-x-auto [&_.katex-display]:rounded-xl",
        "[&_.katex-display]:border [&_.katex-display]:border-violet-500/25",
        "[&_.katex-display]:bg-gradient-to-br [&_.katex-display]:from-slate-950 [&_.katex-display]:via-violet-950/30 [&_.katex-display]:to-slate-950",
        "[&_.katex-display]:px-4 [&_.katex-display]:py-4 [&_.katex-display]:shadow-md [&_.katex-display]:shadow-violet-950/30",
        "[&_.katex]:text-gray-100 [&_.katex-display_.katex]:text-base sm:[&_.katex-display_.katex]:text-lg",
        "[&_.katex-display]:text-center",
      )}
      style={{ overflowWrap: "anywhere" }}
      data-testid="markdown-renderer"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const lang = (match?.[1] || "").toLowerCase();
            const codeString = String(children).replace(/\n$/, "");

            if (lang === "mermaid") {
              // Belt-and-suspenders: mis-labeled pipe tables → plain code/table text
              // (preprocess should already unwrap; this avoids MermaidBlock errors)
              if (looksLikeMarkdownPipeTable(codeString)) {
                return (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {codeString}
                  </ReactMarkdown>
                );
              }
              return (
                <MermaidBlock
                  source={pickPreferredMermaidSource(codeString)}
                  deferRender={isStreaming}
                />
              );
            }
            if (lang === "math" || lang === "latex" || lang === "tex") {
              return <MathBlock source={codeString} />;
            }
            if (match) {
              return <CodeBlock language={match[1]}>{codeString}</CodeBlock>;
            }
            return (
              <code
                className="bg-gray-700/50 px-1.5 py-0.5 rounded text-indigo-300 text-[0.8rem]"
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 underline"
              >
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="my-3 w-full max-w-full overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-b from-slate-950/80 to-gray-950/60 shadow-lg shadow-black/30">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-[13px] leading-snug">
                    {children}
                  </table>
                </div>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="sticky top-0 z-[1] bg-gray-900/95 backdrop-blur-sm">
                {children}
              </thead>
            );
          },
          th({ children }) {
            return (
              <th className="whitespace-nowrap border-b border-indigo-400/25 bg-indigo-950/50 px-3.5 py-2.5 text-left text-[11px] font-semibold tracking-wide text-indigo-100 first:min-w-[7.5rem]">
                {children}
              </th>
            );
          },
          tr({ children, ...props }) {
            return (
              <tr
                className="even:bg-white/[0.03] odd:bg-transparent hover:bg-indigo-500/[0.07] transition-colors"
                {...props}
              >
                {children}
              </tr>
            );
          },
          td({ children }) {
            return (
              <td
                className={cn(
                  "border-b border-gray-800/50 px-3.5 py-2.5 text-[13px] text-gray-200 align-top",
                  "max-w-[18rem] whitespace-normal break-words",
                  "first:min-w-[7.5rem] first:max-w-[10rem] first:font-medium first:text-indigo-100/95 first:whitespace-nowrap",
                )}
              >
                {renderWithStarAccent(children)}
              </td>
            );
          },
          pre({ children }) {
            // Mermaid/Math already wrap themselves — avoid double <pre> chrome
            return <div className="overflow-x-auto my-0">{children}</div>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="my-2 border-l-2 border-indigo-500/50 bg-indigo-950/20 py-1 pl-3 pr-2 text-gray-300 not-italic rounded-r-lg">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}
