// Audit the frontend's actual import graph, including shared Ant Design adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../web')] }));

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'web/src/main.tsx');
const output = path.join(root, '.local/ui-audit/source-report.json');
const widgets = new Set([
  'AutoComplete', 'Button', 'Cascader', 'Checkbox', 'Collapse', 'ColorPicker',
  'DatePicker', 'Dropdown', 'Drawer', 'Form', 'Input', 'InputNumber', 'List',
  'Mentions', 'Menu', 'Modal', 'Pagination', 'Popconfirm', 'Radio', 'Rate',
  'Segmented', 'Select', 'Slider', 'Steps', 'Switch', 'Table', 'Tabs',
  'TimePicker', 'Tour', 'Transfer', 'Tree', 'TreeSelect', 'Upload',
]);
const optionTags = new Set(['Select.Option', 'Select.OptGroup', 'Form.Item', 'Form.List', 'List.Item', 'List.Item.Meta']);
const nativeWidgets = new Set(['button', 'input', 'select', 'textarea', 'table', 'details', 'summary', 'dialog', 'progress', 'meter', 'form']);
const adapters = new Map([
  ['web/src/shared/Field.tsx', new Set(['Field'])],
  ['web/src/shared/FileUpload.tsx', new Set(['FileUpload'])],
  ['web/src/live/context.tsx', new Set(['Link'])],
]);
const visited = new Set();
const sites = [];
const problems = [];
const headings = [];
const navigationLinks = [];
function relative(file) { return path.relative(root, file).replaceAll('\\', '/'); }
function resolve(from, specifier) {
  const base = path.resolve(path.dirname(from), specifier);
  return ['', '.tsx', '.ts', '/index.tsx', '/index.ts'].map(s => base + s)
    .find(f => /\.tsx?$/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile());
}
function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = specifier.startsWith('.') ? resolve(file, specifier) : null;
    if (target && !statement.isTypeOnly && !statement.importClause?.isTypeOnly) visit(target);
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      if (!binding.isTypeOnly) imports.set(binding.name.text, { name: (binding.propertyName || binding.name).text, module: target ? relative(target) : specifier });
    }
  }
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.')) {
      const target = resolve(file, node.arguments[0].text);
      if (target) visit(target);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const site = { file: relative(file), line, tag };
      const binding = imports.get(tag.split('.')[0]);
      const importedTag = binding ? tag.replace(/^[^.]+/, binding.name) : '';
      const antd = binding?.module === 'antd';
      if (antd && ((widgets.has(binding.name) && !optionTags.has(importedTag)) || importedTag === 'Typography.Link')) {
        sites.push({ ...site, kind: 'antd' });
      } else if (binding && adapters.get(binding.module)?.has(binding.name)) {
        sites.push({ ...site, kind: 'antd-adapter' });
      } else if (nativeWidgets.has(tag)) {
        sites.push({ ...site, kind: 'native' });
      }
      if (/^h[2-6]$/.test(tag) || antd && importedTag === 'Typography.Title') headings.push(site);
      const attrs = node.attributes.properties;
      if (antd && importedTag === 'Input' && attrs.some(a => ts.isJsxAttribute(a) && a.name.getText(source) === 'type' && a.initializer && ts.isStringLiteral(a.initializer) && /^(date|datetime-local|time|number|file|color|range)$/.test(a.initializer.text))) {
        problems.push({ ...site, issue: 'Use the matching Ant Design picker, Upload or InputNumber' });
      }
      if (/^[a-z]/.test(tag) && tag !== 'a' && attrs.some(a => ts.isJsxAttribute(a) && /^(onClick|onKeyDown)$/.test(a.name.getText(source)))) {
        problems.push({ ...site, issue: 'Handmade interactive element' });
      }
      if (tag === 'a' || binding?.module === 'react-router-dom' && /^(NavLink|Link)$/.test(binding.name)) navigationLinks.push(site);
    }
    ts.forEachChild(node, walk);
  }
  walk(source);
}
visit(entry);
const configPath = path.join(root, 'web/tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const compiler = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram([entry], { ...compiler.options, noUnusedLocals: true, noUnusedParameters: true });
const unused = program.getSemanticDiagnostics().filter(d => [6133, 6192, 6196].includes(d.code)).map(d => ({
  file: relative(d.file.fileName),
  line: d.file.getLineAndCharacterOfPosition(d.start).line + 1,
  message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
}));
const native = sites.filter(s => s.kind === 'native');
const reused = sites.length - native.length;
const ratio = sites.length ? reused / sites.length * 100 : 0;
const report = {
  metric: 'Reachable JSX widget sites; Ant Design or explicit Ant Design adapters / all widget sites',
  note: 'Static source sites, not runtime instance counts or line coverage. Options and layout are not widgets; content-generated Markdown retains semantic headings/tables. Brand/menu/skip links are semantic navigation, reported separately.',
  files: [...visited].map(relative).sort(),
  widgets: { total: sites.length, reused, native: native.length, reusePercent: ratio },
  native, secondaryHeadings: headings, unusedDeclarations: unused, problems, navigationLinks, sites,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ files: report.files.length, widgets: report.widgets, secondaryHeadings: headings.length, unusedDeclarations: unused.length, problems: problems.length, report: relative(output) }, null, 2));
assert(sites.length > 0, 'The active frontend graph must contain widgets');
assert(ratio >= 99, 'Ant Design widget reuse must be at least 99%');
assert.deepEqual(native, [], 'Use Ant Design controls instead of native widgets');
assert.deepEqual(headings, [], 'Application chrome must not add secondary headings');
assert.deepEqual(problems, [], 'Do not replace controls with clickable HTML');
assert.deepEqual(unused, [], 'Remove unused declarations in the active frontend');
