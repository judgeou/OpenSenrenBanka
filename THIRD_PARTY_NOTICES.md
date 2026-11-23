# 第三方声明

本项目自有代码的 MIT 许可证不替代下述组件的许可，也不赋予原游戏或汉化素材的使用及再分发权利。

- **GARbro**（morkt，[上游项目](https://github.com/morkt/GARbro)）：离线桥接需要另行提供 GARbro 库；本仓库不分发其二进制。保留[离线工具 MIT 声明](licenses/GARbro-Offline-MIT.txt)和 [PSB 格式实现参考声明](licenses/GARbro-PSB-MIT.txt)。
- **npm 构建依赖**：Vite、TypeScript、esbuild、Node.js 类型定义及其间接依赖通过 [锁文件](package-lock.json) 安装，按各包附带的许可分发；不随源码仓库提交依赖目录。
- **其他离线工具和输入**：FFmpeg／ffprobe、Pillow 及用于生成兼容数据的第三方输入均未附带。请按具体版本的条款获取和使用。资源准备过程中得到的游戏数据、媒体与第三方输入或输出不因本项目采用 MIT 而变更许可。
