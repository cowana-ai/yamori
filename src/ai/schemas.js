'use strict';
// Models write each step link as a compact [pseudocodeLine, startLine, endLine]
// triple. As objects, line maps were 35–42% of every answer's text.
const STEP_LINK = { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 };
// Cached explanations store the readable object form; both are accepted.
const STORED_STEP_LINK = { type: 'object', additionalProperties: true, properties: { pseudocodeLine: { type: 'integer' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['pseudocodeLine', 'startLine', 'endLine'] };
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    sections: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, pseudocode: { type: 'string' }, lineMap: { type: 'array', items: STEP_LINK } },
      required: ['title', 'startLine', 'endLine', 'pseudocode', 'lineMap']
    } }
  }, required: ['title', 'summary', 'sections']
};
// The provider sends compact card records. Only canonical sections reach the cache.
const text = { type: 'string' }, integer = { type: 'integer' };
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const list = items => ({ type: 'array', items });
const legacySection = SCHEMA.properties.sections.items;
const wireCard = object({ p: text, i: text, r: text, x: text,
  s: list(text), c: list(text) });
const cardSection = object({ title: text, startLine: integer, endLine: integer, card: wireCard });
const WIRE_SCHEMA = { ...SCHEMA, properties: { ...SCHEMA.properties, sections: list({ anyOf: [legacySection, cardSection] }) } };
function wirePatchSections(indices, includeBounds = true, cardBlocks = []) {
  const forced = new Set(cardBlocks);
  const branches = WIRE_SCHEMA.properties.sections.items.anyOf.flatMap(section => {
    const properties = { ...section.properties };
    if (!includeBounds) { delete properties.startLine; delete properties.endLine; }
    const allowed = properties.card ? indices : indices.filter(index => !forced.has(index));
    return allowed.length ? [object({ index: { type: 'integer', enum: allowed }, ...properties })] : [];
  });
  return { type: 'array', minItems: indices.length, maxItems: indices.length, items: { anyOf: branches } };
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    score: { type: 'number', minimum: 0, maximum: 10 }, faithful: { type: 'boolean' },
    issues: { type: 'array', maxItems: 6, items: {
      type: 'object', additionalProperties: false,
      properties: { section: { type: 'integer', minimum: -1 }, view: { type: 'string', enum: ['main', 'overview', 'logic', 'detailed'] }, severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, problem: { type: 'string', minLength: 1, maxLength: 2000 }, suggestion: { type: 'string', maxLength: 2000 } },
      required: ['section', 'view', 'severity', 'problem', 'suggestion']
    } }
  }, required: ['score', 'faithful', 'issues']
};
const SELECTION_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  blocks: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer', minimum: 0 }, reason: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['index','reason'] } }
}, required: ['blocks'] };
// Project map notes: one compact card per file, with the project's vocabulary.
const NOTES_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  files: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string', minLength: 1, maxLength: 500 }, purpose: { type: 'string', minLength: 1, maxLength: 300 }, role: { type: 'string', maxLength: 80 },
    terms: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
      term: { type: 'string', minLength: 1, maxLength: 80 }, aliases: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 80 } },
      meaning: { type: 'string', minLength: 1, maxLength: 400 }, line: { type: 'integer', minimum: 1 }
    }, required: ['term', 'aliases', 'meaning', 'line'] } }
  }, required: ['file', 'purpose', 'role', 'terms'] } }
}, required: ['files'] };
const MAP_SUMMARY_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  overview: { type: 'string', minLength: 1, maxLength: 600 },
  clusters: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', minLength: 1, maxLength: 60 }, summary: { type: 'string', minLength: 1, maxLength: 300 }, files: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 500 } }
  }, required: ['name', 'summary', 'files'] } },
  readingPath: { type: 'array', minItems: 1, maxItems: 15, items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string', minLength: 1, maxLength: 500 }, why: { type: 'string', minLength: 1, maxLength: 200 }
  }, required: ['file', 'why'] } }
}, required: ['overview', 'clusters', 'readingPath'] };
// AI simulation of one function run, used when a real run is not possible.
const NAMED_VALUE = { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, value: { type: 'string', maxLength: 400 } }, required: ['name', 'value'] };
const SIMULATION_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  inputs: { type: 'array', maxItems: 20, items: NAMED_VALUE },
  steps: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, properties: {
    line: { type: 'integer', minimum: 1 }, note: { type: 'string', maxLength: 300 }, values: { type: 'array', maxItems: 8, items: NAMED_VALUE }
  }, required: ['line', 'note', 'values'] } },
  output: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['return', 'raises'] }, value: { type: 'string', maxLength: 600 } }, required: ['kind', 'value'] },
  caveats: { type: 'string', maxLength: 400 }
}, required: ['inputs', 'steps', 'output', 'caveats'] };
// How one name (a variable, function or term) moves through several files.
const FLOW_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  summary: { type: 'string', minLength: 1, maxLength: 900 },
  // Reading blocks like an explanation's sections, each in one searched file.
  sections: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string', minLength: 1, maxLength: 500 }, title: { type: 'string', minLength: 1, maxLength: 200 },
    startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 },
    pseudocode: { type: 'string', minLength: 1, maxLength: 4000 },
    lineMap: { type: 'array', maxItems: 60, items: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 3, maxItems: 3 } }
  }, required: ['file', 'title', 'startLine', 'endLine', 'pseudocode', 'lineMap'] } },
  caveats: { type: 'string', maxLength: 500 }
}, required: ['summary', 'sections', 'caveats'] };
// Planning mode: compact on purpose (a plan is drafted on a budget).
const PLAN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  question: { type: 'string', maxLength: 600 },
  summary: { type: 'string', maxLength: 400 },
  steps: { type: 'array', minItems: 0, maxItems: 12, items: { type: 'object', additionalProperties: false, properties: {
    file: { type: 'string', minLength: 1, maxLength: 500 }, lines: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 },
    title: { type: 'string', minLength: 1, maxLength: 120 }, change: { type: 'string', minLength: 1, maxLength: 400 }, why: { type: 'string', maxLength: 250 }
  }, required: ['file', 'lines', 'title', 'change', 'why'] } }
}, required: ['question', 'summary', 'steps'] };
const PATCH_FIELDS = { file: { type: 'string', minLength: 1, maxLength: 500 }, lines: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 }, title: { type: 'string', minLength: 1, maxLength: 120 }, change: { type: 'string', minLength: 1, maxLength: 400 }, why: { type: 'string', maxLength: 250 } };
const PLAN_PATCH_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  message: { type: 'string', maxLength: 1200 }, question: { type: 'string', maxLength: 600 }, summary: { type: 'string', maxLength: 400 },
  updates: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1, maxLength: 24 }, ...PATCH_FIELDS }, required: ['id', ...Object.keys(PATCH_FIELDS)] } },
  additions: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false, properties: { afterId: { type: 'string', maxLength: 24 }, ...PATCH_FIELDS }, required: ['afterId', ...Object.keys(PATCH_FIELDS)] } },
  removals: { type: 'array', maxItems: 60, items: { type: 'string', minLength: 1, maxLength: 24 } }
}, required: ['message', 'question', 'summary', 'updates', 'additions', 'removals'] };
// A stable transport schema avoids changing the provider's cached prefix between turns.
const PLAN_SESSION_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  draft: { anyOf: [PLAN_SCHEMA, { type: 'null' }] }, patch: { anyOf: [PLAN_PATCH_SCHEMA, { type: 'null' }] }
}, required: ['draft', 'patch'] };
// One step's before and after, in pseudocode. `before` is empty when it was supplied.
const STEP_DETAIL_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  before: { type: 'string', maxLength: 3000 }, after: { type: 'string', minLength: 1, maxLength: 3000 }
}, required: ['before', 'after'] };
// A cheap ranking of files for a goal, used only when the free match is weak.
const RANK_SCHEMA = { type: 'object', additionalProperties: false, properties: { files: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } } }, required: ['files'] };
// Cache compatibility: older approved blocks may not have step links. Extra
// metadata is ignored by the canonical parser rather than invalidating old work.
const section = SCHEMA.properties.sections.items;
const EXPLANATION_DATA = {
  ...SCHEMA, additionalProperties: true,
  properties: { ...SCHEMA.properties,
    sections: { ...SCHEMA.properties.sections, minItems: 1, items: {
      ...section, additionalProperties: true,
      required: section.required.filter(name => name !== 'lineMap'),
      properties: { ...section.properties,
        pseudocode: { type: 'string', minLength: 1 },
        lineMap: { type: 'array', items: { anyOf: [STEP_LINK, STORED_STEP_LINK] } }
      }
    } },
    views: { type: 'object' }
  }
};
module.exports = { SCHEMA, WIRE_SCHEMA, wirePatchSections, REVIEW_SCHEMA, SELECTION_SCHEMA, EXPLANATION_DATA, NOTES_SCHEMA, MAP_SUMMARY_SCHEMA, SIMULATION_SCHEMA, FLOW_SCHEMA, PLAN_SCHEMA, PLAN_PATCH_SCHEMA, PLAN_SESSION_SCHEMA, STEP_DETAIL_SCHEMA, RANK_SCHEMA };

// Build-only dependencies: production loads the generated standalone validators.
if (require.main === module) {
  const Ajv = require('ajv'), standalone = require('ajv/dist/standalone').default;
  const esbuild = require('esbuild'), fs = require('node:fs'), path = require('node:path');
  const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true } });
  ajv.addSchema(EXPLANATION_DATA, 'explanation');
  ajv.addSchema(REVIEW_SCHEMA, 'review');
  ajv.addSchema(SELECTION_SCHEMA, 'selection');
  ajv.addSchema(NOTES_SCHEMA, 'notes');
  ajv.addSchema(MAP_SUMMARY_SCHEMA, 'mapSummary');
  ajv.addSchema(SIMULATION_SCHEMA, 'simulation');
  ajv.addSchema(FLOW_SCHEMA, 'flow');
  ajv.addSchema(PLAN_SCHEMA, 'plan');
  ajv.addSchema(PLAN_PATCH_SCHEMA, 'planPatch');
  ajv.addSchema(PLAN_SESSION_SCHEMA, 'planSession');
  ajv.addSchema(STEP_DETAIL_SCHEMA, 'stepDetail');
  ajv.addSchema(RANK_SCHEMA, 'rank');
  const code = standalone(ajv, { explanation: 'explanation', review: 'review', selection: 'selection', notes: 'notes', mapSummary: 'mapSummary', simulation: 'simulation', flow: 'flow', plan: 'plan', planPatch: 'planPatch', planSession: 'planSession', stepDetail: 'stepDetail', rank: 'rank' });
  const license = fs.readFileSync(path.join(path.dirname(require.resolve('ajv/package.json')), 'LICENSE'), 'utf8');
  esbuild.buildSync({ stdin: { contents: code, resolveDir: __dirname, sourcefile: 'ajv-validators.js' },
    bundle: true, minify: true, platform: 'node', target: 'node20', format: 'cjs',
    outfile: path.join(__dirname, 'validation.min.js'),
    banner: { js: '/*! Generated with Ajv ' + require('ajv/package.json').version + '. Rebuild: npm run build:validation.\n' + license + '*/' }, legalComments: 'none' });
}
