// js/camera.js —— 镜头：平滑跟随玩家，并限制在房间范围内
const { clamp, damp } = require('./utils.js');

class Camera {
  constructor(x, y) {
    this.x = x;       // 镜头中心（世界坐标）
    this.y = y;
    this.viewW = 0;   // 视口的世界尺寸
    this.viewH = 0;
  }

  setViewport(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  // 跟随目标；房间比视口大时夹紧镜头，小时则居中
  follow(target, room, dt, smooth) {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;

    let tx = target.x;
    let ty = target.y;

    if (room.width >= this.viewW) {
      tx = clamp(tx, room.x + halfW, room.x + room.width - halfW);
    } else {
      tx = room.x + room.width / 2;
    }
    if (room.height >= this.viewH) {
      ty = clamp(ty, room.y + halfH, room.y + room.height - halfH);
    } else {
      ty = room.y + room.height / 2;
    }

    this.x = damp(this.x, tx, smooth, dt);
    this.y = damp(this.y, ty, smooth, dt);
  }

  // 立即对准目标（用于初始化/切房间，避免镜头慢慢飘过去）
  snapTo(target, room) {
    this.follow(target, room, 1, 1000);
  }
}

module.exports = Camera;
