// pages/index/index.js —— 游戏页面，负责初始化 Canvas 并把触摸事件转发给游戏
const Game = require('../../js/game.js');

Page({
  data: {
    screenW: 0,
    screenH: 0
  },

  game: null,

  onLoad() {
    // 用 getSystemInfoSync 拿到窗口尺寸，让 canvas 铺满整屏
    const info = wx.getSystemInfoSync();
    this.setData({
      screenW: info.windowWidth,
      screenH: info.windowHeight
    });
  },

  onReady() {
    // Canvas 2D 需要通过节点查询拿到真实 canvas 节点
    wx.createSelectorQuery()
      .in(this)
      .select('#gameCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          console.error('[Hades] 获取 Canvas 节点失败');
          return;
        }
        const canvas = res[0].node;
        const cssW = res[0].width;
        const cssH = res[0].height;
        this.game = new Game(canvas, cssW, cssH);
        this.game.start();
      });
  },

  // 触摸事件转发到输入系统
  onTouchStart(e) { if (this.game) this.game.input.onTouchStart(e); },
  onTouchMove(e) { if (this.game) this.game.input.onTouchMove(e); },
  onTouchEnd(e) { if (this.game) this.game.input.onTouchEnd(e); },
  onTouchCancel(e) { if (this.game) this.game.input.onTouchEnd(e); },

  // 切后台暂停循环，回前台恢复，避免空耗
  onHide() { if (this.game) this.game.stop(); },
  onShow() { if (this.game) this.game.start(); },
  onUnload() { if (this.game) this.game.stop(); }
});
