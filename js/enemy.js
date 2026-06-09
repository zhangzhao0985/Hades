// js/enemy.js —— 近战追踪敌人（状态机：spawn → chase ↔ hurt → dead）
const Config = require('./config.js');
const { clamp, len, damp } = require('./utils.js');

let _eid = 0;

class Enemy {
  constructor(x, y) {
    const c = Config.enemy.melee;
    this.id = _eid++;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = c.radius;
    this.speed = c.speed;
    this.maxHp = c.maxHp;
    this.hp = c.maxHp;

    this.state = 'spawn';        // spawn | chase | hurt | dead
    this.spawnTimer = c.spawnTime;
    this.contactCd = 0;
    this.hitstun = 0;
    this.deadTimer = 0;
    this.hpFlash = 0;            // 受击白闪

    this.lastHitSwingId = -1;    // 防止同一次挥砍重复命中
    this.facing = 0;
    this.animTime = Math.random() * 10;
  }

  isAlive() { return this.state !== 'dead'; }
  isGone() { return this.state === 'dead' && this.deadTimer <= 0; }
  canDamagePlayer() { return this.state === 'chase' && this.contactCd <= 0; }

  update(dt, player, room) {
    if (this.contactCd > 0) this.contactCd -= dt;
    if (this.hpFlash > 0) this.hpFlash -= dt;

    if (this.state === 'dead') {
      this.deadTimer -= dt;
      return;
    }

    if (this.state === 'spawn') {
      this.spawnTimer -= dt;
      // 朝向玩家蓄势
      this.facing = Math.atan2(player.y - this.y, player.x - this.x);
      if (this.spawnTimer <= 0) this.state = 'chase';
    } else if (this.state === 'hurt') {
      this.hitstun -= dt;
      this.vx = damp(this.vx, 0, Config.enemy.melee.knockbackDecay, dt);
      this.vy = damp(this.vy, 0, Config.enemy.melee.knockbackDecay, dt);
      if (this.hitstun <= 0) this.state = 'chase';
    } else if (this.state === 'chase') {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const l = len(dx, dy) || 1;
      this.facing = Math.atan2(dy, dx);
      this.vx = dx / l * this.speed;
      this.vy = dy / l * this.speed;
      this.animTime += dt * 6;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 限制在房间内
    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }

  // 受击：扣血、击退、硬直；死亡进入消散
  takeDamage(dmg, hitX, hitY, knockback, hitstun) {
    if (this.state === 'dead') return;
    this.hp -= dmg;
    this.hpFlash = 0.12;

    const dx = this.x - hitX;
    const dy = this.y - hitY;
    const l = len(dx, dy) || 1;
    this.vx = dx / l * knockback;
    this.vy = dy / l * knockback;
    this.hitstun = Math.max(Config.enemy.melee.hitstunMin, hitstun);
    this.state = 'hurt';

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead';
      this.deadTimer = 0.35;
    }
  }

  draw(ctx) {
    if (this.state === 'dead') {
      const t = clamp(this.deadTimer / 0.35, 0, 1);
      ctx.globalAlpha = t;
      this._drawBody(ctx, this.radius * (0.6 + 0.4 * t));
      ctx.globalAlpha = 1;
      return;
    }

    let scale = 1;
    if (this.state === 'spawn') {
      const t = 1 - clamp(this.spawnTimer / Config.enemy.melee.spawnTime, 0, 1);
      scale = 0.2 + 0.8 * t;
      ctx.globalAlpha = t;
    }
    this._drawBody(ctx, this.radius * scale);
    ctx.globalAlpha = 1;

    if (this.state !== 'spawn' && this.hp < this.maxHp) this._drawHpBar(ctx);
  }

  _drawBody(ctx, r) {
    const P = Config.Palette;

    // 阴影
    ctx.save();
    ctx.translate(this.x, this.y + r * 0.7);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = P.shadow;
    ctx.fill();
    ctx.restore();

    const bob = Math.sin(this.animTime) * 2;
    const cy = this.y + bob;
    const flash = this.hpFlash > 0;

    // 身体
    const grad = ctx.createRadialGradient(
      this.x - r * 0.3, cy - r * 0.4, r * 0.2,
      this.x, cy, r
    );
    grad.addColorStop(0, flash ? '#ffffff' : P.enemyBodyLight);
    grad.addColorStop(1, flash ? '#ffd0d0' : P.enemyBody);
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.stroke();

    // 朝向玩家的双眼
    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
    const px = -fy, py = fx;
    const ex = this.x + fx * r * 0.32;
    const ey = cy + fy * r * 0.32;
    ctx.fillStyle = P.enemyEye;
    ctx.beginPath();
    ctx.arc(ex + px * r * 0.26, ey + py * r * 0.26, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - px * r * 0.26, ey - py * r * 0.26, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawHpBar(ctx) {
    const P = Config.Palette;
    const w = this.radius * 1.9;
    const h = 6;
    const x = this.x - w / 2;
    const y = this.y - this.radius - 16;
    ctx.fillStyle = P.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = P.hpFill;
    ctx.fillRect(x, y, w * clamp(this.hp / this.maxHp, 0, 1), h);
  }
}

module.exports = Enemy;
