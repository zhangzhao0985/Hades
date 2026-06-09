// js/player.js —— 玩家：移动、武器驱动的普攻、特殊技、闪避、神怒能量、受击
const Config = require('./config.js');
const { WEAPONS } = require('./weapons.js');
const { clamp, len, damp } = require('./utils.js');

class Player {
  constructor(x, y) {
    this.weapon = WEAPONS.sword; // 默认武器，开局由武器选择覆盖
    this.reset(x, y);
  }

  setWeapon(w) { this.weapon = w; }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = Config.player.radius;
    this.speed = Config.player.speed;

    this.facing = -Math.PI / 2;
    this.moving = false;
    this.animTime = 0;

    this.hp = Config.player.maxHp;
    this.maxHp = Config.player.maxHp;
    this.stamina = Config.player.maxStamina;
    this.maxStamina = Config.player.maxStamina;
    this.staminaDelay = 0;

    this.energy = 0;
    this.maxEnergy = Config.player.maxEnergy;

    this.invuln = 0;
    this.stagger = 0;
    this.dead = false;

    // 普攻
    this.attacking = false;
    this.attackTimer = 0;
    this.attackFacing = this.facing;
    this.swingId = 0;
    this.comboIndex = 0;
    this.timeSinceSwing = 99;
    this.attackCd = 0;

    // 特殊技
    this.specialCd = 0;
    this.specialDir = this.facing;

    // 闪避
    this.dashing = false;
    this.dashTimer = 0;
    this.dashDirX = 0;
    this.dashDirY = 0;
    this.dashSpeed = 0;
    this.dashCd = 0;
  }

  _attackDuration() {
    const w = this.weapon;
    return w.windup + w.active + w.recover;
  }

  isInvincible() { return this.dashing || this.invuln > 0; }
  gainEnergy(n) { this.energy = Math.min(this.maxEnergy, this.energy + n); }
  energyFull() { return this.energy >= this.maxEnergy; }

  _aimDir(input) {
    const js = input.joystick;
    if (js.strength > 0) return Math.atan2(js.dy, js.dx);
    return this.facing;
  }

  update(dt, input, room) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.stagger > 0) this.stagger -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.specialCd > 0) this.specialCd -= dt;
    this.timeSinceSwing += dt;

    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.stamina < this.maxStamina) {
      this.stamina = Math.min(this.maxStamina, this.stamina + Config.player.staminaRegen * dt);
    }

    const js = input.joystick;

    if (this.dashing) {
      this.dashTimer -= dt;
      const t = clamp(this.dashTimer / Config.dash.duration, 0, 1);
      const sp = this.dashSpeed * (0.4 + 0.6 * t);
      this.vx = this.dashDirX * sp;
      this.vy = this.dashDirY * sp;
      if (this.dashTimer <= 0) this.dashing = false;
    } else if (this.stagger > 0) {
      this.vx = damp(this.vx, 0, 10, dt);
      this.vy = damp(this.vy, 0, 10, dt);
    } else {
      const moveScale = this.attacking ? this.weapon.moveScale : 1;
      const targetVx = js.dx * this.speed * moveScale;
      const targetVy = js.dy * this.speed * moveScale;
      this.vx = damp(this.vx, targetVx, Config.player.moveDamp, dt);
      this.vy = damp(this.vy, targetVy, Config.player.moveDamp, dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const sp = len(this.vx, this.vy);
    if (!this.attacking && !this.dashing && this.stagger <= 0 && js.strength > 0) {
      this.facing = Math.atan2(js.dy, js.dx);
    }
    if (this.attacking) this.facing = this.attackFacing;
    this.moving = sp > 8 && !this.attacking;
    this.animTime = this.moving ? this.animTime + dt * (4 + sp / this.speed * 6) : 0;

    if (this.attacking) {
      this.attackTimer += dt;
      if (this.attackTimer >= this._attackDuration()) this.attacking = false;
    }

    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }

  // 发起普攻；成功返回 true（引擎据武器类型决定挥砍/射箭）
  // aimOverride：指定攻击方向（自动攻击时朝最近敌人），不传则用摇杆/朝向
  tryAttack(input, aimOverride) {
    if (this.dead || this.dashing || this.attacking || this.attackCd > 0) return false;
    const w = this.weapon;
    const dir = (aimOverride != null) ? aimOverride : this._aimDir(input);
    this.attackFacing = dir;
    this.facing = dir;
    this.attacking = true;
    this.attackTimer = 0;
    this.swingId++;

    if (w.type === 'melee') {
      if (this.timeSinceSwing <= this._attackDuration() + w.comboWindow) {
        this.comboIndex = (this.comboIndex + 1) % 3;
      } else {
        this.comboIndex = 0;
      }
      this.attackCd = this._attackDuration() + w.gap;
    } else {
      this.comboIndex = 0;
      this.attackCd = w.fireInterval;
    }
    this.timeSinceSwing = 0;
    return true;
  }

  // 发起特殊技；成功返回 true（引擎执行其效果）
  trySpecial(input) {
    if (this.dead || this.dashing || this.specialCd > 0) return false;
    this.specialDir = this._aimDir(input);
    this.facing = this.specialDir;
    this.specialCd = this.weapon.special.cooldown;
    return true;
  }

  tryDash(input) {
    if (this.dead || this.dashing || this.dashCd > 0) return false;
    if (this.stamina < Config.dash.staminaCost) return false;
    const js = input.joystick;
    if (js.strength > 0) {
      const l = len(js.dx, js.dy) || 1;
      this.dashDirX = js.dx / l;
      this.dashDirY = js.dy / l;
    } else {
      this.dashDirX = Math.cos(this.facing);
      this.dashDirY = Math.sin(this.facing);
    }
    this.facing = Math.atan2(this.dashDirY, this.dashDirX);
    this.dashing = true;
    this.attacking = false;
    this.stagger = 0;
    this.dashTimer = Config.dash.duration;
    this.dashSpeed = Config.dash.distance / Config.dash.duration;
    this.invuln = Math.max(this.invuln, Config.dash.iFrames);
    this.dashCd = Config.dash.cooldown;
    this.stamina -= Config.dash.staminaCost;
    this.staminaDelay = Config.player.staminaRegenDelay;
    return true;
  }

  // 近战武器的当前攻击判定（扇形）；远程武器无近战判定
  getAttackHitbox() {
    if (!this.attacking) return null;
    const w = this.weapon;
    if (w.type !== 'melee') return null;
    const t = this.attackTimer;
    if (t < w.windup || t > w.windup + w.active) return null;
    const isThird = this.comboIndex === 2;
    return {
      x: this.x, y: this.y, facing: this.attackFacing,
      reach: w.reach + this.radius + (isThird ? w.thirdHitReachBonus : 0),
      halfAngle: w.halfAngle * (isThird ? 1.15 : 1),
      damage: w.basicDamage + (isThird ? w.thirdHitDamageBonus : 0),
      knockback: w.knockback + (isThird ? w.thirdHitKnockbackBonus : 0),
      hitstun: w.hitstun,
      swingId: this.swingId
    };
  }

  takeDamage(dmg, fromX, fromY) {
    if (this.dead || this.isInvincible()) return false;
    this.hp -= dmg;
    this.invuln = Config.player.hitInvuln;
    this.stagger = Config.player.staggerTime;
    const dx = this.x - fromX, dy = this.y - fromY;
    const l = len(dx, dy) || 1;
    const f = Config.player.knockbackTaken;
    this.vx = dx / l * f;
    this.vy = dy / l * f;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; }
    return true;
  }

  draw(ctx) {
    const r = this.radius;
    const P = Config.Palette;

    // 阴影
    ctx.save();
    ctx.translate(this.x, this.y + r * 0.72);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = P.shadow;
    ctx.fill();
    ctx.restore();

    // 走动时不再上下晃动（保持平稳）
    const cy = this.y;

    let alpha = 1;
    if (this.invuln > 0) {
      alpha = this.dashing ? 0.85 : (0.35 + 0.5 * Math.abs(Math.sin(this.invuln * 28)));
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    if (this.dashing) {
      ctx.beginPath();
      ctx.arc(this.x, cy, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = P.olympusBlueLight;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 远程武器：朝向瞄准线
    if (this.weapon.type === 'ranged') {
      const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
      ctx.strokeStyle = this.weapon.color;
      ctx.globalAlpha = alpha * 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x + fx * r, cy + fy * r);
      ctx.lineTo(this.x + fx * (r + 26), cy + fy * (r + 26));
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    const grad = ctx.createRadialGradient(this.x - r * 0.3, cy - r * 0.4, r * 0.2, this.x, cy, r);
    grad.addColorStop(0, P.bloodRedLight);
    grad.addColorStop(1, P.bloodRed);
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.olympusGold;
    ctx.stroke();

    // 朝向三角
    const fx = Math.cos(this.facing), fy = Math.sin(this.facing);
    const px = -fy, py = fx;
    ctx.beginPath();
    ctx.moveTo(this.x + fx * (r + 12), cy + fy * (r + 12));
    ctx.lineTo(this.x + fx * r * 0.55 + px * 10, cy + fy * r * 0.55 + py * 10);
    ctx.lineTo(this.x + fx * r * 0.55 - px * 10, cy + fy * r * 0.55 - py * 10);
    ctx.closePath();
    ctx.fillStyle = P.olympusGoldLight;
    ctx.fill();

    ctx.restore();
  }
}

module.exports = Player;
