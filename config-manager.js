const Path = require('path');
const Fs = require('fs');

/** config.json 文件路径 */
const configFilePath = Path.join(__dirname, 'config.json');

/** 默认配置 */
const defaultConfig = {
    expand: true,
    detail: true
};

/** package.json 文件路径 */
const packageFilePath = Path.join(__dirname, 'package.json');

/** package.json 中的 key */
const itemKey = 'i18n:MAIN_MENU.package.title/i18n:ccc-references-finder.name/i18n:ccc-references-finder.searchSelected';

/** 配置管理器 */
const ConfigManager = {

    /**
     * 读取配置
     * @param {boolean} readHotKey 是否读取快捷键
     * @returns {{ expand: boolean, detail: boolean, hotkey?: string }}
     */
    read(readHotKey) {
        const config = { ...defaultConfig };
        // 配置
        if (Fs.existsSync(configFilePath)) {
            const configData = JSON.parse(Fs.readFileSync(configFilePath));
            config.expand = configData.expand;
            config.detail = configData.detail;
        }
        // 快捷键
        if (readHotKey) {
            const packageData = JSON.parse(Fs.readFileSync(packageFilePath));
            config.hotkey = packageData['main-menu'][itemKey]['accelerator'];
        }
        // 返回配置
        return config;
    },

    /**
     * 保存配置
     * @param {{ expand: boolean, detail: boolean, hotkey: string }} config 配置
     */
    save(config) {
        const { expand, detail, hotkey } = config;
        // 配置
        const configData = Fs.existsSync(configFilePath) ? JSON.parse(Fs.readFileSync(configFilePath)) : {};
        if (configData.expand !== expand || configData.detail !== detail) {
            configData.expand = expand;
            configData.detail = detail;
            Fs.writeFileSync(configFilePath, JSON.stringify(configData, null, 2));
        }
        // 快捷键
        const packageData = JSON.parse(Fs.readFileSync(packageFilePath)),
            item = packageData['main-menu'][itemKey];
        if (item['accelerator'] !== hotkey) {
            item['accelerator'] = hotkey;
            Fs.writeFileSync(packageFilePath, JSON.stringify(packageData, null, 2));
        }
    },

}

module.exports = ConfigManager;
