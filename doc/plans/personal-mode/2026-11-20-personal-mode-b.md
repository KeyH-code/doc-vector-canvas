# B 批实施计划：Personal Mode 最小闭环

> **状态：** B1、B2 已通过[核心检查](b-validation-results.md)；参赛者明确批准 [B3a 侧栏预览 v4.2](../../design/personal-mode/b3-preview/review.md) 作为 B3b 的初版基准。B3b 自动化与 Windows 人工检查均通过，参赛者确认可以进入 C 批。

**目标：** 从空白画布画矩形、输入中文、移动或缩放，保存到本地，在全新的浏览器会话打开并继续编辑；同一份对象数据也可以不经页面、仅用命令编辑并撤销。

**架构：** 先实现不依赖页面的画布核心：对象、命令、历史和项目文件。它在 Node 的 Vitest 中就能跑通，正式应用仍在浏览器中运行，不新增后端服务、HTTP 接口或数据库。通过视觉评审后，再用 React 接入界面、Fabric.js 接入画布交互。

**技术栈：** 沿用 A 批锁文件：TypeScript 5.9.3、Vitest 5.1.1；正式页面沿用 React 19.3.1、Vite 8.3.8、Fabric.js 7.4.0 和 Playwright 1.65.1，不因预览增加运行时依赖。

---

## 执行顺序与停点

| 步骤 | 产物 | 进入下一步的条件 |
| --- | --- | --- |
| B1 · 画布核心 | 稳定对象 ID、创建/更新命令、受限批次、撤销/重做。 | 无页面单测证明：只修改授权目标，非法批次不改状态也不写历史。 |
| B2 · 项目文件 | 版本化 JSON、完整校验、核心场景的保存/重开测试。 | **核心检查点**：在 Node 内完整跑通「创建 → 改图 → 撤销/重做 → 保存 → 在新会话重开 → 再编辑」，报告单测与类型检查证据后，才制作页面预览。 |
| B3a · 页面预览 | 独立静态 HTML，用示例数据展示空白、选中、未保存和文件错误等状态。 | **视觉审核停点**：提交可看的预览，由参赛者明确批准具体版本；否则只迭代预览，不写正式页面。 |
| B3b · 正式页面 | 按获批样式接入 B1/B2，实现实际画图、编辑、保存和打开。 | 实际浏览器下载并重开；通过自动化和真实输入法手测，再评审是否进入 C。 |

实施沿用 `feat/personal-mode`。开工先核对 Git 状态，把用户同意提交的计划和 A 批验收更新与 B 批代码分开；不覆盖已有文档改动，不推送。范围以[总计划](2026-11-20-personal-mode.md)、[需求](requirements.md)和[验收清单](validation.md)为准。直线、椭圆、笔迹、箭头、复制、多选及正式选区 SVG 留在 C 批；PDF/PPTX 与 Agent 均不进入 B 批。

## B1 · 先让画布逻辑在 Node 里运行

**文件：** `src/core/scene.ts`（图元结构与校验）、`src/core/commands.ts`（创建和按 ID 更新）、`src/core/history.ts`（发布、撤销与重做）、`tests/unit/commands.test.ts`、`tests/unit/history.test.ts`。

1. **先写创建/更新用例。** 空画布包含稳定的空间 ID，数组顺序就是绘制顺序；创建矩形和文字后可按 ID 精确更新。以中心点和角度表达位置与方向；验证重复 ID、非有限坐标、非正尺寸以及不适用于该类型的更新。既有对象更新不改变 ID、类型或绘制顺序。
2. **先写受限批次用例，再实现最小命令。** 场景有文字 A、矩形 B 和未授权对象 C。允许 A/B 的批次同时更新 A 文本、B 坐标，C 不动。改 A 后遇到 C、未知 ID 或无效值时，草稿整体丢弃。授权范围由可信调用方提供，不接受待执行命令自行扩大权限。模型、命令及测试不导入 React、Fabric 或浏览器 API。
3. **先写历史用例，再接正式发布。** 合法的多条修改只增加一个历史条目、一次撤销整体恢复、一次重做整体重放。空批次、无实际变化、失败批次不写历史也不影响已有重做；撤销后真正产生新编辑才清空重做。用前后场景快照实现，不引入增量日志。
4. 每条规则走「看到预期失败 → 最小实现 → 重跑通过」。阶段命令：`npm.cmd run test:unit -- tests/unit/commands.test.ts tests/unit/history.test.ts`、`npm.cmd run typecheck`。建议独立提交：`feat: add scene commands and undo history`。

## B2 · 无页面跑通保存与重开

**文件：** `src/project/projectFile.ts`（纯 JSON 编解码）、`src/project/projectSession.ts`（校验成功后换入新项目、隔离历史）、`tests/unit/projectFile.test.ts`、`tests/unit/projectFlow.test.ts`。实际浏览器文件选择及下载适配器 `src/project/localFiles.ts` 留到 B3b。

1. **先测项目格式。** 建议版本 `1`，用 `format`、`version`、`scene` 组成文件；UTF-8 JSON 保留稳定 ID、对象顺序、几何、文本和样式，不包含选区、工具、视口、历史或 Fabric 私有数据。坏 JSON、未知格式/版本、重复 ID、未知对象类型、字段或数值非法均拒绝，并返回可供页面显示的明确错误。不尝试兼容 A 批小样文件。
2. **先测打开策略，再实现。** 已有画布时，读取或解析失败、用户取消，不替换画布、不清空历史、不把项目标记为已保存。成功打开才替换并清空旧历史。编码和解码不触发文件系统操作；页面层在 B3b 才提供下载和选择文件。
3. **增加端到端的核心用例。** 直接调用真实核心：创建 A/B/C → 只改 A/B → 撤销并重做 → 非法批次保持状态和历史 → 编码保存 → 新会话解码打开 → 按原 ID 再改文字。这条测试不启动 Vite、不打开浏览器，不用模拟画布代替核心规则。
4. 跑 `npm.cmd run test:unit -- tests/unit/projectFile.test.ts tests/unit/projectFlow.test.ts`、`npm.cmd run test:unit`、`npm.cmd run typecheck`，预期全部通过。报告成功与失败路径及实际测试输出。建议提交：`feat: verify local project workflow without UI`。**若核心未通过，不转向预览或正式页面。**

## B3a · 页面预览：只评设计，不接业务

**产物：** [获批的自包含侧栏预览 v4.2](../../design/personal-mode/b3-preview/layout-sidebar.html)、[审核记录](../../design/personal-mode/b3-preview/review.md)（版本、反馈和批准状态）。

1. 核心通过后，制作一份桌面端可查看的预览，而非修改 `spike.html` 或创建正式首页。预览可用静态状态或简单切换展示流程，不连接真实数据、不写项目文件、不进入正式构建，也不把它当作功能验收。界面只露出 B 批承诺的入口，未实现的 C 批能力不做成可用按钮。
2. 至少展示三种状态：**空白画布**（新建/打开/保存、选择/矩形/文字、撤销/重做的位置）；**已有矩形和中文**（对象选中、缩放手柄、文字编辑时的视觉反馈）；**未保存和打开失败**（状态提示、继续编辑的去向）。给出常见桌面浏览器尺寸，例如 `1280×800` 和 `1440×900`。
3. 评审聚焦整体风格：画布占比、工具栏位置、字体和留白、色彩、选中反馈以及文件状态是否清楚。展示可打开的预览，说明哪些只是示意；记录 `预览版本 / 待审或通过 / 反馈 / 明确批准`。**此处停止并等待你确认。** 需要调整则修改预览重新递交；对已批准整体布局或风格的重大变更，重新预览确认。
4. 未批准前不创建或改动正式的 `index.html`、`src/App.tsx`、`src/styles.css`、正式 React 组件或 Fabric 界面适配。未收到明确同意即未通过；批准后才按该版本开发 B3b。

## B3b · 视觉通过后接入正式页面

**文件：** `index.html`、`src/main.tsx`、`src/App.tsx`、`src/styles.css`、`src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/ui/Toolbar.tsx`、`src/ui/FileMenu.tsx`、`src/project/localFiles.ts`、`playwright.config.ts`、`tests/e2e/personal-core.spec.ts`。继续保留 A 批入口及其回归测试。

1. **先写浏览器用例，再按获批预览实现。** 新项目从空白页开始：点「矩形」拖出图形，点「文字」输入中文，选中矩形并移动、缩放；在新浏览器上下文打开实际下载文件，双击编辑文字再保存。对比两份项目数据：对象 ID 不变，只改变预期字段。另测坏文件、取消打开选择和历史隔离。
2. 将实际画布操作映射为 B1 命令：指针移动只预览，松手只提交一次。Fabric 把正式场景画出来，也负责手势预览，但不作为存档；模型更新触发的渲染不反向重复提交。用 B2 编解码接浏览器下载与文件选择；打开或新建之前保护未保存内容。
3. 复核 B 批页面和批准版本一致；运行 `npm.cmd run test:unit`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run test:e2e`。端到端测试等待正式首页，A 批测试仍访问 `/spike.html`；占用 `5173` 时先协调停止手测服务，不复用或终止未知进程。预计完整正式页面闭环和 A 批回归都通过。
4. **补做真实 Windows 中文输入法手测。** 在正式页面取消候选，确认没有残留拼音且未触发画布命令；有效文字改动结束后执行一次撤销，应整体回到修改前的文本，再复核保存重开。把预览批准、真实文件、测试结果和余项记入 `doc/plans/personal-mode/b-validation-results.md`。建议提交：`feat: complete editable local canvas loop`；未通过 B 批验收不进入 C。
