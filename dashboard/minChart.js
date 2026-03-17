/* TabPulse — minChart.js
   Local drop-in for Chart.js (line, doughnut, bar)
   Fixes: "Chart is not defined" / CSP violation in MV3 */
(function(win) {
  'use strict';

  /* ── constructor ── */
  function Chart(canvas, cfg) {
    if (typeof canvas === 'string') canvas = document.getElementById(canvas);
    if (!canvas) return;
    this.canvas = canvas;
    this.cfg    = cfg;
    this.type   = cfg.type;
    this.data   = cfg.data   || { labels: [], datasets: [] };
    this.opts   = cfg.options || {};
    this._dead  = false;
    this._obs   = null;
    this._ctx   = canvas.getContext('2d');
    this._dpr   = window.devicePixelRatio || 1;
    this._w     = 300;
    this._h     = 200;
    this._resize();
    this._draw();
    this._observe();
  }

  Chart.prototype.destroy = function() {
    this._dead = true;
    if (this._obs) { this._obs.disconnect(); this._obs = null; }
  };

  Chart.prototype.update = function() { if (!this._dead) this._draw(); };

  Chart.prototype._resize = function() {
    var par = this.canvas.parentElement;
    if (!par) return;
    var dpr = this._dpr;
    var w   = par.clientWidth  || 300;
    var h   = par.clientHeight || 200;
    if (w < 4 || h < 4) return;
    this.canvas.width  = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = w; this._h = h;
  };

  Chart.prototype._observe = function() {
    var self = this;
    var par  = this.canvas.parentElement;
    if (!par || !window.ResizeObserver) return;
    this._obs = new ResizeObserver(function() {
      if (!self._dead) { self._resize(); self._draw(); }
    });
    this._obs.observe(par);
  };

  Chart.prototype._draw = function() {
    if (!this._ctx || this._dead) return;
    var ctx = this._ctx, w = this._w, h = this._h;
    ctx.clearRect(0, 0, w, h);
    if      (this.type === 'line')     this._line(ctx, w, h);
    else if (this.type === 'doughnut') this._donut(ctx, w, h);
    else if (this.type === 'bar')      this._bar(ctx, w, h);
  };

  /* ═══ LINE ═══ */
  Chart.prototype._line = function(ctx, W, H) {
    var data   = this.data, opts = this.opts;
    var sc     = opts.scales || {};
    var yO     = sc.y || {}, xO = sc.x || {};
    var showY  = yO.display !== false;
    var showX  = xO.display !== false;
    var PL = showY ? 58 : 8, PR = 10, PT = 10, PB = showX ? 28 : 8;
    var CW = W - PL - PR, CH = H - PT - PB;
    if (CW < 4 || CH < 4) return;

    var ds   = data.datasets || [];
    var vals = [];
    ds.forEach(function(d) { (d.data||[]).forEach(function(v){ if(isFinite(v)) vals.push(v); }); });
    if (!vals.length) { _nodata(ctx, W, H); return; }

    var vMin = Math.min(0, Math.min.apply(null, vals));
    var vMax = Math.max(Math.max.apply(null, vals), 1);
    var span = vMax - vMin || 1;
    var nL   = (data.labels || []).length;

    var sY = function(v) { return PT + CH - ((v - vMin) / span) * CH; };
    var sX = function(i) { return PL + (nL < 2 ? 0 : (i / (nL - 1)) * CW); };

    /* grid */
    ctx.strokeStyle = (yO.grid && yO.grid.color) || 'rgba(0,245,196,0.05)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = PT + (g/4)*CH;
      ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(PL+CW, gy); ctx.stroke();
    }

    /* Y ticks */
    if (showY) {
      var yCb = yO.ticks && yO.ticks.callback;
      ctx.fillStyle = (yO.ticks && yO.ticks.color) || 'rgba(230,237,243,0.3)';
      ctx.font = '9px ' + _ff(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (var t = 0; t <= 4; t++) {
        var tv = vMin + ((4-t)/4)*span;
        ctx.fillText(yCb ? yCb(tv) : _si(tv), PL-5, PT+(t/4)*CH);
      }
    }

    /* datasets */
    ds.forEach(function(d) {
      var pts = (d.data||[]).map(function(v,i){ return {x:sX(i), y:sY(v)}; });
      if (!pts.length) return;
      var bc  = d.borderColor || '#00f5c4';
      var bw  = d.borderWidth != null ? d.borderWidth : 2;
      var ten = d.tension || 0;
      var pr  = d.pointRadius != null ? d.pointRadius : 0;

      if (d.fill !== false && d.fill !== undefined) {
        ctx.beginPath();
        ten > 0 ? _curve(ctx,pts) : _poly(ctx,pts);
        ctx.lineTo(pts[pts.length-1].x, sY(vMin));
        ctx.lineTo(pts[0].x, sY(vMin));
        ctx.closePath();
        ctx.fillStyle = d.backgroundColor || 'rgba(0,245,196,0.08)';
        ctx.fill();
      }
      ctx.beginPath();
      ten > 0 ? _curve(ctx,pts) : _poly(ctx,pts);
      ctx.strokeStyle = bc; ctx.lineWidth = bw; ctx.stroke();

      if (pr > 0) {
        ctx.fillStyle = bc;
        pts.forEach(function(p){ ctx.beginPath(); ctx.arc(p.x,p.y,pr,0,Math.PI*2); ctx.fill(); });
      }
    });
  };

  /* ═══ DOUGHNUT ═══ */
  Chart.prototype._donut = function(ctx, W, H) {
    var data = this.data, opts = this.opts;
    var ds   = (data.datasets||[])[0];
    if (!ds) { _nodata(ctx, W, H); return; }
    var vals = ds.data || [];
    if (!vals.length) { _nodata(ctx, W, H); return; }

    var colors = ds.backgroundColor;
    if (!Array.isArray(colors)) colors = vals.map(function(_,i){ return 'hsl('+(i*37)+',60%,55%)'; });
    var total  = vals.reduce(function(a,b){ return a+b; }, 0) || 1;

    var co   = opts.cutout || '0%';
    var coR  = (typeof co === 'string' && co.slice(-1) === '%') ? parseFloat(co)/100 : 0;
    var R    = Math.min(W, H) / 2 - 6;
    var iR   = R * coR;
    var cx   = W/2, cy = H/2;
    var a    = -Math.PI/2;
    var bw   = ds.borderWidth != null ? ds.borderWidth : 2;

    vals.forEach(function(v, i) {
      var slice = (v/total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a, a+slice);
      ctx.closePath();
      ctx.fillStyle = colors[i] || '#94a3b8';
      ctx.fill();
      if (bw > 0) {
        ctx.strokeStyle = ds.borderColor || '#121821';
        ctx.lineWidth = bw; ctx.stroke();
      }
      a += slice;
    });
    if (iR > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, iR, 0, Math.PI*2);
      ctx.fillStyle = '#121821'; ctx.fill();
    }
  };

  /* ═══ BAR ═══ */
  Chart.prototype._bar = function(ctx, W, H) {
    var data   = this.data, opts = this.opts;
    var sc     = opts.scales || {};
    var yO     = sc.y || {}, xO = sc.x || {};
    var plugLeg = (opts.plugins && opts.plugins.legend) || {};
    var showLeg = plugLeg.display !== false && (data.datasets||[]).length > 1;
    var LH = showLeg ? 20 : 0;
    var PL = 62, PR = 10, PT = LH + 12, PB = 44;
    var CW = W - PL - PR, CH = H - PT - PB;
    if (CW < 4 || CH < 4) return;

    var labels   = data.labels   || [];
    var datasets = data.datasets || [];
    var allVals  = [];
    datasets.forEach(function(d){ (d.data||[]).forEach(function(v){ if(isFinite(v)) allVals.push(v); }); });
    if (!allVals.length) { _nodata(ctx, W, H); return; }
    var vMax = Math.max.apply(null, allVals.concat([1]));

    /* grid + Y */
    var yCb = yO.ticks && yO.ticks.callback;
    ctx.strokeStyle = (yO.grid && yO.grid.color) || 'rgba(0,245,196,0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = (yO.ticks && yO.ticks.color) || 'rgba(230,237,243,0.3)';
    ctx.font = '9px ' + _ff(); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var gy = PT + (g/4)*CH;
      ctx.beginPath(); ctx.moveTo(PL, gy); ctx.lineTo(PL+CW, gy); ctx.stroke();
      ctx.fillText(yCb ? yCb(((4-g)/4)*vMax) : _si(((4-g)/4)*vMax), PL-5, gy);
    }

    /* bars */
    var nG = labels.length, nS = datasets.length;
    var gW = CW / Math.max(nG, 1);
    var bW = (gW * 0.75) / Math.max(nS, 1);
    var gap = gW * 0.125;

    datasets.forEach(function(ds, di) {
      (ds.data||[]).forEach(function(v, i) {
        var bh = Math.max((v/vMax)*CH, 0);
        if (!bh) return;
        var x = PL + i*gW + gap + di*bW;
        var y = PT + CH - bh;
        ctx.fillStyle = Array.isArray(ds.backgroundColor) ? (ds.backgroundColor[i]||'#00f5c4') : (ds.backgroundColor||'#00f5c4');
        ctx.fillRect(x, y, Math.max(bW-2,1), bh);
      });
    });

    /* X labels */
    ctx.fillStyle = (xO.ticks && xO.ticks.color) || 'rgba(230,237,243,0.4)';
    ctx.font = '9px ' + _ff(); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var maxC = Math.max(Math.floor(gW/6), 3);
    labels.forEach(function(lbl, i) {
      var s = String(lbl); if (s.length > maxC) s = s.slice(0,maxC) + '\u2026';
      ctx.fillText(s, PL + i*gW + gW/2, PT+CH+5);
    });

    /* legend */
    if (showLeg) {
      var legCol = (plugLeg.labels && plugLeg.labels.color) || 'rgba(230,237,243,0.5)';
      var legSz  = (plugLeg.labels && plugLeg.labels.font && plugLeg.labels.font.size) || 10;
      ctx.font = legSz+'px '+_ff(); ctx.textBaseline = 'middle';
      var lx = PL, ly = LH/2;
      datasets.forEach(function(ds) {
        var col = Array.isArray(ds.backgroundColor) ? ds.backgroundColor[0] : (ds.backgroundColor||'#ccc');
        ctx.fillStyle = col; ctx.fillRect(lx, ly-4, 10, 8);
        ctx.fillStyle = legCol; ctx.textAlign = 'left';
        ctx.fillText(ds.label||'', lx+14, ly);
        lx += ctx.measureText(ds.label||'').width + 28;
      });
    }
  };

  /* ── helpers ── */
  function _poly(ctx, pts) {
    pts.forEach(function(p,i){ i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y); });
  }
  function _curve(ctx, pts) {
    if (pts.length < 2) { _poly(ctx,pts); return; }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length-1; i++) {
      var p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
      ctx.bezierCurveTo(
        p1.x+(p2.x-p0.x)/6, p1.y+(p2.y-p0.y)/6,
        p2.x-(p3.x-p1.x)/6, p2.y-(p3.y-p1.y)/6,
        p2.x, p2.y
      );
    }
  }
  function _nodata(ctx, W, H) {
    ctx.fillStyle = 'rgba(230,237,243,0.12)';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('No data yet', W/2, H/2);
  }
  function _si(v) {
    if (v >= 1073741824) return (v/1073741824).toFixed(1)+'G';
    if (v >= 1048576)    return (v/1048576).toFixed(1)+'M';
    if (v >= 1024)       return (v/1024).toFixed(0)+'K';
    return Math.round(v)+'B';
  }
  function _ff() { return Chart.defaults.font.family || 'monospace'; }

  Chart.defaults = {
    color: 'rgba(226,232,240,0.5)',
    borderColor: 'rgba(0,245,196,0.08)',
    font: { family: "'Space Mono', monospace" }
  };

  win.Chart = Chart;
})(window);
