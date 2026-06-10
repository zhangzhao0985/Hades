// js/room.js —— 房间：网格坐标 + 类型 + 门（缺口/锁闭/开启）+ 触发/落点辅助
const Config = require('./config.js');

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const EDGES = ['N', 'E', 'S', 'W'];

// 不同房型的地板配色（上→下渐变）
const FLOOR_TINT = {
  start:  ['#241b3a', '#1c1330'],
  normal: ['#241334', '#1c1330'],
  elite:  ['#3a1530', '#1c1330'],
  shop:   ['#2c2614', '#1c1330'],
  boss:   ['#3a0e14', '#1c0a10']
};

class Room {
  constructor(gx, gy, type) {
    this.gx = gx;
    this.gy = gy;
    this.type = type; // start | normal | elite | shop | boss

    this.doors = { N: false, E: false, S: false, W: false };
    this.cleared = !this.isCombat(); // 非战斗房默认通关
    this.visited = false;
    this.spawned = false;

    // 世界矩形（由 Dungeon.layout 赋值）
    this.x = 0;
    this.y = 0;
    this.width = Config.dungeon.roomW;
    this.height = Config.dungeon.roomH;
    this.wallThickness = Config.dungeon.wallThickness;
  }

  isCombat() { return this.type === 'normal' || this.type === 'elite' || this.type === 'boss'; }
  doorCount() { let n = 0; for (const e of EDGES) if (this.doors[e]) n++; return n; }
  centerX() { return this.x + this.width / 2; }
  centerY() { return this.y + this.height / 2; }

  // 门在墙线上的中心点
  doorCenter(edge) {
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    if (edge === 'N') return { x: cx, y: this.y };
    if (edge === 'S') return { x: cx, y: this.y + this.height };
    if (edge === 'E') return { x: this.x + this.width, y: cy };
    return { x: this.x, y: cy }; // W
  }

  // 从 edge 门进入时玩家落点（门内侧，留在触发区之外）
  entrance(edge) {
    const off = this.wallThickness + Config.dungeon.triggerDepth + 40 + 24;
    const c = this.doorCenter(edge);
    if (edge === 'N') return { x: c.x, y: c.y + off };
    if (edge === 'S') return { x: c.x, y: c.y - off };
    if (edge === 'E') return { x: c.x - off, y: c.y };
    return { x: c.x + off, y: c.y }; // W
  }

  // 玩家站位是否落在某个门的触发区内，返回 edge 或 null
  doorZoneEdge(px, py) {
    const wt = this.wallThickness;
    const td = Config.dungeon.triggerDepth;
    const dw = Config.dungeon.doorWidth;
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    const inX = Math.abs(px - cx) <= dw / 2;
    const inY = Math.abs(py - cy) <= dw / 2;
    if (this.doors.N && inX && py >= this.y + wt && py <= this.y + wt + td) return 'N';
    if (this.doors.S && inX && py <= this.y + this.height - wt && py >= this.y + this.height - wt - td) return 'S';
    if (this.doors.W && inY && px >= this.x + wt && px <= this.x + wt + td) return 'W';
    if (this.doors.E && inY && px <= this.x + this.width - wt && px >= this.x + this.width - wt - td) return 'E';
    return null;
  }

  // 门缺口在墙体上的矩形（用于绘制门扇/锁闭）
  _gapRect(edge) {
    const dw = Config.dungeon.doorWidth;
    const wt = this.wallThickness;
    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;
    if (edge === 'N') return { x: cx - dw / 2, y: this.y, w: dw, h: wt };
    if (edge === 'S') return { x: cx - dw / 2, y: this.y + this.height - wt, w: dw, h: wt };
    if (edge === 'E') return { x: this.x + this.width - wt, y: cy - dw / 2, w: wt, h: dw };
    return { x: this.x, y: cy - dw / 2, w: wt, h: dw }; // W
  }

  draw(ctx, view) {
    this._drawFloor(ctx, view);
    this._drawWalls(ctx);
    this._drawDoors(ctx);
    this._drawTypeMark(ctx);
  }

  _drawFloor(ctx, view) {
    const P = Config.Palette;
    const { x, y, width: w, height: h } = this;
    const tint = FLOOR_TINT[this.type] || FLOOR_TINT.normal;

    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, tint[0]);
    grad.addColorStop(1, tint[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // 网格纹理：仅绘制可视范围内的线（大竞技场性能优化）
    const step = 100;
    let gx0 = x + step, gx1 = x + w, gy0 = y + step, gy1 = y + h;
    let lineTop = y, lineBot = y + h, lineLeft = x, lineRight = x + w;
    if (view) {
      gx0 = Math.max(gx0, Math.floor((view.x0 - x) / step) * step + x);
      gx1 = Math.min(gx1, view.x1);
      gy0 = Math.max(gy0, Math.floor((view.y0 - y) / step) * step + y);
      gy1 = Math.min(gy1, view.y1);
      lineTop = Math.max(y, view.y0); lineBot = Math.min(y + h, view.y1);
      lineLeft = Math.max(x, view.x0); lineRight = Math.min(x + w, view.x1);
    }
    ctx.strokeStyle = P.floorLine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let gx = gx0; gx < gx1; gx += step) { ctx.moveTo(gx, lineTop); ctx.lineTo(gx, lineBot); }
    for (let gy = gy0; gy < gy1; gy += step) { ctx.moveTo(lineLeft, gy); ctx.lineTo(lineRight, gy); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _drawWalls(ctx) {
    const P = Config.Palette;
    const { x, y, width: w, height: h, wallThickness: wt } = this;
    const dw = Config.dungeon.doorWidth;
    ctx.fillStyle = P.wall;

    // 顶 / 底（留中间门缺口）
    if (this.doors.N) {
      const g0 = x + (w - dw) / 2, g1 = x + (w + dw) / 2;
      ctx.fillRect(x, y, g0 - x, wt);
      ctx.fillRect(g1, y, x + w - g1, wt);
    } else ctx.fillRect(x, y, w, wt);

    if (this.doors.S) {
      const g0 = x + (w - dw) / 2, g1 = x + (w + dw) / 2;
      ctx.fillRect(x, y + h - wt, g0 - x, wt);
      ctx.fillRect(g1, y + h - wt, x + w - g1, wt);
    } else ctx.fillRect(x, y + h - wt, w, wt);

    // 左 / 右
    if (this.doors.W) {
      const g0 = y + (h - dw) / 2, g1 = y + (h + dw) / 2;
      ctx.fillRect(x, y, wt, g0 - y);
      ctx.fillRect(x, g1, wt, y + h - g1);
    } else ctx.fillRect(x, y, wt, h);

    if (this.doors.E) {
      const g0 = y + (h - dw) / 2, g1 = y + (h + dw) / 2;
      ctx.fillRect(x + w - wt, y, wt, g0 - y);
      ctx.fillRect(x + w - wt, g1, wt, y + h - g1);
    } else ctx.fillRect(x + w - wt, y, wt, h);

    // 可行走区域内边发光线
    ctx.strokeStyle = P.lavaGlow;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + wt, y + wt, w - wt * 2, h - wt * 2);
    ctx.globalAlpha = 1;
  }

  _drawDoors(ctx) {
    for (const edge of EDGES) {
      if (this.doors[edge]) this._drawDoor(ctx, edge);
    }
  }

  _drawDoor(ctx, edge) {
    const P = Config.Palette;
    const g = this._gapRect(edge);
    if (this.cleared) {
      // 开启：发光门槛
      ctx.fillStyle = 'rgba(245,197,66,0.16)';
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.strokeStyle = P.olympusGoldLight;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.8;
      // 两侧门柱高光
      if (edge === 'N' || edge === 'S') {
        ctx.beginPath();
        ctx.moveTo(g.x, g.y); ctx.lineTo(g.x, g.y + g.h);
        ctx.moveTo(g.x + g.w, g.y); ctx.lineTo(g.x + g.w, g.y + g.h);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + g.w, g.y);
        ctx.moveTo(g.x, g.y + g.h); ctx.lineTo(g.x + g.w, g.y + g.h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      // 锁闭：暗色门扇 + 红色封印
      ctx.fillStyle = '#1a0c20';
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.strokeStyle = P.bloodRed;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(g.x + 3, g.y + 3, g.w - 6, g.h - 6);
      ctx.globalAlpha = 1;
    }
  }

  // 房间中央的类型标记（淡）；仅精英/商店/Boss 显示
  _drawTypeMark(ctx) {
    if (this.type !== 'elite' && this.type !== 'shop' && this.type !== 'boss') return;
    const P = Config.Palette;
    const cx = this.centerX(), cy = this.centerY();
    let label = '', color = P.textLight;
    if (this.type === 'elite') { label = '精英'; color = P.enemyBodyLight; }
    else if (this.type === 'shop') { label = '商店'; color = P.olympusGoldLight; }
    else if (this.type === 'boss') { label = 'BOSS'; color = P.bloodRedLight; }

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.font = 'bold 200px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }
}

Room.OPP = OPP;
Room.EDGES = EDGES;
module.exports = Room;
