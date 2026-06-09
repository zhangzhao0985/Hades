// js/projectile.js —— 弹射物（弓箭等），对象池管理
const Config = require('./config.js');

class Projectile {
  constructor() {
    this.active = false;
  }

  reset(o) {
    this.active = true;
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx;
    this.vy = o.vy;
    this.angle = o.angle != null ? o.angle : Math.atan2(o.vy, o.vx);
    this.radius = o.radius || 7;
    this.damage = o.damage || 0;
    this.knockback = o.knockback || 0;
    this.hitstun = o.hitstun || 0.1;
    this.life = o.maxLife || 1;
    this.color = o.color || '#8fd0ff';
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.active = false;
  }

  draw(ctx) {
    const len = 22, w = 4;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const tx = this.x + cos * len * 0.5, ty = this.y + sin * len * 0.5;
    const bx = this.x - cos * len * 0.5, by = this.y - sin * len * 0.5;
    // 拖尾辉光
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = w + 3;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // 箭体
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // 箭头
    ctx.fillStyle = this.color;
    const px = -sin, py = cos;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - cos * 7 + px * 4, ty - sin * 7 + py * 4);
    ctx.lineTo(tx - cos * 7 - px * 4, ty - sin * 7 - py * 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

class ProjectileManager {
  constructor(size) {
    this.pool = [];
    for (let i = 0; i < size; i++) this.pool.push(new Projectile());
  }

  spawn(o) {
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) { this.pool[i].reset(o); return this.pool[i]; }
    }
    this.pool[0].reset(o);
    return this.pool[0];
  }

  update(dt) {
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) this.pool[i].update(dt);
  }

  draw(ctx) {
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) this.pool[i].draw(ctx);
  }

  clear() {
    for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false;
  }

  forEachActive(fn) {
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) fn(this.pool[i]);
  }
}

module.exports = ProjectileManager;
