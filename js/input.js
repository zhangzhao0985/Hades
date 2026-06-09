// js/input.js —— 输入系统：左侧浮动虚拟摇杆（右侧按钮在第二步接入）
const Config = require('./config.js');
const { len } = require('./utils.js');

class InputManager {
  constructor(cssW, cssH) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.maxRadius = Config.joystick.maxRadius;

    // 摇杆状态：dx/dy 为归一化方向×强度（长度 0~1），供玩家直接使用
    this.joystick = {
      active: false,
      touchId: null,
      baseX: 0, baseY: 0,   // 底盘中心（手指按下处）
      knobX: 0, knobY: 0,   // 摇杆球位置
      dx: 0, dy: 0,
      strength: 0
    };
  }

  resize(cssW, cssH) {
    this.cssW = cssW;
    this.cssH = cssH;
  }

  // 兼容不同基础库：触点坐标可能在 x/y 或 clientX/clientY
  _point(t) {
    const x = (t.x !== undefined) ? t.x : t.clientX;
    const y = (t.y !== undefined) ? t.y : t.clientY;
    return { x, y };
  }

  onTouchStart(e) {
    const touches = e.changedTouches || [];
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      const p = this._point(t);
      // 左半屏触摸 → 在按下处生成浮动摇杆
      if (!this.joystick.active && p.x < this.cssW * 0.5) {
        const js = this.joystick;
        js.active = true;
        js.touchId = t.identifier;
        js.baseX = js.knobX = p.x;
        js.baseY = js.knobY = p.y;
        this._updateVector();
      }
      // 右半屏的攻击/闪避/大招按钮将在第二步处理
    }
  }

  onTouchMove(e) {
    if (!this.joystick.active) return;
    const touches = e.changedTouches || [];
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      if (t.identifier === this.joystick.touchId) {
        const p = this._point(t);
        this.joystick.knobX = p.x;
        this.joystick.knobY = p.y;
        this._updateVector();
      }
    }
  }

  onTouchEnd(e) {
    const touches = e.changedTouches || [];
    for (let i = 0; i < touches.length; i++) {
      const t = touches[i];
      if (this.joystick.active && t.identifier === this.joystick.touchId) {
        this._resetJoystick();
      }
    }
  }

  _updateVector() {
    const js = this.joystick;
    let dx = js.knobX - js.baseX;
    let dy = js.knobY - js.baseY;
    const l = len(dx, dy);

    // 摇杆球限制在底盘半径内
    if (l > this.maxRadius) {
      dx = dx / l * this.maxRadius;
      dy = dy / l * this.maxRadius;
      js.knobX = js.baseX + dx;
      js.knobY = js.baseY + dy;
    }

    let strength = Math.min(l, this.maxRadius) / this.maxRadius;
    if (strength < Config.joystick.deadZone) {
      // 死区内视为不动
      js.dx = 0; js.dy = 0; js.strength = 0;
      return;
    }
    js.strength = strength;
    // dx/dy 已含强度（除以 maxRadius 后长度即 0~1）
    js.dx = dx / this.maxRadius;
    js.dy = dy / this.maxRadius;
  }

  _resetJoystick() {
    const js = this.joystick;
    js.active = false;
    js.touchId = null;
    js.dx = js.dy = 0;
    js.strength = 0;
  }
}

module.exports = InputManager;
