/* onyx.js - Onyx raster art for every Onyx Sports page (hub, MLB, NBA).
   onyxodds.com draws its artwork as text: shapes filled with monospace
   characters picked from a brightness ramp, drifting like a slow wave and
   rippling around the cursor (the giant ONYX in its footer). This draws the
   same thing on a canvas, so any element can carry it:

     <canvas data-ox-art="wordmark"></canvas>       the ONYX wordmark
     <canvas data-ox-art="basketball" data-ox-tone="green"></canvas>

   Shapes are vector paths (the real Onyx wordmark and logo mark included),
   rasterized once per resize into a grid with one cell per character.
   Frames run only while a canvas is on screen and the tab is visible;
   reduced-motion users get one still frame. No dependencies. */
(function () {
  'use strict';
  if (window.OnyxArt) return;

  var RAMP = ' .:-_;|!?*7=0123456789@';
  var TONES = {
    purple: [176, 56, 249], lilac: [215, 149, 255], blue: [99, 91, 255],
    green: [97, 233, 112], white: [252, 252, 252]
  };
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── shapes: each draws white on a w x h canvas ──────────────────
  var WORD = 'M28.344 0C4.264 0 0 4.076 0 23.472S4.263 46.85 28.344 46.85s28.25-4.03 28.25-23.378C56.595 4.122 52.426 0 28.345 0m12.134 25.018c0 8.948-2.108 11.01-10.447 11.01h-3.326c-8.433 0-10.495-2.015-10.495-11.01v-3.139c0-8.995 2.061-11.057 10.494-11.057h3.327c8.34 0 10.447 2.062 10.447 11.057zM217.667 45.866l-16.852-23.094L216.776.984h-18.459l-7.616 13.618L183.232.984h-34.294l-8.425 15.88-9.097-15.88h-31.39v30.332L84.378.983h-23.19v44.882h14.57V13.741l16.678 32.125h22.067V2.633l17.475 26.742v16.491h16.023V29.61l17.045-26.911 14.796 20.168-16.803 23h19.115l7.97-14.196 8.053 14.196z';
  var MARK = 'm39.041 109.178 18.493 9.863-33.972 17.945L0 124.384v-84.11l39.041-20.411zm21.918-81.37-18.493-9.863L76.438 0 100 12.603v84.246L60.959 117.26z';
  function fitPath(c, d, vw, vh, pad) {
    var s = Math.min((c.canvas.width * (1 - pad)) / vw, (c.canvas.height * (1 - pad)) / vh);
    c.save();
    c.translate((c.canvas.width - vw * s) / 2, (c.canvas.height - vh * s) / 2);
    c.scale(s, s); c.fill(new Path2D(d)); c.restore();
  }
  // circle-based balls in a unit box centred on (0,0), radius 1
  function ball(c, draw) {
    var w = c.canvas.width, h = c.canvas.height, r = Math.min(w, h) * 0.46;
    c.save(); c.translate(w / 2, h / 2); c.scale(r, r);
    c.lineCap = 'round'; c.lineJoin = 'round';
    draw(c); c.restore();
  }
  function cut(c, fn, lw) {     // erase strokes from the shape (seams, laces)
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineWidth = lw; c.beginPath(); fn(c); c.stroke(); c.restore();
  }
  function football(c, tilt) {
    ball(c, function (c) {
      c.rotate(tilt);
      c.beginPath(); c.moveTo(-1.02, 0);
      c.bezierCurveTo(-0.62, -0.72, 0.62, -0.72, 1.02, 0);
      c.bezierCurveTo(0.62, 0.72, -0.62, 0.72, -1.02, 0); c.fill();
      cut(c, function (c) { c.moveTo(-0.34, -0.02); c.lineTo(0.34, -0.02); }, 0.07);
      cut(c, function (c) { for (var i = -2; i <= 2; i++) { c.moveTo(i * 0.13, -0.13); c.lineTo(i * 0.13, 0.09); } }, 0.05);
      cut(c, function (c) { c.moveTo(-0.78, -0.3); c.quadraticCurveTo(-0.66, 0, -0.78, 0.3); c.moveTo(0.78, -0.3); c.quadraticCurveTo(0.66, 0, 0.78, 0.3); }, 0.05);
    });
  }
  var SHAPES = {
    wordmark: function (c) { fitPath(c, WORD, 218, 47, 0.04); },
    mark: function (c) { fitPath(c, MARK, 100, 137, 0.1); },
    basketball: function (c) {
      ball(c, function (c) {
        c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill();
        cut(c, function (c) {
          c.moveTo(-1, 0); c.lineTo(1, 0); c.moveTo(0, -1); c.lineTo(0, 1);
          c.moveTo(-0.72, -0.7); c.quadraticCurveTo(-0.3, 0, -0.72, 0.7);
          c.moveTo(0.72, -0.7); c.quadraticCurveTo(0.3, 0, 0.72, 0.7);
        }, 0.07);
      });
    },
    baseball: function (c) {
      ball(c, function (c) {
        c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill();
        cut(c, function (c) {
          c.moveTo(-0.62, -0.78); c.bezierCurveTo(-0.22, -0.3, -0.22, 0.3, -0.62, 0.78);
          c.moveTo(0.62, -0.78); c.bezierCurveTo(0.22, -0.3, 0.22, 0.3, 0.62, 0.78);
        }, 0.06);
        cut(c, function (c) {
          for (var i = -3; i <= 3; i++) {
            var y = i * 0.2, x = -0.52 + Math.abs(i) * 0.03;
            c.moveTo(x - 0.08, y - 0.04); c.lineTo(x + 0.06, y + 0.03);
            c.moveTo(-x + 0.08, y - 0.04); c.lineTo(-x - 0.06, y + 0.03);
          }
        }, 0.035);
      });
    },
    football: function (c) { football(c, -0.5); },
    cfb: function (c) {
      football(c, 0.5);
      ball(c, function (c) {     // a star over the ball for the college game
        c.save(); c.translate(0.66, -0.66); c.scale(0.24, 0.24); c.beginPath();
        for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        c.closePath(); c.fill(); c.restore();
      });
    },
    cbb: function (c) {          // the basketball with the college star (cfb's), for college basketball
      SHAPES.basketball(c);
      ball(c, function (c) {
        c.save(); c.translate(0.72, -0.72); c.scale(0.24, 0.24); c.beginPath();
        for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 0.45 : 1; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        c.closePath(); c.fill(); c.restore();
      });
    },
    hockey: function (c) {
      ball(c, function (c) {
        c.save(); c.rotate(-0.55);
        c.fillRect(-0.12, -1.02, 0.2, 1.42);
        c.beginPath(); c.moveTo(-0.12, 0.38); c.lineTo(0.08, 0.38); c.quadraticCurveTo(0.12, 0.62, 0.5, 0.66);
        c.lineTo(0.52, 0.86); c.quadraticCurveTo(-0.12, 0.88, -0.12, 0.38); c.fill(); c.restore();
        c.beginPath(); c.ellipse(-0.42, 0.62, 0.36, 0.13, 0, 0, 7); c.fill();
        c.fillRect(-0.78, 0.5, 0.72, 0.12);
        c.beginPath(); c.ellipse(-0.42, 0.5, 0.36, 0.13, 0, 0, 7); c.fill();
      });
    },
    tennis: function (c) {
      ball(c, function (c) {
        c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill();
        cut(c, function (c) {
          c.moveTo(-0.82, -0.58); c.bezierCurveTo(-0.1, -0.35, -0.1, 0.35, -0.82, 0.58);
          c.moveTo(0.82, -0.58); c.bezierCurveTo(0.1, -0.35, 0.1, 0.35, 0.82, 0.58);
        }, 0.08);
      });
    },
    golf: function (c) {
      ball(c, function (c) {
        c.beginPath(); c.arc(0, -0.22, 0.68, 0, 7); c.fill();
        cut(c, function (c) {
          for (var y = -0.7; y < 0.3; y += 0.22) for (var x = -0.6; x < 0.6; x += 0.22) {
            var xx = x + ((Math.round(y / 0.22) % 2) ? 0.11 : 0);
            if (xx * xx + (y + 0.22) * (y + 0.22) < 0.42) { c.moveTo(xx + 0.035, y); c.arc(xx, y, 0.035, 0, 7); }
          }
        }, 0.05);
        c.beginPath(); c.moveTo(-0.34, 0.46); c.lineTo(0.34, 0.46); c.lineTo(0.07, 0.6); c.lineTo(0.05, 1); c.lineTo(-0.05, 1); c.lineTo(-0.07, 0.6); c.closePath(); c.fill();
      });
    },
    court: function (c) {        // half-court lines for the gamecenter section
      var w = c.canvas.width, h = c.canvas.height, u = Math.min(w / 1.6, h);
      c.save(); c.translate(w / 2, h * 0.08); c.strokeStyle = '#fff'; c.lineWidth = u * 0.03;
      c.strokeRect(-u * 0.75, 0, u * 1.5, u * 0.88);
      c.strokeRect(-u * 0.24, 0, u * 0.48, u * 0.56);
      c.beginPath(); c.arc(0, u * 0.56, u * 0.24, 0, Math.PI); c.stroke();
      c.beginPath(); c.moveTo(-u * 0.66, 0); c.lineTo(-u * 0.66, u * 0.26); c.arc(0, u * 0.12, u * 0.68, Math.PI - 0.22, 0.22, true); c.lineTo(u * 0.66, 0); c.stroke();
      c.beginPath(); c.arc(0, u * 0.1, u * 0.05, 0, 7); c.fill();
      c.beginPath(); c.arc(0, u * 0.88, u * 0.2, Math.PI, 0); c.stroke();
      c.restore();
    },
    diamond: function (c) {      // a ballpark from above
      var w = c.canvas.width, h = c.canvas.height, u = Math.min(w, h * 1.1);
      c.save(); c.translate(w / 2, h * 0.94); c.beginPath(); c.moveTo(0, 0);
      c.lineTo(-u * 0.46, -u * 0.46); c.quadraticCurveTo(0, -u * 1.02, u * 0.46, -u * 0.46); c.closePath(); c.fill();
      c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.moveTo(0, -u * 0.08); c.lineTo(-u * 0.2, -u * 0.28); c.lineTo(0, -u * 0.48); c.lineTo(u * 0.2, -u * 0.28); c.closePath(); c.fill();
      c.globalCompositeOperation = 'source-over';
      c.beginPath(); c.arc(0, -u * 0.28, u * 0.035, 0, 7); c.fill();
      c.restore();
    },
    field: function (c) {        // a soft blob field, the background texture of onyxodds.com sections
      var w = c.canvas.width, h = c.canvas.height;
      [[.2, .3, .22], [.78, .25, .18], [.6, .78, .24], [.12, .82, .14]].forEach(function (b) {
        var g = c.createRadialGradient(b[0] * w, b[1] * h, 0, b[0] * w, b[1] * h, b[2] * Math.max(w, h));
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
    }
  };

  // ── the renderer ───────────────────────────────────────────────
  var arts = [];
  function Art(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.shape = SHAPES[cv.dataset.oxArt] || SHAPES.mark;
    this.tone = TONES[cv.dataset.oxTone] || TONES.purple;
    this.cell = +cv.dataset.oxCell || 0;
    this.fade = cv.dataset.oxFade !== '0';
    this.calm = +cv.dataset.oxCalm || 1;    // < 1 = a quieter wave
    this.mx = -1e4; this.my = -1e4; this.tx = -1e4; this.ty = -1e4;
    this.visible = false; this.t0 = performance.now();
    this.resize();
    var self = this;
    var move = function (e) {
      var r = cv.getBoundingClientRect();
      self.tx = (e.clientX - r.left) / self.cw; self.ty = (e.clientY - r.top) / self.ch;
      // entering: jump straight to the pointer (easing in from -1e4 took 2-3 s to arrive)
      if (self.mx < -1e3) { self.mx = self.tx; self.my = self.ty; }
      self.hot = true;
      if (REDUCED) self.draw(performance.now()); else loop();
    };
    var host = cv.closest('[data-ox-host]') || cv;
    host.addEventListener('pointermove', move, {passive: true});
    host.addEventListener('pointerdown', move, {passive: true});
    host.addEventListener('pointerleave', function () { self.tx = -1e4; self.ty = -1e4; self.hot = false; if (REDUCED) self.draw(performance.now()); });
  }
  Art.prototype.resize = function () {
    var cv = this.cv, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return false;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var fs = this.cell || Math.max(6, Math.min(11, Math.round(w / 120)));
    this.fs = fs; this.cw = fs * 0.62; this.ch = fs * 1.02;
    this.cols = Math.floor(w / this.cw); this.rows = Math.floor(h / this.ch);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the shape at 2x the grid, sampled with displacement each frame
    var mw = this.cols * 2, mh = this.rows * 2;
    var m = document.createElement('canvas'); m.width = mw; m.height = mh;
    var mc = m.getContext('2d'); mc.fillStyle = '#fff'; mc.strokeStyle = '#fff';
    this.shape(mc);
    var px = mc.getImageData(0, 0, mw, mh).data, a = new Float32Array(mw * mh);
    for (var i = 0; i < a.length; i++) a[i] = px[i * 4 + 3] / 255;
    this.mask = a; this.mw = mw; this.mh = mh;
    this.w = w; this.h = h;
    return true;
  };
  Art.prototype.at = function (x, y) {
    var xi = Math.round(x * 2), yi = Math.round(y * 2);
    if (xi < 0 || yi < 0 || xi >= this.mw || yi >= this.mh) return 0;
    return this.mask[yi * this.mw + xi];
  };
  Art.prototype.draw = function (now) {
    if (!this.mask) return;
    var t = REDUCED ? 0 : (now - this.t0) / 1000 * this.calm, c = this.ctx, L = RAMP.length - 1;
    var dt = Math.min(100, now - (this.tl || now)), ez = 1 - Math.pow(0.6, dt / 16.7);
    this.tl = now;
    this.mx += (this.tx - this.mx) * ez; this.my += (this.ty - this.my) * ez;
    if (this.tx < -1e3) { this.mx = this.tx; this.my = this.ty; }
    var R = Math.max(6, this.cols * 0.07), R2 = R * R, rows = this.rows, cols = this.cols;
    var buckets = [[], [], [], [], [], [], [], []];
    for (var y = 0; y < rows; y++) {
      var fade = this.fade ? 1 - 0.62 * (y / rows) : 1;
      for (var x = 0; x < cols; x++) {
        var dx = x - this.mx, dy = (y - this.my) * 1.6, d2 = dx * dx + dy * dy;
        var k = d2 < R2 * 9 ? Math.exp(-d2 / R2) : 0;
        // the lens: cells near the pointer sample the shape further out, so
        // the letters bulge and swirl around it like the onyxodds.com footer
        var sw = Math.sin(y * 0.21 + t * 1.4) * 0.55;
        var sx = x + sw - dx * k * 0.42 + dy * k * 0.18 * Math.sin(t * 2.2);
        var sy = y + Math.cos(x * 0.13 + t * 1.1) * 0.25 - dy / 1.6 * k * 0.42;
        var m = this.at(sx, sy);
        if (m < 0.08) continue;
        var v = m * (0.6 + 0.22 * Math.sin(x * 0.11 + t * 0.9) * Math.cos(y * 0.19 - t * 0.6) + 0.18 * Math.sin((x - y) * 0.07 + t * 1.3));
        if (k > 0.02) v += k * 0.45 * Math.sin(Math.sqrt(d2) * 0.7 - t * 6);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        var ch = RAMP.charAt(1 + Math.floor(v * (L - 1)));
        var b = Math.min(7, Math.floor((0.28 + 0.72 * v) * fade * 8));
        buckets[b].push(ch, x, y);
      }
    }
    c.clearRect(0, 0, this.w, this.h);
    c.font = '500 ' + this.fs + 'px "Geist Mono", ui-monospace, Menlo, monospace';
    c.textBaseline = 'top';
    var tn = this.tone;
    for (var bi = 0; bi < 8; bi++) {
      var arr = buckets[bi]; if (!arr.length) continue;
      c.fillStyle = 'rgba(' + tn[0] + ',' + tn[1] + ',' + tn[2] + ',' + ((bi + 1) / 8).toFixed(3) + ')';
      for (var j = 0; j < arr.length; j += 3) c.fillText(arr[j], arr[j + 1] * this.cw, arr[j + 2] * this.ch);
    }
  };

  // one clock for every canvas, only while something is on screen: the one under the
  // pointer redraws every frame so it tracks instantly; idle ones breathe at ~20 fps
  var last = 0, running = false;
  function tick(now) {
    running = false;
    if (document.hidden) return;
    var idle = now - last > 48;
    if (idle) last = now;
    var any = false;
    arts.forEach(function (a) {
      if (!a.visible) return;
      any = true;
      if (a.hot || idle) a.draw(now);
    });
    if (any) loop();
  }
  function loop() { if (!running && !REDUCED) { running = true; requestAnimationFrame(tick); } }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var a = e.target._oxArt; if (!a) return;
      a.visible = e.isIntersecting;
      if (a.visible) { if (!a.mask) a.resize(); a.draw(performance.now()); loop(); }
    });
  }, {rootMargin: '80px'}) : null;

  // a canvas that changes size (a card's text wraps, fonts land) gets a fresh grid
  var ro = 'ResizeObserver' in window ? new ResizeObserver(function (es) {
    es.forEach(function (e) { var a = e.target._oxArt; if (a && a.resize()) a.draw(performance.now()); });
  }) : null;
  function mount(cv) {
    if (cv._oxArt) return cv._oxArt;
    var a = new Art(cv); cv._oxArt = a; arts.push(a);
    if (ro) ro.observe(cv);
    if (io) io.observe(cv); else { a.visible = true; loop(); }
    return a;
  }
  function scan(root) { (root || document).querySelectorAll('canvas[data-ox-art]').forEach(mount); }
  var rz = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () { arts.forEach(function (a) { if (a.resize()) a.draw(performance.now()); }); }, 120);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loop(); });
  // the mono face lands after first paint; redraw so cells use it
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { arts.forEach(function (a) { a.draw(performance.now()); }); });

  window.OnyxArt = {mount: mount, scan: scan, shapes: SHAPES, mark: MARK, word: WORD};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();
})();
