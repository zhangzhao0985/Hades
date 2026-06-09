// js/room.js —— 房间：第一步只实现单个房间的绘制与边界（门、敌人在后续步骤加入）
const Config = require('./config.js');

class Room {
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.wallThickness = Config.room.wallThickness;
  }

  draw(ctx) {
    const P = Config.Palette;
    const x = this.x, y = this.y, w = this.width, h = this.height;
    const wt = this.wallThickness;

    // 地板：上深紫到下深色的纵向渐变
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, P.underworldPurple);
    grad.addColorStop(1, P.floor);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // 地板网格纹理：一次 stroke 批量绘制，控制绘制调用
    ctx.strokeStyle = P.floorLine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    const step = 100;
    ctx.beginPath();
    for (let gx = x + step; gx < x + w; gx += step) {
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
    }
    for (let gy = y + step; gy < y + h; gy += step) {
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 可行走区域内边发光线（岩浆橙）
    ctx.strokeStyle = P.lavaGlow;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + wt, y + wt, w - wt * 2, h - wt * 2);
    ctx.globalAlpha = 1;

    // 四周墙体
    ctx.fillStyle = P.wall;
    ctx.fillRect(x, y, w, wt);                // 上
    ctx.fillRect(x, y + h - wt, w, wt);       // 下
    ctx.fillRect(x, y, wt, h);                // 左
    ctx.fillRect(x + w - wt, y, wt, h);       // 右

    // 外框金线（奥林匹斯金）
    ctx.strokeStyle = P.olympusGold;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
}

module.exports = Room;
