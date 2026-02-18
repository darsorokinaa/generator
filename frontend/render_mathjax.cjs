// render_mathjax.js
const {mathjax} = require('mathjax-full/js/mathjax.js');
const {TeX} = require('mathjax-full/js/input/tex.js');
const {SVG} = require('mathjax-full/js/output/svg.js');
const {liteAdaptor} = require('mathjax-full/js/adaptors/liteAdaptor.js');
const {RegisterHTMLHandler} = require('mathjax-full/js/handlers/html.js');
const {AllPackages} = require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({packages: AllPackages});
const svg = new SVG({fontCache: 'none'}); // важно для WeasyPrint
const html = mathjax.document('', {InputJax: tex, OutputJax: svg});

let input = '';
process.stdin.on('data', (c) => input += c);
process.stdin.on('end', () => {
  const node = html.convert(input, {display: true});
  const out = adaptor.outerHTML(node);
  process.stdout.write(out);
});
