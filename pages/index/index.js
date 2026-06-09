// pages/index/index.js —— 游戏页面，负责初始化 Canvas 并把触摸事件转发给游戏
const Game = require('../../js/engine.js');

Page({
  data: {
    screenW: 0,
    screenH: 0
  },

  game: null,

  onLoad() {
    // 用 getSystemInfoSync 拿到窗口尺寸，让 canvas 铺满整屏
    const info = wx.getSystemInfoSync();
    this.sysW = info.windowWidth;
    this.sysH = info.windowHeight;
    this.setData({ screenW: this.sysW, screenH: this.sysH });
  },

  onReady() {
    this._initCanvas(0);
  },

  // Canvas 2D 需要通过节点查询拿到真实 canvas 节点（页面用 wx.createSelectorQuery，不能用 .in(this)）
  _initCanvas(attempt) {
    wx.createSelectorQuery()
      .select('#gameCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node) {
          // 布局可能尚未就绪，重试几次
          if (attempt < 5) {
            setTimeout(() => this._initCanvas(attempt + 1), 50);
          } else {
            console.error('[Hades] 获取 Canvas 节点失败');
          }
          return;
        }
        const canvas = node;
        // 优先用查询到的尺寸，为 0 时回退到系统窗口尺寸
        const cssW = res[0].width || this.sysW;
        const cssH = res[0].height || this.sysH;
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
