// js/input.js —— 输入系统：左侧浮动虚拟摇杆 + 右侧动作按钮（攻击/闪避/大招）
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
      baseX: 0, baseY: 0,
      knobX: 0, knobY: 0,
      dx: 0, dy: 0,
      strength: 0
    };

    // 右侧动作按钮
    this.buttons = this._layoutButtons(cssW, cssH);

    // 通用「本帧是否有新触摸」标记（用于死亡界面轻触重开）
    this._tapped = false;
  }

  resize(cssW, cssH) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.buttons = this._layoutButtons(cssW, cssH);
  }

  _layoutButtons(cssW, cssH) {
    const P = Config.Palette;
    return {
      attack:  { x: cssW - 80,  y: cssH - 100, r: 52, label: '⚔', color: P.bloodRed,    enabled: true,  pressed: false, justPressed: false, touchId: null },
      dash:    { x: cssW - 180, y: cssH - 74,  r: 40, label: '»', color: P.olympusBlue,  enabled: true,  pressed: false, justPressed: false, touchId: null },
      special: { x: cssW - 108, y: cssH - 212, r: 40, label: '✦', color: P.olympusGold,  enabled: false, pressed: false, justPressed: false, touchId: null }
    };
  }

  // 兼容不同基础库 / 小游戏：触点坐标可能在 x/y 或 clientX/clientY
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
      this._tapped = true;

      // 先判定动作按钮，命中则占用该触点
      if (this._tryPressButton(t, p)) continue;

      // 否则左半屏空闲时生成摇杆
      if (!this.joystick.active && p.x < this.cssW * 0.5) {
        const js = this.joystick;
        js.active = true;
        js.touchId = t.identifier;
        js.baseX = js.knobX = p.x;
        js.baseY = js.knobY = p.y;
        this._updateVector();
      }
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
      // 释放对应按钮
      for (const key in this.buttons) {
        const b = this.buttons[key];
        if (b.touchId === t.identifier) {
          b.pressed = false;
          b.touchId = null;
        }
      }
    }
  }

  _tryPressButton(t, p) {
    for (const key in this.buttons) {
      const b = this.buttons[key];
      if (!b.enabled || b.touchId !== null) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) {
        b.pressed = true;
        b.justPressed = true;
        b.touchId = t.identifier;
        return true;
      }
    }
    return false;
  }

  // 取出并清除「刚按下」边沿（适合闪避/大招这类单次触发）
  consumePress(name) {
    const b = this.buttons[name];
    if (b && b.justPressed) {
      b.justPressed = false;
      return true;
    }
    return false;
  }

  // 是否按住（适合普攻这类按住连击）
  isPressed(name) {
    const b = this.buttons[name];
    return !!(b && b.pressed);
  }

  // 死亡界面：本帧是否有新触摸
  consumeAnyTap() {
    if (this._tapped) {
      this._tapped = false;
      return true;
    }
    return false;
  }

  _updateVector() {
    const js = this.joystick;
    let dx = js.knobX - js.baseX;
    let dy = js.knobY - js.baseY;
    const l = len(dx, dy);

    if (l > this.maxRadius) {
      dx = dx / l * this.maxRadius;
      dy = dy / l * this.maxRadius;
      js.knobX = js.baseX + dx;
      js.knobY = js.baseY + dy;
    }

    let strength = Math.min(l, this.maxRadius) / this.maxRadius;
    if (strength < Config.joystick.deadZone) {
      js.dx = 0; js.dy = 0; js.strength = 0;
      return;
    }
    js.strength = strength;
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
