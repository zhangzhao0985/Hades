// js/engine.js —— 游戏核心：画布初始化、缩放适配、固定步长主循环、战斗编排、渲染
// 同时兼容小游戏（全局 requestAnimationFrame）与小程序 Canvas 2D（canvas.requestAnimationFrame）
const Config = require('./config.js');
const InputManager = require('./input.js');
const Player = require('./player.js');
const Room = require('./room.js');
const Camera = require('./camera.js');
const Enemy = require('./enemy.js');
const EffectsManager = require('./effects.js');
const { clamp, len, dist } = require('./utils.js');

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
    this.scale = cssW / Config.DESIGN_WIDTH;
    this.renderScale = this.scale * this.dpr;
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

    // 战斗 / 特效 / 波次
    this.enemies = [];
    this.effects = new EffectsManager(Config.effects.poolSize);
    this.waveNum = 0;
    this.roomCleared = false;
    this.respawnTimer = 0;
    this.state = 'playing';   // playing | dead
    this.deathPromptT = 0;
    this.shake = 0;           // 0~1 震屏强度
    this._spawnWave();

    // 主循环控制
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this._loop = this._loop.bind(this);

    // FPS 统计
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
    this.lastTime = 0;
    this._render();
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

    this.accumulator += frameTime;
    let steps = 0;
    while (this.accumulator >= Config.FIXED_DT && steps < Config.MAX_STEPS_PER_FRAME) {
      this._update(Config.FIXED_DT);
      this.accumulator -= Config.FIXED_DT;
      steps++;
    }

    this._fpsCount++;
    this._fpsTimer += frameTime;
    if (this._fpsTimer >= 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsTimer);
      this._fpsCount = 0;
      this._fpsTimer = 0;
    }

    this._render();
  }

  // ============ 逻辑更新 ============
  _update(dt) {
    // 震屏衰减
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * Config.camera.shakeDecay);

    if (this.state === 'dead') {
      this.deathPromptT += dt;
      this.effects.update(dt);
      if (this.deathPromptT > 0.8 && this.input.consumeAnyTap()) this._restart();
      return;
    }

    // 闪避（按下边沿触发）
    if (this.input.consumePress('dash')) {
      if (this.player.tryDash(this.input)) {
        this.effects.spawn('dashtrail', { x: this.player.x, y: this.player.y, reach: this.player.radius, dur: 0.18 });
        this.addShake(0.1);
      }
    }

    // 普攻（按住连击）
    if (this.input.isPressed('attack')) {
      if (this.player.tryAttack(this.input)) {
        const isThird = this.player.comboIndex === 2;
        this.effects.spawn('slash', {
          x: this.player.x, y: this.player.y, angle: this.player.attackFacing,
          reach: Config.attack.reach + this.player.radius + (isThird ? Config.attack.thirdHitReachBonus : 0),
          half: Config.attack.halfAngle * (isThird ? 1.15 : 1),
          dur: 0.22, color: Config.Palette.slash
        });
      }
    }

    this.player.update(dt, this.input, this.room);

    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt, this.player, this.room);
    }
    this._separateEnemies();

    this._resolvePlayerAttack();
    this._resolveEnemyContact();

    // 回收已消散的敌人
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isGone()) this.enemies.splice(i, 1);
    }

    this._updateWaves(dt);

    if (this.player.dead) {
      this.state = 'dead';
      this.deathPromptT = 0;
      this.input.consumeAnyTap(); // 清掉触发死亡那一帧的点击残留
      this.addShake(0.6);
    }

    this.effects.update(dt);
    this.camera.follow(this.player, this.room, dt, Config.camera.smooth);
  }

  addShake(amount) {
    this.shake = clamp(this.shake + amount, 0, 1);
  }

  // 玩家攻击 → 命中敌人
  _resolvePlayerAttack() {
    const hb = this.player.getAttackHitbox();
    if (!hb) return;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.isAlive()) continue;
      if (e.lastHitSwingId === hb.swingId) continue;

      const dx = e.x - hb.x;
      const dy = e.y - hb.y;
      const d = len(dx, dy);
      if (d > hb.reach + e.radius) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(this._angleDiff(ang, hb.facing)) > hb.halfAngle) continue;

      e.lastHitSwingId = hb.swingId;
      const wasAlive = e.isAlive();
      e.takeDamage(hb.damage, hb.x, hb.y, hb.knockback, hb.hitstun);

      this.effects.spawn('hit', { x: e.x, y: e.y, angle: ang, dur: 0.22, color: Config.Palette.spark });
      this.effects.spawn('dmg', { x: e.x, y: e.y - e.radius - 6, text: Math.round(hb.damage), vy: -70, dur: 0.6, color: Config.Palette.olympusGoldLight });
      this.addShake(0.16);

      if (wasAlive && e.state === 'dead') {
        this.effects.spawn('death', { x: e.x, y: e.y, dur: 0.35, color: Config.Palette.spark });
        this.addShake(0.3);
      }
    }
  }

  // 敌人接触 → 伤害玩家
  _resolveEnemyContact() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.canDamagePlayer()) continue;
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const d = len(dx, dy);
      if (d <= this.player.radius + e.radius) {
        if (this.player.takeDamage(Config.enemy.melee.contactDamage, e.x, e.y)) {
          e.contactCd = Config.enemy.melee.contactCooldown;
          const l = d || 1;
          e.vx = -dx / l * 120;
          e.vy = -dy / l * 120;
          this.addShake(0.4);
          this.effects.spawn('hit', { x: this.player.x, y: this.player.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.bloodRedLight });
        }
      }
    }
  }

  // 敌人之间轻量分离，避免完全重叠
  _separateEnemies() {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.isAlive()) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.isAlive()) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = len(dx, dy);
        const min = a.radius + b.radius;
        if (d > 0 && d < min) {
          const push = (min - d) / 2;
          dx /= d; dy /= d;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
  }

  _angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  _aliveEnemies() {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive()) n++;
    return n;
  }

  _updateWaves(dt) {
    if (this._aliveEnemies() > 0) { this.roomCleared = false; return; }
    if (!this.roomCleared) {
      this.roomCleared = true;
      this.respawnTimer = Config.wave.respawnDelay;
    }
    this.respawnTimer -= dt;
    if (this.respawnTimer <= 0) this._spawnWave();
  }

  _spawnWave() {
    this.waveNum++;
    this.roomCleared = false;
    const count = Math.min(
      Config.wave.maxCount,
      Config.wave.firstCount + (this.waveNum - 1) * Config.wave.countStep
    );
    for (let i = 0; i < count; i++) {
      if (this.enemies.length >= Config.enemy.maxOnScreen) break;
      const p = this._randomSpawnPos();
      this.enemies.push(new Enemy(p.x, p.y));
    }
  }

  _randomSpawnPos() {
    const r = this.room;
    const wt = r.wallThickness;
    const minX = r.x + wt + 40, maxX = r.x + r.width - wt - 40;
    const minY = r.y + wt + 40, maxY = r.y + r.height - wt - 40;
    let x = 0, y = 0, tries = 0;
    do {
      x = minX + Math.random() * (maxX - minX);
      y = minY + Math.random() * (maxY - minY);
      tries++;
    } while (dist(x, y, this.player.x, this.player.y) < Config.wave.spawnSafeDist && tries < 24);
    return { x, y };
  }

  _restart() {
    this.player.reset(this.room.x + this.room.width / 2, this.room.y + this.room.height / 2);
    this.enemies.length = 0;
    this.effects.clear();
    this.waveNum = 0;
    this.roomCleared = false;
    this.respawnTimer = 0;
    this.shake = 0;
    this.state = 'playing';
    this.camera.snapTo(this.player, this.room);
    this._spawnWave();
  }

  // ============ 渲染 ============
  _render() {
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Config.Palette.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 震屏偏移（世界单位）
    let ox = 0, oy = 0;
    if (this.shake > 0) {
      const m = this.shake * this.shake * Config.camera.shakeMax;
      ox = (Math.random() * 2 - 1) * m;
      oy = (Math.random() * 2 - 1) * m;
    }

    const rs = this.renderScale;
    ctx.setTransform(
      rs, 0, 0, rs,
      this.canvas.width / 2 - (cam.x + ox) * rs,
      this.canvas.height / 2 - (cam.y + oy) * rs
    );

    this.room.draw(ctx);
    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].draw(ctx);
    this.player.draw(ctx);
    this.effects.draw(ctx);

    // UI 层：屏幕空间，1 单位 = 1 CSS px
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._renderUI(ctx);
  }

  _renderUI(ctx) {
    this._drawJoystick(ctx);
    this._drawActionButtons(ctx);
    this._drawHud(ctx);
    if (this.state === 'dead') this._drawDeathOverlay(ctx);
  }

  _drawJoystick(ctx) {
    const js = this.input.joystick;
    if (!js.active) return;
    const P = Config.Palette;
    const R = this.input.maxRadius;

    ctx.beginPath();
    ctx.arc(js.baseX, js.baseY, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,12,30,0.35)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(245,197,66,0.5)';
    ctx.stroke();

    const kr = R * 0.42;
    const g = ctx.createRadialGradient(js.knobX, js.knobY, 4, js.knobX, js.knobY, kr);
    g.addColorStop(0, P.olympusGoldLight);
    g.addColorStop(1, P.olympusGold);
    ctx.beginPath();
    ctx.arc(js.knobX, js.knobY, kr, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  _drawActionButtons(ctx) {
    const P = Config.Palette;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key in this.input.buttons) {
      const b = this.input.buttons[key];

      // 可用性（影响亮度）
      let avail = b.enabled;
      if (key === 'dash') {
        avail = this.player.stamina >= Config.dash.staminaCost && this.player.dashCd <= 0 && !this.player.dashing && !this.player.dead;
      } else if (key === 'attack') {
        avail = !this.player.dead;
      }

      const baseAlpha = b.enabled ? (avail ? (b.pressed ? 0.95 : 0.6) : 0.32) : 0.26;
      const rr = b.r * (b.pressed ? 0.92 : 1);

      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = b.pressed ? 'rgba(40,24,60,0.7)' : 'rgba(20,12,30,0.5)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = b.color;
      ctx.stroke();

      ctx.globalAlpha = b.enabled ? (avail ? 1 : 0.5) : 0.4;
      ctx.fillStyle = P.textLight;
      ctx.font = Math.round(b.r * 0.7) + 'px sans-serif';
      ctx.fillText(b.label, b.x, b.y + 1);
    }
    ctx.globalAlpha = 1;
  }

  _drawBar(ctx, x, y, w, h, frac, colFill, colLight) {
    frac = clamp(frac, 0, 1);
    ctx.fillStyle = Config.Palette.hpBack;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, colLight);
    g.addColorStop(1, colFill);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * frac, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(245,197,66,0.5)';
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  }

  _drawHud(ctx) {
    const P = Config.Palette;
    const cw = this.cssW;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 22px serif';
    ctx.fillText('HADES · 冥府', 20, 18);

    // 血条
    const bx = 20, bw = 240;
    this._drawBar(ctx, bx, 50, bw, 18, this.player.hp / this.player.maxHp, P.hpFill, P.hpFillLight);
    ctx.fillStyle = P.textLight;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(this.player.hp) + ' / ' + this.player.maxHp, bx + 8, 50 + 9);

    // 体力条
    this._drawBar(ctx, bx, 74, bw, 12, this.player.stamina / this.player.maxStamina, P.staminaFill, P.staminaFillLight);

    // 操作提示
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText('左摇杆移动 · ⚔ 按住连击 · » 闪避(耗体力·无敌)', bx, 92);

    // 波次信息（右上）
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.85)';
    ctx.font = '14px sans-serif';
    ctx.fillText('第 ' + this.waveNum + ' 波 · 剩余 ' + this._aliveEnemies(), cw - 20, 20);
    ctx.fillStyle = 'rgba(243,233,210,0.45)';
    ctx.fillText('FPS ' + this.fps, cw - 20, 40);

    // 清场提示
    if (this.roomCleared && this._aliveEnemies() === 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = 'bold 20px serif';
      ctx.fillText('区域肃清！', cw / 2, 64);
      ctx.fillStyle = 'rgba(243,233,210,0.7)';
      ctx.font = '14px sans-serif';
      ctx.fillText('新一波将在 ' + Math.ceil(Math.max(0, this.respawnTimer)) + ' 秒后涌现', cw / 2, 90);
    }
  }

  _drawDeathOverlay(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(10,4,18,0.72)';
    ctx.fillRect(0, 0, cw, ch);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 46px serif';
    ctx.fillText('你 已 陨 落', cw / 2, ch / 2 - 50);

    ctx.fillStyle = P.textLight;
    ctx.font = '18px sans-serif';
    ctx.fillText('于第 ' + this.waveNum + ' 波倒下', cw / 2, ch / 2 - 6);

    if (this.deathPromptT > 0.8 && Math.floor(this.deathPromptT * 2) % 2 === 0) {
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = '20px serif';
      ctx.fillText('轻触重新开始', cw / 2, ch / 2 + 50);
    }
  }
}

module.exports = Game;
