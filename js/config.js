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
  shadow: 'rgba(0,0,0,0.45)'
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
    speed: 330,        // 世界单位/秒
    moveDamp: 16       // 加减速平滑系数（越大越跟手）
  },

  // 房间（第一步：单个大房间，便于展示镜头跟随）
  room: {
    width: 1800,
    height: 2000,
    wallThickness: 40
  },

  // 镜头
  camera: {
    smooth: 8          // 跟随平滑系数
  },

  // 虚拟摇杆（CSS px 单位）
  joystick: {
    maxRadius: 92,
    deadZone: 0.08
  }
};

module.exports = Config;
