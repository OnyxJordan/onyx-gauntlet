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
    green: [97, 233, 112], white: [252, 252, 252],
    // Harvest tones, added here for the Thanksgiving round. This repository
    // keeps its own copy of the engine, so these and the shapes below do not
    // exist in onyx-baseball-fix. Keep them when syncing the engine back.
    amber: [255, 168, 61], ember: [255, 122, 48], cranberry: [214, 58, 74],
    wheat: [240, 200, 128]
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
  function knock(c, fn) {       // erase a filled region from the shape
    c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); fn(c); c.fill(); c.restore();
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
  // A card: a rounded plate, an inset frame line, and whatever emblem the
  // face knocks out of the middle.
  function cardFace(c, emblem) {
    var w = c.canvas.width, h = c.canvas.height;
    var px = w * 0.05, py = h * 0.02, r = w * 0.06;
    function plate(c, x0, y0, x1, y1, r) {
      c.moveTo(x0 + r, y0);
      c.lineTo(x1 - r, y0); c.quadraticCurveTo(x1, y0, x1, y0 + r);
      c.lineTo(x1, y1 - r); c.quadraticCurveTo(x1, y1, x1 - r, y1);
      c.lineTo(x0 + r, y1); c.quadraticCurveTo(x0, y1, x0, y1 - r);
      c.lineTo(x0, y0 + r); c.quadraticCurveTo(x0, y0, x0 + r, y0);
      c.closePath();
    }
    c.beginPath(); plate(c, px, py, w - px, h - py, r); c.fill();
    // The frame has to be about one cell wide at the size it falls at, or it
    // lands between two cells and is not drawn at all.
    cut(c, function (c) { plate(c, w * 0.21, h * 0.17, w * 0.79, h * 0.83, r * 0.7); }, w * 0.055);
    emblem(c, w, h);
  }
  // Half an outline, right side only, top to bottom; the left is mirrored from
  // it so the shape cannot come out lopsided.
  function mirrored(c, pts) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    for (var j = pts.length - 1; j >= 0; j--) c.lineTo(-pts[j][0], pts[j][1]);
    c.closePath(); c.fill();
  }
  var SHAPES = {
    // Draws nothing: for a canvas that exists only to carry falling leaves,
    // so they can sit at full opacity over a dimmed texture canvas.
    none: function () {},
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
    },

    // ── Thanksgiving ─────────────────────────────────────────────
    turkey: function (c) {
      ball(c, function (c) {
        c.save(); c.translate(0, 0.08);
        // tail fan, then radial cuts to separate the feathers
        c.beginPath(); c.moveTo(0.02, 0.26);
        c.arc(0.02, 0.26, 1.0, Math.PI * 1.03, Math.PI * 1.97); c.closePath(); c.fill();
        cut(c, function (c) {
          for (var i = 0; i <= 6; i++) {
            var a = Math.PI * (1.03 + 0.94 * i / 6);
            c.moveTo(0.02 + Math.cos(a) * 0.26, 0.26 + Math.sin(a) * 0.26);
            c.lineTo(0.02 + Math.cos(a) * 1.02, 0.26 + Math.sin(a) * 1.02);
          }
        }, 0.05);
        cut(c, function (c) { c.arc(0.02, 0.26, 0.72, Math.PI * 1.03, Math.PI * 1.97); }, 0.04);
        // body, neck, head
        c.beginPath(); c.ellipse(0.0, 0.42, 0.44, 0.36, 0, 0, 7); c.fill();
        c.beginPath(); c.moveTo(0.1, 0.22);
        c.quadraticCurveTo(0.46, 0.14, 0.44, -0.12);
        c.lineTo(0.2, -0.12); c.quadraticCurveTo(0.2, 0.08, -0.04, 0.2);
        c.closePath(); c.fill();
        c.beginPath(); c.arc(0.33, -0.22, 0.18, 0, 7); c.fill();
        // beak and wattle
        c.beginPath(); c.moveTo(0.48, -0.26); c.lineTo(0.74, -0.18); c.lineTo(0.48, -0.1); c.closePath(); c.fill();
        c.beginPath(); c.ellipse(0.5, -0.02, 0.06, 0.13, 0, 0, 7); c.fill();
        // legs
        c.lineWidth = 0.065; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-0.1, 0.74); c.lineTo(-0.1, 0.92); c.moveTo(-0.24, 0.94); c.lineTo(0.02, 0.94);
        c.moveTo(0.16, 0.74); c.lineTo(0.16, 0.92); c.moveTo(0.02, 0.94); c.lineTo(0.28, 0.94);
        c.stroke();
        cut(c, function (c) { c.moveTo(0.37, -0.27); c.lineTo(0.38, -0.27); }, 0.075);   // eye
        c.restore();
      });
    },
    leaf: function (c) {
      ball(c, function (c) {
        c.rotate(-0.18);
        mirrored(c, [
          [0, -0.98], [0.26, -0.5], [0.62, -0.6], [0.5, -0.22],
          [1.0, -0.06], [0.58, 0.2], [0.68, 0.46], [0.26, 0.34],
          [0.1, 0.44], [0.09, 0.84]
        ]);
        cut(c, function (c) {                       // veins
          c.moveTo(0, 0.44); c.lineTo(0, -0.74);
          c.moveTo(0, -0.08); c.lineTo(0.56, -0.36); c.moveTo(0, -0.08); c.lineTo(-0.56, -0.36);
          c.moveTo(0, 0.18); c.lineTo(0.44, 0.3); c.moveTo(0, 0.18); c.lineTo(-0.44, 0.3);
        }, 0.05);
      });
    },
    // Trading cards, for the Rips board: two faces, so the rain reads as a
    // mix of cards rather than one shape repeating.
    //
    // The card fills the mask square and the particle gives it its portrait
    // shape, because a card drawn small inside the square sampled out nearly
    // square. Everything on it is sized against the thirteen cells it is
    // actually seen at, not the 56-pixel mask it is drawn in.
    //
    // The capsule is ours: a ball split by a band, with the Onyx mark for the
    // button. Not the red-and-white one, which is Nintendo's.
    cardBall: function (c) { cardFace(c, function (c, w, h) {
      var R = w * 0.25, cx = w / 2, cy = h / 2;
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill(); c.restore();
      c.beginPath(); c.rect(cx - R, cy - R * 0.2, R * 2, R * 0.4); c.fill();
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.beginPath(); c.arc(cx, cy, R * 0.36, 0, 7); c.fill(); c.restore();
    }); },
    cardSport: function (c) { cardFace(c, function (c, w, h) {
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.translate(w / 2, h / 2); c.rotate(-0.5); c.scale(w * 0.26, w * 0.26);
      c.beginPath(); c.moveTo(-1, 0);
      c.bezierCurveTo(-0.6, -0.78, 0.6, -0.78, 1, 0);
      c.bezierCurveTo(0.6, 0.78, -0.6, 0.78, -1, 0);
      c.fill(); c.restore();
      c.save(); c.translate(w / 2, h / 2); c.rotate(-0.5);
      c.lineWidth = w * 0.035; c.beginPath();
      c.moveTo(-w * 0.09, 0); c.lineTo(w * 0.09, 0); c.stroke();
      c.restore();
    }); },
    acorn: function (c) {
      ball(c, function (c) {
        c.beginPath(); c.moveTo(-0.66, -0.16);
        c.bezierCurveTo(-0.66, 0.96, 0.66, 0.96, 0.66, -0.16); c.closePath(); c.fill();
        c.beginPath(); c.ellipse(0, -0.26, 0.78, 0.36, 0, 0, 7); c.fill();
        cut(c, function (c) {
          for (var i = -3; i <= 3; i++) { c.moveTo(i * 0.2, -0.58); c.lineTo(i * 0.2, 0.04); }
          c.moveTo(-0.76, -0.1); c.lineTo(0.76, -0.1);
        }, 0.04);
        c.lineWidth = 0.12; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -0.54); c.lineTo(0.03, -0.9); c.stroke();
      });
    },
    pumpkin: function (c) {
      ball(c, function (c) {
        [[0, 0.78], [0.42, 0.56], [-0.42, 0.56], [0.72, 0.38], [-0.72, 0.38]].forEach(function (p) {
          c.beginPath(); c.ellipse(p[0], 0.1, p[1], 0.76, 0, 0, 7); c.fill();
        });
        cut(c, function (c) {
          [0.38, -0.38, 0.68, -0.68].forEach(function (x) {
            c.moveTo(x, -0.6); c.bezierCurveTo(x * 1.1, -0.1, x * 1.1, 0.4, x, 0.74);
          });
        }, 0.035);
        c.lineWidth = 0.12; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -0.62); c.lineTo(0.04, -0.92); c.stroke();
      });
    },
    wheat: function (c) {
      ball(c, function (c) {
        c.lineWidth = 0.07; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, 0.98); c.quadraticCurveTo(-0.1, 0.3, 0, -0.5); c.stroke();
        for (var i = 0; i < 6; i++) {
          var y = -0.52 + i * 0.26, sp = 0.16 + i * 0.055;
          [1, -1].forEach(function (s) {
            c.save(); c.translate(s * sp, y); c.rotate(s * 0.7);
            c.beginPath(); c.ellipse(0, 0, 0.085, 0.2, 0, 0, 7); c.fill(); c.restore();
          });
        }
        c.beginPath(); c.ellipse(0, -0.78, 0.085, 0.2, 0, 0, 7); c.fill();
      });
    }
  };

  // Falling particles draw a real silhouette from SHAPES, rasterised once into
  // an alpha grid here, then sampled per particle with its own rotation and
  // size. So a leaf on the wind is the same shape as the one in the harvest
  // row rather than a lookalike, and a board can fall something else entirely
  // by naming it: data-ox-leaves="card".
  // Exposed so the shape grid can be inspected at the size it is drawn at.
  if (typeof window !== 'undefined') window.__oxShapes = SHAPES;

  var LEAFN = 56, FALLMASKS = {};
  function fallMask(name) {
    if (FALLMASKS[name]) return FALLMASKS[name];
    var c = document.createElement('canvas'); c.width = c.height = LEAFN;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.strokeStyle = '#fff';
    (SHAPES[name] || SHAPES.leaf)(g);
    var d = g.getImageData(0, 0, LEAFN, LEAFN).data, a = new Float32Array(LEAFN * LEAFN);
    for (var i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    FALLMASKS[name] = a; return a;
  }

  // ── the renderer ───────────────────────────────────────────────
  var arts = [];
  function Art(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.shape = SHAPES[cv.dataset.oxArt] || SHAPES.mark;
    this.tone = TONES[cv.dataset.oxTone] || TONES.purple;
    this.cell = +cv.dataset.oxCell || 0;
    this.fade = cv.dataset.oxFade !== '0';
    this.calm = +cv.dataset.oxCalm || 1;    // < 1 = a quieter wave
    // data-ox-lens="0": no pointer bulge and no ripple ring. On the
    // Thanksgiving hero the pointer is supposed to shed leaves, and the lens
    // read as a competing water ripple underneath them.
    this.lens = cv.dataset.oxLens !== '0';
    this.mx = -1e4; this.my = -1e4; this.tx = -1e4; this.ty = -1e4;
    this.visible = false; this.t0 = performance.now();
    // data-ox-leaves: the pointer sheds leaves that flutter down and fade.
    // They keep falling after the pointer has gone, which is the whole charm
    // of it, so the frame loop stays awake while any are still in the air.
    this.leaves = []; this.leavesOn = cv.dataset.oxLeaves !== undefined;
    // data-ox-leaves names what falls. A comma separated list falls a mix,
    // picked per particle: one shape repeating reads as a pattern, not as a
    // handful of cards.
    this.fallShapes = (cv.dataset.oxLeaves || 'leaf').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
    this.fallShape = this.fallShapes[0];
    // Flat things keep their face to the viewer and rock; only a leaf tumbles.
    this.flat = this.fallShapes.every(function (s) { return s.indexOf('card') === 0; });
    this.leafTone = TONES[cv.dataset.oxLeafTone] || TONES.ember;
    // data-ox-rain="1.6": that many a second drift in from above the canvas
    // whether or not anyone is pointing at it, so the page rains on its own
    // and the pointer trail is an extra rather than the only way to see any.
    this.rain = +cv.dataset.oxRain || 0;
    this.lastSpawn = 0; this.lastRain = 0;
    this.resize();
    var self = this;
    var move = function (e) {
      var r = cv.getBoundingClientRect();
      self.tx = (e.clientX - r.left) / self.cw; self.ty = (e.clientY - r.top) / self.ch;
      // entering: jump straight to the pointer (easing in from -1e4 took 2-3 s to arrive)
      if (self.mx < -1e3) { self.mx = self.tx; self.my = self.ty; }
      self.hot = true;
      if (self.leavesOn && !REDUCED) {
        var nw = performance.now();
        // pointer speed in cells per second, so leaves can be thrown along the
        // direction of the swipe and shoved aside as it passes
        var gap = nw - (self.pt || nw - 16);
        if (gap > 0) {
          var ivx = (self.tx - (self.ptx === undefined ? self.tx : self.ptx)) * 1000 / gap;
          var ivy = (self.ty - (self.pty === undefined ? self.ty : self.pty)) * 1000 / gap;
          // a dropped frame should not read as a flick across the whole hero
          self.pvx = Math.max(-140, Math.min(140, ivx));
          self.pvy = Math.max(-140, Math.min(140, ivy));
        }
        self.pt = nw; self.ptx = self.tx; self.pty = self.ty;
        if (nw - self.lastSpawn > 26) {
          self.lastSpawn = nw;
          self.shed(self.tx, self.ty);
          // a fast drag lays down a denser trail, so the cascade keeps up
          if (Math.abs(self.pvx) + Math.abs(self.pvy) > 26) self.shed(self.tx, self.ty);
        }
      }
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
  // One leaf, dropped at the pointer. Everything is in grid cells per second,
  // so a leaf falls at the same apparent speed whatever the cell size.
  Art.prototype.shed = function (x, y, drifting) {
    // Particle size is in grid cells, and a phone has a third of the columns a
    // desktop does, so a card sized for the desktop hero covered a quarter of
    // the phone one. Scale the size and the count with the width of the grid.
    var k = this.flat ? Math.max(0.45, Math.min(1, this.cols / 150)) : 1;
    if (this.leaves.length > (this.flat ? Math.max(6, Math.round(16 * k)) : 46)) return;
    var r = Math.random;
    this.leaves.push({
      x: x + (r() - 0.5) * 2.2, y: y + (r() - 0.5) * 1.3,
      // In cells. A card needs more than a leaf: it is read by its straight
      // edges and its frame, and both need several cells each to exist.
      r: this.flat ? (6.6 + r() * 2.6) * k : 7.2 + r() * 4.6,
      // A card barely turns. Even a slow spin walks it to 90 degrees over a
      // ten second fall, and on its edge it is a stick, not a card.
      sh: this.fallShapes[(r() * this.fallShapes.length) | 0],
      rot: this.flat ? (r() - 0.5) * 0.36 : r() * 6.283,
      spin: (r() - 0.5) * (this.flat ? 0.1 : 3.4),
      // thrown along the swipe, then it bleeds off and it falls. One that
      // drifted in from above was never thrown, so it starts on the fall.
      vx: drifting ? (r() - 0.5) * 2.2 : (this.pvx || 0) * 0.3 + (r() - 0.5) * 3,
      // One that drifted in from above is already falling when it arrives,
      // rather than accelerating from nothing just inside the top edge.
      vy: drifting ? (this.flat ? 9 + r() * 6 : 1.4 + r() * 1.6)
                   : (this.pvy || 0) * 0.22 + (r() - 0.5) * 2,
      // The speed it settles to falling at, in cells a second. A card falls
      // several times faster than a leaf: at the leaf's pace it needed twenty
      // seconds to cross the hero, so it faded out halfway down and the rain
      // read as stuck rather than falling.
      term: this.flat ? 15 + r() * 9 : 2.6 + r() * 3.6,
      swayA: 1.4 + r() * 3, swayF: 0.8 + r() * 1.5, ph: r() * 6.283,
      // long enough to cross the hero rather than fade out halfway down it
      age: 0, life: drifting ? (this.flat ? 7 + r() * 3 : 9 + r() * 5)
                              : (this.flat ? 5 + r() * 2 : 4.2 + r() * 3.4)
    });
  };
  // Drop whatever is due from above the top edge. Called each frame; the rate
  // is per second, so it does not change with the frame rate or the cell size.
  Art.prototype.pour = function (now) {
    if (!this.rain || REDUCED || !this.cols) return;
    if (!this.lastRain) { this.lastRain = now; return; }
    var due = (now - this.lastRain) / 1000 * this.rain;
    if (due < 1) return;
    this.lastRain = now;
    for (var i = 0; i < Math.min(3, Math.floor(due)); i++) {
      this.shed(Math.random() * this.cols, -9, true);
    }
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
        var k = (this.lens && d2 < R2 * 9) ? Math.exp(-d2 / R2) : 0;
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
    // ── falling leaves ───────────────────────────────────────────
    // Advanced and drawn into their own buckets so they can carry a warmer
    // colour than the shape behind them, but through the same ramp and the
    // same grid, so they read as part of the art rather than sprites on top.
    var lb = null;
    if (this.leaves.length) {
      var ds = dt / 1000;
      lb = [[], [], [], [], [], [], [], []];
      for (var li = this.leaves.length - 1; li >= 0; li--) {
        var lf = this.leaves[li];
        lf.age += ds;

        // The pointer shoves leaves out of its way and drags them round it, so
        // moving through the cascade parts it instead of passing through. The
        // swirl term is what makes them curl rather than just scatter.
        if (this.tx > -1e3) {
          var px = lf.x - this.tx, py = (lf.y - this.ty) * 1.6;
          var pd2 = px * px + py * py, PR = 8;
          if (pd2 < PR * PR && pd2 > 0.01) {
            var pd = Math.sqrt(pd2), near = 1 - pd / PR;
            var sp = Math.min(70, Math.sqrt((this.pvx || 0) * (this.pvx || 0) + (this.pvy || 0) * (this.pvy || 0)));
            var shove = near * (7 + sp * 0.55) * ds;
            lf.vx += (px / pd) * shove + (-py / pd) * near * sp * 0.14 * ds;
            lf.vy += (py / pd) * shove * 0.5 + (px / pd) * near * sp * 0.11 * ds;
          }
        }

        // sideways motion bleeds off; downward settles back to a falling leaf
        var damp = Math.pow(0.1, ds);
        lf.vx *= damp;
        lf.vy += (lf.term - lf.vy) * Math.min(1, 2.6 * ds);

        lf.x += (lf.vx + Math.sin(lf.age * lf.swayF + lf.ph) * lf.swayA) * ds;
        lf.y += lf.vy * ds;
        lf.rot += lf.spin * ds;
        if (lf.age > lf.life || lf.y > rows + 3) { this.leaves.splice(li, 1); continue; }
        // in for a quarter second, out over the last second and a bit
        var la = Math.min(1, lf.age / 0.25) * Math.min(1, (lf.life - lf.age) / 1.2);
        // The leaf itself, sampled from the real maple silhouette rather than
        // approximated. A lobed blob never read as a leaf at any size; this is
        // the same shape the harvest row draws, rotated per particle.
        var LM = fallMask(lf.sh || this.fallShape), LN = LEAFN;
        var cs = Math.cos(lf.rot), sn = Math.sin(lf.rot);
        // A card is taller than it is wide; a leaf is drawn in a square.
        var rx = this.flat ? lf.r * 0.72 : lf.r, ry = lf.r;
        var x0 = Math.max(0, Math.floor(lf.x - rx - 1)), x1 = Math.min(cols - 1, Math.ceil(lf.x + rx + 1));
        var y0 = Math.max(0, Math.floor(lf.y - ry / 1.6 - 1)), y1 = Math.min(rows - 1, Math.ceil(lf.y + ry / 1.6 + 1));
        for (var ly = y0; ly <= y1; ly++) {
          for (var lx = x0; lx <= x1; lx++) {
            var ex = lx - lf.x, ey = (ly - lf.y) * 1.6;    // cells are taller than wide
            // rotate the sample back into the leaf's own frame
            var u = ex * cs + ey * sn, v = -ex * sn + ey * cs;
            if (u < -rx || u > rx || v < -ry || v > ry) continue;
            var mx = ((u / rx) * 0.5 + 0.5) * (LN - 1);
            var my = ((v / ry) * 0.5 + 0.5) * (LN - 1);
            var m = LM[(my | 0) * LN + (mx | 0)];
            if (m < 0.25) continue;
            var lv = m * la;
            if (lv < 0.08) continue;
            // Same brightness floor the shape pass uses, or they read as dirt.
            // Flat shapes get a higher one: a card is a big solid area, so at
            // the leaf's floor it sat at the same value as the texture behind
            // it and disappeared into it.
            var floor = this.flat ? 0.4 : 0.34;
            lb[Math.min(7, Math.floor((floor + (1 - floor) * lv) * 8))]
              .push(RAMP.charAt(1 + Math.floor(lv * (L - 1))), lx, ly);
          }
        }
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
    if (lb) {
      var ln = this.leafTone;
      for (var bl = 0; bl < 8; bl++) {
        var la2 = lb[bl]; if (!la2.length) continue;
        c.fillStyle = 'rgba(' + ln[0] + ',' + ln[1] + ',' + ln[2] + ',' + ((bl + 1) / 8).toFixed(3) + ')';
        for (var jl = 0; jl < la2.length; jl += 3) c.fillText(la2[jl], la2[jl + 1] * this.cw, la2[jl + 2] * this.ch);
      }
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
      // anything still in the air keeps its canvas on the full frame clock, so
      // it does not stutter at the idle 20fps once the pointer has gone. A
      // canvas that rains always has something coming, so it never idles.
      a.pour(now);
      if (a.hot || a.leaves.length || a.rain || idle) a.draw(now);
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
