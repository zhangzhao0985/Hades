// js/decor.js —— 地面装饰（草丛/花朵/蘑菇）：有体积、碰到会晃动，但不阻挡移动
const Config = require('./config.js');
function rnd(a, b) { return a + Math.random() * (b - a); }

const FLOWER_COLORS = ['#ff7eb0', '#ffd76a', '#8fd0ff', '#c89bff'];

class DecorField {
  constructor(arena) {
    this.items = [];
    const d = Config.decor;
    const wt = arena.wallThickness;
    for (let i = 0; i < d.count; i++) {
      this.items.push({
        x: rnd(arena.x + wt + 30, arena.x + arena.width - wt - 30),
        y: rnd(arena.y + wt + 30, arena.y + arena.height - wt - 30),
        type: d.types[Math.floor(Math.random() * d.types.length)],
        scale: rnd(0.8, 1.35),
        col: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
        wob: 0, dir: 0
      });
    }
  }

  // 玩家触碰则晃动（仅视觉，不改变玩家移动）
  update(dt, player) {
    const r = Config.decor.touchRadius;
    const rr = (r + player.radius) * (r + player.radius);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.wob > 0) it.wob -= dt;
      const dx = it.x - player.x, dy = it.y - player.y;
      if (dx * dx + dy * dy < rr) {
        it.wob = Config.decor.wobbleTime;
        it.dir = Math.atan2(dy, dx); // 朝远离玩家方向倾倒
      }
    }
  }

  draw(ctx, view) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (view && (it.x < view.x0 || it.x > view.x1 || it.y < view.y0 || it.y > view.y1)) continue;
      this._draw(ctx, it);
    }
  }

  _draw(ctx, it) {
    const wt = Config.decor.wobbleTime;
    const prog = it.wob > 0 ? (1 - it.wob / wt) : 0;
    const sway = it.wob > 0 ? Math.sin(prog * Math.PI * 4) * 0.35 * (it.wob / wt) : 0;
    const lean = Math.cos(it.dir);
    const s = it.scale;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(sway * lean);
    ctx.lineCap = 'round';
    if (it.type === 'grass') {
      ctx.strokeStyle = '#2f6b2a';
      ctx.lineWidth = 2.5 * s;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 3 * s, 0);
        ctx.quadraticCurveTo(k * 6 * s, -10 * s, k * 4 * s + (k === 0 ? 0 : k * 2), -18 * s);
        ctx.stroke();
      }
    } else if (it.type === 'flower') {
      ctx.strokeStyle = '#2f6b2a';
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18 * s); ctx.stroke();
      ctx.fillStyle = it.col;
      for (let k = 0; k < 5; k++) {
        const a = k * (Math.PI * 2 / 5) - Math.PI / 2;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 6 * s, -18 * s + Math.sin(a) * 6 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath(); ctx.arc(0, -18 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    } else { // mushroom
      ctx.fillStyle = '#e9dcc0';
      ctx.fillRect(-3 * s, -14 * s, 6 * s, 14 * s);
      ctx.fillStyle = '#d23b2e';
      ctx.beginPath(); ctx.arc(0, -14 * s, 11 * s, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#fff7e0';
      ctx.beginPath(); ctx.arc(-4 * s, -16 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4 * s, -15 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

module.exports = DecorField;
