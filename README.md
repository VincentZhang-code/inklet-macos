# Inklet for macOS

**轻快落笔，顺手成文。**

Inklet 是离线优先的 Markdown 桌面编辑器。本仓库包含 macOS Electron 宿主和共享编辑核心，支持源码/可视编辑、表格、MathJax、Mermaid、本地图片、多文档、外部修改保护、恢复、独立窗口及 HTML/PDF/DOCX 导出。

## 当前状态

- 支持 macOS 13 Ventura 及以上系统的 Apple Silicon 与 Intel 架构。
- 两种架构已经在 GitHub macOS 主机完成自动桌面回归。
- macOS 产品只有一个版本，不包含打赏入口、二维码或付费功能开关。
- **当前没有面向公众发布的 Developer ID 签名与 Apple 公证安装包。** Releases 页面出现正式资产之前，请把本仓库视为源码项目，而不是可直接下载安装的产品页。

## 项目结构

- `inklet-mac/`：macOS 桌面宿主、存储、窗口、打包和测试。
- `inklet/`：跨平台共享编辑核心和离线前端资源。

## 本地开发

需要 Node.js 22.12 或更高版本，推荐 Node.js 24。

```sh
npm ci --prefix inklet/app
npm ci --prefix inklet-mac
cd inklet-mac
npm run install:runtime
npm run build:web
npm test
npm run test:desktop
npm start
```

生成当前 Mac 架构的 ad-hoc 测试包：

```sh
cd inklet-mac
npm run build:web
npm run package:mac
```

ad-hoc 包只适合受控测试。正式发布流程见 [docs/RELEASING.md](docs/RELEASING.md)。

## 许可证

源码使用 [Apache License 2.0](LICENSE)。第三方依赖许可汇总位于 `inklet/licenses/`。

Apache-2.0 不授予 Inklet 名称、Logo 或其他商标的使用权；合理描述项目来源不受影响。详见 [NOTICE](NOTICE)。

## 安全

请勿在公开 Issue 中提交漏洞利用细节、令牌、证书或个人文档。报告方式见 [SECURITY.md](SECURITY.md)。
