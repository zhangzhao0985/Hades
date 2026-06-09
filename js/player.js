// js/player.js —— 玩家：摇杆驱动的八方向（实为全向）移动，带平滑加减速
const Config = require('./config.js');
const { clamp, len, damp } = require('./utils.js');

class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = Config.player.radius;
    this.speed = Config.player.speed;

    this.facing = -Math.PI / 2; // 朝向（弧度），初始朝上
    this.moving = false;
    this.animTime = 0;          // 行走摆动计时
  }

  update(dt, input, room) {
    const js = input.joystick;

    // 摇杆向量决定目标速度，damp 实现顺滑加减速
    const targetVx = js.dx * this.speed;
    const targetVy = js.dy * this.speed;
    this.vx = damp(this.vx, targetVx, Config.player.moveDamp, dt);
    this.vy = damp(this.vy, targetVy, Config.player.moveDamp, dt);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const sp = len(this.vx, this.vy);
    this.moving = sp > 8;
    if (this.moving) {
      this.facing = Math.atan2(this.vy, this.vx);
      this.animTime += dt * (4 + (sp / this.speed) * 6);
    } else {
      this.animTime = 0;
    }

    // 限制在房间可行走区域（墙内）
    const minX = room.x + room.wallThickness + this.radius;
    const maxX = room.x + room.width - room.wallThickness - this.radius;
    const minY = room.y + room.wallThickness + this.radius;
    const maxY = room.y + room.height - room.wallThickness - this.radius;
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, minY, maxY);
  }

  draw(ctx) {
    const r = this.radius;
    const P = Config.Palette;

    // 脚下椭圆阴影（用 scale 画椭圆，兼容性更好）
    ctx.save();
    ctx.translate(this.x, this.y + r * 0.72);
    ctx.scale(1, 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = P.shadow;
    ctx.fill();
    ctx.restore();

    // 行走时身体轻微上下摆动
    const bob = this.moving ? Math.sin(this.animTime * Math.PI) * 3 : 0;
    const cy = this.y + bob;

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
    const px = -fy, py = fx; // 垂直向量
    ctx.beginPath();
    ctx.moveTo(this.x + fx * (r + 12), cy + fy * (r + 12));
    ctx.lineTo(this.x + fx * r * 0.55 + px * 10, cy + fy * r * 0.55 + py * 10);
    ctx.lineTo(this.x + fx * r * 0.55 - px * 10, cy + fy * r * 0.55 - py * 10);
    ctx.closePath();
    ctx.fillStyle = P.olympusGoldLight;
    ctx.fill();
  }
}

module.exports = Player;
