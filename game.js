// game.js —— 微信小游戏入口
// 小游戏没有 WXML / pages / app.json，入口固定为根目录 game.js。
// 这里只负责：拿到上屏画布、注册全局触摸、绑定前后台、启动引擎；
// 真正的游戏逻辑全部在 js/engine.js 及其子模块里。
const Game = require('./js/engine.js');

// 主屏画布：小游戏中第一次 wx.createCanvas() 返回的就是上屏画布
const canvas = wx.createCanvas();

const info = wx.getSystemInfoSync();
const cssW = info.windowWidth;
const cssH = info.windowHeight;

// 创建游戏实例（引擎内部完成像素比适配、缩放、主循环）
const game = new Game(canvas, cssW, cssH);

// 全局触摸事件 → 输入系统（小游戏用 wx.onTouch* 注册，没有 bindtouch）
wx.onTouchStart((e) => game.input.onTouchStart(e));
wx.onTouchMove((e) => game.input.onTouchMove(e));
wx.onTouchEnd((e) => game.input.onTouchEnd(e));
wx.onTouchCancel((e) => game.input.onTouchEnd(e));

// 前后台切换：切后台暂停循环、回前台恢复，避免空耗
wx.onHide(() => game.stop());
wx.onShow(() => game.start());

// 启动
game.start();
