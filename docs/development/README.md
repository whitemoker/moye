# 开发者与 AI 入口

墨页是一个面向 Windows 的本地 Markdown 编辑器，也持续记录人与 AI 如何共同设计、实现和打磨产品。这里是开发者与 AI 助手的共同入口，说明设计方式、工作约定、代码位置和运行方法。

如果只是下载软件和写作，请回到 [用户首页](../../README.md)。

## 开始之前

先阅读 [开发约定](../../AGENTS.md) 和 [设计、实施与验收记录规范](../README.md)，再查看当前任务涉及的 [设计文档](../design/) 与 [实施记录](../implementation/)。已有设计、用户反馈和验收状态共同约束本次工作。

## 项目怎样设计

从具体的写作场景出发，描述用户遇到什么问题、希望发生什么，以及怎样判断结果可用。优先打磨打开、编辑、保存、排版和导出等日常操作；功能范围和取舍随实际反馈调整。

有多种方案、需要解释交互或技术取舍时，在 [设计目录](../design/) 记录范围、方案和理由。简单修复可直接写实施记录，沿用现有规范。设计说明让后续开发者和 AI 理解为什么这样做，实施记录保存实际做了什么以及验证结果。

## 人与 AI 怎样协作

产品负责人提出使用场景、体验反馈和优先级，决定重要的产品取舍并完成产品验收。开发者与 AI 负责调查现状、识别不确定点、提出方案、实现、验证和整理交付信息；实施细节在已明确的范围内推进，影响产品目标或范围的选择再与产品负责人对齐。

按当前流程推进：

1. **理解任务**：读相关源码和已有记录，把已确认事实与待验证判断分开，明确预期行为和影响范围。
2. **开始留痕**：建立 `.wip.md` 实施记录，写下范围和验收标准；有必要时链接设计文档。
3. **实施与自测**：完成修改，记录实际执行的检查、结果和未覆盖项。保留用户反馈及其带来的调整。
4. **交付候选**：自测完成后使用 `.pending-acceptance.md`，提供实际可运行候选和验收步骤；纯文档工作提供可阅读的页面及内容、链接检查结果。
5. **产品验收**：只有产品负责人明确确认该项通过，才正式归档并加入相应的已验收记录。授权开工、自测通过、发布成功分别记录其真实状态。

需要说明判断过程时，可选填“初始判断”“用户纠正与方案变化”“可复用经验”。这三个字段均不是必填，可选择部分或全部省略；不要求补写历史记录，也不为填字段编造经过。具体格式见 [可选的判断与经验记录](../README.md#可选的判断与经验记录)。

## 代码从哪里看

| 关注内容 | 入口 |
| --- | --- |
| 窗口、菜单与编辑状态 | [src/App.tsx](../../src/App.tsx) |
| 即时编辑与源码编辑 | [src/Editor.tsx](../../src/Editor.tsx) |
| 专注与打字机模式 | [src/writingModes.ts](../../src/writingModes.ts) |
| 主进程与文件操作 | [electron/main.cjs](../../electron/main.cjs)、[electron/storage.cjs](../../electron/storage.cjs) |
| 字体、主题与排版 | [src/style.css](../../src/style.css)、[src/editor-typography.css](../../src/editor-typography.css) |
| 自动化检查 | [tests](../../tests/) 和 [package.json 中的脚本](../../package.json) |
| 便携包与发布 | [scripts/package.mjs](../../scripts/package.mjs)、[发布工作流](../../.github/workflows/release.yml) |

主要技术为 Electron、React、TypeScript、Vite、Milkdown / Crepe 和 CodeMirror。

## 从源码运行

当前开发与打包面向 Windows x64，需要 Git 和 Node.js。建议使用 Node.js 22 LTS 的较新版本，最低 22.12；首次安装依赖需要联网。以下命令使用 PowerShell，明确写 `npm.cmd`，避免本机同名文件或脚本抢占命令。

```powershell
git clone https://github.com/whitemoker/moye.git
cd moye
npm.cmd ci
npm.cmd test
npm.cmd run build

# 调试使用独立数据目录，保留日常使用的设置和草稿。
$env:MOYE_USER_DATA = Join-Path (Get-Location) 'test-results\manual-profile'
npm.cmd start
```

日常开发时，在项目目录的第一个终端运行：

```powershell
npm.cmd run dev
```

在项目目录的第二个 PowerShell 终端设置开发服务器地址并启动；端口以 Vite 实际输出为准：

```powershell
$env:MOYE_USER_DATA = Join-Path (Get-Location) 'test-results\manual-profile'
$env:MOYE_DEV_URL = 'http://localhost:5173'
npm.cmd start
```

调试完成后，在同一个终端移除开发服务器地址，再运行构建后的界面：

```powershell
Remove-Item Env:\MOYE_DEV_URL -ErrorAction SilentlyContinue
npm.cmd run build
npm.cmd start
```

## 检查与候选交付

沿用 [AGENTS.md](../../AGENTS.md) 的要求：常规代码修改运行 `npm.cmd test` 和 `npm.cmd run build`；编辑器行为变化执行相关 Electron 检查。可用脚本及实际覆盖范围以 [package.json](../../package.json) 和 [tests](../../tests/) 为准。记录真实检查结果，失败或未运行的检查不能写成通过。

检查、截图和调试使用独立 `MOYE_USER_DATA` 与合成文稿。独立数据目录仍可能包含未保存草稿和恢复数据；清理候选程序时应核对其内容。用户文稿与个人截图不默认提交到仓库；用户要求自己操作界面时，由用户完成界面核对。

构建 Windows 便携版：

```powershell
npm.cmd run package
```

默认输出在 `release/Moye-win32-x64/`，入口为 `Moye.exe`。可以通过 `MOYE_OUTPUT_DIR` 指定独立输出目录；候选构建放在独立目录，保留用户正在使用的程序。打包时会生成并附带本项目许可证与第三方许可说明。

## 版本与发布

版本绑定和验收状态按 [文档规范](../README.md#版本绑定) 记录；`package.json`、锁文件根版本与软件显示保持一致。

推送与 `package.json` 一致的 `v版本号` 标签，会触发 GitHub Actions 自动测试、构建并发布 Windows ZIP 和 SHA-256 校验文件。工作流支持正式号，以及 `alpha.N`、`beta.N`、`rc.N` 候选号；候选发布标记为预发布。已发布的标签不应覆盖。

源码提交、构建验证、下载发布、本机安装和产品验收分别记录。发布到 Releases 并不替代产品对具体功能的确认，创建正式标签遵循已有验收约定。

修改或分发前阅读 [LICENSE](../../LICENSE)；本项目的 Apache License 2.0 与 Commons Clause 1.0 同时适用。
