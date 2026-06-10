// js/engine.js —— 核心：竞技场 + 刷怪 + 武器/普攻/特殊技/神怒大招 + 弹射物 + 祝福 + 渲染
const Config = require('./config.js');
const InputManager = require('./input.js');
const Player = require('./player.js');
const Room = require('./room.js');
const Camera = require('./camera.js');
const Enemy = require('./enemy.js');
const EffectsManager = require('./effects.js');
const ProjectileManager = require('./projectile.js');
const { BoonManager, GODS } = require('./boons.js');
const { WEAPONS, WEAPON_LIST } = require('./weapons.js');
const { MetaProgress, UPGRADES } = require('./meta.js');
const AudioManager = require('./audio.js');
const { drawCharacter } = require('./sprites.js');
const { clamp, len, dist } = require('./utils.js');

// NPC（卡戎）对话台词
const CHARON_LINES = [
  ['卡戎', 'Hrrmmm…… 又见面了，冥王之子。'],
  ['卡戎', '黑暗精华能换来力量，别在殿堂里白白浪费。'],
  ['卡戎', '诸神的馈赠各有脾性——善用它们的组合。'],
  ['卡戎', '冥河的彼岸仍有人等你。去吧，别回头。']
];

function rnd(a, b) { return a + Math.random() * (b - a); }
function rndInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
}

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

    this.input = new InputManager(cssW, cssH);
    this.effects = new EffectsManager(Config.effects.poolSize);
    this.projectiles = new ProjectileManager(Config.projectiles.poolSize);
    this.player = new Player(0, 0);
    this.camera = new Camera(0, 0);
    this.camera.setViewport(this.viewWorldW, this.viewWorldH);

    this.boons = new BoonManager();
    this.boonChoices = null;
    this.pendingBoons = 0;
    this.weaponChoices = null;
    this.upgradePopup = null;
    this.upgradePromptT = 0;
    this.enemies = [];
    this.shake = 0;
    this.flashT = 0;
    // 永久成长（持久化）
    this.meta = MetaProgress.load();
    this.runResult = null;
    this.settlementT = 0;
    this.metaAtk = 0;
    this.revivesLeft = 0;
    // 第七步：音效接口 / 对话 / 旁白
    this.audio = new AudioManager();
    this.dialogue = null;       // { speaker, lines, index }
    this.charonTurn = 0;
    this.narration = null;      // { text, t, dur }
    this.state = 'hall';   // hall | weaponselect | playing | upgrade | boon | settlement

    this._buildArena();
    this.hallLayout = this._layoutHall();
    this.player.reset(this.arena.centerX(), this.arena.centerY());
    this.camera.snapTo(this.player, this.arena);

    this.running = false;
    this.rafId = null;
    this.lastTime = 0;
    this.accumulator = 0;
    this._loop = this._loop.bind(this);

    this.fps = 0;
    this._fpsCount = 0;
    this._fpsTimer = 0;
  }

  // 建竞技场几何（仅一次）
  _buildArena() {
    this.arena = new Room(0, 0, 'arena');
    this.arena.x = 0; this.arena.y = 0;
    this.arena.width = Config.arena.width;
    this.arena.height = Config.arena.height;
    this.arena.wallThickness = Config.arena.wallThickness;
    this.arena.doors = { N: false, E: false, S: false, W: false };
  }

  // 回到冥府殿堂（hub）
  _goHall() {
    this.enemies.length = 0;
    this.effects.clear();
    this.projectiles.clear();
    this.player.reset(this.arena.centerX(), this.arena.centerY());
    this.camera.snapTo(this.player, this.arena);
    this.shake = 0;
    this.flashT = 0;
    this.input.resetAll();
    this.state = 'hall';
  }

  // 从殿堂出发：复位本局状态，进入武器选择
  _depart() {
    this.enemies.length = 0;
    this.effects.clear();
    this.projectiles.clear();
    this.boons.reset();
    this.boonChoices = null;
    this.pendingBoons = 0;
    this.upgradePopup = null;
    this.shake = 0;
    this.flashT = 0;
    this.player.reset(this.arena.centerX(), this.arena.centerY());
    this.camera.snapTo(this.player, this.arena);
    this.weaponChoices = this._layoutWeaponCards();
    this.input.resetAll();
    this.state = 'weaponselect';
  }

  _chooseWeapon(id) {
    this.audio.play('select');
    this.player.setWeapon(WEAPONS[id]);
    this.player.energy = 0;
    this._beginArena();
  }

  _beginArena() {
    const sp = Config.spawn;
    // 应用永久升级
    this.metaAtk = this.meta.atkBonus();
    this.revivesLeft = this.meta.revives();
    this.player.maxHp = Config.player.maxHp + this.meta.hpBonus();
    this.player.maxStamina = Config.player.maxStamina + this.meta.stamBonus();
    this.player.hp = this.player.maxHp;
    this.player.stamina = this.player.maxStamina;

    this.normalTimer = rnd(sp.normalIntervalMin, sp.normalIntervalMax);
    this.eliteTimer = rnd(sp.eliteIntervalMin, sp.eliteIntervalMax);
    this.bossTimer = rnd(sp.bossIntervalMin, sp.bossIntervalMax);
    this.bossAlive = false;
    this.bossWarnT = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.runBossKills = 0;
    this.waveLevel = 0;
    this.swordNova = null;
    this.enemies.length = 0;
    this.projectiles.clear();
    for (let i = 0; i < sp.initialNormals; i++) this._spawnEnemy(this._pick(Config.enemy.normalTypes));
    this.input.resetAll();
    this.narration = null;
    this._narrate('冥界的喧嚣再度袭来……', 3.2);
    this.state = 'playing';
  }

  // 复活（消耗永久升级提供的复活次数）
  _revive() {
    this.audio.play('revive');
    this.revivesLeft--;
    this.player.dead = false;
    this.player.hp = Math.max(1, Math.ceil(this.player.maxHp * 0.5));
    this.player.invuln = 2.4;
    this.player.stagger = 0;
    this.player.vx = this.player.vy = 0;
    this.effects.spawn('shock', { x: this.player.x, y: this.player.y, maxR: 380, dur: 0.6, color: Config.Palette.olympusGoldLight });
    this.flashT = 0.22;
    this.addShake(0.6);
    // 击退附近敌人腾出空间
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.isAlive()) continue;
      const dx = e.x - this.player.x, dy = e.y - this.player.y;
      const d = len(dx, dy);
      if (d < 380) { const l = d || 1; e.vx = dx / l * 360; e.vy = dy / l * 360; }
    }
  }

  // 结束本局：结算黑暗精华并即时存档
  _endRun() {
    const earned = this.kills + this.runBossKills * 20 + Math.floor(this.elapsed / 5);
    const newBest = this.meta.recordRun(this.kills, this.elapsed);
    this.meta.addEssence(earned);
    this.meta.save();
    this.runResult = { kills: this.kills, time: this.elapsed, bosses: this.runBossKills, essence: earned, newBest };
    this.settlementT = 0;
    this.input.resetAll();
    this.audio.play('die');
    this.addShake(0.6);
    this.state = 'settlement';
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
    if (this.flashT > 0) this.flashT -= dt;

    if (this.state === 'hall') {
      const tap = this.input.consumeTap();
      if (tap) {
        if (this.dialogue) this._advanceDialogue();
        else this._handleHallTap(tap);
      }
      this.effects.update(dt);
      return;
    }

    if (this.state === 'weaponselect') {
      const tap = this.input.consumeTap();
      if (tap) {
        for (const c of this.weaponChoices) {
          if (this._pointInRect(tap, c.rect)) { this._chooseWeapon(c.id); break; }
        }
      }
      this.effects.update(dt);
      return;
    }

    if (this.state === 'settlement') {
      this.settlementT += dt;
      this.effects.update(dt);
      if (this.settlementT > 0.8 && this.input.consumeAnyTap()) this._goHall();
      return;
    }

    if (this.state === 'boon') {
      this.effects.update(dt);
      const tap = this.input.consumeTap();
      if (tap) {
        for (const c of this.boonChoices) {
          if (this._pointInRect(tap, c.rect)) { this._applyBoon(c.def.id); break; }
        }
      }
      return;
    }

    if (this.state === 'upgrade') {
      this.effects.update(dt);
      this.upgradePromptT += dt;
      const tap = this.input.consumeTap();
      if (tap && this.upgradePromptT > 0.4) {
        this.upgradePopup = null;
        this.state = 'playing';
        if (this.pendingBoons > 0) this._openBoonSelection();
      }
      return;
    }

    // playing
    this.elapsed += dt;
    if (this.bossWarnT > 0) this.bossWarnT -= dt;
    if (this.narration) { this.narration.t -= dt; if (this.narration.t <= 0) this.narration = null; }

    if (this.input.consumePress('dash')) {
      if (this.player.tryDash(this.input)) {
        this.audio.play('dash');
        this.effects.spawn('dashtrail', { x: this.player.x, y: this.player.y, reach: this.player.radius, dur: 0.18 });
        this.addShake(0.1);
      }
    }
    if (this.input.consumePress('special')) {
      if (this.player.trySpecial(this.input)) { this.audio.play('special'); this._executeSpecial(); }
    }
    if (this.input.consumePress('ultimate')) {
      if (this.player.energyFull()) { this.audio.play('ultimate'); this._executeUltimate(); }
    }
    // 普攻：按住 ⚔ 朝摇杆方向手动攻击；否则自动瞄准最近敌人
    let didAttack = false;
    if (this.input.isPressed('attack')) {
      if (this.player.tryAttack(this.input)) { this._onAttackFired(); didAttack = true; }
    }
    if (!didAttack) this._autoAttack();

    this.player.update(dt, this.input, this.arena);

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.update(dt, this.player, this.arena);
      if (e.wantsFire) { e.wantsFire = false; this._enemyFire(e); }
    }

    this.projectiles.update(dt);
    this._resolveProjectiles();

    this._separateEnemies();
    this._updateStatusEffects(dt);
    this._resolvePlayerAttack();
    this._updateSwordNova(dt);
    this._resolveEnemyContact();
    this._handleKills();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isGone()) this.enemies.splice(i, 1);
    }

    this._updateSpawns(dt);

    if (this.player.dead) {
      if (this.revivesLeft > 0) this._revive();
      else { this._endRun(); return; }
    }

    this.effects.update(dt);
    this.camera.follow(this.player, this.arena, dt, Config.camera.smooth);
  }

  addShake(a) { this.shake = clamp(this.shake + a, 0, 1); }

  // ---- 攻击 / 特殊 / 大招 ----
  // 最近的存活敌人（忽略仍在破土的）
  _nearestEnemy(x, y) {
    let best = null, bd = Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.isAlive() || e.state === 'spawn') continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // 自动攻击：剑在近身范围内自动挥砍，弓自动瞄准最近敌人射击
  _autoAttack() {
    const pl = this.player;
    if (pl.dead || pl.dashing || pl.attacking || pl.attackCd > 0) return;
    const target = this._nearestEnemy(pl.x, pl.y);
    if (!target) return;
    const w = pl.weapon;
    const d = dist(pl.x, pl.y, target.x, target.y);
    const range = (w.type === 'melee')
      ? (w.reach + pl.radius + pl.meleeReachBonus() + target.radius + 12)
      : ((w.arrowRange || 760) * 0.95);
    if (d > range) return;
    const ang = Math.atan2(target.y - pl.y, target.x - pl.x);
    if (pl.tryAttack(this.input, ang)) this._onAttackFired();
  }

  _onAttackFired() {
    const pl = this.player;
    const w = pl.weapon;
    if (w.type === 'melee') {
      const isThird = pl.comboIndex === 2;
      this.effects.spawn('slash', {
        x: pl.x, y: pl.y, angle: pl.attackFacing,
        reach: w.reach + pl.radius + pl.meleeReachBonus() + (isThird ? w.thirdHitReachBonus : 0),
        half: w.halfAngle * (isThird ? 1.15 : 1),
        dur: 0.22, color: w.color
      });
    } else {
      // 弓：随 Boss 升级射出多支箭（双发/三发…）
      const n = pl.bowArrows();
      const step = 0.10;
      for (let i = 0; i < n; i++) {
        const a = pl.attackFacing + (i - (n - 1) / 2) * step;
        this._fireArrow(pl.x, pl.y, a, w.basicDamage, w.arrowKnockback, w.hitstun);
      }
    }
  }

  _fireArrow(x, y, angle, damage, kb, hitstun, speedMul) {
    const w = this.player.weapon;
    const speed = (w.arrowSpeed || 760) * (speedMul || 1);
    this.projectiles.spawn({
      x: x + Math.cos(angle) * this.player.radius,
      y: y + Math.sin(angle) * this.player.radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      radius: w.arrowRadius || 7,
      damage, knockback: kb, hitstun,
      maxLife: (w.arrowRange || 760) / speed,
      color: w.color, team: 'player', kind: 'arrow'
    });
  }

  // 敌方远程开火（shooter 行为触发）
  _enemyFire(e) {
    const r = e.def.ranged;
    if (!r) return;
    const baseAng = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    const n = r.count || 1, spread = r.spread || 0;
    for (let i = 0; i < n; i++) {
      const a = baseAng + (i - (n - 1) / 2) * (spread / Math.max(1, n - 1));
      this.projectiles.spawn({
        x: e.x + Math.cos(a) * e.radius, y: e.y + Math.sin(a) * e.radius,
        vx: Math.cos(a) * r.speed, vy: Math.sin(a) * r.speed, angle: a,
        radius: r.radius || 9, damage: r.damage, knockback: 0, hitstun: 0.1,
        maxLife: r.range / r.speed, color: r.color || '#ff6f5e', team: 'enemy', kind: 'orb'
      });
    }
  }

  _executeSpecial() {
    const w = this.player.weapon;
    if (w.type === 'melee') {
      const sp = w.special;
      this.effects.spawn('shock', { x: this.player.x, y: this.player.y, maxR: sp.radius, dur: 0.35, color: w.color });
      for (let i = 0; i < this.enemies.length; i++) {
        const en = this.enemies[i];
        if (!en.isAlive()) continue;
        if (dist(en.x, en.y, this.player.x, this.player.y) <= sp.radius + en.radius) {
          this._damageEnemy(en, sp.damage, this.player.x, this.player.y, sp.knockback, 0.25, w.color);
        }
      }
      this.addShake(0.35);
    } else {
      const sp = w.special;
      const n = sp.arrows;
      const base = this.player.specialDir;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * (sp.spread / Math.max(1, n - 1));
        this._fireArrow(this.player.x, this.player.y, a, sp.damage, sp.arrowKnockback, w.hitstun);
      }
      this.addShake(0.12);
    }
  }

  // 神怒大招：弓=围绕角色 3 圈箭雨；剑=长剑绕身旋转 5 圈。
  // 伤害均取手中武器的普攻基础值，并经 _damageEnemy 套用祝福增益。
  _executeUltimate() {
    const pl = this.player;
    const w = pl.weapon;
    this.flashT = 0.18;
    pl.invuln = Math.max(pl.invuln, 0.6);
    this.addShake(0.85);
    this.effects.spawn('shock', { x: pl.x, y: pl.y, maxR: 300, dur: 0.5, color: Config.Palette.olympusGoldLight });

    if (w.type === 'ranged') {
      // 3 圈箭矢，向四面八方齐射，三圈速度不同形成扩散环
      const rings = 3, perRing = 18;
      for (let ring = 0; ring < rings; ring++) {
        const off = (Math.PI * 2 / perRing) * (ring / rings);
        const spd = 1 - ring * 0.16;
        for (let i = 0; i < perRing; i++) {
          const a = i * (Math.PI * 2 / perRing) + off;
          this._fireArrow(pl.x, pl.y, a, w.basicDamage, w.arrowKnockback, w.hitstun, spd);
        }
      }
    } else {
      // 绕身旋转的长剑：持续到转满 5 圈
      this.swordNova = {
        active: true,
        angle: pl.facing,
        totalRot: 0,
        maxRot: Math.PI * 2 * 5,
        length: w.reach + pl.radius + pl.meleeReachBonus() + 60,
        width: 30,
        damage: w.basicDamage,
        knockback: w.knockback,
        color: w.color
      };
      for (let i = 0; i < this.enemies.length; i++) this.enemies[i].swordHitCd = 0;
    }
    pl.energy = 0;
  }

  // 旋转长剑大招：每帧旋转、对扫过的敌人造成伤害（每敌带命中冷却）
  _updateSwordNova(dt) {
    const sn = this.swordNova;
    if (!sn || !sn.active) return;
    const pl = this.player;
    const spin = Math.PI * 4; // 2 圈/秒
    sn.angle += spin * dt;
    sn.totalRot += spin * dt;
    const tipx = pl.x + Math.cos(sn.angle) * sn.length;
    const tipy = pl.y + Math.sin(sn.angle) * sn.length;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.swordHitCd > 0) e.swordHitCd -= dt;
      if (!e.isAlive()) continue;
      const dd = this._distPointSeg(e.x, e.y, pl.x, pl.y, tipx, tipy);
      if (dd < e.radius + sn.width && e.swordHitCd <= 0) {
        this._damageEnemy(e, sn.damage, pl.x, pl.y, sn.knockback, 0.2, sn.color);
        e.swordHitCd = 0.26;
      }
    }
    if (sn.totalRot >= sn.maxRot) { sn.active = false; this.swordNova = null; }
  }

  _distPointSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  _drawSwordNova(ctx) {
    const sn = this.swordNova;
    const pl = this.player;
    const a0 = sn.angle, len2 = sn.length;
    const tipx = pl.x + Math.cos(a0) * len2, tipy = pl.y + Math.sin(a0) * len2;
    ctx.save();
    // 拖尾扇形
    ctx.globalAlpha = 0.28;
    const g = ctx.createRadialGradient(pl.x, pl.y, pl.radius, pl.x, pl.y, len2);
    g.addColorStop(0, 'rgba(255,224,138,0)');
    g.addColorStop(1, sn.color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y);
    ctx.arc(pl.x, pl.y, len2, a0 - 0.9, a0);
    ctx.closePath();
    ctx.fill();
    // 剑身
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = sn.color;
    ctx.lineWidth = sn.width * 0.7;
    ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(tipx, tipy); ctx.stroke();
    ctx.strokeStyle = '#fff7e0';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(pl.x, pl.y); ctx.lineTo(tipx, tipy); ctx.stroke();
    // 剑尖光点
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(tipx, tipy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 统一伤害入口：套用祝福加成 + 特效 + 能量 + 连锁
  _damageEnemy(en, base, fromX, fromY, knockback, hitstun, hitColor, opts) {
    const m = this.boons.mods;
    let dmg = base + m.bonusAttackDamage + (this.metaAtk || 0);
    let kb = knockback;
    if (m.poseidon.active) { dmg += m.poseidon.impactDamage; kb *= m.poseidon.knockbackMul; }
    en.takeDamage(dmg, fromX, fromY, kb, hitstun);
    if (m.ares.active) en.applyBleed(m.ares.dps, m.ares.duration);
    if (m.aphrodite.active) en.applyWeak(m.aphrodite.weakMul, m.aphrodite.duration);
    this.effects.spawn('hit', { x: en.x, y: en.y, angle: Math.atan2(en.y - fromY, en.x - fromX), dur: 0.2, color: hitColor || Config.Palette.spark });
    this.effects.spawn('dmg', { x: en.x, y: en.y - en.radius - 6, text: Math.round(dmg), vy: -70, dur: 0.6, color: Config.Palette.olympusGoldLight });
    this.player.gainEnergy(Config.player.energyPerHit);
    this.audio.play('hit');
    if (m.zeus.active && (!opts || opts.chain !== false)) this._chainLightning(en, m.zeus);
  }

  // ---- 刷怪导演（随击败 Boss 数 waveLevel 提升强度）----
  _updateSpawns(dt) {
    const sp = Config.spawn;
    const df = Config.difficulty;
    const wl = this.waveLevel || 0;
    const normalCap = sp.normalCap + wl * df.normalCapPerBoss;
    const eliteCap = sp.eliteCap + wl * df.eliteCapPerBoss;
    const batchMax = sp.normalBatchMax + wl * df.batchPerBoss;
    const intMul = Math.pow(df.intervalScalePerBoss, wl);

    this.normalTimer -= dt;
    if (this.normalTimer <= 0) {
      this.normalTimer = rnd(sp.normalIntervalMin, sp.normalIntervalMax) * intMul;
      if (this._countTier('normal') < normalCap && this._nonBossCount() < Config.enemy.maxOnScreen) {
        const n = rndInt(sp.normalBatchMin, batchMax);
        for (let i = 0; i < n; i++) this._spawnEnemy(this._pick(Config.enemy.normalTypes));
      }
    }
    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0) {
      this.eliteTimer = rnd(sp.eliteIntervalMin, sp.eliteIntervalMax) * intMul;
      if (this._countTier('elite') < eliteCap && this._nonBossCount() < Config.enemy.maxOnScreen) {
        this._spawnEnemy(this._pick(Config.enemy.eliteTypes));
      }
    }
    this.bossTimer -= dt;
    if (this.bossTimer <= 0) {
      this.bossTimer = rnd(sp.bossIntervalMin, sp.bossIntervalMax);
      if (!this.bossAlive) this._spawnEnemy(this._pick(Config.enemy.bossTypes));
    }
  }

  _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  _spawnEnemy(type) {
    const p = this._arenaSpawnPos();
    const e = new Enemy(p.x, p.y, type);
    this.enemies.push(e);
    if (e.isBoss()) {
      this.bossAlive = true;
      this.bossWarnT = 2.5;
      this.audio.play('bossSpawn');
      this._narrate('冥府守卫降临——证明你的价值！', 3);
      this.effects.spawn('death', { x: p.x, y: p.y, dur: 0.6, color: Config.Palette.bloodRedLight });
      this.addShake(0.5);
    } else {
      this.effects.spawn('death', { x: p.x, y: p.y, dur: 0.3, color: e.tier === 'elite' ? Config.Palette.lavaGlow : Config.Palette.enemyBodyLight });
    }
    return e;
  }

  _arenaSpawnPos() {
    const a = this.arena, wt = a.wallThickness, m = Config.spawn.edgeMargin;
    const minX = a.x + wt + m, maxX = a.x + a.width - wt - m;
    const minY = a.y + wt + m, maxY = a.y + a.height - wt - m;
    let x = 0, y = 0, tries = 0;
    do {
      x = rnd(minX, maxX); y = rnd(minY, maxY); tries++;
    } while (dist(x, y, this.player.x, this.player.y) < Config.spawn.safeDist && tries < 30);
    return { x, y };
  }

  _countTier(tier) {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive() && this.enemies[i].tier === tier) n++;
    return n;
  }
  _nonBossCount() {
    let n = 0;
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isAlive() && this.enemies[i].tier !== 'boss') n++;
    return n;
  }
  _aliveBoss() {
    for (let i = 0; i < this.enemies.length; i++) if (this.enemies[i].isBoss() && this.enemies[i].isAlive()) return this.enemies[i];
    return null;
  }

  // ---- 战斗结算 ----
  _resolveProjectiles() {
    const a = this.arena, wt = a.wallThickness;
    const m = this.boons.mods;
    const pl = this.player;
    this.projectiles.forEachActive((pr) => {
      if (pr.x < a.x + wt || pr.x > a.x + a.width - wt || pr.y < a.y + wt || pr.y > a.y + a.height - wt) {
        pr.active = false;
        this.effects.spawn('hit', { x: pr.x, y: pr.y, angle: pr.angle, dur: 0.15, color: pr.color });
        return;
      }

      if (pr.team === 'enemy') {
        // 敌方弹幕 → 命中玩家
        const dx = pl.x - pr.x, dy = pl.y - pr.y;
        const rr = pl.radius + pr.radius;
        if (dx * dx + dy * dy > rr * rr) return;
        if (pl.isInvincible()) {
          // 雅典娜：闪避无敌时把敌弹反弹回去
          if (m.athena.active && pl.dashing) {
            pr.team = 'player'; pr.kind = 'arrow';
            pr.vx = -pr.vx; pr.vy = -pr.vy; pr.angle += Math.PI;
            pr.damage = Math.max(pr.damage, m.athena.damage);
            pr.color = Config.Palette.olympusBlueLight;
            pr.life = Math.max(pr.life, 0.6);
          } else {
            pr.active = false; // 闪避躲过
          }
          return;
        }
        if (pl.takeDamage(pr.damage, pr.x, pr.y)) {
          this.audio.play('hurt');
          pl.gainEnergy(Config.player.energyOnHurt);
          this.addShake(0.32);
          this.effects.spawn('hit', { x: pl.x, y: pl.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.bloodRedLight });
        }
        pr.active = false;
        return;
      }

      // 玩家弹射物 → 命中敌人
      for (let i = 0; i < this.enemies.length; i++) {
        const en = this.enemies[i];
        if (!en.isAlive()) continue;
        const dx = en.x - pr.x, dy = en.y - pr.y;
        const rr = en.radius + pr.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          this._damageEnemy(en, pr.damage, pr.x, pr.y, pr.knockback, pr.hitstun, pr.color);
          this.addShake(0.08);
          pr.active = false;
          break;
        }
      }
    });
  }

  _resolvePlayerAttack() {
    const hb = this.player.getAttackHitbox();
    if (!hb) return;
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      if (!en.isAlive()) continue;
      if (en.lastHitSwingId === hb.swingId) continue;
      const dx = en.x - hb.x, dy = en.y - hb.y;
      const d = len(dx, dy);
      if (d > hb.reach + en.radius) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(this._angleDiff(ang, hb.facing)) > hb.halfAngle) continue;
      en.lastHitSwingId = hb.swingId;
      this._damageEnemy(en, hb.damage, hb.x, hb.y, hb.knockback, hb.hitstun, Config.Palette.spark);
      this.addShake(0.16);
    }
  }

  _chainLightning(source, z) {
    const hitSet = { [source.id]: true };
    let from = source;
    for (let j = 0; j < z.jumps; j++) {
      let best = null, bestD = z.range;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.isAlive() || hitSet[e.id]) continue;
        const dd = dist(from.x, from.y, e.x, e.y);
        if (dd < bestD) { bestD = dd; best = e; }
      }
      if (!best) break;
      hitSet[best.id] = true;
      this.effects.spawn('lightning', { x: from.x, y: from.y, x2: best.x, y2: best.y, dur: 0.18, color: Config.Palette.olympusBlueLight });
      best.takeDamage(z.damage, from.x, from.y, 40, 0.05);
      this.effects.spawn('dmg', { x: best.x, y: best.y - best.radius - 6, text: Math.round(z.damage), vy: -60, dur: 0.5, color: Config.Palette.olympusBlueLight });
      from = best;
    }
  }

  _updateStatusEffects(dt) {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.isAlive()) continue;
      if (e.bleedTimer > 0) {
        e._bleedTick = (e._bleedTick || 0) + dt;
        if (e._bleedTick >= 0.3) {
          e._bleedTick = 0;
          this.effects.spawn('dmg', { x: e.x + (Math.random() * 16 - 8), y: e.y - e.radius, text: '·', vy: -28, dur: 0.4, color: Config.Palette.bloodRedLight });
        }
      }
      e.updateStatus(dt);
    }
  }

  _resolveEnemyContact() {
    const m = this.boons.mods;
    for (let i = 0; i < this.enemies.length; i++) {
      const en = this.enemies[i];
      const dx = this.player.x - en.x, dy = this.player.y - en.y;
      const d = len(dx, dy);
      if (d > this.player.radius + en.radius) continue;

      if (this.player.isInvincible()) {
        if (m.athena.active && this.player.dashing && en.canBeDeflected()) {
          en.deflectCd = 0.3;
          this._damageEnemy(en, m.athena.damage, this.player.x, this.player.y, m.athena.knockback, 0.2, Config.Palette.olympusBlueLight, { chain: false });
          this.addShake(0.2);
        }
        continue;
      }

      if (en.canDamagePlayer()) {
        if (this.player.takeDamage(en.contactDamage(), en.x, en.y)) {
          this.audio.play('hurt');
          this.player.gainEnergy(Config.player.energyOnHurt);
          en.contactCd = en.stats.contactCooldown;
          const l = d || 1;
          en.vx = -dx / l * 120 * en.stats.knockbackResist;
          en.vy = -dy / l * 120 * en.stats.knockbackResist;
          this.addShake(en.isBoss() ? 0.6 : 0.4);
          this.effects.spawn('hit', { x: this.player.x, y: this.player.y, angle: Math.atan2(dy, dx), dur: 0.2, color: Config.Palette.bloodRedLight });
        }
      }
    }
  }

  _handleKills() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.state !== 'dead' || e._killHandled) continue;
      e._killHandled = true;
      this.kills++;
      const col = e.isBoss() ? Config.Palette.bloodRedLight : (e.tier === 'elite' ? Config.Palette.lavaGlow : Config.Palette.spark);
      this.effects.spawn('death', { x: e.x, y: e.y, dur: e.isBoss() ? 0.7 : 0.35, color: col });
      this.addShake(e.isBoss() ? 0.7 : (e.tier === 'elite' ? 0.4 : 0.28));
      if (e.tier === 'elite' || e.isBoss()) this.pendingBoons++;
      if (e.isBoss()) {
        this.bossAlive = false;
        this.runBossKills++;
        this.waveLevel = (this.waveLevel || 0) + 1; // 击败 Boss → 刷怪强度提升
        this.audio.play('bossDown');
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40);
        this.player.bossUpgrade();   // 骑士晋级 + 武器强化
        this._queueUpgradePopup();
      }
    }
    if (this.pendingBoons > 0 && this.state === 'playing') this._openBoonSelection();
  }

  _separateEnemies() {
    const arr = this.enemies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.isAlive() || a.isBoss()) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (!b.isAlive() || b.isBoss()) continue;
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

  // ---- 祝福 ----
  _openBoonSelection() {
    const choices = this.boons.getChoices(3 + this.meta.boonExtra());
    if (choices.length === 0) { this.pendingBoons = 0; return; }
    this.boonChoices = this._layoutBoonCards(choices);
    this.state = 'boon';
    this.input.resetAll();
  }

  _layoutBoonCards(choices) {
    const cw = this.cssW, ch = this.cssH;
    const cardW = Math.min(cw - 56, 360);
    const cardH = 132, gap = 18;
    const total = choices.length * cardH + (choices.length - 1) * gap;
    const startY = (ch - total) / 2 + 20;
    const x = (cw - cardW) / 2;
    return choices.map((c, i) => ({
      def: c.def, nextLevel: c.nextLevel,
      rect: { x, y: startY + i * (cardH + gap), w: cardW, h: cardH }
    }));
  }

  _applyBoon(id) {
    const prevMaxHp = this.player.maxHp;
    this.boons.add(id);
    const m = this.boons.mods;
    this.player.maxHp = Config.player.maxHp + this.meta.hpBonus() + m.bonusMaxHp;
    this.player.maxStamina = Config.player.maxStamina + this.meta.stamBonus() + m.bonusMaxStamina;
    const heal = this.player.maxHp - prevMaxHp;
    if (heal > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this.audio.play('boon');
    this.effects.spawn('death', { x: this.player.x, y: this.player.y, dur: 0.5, color: Config.Palette.olympusGoldLight });
    this.boonChoices = null;
    this.pendingBoons = Math.max(0, this.pendingBoons - 1);
    this.input.resetAll();
    if (this.pendingBoons > 0) this._openBoonSelection();
    else this.state = 'playing';
  }

  // Boss 击败后的升级弹窗（骑士晋级 + 武器强化）
  _queueUpgradePopup() {
    const pl = this.player;
    const lines = ['「' + pl.weapon.name + '」强化'];
    if (pl.weapon.type === 'ranged') {
      lines.push('每次射出 ' + pl.bowArrows() + ' 箭 · 弓身焕新');
    } else {
      lines.push('剑身加长 · 攻击范围扩大 · 锋芒焕新');
    }
    this.upgradePopup = { rankName: pl.rankName(), lines };
    this.upgradePromptT = 0;
    this.state = 'upgrade';
    this.input.resetAll();
    this.effects.spawn('shock', { x: pl.x, y: pl.y, maxR: 280, dur: 0.6, color: Config.Palette.olympusGoldLight });
    this.flashT = 0.16;
  }

  _pointInRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  // ---- 冥府殿堂（hub）----
  _layoutHall() {
    const cw = this.cssW, ch = this.cssH;
    const rowW = Math.min(cw - 40, 360);
    const rowH = 52, gap = 10;
    const x = (cw - rowW) / 2;
    const startY = 220;
    const rows = UPGRADES.map((u, i) => ({
      id: u.id,
      rect: { x, y: startY + i * (rowH + gap), w: rowW, h: rowH }
    }));
    const depart = { x: (cw - 200) / 2, y: ch - 96, w: 200, h: 60 };
    const npc = { x: cw - 98, y: 84, w: 84, h: 104 };
    return { rows, depart, npc };
  }

  _handleHallTap(tap) {
    if (this._pointInRect(tap, this.hallLayout.npc)) { this._openDialogue(); return; }
    if (this._pointInRect(tap, this.hallLayout.depart)) { this.audio.play('depart'); this._depart(); return; }
    for (const row of this.hallLayout.rows) {
      if (this._pointInRect(tap, row.rect)) {
        if (this.meta.buy(row.id)) {
          this.audio.play('buy');
          this.effects.spawn('shock', { x: this.player.x, y: this.player.y, maxR: 180, dur: 0.4, color: Config.Palette.olympusGoldLight });
        }
        break;
      }
    }
  }

  _openDialogue() {
    this.dialogue = { lines: CHARON_LINES, index: 0 };
    this.audio.play('select');
  }
  _advanceDialogue() {
    if (!this.dialogue) return;
    this.dialogue.index++;
    if (this.dialogue.index >= this.dialogue.lines.length) this.dialogue = null;
  }

  _narrate(text, dur) {
    this.narration = { text, t: dur || 3.5, dur: dur || 3.5 };
  }

  // ---- 武器选择卡片 ----
  _layoutWeaponCards() {
    const cw = this.cssW, ch = this.cssH;
    const cardW = Math.min(cw - 56, 360);
    const cardH = 150, gap = 22;
    const total = WEAPON_LIST.length * cardH + (WEAPON_LIST.length - 1) * gap;
    const startY = (ch - total) / 2 + 16;
    const x = (cw - cardW) / 2;
    return WEAPON_LIST.map((id, i) => ({
      id, weapon: WEAPONS[id],
      rect: { x, y: startY + i * (cardH + gap), w: cardW, h: cardH }
    }));
  }

  // ============ 渲染 ============
  _render() {
    const ctx = this.ctx;
    const cam = this.camera;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = Config.Palette.bgDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let ox = 0, oy = 0;
    if (this.shake > 0) {
      const mm = this.shake * this.shake * Config.camera.shakeMax;
      ox = (Math.random() * 2 - 1) * mm;
      oy = (Math.random() * 2 - 1) * mm;
    }

    const rs = this.renderScale;
    ctx.setTransform(rs, 0, 0, rs,
      this.canvas.width / 2 - (cam.x + ox) * rs,
      this.canvas.height / 2 - (cam.y + oy) * rs);

    // 可视范围裁剪（大竞技场性能优化）
    const mg = 90;
    const view = {
      x0: cam.x - this.viewWorldW / 2 - mg, x1: cam.x + this.viewWorldW / 2 + mg,
      y0: cam.y - this.viewWorldH / 2 - mg, y1: cam.y + this.viewWorldH / 2 + mg
    };

    this.arena.draw(ctx, view);
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
      e.draw(ctx);
    }
    this.projectiles.draw(ctx, view);
    this.player.draw(ctx);
    if (this.state === 'playing' && this.swordNova && this.swordNova.active) this._drawSwordNova(ctx);
    this.effects.draw(ctx, view);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._renderUI(ctx);
  }

  _renderUI(ctx) {
    if (this.state === 'playing' || this.state === 'boon' || this.state === 'upgrade') {
      this._drawHud(ctx);
      this._drawBoonBar(ctx);
      this._drawBossBar(ctx);
    }
    if (this.state === 'playing') {
      this._drawLowHpVignette(ctx);
      this._drawJoystick(ctx);
      this._drawActionButtons(ctx);
      if (this.narration) this._drawNarration(ctx);
      if (this.bossWarnT > 0) this._drawBossWarn(ctx);
    }
    if (this.flashT > 0) this._drawFlash(ctx);
    if (this.state === 'hall') this._drawHall(ctx);
    if (this.state === 'weaponselect') this._drawWeaponSelect(ctx);
    if (this.state === 'upgrade') this._drawUpgradeOverlay(ctx);
    if (this.state === 'boon') this._drawBoonOverlay(ctx);
    if (this.state === 'settlement') this._drawSettlement(ctx);
  }

  _drawUpgradeOverlay(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(8,4,16,0.82)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const pw = Math.min(cw - 56, 360), ph = 232;
    const px = (cw - pw) / 2, py = (ch - ph) / 2;
    ctx.fillStyle = 'rgba(24,14,38,0.96)';
    ctx.fillRect(px, py, pw, ph);
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.olympusGold;
    ctx.strokeRect(px, py, pw, ph);

    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 18px serif';
    ctx.fillText('击败冥府守卫！', cw / 2, py + 34);

    ctx.fillStyle = 'rgba(243,233,210,0.7)';
    ctx.font = '13px sans-serif';
    ctx.fillText('晋升为', cw / 2, py + 66);
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 30px serif';
    ctx.fillText(this.upgradePopup.rankName, cw / 2, py + 100);

    ctx.fillStyle = P.textLight;
    ctx.font = '14px sans-serif';
    const lines = this.upgradePopup.lines;
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], cw / 2, py + 140 + i * 22);

    if (this.upgradePromptT > 0.4 && Math.floor(this.upgradePromptT * 2) % 2 === 0) {
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = '15px serif';
      ctx.fillText('轻触继续', cw / 2, py + ph - 22);
    }
  }

  _drawFlash(ctx) {
    ctx.globalAlpha = clamp(this.flashT / 0.18, 0, 1) * 0.55;
    ctx.fillStyle = '#fff7e0';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.globalAlpha = 1;
  }

  // 低血量红色暗角（脉动）
  _drawLowHpVignette(ctx) {
    const frac = this.player.hp / this.player.maxHp;
    if (frac >= 0.3) return;
    const cw = this.cssW, ch = this.cssH;
    const a = ((0.3 - frac) / 0.3) * (0.32 + 0.14 * Math.sin(this.elapsed * 6));
    const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.32, cw / 2, ch / 2, Math.max(cw, ch) * 0.62);
    g.addColorStop(0, 'rgba(150,12,12,0)');
    g.addColorStop(1, 'rgba(150,12,12,' + a.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  }

  // 战斗旁白（顶部淡入淡出）
  _drawNarration(ctx) {
    const n = this.narration;
    const a = clamp(Math.min(n.t, n.dur - n.t) / 0.5, 0, 1); // 头尾各 0.5s 渐变
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 16px serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8,4,16,0.85)';
    ctx.fillStyle = Config.Palette.olympusGoldLight;
    const y = this.cssH * 0.2;
    ctx.strokeText(n.text, this.cssW / 2, y);
    ctx.fillText(n.text, this.cssW / 2, y);
    ctx.restore();
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
    const pl = this.player;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key in this.input.buttons) {
      const b = this.input.buttons[key];
      let avail = true;
      if (key === 'dash') avail = pl.stamina >= Config.dash.staminaCost && pl.dashCd <= 0 && !pl.dashing;
      else if (key === 'special') avail = pl.specialCd <= 0;
      else if (key === 'ultimate') avail = pl.energyFull();

      const baseAlpha = avail ? (b.pressed ? 0.95 : 0.62) : 0.34;
      const rr = b.r * (b.pressed ? 0.92 : 1);
      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = b.pressed ? 'rgba(40,24,60,0.7)' : 'rgba(20,12,30,0.5)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = b.color;
      ctx.stroke();

      // 冷却 / 能量指示环
      if (key === 'ultimate') {
        const frac = clamp(pl.energy / pl.maxEnergy, 0, 1);
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = avail ? P.olympusGoldLight : P.lavaGlow;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r - 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      } else if (key === 'special' && pl.specialCd > 0) {
        const frac = clamp(pl.specialCd / pl.weapon.special.cooldown, 0, 1);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = 'rgba(243,233,210,0.5)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r - 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      } else if (key === 'dash' && pl.dashCd > 0) {
        const frac = clamp(pl.dashCd / Config.dash.cooldown, 0, 1);
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = 'rgba(143,208,255,0.7)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r - 4, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = avail ? 1 : 0.5;
      ctx.fillStyle = P.textLight;
      ctx.font = Math.round(b.r * 0.66) + 'px sans-serif';
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

    // HUD 底板（提升可读性）
    ctx.fillStyle = 'rgba(8,4,16,0.32)';
    ctx.fillRect(8, 8, 268, 90);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 20px serif';
    ctx.fillText('HADES · 冥府竞技场', 20, 14);

    const bx = 20, bw = 240;
    this._drawBar(ctx, bx, 44, bw, 16, this.player.hp / this.player.maxHp, P.hpFill, P.hpFillLight);
    // 每 50 HP 一个刻度
    ctx.strokeStyle = 'rgba(8,4,16,0.5)';
    ctx.lineWidth = 1;
    for (let v = 50; v < this.player.maxHp; v += 50) {
      const tx = bx + bw * (v / this.player.maxHp);
      ctx.beginPath(); ctx.moveTo(tx, 44); ctx.lineTo(tx, 44 + 16); ctx.stroke();
    }
    ctx.fillStyle = P.textLight;
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(this.player.hp) + '/' + this.player.maxHp, bx + 8, 44 + 8);
    this._drawBar(ctx, bx, 66, bw, 9, this.player.stamina / this.player.maxStamina, P.staminaFill, P.staminaFillLight);
    this._drawBar(ctx, bx, 81, bw, 9, this.player.energy / this.player.maxEnergy, '#e08a2b', P.olympusGoldLight);

    // 存活 / 击杀（右上）
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.85)';
    ctx.font = '14px sans-serif';
    ctx.fillText('存活 ' + fmtTime(this.elapsed) + ' · 击杀 ' + this.kills, cw - 16, 18);
    ctx.fillStyle = 'rgba(243,233,210,0.45)';
    ctx.fillText('武器：' + this.player.weapon.name + '  FPS ' + this.fps, cw - 16, 38);
  }

  _drawBoonBar(ctx) {
    const order = this.boons.order;
    if (order.length === 0) return;
    const x0 = 20, y0 = 100, s = 24, gap = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const def = this.boons.def(id);
      const lv = this.boons.level(id);
      const g = GODS[def.god];
      const x = x0 + i * (s + gap);
      ctx.beginPath();
      ctx.arc(x + s / 2, y0 + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,12,30,0.7)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = g.accent;
      ctx.stroke();
      ctx.fillStyle = g.color;
      ctx.font = 'bold 14px serif';
      ctx.fillText(def.short, x + s / 2, y0 + s / 2 + 1);
      ctx.fillStyle = Config.Palette.olympusGoldLight;
      for (let k = 0; k < lv; k++) {
        ctx.beginPath();
        ctx.arc(x + 4 + k * 5, y0 + s + 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  _drawBossBar(ctx) {
    const boss = this._aliveBoss();
    if (!boss) return;
    const P = Config.Palette;
    const cw = this.cssW;
    const w = Math.min(cw - 80, 420), h = 14, x = (cw - w) / 2, y = 116;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 13px serif';
    ctx.fillText('冥府守卫 · BOSS' + (boss.bossPhase === 2 ? '  【狂暴】' : ''), cw / 2, y - 3);
    this._drawBar(ctx, x, y, w, h, boss.hp / boss.maxHp, P.bloodRed, P.bloodRedLight);
  }

  _drawBossWarn(ctx) {
    const cw = this.cssW, ch = this.cssH;
    if (Math.floor(this.bossWarnT * 4) % 2 === 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = Config.Palette.bloodRedLight;
      ctx.font = 'bold 34px serif';
      ctx.fillText('⚠ BOSS 降临 ⚠', cw / 2, ch * 0.3);
    }
  }

  _wrapText(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (let i = 0; i < text.length; i++) {
      const test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = text[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  _drawWeaponSelect(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(8,4,16,0.9)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 28px serif';
    const topY = this.weaponChoices[0].rect.y - 50;
    ctx.fillText('选 择 你 的 武 器', cw / 2, topY);
    ctx.fillStyle = 'rgba(243,233,210,0.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText('武器决定普攻与特殊技（✦）的方式', cw / 2, topY + 26);

    for (const c of this.weaponChoices) this._drawWeaponCard(ctx, c);
  }

  _drawWeaponCard(ctx, c) {
    const P = Config.Palette;
    const r = c.rect;
    const w = c.weapon;

    ctx.fillStyle = 'rgba(24,14,38,0.96)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = w.color;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    const badgeX = r.x + 46, badgeY = r.y + r.h / 2;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,18,0.9)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = w.color;
    ctx.stroke();
    ctx.fillStyle = w.color;
    ctx.font = 'bold 30px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(w.short, badgeX, badgeY + 1);

    const tx = r.x + 92;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = w.color;
    ctx.font = 'bold 20px serif';
    ctx.fillText(w.name, tx, r.y + 18);
    ctx.fillStyle = 'rgba(243,233,210,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText(w.type === 'melee' ? '近战' : '远程', tx, r.y + 44);
    ctx.fillStyle = P.textLight;
    ctx.font = '13px sans-serif';
    const lines = this._wrapText(ctx, w.desc, r.w - 108);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], tx, r.y + 66 + i * 18);
  }

  _drawBoonOverlay(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    ctx.fillStyle = 'rgba(8,4,16,0.82)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 26px serif';
    const topY = this.boonChoices[0].rect.y - 44;
    ctx.fillText('诸 神 的 馈 赠', cw / 2, topY);
    ctx.fillStyle = 'rgba(243,233,210,0.6)';
    ctx.font = '14px sans-serif';
    ctx.fillText('选择一项祝福（可叠加）' + (this.pendingBoons > 1 ? '  · 剩余 ' + this.pendingBoons : ''), cw / 2, topY + 24);
    for (const c of this.boonChoices) this._drawBoonCard(ctx, c);
  }

  _drawBoonCard(ctx, c) {
    const P = Config.Palette;
    const r = c.rect;
    const def = c.def;
    const g = GODS[def.god];
    // 指定金色的祝福（如「惊涛裂岸」「冥王之力」）用金色描边与文案
    const accent = def.gold ? P.olympusGold : g.accent;
    const titleColor = def.gold ? P.olympusGoldLight : g.color;
    ctx.fillStyle = 'rgba(24,14,38,0.96)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = accent;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    const badgeX = r.x + 40, badgeY = r.y + r.h / 2;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,6,18,0.9)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = titleColor;
    ctx.font = 'bold 24px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.short, badgeX, badgeY + 1);
    const tx = r.x + 78;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = titleColor;
    ctx.font = 'bold 19px serif';
    ctx.fillText(def.name + '  Lv.' + c.nextLevel, tx, r.y + 16);
    ctx.fillStyle = def.gold ? 'rgba(245,197,66,0.7)' : 'rgba(243,233,210,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText(g.name + ' · ' + def.slot, tx, r.y + 40);
    ctx.fillStyle = def.gold ? P.olympusGoldLight : P.textLight;
    ctx.font = '13px sans-serif';
    const lines = this._wrapText(ctx, def.desc(c.nextLevel), r.w - 92);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], tx, r.y + 62 + i * 18);
  }

  // 死亡结算：统计黑暗精华
  _drawSettlement(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    const rr = this.runResult || { kills: 0, time: 0, bosses: 0, essence: 0, newBest: false };
    ctx.fillStyle = 'rgba(8,4,16,0.85)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = P.bloodRedLight;
    ctx.font = 'bold 42px serif';
    ctx.fillText('你 已 陨 落', cw / 2, ch * 0.26);

    const lines = [
      ['存活时间', fmtTime(rr.time)],
      ['击杀数', '' + rr.kills],
      ['击败 Boss', '' + rr.bosses]
    ];
    let y = ch * 0.4;
    ctx.font = '17px sans-serif';
    for (const [k, v] of lines) {
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(243,233,210,0.7)';
      ctx.fillText(k, cw / 2 - 10, y);
      ctx.textAlign = 'left'; ctx.fillStyle = P.textLight;
      ctx.fillText(v, cw / 2 + 10, y);
      y += 30;
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,233,210,0.7)';
    ctx.font = '15px sans-serif';
    ctx.fillText('获得黑暗精华', cw / 2, y + 16);
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 40px serif';
    ctx.fillText('✦ ' + rr.essence, cw / 2, y + 54);

    if (rr.newBest) {
      ctx.fillStyle = P.lavaGlow;
      ctx.font = 'bold 16px serif';
      ctx.fillText('★ 新纪录！', cw / 2, y + 90);
    }

    if (this.settlementT > 0.8 && Math.floor(this.settlementT * 2) % 2 === 0) {
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = '18px serif';
      ctx.fillText('轻触返回冥府殿堂', cw / 2, ch - 70);
    }
  }

  // 冥府殿堂：用精华购买永久升级，出发再次冒险
  _drawHall(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;

    // 殿堂背景（暗紫渐变 + 石柱 + 火盆）
    const bg = ctx.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#1a0f2a');
    bg.addColorStop(1, '#0c0612');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) {
      const px = 30 + i * (cw - 60) / 3;
      ctx.fillRect(px - 12, 60, 24, ch - 200);
    }

    // 殿堂中的角色立绘
    this.player.x = this.arena.centerX();
    this.player.y = this.arena.centerY();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 26px serif';
    ctx.fillText('冥 府 殿 堂', cw / 2, 34);
    ctx.fillStyle = 'rgba(243,233,210,0.65)';
    ctx.font = '13px sans-serif';
    ctx.fillText('「又回来了，王子。带着精华去变强吧。」 —— 卡戎', cw / 2, 70);

    // 精华与纪录
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 22px serif';
    ctx.fillText('✦ 黑暗精华 ' + this.meta.essence, cw / 2, 104);
    ctx.fillStyle = 'rgba(243,233,210,0.55)';
    ctx.font = '12px sans-serif';
    ctx.fillText('最佳：击杀 ' + this.meta.best.kills + ' · 存活 ' + fmtTime(this.meta.best.time), cw / 2, 134);
    ctx.fillStyle = 'rgba(243,233,210,0.4)';
    ctx.fillText('— 永久升级 —', cw / 2, 168);

    // 升级行
    for (const row of this.hallLayout.rows) {
      const u = this.meta.def(row.id);
      const lv = this.meta.level(row.id);
      const r = row.rect;
      const maxed = this.meta.isMax(row.id);
      const afford = this.meta.canBuy(row.id);

      ctx.fillStyle = 'rgba(24,14,38,0.92)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = afford ? P.olympusGold : 'rgba(245,197,66,0.35)';
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = P.olympusGoldLight;
      ctx.font = 'bold 15px serif';
      ctx.fillText(u.name + '  Lv.' + lv + '/' + u.max, r.x + 12, r.y + 9);
      ctx.fillStyle = 'rgba(243,233,210,0.7)';
      ctx.font = '12px sans-serif';
      ctx.fillText(u.effect(lv + (maxed ? 0 : 1)), r.x + 12, r.y + 30);

      // 价格 / 状态
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      if (maxed) {
        ctx.fillStyle = P.lavaGlow;
        ctx.font = 'bold 14px serif';
        ctx.fillText('已满', r.x + r.w - 14, r.y + r.h / 2);
      } else {
        ctx.fillStyle = afford ? P.olympusGoldLight : 'rgba(243,233,210,0.4)';
        ctx.font = 'bold 16px serif';
        ctx.fillText('✦ ' + this.meta.costNext(row.id), r.x + r.w - 14, r.y + r.h / 2);
      }
    }

    // 出发按钮
    const d = this.hallLayout.depart;
    ctx.fillStyle = 'rgba(40,24,60,0.9)';
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = P.olympusGold;
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = 'bold 24px serif';
    ctx.fillText('出 发', d.x + d.w / 2, d.y + d.h / 2 + 1);

    // 卡戎 NPC（可点击对话）
    const npc = this.hallLayout.npc;
    const ncx = npc.x + npc.w / 2, ncy = npc.y + npc.h * 0.5;
    drawCharacter(ctx, {
      x: ncx, y: ncy, r: 30, facing: Math.PI, moving: false, walk: 0,
      colors: { body: '#241a3a', bodyLight: '#3a2a55', outline: '#080510', skin: '#241a3a', hair: null, accent: null, eye: '#ffd76a', limb: '#160f28' },
      feature: null, glowEyes: true
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(243,233,210,0.85)';
    ctx.font = '12px serif';
    ctx.fillText('卡戎 ▾', ncx, npc.y + npc.h - 4);

    if (this.dialogue) this._drawDialogue(ctx);
  }

  _drawDialogue(ctx) {
    const P = Config.Palette;
    const cw = this.cssW, ch = this.cssH;
    const d = this.dialogue;
    const line = d.lines[d.index];
    const speaker = line[0], text = line[1];

    const bx = 20, bw = cw - 40, bh = 118, by = ch - 150;
    ctx.fillStyle = 'rgba(8,4,16,0.94)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = P.olympusGold;
    ctx.strokeRect(bx, by, bw, bh);

    // 说话人标签
    ctx.fillStyle = P.olympusGold;
    ctx.fillRect(bx, by - 26, 96, 26);
    ctx.fillStyle = '#0c0612';
    ctx.font = 'bold 15px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speaker, bx + 48, by - 12);

    // 正文（折行）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.textLight;
    ctx.font = '15px sans-serif';
    const lines = this._wrapText(ctx, text, bw - 32);
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + 16, by + 18 + i * 22);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = P.olympusGoldLight;
    ctx.font = '12px serif';
    ctx.fillText('▼ 轻触继续  ' + (d.index + 1) + '/' + d.lines.length, bx + bw - 14, by + bh - 10);
  }
}

module.exports = Game;
