'use strict';
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, summary: { type: 'string' },
    sections: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { title: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, pseudocode: { type: 'string' }, lineMap: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { pseudocodeLine: { type: 'integer' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['pseudocodeLine', 'startLine', 'endLine'] } } },
      required: ['title', 'startLine', 'endLine', 'pseudocode', 'lineMap']
    } }
  }, required: ['title', 'summary', 'sections']
};
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
        lineMap: { ...section.properties.lineMap, items: { ...section.properties.lineMap.items, additionalProperties: true } }
      }
    } },
    views: { type: 'object' }
  }
};
module.exports = { SCHEMA, REVIEW_SCHEMA, SELECTION_SCHEMA, EXPLANATION_DATA };

// Build-only dependencies: production loads the generated standalone validators.
if (require.main === module) {
  const Ajv = require('ajv'), standalone = require('ajv/dist/standalone').default;
  const esbuild = require('esbuild'), fs = require('node:fs'), path = require('node:path');
  const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true,
    coerceTypes: false, useDefaults: false, removeAdditional: false, code: { source: true } });
  ajv.addSchema(EXPLANATION_DATA, 'explanation');
  ajv.addSchema(REVIEW_SCHEMA, 'review');
  ajv.addSchema(SELECTION_SCHEMA, 'selection');
  const code = standalone(ajv, { explanation: 'explanation', review: 'review', selection: 'selection' });
  const license = fs.readFileSync(path.join(path.dirname(require.resolve('ajv/package.json')), 'LICENSE'), 'utf8');
  esbuild.buildSync({ stdin: { contents: code, resolveDir: __dirname, sourcefile: 'ajv-validators.js' },
    bundle: true, minify: true, platform: 'node', target: 'node20', format: 'cjs',
    outfile: path.join(__dirname, 'validation.min.js'),
    banner: { js: '/*! Generated with Ajv ' + require('ajv/package.json').version + '. Rebuild: npm run build:validation.\n' + license + '*/' }, legalComments: 'none' });
}
