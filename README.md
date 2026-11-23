# OpenSenrenBanka

《千恋＊万花》的非官方 TypeScript／WebGL 运行时，面向自行准备游戏资源的开发者。当前应用面向芳乃、常陆茉子两条路线及对应后日谈，不是原作全路线移植。浏览器运行不需要原游戏程序或原生插件。

**这个仓库只提供源码，不能直接作为游戏试玩。** 不提供原作或汉化的剧本、图片、音乐、配音、影片、字体、存档或预制资源包。只使用你有权使用的本地资源；编译和转码不会改变素材的权利归属。

在线演示：<https://senrenbanka-yoshino.pages.dev/>

## 开发

使用 Node.js 22.18+（22 LTS）或 24.12+ 和 npm。部分离线资源准备工具还需要 Windows 和另行安装的转换工具。

~~~sh
npm ci --ignore-scripts
npm run typecheck
~~~

类型检查不需要游戏资源。运行或生产构建则需要已准备好的双路线资源与原界面图层，目录结构和准备入口见[本地资源准备](docs/resource-preparation.md)；第一次从原安装准备不是一条命令。

资源就绪后，在仓库根目录执行：

~~~sh
npm run dev                 # 本机开发服务
npm run build               # 生成 dist/
npm run preview             # 本机预览已生成的 dist/
~~~

使用 Chrome 打开终端给出的本机地址，不要直接双击 HTML。可用 `npm run build -- mako-public-local` 指定另一套已准备好的双路线资源，`npm run dev` 接受同一参数。预览和开发服务默认只监听本机。构建后的 `dist/` 含本地游戏资源，不是可以随源码公开分发的发布物。

## 源码结构

- [网页入口](index.html) 和 [app/](app/)：播放界面、存读档、剧情会话和浏览器装配。
- [src/](src/)：场景与脚本解释、绘制、音频传输和世界状态。
- [tools/](tools/)：离线资源解析与构建。运行时只加载准备好的静态数据，不访问原安装。

## 许可

本项目自有源码及文档按 [MIT](LICENSE) 授权。保留[第三方声明](THIRD_PARTY_NOTICES.md)。MIT 不适用于原游戏、汉化素材或从它们生成的资源；本项目与原作权利人无隶属关系。请勿在问题、补丁或附件中上传游戏素材、存档和凭据。
