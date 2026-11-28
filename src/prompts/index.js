'use strict';
// Model prompts and agent instructions live beside this file as Markdown
// templates (one per prompt, grouped by area). {{name}} marks a value the code
// fills in; everything else is sent exactly as written. The file's final
// newline is not part of the prompt.
const fs = require('node:fs');
const path = require('node:path');

const cache = new Map();
function text(name) {
  let value = cache.get(name);
  if (value === undefined) {
    value = fs.readFileSync(path.join(__dirname, name + '.md'), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
    cache.set(name, value);
  }
  return value;
}
// Values are inserted as given (never re-scanned), so data cannot add placeholders.
function fill(template, values, label) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) throw new Error('Prompt ' + label + ' needs a value for {{' + key + '}}.');
    return String(values[key]);
  });
}
function render(name, values = {}) { return fill(text(name), values, name); }
// JSON data files (for example tool descriptions) stored with the prompts.
function data(name) {
  const key = name + '.json';
  if (!cache.has(key)) cache.set(key, JSON.parse(fs.readFileSync(path.join(__dirname, key), 'utf8')));
  return cache.get(key);
}

// Tool descriptions for one MCP tool list: describe(tool, values) gives one.
function descriptions(name) {
  return (tool, values = {}) => {
    const value = data(name)[tool];
    if (typeof value !== 'string') throw new Error('No description for tool ' + tool + ' in ' + name + '.json.');
    return fill(value, values, name + ':' + tool);
  };
}

module.exports = { text, render, data, descriptions };
