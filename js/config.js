// js/config.js —— 全局常量与配置（数值集中管理，便于后续步骤扩展）

// 逻辑（设计）分辨率：以 750 宽为基准等比缩放
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

// 美术配色：对标《Hades》——冥界深紫 / 岩浆橙 vs 奥林匹斯金蓝
const Palette = {
  bgDeep: '#0d0613',            // 屏幕底色（冥界虚空）
  underworldPurple: '#241334',  // 冥界深紫
  underworldPurpleLight: '#3a1f55',
  lavaOrange: '#ff6a2b',        // 岩浆橙
  lavaGlow: '#ffae42',
  olympusGold: '#f5c542',       // 奥林匹斯金
  olympusGoldLight: '#ffe08a',
  olympusBlue: '#4ea3ff',       // 奥林匹斯蓝
  olympusBlueLight: '#8fd0ff',
  bloodRed: '#d23b2e',          // 扎格列欧斯的暗红
  bloodRedLight: '#ff6f5e',
  floor: '#1c1330',             // 地板
  floorLine: '#3a2a55',         // 地板网格线
  wall: '#0b0410',              // 墙体
  textLight: '#f3e9d2',         // 浅色文字
  shadow: 'rgba(0,0,0,0.45)',

  // 敌人
  enemyBody: '#6a3d8f',         // 冥界亡魂紫
  enemyBodyLight: '#9b6fc4',
  enemyEye: '#ffd76a',

  // UI 血条 / 体力
  hpBack: 'rgba(0,0,0,0.5)',
  hpFill: '#d23b2e',
  hpFillLight: '#ff6f5e',
  staminaFill: '#4ea3ff',
  staminaFillLight: '#8fd0ff',

  // 命中特效
  slash: '#ffe08a',
  spark: '#ffae42'
};

const Config = {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,

  // 主循环：固定逻辑步长 1/60，单帧最大步进 0.25s 防止卡顿后追帧爆炸
  FIXED_DT: 1 / 60,
  MAX_FRAME_TIME: 0.25,
  MAX_STEPS_PER_FRAME: 5,

  Palette,

  // 玩家
  player: {
    radius: 28,
    speed: 330,             // 世界单位/秒
    moveDamp: 16,           // 加减速平滑系数（越大越跟手）
    maxHp: 100,
    maxStamina: 100,
    staminaRegen: 26,       // 体力每秒回复
    staminaRegenDelay: 0.4, // 消耗后延迟多久开始回复
    hitInvuln: 0.7,         // 受击无敌时长
    knockbackTaken: 160,    // 受击被击退的速度
    staggerTime: 0.14,      // 受击短硬直（失控时长）
    maxEnergy: 100,         // 神怒能量上限
    energyPerHit: 3,        // 每次命中获得能量（积攒速度延长一倍）
    energyOnHurt: 4         // 受击获得能量
  },

  // 神怒大招（满能量释放，全屏伤害）
  ultimate: {
    damage: 120,
    knockback: 520,
    radius: 1300
  },

  // 弹射物（玩家弓箭 + 敌方弹幕 + 大招箭雨 + Boss 环形弹幕）对象池
  projectiles: {
    poolSize: 260
  },

  // 拾取物（回血/精华/能量），磁吸拾取
  pickup: {
    poolSize: 160,
    magnetRange: 140,
    magnetAccel: 1200,
    maxSpeed: 620,
    collectPad: 16,
    life: 12,
    popSpeed: 140
  },

  // 怪物掉落（按等级）
  drops: {
    normal: { health: { chance: 0.12, value: 12 }, essence: { chance: 0.28, min: 1, max: 2 }, energy: { chance: 0.12, value: 8 } },
    elite: { health: { chance: 0.5, value: 22 }, essence: { chance: 1, min: 3, max: 5 }, energy: { chance: 0.6, value: 18 } },
    boss: { health: { chance: 1, value: 45 }, essence: { chance: 1, min: 16, max: 26 }, energy: { chance: 1, value: 60 } }
  },

  // 普通攻击（扇形判定 + 三段连击）
  attack: {
    damage: 18,
    reach: 100,             // 扇形半径（从玩家中心，命中时再加敌人半径）
    halfAngle: Math.PI / 3, // 扇形半角 60°
    windup: 0.05,           // 前摇
    active: 0.12,           // 命中判定持续
    recover: 0.15,          // 后摇
    gap: 0.02,              // 两次挥砍最小间隔
    comboWindow: 0.45,      // 连击衔接窗口
    knockback: 230,
    hitstun: 0.3,
    moveScale: 0.45,        // 攻击时移动速度倍率
    thirdHitDamageBonus: 12,
    thirdHitReachBonus: 26,
    thirdHitKnockbackBonus: 170
  },

  // 闪避
  dash: {
    distance: 200,
    duration: 0.16,
    iFrames: 0.26,          // 无敌帧（略长于位移）
    cooldown: 0.28,
    staminaCost: 25
  },

  // 地牢（第三步：网格化随机房间 + 走廊 + 门）
  dungeon: {
    minRooms: 8,
    maxRooms: 11,
    roomW: 1500,
    roomH: 1400,
    corridor: 260,          // 相邻房间间距（走廊长度）
    wallThickness: 40,
    doorWidth: 220,
    triggerDepth: 74,       // 门触发区纵深
    transitionTime: 0.55    // 镜头平移/过门时长
  },

  // 单一竞技场（放大约 5×，无房间切换）
  arena: {
    width: 3600,
    height: 3200,
    wallThickness: 40
  },

  // 地面装饰（草丛/花朵/蘑菇）：有体积、碰到会晃动，但不影响移动
  decor: {
    count: 120,
    touchRadius: 30,
    wobbleTime: 0.5,
    types: ['grass', 'grass', 'grass', 'flower', 'flower', 'mushroom']
  },

  // 刷怪导演：普通怪持续补充，精英/Boss 不定时随机刷新
  spawn: {
    normalCap: 20,
    normalIntervalMin: 1.6,
    normalIntervalMax: 2.8,
    normalBatchMin: 2,
    normalBatchMax: 4,
    initialNormals: 9,
    eliteIntervalMin: 14,
    eliteIntervalMax: 24,
    eliteCap: 3,
    bossIntervalMin: 45,
    bossIntervalMax: 70,
    edgeMargin: 120,
    safeDist: 360
  },

  // 敌人：数据驱动（tier 等级 / behavior 行为 / color 配色 / ranged 远程）
  enemy: {
    maxOnScreen: 30,        // 非 Boss 同屏硬上限
    normalTypes: ['melee', 'shooter', 'brute'],
    // 普通怪加权刷新池（绿色射手 shooter 权重减半）
    normalSpawn: ['melee', 'melee', 'brute', 'brute', 'dog', 'dog', 'spider', 'spider', 'bloat', 'shooter'],
    eliteTypes: ['elite', 'elite_caster'],
    bossTypes: ['boss', 'boss_archer'],

    // —— 普通 ——
    melee: {
      tier: 'normal', behavior: 'chaser', color: 'melee', feature: null,
      radius: 26, speed: 152, maxHp: 40, contactDamage: 12, contactCooldown: 0.9,
      spawnTime: 0.5, knockbackDecay: 7, hitstunMin: 0.18, knockbackResist: 1, stunnable: true
    },
    shooter: {
      tier: 'normal', behavior: 'shooter', color: 'shooter', feature: null,
      radius: 24, speed: 122, maxHp: 30, contactDamage: 8, contactCooldown: 0.9,
      spawnTime: 0.55, knockbackDecay: 7, hitstunMin: 0.16, knockbackResist: 1, stunnable: true,
      ranged: { damage: 9, speed: 360, range: 560, cooldown: 1.9, count: 1, spread: 0, radius: 8, color: '#7cfcae', preferred: 380 }
    },
    brute: {
      tier: 'normal', behavior: 'chaser', color: 'brute', feature: 'horns',
      radius: 34, speed: 106, maxHp: 95, contactDamage: 18, contactCooldown: 1.0,
      spawnTime: 0.7, knockbackDecay: 5, hitstunMin: 0.12, knockbackResist: 0.6, stunnable: true
    },
    // 野狗：会猛冲（复用 charger 行为，参数更轻快）
    dog: {
      tier: 'normal', behavior: 'charger', color: 'dog', feature: null, shape: 'beast',
      radius: 22, speed: 168, maxHp: 34, contactDamage: 12, contactCooldown: 0.8,
      spawnTime: 0.5, knockbackDecay: 7, hitstunMin: 0.12, knockbackResist: 0.8, stunnable: true,
      chargeRange: 460, chargeCdMin: 2.2, chargeCdMax: 3.6,
      telegraphTime: 0.4, chargeSpeed: 720, chargeTime: 0.32,
      recoverTime: 0.5, chargeDamageMul: 1.6, phase2SpeedMul: 1, phase2CdMul: 1
    },
    // 蜘蛛：近距离吐蛛丝，命中使玩家减速 30%
    spider: {
      tier: 'normal', behavior: 'shooter', color: 'spider', feature: null, shape: 'spider',
      radius: 24, speed: 132, maxHp: 32, contactDamage: 8, contactCooldown: 0.9,
      spawnTime: 0.55, knockbackDecay: 7, hitstunMin: 0.14, knockbackResist: 1, stunnable: true,
      ranged: { damage: 5, speed: 330, range: 340, cooldown: 2.0, count: 1, spread: 0, radius: 9, color: '#dfeec0', preferred: 280, slowMul: 0.7, slowDur: 2.5 }
    },
    // 肥胖怪：贴近后原地蓄力 2 秒自爆
    bloat: {
      tier: 'normal', behavior: 'bloater', color: 'bloat', feature: null, shape: 'blob',
      radius: 36, speed: 92, maxHp: 70, contactDamage: 0, contactCooldown: 1.0,
      spawnTime: 0.6, knockbackDecay: 6, hitstunMin: 0.1, knockbackResist: 0.5, stunnable: true,
      fuseTime: 2.0, explodeRadius: 170, explodeDamage: 30
    },

    // —— 精英 ——
    elite: {
      tier: 'elite', behavior: 'chaser', color: 'elite', feature: 'horns',
      radius: 38, speed: 138, maxHp: 160, contactDamage: 20, contactCooldown: 1.0,
      spawnTime: 0.7, knockbackDecay: 6, hitstunMin: 0.12, knockbackResist: 0.5, stunnable: true
    },
    elite_caster: {
      tier: 'elite', behavior: 'shooter', color: 'elite_caster', feature: 'horns',
      radius: 36, speed: 122, maxHp: 150, contactDamage: 14, contactCooldown: 1.0,
      spawnTime: 0.7, knockbackDecay: 6, hitstunMin: 0.12, knockbackResist: 0.5, stunnable: true,
      ranged: { damage: 14, speed: 380, range: 640, cooldown: 1.5, count: 3, spread: Math.PI / 9, radius: 9, color: '#b07cff', preferred: 460 }
    },

    // —— Boss ——
    boss: {
      tier: 'boss', behavior: 'charger', color: 'boss', feature: 'crown',
      radius: 72, speed: 96, maxHp: 1200, contactDamage: 26, contactCooldown: 0.8,
      spawnTime: 1.0, knockbackDecay: 6, hitstunMin: 0, knockbackResist: 0.12, stunnable: false,
      chargeRange: 560, chargeCdMin: 3.5, chargeCdMax: 5.5,
      telegraphTime: 0.7, chargeSpeed: 780, chargeTime: 0.5,
      recoverTime: 0.9, chargeDamageMul: 1.7, phase2SpeedMul: 1.25, phase2CdMul: 0.6,
      // 专属技能：践踏冲击波 / 召唤爪牙（交替）
      skillCdMin: 6, skillCdMax: 9, slamRadius: 430, slamDamage: 24, summonCount: 3
    },
    boss_archer: {
      tier: 'boss', behavior: 'shooter', color: 'boss_archer', feature: 'crown',
      radius: 64, speed: 108, maxHp: 1000, contactDamage: 22, contactCooldown: 0.8,
      spawnTime: 1.0, knockbackDecay: 6, hitstunMin: 0, knockbackResist: 0.14, stunnable: false,
      ranged: { damage: 16, speed: 430, range: 780, cooldown: 1.1, count: 5, spread: Math.PI / 5, radius: 10, color: '#ffd76a', preferred: 540 },
      // 专属技能：360° 环形弹幕（二阶段更密并旋转）
      skillCdMin: 5, skillCdMax: 7.5, ringCountP1: 14, ringCountP2: 22
    }
  },

  // 每击败 1 个 Boss，刷怪强度提升
  difficulty: {
    normalCapPerBoss: 4,
    eliteCapPerBoss: 1,
    batchPerBoss: 1,
    intervalScalePerBoss: 0.88   // 刷新间隔每级乘以该系数（更快）
  },

  // 镜头
  camera: {
    smooth: 8,
    shakeDecay: 2.6,         // 震屏衰减速度
    shakeMax: 16             // 最大震屏位移（世界单位）
  },

  // 虚拟摇杆（CSS px 单位）
  joystick: {
    maxRadius: 92,
    deadZone: 0.08
  },

  // 特效对象池
  effects: {
    poolSize: 80
  }
};

module.exports = Config;
