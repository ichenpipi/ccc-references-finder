const PanelManager = require('./panel-manager');
const ConfigManager = require('../common/config-manager');
const EditorMainKit = require('../eazax/editor-main-kit');
const { checkUpdate, print, translate } = require('../eazax/editor-main-util');
const { openRepository } = require('../eazax/package-util');
const EditorAPI = require('./editor-api');
const Parser = require('./parser');
const Finder = require('./finder');
const Printer = require('./printer');

/**
 * 生命周期：加载
 */
function load() {
    // 监听事件
    EditorMainKit.register();
}

/**
 * 生命周期：卸载
 */
function unload() {
    // 取消事件监听
    EditorMainKit.unregister();
}

/**
 * 查找当前选中资源
 */
async function findCurrentSelection() {
    // 过滤选中的资源 uuid
    const uuids = EditorAPI.getCurrentSelectedAssets();
    for (let i = 0; i < uuids.length; i++) {
        const assetInfo = EditorAPI.assetInfoByUuid(uuids[i]);
        if (assetInfo.type === 'folder') {
            uuids.splice(i--);
        }
    }
    // 未选择资源
    if (uuids.length === 0) {
        print('log', translate('please-select-assets'));
        return;
    }
    // 遍历查找
    for (let i = 0; i < uuids.length; i++) {
        const uuid = uuids[i],
            assetInfo = EditorAPI.assetInfoByUuid(uuid),
            shortUrl = assetInfo.url.replace('db://', '');
        // 查找引用
        print('log', `${translate('find-asset-refs')} ${shortUrl}`);
        const refs = await Finder.findByUuid(uuid);
        if (refs.length === 0) {
            print('log', `${translate('no-refs')} ${shortUrl}`);
            continue;
        }
        // 打印结果
        Printer.printResult({
            type: assetInfo.type,
            uuid: uuid,
            url: assetInfo.url,
            path: assetInfo.path,
            refs: refs,
        });
    }
}

/**
 * 资源变化回调
 * @param {{ type: string, uuid: string }} info 
 */
function onAssetChanged(info) {
    const { type, uuid } = info;
    // 场景和预制体
    if (type === 'scene' || type === 'prefab') {
        const { url, path } = EditorAPI.assetInfoByUuid(uuid);
        // 排除内置资源
        if (url.indexOf('db://internal') !== -1) {
            return;
        }
        // 更新节点树
        Parser.updateCache(path);
    }
}

module.exports = {

    /**
     * 扩展消息
     */
    messages: {

        /**
         * 查找当前选中资源
         * @param {*} event 
         */
        'find-current-selection'(event) {
            findCurrentSelection();
        },

        /**
         * 打开设置面板
         * @param {*} event 
         */
        'open-settings-panel'(event) {
            PanelManager.openSettingsPanel();
        },

        /**
         * 检查更新
         * @param {*} event 
         */
        'menu-check-update'(event) {
            checkUpdate(true);
        },

        /**
         * 版本
         * @param {*} event 
         */
        'menu-version'(event) {
            openRepository();
        },

        /**
         * 场景面板加载完成后
         * @param {*} event 
         */
        'scene:ready'(event) {
            // 自动检查更新
            const config = ConfigManager.get();
            if (config.autoCheckUpdate) {
                checkUpdate(false);
            }
        },

        /**
         * 资源变化
         * @param {*} event 
         * @param {{ type: string, uuid: string }} info 
         */
        'asset-db:asset-changed'(event, info) {
            onAssetChanged(info);
        },

    },

    load,

    unload,

};
