"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, FileCode } from "lucide-react";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { stripModelControlTokens } from "@/lib/sanitize-model-output";
import { useEditorStore } from "@/stores/editor-store";

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

export default function MarkdownRenderer({ content }: { content: string }) {
  const safe = useMemo(() => stripModelControlTokens(content), [content]);
  if (!safe.trim()) {
    return null;
  }
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed overflow-hidden break-words" style={{ overflowWrap: "anywhere" }}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const codeString = String(children).replace(/\n$/, "");
          if (match) {
            return <CodeBlock language={match[1]}>{codeString}</CodeBlock>;
          }
          return (
            <code className="bg-gray-700/50 px-1.5 py-0.5 rounded text-indigo-300 text-[0.8rem]" {...props}>
              {children}
            </code>
          );
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">
              {children}
            </a>
          );
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto -mx-2 my-2">
              <table className="min-w-full text-xs border-collapse">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-700/50 whitespace-nowrap">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="px-2 py-1 text-xs text-gray-300 border-b border-gray-800/30 whitespace-nowrap">
              {children}
            </td>
          );
        },
        pre({ children }) {
          return (
            <div className="overflow-x-auto">
              <pre className="text-xs">{children}</pre>
            </div>
          );
        },
      }}
    >
      {safe}
    </ReactMarkdown>
    </div>
  );
}
