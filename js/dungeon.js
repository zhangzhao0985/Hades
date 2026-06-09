// js/dungeon.js —— 地牢生成：网格随机扩展、连门、分配房型、走廊与小地图绘制
const Config = require('./config.js');
const Room = require('./room.js');

const DIRS = [
  { dx: 0, dy: -1, edge: 'N' },
  { dx: 1, dy: 0, edge: 'E' },
  { dx: 0, dy: 1, edge: 'S' },
  { dx: -1, dy: 0, edge: 'W' }
];

class Dungeon {
  constructor() {
    this.rooms = [];
    this.grid = {};
    this.start = null;
    this._generate();
    this._layout();
  }

  key(gx, gy) { return gx + ',' + gy; }
  get(gx, gy) { return this.grid[this.key(gx, gy)] || null; }

  _add(room) {
    this.rooms.push(room);
    this.grid[this.key(room.gx, room.gy)] = room;
  }

  _generate() {
    const d = Config.dungeon;
    const target = d.minRooms + Math.floor(Math.random() * (d.maxRooms - d.minRooms + 1));

    const start = new Room(0, 0, 'start');
    this._add(start);
    this.start = start;

    // 随机扩展：从已有房间向空邻格生长
    let guard = 0;
    while (this.rooms.length < target && guard < 2000) {
      guard++;
      const base = this.rooms[Math.floor(Math.random() * this.rooms.length)];
      const dir = DIRS[Math.floor(Math.random() * DIRS.length)];
      const nx = base.gx + dir.dx, ny = base.gy + dir.dy;
      if (this.get(nx, ny)) continue;
      // 控制邻居数量：避免房间挤成一团（新格周围已存在的房间不超过 2）
      let around = 0;
      for (const dd of DIRS) if (this.get(nx + dd.dx, ny + dd.dy)) around++;
      if (around > 2) continue;
      this._add(new Room(nx, ny, 'normal'));
    }

    this._connect();
    this._assignTypes();
    this._assignEnemies();
  }

  // 依据相邻关系连通门
  _connect() {
    for (const r of this.rooms) {
      for (const dir of DIRS) {
        if (this.get(r.gx + dir.dx, r.gy + dir.dy)) r.doors[dir.edge] = true;
      }
    }
  }

  // BFS 距离（按门连通）
  _bfsDist(from) {
    const dist = {};
    dist[this.key(from.gx, from.gy)] = 0;
    const q = [from];
    while (q.length) {
      const r = q.shift();
      const base = dist[this.key(r.gx, r.gy)];
      for (const dir of DIRS) {
        if (!r.doors[dir.edge]) continue;
        const n = this.get(r.gx + dir.dx, r.gy + dir.dy);
        if (!n) continue;
        const k = this.key(n.gx, n.gy);
        if (dist[k] === undefined) { dist[k] = base + 1; q.push(n); }
      }
    }
    return dist;
  }

  _assignTypes() {
    const dist = this._bfsDist(this.start);
    // 死胡同（只有 1 个门）按距起点远近排序
    const deadends = this.rooms
      .filter((r) => r !== this.start && r.doorCount() === 1)
      .sort((a, b) => dist[this.key(b.gx, b.gy)] - dist[this.key(a.gx, a.gy)]);

    const used = new Set();
    const take = (type) => {
      const r = deadends.find((x) => !used.has(x));
      if (r) { r.type = type; r.cleared = !r.isCombat(); used.add(r); return r; }
      return null;
    };

    // 最远死胡同 = Boss；否则取整体最远房间
    if (!take('boss')) {
      let far = this.start, fd = -1;
      for (const r of this.rooms) {
        const dd = dist[this.key(r.gx, r.gy)] || 0;
        if (r !== this.start && dd > fd) { fd = dd; far = r; }
      }
      if (far !== this.start) { far.type = 'boss'; far.cleared = false; }
    }
    take('shop');
    take('elite');
  }

  _assignEnemies() {
    for (const r of this.rooms) {
      r.cleared = !r.isCombat();
    }
  }

  // 依网格坐标铺到世界空间（含走廊间距）
  _layout() {
    const d = Config.dungeon;
    const stepX = d.roomW + d.corridor;
    const stepY = d.roomH + d.corridor;
    for (const r of this.rooms) {
      r.width = d.roomW;
      r.height = d.roomH;
      r.wallThickness = d.wallThickness;
      r.x = r.gx * stepX;
      r.y = r.gy * stepY;
    }
  }

  // 绘制走廊（仅画每个房间的 E、S 方向，避免重复）
  drawCorridors(ctx, drawSet) {
    const P = Config.Palette;
    const dw = Config.dungeon.doorWidth;
    for (const r of drawSet) {
      if (r.doors.E) {
        const b = this.get(r.gx + 1, r.gy);
        if (b) this._corridorH(ctx, r, b, dw, P);
      }
      if (r.doors.S) {
        const b = this.get(r.gx, r.gy + 1);
        if (b) this._corridorV(ctx, r, b, dw, P);
      }
    }
  }

  _corridorH(ctx, a, b, dw, P) {
    const wt = a.wallThickness;
    const cy = a.centerY();
    const x0 = a.x + a.width;
    const x1 = b.x;
    ctx.fillStyle = P.floor;
    ctx.fillRect(x0, cy - dw / 2, x1 - x0, dw);
    ctx.fillStyle = P.wall;
    ctx.fillRect(x0, cy - dw / 2 - wt, x1 - x0, wt);
    ctx.fillRect(x0, cy + dw / 2, x1 - x0, wt);
  }

  _corridorV(ctx, a, b, dw, P) {
    const wt = a.wallThickness;
    const cx = a.centerX();
    const y0 = a.y + a.height;
    const y1 = b.y;
    ctx.fillStyle = P.floor;
    ctx.fillRect(cx - dw / 2, y0, dw, y1 - y0);
    ctx.fillStyle = P.wall;
    ctx.fillRect(cx - dw / 2 - wt, y0, wt, y1 - y0);
    ctx.fillRect(cx + dw / 2, y0, wt, y1 - y0);
  }

  // 已探明的房间（已访问 + 其邻居）
  _discovered() {
    const set = new Set();
    for (const r of this.rooms) {
      if (!r.visited) continue;
      set.add(r);
      for (const dir of DIRS) {
        const n = this.get(r.gx + dir.dx, r.gy + dir.dy);
        if (n) set.add(n);
      }
    }
    return set;
  }

  // 小地图（UI 空间，右上角）
  drawMinimap(ctx, current, cssW) {
    const discovered = this._discovered();
    if (discovered.size === 0) return;

    let minGx = Infinity, maxGx = -Infinity, minGy = Infinity, maxGy = -Infinity;
    for (const r of discovered) {
      minGx = Math.min(minGx, r.gx); maxGx = Math.max(maxGx, r.gx);
      minGy = Math.min(minGy, r.gy); maxGy = Math.max(maxGy, r.gy);
    }

    const cell = 16, gap = 5;
    const cols = maxGx - minGx + 1;
    const rows = maxGy - minGy + 1;
    const mw = cols * cell + (cols - 1) * gap;
    const mh = rows * cell + (rows - 1) * gap;
    const pad = 10;
    const ox = cssW - 16 - mw;
    const oy = 64;

    const P = Config.Palette;
    // 背板
    ctx.fillStyle = 'rgba(10,4,18,0.5)';
    ctx.fillRect(ox - pad, oy - pad, mw + pad * 2, mh + pad * 2);
    ctx.strokeStyle = 'rgba(245,197,66,0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - pad, oy - pad, mw + pad * 2, mh + pad * 2);

    const TYPE_COLOR = {
      start: P.olympusBlue,
      normal: '#5a4a78',
      elite: P.enemyBodyLight,
      shop: P.olympusGold,
      boss: P.bloodRed
    };

    const cx = (r) => ox + (r.gx - minGx) * (cell + gap);
    const cy = (r) => oy + (r.gy - minGy) * (cell + gap);

    // 连线
    ctx.strokeStyle = 'rgba(243,233,210,0.35)';
    ctx.lineWidth = 2;
    for (const r of discovered) {
      const e = this.get(r.gx + 1, r.gy);
      if (e && discovered.has(e)) {
        ctx.beginPath();
        ctx.moveTo(cx(r) + cell, cy(r) + cell / 2);
        ctx.lineTo(cx(e), cy(e) + cell / 2);
        ctx.stroke();
      }
      const s = this.get(r.gx, r.gy + 1);
      if (s && discovered.has(s)) {
        ctx.beginPath();
        ctx.moveTo(cx(r) + cell / 2, cy(r) + cell);
        ctx.lineTo(cx(s) + cell / 2, cy(s));
        ctx.stroke();
      }
    }

    // 房间格
    for (const r of discovered) {
      const x = cx(r), y = cy(r);
      const known = r.visited;
      ctx.globalAlpha = known ? 1 : 0.4;
      ctx.fillStyle = TYPE_COLOR[r.type] || '#5a4a78';
      ctx.fillRect(x, y, cell, cell);
      if (r === current) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = P.olympusGoldLight;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x - 1.5, y - 1.5, cell + 3, cell + 3);
      }
    }
    ctx.globalAlpha = 1;
  }
}

module.exports = Dungeon;
