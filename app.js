// app.js —— 小程序入口
App({
  globalData: {
    systemInfo: null
  },

  onLaunch() {
    try {
      // 第一步要求：用 wx.getSystemInfoSync 获取屏幕信息用于动态缩放
      this.globalData.systemInfo = wx.getSystemInfoSync();
    } catch (e) {
      console.error('[Hades] 获取系统信息失败', e);
    }
  }
});
