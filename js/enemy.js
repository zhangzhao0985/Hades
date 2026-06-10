// js/enemy.js —— 敌人：数据驱动（tier 等级 / behavior 行为 / ranged 远程）
// behavior: chaser（追击近战）/ shooter（保持距离放弹幕）/ charger（蓄力冲锋 Boss）
// 状态机：spawn → (chase | telegraph | charge | recover) ↔ hurt → dead
const Config = require('./config.js');
const { drawCharacter, SKINS } = require('./sprites.js');
const { clamp, len, damp } = require('./utils.js');

let _eid = 0;
function rnd(a, b) { return a + Math.random() * (b - a); }

class Enemy {
  constructor(x, y, type) {
    this.type = type || 'melee';
    const c = Config.enemy[this.type];
    this.def = c;
    this.stats = c;
    this.tier = c.tier;
    this.behavior = c.behavior;
    const sk = SKINS[c.color] || SKINS.melee;
    this.col = { body: sk.body, light: sk.bodyLight };

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
    this.swordHitCd = 0; // 玩家剑刃大招的每敌命中冷却

    // 远程
    this.wantsFire = false;
    this.bossPhase = 1;
    if (this.behavior === 'shooter') this.shootCd = rnd(0.4, c.ranged.cooldown);

    // Boss 专属技能
    this.skillRequest = false;
    this.skillToggle = 0;
    if (c.skillCdMin != null) this.skillCd = rnd(c.skillCdMin, c.skillCdMax);

    // 肥胖怪自爆
    this.wantsExplode = false;
    this.fuseTimer = 0;

    // 冲锋 Boss 专用
    if (this.behavior === 'charger') {
      this.chargeCd = rnd(c.chargeCdMin, c.chargeCdMax);
      this.teleTimer = 0;
      this.chargeTimer = 0;
      this.recoverTimer = 0;
      this.chargeDirX = 0;
      this.chargeDirY = 0;
    }

    this._killHandled = false;
  }

  isBoss() { return this.tier === 'boss'; }
  isAlive() { return this.state !== 'dead'; }
  isGone() { return this.state === 'dead' && this.deadTimer <= 0; }
  canDamagePlayer() { return (this.state === 'chase' || this.state === 'charge') && this.contactCd <= 0; }
  canBeDeflected() { return this.state !== 'dead' && this.state !== 'spawn' && this.deflectCd <= 0; }

  contactDamage() {
    let d = this.stats.contactDamage;
    if (this.behavior === 'charger' && this.state === 'charge') d *= this.stats.chargeDamageMul;
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
    } else if (this.behavior === 'charger') {
      this._bossBehavior(dt, player);
    } else if (this.behavior === 'shooter') {
      this._shooterBehavior(dt, player);
    } else if (this.behavior === 'bloater') {
      this._bloaterBehavior(dt, player);
    } else {
      this._chase(dt, player);
    }

    // Boss 专属技能计时（仅在普通追击/游走时触发，不打断冲锋）
    if (this.skillCd != null && this.state === 'chase') {
      this.skillCd -= dt;
      if (this.skillCd <= 0) {
        this.skillRequest = true;
        const mul = (this.tier === 'boss' && this.bossPhase === 2) ? 0.7 : 1;
        this.skillCd = rnd(this.def.skillCdMin, this.def.skillCdMax) * mul;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    const hitWall = this.x < minX || this.x > maxX || this.y < minY || this.y > maxY;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
    if (this.behavior === 'charger' && this.state === 'charge' && hitWall) {
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

  // 远程：保持在偏好距离放弹幕（近了后撤，远了靠近）
  _shooterBehavior(dt, player) {
    const r = this.def.ranged;
    const dx = player.x - this.x, dy = player.y - this.y;
    const d = len(dx, dy) || 1;
    this.facing = Math.atan2(dy, dx);
    const pref = r.preferred || r.range * 0.7;
    let mv = 0;
    if (d > pref * 1.12) mv = this.speed;
    else if (d < pref * 0.82) mv = -this.speed * 0.7;
    this.vx = dx / d * mv;
    this.vy = dy / d * mv;
    this.animTime += dt * 5;

    let cdMul = 1;
    if (this.tier === 'boss') {
      this.bossPhase = this.hp < this.maxHp * 0.5 ? 2 : 1;
      if (this.bossPhase === 2) cdMul = 0.6;
    }
    this.shootCd -= dt;
    if (this.shootCd <= 0 && d < r.range) {
      this.wantsFire = true;
      this.shootCd = r.cooldown * cdMul;
    }
  }

  // 肥胖怪：贴近 → 原地蓄力 fuseTime 秒 → 自爆
  _bloaterBehavior(dt, player) {
    const d = this.def;
    if (this.state === 'fuse') {
      this.vx = this.vy = 0;
      this.fuseTimer -= dt;
      if (this.fuseTimer <= 0) this.wantsExplode = true;
      return;
    }
    const dx = player.x - this.x, dy = player.y - this.y;
    const l = len(dx, dy) || 1;
    this.facing = Math.atan2(dy, dx);
    if (l <= this.radius + 58) {
      this.state = 'fuse';
      this.fuseTimer = d.fuseTime;
      this.vx = this.vy = 0;
    } else {
      this.vx = dx / l * this.speed;
      this.vy = dy / l * this.speed;
      this.animTime += dt * 6;
    }
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
      if (this.chargeTimer <= 0) { this.state = 'recover'; this.recoverTimer = s.recoverTime; }
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
    const colors = SKINS[this.def.color] || SKINS.melee;
    const feature = this.def.feature;
    const shape = this.def.shape;
    const fuse = (this.type === 'bloat' && this.state === 'fuse') ? clamp(1 - this.fuseTimer / this.def.fuseTime, 0, 1) : 0;

    if (this.state === 'dead') {
      const t = clamp(this.deadTimer / (this.isBoss() ? 0.7 : 0.35), 0, 1);
      drawCharacter(ctx, {
        x: this.x, y: this.y, r: this.radius * (0.6 + 0.4 * t),
        facing: this.facing, walk: this.animTime, moving: false,
        colors, feature, glowEyes: true, alpha: t, shape, fuse
      });
      return;
    }

    let scale = 1, alpha = 1;
    if (this.state === 'spawn') {
      const t = 1 - clamp(this.spawnTimer / this.stats.spawnTime, 0, 1);
      scale = 0.3 + 0.7 * t;
      alpha = t;
    }

    if (this.behavior === 'charger' && this.state === 'telegraph') this._drawTelegraph(ctx);
    if (this.behavior === 'charger' && this.state === 'charge') this._drawChargeTrail(ctx);

    const moving = this.state === 'chase' || this.state === 'charge';
    drawCharacter(ctx, {
      x: this.x, y: this.y, r: this.radius * scale,
      facing: this.facing, walk: this.animTime, moving,
      colors, feature, glowEyes: true, alpha, shape, fuse
    });

    if (this.state !== 'spawn') {
      this._drawStatus(ctx);
      if (!this.isBoss() && this.hp < this.maxHp) this._drawHpBar(ctx);
    }
  }

  _drawTelegraph(ctx) {
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
    ctx.fillStyle = this.tier === 'elite' ? P.lavaGlow : P.hpFill;
    ctx.fillRect(x, y, w * clamp(this.hp / this.maxHp, 0, 1), h);
  }
}

module.exports = Enemy;
