// Minimal markdown renderer that specifically handles ```mermaid ... ``` fences
// by piping them through mermaid.render() for SVG output. Other fenced code
// blocks are rendered as <pre><code>. Plain paragraphs, inline `code`, and
// bold/italic are rendered with a tiny parser — enough for chat bubbles and
// revision notes without pulling in a heavy markdown library.

import { useEffect, useMemo, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  fontFamily: 'Inter, system-ui, sans-serif',
});

interface Block {
  kind: 'text' | 'code' | 'mermaid';
  lang?: string;
  content: string;
}

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let buf: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceBuf: string[] = [];

  const flushText = () => {
    if (buf.length) {
      blocks.push({ kind: 'text', content: buf.join('\n') });
      buf = [];
    }
  };

  for (const line of lines) {
    // Allow leading whitespace so indented fences (inside numbered lists) are detected.
    const fenceMatch = line.match(/^\s*```(\w*)\s*$/);
    if (fenceMatch) {
      if (!inFence) {
        flushText();
        inFence = true;
        fenceLang = fenceMatch[1] || '';
        fenceBuf = [];
      } else {
        // Strip common leading whitespace from fence content so mermaid/code renders cleanly.
        const strippedContent = fenceBuf
          .map((l) => l.replace(/^\s{0,4}/, ''))
          .join('\n');
        blocks.push({
          kind: fenceLang === 'mermaid' ? 'mermaid' : 'code',
          lang: fenceLang,
          content: strippedContent,
        });
        inFence = false;
        fenceLang = '';
        fenceBuf = [];
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
    } else {
      buf.push(line);
    }
  }
  if (inFence) {
    // unterminated fence — treat as code
    blocks.push({ kind: 'code', lang: fenceLang, content: fenceBuf.join('\n') });
  }
  flushText();
  return blocks;
}

function renderInline(text: string): string {
  // Escape, then reintroduce specific markdown
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+?)`/g, '<code class="bg-slate-100 px-1 rounded text-sm">$1</code>');
  // Basic heading support: lines starting with # / ## / ###
  return html;
}

function TextBlock({ content }: { content: string }) {
  // Split into paragraphs, handle simple headings and lists.
  const pieces: JSX.Element[] = [];
  const paragraphs = content.split(/\n{2,}/);
  paragraphs.forEach((p, i) => {
    const trimmed = p.trim();
    if (!trimmed) return;
    // Use /m flag so ^ and $ match start/end of each line (handles headings not alone in a paragraph).
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/m);
    if (headingMatch && trimmed.startsWith('#')) {
      const level = headingMatch[1].length;
      const Tag = (`h${level + 2}`) as 'h3' | 'h4' | 'h5';
      pieces.push(
        <Tag
          key={i}
          className={
            level === 1
              ? 'text-lg font-semibold mt-3 mb-1'
              : level === 2
                ? 'text-base font-semibold mt-3 mb-1'
                : 'text-sm font-semibold mt-2 mb-1'
          }
          dangerouslySetInnerHTML={{ __html: renderInline(headingMatch[2]) }}
        />,
      );
      return;
    }
    const lines = trimmed.split('\n');
    // Numbered list? (all lines start with a digit + dot)
    if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
      pieces.push(
        <ol key={i} className="list-decimal ml-5 my-2 space-y-1">
          {lines.map((l, j) => (
            <li
              key={j}
              dangerouslySetInnerHTML={{
                __html: renderInline(l.replace(/^\s*\d+\.\s+/, '')),
              }}
            />
          ))}
        </ol>,
      );
      return;
    }
    // Bullet list?
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      pieces.push(
        <ul key={i} className="list-disc ml-5 my-2 space-y-1">
          {lines.map((l, j) => (
            <li
              key={j}
              dangerouslySetInnerHTML={{
                __html: renderInline(l.replace(/^\s*[-*]\s+/, '')),
              }}
            />
          ))}
        </ul>,
      );
      return;
    }
    pieces.push(
      <p
        key={i}
        className="my-2 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderInline(trimmed) }}
      />,
    );
  });
  return <>{pieces}</>;
}

function MermaidBlock({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useMemo(() => `mm-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!ref.current) return;
      try {
        const { svg } = await mermaid.render(id, content);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e: any) {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre class="text-red-600 text-sm whitespace-pre-wrap">Mermaid error: ${String(e?.message || e)}\n\n${content}</pre>`;
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [content, id]);

  return <div className="mermaid-block my-3 flex justify-center" ref={ref} />;
}

function CodeBlock({ lang, content }: { lang?: string; content: string }) {
  return (
    <pre className="my-2 rounded bg-slate-100 text-slate-800 border border-slate-200 p-3 overflow-x-auto text-sm">
      <code>
        {lang ? <span className="text-slate-400 text-xs block mb-1">{lang}</span> : null}
        {content}
      </code>
    </pre>
  );
}

export function MarkdownWithMermaid({ source }: { source: string }) {
  const blocks = useMemo(() => parseBlocks(source), [source]);
  return (
    <div className="markdown-body">
      {blocks.map((b, i) => {
        if (b.kind === 'mermaid') return <MermaidBlock key={i} content={b.content} />;
        if (b.kind === 'code') return <CodeBlock key={i} lang={b.lang} content={b.content} />;
        return <TextBlock key={i} content={b.content} />;
      })}
    </div>
  );
}
