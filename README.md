# 墨页 Moye

一个面向 Windows 的本地 Markdown 编辑器，支持边写边预览、源码编辑和 PDF / HTML 导出。文稿使用普通 Markdown 文件保存，适合记笔记、写文档和日常办公。

## 下载与启动

**[前往 Releases 下载 Windows 版](https://github.com/whitemoker/moye/releases)**

1. 在最新版本的 **Assets** 中下载 `Moye-版本号-Windows-x64.zip`。
2. 右键压缩包，选择“全部解压”。
3. 打开解压后的文件夹，双击 `Moye.exe`。

这是 Windows x64 便携版，无需安装，也无需安装 Node.js。请保留整个解压文件夹，不要只复制其中的 EXE。GitHub 自动生成的 `Source code (zip)` / `Source code (tar.gz)` 是源码，需要自行构建。

分享给朋友时，可以直接发送 [项目首页](https://github.com/whitemoker/moye) 或 [下载页面](https://github.com/whitemoker/moye/releases)。写作和保存本地文件无需联网；文稿里的网络图片与外部链接仍需要网络。

## 第一次使用

1. **开始写作**：按 `Ctrl+N` 新建文稿，直接输入文字。输入 `#` 加空格可创建一级标题。
2. **打开已有文稿**：按 `Ctrl+O` 打开 Markdown / 文本文件，也可以把文件拖进窗口。按 `Ctrl+Shift+O` 打开一个写作文件夹。
3. **保存文稿**：按 `Ctrl+S`。首次保存会根据标题或首段建议文件名；没有内容时使用“未命名”。按 `Ctrl+Shift+S` 可以另存为。
4. **调整文字格式**：使用顶部“段落”“格式”菜单，或选中文字后右键。仅选中文字不会自动弹出工具栏。
5. **调整外观**：右上角三个点可设置主题、字号、文稿宽度和字体；主题也能从顶部“主题”菜单切换。
6. **分享成品**：在“文件”菜单中选择“导出 PDF”或“导出 HTML”。

软件内也有说明：**帮助 → 快捷键与使用说明**。鼠标停在图标上可以查看简短提示。

## 常用功能

- **即时编辑 / 源代码**：`Ctrl+/` 在两种编辑方式之间切换。
- **文件与大纲**：侧边栏可查看文件、最近打开的文稿和标题大纲；`Ctrl+P` 按名称快速打开。
- **Markdown 格式**：标题、引用、列表、任务清单、代码块、表格、图片、链接和数学公式。
- **查找与替换**：`Ctrl+F` 查找，`Ctrl+H` 查找与替换。
- **专注模式**：`F8` 突出当前段落或整组内容，周围文字轻微淡化。
- **打字机模式**：`F9` 让当前输入行保持居中；拖选文字时暂停跟随。
- **三种主题**：素白、暖纸、深夜。
- **自动保存与草稿恢复**：已有保存位置的文稿在停止输入后自动保存；新文稿需先手动选择位置。启动时可恢复检测到的未保存草稿。

### 图片和表格

- 图片支持粘贴、拖放，或通过“格式 → 插入图片”添加。
- 插入本地图片前需先保存文稿；图片保存在文稿旁的 `文稿名.assets` 文件夹中。分享原始文稿时，请同时分享这个素材文件夹。
- 从“段落 → 表格”插入表格，使用表格的悬浮菜单增删行列。
- 按住 `Ctrl` 点击文稿中的链接可以打开它。

### Windows 文件图标与打开方式

在右上角三个点的写作设置中，点击“注册图标与打开方式”。之后可以在资源管理器中右键 Markdown 文件，通过“打开方式”选择墨页。

注册使用当前 Windows 用户的设置，不会强制更改默认应用。若希望双击文件就用墨页打开，请在 Windows 的“打开方式”中自行设为默认。移动软件文件夹后，可重新注册。

## 常用快捷键

- 新建 / 打开 / 保存：`Ctrl+N` / `Ctrl+O` / `Ctrl+S`
- 打开文件夹：`Ctrl+Shift+O`
- 另存为：`Ctrl+Shift+S`
- 即时编辑 / 源代码：`Ctrl+/`
- 查找 / 替换：`Ctrl+F` / `Ctrl+H`
- 快速打开：`Ctrl+P`
- 加粗 / 斜体：`Ctrl+B` / `Ctrl+I`
- 一级至六级标题 / 正文：`Ctrl+1` 至 `Ctrl+6` / `Ctrl+0`
- 插入链接：`Ctrl+K`
- 显示或隐藏侧边栏：`Ctrl+Shift+B`
- 写作设置：`Ctrl+,`
- 专注 / 打字机模式：`F8` / `F9`
- 全屏：`F11`

## 文件与兼容性

- 当前版本提供 Windows x64 构建，其他平台尚未验证。
- 支持 UTF-8 Markdown / 文本文件，单个文稿最多 20 MB；不自动转换其他文本编码。
- 编辑后会规范化部分 Markdown 空白与标记。复杂图表暂以代码显示，不支持的扩展语法建议使用源码模式。
- 检测到文件被其他程序修改或删除时，会暂停自动保存，可选择载入磁盘版本、另存为或确认覆盖。
- 公司文档加密或终端管控可能限制应用读取文件；需要由公司 IT 按规定授权，墨页不会绕过这些策略。
- 便携版的“免安装”指程序本身无需安装。设置和恢复草稿仍保存在当前用户的应用数据目录中，不随软件文件夹迁移。

## 从源码运行

开发环境：Windows x64、Git、Node.js 22.12 或更高版本（建议使用 Node.js 22 LTS）。首次安装依赖需要联网。

```sh
git clone https://github.com/whitemoker/moye.git
cd moye
npm ci
npm test
npm run build
npm start
```

开发调试时，先在一个终端运行 `npm run dev`；再在另一个 PowerShell 终端设置开发服务器地址（以 Vite 实际输出为准）并启动：

```powershell
$env:MOYE_DEV_URL = 'http://localhost:5173'
npm start
```

构建 Windows 便携版：

```sh
npm run package
```

打包结果默认位于 `release/Moye-win32-x64/`，入口为 `Moye.exe`。通过 `MOYE_OUTPUT_DIR` 环境变量可以指定输出目录。打包时会生成并附带本项目许可证和第三方许可说明。

推送与 package.json 版本一致的 `v版本号` 标签，会触发 GitHub Actions 自动测试、构建并发布 ZIP 和 SHA-256 校验文件。已发布的版本标签不应覆盖。

主要技术：Electron、React、TypeScript、Vite、Milkdown / Crepe 和 CodeMirror。

## 反馈问题

请到 [Issues](https://github.com/whitemoker/moye/issues) 提交问题，尽量说明软件版本、Windows 版本、复现步骤和预期结果。涉及公司或个人隐私的文稿，请先脱敏。

## 许可证

本项目采用 **Apache License 2.0 + Commons Clause 1.0**，两部分同时适用，完整条款见 [LICENSE](LICENSE)。允许个人及公司内部免费办公使用；销售限制以 LICENSE 中的 Commons Clause 定义为准。

这不是仅使用 Apache-2.0 的项目，也不属于 OSI 定义的开源许可证。第三方依赖仍遵循各自的许可证，发行包内包含第三方许可说明。

墨页是独立项目，与 Typora、Obsidian 无关联。
