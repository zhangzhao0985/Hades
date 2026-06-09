// js/engine.js —— 游戏核心：画布初始化、缩放适配、固定步长主循环、渲染编排
// 同时兼容小游戏（全局 requestAnimationFrame）与小程序 Canvas 2D（canvas.requestAnimationFrame）
const Config = require('./config.js');
const InputManager = require('./input.js');
const Player = require('./player.js');
const Room = require('./room.js');
const Camera = require('./camera.js');

class Game {
  constructor(canvas, cssW, cssH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const info = wx.getSystemInfoSync();
    this.dpr = info.pixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;

    // 高清屏适配：后备像素 = CSS 尺寸 × 设备像素比
    canvas.width = Math.round(cssW * this.dpr);
    canvas.height = Math.round(cssH * this.dpr);

    // 等比缩放：以设计宽 750 为基准，保持画面比例
    this.scale = cssW / Config.DESIGN_WIDTH;     // 设计 → CSS px
    this.renderScale = this.scale * this.dpr;    // 世界 → 后备像素
    // 视口的世界尺寸：宽恒为 750，高随屏幕比例变化
    this.viewWorldW = canvas.width / this.renderScale;
    this.viewWorldH = canvas.height / this.renderScale;

    // 子系统
    this.input = new InputManager(cssW, cssH);
    this.room = new Room(0, 0, Config.room.width, Config.room.height);
    this.player = new Player(
      this.room.x + this.room.width / 2,
      this.room.y + this.room.height / 2
    );
    this.camera = new Camera(this.player.x, this.player.y);
    this.camera.setViewport(this.viewWorldW, this.viewWorldH);
    this.camera.snapTo(this.player, this.room);

    // 主循环控制
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this._loop = this._loop.bind(this);

    // FPS 统计（调试用）
    this.fps = 0;
    this._fpsCount = 0;
    this._fpsTimer = 0;
  }

  // 帧调度：小游戏用全局 requestAnimationFrame，小程序 Canvas 2D 用 canvas.requestAnimationFrame
  _raf(cb) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
    if (this.canvas && this.canvas.requestAnimationFrame) return this.canvas.requestAnimationFrame(cb);
    return setTimeout(() => cb(Date.now()), 16);
  }

  _caf(id) {
    if (id == null) return;
    if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame(id);
    if (this.canvas && this.canvas.cancelAnimationFrame) return this.canvas.cancelAnimationFrame(id);
    clearTimeout(id);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = 0; // 重新计时，避免回前台后一次性大步进
    this._render();    // 立即画一帧，确保启动瞬间就有画面
    this.rafId = this._raf(this._loop);
  }

  stop() {
    this.running = false;
    this._caf(this.rafId);
    this.rafId = null;
  }

  _loop(timestamp) {
    if (!this.running) return;
    this.rafId = this._raf(this._loop);

    if (!this.lastTime) this.lastTime = timestamp;
    let frameTime = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    if (frameTime > Config.MAX_FRAME_TIME) frameTime = Config.MAX_FRAME_TIME;

    // 固定步长推进逻辑，渲染与逻辑解耦
    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= Config.FIXED_DT && steps < Config.MAX_STEPS_PER_FRAME) {
      this._update(Config.FIXED_DT);
      this.accumulator -= Config.FIXED_DT;
      steps++;
    }

    // FPS 统计
    this._fpsCount++;
    this._fpsTimer += frameTime;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsTimer);
      this._fpsCount = 0;
      this._fpsTimer = 0;
    }

    this._render();
  }

  _update(dt) {
    this.player.update(dt, this.input, this.room);
    this.camera.follow(this.player, this.room, dt, Config.camera.smooth);
  }

  _render() {
    const ctx = this.ctx;
    const cam = this.camera;

    // 清屏（屏幕空间）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Config.Palette.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 世界变换：缩放 + 镜头居中（一次 setTransform 完成 dpr/缩放/平移）
    const rs = this.renderScale;
    ctx.setTransform(
      rs, 0, 0, rs,
      this.canvas.width / 2 - cam.x * rs,
      this.canvas.height / 2 - cam.y * rs
    );

    this.room.draw(ctx);
    this.player.draw(ctx);

    // UI 层：屏幕空间，1 单位 = 1 CSS px（与触摸坐标一致）
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._renderUI(ctx);
  }

  _renderUI(ctx) {
    this._drawJoystick(ctx);
    this._drawActionButtonsStub(ctx);
    this._drawHud(ctx);
  }

  _drawJoystick(ctx) {
    const js = this.input.joystick;
    if (!js.active) return;
    const P = Config.Palette;
    const R = this.input.maxRadius;

    // 底盘
    ctx.beginPath();
    ctx.arc(js.baseX, js.baseY, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,12,30,0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(245,197,66,0.5)';
    ctx.stroke();

    // 摇杆球
    const kr = R * 0.42;
    const g = ctx.createRadialGradient(js.knobX, js.knobY, 4, js.knobX, js.knobY, kr);
    g.addColorStop(0, P.olympusGoldLight);
    g.addColorStop(1, P.olympusGold);
    ctx.beginPath();
    ctx.arc(js.knobX, js.knobY, kr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // 右下角动作按钮占位（第二步接入攻击/闪避/大招交互）
  _drawActionButtonsStub(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    const buttons = [
      { x: cw - 70,  y: ch - 90,  r: 48, label: '⚔', color: P.bloodRed },     // 普攻
      { x: cw - 170, y: ch - 70,  r: 38, label: '»', color: P.olympusBlue },  // 闪避
      { x: cw - 95,  y: ch - 200, r: 38, label: '✦', color: P.olympusGold }   // 大招
    ];
    ctx.globalAlpha = 0.45;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of buttons) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,12,30,0.5)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = b.color;
      ctx.stroke();
      ctx.fillStyle = P.textLight;
      ctx.font = Math.round(b.r * 0.7) + 'px sans-serif';
      ctx.fillText(b.label, b.x, b.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  _drawHud(ctx) {
    const P = Config.Palette;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 22px serif';
    ctx.fillText('HADES · 冥府', 20, 24);

    ctx.fillStyle = 'rgba(243,233,210,0.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText('第一步：移动与镜头   FPS ' + this.fps, 20, 54);
    ctx.fillText('左半屏拖动 = 摇杆移动', 20, 74);
  }
}

module.exports = Game;
