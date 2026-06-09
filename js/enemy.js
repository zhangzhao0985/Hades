// js/enemy.js —— 敌人：普通近战 / 精英 / Boss（kind 驱动）
// 状态机：spawn → (chase | telegraph | charge | recover) ↔ hurt → dead
// Boss 不进入 hurt 硬直，拥有蓄力冲锋技能与二阶段。
const Config = require('./config.js');
const { clamp, len, damp } = require('./utils.js');

let _eid = 0;

// 各 kind 的配色
function colorsOf(kind) {
  const P = Config.Palette;
  if (kind === 'elite') return { body: '#b5471f', light: '#ff8a3d' };
  if (kind === 'boss') return { body: '#7a0e1a', light: '#e8453a' };
  return { body: P.enemyBody, light: P.enemyBodyLight };
}

function rnd(a, b) { return a + Math.random() * (b - a); }

class Enemy {
  constructor(x, y, kind) {
    this.kind = kind || 'melee';
    const c = Config.enemy[this.kind];
    this.stats = c;
    this.col = colorsOf(this.kind);

    this.id = _eid++;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = c.radius;
    this.speed = c.speed;
    this.maxHp = c.maxHp;
    this.hp = c.maxHp;

    this.state = 'spawn';
    this.spawnTimer = c.spawnTime;
    this.contactCd = 0;
    this.hitstun = 0;
    this.deadTimer = 0;
    this.hpFlash = 0;

    this.lastHitSwingId = -1;
    this.facing = 0;
    this.animTime = Math.random() * 10;

    // 祝福状态
    this.bleedDps = 0;
    this.bleedTimer = 0;
    this.weakMul = 1;
    this.weakTimer = 0;
    this.deflectCd = 0;

    // Boss 专用
    if (this.kind === 'boss') {
      this.bossPhase = 1;
      this.chargeCd = rnd(c.chargeCdMin, c.chargeCdMax);
      this.teleTimer = 0;
      this.chargeTimer = 0;
      this.recoverTimer = 0;
      this.chargeDirX = 0;
      this.chargeDirY = 0;
    }

    this._killHandled = false;
  }

  isBoss() { return this.kind === 'boss'; }
  isAlive() { return this.state !== 'dead'; }
  isGone() { return this.state === 'dead' && this.deadTimer <= 0; }
  canDamagePlayer() { return (this.state === 'chase' || this.state === 'charge') && this.contactCd <= 0; }
  canBeDeflected() { return this.state !== 'dead' && this.state !== 'spawn' && this.deflectCd <= 0; }

  // 当前接触伤害（Boss 冲锋更痛；虚弱降低）
  contactDamage() {
    let d = this.stats.contactDamage;
    if (this.kind === 'boss' && this.state === 'charge') d *= this.stats.chargeDamageMul;
    return d * this.weakMul;
  }

  update(dt, player, room) {
    if (this.contactCd > 0) this.contactCd -= dt;
    if (this.deflectCd > 0) this.deflectCd -= dt;
    if (this.hpFlash > 0) this.hpFlash -= dt;

    if (this.state === 'dead') { this.deadTimer -= dt; return; }

    if (this.state === 'spawn') {
      this.spawnTimer -= dt;
      this.facing = Math.atan2(player.y - this.y, player.x - this.x);
      if (this.spawnTimer <= 0) this.state = 'chase';
    } else if (this.state === 'hurt') {
      this.hitstun -= dt;
      this.vx = damp(this.vx, 0, this.stats.knockbackDecay, dt);
      this.vy = damp(this.vy, 0, this.stats.knockbackDecay, dt);
      if (this.hitstun <= 0) this.state = 'chase';
    } else if (this.kind === 'boss') {
      this._bossBehavior(dt, player);
    } else {
      this._chase(dt, player);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 限制在竞技场内（Boss 冲锋撞墙则结束冲锋）
    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    const hitWall = this.x < minX || this.x > maxX || this.y < minY || this.y > maxY;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
    if (this.kind === 'boss' && this.state === 'charge' && hitWall) {
      this.state = 'recover';
      this.recoverTimer = this.stats.recoverTime;
      this.vx = this.vy = 0;
    }
  }

  _chase(dt, player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const l = len(dx, dy) || 1;
    this.facing = Math.atan2(dy, dx);
    this.vx = dx / l * this.speed;
    this.vy = dy / l * this.speed;
    this.animTime += dt * 6;
  }

  _bossBehavior(dt, player) {
    const s = this.stats;
    this.bossPhase = this.hp < this.maxHp * 0.5 ? 2 : 1;
    const spdMul = this.bossPhase === 2 ? s.phase2SpeedMul : 1;

    if (this.state === 'chase') {
      const dx = player.x - this.x, dy = player.y - this.y;
      const l = len(dx, dy) || 1;
      this.facing = Math.atan2(dy, dx);
      this.vx = dx / l * this.speed * spdMul;
      this.vy = dy / l * this.speed * spdMul;
      this.animTime += dt * 5;
      this.chargeCd -= dt;
      if (this.chargeCd <= 0 && l < s.chargeRange) {
        this.state = 'telegraph';
        this.teleTimer = s.telegraphTime;
        this.vx = this.vy = 0;
      }
    } else if (this.state === 'telegraph') {
      this.teleTimer -= dt;
      this.facing = Math.atan2(player.y - this.y, player.x - this.x);
      this.vx = this.vy = 0;
      if (this.teleTimer <= 0) {
        this.chargeDirX = Math.cos(this.facing);
        this.chargeDirY = Math.sin(this.facing);
        this.state = 'charge';
        this.chargeTimer = s.chargeTime;
      }
    } else if (this.state === 'charge') {
      this.vx = this.chargeDirX * s.chargeSpeed;
      this.vy = this.chargeDirY * s.chargeSpeed;
      this.chargeTimer -= dt;
      if (this.chargeTimer <= 0) {
        this.state = 'recover';
        this.recoverTimer = s.recoverTime;
      }
    } else if (this.state === 'recover') {
      this.vx = damp(this.vx, 0, 8, dt);
      this.vy = damp(this.vy, 0, 8, dt);
      this.recoverTimer -= dt;
      if (this.recoverTimer <= 0) {
        this.state = 'chase';
        this.chargeCd = rnd(s.chargeCdMin, s.chargeCdMax) * (this.bossPhase === 2 ? s.phase2CdMul : 1);
      }
    }
  }

  updateStatus(dt) {
    if (this.weakTimer > 0) { this.weakTimer -= dt; if (this.weakTimer <= 0) this.weakMul = 1; }
    let died = false;
    if (this.bleedTimer > 0 && this.state !== 'dead') {
      this.bleedTimer -= dt;
      const before = this.hp;
      this.hp -= this.bleedDps * dt;
      this.hpFlash = Math.max(this.hpFlash, 0.03);
      if (before > 0 && this.hp <= 0) {
        this.hp = 0; this.state = 'dead'; this.deadTimer = this.isBoss() ? 0.7 : 0.35;
        died = true;
      }
    }
    return died;
  }

  takeDamage(dmg, hitX, hitY, knockback, hitstun) {
    if (this.state === 'dead') return;
    this.hp -= dmg;
    this.hpFlash = 0.12;

    const dx = this.x - hitX, dy = this.y - hitY;
    const l = len(dx, dy) || 1;
    const kbf = knockback * this.stats.knockbackResist;
    this.vx = dx / l * kbf;
    this.vy = dy / l * kbf;

    // 可硬直的敌人进入 hurt（不打断 Boss 的冲锋/蓄力）
    if (this.stats.stunnable && this.state !== 'charge' && this.state !== 'telegraph') {
      this.hitstun = Math.max(this.stats.hitstunMin, hitstun);
      this.state = 'hurt';
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead';
      this.deadTimer = this.isBoss() ? 0.7 : 0.35;
    }
  }

  applyBleed(dps, dur) {
    this.bleedDps = Math.max(this.bleedDps, dps);
    this.bleedTimer = Math.max(this.bleedTimer, dur);
  }
  applyWeak(mul, dur) {
    this.weakMul = mul;
    this.weakTimer = Math.max(this.weakTimer, dur);
  }

  // ---- 绘制 ----
  draw(ctx) {
    if (this.state === 'dead') {
      const t = clamp(this.deadTimer / (this.isBoss() ? 0.7 : 0.35), 0, 1);
      ctx.globalAlpha = t;
      this._drawBody(ctx, this.radius * (0.6 + 0.4 * t));
      ctx.globalAlpha = 1;
      return;
    }

    let scale = 1;
    if (this.state === 'spawn') {
      const t = 1 - clamp(this.spawnTimer / this.stats.spawnTime, 0, 1);
      scale = 0.2 + 0.8 * t;
      ctx.globalAlpha = t;
    }

    if (this.kind === 'boss' && this.state === 'telegraph') this._drawTelegraph(ctx);
    if (this.kind === 'boss' && this.state === 'charge') this._drawChargeTrail(ctx);

    this._drawBody(ctx, this.radius * scale);
    ctx.globalAlpha = 1;

    if (this.state !== 'spawn') {
      this._drawStatus(ctx);
      // Boss 用屏幕顶部血条（引擎绘制），其余用头顶血条
      if (!this.isBoss() && this.hp < this.maxHp) this._drawHpBar(ctx);
    }
  }

  _drawTelegraph(ctx) {
    // 红色瞄准线，预示冲锋方向
    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
    const pulse = 0.5 + 0.5 * Math.sin(this.teleTimer * 18);
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.4 * pulse;
    ctx.strokeStyle = Config.Palette.bloodRedLight;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + fx * this.stats.chargeRange, this.y + fy * this.stats.chargeRange);
    ctx.stroke();
    ctx.restore();
  }

  _drawChargeTrail(ctx) {
    ctx.save();
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.18 * (3 - i + 1);
      ctx.fillStyle = this.col.light;
      ctx.beginPath();
      ctx.arc(this.x - this.chargeDirX * i * 22, this.y - this.chargeDirY * i * 22, this.radius * (1 - i * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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

    // Boss / 精英的尖刺冠
    if (this.kind !== 'melee') {
      ctx.fillStyle = flash ? '#ffffff' : this.col.body;
      const spikes = this.kind === 'boss' ? 9 : 6;
      ctx.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2 + this.animTime * 0.2;
        ctx.moveTo(this.x, cy);
        ctx.lineTo(this.x + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35);
        ctx.lineTo(this.x + Math.cos(a + 0.3) * r * 0.9, cy + Math.sin(a + 0.3) * r * 0.9);
      }
      ctx.fill();
    }

    const grad = ctx.createRadialGradient(this.x - r * 0.3, cy - r * 0.4, r * 0.2, this.x, cy, r);
    grad.addColorStop(0, flash ? '#ffffff' : this.col.light);
    grad.addColorStop(1, flash ? '#ffd0d0' : this.col.body);
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = this.isBoss() ? 3 : 2;
    ctx.strokeStyle = this.isBoss() ? P.olympusGold : 'rgba(0,0,0,0.4)';
    ctx.stroke();

    // 眼睛
    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
    const px = -fy, py = fx;
    const ex = this.x + fx * r * 0.32;
    const ey = cy + fy * r * 0.32;
    const er = r * 0.12;
    ctx.fillStyle = P.enemyEye;
    ctx.beginPath();
    ctx.arc(ex + px * r * 0.26, ey + py * r * 0.26, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - px * r * 0.26, ey - py * r * 0.26, er, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawStatus(ctx) {
    if (this.bleedTimer > 0) {
      ctx.strokeStyle = Config.Palette.bloodRed;
      ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (this.weakTimer > 0) {
      ctx.strokeStyle = '#ff9ed2';
      ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawHpBar(ctx) {
    const P = Config.Palette;
    const w = this.radius * 1.9, h = 6;
    const x = this.x - w / 2, y = this.y - this.radius - 16;
    ctx.fillStyle = P.hpBack;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = this.kind === 'elite' ? P.lavaGlow : P.hpFill;
    ctx.fillRect(x, y, w * clamp(this.hp / this.maxHp, 0, 1), h);
  }
}

module.exports = Enemy;
