const KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const BUILTINS = new Set('abs all any bool dict enumerate float int len list max min open print range set str sum super tuple zip'.split(' '));

// One token list per line. Kinds: comment, string, number, keyword, name, call, builtin.
export function highlightSource(text, language) {
  if (language === 'python') return highlightPython(text);
  if (language === 'md' || language === 'markdown') return highlightMarkdown(text);
  return String(text).split('\n').map(line => [{ text: line.length ? line : ' ' }]);
}

function highlightPython(source) {
  const lines = [];
  let current = [];
  let i = 0;
  let expectName = false;
  const flush = () => {
    lines.push(current.length ? current : [{ text: ' ' }]);
    current = [];
  };
  const add = (chunk, kind) => {
    if (!chunk) return;
    const last = current[current.length - 1];
    if (last && last.kind === kind) last.text += chunk;
    else current.push(kind ? { text: chunk, kind } : { text: chunk });
  };

  while (i < source.length) {
    if (source[i] === '\n') { flush(); i++; continue; }
    if (source[i] === '#') {
      let j = i + 1;
      while (j < source.length && source[j] !== '\n') j++;
      add(source.slice(i, j), 'comment');
      i = j;
      expectName = false;
      continue;
    }
    const string = source.slice(i).match(/^(?:[rRuUbBfF]{1,3})?(?:'''|"""|'|")/);
    if (string && (string[0].endsWith("'") || string[0].endsWith('"'))) {
      const opener = string[0];
      const quote = opener.endsWith("'''") || opener.endsWith('"""') ? opener.slice(-3) : opener.slice(-1);
      let j = i + opener.length;
      while (j < source.length && !source.startsWith(quote, j)) {
        if (quote.length === 1 && source[j] === '\\') { j += 2; continue; }
        if (source[j] === '\n' && quote.length === 1) break;
        j++;
      }
      if (source.startsWith(quote, j)) j += quote.length;
      addAcross(source.slice(i, j), 'string', add, flush);
      i = j;
      expectName = false;
      continue;
    }
    if (source[i] === '@') {
      const name = source.slice(i + 1).match(/^[\w.]+/);
      const chunk = '@' + (name ? name[0] : '');
      add(chunk, 'decorator');
      i += chunk.length;
      expectName = false;
      continue;
    }
    const number = source.slice(i).match(/^(?:\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*)/);
    if (number && (i === 0 || !/[\w.]/.test(source[i - 1]))) {
      add(number[0], 'number');
      i += number[0].length;
      expectName = false;
      continue;
    }
    const word = source.slice(i).match(/^[A-Za-z_][\w]*/);
    if (word) {
      const text = word[0];
      let kind = '';
      if (expectName) kind = 'name';
      else if (KEYWORDS.has(text)) kind = 'keyword';
      else if (BUILTINS.has(text)) kind = 'builtin';
      else if (source[i + text.length] === '(') kind = 'call';
      add(text, kind);
      expectName = text === 'def' || text === 'class';
      i += text.length;
      continue;
    }
    add(source[i], '');
    if (!/\s/.test(source[i])) expectName = false;
    i++;
  }
  if (current.length || !lines.length) flush();
  return lines;
}

function addAcross(chunk, kind, add, flush) {
  const parts = chunk.split('\n');
  parts.forEach((part, index) => {
    if (index) flush();
    add(part, kind);
  });
}

function highlightMarkdown(source) {
  return source.split('\n').map(line => {
    if (!line) return [{ text: ' ' }];
    if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: 'keyword' }];
    if (/^```/.test(line)) return [{ text: line, kind: 'comment' }];
    if (/^\s*[-*]\s/.test(line)) return [{ text: line.slice(0, line.indexOf(' ') + 1), kind: 'number' }, { text: line.slice(line.indexOf(' ') + 1) }];
    return [{ text: line }];
  });
}
