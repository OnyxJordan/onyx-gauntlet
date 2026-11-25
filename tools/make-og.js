// Draw the share card that Slack, iMessage and the rest show when someone
// posts a link to one of these pages.
//
// Without an og:image they show an empty grey box, which is what prompted this.
// It is generated rather than hand-drawn so it follows the theme: the colours
// come from site.css, so when the Thanksgiving orange goes back to purple the
// share card goes with it on the next run.
//
//   node tools/make-og.js
//
// Writes og.png at 1200x630, the size every unfurler crops from.
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'site.css'), 'utf8');
const pick = (name, fallback) => {
  const m = css.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  return m ? m[1].trim() : fallback;
};
const BG = pick('ox-black', '#0e0a07');
const ACCENT = pick('ox-purple', '#ff8a3d');
const INK = pick('ox-white', '#fdf8f2');

const MARK = 'm39.041 109.178 18.493 9.863-33.972 17.945L0 124.384v-84.11l39.041-20.411zm21.918-81.37-18.493-9.863L76.438 0 100 12.603v84.246L60.959 117.26z';
const WORD = 'M28.344 0C4.264 0 0 4.076 0 23.472S4.263 46.85 28.344 46.85s28.25-4.03 28.25-23.378C56.595 4.122 52.426 0 28.345 0m12.134 25.018c0 8.948-2.108 11.01-10.447 11.01h-3.326c-8.433 0-10.495-2.015-10.495-11.01v-3.139c0-8.995 2.061-11.057 10.494-11.057h3.327c8.34 0 10.447 2.062 10.447 11.057zM217.667 45.866l-16.852-23.094L216.776.984h-18.459l-7.616 13.618L183.232.984h-34.294l-8.425 15.88-9.097-15.88h-31.39v30.332L84.378.983h-23.19v44.882h14.57V13.741l16.678 32.125h22.067V2.633l17.475 26.742v16.491h16.023V29.61l17.045-26.911 14.796 20.168-16.803 23h19.115l7.97-14.196 8.053 14.196z';

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;background:${BG};overflow:hidden}
.card{width:1200px;height:630px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:54px;position:relative}
/* the same hairline grid the pages sit on, so the card reads as the site */
.card::before{content:"";position:absolute;inset:0;opacity:.5;
  background:repeating-linear-gradient(90deg,transparent 0 59px,rgba(255,255,255,.028) 59px 60px),
             repeating-linear-gradient(0deg,transparent 0 59px,rgba(255,255,255,.028) 59px 60px)}
.logo{display:flex;align-items:center;gap:44px;position:relative}
.logo svg{display:block}
.mark{height:168px;width:auto;color:${ACCENT}}
.word{height:76px;width:auto;color:${INK}}
.rule{width:560px;height:1px;background:${ACCENT};opacity:.45;position:relative}
.rule::before,.rule::after{content:"";position:absolute;top:-3px;width:7px;height:7px;
  background:${ACCENT};transform:rotate(45deg)}
.rule::before{left:-3px}.rule::after{right:-3px}
.tag{position:relative;font:500 30px 'Geist Mono',ui-monospace,Menlo,monospace;
  letter-spacing:.26em;text-transform:uppercase;color:${ACCENT}}
</style></head><body><div class="card">
  <div class="logo">
    <svg class="mark" viewBox="0 0 100 137" fill="currentColor"><path d="${MARK}"/></svg>
    <svg class="word" viewBox="0 0 218 47" fill="currentColor"><path d="${WORD}"/></svg>
  </div>
  <div class="rule"></div>
  <div class="tag">Live Leaderboards</div>
</div></body></html>`;

(async () => {
  const b = await chromium.launch({args: ['--no-sandbox']});
  const p = await b.newPage({viewport: {width: 1200, height: 630}});
  await p.setContent(html, {waitUntil: 'load'});
  await p.waitForTimeout(400);
  const out = path.join(ROOT, 'og.png');
  await p.screenshot({path: out});

  // A square one as well: the browser tab, the phone home screen, and the
  // small thumbnail some clients use instead of the wide card.
  const sq = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0}html,body{width:512px;height:512px;background:${BG}}
.b{width:512px;height:512px;display:flex;align-items:center;justify-content:center}
svg{height:300px;width:auto;color:${ACCENT};display:block}
</style></head><body><div class="b">
<svg viewBox="0 0 100 137" fill="currentColor"><path d="${MARK}"/></svg>
</div></body></html>`;
  const q = await b.newPage({viewport: {width: 512, height: 512}});
  await q.setContent(sq, {waitUntil: 'load'});
  await q.waitForTimeout(200);
  const iconPath = path.join(ROOT, 'icon.png');
  await q.screenshot({path: iconPath});

  await b.close();
  console.log('wrote ' + out + ' and ' + iconPath + '  bg ' + BG + '  accent ' + ACCENT);
})();
