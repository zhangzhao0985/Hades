// js/engine.js —— 游戏核心：画布初始化、缩放、主循环、地牢/房间/门、战斗编排、渲染
// 同时兼容小游戏（全局 requestAnimationFrame）与小程序 Canvas 2D（canvas.requestAnimationFrame）
const Config = require('./config.js');
const InputManager = require('./input.js');
const Player = require('./player.js');
const Room = require('./room.js');
const Camera = require('./camera.js');
const Enemy = require('./enemy.js');
const EffectsManager = require('./effects.js');
const Dungeon = require('./dungeon.js');
const { clamp, len, dist } = require('./utils.js');

const EDGE_DELTA = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

class Game {
  constructor(canvas, cssW, cssH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const info = wx.getSystemInfoSync();
    this.dpr = info.pixelRatio || 1;
    this.cssW = cssW;
    this.cssH = cssH;

    canvas.width = Math.round(cssW * this.dpr);
    canvas.height = Math.round(cssH * this.dpr);

    this.scale = cssW / Config.DESIGN_WIDTH;
    this.renderScale = this.scale * this.dpr;
    this.viewWorldW = canvas.width / this.renderScale;
    this.viewWorldH = canvas.height / this.renderScale;

    // 子系统
    this.input = new InputManager(cssW, cssH);
    this.effects = new EffectsManager(Config.effects.poolSize);
    this.player = new Player(0, 0);
    this.camera = new Camera(0, 0);
    this.camera.setViewport(this.viewWorldW, this.viewWorldH);

    this.enemies = [];
    this.shake = 0;
    this.state = 'playing';   // playing | dead
    this.deathPromptT = 0;

    this._initRun();

    // 主循环
    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this._loop = this._loop.bind(this);

    this.fps = 0;
    this._fpsCount = 0;
    this._fpsTimer = 0;
  }

  // 开始一次新征程：生成地牢、复位玩家到起始房
  _initRun() {
    this.dungeon = new Dungeon();
    this.currentRoom = this.dungeon.start;
    this.currentRoom.visited = true;
    this.enemies.length = 0;
    this.effects.clear();
    this.transition = null;
    this.canTriggerDoor = true;
    this.clearFlashT = 0;
    this.shake = 0;

    this.player.reset(this.currentRoom.centerX(), this.currentRoom.centerY());
    this.camera.snapTo(this.player, this.currentRoom);
  }

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
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * Config.camera.shakeDecay);

    if (this.state === 'dead') {
      this.deathPromptT += dt;
      this.effects.update(dt);
      if (this.deathPromptT > 0.8 && this.input.consumeAnyTap()) this._restart();
      return;
    }

    if (this.transition) { this._updateTransition(dt); return; }

    if (this.clearFlashT > 0) this.clearFlashT -= dt;

    // 闪避
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

    this.player.update(dt, this.input, this.currentRoom);

    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i].update(dt, this.player, this.currentRoom);
    }
    this._separateEnemies();
    this._resolvePlayerAttack();
    this._resolveEnemyContact();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isGone()) this.enemies.splice(i, 1);
    }

    this._checkRoomCleared();
    this._handleDoors();

    if (this.player.dead) {
      this.state = 'dead';
      this.deathPromptT = 0;
      this.input.consumeAnyTap();
      this.addShake(0.6);
    }

    this.effects.update(dt);
    this.camera.follow(this.player, this.currentRoom, dt, Config.camera.smooth);
  }

  addShake(a) { this.shake = clamp(this.shake + a, 0, 1); }

  // ---- 门 / 房间切换 ----
  _handleDoors() {
    const room = this.currentRoom;
    const edge = room.doorZoneEdge(this.player.x, this.player.y);
    if (!edge) { this.canTriggerDoor = true; return; }
    if (!this.canTriggerDoor || !room.cleared) return;

    const d = EDGE_DELTA[edge];
    const neighbor = this.dungeon.get(room.gx + d[0], room.gy + d[1]);
    if (neighbor) this._startTransition(edge, neighbor);
  }

  _startTransition(edge, neighbor) {
    const opp = Room.OPP[edge];
    const pEnd = neighbor.entrance(opp);
    this.transition = {
      t: 0,
      dur: Config.dungeon.transitionTime,
      fromRoom: this.currentRoom,
      toRoom: neighbor,
      pStart: { x: this.player.x, y: this.player.y },
      pEnd
    };
    // 取消动作、锁输入
    this.player.attacking = false;
    this.player.dashing = false;
    this.player.vx = this.player.vy = 0;
    this.player.facing = Math.atan2(pEnd.y - this.player.y, pEnd.x - this.player.x);

    this.currentRoom = neighbor;
    neighbor.visited = true;
    this.canTriggerDoor = false;
    this.enemies.length = 0;
  }

  _updateTransition(dt) {
    const tr = this.transition;
    tr.t += dt;
    const k = clamp(tr.t / tr.dur, 0, 1);
    const e = k * k * (3 - 2 * k); // smoothstep
    this.player.x = tr.pStart.x + (tr.pEnd.x - tr.pStart.x) * e;
    this.player.y = tr.pStart.y + (tr.pEnd.y - tr.pStart.y) * e;
    this.player.moving = true;
    this.player.animTime += dt * 8;

    this.camera.follow(this.player, this.currentRoom, dt, Config.camera.smooth * 1.4);
    this.effects.update(dt);

    if (tr.t >= tr.dur) this._finishTransition();
  }

  _finishTransition() {
    const room = this.currentRoom;
    this.transition = null;
    this.canTriggerDoor = false;
    this.player.moving = false;
    if (room.isCombat() && !room.cleared && !room.spawned) {
      this._spawnRoomEnemies(room);
    } else if (!room.isCombat()) {
      room.cleared = true;
    }
  }

  _spawnRoomEnemies(room) {
    const spec = Config.roomEnemies[room.type] || Config.roomEnemies.normal;
    const count = spec[0] + Math.floor(Math.random() * (spec[1] - spec[0] + 1));
    room.spawned = true;
    room.cleared = false;
    for (let i = 0; i < count; i++) {
      if (this.enemies.length >= Config.enemy.maxOnScreen) break;
      const p = this._roomSpawnPos(room);
      this.enemies.push(new Enemy(p.x, p.y));
    }
  }

  _roomSpawnPos(room) {
    const wt = room.wallThickness;
    const minX = room.x + wt + 60, maxX = room.x + room.width - wt - 60;
    const minY = room.y + wt + 60, maxY = room.y + room.height - wt - 60;
    let x = 0, y = 0, tries = 0;
    do {
      x = minX + Math.random() * (maxX - minX);
      y = minY + Math.random() * (maxY - minY);
      tries++;
    } while (dist(x, y, this.player.x, this.player.y) < 300 && tries < 24);
    return { x, y };
  }

  _checkRoomCleared() {
    const room = this.currentRoom;
    if (room.isCombat() && room.spawned && !room.cleared && this._aliveEnemies() === 0) {
      room.cleared = true;
      this.clearFlashT = 2.4;
    }
  }

  // ---- 战斗结算 ----
  _resolvePlayerAttack() {
    const hb = this.player.getAttackHitbox();
    if (!hb) return;
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      if (!en.isAlive()) continue;
      if (en.lastHitSwingId === hb.swingId) continue;

      const dx = en.x - hb.x;
      const dy = en.y - hb.y;
      const d = len(dx, dy);
      if (d > hb.reach + en.radius) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(this._angleDiff(ang, hb.facing)) > hb.halfAngle) continue;

      en.lastHitSwingId = hb.swingId;
      const wasAlive = en.isAlive();
      en.takeDamage(hb.damage, hb.x, hb.y, hb.knockback, hb.hitstun);

      this.effects.spawn('hit', { x: en.x, y: en.y, angle: ang, dur: 0.22, color: Config.Palette.spark });
      this.effects.spawn('dmg', { x: en.x, y: en.y - en.radius - 6, text: Math.round(hb.damage), vy: -70, dur: 0.6, color: Config.Palette.olympusGoldLight });
      this.addShake(0.16);

      if (wasAlive && en.state === 'dead') {
        this.effects.spawn('death', { x: en.x, y: en.y, dur: 0.35, color: Config.Palette.spark });
        this.addShake(0.3);
      }
    }
  }

  _resolveEnemyContact() {
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      if (!en.canDamagePlayer()) continue;
      const dx = this.player.x - en.x;
      const dy = this.player.y - en.y;
      const d = len(dx, dy);
      if (d <= this.player.radius + en.radius) {
        if (this.player.takeDamage(Config.enemy.melee.contactDamage, en.x, en.y)) {
          en.contactCd = Config.enemy.melee.contactCooldown;
          const l = d || 1;
          en.vx = -dx / l * 120;
          en.vy = -dy / l * 120;
          this.addShake(0.4);
          this.effects.spawn('hit', { x: this.player.x, y: this.player.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.bloodRedLight });
        }
      }
    }
  }

  _separateEnemies() {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.isAlive()) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.isAlive()) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
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

  _combatStats() {
    let cleared = 0, total = 0;
    for (const r of this.dungeon.rooms) {
      if (r.isCombat()) { total++; if (r.cleared) cleared++; }
    }
    return { cleared, total };
  }

  _restart() {
    this.state = 'playing';
    this._initRun();
  }

  // ============ 渲染 ============
  _roomsToDraw() {
    const cur = this.currentRoom;
    const set = [cur];
    for (const edge in EDGE_DELTA) {
      const d = EDGE_DELTA[edge];
      const n = this.dungeon.get(cur.gx + d[0], cur.gy + d[1]);
      if (n) set.push(n);
    }
    return set;
  }

  _render() {
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Config.Palette.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

    const drawSet = this._roomsToDraw();
    this.dungeon.drawCorridors(ctx, drawSet);
    for (let i = 0; i < drawSet.length; i++) drawSet[i].draw(ctx);

    for (let i = 0; i < this.enemies.length; i++) this.enemies[i].draw(ctx);
    this.player.draw(ctx);
    this.effects.draw(ctx);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._renderUI(ctx);
  }

  _renderUI(ctx) {
    this._drawJoystick(ctx);
    this._drawActionButtons(ctx);
    this._drawHud(ctx);
    this.dungeon.drawMinimap(ctx, this.currentRoom, this.cssW);
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

    const bx = 20, bw = 240;
    this._drawBar(ctx, bx, 50, bw, 18, this.player.hp / this.player.maxHp, P.hpFill, P.hpFillLight);
    ctx.fillStyle = P.textLight;
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(this.player.hp) + ' / ' + this.player.maxHp, bx + 8, 50 + 9);

    this._drawBar(ctx, bx, 74, bw, 12, this.player.stamina / this.player.maxStamina, P.staminaFill, P.staminaFillLight);

    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.4)';
    ctx.font = '12px sans-serif';
    ctx.fillText('左摇杆移动 · ⚔ 按住连击 · » 闪避 · 清场后走向发光之门', bx, 92);

    // 房间状态（屏幕中上）
    const room = this.currentRoom;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (!this.transition) {
      if (room.isCombat() && !room.cleared) {
        ctx.fillStyle = P.bloodRedLight;
        ctx.font = 'bold 18px serif';
        ctx.fillText('⚔ 区域锁闭 · 剩余敌人 ' + this._aliveEnemies(), cw / 2, 64);
      } else if (this.clearFlashT > 0) {
        ctx.fillStyle = P.olympusGoldLight;
        ctx.font = 'bold 20px serif';
        const txt = room.type === 'boss' ? 'BOSS 已讨伐！冥府征程·胜利！' : '区域肃清！前往发光之门 →';
        ctx.fillText(txt, cw / 2, 64);
      }
    }

    // 进度（左下）
    const cs = this._combatStats();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(243,233,210,0.5)';
    ctx.font = '12px sans-serif';
    ctx.fillText('已肃清 ' + cs.cleared + ' / ' + cs.total + ' 战斗房 · FPS ' + this.fps, 16, this.cssH - 12);
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

    const cs = this._combatStats();
    ctx.fillStyle = P.textLight;
    ctx.font = '18px sans-serif';
    ctx.fillText('本次征程肃清 ' + cs.cleared + ' / ' + cs.total + ' 个战斗房', cw / 2, ch / 2 - 6);

    if (this.deathPromptT > 0.8 && Math.floor(this.deathPromptT * 2) % 2 === 0) {
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = '20px serif';
      ctx.fillText('轻触重新出发（重新生成地牢）', cw / 2, ch / 2 + 50);
    }
  }
}

module.exports = Game;
