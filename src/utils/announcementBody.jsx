import React from 'react';

/**
 * Renders announcement body text with [link text](url) converted to clickable links.
 * Escapes HTML for safety; only link syntax becomes <a> tags.
 */
export function AnnouncementBody({ body, className = '' }) {
  if (!body || typeof body !== 'string') return null;
  const parts = [];
  const re = /\[([^\]]*)\]\(([^)]*)\)/g;
  let lastIndex = 0;
  let m;
  const escape = (s) => {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  const allowProtocol = (url) => {
    const u = (url || '').trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('/');
  };
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(lastIndex, m.index);
    if (before) parts.push(<span key={parts.length} dangerouslySetInnerHTML={{ __html: escape(before).replace(/\n/g, '<br/>') }} />);
    const text = m[1] || m[2];
    const url = m[2];
    if (url && allowProtocol(url)) {
      parts.push(<a key={parts.length} href={url} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 underline hover:no-underline">{escape(text) || url}</a>);
    } else {
      parts.push(<span key={parts.length}>{escape(text)}</span>);
    }
    lastIndex = m.index + m[0].length;
  }
  const tail = body.slice(lastIndex);
  if (tail) parts.push(<span key={parts.length} dangerouslySetInnerHTML={{ __html: escape(tail).replace(/\n/g, '<br/>') }} />);
  if (parts.length === 0) return null;
  return <span className={className}>{parts.map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)}</span>;
}
