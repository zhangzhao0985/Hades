// js/pickup.js —— 拾取物（回血/精华/能量），对象池 + 磁吸拾取
const Config = require('./config.js');

const COLORS = {
  health: { core: '#ff5e6a', glow: '#ff9ea6' },
  essence: { core: '#9b6fc4', glow: '#c9a8ff' },
  energy: { core: '#e08a2b', glow: '#ffe08a' }
};

class Pickup {
  constructor() { this.active = false; }
  reset(o) {
    this.active = true;
    this.type = o.type;
    this.value = o.value || 0;
    this.x = o.x; this.y = o.y;
    const a = Math.random() * Math.PI * 2;
    const sp = Config.pickup.popSpeed * (0.5 + Math.random() * 0.6);
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp;
    this.t = 0;
    this.life = Config.pickup.life;
    this.r = 9;
  }
  draw(ctx) {
    const c = COLORS[this.type] || COLORS.essence;
    const blink = (this.life - this.t < 2 && Math.sin(this.t * 18) < 0) ? 0.35 : 1;
    const bob = Math.sin(this.t * 4) * 2;
    const y = this.y + bob;
    ctx.save();
    ctx.globalAlpha = blink;
    // 外晕
    ctx.globalAlpha = blink * 0.4;
    ctx.fillStyle = c.glow;
    ctx.beginPath(); ctx.arc(this.x, y, this.r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = blink;
    ctx.fillStyle = c.core;
    ctx.beginPath(); ctx.arc(this.x, y, this.r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#0c0610'; ctx.stroke();
    // 图标
    ctx.fillStyle = '#fff7e0';
    if (this.type === 'health') {
      ctx.beginPath();
      ctx.arc(this.x - 2.5, y - 1, 2.4, 0, Math.PI * 2);
      ctx.arc(this.x + 2.5, y - 1, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath(); ctx.moveTo(this.x - 4.6, y); ctx.lineTo(this.x + 4.6, y); ctx.lineTo(this.x, y + 5); ctx.closePath(); ctx.fill();
    } else if (this.type === 'energy') {
      ctx.beginPath();
      ctx.moveTo(this.x + 1, y - 5); ctx.lineTo(this.x - 3, y + 1); ctx.lineTo(this.x, y + 1);
      ctx.lineTo(this.x - 1, y + 5); ctx.lineTo(this.x + 3, y - 1); ctx.lineTo(this.x, y - 1);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(this.x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

class PickupManager {
  constructor(size) {
    this.pool = [];
    for (let i = 0; i < size; i++) this.pool.push(new Pickup());
  }
  spawn(o) {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) { this.pool[i].reset(o); return this.pool[i]; }
    }
    this.pool[0].reset(o);
    return this.pool[0];
  }
  // onCollect(type, value) 在拾取时回调
  update(dt, player, onCollect) {
    const P = Config.pickup;
    const cr = player.radius + P.collectPad;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.t += dt;
      const dx = player.x - p.x, dy = player.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < P.magnetRange) {
        p.vx += dx / d * P.magnetAccel * dt;
        p.vy += dy / d * P.magnetAccel * dt;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > P.maxSpeed) { p.vx = p.vx / sp * P.maxSpeed; p.vy = p.vy / sp * P.maxSpeed; }
      } else {
        p.vx -= p.vx * 4 * dt;
        p.vy -= p.vy * 4 * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (d < cr) { onCollect(p.type, p.value); p.active = false; continue; }
      if (p.t >= p.life) p.active = false;
    }
  }
  draw(ctx, view) {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      if (view && (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1)) continue;
      p.draw(ctx);
    }
  }
  clear() { for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false; }
}

module.exports = PickupManager;
