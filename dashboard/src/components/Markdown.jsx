// Tiny, safe Markdown renderer for mission briefings. Emits REACT ELEMENTS,
// never an HTML string / dangerouslySetInnerHTML — so React escapes every text
// node and there is no stored-XSS surface. Supports the briefing essentials:
// # / ## / ### headings, - / * bullet lists, 1. ordered lists, --- rule,
// blank-line paragraphs, and inline **bold**, *italic*, `code`, [text](url).
// Links only render as anchors for http(s)/relative URLs; anything else is left
// as literal text.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
const safeHref = (u) => (/^(https?:\/\/|\/)/i.test(u) ? u : null);

function renderInline(text, keyBase) {
  const parts = String(text).split(INLINE);
  return parts.map((p, i) => {
    const k = `${keyBase}-${i}`;
    if (!p) return null;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={k}>{p.slice(1, -1)}</code>;
    if (p.startsWith('*') && p.endsWith('*')) return <em key={k}>{p.slice(1, -1)}</em>;
    if (p.startsWith('_') && p.endsWith('_')) return <em key={k}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeHref(link[2].trim());
      return href
        ? <a key={k} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a>
        : link[0]; // not a safe URL — show the raw markdown text
    }
    return p;
  });
}

export function Markdown({ text }) {
  const src = String(text || '');
  if (!src.trim()) return null;
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null; // { ordered, items: [] }
  const flushList = () => { if (list) { blocks.push(list); list = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(line.replace(/^\s*\d+\.\s+/, ''));
    } else if (/^###\s+/.test(line)) { flushList(); blocks.push({ h: 5, text: line.replace(/^###\s+/, '') }); }
    else if (/^##\s+/.test(line)) { flushList(); blocks.push({ h: 4, text: line.replace(/^##\s+/, '') }); }
    else if (/^#\s+/.test(line)) { flushList(); blocks.push({ h: 3, text: line.replace(/^#\s+/, '') }); }
    else if (/^---+\s*$/.test(line)) { flushList(); blocks.push({ hr: true }); }
    else if (!line.trim()) { flushList(); blocks.push({ br: true }); }
    else { flushList(); blocks.push({ p: line }); }
  }
  flushList();

  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (b.items) {
          const Tag = b.ordered ? 'ol' : 'ul';
          return <Tag key={i} style={{ margin: '4px 0 4px 18px' }}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${i}-${j}`)}</li>)}</Tag>;
        }
        if (b.h) { const H = `h${b.h}`; return <H key={i} style={{ margin: '10px 0 4px' }}>{renderInline(b.text, i)}</H>; }
        if (b.hr) return <hr key={i} style={{ border: 0, borderTop: '1px solid var(--border, #333)', margin: '10px 0' }} />;
        if (b.br) return null; // blank line — paragraph gap handled by <p> margins
        return <p key={i} style={{ margin: '4px 0' }}>{renderInline(b.p, i)}</p>;
      })}
    </div>
  );
}
