const Fs = require('fs');
const Path = require('path');
const ConfigManager = require('./config-manager');
const FileUtil = require('./utils/file-util');
const ObjectUtil = require('./utils/object-util');

/**
 * i18n
 * @param {string} key
 * @returns {string}
 */
const translate = (key) => Editor.T(`${PACKAGE_NAME}.${key}`);

/** 包名 */
const PACKAGE_NAME = 'ccc-references-finder';

/** 扩展名 */
const EXTENSION_NAME = '🔎';
// const EXTENSION_NAME = translate('name');

module.exports = {

  /**
   * 节点树缓存
   * @type {{ [key: string]: object }}
   */
  cache: Object.create(null),

  /**
   * 配置：是否自动展开结果
   * @type {boolean}
   */
  expand: true,

  /**
   * 配置：结果精确到节点
   * @type {boolean}
   */
  detail: true,

  /**
   * 扩展消息
   * @type {{ [key: string]: Function }}
   */
  messages: {

    /**
     * 打开 uuid 查找面板
     */
    'open-find-panel'() {
      Editor.Panel.open(`${PACKAGE_NAME}.find`);
    },

    /**
     * 打开设置面板
     */
    'open-setting-panel'() {
      Editor.Panel.open(`${PACKAGE_NAME}.setting`);
    },

    /**
     * 查找当前选中资源
     * @param {*} event 
     */
    'find-current-selection'(event) {
      this.findCurrentSelection();
    },

    /**
     * 通过 uuid 查找
     * @param {*} event 
     * @param {string} uuid 
     */
    'find-via-uuid'(event, uuid) {
      this.findViaUuid(uuid);
      event.reply(null, null);
    },

    /**
     * 资源变化
     * @param {*} event 
     * @param {{ type: string, uuid: string }} info 
     */
    'asset-db:asset-changed'(event, info) {
      const { type, uuid } = info;
      // 场景和预制体
      if (type === 'scene' || type === 'prefab') {
        const assetInfo = Editor.assetdb.assetInfoByUuid(uuid);
        // 排除内置资源
        if (assetInfo.url.startsWith('db://internal')) {
          return;
        }
        // 更新节点树
        this.updateNodeTree(assetInfo.path);
      }
    },

    /**
     * 读取配置
     * @param {*} event 
     */
    'read-config'(event) {
      const config = ConfigManager.read(true);
      event.reply(null, config);
    },

    /**
     * 保存配置
     * @param {*} event 
     * @param {{ expand: boolean, detail: boolean, hotkey: string }} config 
     */
    'save-config'(event, config) {
      this.expand = config.expand;
      this.detail = config.detail;
      ConfigManager.save(config);
      event.reply(null, true);
    },

  },

  /**
   * 生命周期：加载
   */
  load() {
    // 读取配置
    const config = ConfigManager.read(false);
    this.expand = config.expand;
    this.detail = config.detail;
  },

  /**
   * 生命周期：卸载
   */
  unload() {
    this.cache = null;
  },

  /**
   * 查找当前选中资源引用
   */
  findCurrentSelection() {
    // 当前选中资源
    const uuids = Editor.Selection.curSelection('asset');
    if (uuids.length === 0) {
      Editor.log(`[${EXTENSION_NAME}]`, translate('selectAssets'));
      return;
    }
    // 根据 uuid 查找
    for (let i = 0; i < uuids.length; i++) {
      this.findViaUuid(uuids[i]);
    }
  },

  /**
   * 使用 uuid 进行查找
   * @param {string} uuid 
   */
  findViaUuid(uuid) {
    // 是否为有效 uuid
    if (!Editor.Utils.UuidUtils.isUuid(uuid)) {
      Editor.log(`[${EXTENSION_NAME}]`, translate('invalidUuid'), uuid);
      return;
    }
    // 获取资源信息
    const assetInfo = Editor.assetdb.assetInfoByUuid(uuid);
    if (assetInfo) {
      const url = assetInfo.url.replace('db://', '');
      // 暂不查找文件夹
      if (assetInfo.type === 'folder') {
        Editor.log(`[${EXTENSION_NAME}]`, translate('notSupportFolder'), url);
        return;
      }
      // 处理文件路径 & 打印头部日志
      const urlItems = url.split('/');
      if (!urlItems[urlItems.length - 1].includes('.')) {
        urlItems.splice(urlItems.length - 1);
      }
      Editor.log(`[${EXTENSION_NAME}]`, translate('findAssetRefs'), urlItems.join('/'));
      // 记录子资源 uuid
      const subUuids = assetInfo ? [] : null;
      // 资源类型检查
      if (assetInfo.type === 'texture') {
        // 纹理子资源
        const subAssetInfos = Editor.assetdb.subAssetInfosByUuid(uuid);
        if (subAssetInfos) {
          for (let i = 0; i < subAssetInfos.length; i++) {
            subUuids.push(subAssetInfos[i].uuid);
          }
          uuid = null;
        }
      } else if (assetInfo.type === 'typescript' || assetInfo.type === 'javascript') {
        // 脚本
        uuid = Editor.Utils.UuidUtils.compressUuid(uuid);
      }
      // 查找
      const results = uuid ? this.findReferences(uuid) : [];
      if (subUuids && subUuids.length > 0) {
        for (let i = 0, l = subUuids.length; i < l; i++) {
          const subResults = this.findReferences(subUuids[i]);
          if (subResults.length > 0) {
            results.push(...subResults);
          }
        }
      }
      // Done
      this.printResult(results);
    } else {
      // 不存在的资源，直接查找 uuid
      Editor.log(`[${EXTENSION_NAME}]`, translate('findAssetRefs'), uuid);
      const result = this.findReferences(uuid);
      // Done
      this.printResult(result);
    }
  },

  /**
   * 查找节点中的引用
   * @param {object} node 目标节点
   * @param {string} uuid 查找的 uuid
   * @param {object} nodeTree 节点所在的节点树
   * @param {object[]} container 结果容器
   */
  findRefsInNode(node, uuid, nodeTree, container) {
    // 检查节点上的组件是否有引用
    const components = node.components;
    if (components && components.length > 0) {
      for (let i = 0, l = components.length; i < l; i++) {
        const info = this.getContainsInfo(components[i], uuid);
        if (!info.contains) continue;
        // 资源类型
        let type = components[i]['__type__'];
        // 是否为脚本资源
        if (Editor.Utils.UuidUtils.isUuid(type)) {
          const scriptUuid = Editor.Utils.UuidUtils.decompressUuid(type),
            assetInfo = Editor.assetdb.assetInfoByUuid(scriptUuid);
          type = Path.basename(assetInfo.url);
        }
        // 处理属性名称
        let property = info.property;
        if (property) {
          // Label 组件需要特殊处理
          if (type === 'cc.Label' && property === '_N$file') {
            property = 'font';
          } else {
            // 去除属性名的前缀
            if (property.startsWith('_N$')) {
              property = property.replace('_N$', '');
            } else if (property[0] === '_') {
              property = property.substring(1);
            }
          }
        }
        // 保存结果
        container.push({
          node: node.path,
          component: type,
          property: property
        });
      }
    }
    // 检查预制体是否有引用
    const prefab = node.prefab;
    if (prefab) {
      // 排除预制体自己
      if (uuid !== nodeTree['__uuid__']) {
        const contains = ObjectUtil.containsValue(prefab, uuid);
        if (contains) {
          container.push({
            node: node.path
          });
        }
      }
    }
    // 遍历子节点
    const children = node.children;
    if (children && children.length > 0) {
      for (let i = 0, l = children.length; i < l; i++) {
        this.findRefsInNode(children[i], uuid, nodeTree, container);
      }
    }
  },

  /**
   * 查找引用
   * @param {string} uuid 
   * @returns {object[]}
   */
  findReferences(uuid) {
    const results = [];
    /**
     * 文件处理函数
     * @param {string} filePath 文件路径
     * @param {Fs.Stats} stats 
     */
    const searchHandler = (filePath, stats) => {
      const extname = Path.extname(filePath);
      // 场景和预制体资源
      if (extname === '.fire' || extname === '.prefab') {
        // 将资源数据转为节点树
        const nodeTree = this.getNodeTree(filePath),
          children = nodeTree.children,
          refs = [];
        // 遍历节点
        for (let i = 0, l = children.length; i < l; i++) {
          this.findRefsInNode(children[i], uuid, nodeTree, refs);
        }
        // 保存当前文件引用结果
        if (refs.length > 0) {
          results.push({
            type: typeMap[extname],
            fileUrl: Editor.assetdb.fspathToUrl(filePath),
            refs: refs
          });
        }
      }
      // 动画资源
      else if (extname === '.anim') {
        const data = JSON.parse(Fs.readFileSync(filePath)),
          curveData = data['curveData'],
          contains = ObjectUtil.containsValue(curveData, uuid);
        if (contains) {
          results.push({
            type: typeMap[extname],
            fileUrl: Editor.assetdb.fspathToUrl(filePath)
          });
        }
      }
      // 材质和字体资源
      else if (extname === '.mtl' || filePath.indexOf('.fnt.meta') !== -1) {
        const data = JSON.parse(Fs.readFileSync(filePath)),
          contains = ObjectUtil.containsValue(data, uuid);
        if (contains && !(data['uuid'] === uuid)) {
          const _extname = (extname === '.mtl') ? '.mtl' : '.fnt.meta';
          results.push({
            type: typeMap[_extname],
            fileUrl: Editor.assetdb.fspathToUrl(filePath)
          });
        }
      }
    };
    // 遍历资源目录下的文件
    const assetsPath = Editor.url('db://assets/');
    FileUtil.map(assetsPath, searchHandler);
    // Done
    return results;
  },

  /**
   * 打印结果至控制台
   * @param {object[]} results 
   */
  printResult(results) {
    if (results.length === 0) {
      Editor.log(`[${EXTENSION_NAME}]`, translate('noRefs'));
      Editor.log(`${'----'.repeat(36)}`);
      return;
    }
    // 添加引用
    const nodeRefs = [];
    let nodeRefsCount = 0;
    const assetRefs = [];
    let assetRefsCount = 0;
    for (let i = 0, l = results.length; i < l; i++) {
      const result = results[i],
        type = result.type,
        url = result.fileUrl.replace('db://', '').replace('.meta', '');
      if (type === 'scene' || type === 'prefab') {
        nodeRefs.push(`　　　·　${iconMap[type]} [${translate(type)}] ${url}`);
        const refs = result.refs;
        for (let j = 0, n = refs.length; j < n; j++) {
          nodeRefsCount++;
          if (this.detail) {
            const ref = refs[j];
            let item = `　　　　　　　${iconMap['node']} [${translate('node')}] ${ref.node}`;
            if (ref.component) {
              item += ` 　→ 　${iconMap['component']} [${translate('component')}] ${ref.component}`;
            }
            if (ref.property) {
              item += ` 　→ 　${iconMap['property']} [${translate('property')}] ${ref.property}`;
            }
            nodeRefs.push(item);
          }
        }
      } else {
        assetRefsCount++;
        assetRefs.push(`　　　·　${iconMap['asset']} [${translate(type)}] ${url}`);
      }
    }
    // 合并
    const texts = [`[${EXTENSION_NAME}] ${translate('searchResult')} >>>`];
    if (nodeRefs.length > 0) {
      nodeRefs.unshift(`　　　📙 ${translate('nodeRefs')} x ${nodeRefsCount}`);
      texts.push(...nodeRefs);
    }
    if (assetRefs.length > 0) {
      assetRefs.unshift(`　　　📘 ${translate('assetRefs')} x ${assetRefsCount}`);
      texts.push(...assetRefs);
    }
    // 分隔
    texts.push(`${'----'.repeat(36)}`);
    // 打印到控制台
    if (this.expand) {
      // 逐行打印
      for (let i = 0, l = texts.length; i < l; i++) {
        Editor.log(texts[i]);
      }
    } else {
      // 单行打印
      const content = texts.join('\n');
      Editor.log(content);
    }
  },

  /**
   * 更新节点树缓存
   * @param {string} filePath 文件路径
   */
  updateNodeTree(filePath) {
    // 获取缓存
    let cache = this.cache;
    if (!cache) {
      cache = this.cache = Object.create(null);
    }
    // 将资源数据转为节点树并缓存
    const data = JSON.parse(Fs.readFileSync(filePath));
    cache[filePath] = this.convertToNodeTree(data);
  },

  /**
   * 获取节点树
   * @param {string} filePath 文件路径
   * @returns {object}
   */
  getNodeTree(filePath) {
    // 获取缓存
    let cache = this.cache;
    if (!cache) {
      cache = this.cache = Object.create(null);
    }
    // 从缓存中读取
    if (!cache[filePath]) {
      // 将资源数据转为节点树
      const data = JSON.parse(Fs.readFileSync(filePath));
      cache[filePath] = this.convertToNodeTree(data);
    }
    // Done
    return cache[filePath];
  },

  /**
   * 读取节点
   * @param {object} source 元数据
   * @param {number} id 节点 ID
   * @param {object} parent 父容器
   */
  convertNode(source, id, parent) {
    const node = Object.create(null),
      sourceData = source[id];
    // 基本信息
    node['__id__'] = id;
    node['_name'] = sourceData['_name'];
    node['__type__'] = sourceData['__type__'];
    // 路径
    const parentPath = parent.path || (parent['_name'] || null);
    node.path = (parentPath ? `${parentPath}/` : '') + node['_name'];
    // 组件
    const components = sourceData['_components'];
    if (components && components.length > 0) {
      const _components = node.components = [];
      for (let i = 0, l = components.length; i < l; i++) {
        const sourceComponent = source[components[i]['__id__']];
        _components.push(this.extractValidInfo(sourceComponent));
      }
    }
    // 预制体引用
    const prefab = sourceData['_prefab'];
    if (prefab) {
      const realPrefab = source[prefab['__id__']];
      node.prefab = this.extractValidInfo(realPrefab);
    }
    // 子节点
    const children = sourceData['_children'];
    if (children && children.length > 0) {
      node.children = [];
      for (let i = 0, l = children.length; i < l; i++) {
        const childId = children[i]['__id__'];
        this.convertNode(source, childId, node);
      }
    }
    // 保存数据
    parent.children.push(node);
  },

  /**
   * 将资源数据转为节点树
   * @param {object} source 元数据
   * @returns {object}
   */
  convertToNodeTree(source) {
    const nodeTree = Object.create(null),
      type = source[0]['__type__'];
    // 场景资源
    if (type === 'cc.SceneAsset') {
      const sceneId = source[0]['scene']['__id__'],
        children = source[sceneId]['_children'];
      nodeTree['__type__'] = 'cc.Scene';  // 类型
      nodeTree['__id__'] = sceneId;       // ID
      // 遍历节点
      nodeTree.children = [];
      for (let i = 0, l = children.length; i < l; i++) {
        const nodeId = children[i]['__id__'];
        this.convertNode(source, nodeId, nodeTree);
      }
    }
    // 预制体资源 
    else if (type === 'cc.Prefab') {
      const uuid = source[source.length - 1]['asset']['__uuid__'];
      nodeTree['__type__'] = 'cc.Prefab'; // 类型
      nodeTree['__uuid__'] = uuid;        // uuid
      // 从根节点开始读取
      nodeTree.children = [];
      const rootId = source[0]['data']['__id__'];
      this.convertNode(source, rootId, nodeTree);
    }
    // Done
    return nodeTree;
  },

  /**
   * 提取有效信息（含有 uuid）
   * @param {object} data 元数据
   * @returns {{ __type__: string, _name: string, fileId?: string }}
   */
  extractValidInfo(data) {
    const info = Object.create(null);
    // 记录有用的属性
    const keys = ['__type__', '_name', 'fileId'];
    for (let i = 0, l = keys.length; i < l; i++) {
      const key = keys[i];
      if (data[key]) {
        info[key] = data[key];
      }
    }
    // 记录包含 uuid 的属性
    for (const key in data) {
      if (ObjectUtil.containsProperty(data[key], '__uuid__')) {
        info[key] = data[key];
      }
    }
    // Done
    return info;
  },

  /**
   * 获取对象中是否包含指定值以及相应属性名
   * @param {object} object 对象
   * @param {any} value 值
   * @returns {{ contains: boolean, property: string }}
   */
  getContainsInfo(object, value) {
    const result = {
      contains: false,
      property: null
    };
    // 搜索
    const search = (target, parentKey) => {
      if (ObjectUtil.isObject(target)) {
        for (const key in target) {
          if (target[key] === value) {
            result.contains = true;
            result.property = parentKey;
            return;
          }
          search(target[key], key);
        }
      } else if (Array.isArray(target)) {
        for (let i = 0, l = target.length; i < l; i++) {
          search(target[i], parentKey);
        }
      }
    }
    search(object, null);
    // Done
    return result;
  },

}

/** 扩展名对应文件类型 */
const typeMap = {
  '.fire': 'scene',
  '.prefab': 'prefab',
  '.anim': 'animation',
  '.mtl': 'material',
  '.fnt.meta': 'font',
}

/** 类型对应图标 */
const iconMap = {
  'scene': '📺',
  'prefab': '🧸',
  'node': '💾',
  'component': '💿',
  'property': '🎲',
  'asset': '📦',
}
