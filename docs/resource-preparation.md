# 本地资源准备

本项目把资源处理和浏览器构建分开。只使用有权使用的本地原版与对应简中资源；安装目录是只读输入，不用来存放中间结果。不要用他人打包的试玩或在线站点补齐缺件。工具不会自动下载游戏、汉化或字库。

## 已有同版准备数据

在仓库根目录的 `local-assets/` 下提供以下四组本地数据。这里的文件夹名是构建工具的接口，不表示仓库里附带任何资源：

| 路径 | 内容 |
| --- | --- |
| `media-webp75-opus32-64/mako-public-y02/` | 封存的双路线数据，含会话、场景、媒体清单和字节范围索引。可用其他 `mako-public-名称` 并给构建命令传同名参数。 |
| `pc-dialogue-v1/` | 对话快捷栏和语音控件布局与图层。 |
| `pc-save-v1/` | 存读档界面布局与图层。 |
| `pc-backlog-v1/` | 文本历史界面布局与图层。 |

使用此前以相同工具和兼容输入准备的本地数据。不要手工拼凑清单、混用不同版本，也不要从已经生成的网页反向提取。缺项时先补全准备数据，不用空图或静音文件填补。

## 已有离线准备树、需要重新组装

从项目根目录运行。示例假设你自己的离线准备树放在被 Git 忽略的 `work/`；将标题资源目录名换成实际值：

~~~powershell
$prepared = (Resolve-Path './work').Path
$title = 'r69-title-assets-local'
npm run assets:plan -- --prepared $prepared --title $title
npm run assets:prepare -- --prepared $prepared --title $title
node tools/web/prepare-pc-dialogue.mjs --prepared $prepared
node tools/web/prepare-pc-save-art.mjs --prepared $prepared
node tools/web/prepare-pc-backlog.mjs --prepared $prepared
~~~

1. 规划没有输出可播放站点；资源装配从本地准备树生成 `local-assets/site/` 的共通和芳乃基础资源。后三条命令分别新建上表的界面资源目录，不读取或修改用户存档。
2. 用[音频批处理](../tools/web/yoshino-encode-audio.mjs)（绝对 `ffmpeg.exe` 路径、起始索引、段数、并发数）和[图像批处理](../tools/web/yoshino-encode-images.py)（需要支持 WebP 的 Pillow）生成派生文件与收据。全部基线收据就绪后运行 `npm run assets:assemble-base`。
3. 茉子线需要自己的全量场景和增量媒体输入：[路线规划](../tools/web/mako-route-plan.mjs) 接收场景目录、原启动脚本、分支规则和新收据路径；[双线媒体组装](../tools/web/mako-media-overlay.mjs) 接收场景目录、路线规划收据和新的 `mako-public-名称`。增量音频、图形和片尾的实际输入以 [媒体输入实现](../tools/web/mako-media-files.mjs) 及 [片尾准备工具](../tools/prepare-r69-ed.mjs) 为准。双线输出才可用作根目录的 Vite 构建输入。

## 从原安装开始

仓库保留了[各阶段脚本入口](../package.json)和 [GARbro 离线桥接](../tools/offline/build-garbro-bridge.ps1)。下表列出装配需要的主要中间数据；个别阶段需要适配合法安装和本地工具版本，**这里没有从原盘到全部资源的一键命令**。

| 准备树内的主要输入 | 所需来源和入口 |
| --- | --- |
| `runtime-data/scenarios-r6-v2/` | 对应版的场景归档和目录索引，[场景准备](../tools/prepare-scenarios.ts)。 |
| `base-resources/r7-data/`、`base-script-views/r13-{data,patch}/`、`script-inspection/r6/` | 自备基础、补丁及简中资源；[脚本视图](../tools/prepare-base-script-views.ts)、[脚本检查](../tools/prepare-script-inspection.ts)。 |
| `runtime-data/graphics-r20/images/manifest-v2.json`、`runtime-data/graphics-r9/{pimg,pimg-images}/`、`mtn-textures/r9-v3/` | 原 1080p 素材和覆盖层，[图形索引](../tools/build-graphics-index.ts)、[PIMG 输入](../tools/prepare-pimg-inputs.ts)、[MTN 纹理](../tools/prepare-mtn-textures.ts)。 |
| 图像定义、分支、场景、舞台及转场元数据 | 对应 `resources:*` 工具的输入，装配缺件由 `assets:plan` 报告。 |
| `runtime-data/audio-r11-v3/`、`r69-original-voices/` | [原音频准备](../tools/prepare-audio.ts)、[语音补件](../tools/prepare-r69-voices.mjs)；保留标签、循环和实际语音对应关系。 |
| `r67-original-op/`、`r69-original-ed/`、`r70-original-ed-mako/` | 从自己的 `video.pck` 提取；[片头](../tools/prepare-r67-op.mjs)与[片尾](../tools/prepare-r69-ed.mjs)使用本机 `ffprobe.exe`，后者以 `mak` 指定茉子片尾。 |
| `native-ui-r24-v2/bgmtitle-sources.json`、`--title` 指定的子目录 | 1080p 标题和曲目表来源；[标题来源清单](../tools/r69-original-title-audit.mjs)、[标题准备](../tools/prepare-r69-title-assets.mjs)。 |

离线准备树、Vite 构建产物、浏览器存档及所有中间资源均应留在本机，不进入 Git。
