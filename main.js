const Fs = require('fs');
const Path = require('path');
const FileUtil = require('./utils/file-util');
const ObjectUtil = require('./utils/object-util');

module.exports = {

  /** 节点树缓存 */
  nodeTrees: Object.create(null),

  /** 是否自动展开结果 */
  expand: true,

  /** 结果精确到节点 */
  showNode: true,

  load() {
    this.readConfig(true);
  },

  unload() {

  },

  messages: {

    'open-panel'() {
      Editor.Panel.open('ccc-references-finder');
    },

    'save-config'(event, config) {
      this.saveConfig(config);
      event.reply(null, true);
    },

    'read-config'(event) {
      const config = this.readConfig();
      event.reply(null, config);
    },

    'find-current-selection'() {
      this.findCurrentSelection();
    },

    'asset-db:asset-changed'(event, info) {
      if (info.type === 'scene' || info.type === 'prefab') {
        const path = Editor.assetdb.uuidToFspath(info.uuid);
        this.updateNodeTree(path);
      }
    }

  },

  /**
   * 保存配置
   * @param {object} config 配置
   */
  saveConfig(config) {
    // 自动展开结果
    this.expand = config.expand;
    this.showNode = config.showNode;
    const configPath = Path.join(__dirname, 'config.json');
    const configData = Fs.existsSync(configPath) ? JSON.parse(Fs.readFileSync(configPath)) : {};
    if (configData.expand !== config.expand || configData.showNode !== config.showNode) {
      configData.expand = config.expand;
      configData.showNode = config.showNode;
      Fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    }
    // 快捷键
    const packagePath = Path.join(__dirname, 'package.json');
    let packageData = JSON.parse(Fs.readFileSync(packagePath));
    const item = packageData['main-menu']['i18n:MAIN_MENU.package.title/引用查找器/查找当前选中资源'];
    if (item['accelerator'] !== config.hotkey) {
      item['accelerator'] = config.hotkey;
      Fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2));
    }
  },

  /**
   * 读取配置
   */
  readConfig(onlyGetConfig = false) {
    // 自动展开结果
    const configPath = Path.join(__dirname, 'config.json');
    if (Fs.existsSync(configPath)) {
      const config = JSON.parse(Fs.readFileSync(configPath));
      this.expand = config.expand;
      this.showNode = config.showNode;
    }
    if (onlyGetConfig) {
      return;
    }
    // 快捷键
    const packagePath = Path.join(__dirname, 'package.json');
    const packageData = JSON.parse(Fs.readFileSync(packagePath));
    // 返回配置
    const config = {
      expand: this.expand,
      showNode: this.showNode,
      hotkey: packageData['main-menu']['i18n:MAIN_MENU.package.title/引用查找器/查找当前选中资源']['accelerator']
    }
    return config;
  },

  /**
   * 查找当前选中资源引用
   */
  findCurrentSelection() {
    let uuids = Editor.Selection.curSelection('asset');

    if (uuids.length === 0) {
      Editor.log('[🔎]', '请先选中需要查找引用的资源！');
      return;
    }

    for (let i = 0; i < uuids.length; i++) {
      let uuid = uuids[i];
      const assetInfo = Editor.assetdb.assetInfoByUuid(uuid);
      // Editor.log('assetInfo', assetInfo);
      if (assetInfo.type === 'folder') {
        continue;
      }
      // 头部日志
      // Editor.log('　');
      const url = Editor.assetdb.uuidToUrl(uuid).replace('db://', '').split('/');
      if (!url[url.length - 1].includes('.')) {
        url.splice(url.length - 1);
      }
      Editor.log('[🔎]', '查找资源引用', url.join('/'));
      // 资源检查
      const subUuids = [];
      if (assetInfo.type === 'texture') {
        // 纹理子资源
        const subAssetInfos = Editor.assetdb.subAssetInfosByUuid(uuid);
        if (subAssetInfos) {
          for (let j = 0; j < subAssetInfos.length; j++) {
            subUuids.push(subAssetInfos[j].uuid);
          }
        }
      } else if (assetInfo.type === 'typescript' || assetInfo.type === 'javascript') {
        // 脚本
        uuid = Editor.Utils.UuidUtils.compressUuid(uuid);
      }
      // 查找
      let results = this.findReferences(uuid);
      if (subUuids.length > 0) {
        for (let i = 0; i < subUuids.length; i++) {
          const subResults = this.findReferences(subUuids[i]);
          if (subResults.length > 0) {
            results.push(...subResults);
          }
        }
      }
      this.printResult(results);
    }
  },

  /**
   * 查找引用
   * @param {string} uuid 
   */
  findReferences(uuid) {
    const results = [];
    const handler = (filePath, stats) => {
      const extname = Path.extname(filePath);
      if (extname === '.fire' || extname === '.prefab' || extname === '.scene') {
        // 场景和预制体资源

        // 将资源数据转为节点树
        const nodeTree = this.getNodeTree(filePath);

        /**
         * 读取节点数据并查找引用
         * @param {object} node 目标节点
         * @param {object[]} container 容器
         */
        const search = (node, container) => {
          // 检查节点上的组件是否有引用
          const components = node['components'];
          if (components && components.length > 0) {
            for (let i = 0; i < components.length; i++) {
              const info = this.getContainsDetail(components[i], uuid);
              if (info.contains) {
                let type = components[i]['__type__'];
                // 是否为脚本资源
                if (Editor.Utils.UuidUtils.isUuid(type)) {
                  const scriptUuid = Editor.Utils.UuidUtils.decompressUuid(type);
                  const assetInfo = Editor.assetdb.assetInfoByUuid(scriptUuid);
                  type = Path.basename(assetInfo.url);
                }
                // 处理属性名称
                if (info.property) {
                  // Label 组件需要特殊处理
                  if (type === 'cc.Label' && info.property === '_N$file') {
                    info.property = 'font';
                  } else {
                    if (info.property.indexOf('_N$') !== -1) {
                      info.property = info.property.replace('_N$', '');
                    } else if (info.property.indexOf('_') === 0) {
                      info.property = info.property.substring(1);
                    }
                  }
                }
                container.push({ node: node['path'], component: type, property: info.property });
              }
            }
          }

          // 检查预制体是否有引用
          const prefab = node['prefab'];
          if (prefab) {
            // 排除预制体自己
            if (uuid !== nodeTree['__uuid__']) {
              const contains = ObjectUtil.containsValue(prefab, uuid);
              if (contains) {
                container.push({ node: node['path'] });
              }
            }
          }

          // 遍历子节点
          const children = node['children'];
          if (children && children.length > 0) {
            for (let i = 0; i < children.length; i++) {
              search(children[i], container);
            }
          }
        }

        // 开始遍历节点
        const _results = [];
        const children = nodeTree['children'];
        for (let i = 0; i < children.length; i++) {
          search(children[i], _results);
        }

        // 保存当前文件引用结果
        if (_results.length > 0) {
          const url = Editor.assetdb.fspathToUrl(filePath);
          results.push({ type: typeMap[extname], fileUrl: url, refs: _results });
        }
      } else if (extname === '.anim') {
        // 动画资源
        const data = JSON.parse(Fs.readFileSync(filePath));
        const curveData = data['curveData'];
        const contains = ObjectUtil.containsValue(curveData, uuid);
        if (contains) {
          const url = Editor.assetdb.fspathToUrl(filePath);
          results.push({ type: typeMap[extname], fileUrl: url });
        }
      } else if (extname === '.mtl' || filePath.indexOf('.fnt.meta') !== -1) {
        // 材质和字体资源
        const data = JSON.parse(Fs.readFileSync(filePath));
        const contains = ObjectUtil.containsValue(data, uuid);
        if (contains && !(data['uuid'] && data['uuid'] === uuid)) {
          const url = Editor.assetdb.fspathToUrl(filePath);
          const type = extname === '.mtl' ? '.mtl' : '.fnt.meta';
          results.push({ type: typeMap[type], fileUrl: url });
        }
      }
    }

    // 遍历资源目录下的文件
    const rootPath = Path.join(Editor.Project.path, 'assets');
    FileUtil.map(rootPath, handler);
    return results;
  },

  /**
   * 打印结果至控制台
   * @param {object[]} results 
   */
  printResult(results) {
    if (results.length === 0) {
      Editor.log('[🔎]', '没有找到该资源的引用！');
      Editor.log(`${'----'.repeat(36)}`);
      return;
    }
    // 添加引用
    const nodeRefs = [];
    let nodeRefsCount = 0;
    const assetRefs = [];
    let assetRefsCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const url = result.fileUrl.replace('db://', '').replace('.meta', '');
      if (result.type === '场景' || result.type === '预制体') {
        nodeRefs.push(`　　　·　📺 [${result.type}] ${url}`);
        for (let j = 0; j < result.refs.length; j++) {
          nodeRefsCount++;
          if (this.showNode) {
            const ref = result.refs[j];
            let string = `　　　　　　　💾 [节点] ${ref.node}`;
            if (ref.component) {
              string += ` 　→ 　💿 [组件] ${ref.component}`;
            }
            if (ref.property) {
              string += ` 　→ 　🎲 [属性] ${ref.property}`;
            }
            nodeRefs.push(string);
          }
        }
      } else {
        assetRefsCount++;
        assetRefs.push(`　　　·　📦 [${result.type}] ${url}`);
      }
    }
    // 合并
    const texts = [`[🔎] 引用查找结果 >>>`];
    if (nodeRefs.length > 0) {
      nodeRefs.unshift(`　　　📙 节点引用 x ${nodeRefsCount}`);
      texts.push(...nodeRefs);
    }
    if (assetRefs.length > 0) {
      assetRefs.unshift(`　　　📘 资源引用 x ${assetRefsCount}`);
      texts.push(...assetRefs);
    }
    texts.push(`${'----'.repeat(36)}`);
    if (this.expand) {
      for (let i = 0; i < texts.length; i++) {
        Editor.log(texts[i]);
      }
    } else {
      const content = texts.join('\n');
      Editor.log(content);
    }
  },

  /**
   * 预加载节点树
   */
  preloadNodeTree() {
    const handler = (filePath, stats) => {
      const extname = Path.extname(filePath);
      if (extname === '.fire' || extname === '.scene' || extname === '.prefab') {
        this.updateNodeTree(filePath);
      }
    }
    const rootPath = Path.join(Editor.Project.path, 'assets');
    FileUtil.map(rootPath, handler);
  },

  /**
   * 更新节点树
   * @param {string} filePath 文件路径
   */
  updateNodeTree(filePath) {
    if (!this.nodeTrees) {
      this.nodeTrees = Object.create(null);
    }
    const data = JSON.parse(Fs.readFileSync(filePath));
    this.nodeTrees[filePath] = this.convertToNodeTree(data);
  },

  /**
   * 获取节点树
   * @param {string} filePath 文件路径
   */
  getNodeTree(filePath) {
    if (!this.nodeTrees) {
      this.nodeTrees = Object.create(null);
    }
    // 将资源数据转为节点树
    if (!this.nodeTrees[filePath]) {
      const data = JSON.parse(Fs.readFileSync(filePath));
      this.nodeTrees[filePath] = this.convertToNodeTree(data);
    }
    return this.nodeTrees[filePath];
  },

  /**
   * 将资源数据转为节点树
   * @param {object} data 元数据
   */
  convertToNodeTree(data) {
    /**
     * 读取节点
     * @param {object} node 节点
     * @param {number} id ID
     */
    const read = (node, id) => {
      const nodeData = Object.create(null);
      const realNodeData = data[id];

      // 基本信息
      nodeData['__id__'] = id;
      nodeData['_name'] = realNodeData['_name'];
      nodeData['__type__'] = realNodeData['__type__'];

      // 记录路径
      const parentPath = node['path'] ? node['path'] : (node['_name'] ? node['_name'] : null);
      nodeData['path'] = (parentPath ? parentPath + '/' : '') + nodeData['_name'];

      // 记录组件
      const components = realNodeData['_components'];
      if (components && components.length > 0) {
        nodeData['components'] = [];
        for (let i = 0; i < components.length; i++) {
          const realComponent = data[components[i]['__id__']];
          nodeData['components'].push(this.extractValidInfo(realComponent));
        }
      }

      // 记录预制体引用
      const prefab = realNodeData['_prefab'];
      if (prefab) {
        const realPrefab = data[prefab['__id__']];
        nodeData['prefab'] = this.extractValidInfo(realPrefab);
      }

      // 记录子节点
      const children = realNodeData['_children'];
      if (children && children.length > 0) {
        nodeData['children'] = [];
        for (let i = 0; i < children.length; i++) {
          const nodeId = children[i]['__id__'];
          read(nodeData, nodeId);
        }
      }

      // 推入引用容器
      node['children'].push(nodeData);
    }

    // 读取
    const tree = Object.create(null);
    const type = data[0]['__type__'];
    if (type === 'cc.SceneAsset') {
      // 场景资源
      tree['__type__'] = 'cc.Scene';
      tree['children'] = [];
      const sceneId = data[0]['scene']['__id__'];
      tree['__id__'] = sceneId;
      const nodes = data[sceneId]['_children'];
      for (let i = 0; i < nodes.length; i++) {
        const nodeId = nodes[i]['__id__'];
        read(tree, nodeId);
      }
    } else if (type === 'cc.Prefab') {
      // 预制体资源
      tree['__type__'] = 'cc.Prefab';
      tree['__uuid__'] = data[data.length - 1]['asset']['__uuid__'];
      tree['children'] = [];
      const rootId = data[0]['data']['__id__'];
      read(tree, rootId);
    }
    return tree;
  },

  /**
   * 提取有效信息（含有 uuid）
   * @param {object} data 元数据
   */
  extractValidInfo(data) {
    const info = Object.create(null);
    // 记录有用的属性
    const keys = ['__type__', '_name', 'fileId'];
    for (let i = 0; i < keys.length; i++) {
      if (data[keys[i]]) {
        info[keys[i]] = data[keys[i]];
      }
    }
    // 记录包含 uuid 的属性
    for (const key in data) {
      if (ObjectUtil.containsProperty(data[key], '__uuid__')) {
        info[key] = data[key];
      }
    }
    return info;
  },

  /**
   * 获取对象中是否包含指定值以及相应属性名
   * @param {object} object 对象
   * @param {any} value 值
   */
  getContainsDetail(object, value) {
    let contains = false;
    let property = null;
    const search = (_object, parentKey) => {
      if (ObjectUtil.isObject(_object)) {
        for (const key in _object) {
          if (_object[key] === value) {
            contains = true;
            property = parentKey;
            return;
          }
          search(_object[key], key);
        }
      } else if (Array.isArray(_object)) {
        for (let i = 0; i < _object.length; i++) {
          search(_object[i], parentKey);
        }
      }
    }
    search(object, null);
    return { contains, property };
  }

}

/** 扩展名对应文件类型 */
const typeMap = {
  '.fire': '场景',
  '.scene': '场景',
  '.prefab': '预制体',
  '.anim': '动画',
  '.mtl': '材质',
  '.fnt.meta': '字体',
}
