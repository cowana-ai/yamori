'use strict';

function estimatorFor(provider, model = '') {
  const name = model.toLowerCase();
  if (/gpt-4-0314|gpt-4-0613|gpt-3\.5/.test(name)) return { word: 4.9, space: 4, symbols: 2.2 };
  if (provider === 'codex' || /gpt-5|gpt-6/.test(name)) return { word: 5.5, space: 4, symbols: 2.4 };
  if (provider === 'claude') return { word: 5, space: 4, symbols: 2 };
  return { word: 4.8, space: 3, symbols: 2 };
}

// Estimate locally without sending source to a counting endpoint. Tokenizers
// split prose, identifiers, punctuation and Unicode at different rates.
function estimateTokens(text, provider, model) {
  const profile = estimatorFor(provider, model);
  let tokens = 0;
  for (const part of text.matchAll(/[A-Za-z]+|\d+|[ \t]+|\r?\n|[^\u0000-\u007F]|[^\w\s]+|./gu)) {
    const value = part[0], first = value[0];
    if (first === ' ' || first === '\t') {
      if (value.length > 1 || first === '\t') tokens += Math.ceil(value.length / profile.space);
    } else if (/^[A-Za-z]/.test(value)) {
      tokens += Math.max(1, Math.ceil(value.length / profile.word));
    } else if (/^\d/.test(value)) {
      tokens += Math.ceil(value.length / 3);
    } else if (/[^\u0000-\u007F]/.test(value)) {
      tokens += Math.ceil(Buffer.byteLength(value) / 2);
    } else {
      tokens += Math.ceil(value.length / profile.symbols);
    }
  }
  return tokens;
}

function inputComparison(code, blocks, provider, model) {
  const source = { kind: 'code', text: code };
  const pseudo = blocks?.length ? { kind: 'pseudocode', blocks } : undefined;
  const sourceTokens = estimateTokens(JSON.stringify(source), provider, model);
  const pseudoTokens = pseudo && estimateTokens(JSON.stringify(pseudo), provider, model);
  return {
    sourceTokens, pseudoTokens,
    input: pseudoTokens !== undefined && pseudoTokens < sourceTokens ? pseudo : source
  };
}

function isReadingQuestion(instruction) {
  const text = instruction.trim();
  if (/\b(?:and|then|also)\s+(?:please\s+)?(?:change|edit|implement|add|fix|remove|rename|rewrite|refactor|update|write)\b/i.test(text)) return false;
  return /^(?:(?:please\s+)?(?:explain|describe|summari[sz]e|walk me through|help me understand)\b|(?:how|what|why|where|when|which|who)\b.*\?|(?:can|could|would) you\s+(?:explain|describe|summari[sz]e|walk me through)\b)/is.test(text);
}

module.exports = { estimateTokens, inputComparison, isReadingQuestion };
