// js/effects.js —— 打击/特效系统，使用对象池避免频繁创建销毁
const Config = require('./config.js');
const { clamp } = require('./utils.js');

class Effect {
  constructor() {
    this.active = false;
    this.type = '';
    this.t = 0;
    this.dur = 0.3;
  }

  reset(type, o) {
    this.active = true;
    this.type = type;
    this.t = 0;
    this.dur = o.dur || 0.3;
    this.x = o.x || 0;
    this.y = o.y || 0;
    this.vx = o.vx || 0;
    this.vy = o.vy || 0;
    this.angle = o.angle || 0;
    this.reach = o.reach || 24;
    this.half = o.half || 0.6;
    this.color = o.color || Config.Palette.slash;
    this.text = o.text != null ? String(o.text) : '';
    this.x2 = o.x2 != null ? o.x2 : this.x;
    this.y2 = o.y2 != null ? o.y2 : this.y;
    this.maxR = o.maxR || 160;
  }

  update(dt) {
    this.t += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.t >= this.dur) this.active = false;
  }

  draw(ctx) {
    const p = clamp(this.t / this.dur, 0, 1);
    switch (this.type) {
      case 'slash': this._slash(ctx, p); break;
      case 'hit': this._hit(ctx, p); break;
      case 'death': this._death(ctx, p); break;
      case 'dmg': this._dmg(ctx, p); break;
      case 'dashtrail': this._dash(ctx, p); break;
      case 'lightning': this._lightning(ctx, p); break;
      case 'shock': this._shock(ctx, p); break;
    }
  }

  // 冲击波环（旋斩 / 神怒大招）：从中心向外扩张并淡出
  _shock(ctx, p) {
    const r = this.maxR * (0.2 + 0.8 * p);
    ctx.save();
    ctx.translate(this.x, this.y);
    // 填充渐隐圆
    ctx.globalAlpha = (1 - p) * 0.35;
    const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, this.color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // 亮环
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 连锁闪电：抖动的折线 + 辉光
  _lightning(ctx, p) {
    const segs = 6;
    const nx = -(this.y2 - this.y);
    const ny = (this.x2 - this.x);
    const nl = Math.sqrt(nx * nx + ny * ny) || 1;
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = (1 - p) * (pass === 0 ? 0.5 : 1);
      ctx.strokeStyle = pass === 0 ? this.color : '#ffffff';
      ctx.lineWidth = pass === 0 ? 6 * (1 - p) + 1 : 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const mx = this.x + (this.x2 - this.x) * t;
        const my = this.y + (this.y2 - this.y) * t;
        const off = (Math.random() * 2 - 1) * 16;
        ctx.lineTo(mx + nx / nl * off, my + ny / nl * off);
      }
      ctx.lineTo(this.x2, this.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 扇形挥砍：随时间扫开并淡出
  _slash(ctx, p) {
    const a0 = this.angle - this.half;
    const a1 = this.angle - this.half + this.half * 2 * Math.min(1, p * 1.4);
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.55;
    const g = ctx.createRadialGradient(this.x, this.y, this.reach * 0.2, this.x, this.y, this.reach);
    g.addColorStop(0, 'rgba(255,224,138,0)');
    g.addColorStop(0.7, this.color);
    g.addColorStop(1, 'rgba(255,255,255,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.arc(this.x, this.y, this.reach, a0, a1);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.reach, a0, a1);
    ctx.stroke();
    ctx.restore();
  }

  // 命中火花：放射状短线 + 中心闪光
  _hit(ctx, p) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 3 * (1 - p) + 1;
    const n = 6;
    const r0 = 4 + 18 * p;
    const r1 = r0 + 12 * (1 - p);
    for (let i = 0; i < n; i++) {
      const a = this.angle + i * (Math.PI * 2 / n);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = (1 - p) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 6 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 敌人消散：扩散环 + 碎屑
  _death(ctx, p) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = (1 - p) * 0.8;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 4 * (1 - p);
    ctx.beginPath();
    ctx.arc(0, 0, 8 + 42 * p, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = Config.Palette.enemyBodyLight;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = i * (Math.PI * 2 / n);
      const rr = 10 + 50 * p;
      ctx.globalAlpha = 1 - p;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 3 * (1 - p) + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 飘字伤害数字
  _dmg(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 1 - p * p;
    ctx.fillStyle = this.color;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }

  // 闪避残影
  _dash(ctx, p) {
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.35;
    ctx.fillStyle = Config.Palette.olympusBlueLight;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class EffectsManager {
  constructor(size) {
    this.pool = [];
    for (let i = 0; i < size; i++) this.pool.push(new Effect());
  }

  spawn(type, opts) {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        this.pool[i].reset(type, opts);
        return this.pool[i];
      }
    }
    // 池满则复用第 0 个（极少发生）
    this.pool[0].reset(type, opts);
    return this.pool[0];
  }

  update(dt) {
    for (let i = 0; i < this.pool.length; i++) {
      if (this.pool[i].active) this.pool[i].update(dt);
    }
  }

  draw(ctx, view) {
    for (let i = 0; i < this.pool.length; i++) {
      const e = this.pool[i];
      if (!e.active) continue;
      if (view && (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1)) continue;
      e.draw(ctx);
    }
  }

  clear() {
    for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false;
  }
}

module.exports = EffectsManager;
