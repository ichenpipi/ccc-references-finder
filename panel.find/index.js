const { readFileSync } = require('fs');

/**
 * i18n
 * @param {string} key
 * @returns {string}
 */
const translate = (key) => Editor.T(`${PACKAGE_NAME}.${key}`);

/** 包名 */
const PACKAGE_NAME = 'ccc-references-finder';

// 注册面板
Editor.Panel.extend({

  /** HTML */
  template: readFileSync(Editor.url(`packages://${PACKAGE_NAME}/panel.find/index.html`), 'utf8'),

  /** 样式 */
  style: readFileSync(Editor.url(`packages://${PACKAGE_NAME}/panel.find/index.css`), 'utf8'),

  /**
   * 当面板渲染成功后触发
   */
  ready() {
    // 创建 Vue 实例
    new window.Vue({

      /**
       * 挂载目标
       * @type {string | Element}
       */
      el: this.shadowRoot,

      /**
       * 数据对象
       */
      data: {
        // 多语言文本
        titleLabel: translate('findUuid'),
        uuidLabel: translate('uuid'),
        findLabel: translate('find'),
        // 资源 uuid
        uuid: '',
        // 按钮状态
        isProcessing: false
      },

      /**
       * 实例函数
       * @type {{ [key: string]: Function }}
       */
      methods: {

        /**
         * 查找
         */
        onFindBtnClick() {
          if (this.isProcessing) return;
          this.isProcessing = true;
          // uuid
          const uuid = this.uuid;
          // 发消息给主进程
          Editor.Ipc.sendToMain(`${PACKAGE_NAME}:find-via-uuid`, uuid, (error) => {
            this.isProcessing = false;
          });
        },

      },

    });
  }

});
