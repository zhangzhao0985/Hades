// js/player.js —— 玩家：移动、普攻（扇形+三连）、闪避（位移+无敌帧+体力）、受击
const Config = require('./config.js');
const { clamp, len, damp } = require('./utils.js');

class Player {
  constructor(x, y) {
    this.reset(x, y);
  }

  // 复位（初始化 / 重新开始）
  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = Config.player.radius;
    this.speed = Config.player.speed;

    this.facing = -Math.PI / 2; // 朝向（弧度），初始朝上
    this.moving = false;
    this.animTime = 0;

    this.hp = Config.player.maxHp;
    this.maxHp = Config.player.maxHp;
    this.stamina = Config.player.maxStamina;
    this.maxStamina = Config.player.maxStamina;
    this.staminaDelay = 0;

    this.invuln = 0;          // 无敌剩余时间
    this.stagger = 0;         // 受击硬直（失控）剩余时间
    this.dead = false;

    // 普攻状态
    this.attacking = false;
    this.attackTimer = 0;
    this.attackFacing = this.facing;
    this.swingId = 0;
    this.comboIndex = 0;
    this.timeSinceSwing = 99;
    this.attackCd = 0;

    // 闪避状态
    this.dashing = false;
    this.dashTimer = 0;
    this.dashDirX = 0;
    this.dashDirY = 0;
    this.dashSpeed = 0;
    this.dashCd = 0;
  }

  _attackDuration() {
    const a = Config.attack;
    return a.windup + a.active + a.recover;
  }

  isInvincible() {
    return this.dashing || this.invuln > 0;
  }

  update(dt, input, room) {
    // 计时器
    if (this.invuln > 0) this.invuln -= dt;
    if (this.stagger > 0) this.stagger -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    this.timeSinceSwing += dt;

    // 体力回复
    if (this.staminaDelay > 0) {
      this.staminaDelay -= dt;
    } else if (this.stamina < this.maxStamina) {
      this.stamina = Math.min(this.maxStamina, this.stamina + Config.player.staminaRegen * dt);
    }

    const js = input.joystick;

    if (this.dashing) {
      // 闪避位移：略带减速
      this.dashTimer -= dt;
      const t = clamp(this.dashTimer / Config.dash.duration, 0, 1);
      const sp = this.dashSpeed * (0.4 + 0.6 * t);
      this.vx = this.dashDirX * sp;
      this.vy = this.dashDirY * sp;
      if (this.dashTimer <= 0) this.dashing = false;
    } else if (this.stagger > 0) {
      // 受击硬直：速度自然衰减
      this.vx = damp(this.vx, 0, 10, dt);
      this.vy = damp(this.vy, 0, 10, dt);
    } else {
      const moveScale = this.attacking ? Config.attack.moveScale : 1;
      const targetVx = js.dx * this.speed * moveScale;
      const targetVy = js.dy * this.speed * moveScale;
      this.vx = damp(this.vx, targetVx, Config.player.moveDamp, dt);
      this.vy = damp(this.vy, targetVy, Config.player.moveDamp, dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 朝向：移动时朝摇杆方向；攻击时锁定挥砍方向
    const sp = len(this.vx, this.vy);
    if (!this.attacking && !this.dashing && this.stagger <= 0 && js.strength > 0) {
      this.facing = Math.atan2(js.dy, js.dx);
    }
    if (this.attacking) this.facing = this.attackFacing;

    this.moving = sp > 8 && !this.attacking;
    this.animTime = this.moving ? this.animTime + dt * (4 + sp / this.speed * 6) : 0;

    // 普攻推进
    if (this.attacking) {
      this.attackTimer += dt;
      if (this.attackTimer >= this._attackDuration()) this.attacking = false;
    }

    // 限制在房间可行走区域（墙内）
    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }

  // 尝试发起一次普攻；成功返回 true（由引擎生成挥砍特效）
  tryAttack(input) {
    if (this.dead || this.dashing || this.attacking || this.attackCd > 0) return false;

    let dir = this.facing;
    const js = input.joystick;
    if (js.strength > 0) dir = Math.atan2(js.dy, js.dx);

    // 连击：在衔接窗口内则推进段数，否则重置
    if (this.timeSinceSwing <= this._attackDuration() + Config.attack.comboWindow) {
      this.comboIndex = (this.comboIndex + 1) % 3;
    } else {
      this.comboIndex = 0;
    }
    this.timeSinceSwing = 0;

    this.attacking = true;
    this.attackTimer = 0;
    this.attackFacing = dir;
    this.facing = dir;
    this.swingId++;
    this.attackCd = this._attackDuration() + Config.attack.gap;
    return true;
  }

  // 尝试闪避；成功返回 true
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
    this.attacking = false; // 闪避可取消攻击
    this.stagger = 0;
    this.dashTimer = Config.dash.duration;
    this.dashSpeed = Config.dash.distance / Config.dash.duration;
    this.invuln = Math.max(this.invuln, Config.dash.iFrames);
    this.dashCd = Config.dash.cooldown;
    this.stamina -= Config.dash.staminaCost;
    this.staminaDelay = Config.player.staminaRegenDelay;
    return true;
  }

  // 当前帧的攻击判定（扇形），无判定返回 null
  getAttackHitbox() {
    if (!this.attacking) return null;
    const a = Config.attack;
    const t = this.attackTimer;
    if (t < a.windup || t > a.windup + a.active) return null;

    const isThird = this.comboIndex === 2;
    return {
      x: this.x,
      y: this.y,
      facing: this.attackFacing,
      reach: a.reach + this.radius + (isThird ? a.thirdHitReachBonus : 0),
      halfAngle: a.halfAngle * (isThird ? 1.15 : 1),
      damage: a.damage + (isThird ? a.thirdHitDamageBonus : 0),
      knockback: a.knockback + (isThird ? a.thirdHitKnockbackBonus : 0),
      hitstun: a.hitstun,
      swingId: this.swingId
    };
  }

  // 受到伤害；真正掉血返回 true（无敌/已死时返回 false）
  takeDamage(dmg, fromX, fromY) {
    if (this.dead || this.isInvincible()) return false;
    this.hp -= dmg;
    this.invuln = Config.player.hitInvuln;
    this.stagger = Config.player.staggerTime;

    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const l = len(dx, dy) || 1;
    const f = Config.player.knockbackTaken;
    this.vx = dx / l * f;
    this.vy = dy / l * f;

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
    return true;
  }

  draw(ctx) {
    const r = this.radius;
    const P = Config.Palette;

    // 脚下椭圆阴影（不随闪烁，用 scale 画椭圆兼容性更好）
    ctx.save();
    ctx.translate(this.x, this.y + r * 0.72);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = P.shadow;
    ctx.fill();
    ctx.restore();

    const bob = this.moving ? Math.sin(this.animTime * Math.PI) * 3 : 0;
    const cy = this.y + bob;

    // 无敌闪烁透明度（闪避时保持较高亮度）
    let alpha = 1;
    if (this.invuln > 0) {
      alpha = this.dashing ? 0.85 : (0.35 + 0.5 * Math.abs(Math.sin(this.invuln * 28)));
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // 闪避光环
    if (this.dashing) {
      ctx.beginPath();
      ctx.arc(this.x, cy, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = P.olympusBlueLight;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 身体：径向渐变的暗红，金色描边
    const grad = ctx.createRadialGradient(
      this.x - r * 0.3, cy - r * 0.4, r * 0.2,
      this.x, cy, r
    );
    grad.addColorStop(0, P.bloodRedLight);
    grad.addColorStop(1, P.bloodRed);
    ctx.beginPath();
    ctx.arc(this.x, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.olympusGold;
    ctx.stroke();

    // 朝向三角（金色高光）
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
