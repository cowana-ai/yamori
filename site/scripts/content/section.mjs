// Build one Yamori section. Line numbers count every line of the pseudocode
// string, including blanks. Each nonblank line gets one source link.

// `aside` is site-only blog copy. It is stripped before the explanation JSON
// is written, because Yamori's schema does not allow extra section fields.
export function section(title, startLine, endLine, rows, aside) {
  const lines = [];
  const lineMap = [];
  for (const row of rows) {
    if (row === '') { lines.push(''); continue; }
    const text = typeof row === 'string' ? row : row.text;
    const start = typeof row === 'string' ? startLine : row.start;
    const end = typeof row === 'string' ? endLine : row.end;
    lines.push(text);
    if (String(text).trim()) lineMap.push({ pseudocodeLine: lines.length, startLine: start, endLine: end });
  }
  return { title, startLine, endLine, pseudocode: lines.join('\n'), lineMap, ...(aside ? { aside } : {}) };
}

export function view(title, summary, sections) {
  return { title, summary, sections };
}
