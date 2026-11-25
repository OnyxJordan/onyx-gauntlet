// Print a shape from onyx.js as the grid it actually becomes.
//
// Why this exists: the shapes are drawn on a 56 pixel canvas and then sampled
// down to about thirteen cells when they fall. Three passes of card art looked
// right at 56 pixels and arrived as a blob, because an emblem that is a third
// of the drawing is four cells across by the time anyone sees it. This shows
// the thing at the size it is seen.
//
//   node tools/shape-grid.js cardBall cardSport leaf
//
// '#' is a cell that draws bright, '+' faint, '.' not at all.
const {chromium} = require('playwright');
const path = require('path').join(__dirname, '..', 'onyx.js');
// Optional trailing number is the particle radius in cells, matching
// Art.prototype.shed. Default is the middle of the card range.
const args = process.argv.slice(2);
const R = Number(args[args.length - 1]) ? Number(args.pop()) : 16;
const shapes = args;
if (!shapes.length) {
  console.error('usage: node tools/shape-grid.js <shape> [shape...]');
  process.exit(1);
}
(async () => {
  const b = await chromium.launch({args: ['--no-sandbox']});
  const p = await b.newPage();
  await p.goto('about:blank');
  await p.addScriptTag({path});
  for (const name of shapes) {
    const out = await p.evaluate(([nm, RR]) => {
      if (!window.__oxShapes[nm]) return 'no shape called ' + nm;
      const LN = 56;
      const c = document.createElement('canvas'); c.width = c.height = LN;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.strokeStyle = '#fff';
      window.__oxShapes[nm](x);
      const d = x.getImageData(0, 0, LN, LN).data;
      const at = (u, v) => d[((v | 0) * LN + (u | 0)) * 4 + 3] / 255;
      // the same sampling a particle does: r in cells, cells 1.6x taller than
      // wide, and cards narrowed to portrait
      const r = RR, rx = nm.indexOf('card') === 0 ? r * 0.72 : r, ry = r;
      const W = Math.round(rx * 2), H = Math.round(ry * 2 / 1.6);
      let s = '';
      for (let gy = 0; gy <= H; gy++) {
        for (let gx = 0; gx <= W; gx++) {
          const u = (gx - W / 2) / rx, v = (gy - H / 2) * 1.6 / ry;
          if (u < -1 || u > 1 || v < -1 || v > 1) { s += ' '; continue; }
          const a = at((u * 0.5 + 0.5) * (LN - 1), (v * 0.5 + 0.5) * (LN - 1));
          s += a < 0.25 ? '.' : (a > 0.7 ? '#' : '+');
        }
        s += '\n';
      }
      return s;
    }, [name, R]);
    console.log('--- ' + name + ' ---');
    console.log(out);
  }
  await b.close();
})();
