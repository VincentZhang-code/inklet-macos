# Windows 0.11.0 与 Mac 功能对照

状态定义：**共享**表示复用 Windows 的同一实现；**Mac 云端已测**表示在 Apple Silicon 与 Intel GitHub macOS 主机运行真实 Electron 并通过自动断言；**Mac 人工待验**表示需要目标设备上的 Finder、输入法、触控板、权限或 Gatekeeper 操作。

| 能力 | Mac 实现 | 当前证据与剩余验收 |
| --- | --- | --- |
| 原 Logo、标语、作者版权、软件说明 | 共享前端和原品牌资产 | Mac 云端窗口截图已核对；Finder/Dock 图标人工待验 |
| Markdown 源码与可视编辑、撤销重做 | CodeMirror、ProseMirror、DocumentSession 共享 | Mac 云端编辑和磁盘保存已测；中文输入法人工待验 |
| 标题、大纲、正文目录、分栏与联动滚动 | 共享 | 构建覆盖；Mac 手工回归待验 |
| 搜索替换、按章节结果、Worker | 共享 | Mac 云端搜索、菜单回调与 Cmd 已测；系统菜单人工待验 |
| 普通与合并表格、增删行列、列宽、按需加载 | 共享 | Mac 云端表格渲染已测；全部编辑操作人工待验 |
| MathJax、Mermaid、图表缩放与代码编辑 | 共享、离线资源 | Mac 云端真实渲染和导出已测；触控板操作人工待验 |
| 两栏独立主题、字体、字号、间距、阅读宽度 | 共享，增加 Mac 中文字体回退 | 设置交互已测；Mac 字体排版待验 |
| 专注、打字机、纸纹、高亮及备注 | 共享 | 构建覆盖，真机视觉和编辑回归待验 |
| 图片导入、压缩、相对/父级/绝对/file URI 读取 | 原生 FileStore + 共享前端 | 存储单测和 SVG 宿主渲染已测；权限弹窗待验 |
| 保存时内嵌图片、缺图提示与取消保护 | 共享内嵌流程、Mac readAsset | 接口覆盖；Mac 内嵌操作回归待验 |
| HTML/PDF/DOCX 导出 | 共享内容生成 + Electron printToPDF | 两架构三种实际文件已测；字体和分页人工待验 |
| UTF-8/BOM/CRLF、原子保存、备份、批注边车 | Mac FileStore | 编码、备份、冲突单测及两架构保存已测 |
| 异常恢复、快照校验、增量日志、坏尾回退 | Mac FileStore | 单测已测；Mac 强退恢复待验 |
| 多文档、独立编辑状态、冷存和有界缓存 | 共享 DocumentWorkspace + Mac WorkspaceStore | 契约单测及两架构双文档运行已测 |
| 外部修改同步、冲突查看与采用 | Mac 文件监视 + 共享冲突界面 | 外部保护单测及两架构干净文档同步已测 |
| 多窗口开关、移交就绪/提交/回滚、超时保护 | Mac HostController 两阶段移交 | 两架构真实双窗口已测；原生拖出手势人工待验 |
| 打开历史、按文件阅读位置、文首/恢复箭头 | Mac Preferences + 共享 ReadingPositionTracker | 独立文件位置和偏好持久化单测；真机长文定位待验 |
| 自动恢复阅读位置默认关闭 | 沿用共享默认值 | 设置交互已测，不自动重开上次文件 |
| 文件打开/保存对话框、关闭未保存确认 | Electron 原生对话框 + 共享确认流程 | 临时路径适配测试；真实 macOS 对话框待验 |
| Cmd 菜单、Dock、Finder 关联 | Mac 菜单、open-file、Info.plist 文档类型 | 实现；macOS 专项待验，不强改用户默认应用 |
| 离线桌面安全 | sandbox/contextIsolation、自定义协议、IPC 验证 | 17 项核心测试及两架构隔离检查；运行中零远程资源请求 |
| 安装、签名、公证、Gatekeeper | Mac 打包脚本和钥匙串配置入口 | 四个 `.app` ZIP 已生成并通过 ad-hoc `codesign`；Developer ID、公证和 Gatekeeper 人工待验 |

## 命令覆盖

`test/host-controller.test.cjs` 对照 Windows `InkletApp.cs` 的命令分派清单，要求每个命令都存在明确的 Mac 处理器，避免静默回落到浏览器模拟。测试包含窗口所有权、保存目标去重、接收方就绪前禁止提交及取消移交回滚。

## 证据边界

共享代码并不自动证明全部行为在 Mac 一致。运行 `38993273648` 已提供两架构真实 macOS 自动化证据和四个结构验证包，但 Finder、输入法、触控板、真实权限提示、Developer ID、公证及 Gatekeeper 仍不得标记为已验收。
