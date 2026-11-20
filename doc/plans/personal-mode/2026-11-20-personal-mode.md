# 第一阶段实施计划：Personal Mode

> **状态：** 2026-11-20 计划审核通过。A 批小样、自动化和 PowerPoint 检查已执行，真实 Windows 中文输入法待手测，见 [A 批验证记录](../../research/personal-mode-engine-spike.md)。B 批未开始；每批完成后报告证据，等评审确认再继续。

**目标（Goal）：** 交付能独立完成绘制、编辑、保存重开和选区 SVG 导出的 Personal Mode，并让后续 Agent 可以复用按 ID 操作图元的入口。

**架构（Architecture）：** React 负责工具条和属性控件，Fabric.js 暂定为负责预览和手势的适配器；核心对象状态、批次命令、撤销历史和项目文件归应用所有。UI 或本地脚本都只通过命令提交正式编辑；渲染从正式状态刷新，PDF/PPTX 和模型均不在本阶段。

**技术栈（Tech Stack）：** 候选 React + TypeScript + Vite + Fabric.js；Vitest 测核心规则，Playwright 使用现有 Chrome 走实际浏览器操作，Windows Edge 做人工复核。A 批决定是否采用 Fabric.js，不通过不把它固化到产品代码。

---

## 阅读与执行约定

- [需求范围](requirements.md)定义做什么，编号 `P-01`～`P-10`；[验收清单](validation.md)定义怎么证明做到了；[调研报告](../../research/personal-mode-research.md)解释取舍。实现与需求冲突时，先修订计划并请参赛者确认，不静默减项。
- 以 `main` 上的已审核文档基线为起点，在 `feat/personal-mode` 上开发。执行时小步提交，先跑本任务检查；示例提交信息仅为建议。
- 本机已查到 Node `22.19.0`、npm `10.9.3` 以及 Chrome/Edge。依赖、缓存、浏览器测试输出优先留在项目所在 E 盘；首版用现有 Chrome，不要求下载第二套浏览器。`.gitignore` 排除 `node_modules/`、`dist/`、`.cache/`、`test-results/` 和 `playwright-report/`。
- 本文命令用 Windows PowerShell 的 `npm.cmd`。带规则的实现按 **写失败测试 → 确认失败原因 → 最小实现 → 重跑通过 → 提交** 走；技术验证和真实中文输入法、PPT 检查保留人工证据。核心单测不模拟 Fabric；浏览器测试实际点工具、拖放、下载和打开文件。测试失败时先修本项，不通过跳过用例过门。

| 批次 | 交付物 | 通过后才推进 |
| --- | --- | --- |
| A：引擎验证 | 可丢弃的小样、实际结果与选型决定 | Fabric 能服务自有模型、命令和未来背景叠加；不能就止步换路线。 |
| B：最小闭环 | 矩形和中文文字可画、可编辑、可保存再打开；独立命令可按 ID 修改并一次撤销 | 将闭环演示给参赛者，确认持久化和命令边界。 |
| C：完整 Personal Mode | 补齐题面工具、对象操作、界面反馈、撤销/重做和 SVG | 对照 `P-01`～`P-09`，真实操作与测试都过。 |
| D：交付验收 | 可复现 README、原创示例、测试与手测证据 | 清洁环境可重现，参赛者亲自确认 `P-10`，才转入 Agent Mode 的计划。 |

## A：先验证引擎，不先造完整编辑器

### A1. 建立可复现的小样环境

**文件：** `package.json`、`package-lock.json`、`.gitignore`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`spike.html`、`spike/fabric-smoke.ts`。

1. 建立最小 Vite 配置：React 插件，默认端口 `5173`，`--strictPort` 防止启动到另一个端口后测错。TypeScript 使用 `strict`、`noEmit`、`react-jsx`；Spike 和正式源码加入类型检查。Vitest 只收 `tests/unit/**/*.test.ts`，Playwright 的 `testDir` 为 `tests/e2e`。后者使用 `channel: 'chrome'`，`webServer` 用 `npm.cmd run dev`，等待 `http://127.0.0.1:5173/spike.html`；B3 后改等应用首页。
2. 用下面的候选版本安装并生成锁文件；已核对 npm 包元数据，**未执行安装**。安装失败先记录错误，不用强制覆盖 peer 检查的方式绕过。

   ```powershell
   npm.cmd install --save-exact react@19.3.1 react-dom@19.3.1 fabric@7.4.0 --cache "$PWD\.cache\npm"
   npm.cmd install -D --save-exact vite@8.3.8 @vitejs/plugin-react@6.3.0 typescript@5.9.3 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@22.19.1 vitest@5.1.1 @playwright/test@1.65.1 --cache "$PWD\.cache\npm"
   ```

3. 配置脚本：`dev` = `vite --host 127.0.0.1 --strictPort`，`typecheck` = `tsc --noEmit`，`test:unit` = `vitest run`，`test:e2e` = `playwright test`，`build` = `vite build`（正式 `index.html` 到 B3 添加，A 门不宣称正式构建通过）。运行 `npm.cmd run typecheck` 和 `npm.cmd run dev`，确认端口与小样一致；此处只验证环境与小样入口。

### A2. 验证手势、中文、坐标和出图

**文件：** `spike/fabric-smoke.ts`、`tests/e2e/engine-spike.spec.ts`、`doc/research/personal-mode-engine-spike.md`。

1. 用 `Canvas`、`Rect`、`IText` 做一个矩形和一段可编辑文字。在小样中加一个显示提交次数的标签；同一矩形分别由指针拖动和小样按钮更新，测试预期各提交一次，程序渲染后计数不再递增。用 Fabric 手势事件只取最终几何；用独立标记或重入保护区分业务同步和输入事件。
2. 在应用自己的对象数据里保存 ID、位置及文本，序列化再从文件选择打开一次；另用有标记的静态底图验证 50%/100%/200% 视口和缩放后拖动。用真实 Windows 中文输入法试录入、回车确认和双击改稿。对高 DPI，用 Playwright 两个设备像素比的上下文验证同一逻辑坐标结果。
3. 小样中加入箭头或等价的带端点图元、旋转矩形和中文 `&`，用独立渲染表面按选区导出一次。检查 Windows 目标浏览器中的文字、描边、旋转边界，再试插入目标 PowerPoint；没有 PPT 则按验收清单记缺证据。运行 `npm.cmd run test:e2e -- engine-spike.spec.ts`；预期手势、程序提交和两个像素比用例通过，不以真实输入法和 PPT 的手测结果替代自动化，反之亦然。
4. A 批建议限时一个工作日。记录版本、命令/步骤、结果和小样提交引用；建议提交 `chore: validate personal canvas engine`。需修正时先隔离问题：Fabric 手势接管失败就验证备选，不把引擎绑定到领域模型；若考虑 Excalidraw SDK，必须重跑局部更新、历史、固定底图和 SVG 用例，不能默认 SDK 自动满足。用户审查 A 门后才开始 B。

## B：建立可保存的最小产品

### B1. 实现对象、命令与撤销规则（P-06、P-09）

**文件：** `src/core/scene.ts`、`src/core/commands.ts`、`src/core/history.ts`、`tests/unit/commands.test.ts`、`tests/unit/history.test.ts`。

1. 先加失败测试：创建矩形及文字后按 ID 更新；A/B 白名单内批次成功、C 不变；未知或越界 ID、非有限数字或无效尺寸时全部无效；空操作不增加历史；正常批次一次撤销，撤销后新编辑清除重做。
2. 落实数据契约：最初只有一个画布空间，但空间 ID 和对象 ID 可序列化；对象数组顺序是层叠顺序。定义同一个坐标原点和几何约定（建议对象围绕其中心定位，以度为旋转单位）；尺寸、变换值、样式和文本校验后才能提交。对象读取返回快照或只读数据，应用不以 Fabric 实例为存储。第一批只实现矩形、文本和创建/更新，C 批扩展。
3. 命令批次先对草稿验证执行，再由历史层一次发布；现有对象的写入权限由可信调用方限定，不从对象属性推断，也不对外授权全场景覆写。无效批次、取消预览和空操作均不写入历史。可先用小场景前后快照做撤销，不做补丁压缩。
4. 运行 `npm.cmd run test:unit -- tests/unit/commands.test.ts tests/unit/history.test.ts`：先要看到缺失能力对应的失败，再验证全部通过；同时运行 `npm.cmd run typecheck`。建议提交 `feat: add scene commands and undo history`。

批次的最小实现约束如下：它只处理“草稿是否发布”，不把校验、渲染或历史揉成一个函数。`applyOne` 接收各条命令和权限，成功时返回草稿；失败时返回原因。调用者只对有变化的成功结果追加历史并刷新。

```ts
type BatchResult<S> = { ok: true; next: S } | { ok: false; reason: string }

function applyAtomically<S, C>(
  current: S,
  commands: readonly C[],
  applyOne: (draft: S, command: C) => BatchResult<S>,
  equals: (before: S, after: S) => boolean,
): BatchResult<S> {
  let draft = structuredClone(current)
  for (const command of commands) {
    const result = applyOne(draft, command)
    if (!result.ok) return result
    draft = result.next
  }
  return { ok: true, next: equals(current, draft) ? current : draft }
}
```

### B2. 实现项目文件，验证失败不会换掉画布（P-05）

**文件：** `src/project/projectFile.ts`、`src/project/localFiles.ts`、`tests/unit/projectFile.test.ts`。

1. 先写失败测试：项目往返保持 ID、数组顺序、中文与样式；拒绝坏 JSON、未知格式或版本、重复 ID、错误类型、无效坐标；同一输入不得在解码阶段更改当前场景。正常结构采用 `format`、`version` 和画布内容，不持久化手柄、选择、视口或撤销历史。
2. 先解码并校验整个候选文件，再交给应用替换；有异常只返回可显示的中文错误。只读用户选中的本地文件；保存用 UTF-8 JSON 下载。保存状态基于上次成功触发下载或成功打开的正式内容，不宣称浏览器已覆盖或写入某个磁盘路径。取消文件选择、取消丢弃改动不清理当前画布或历史。
3. 运行 `npm.cmd run test:unit -- tests/unit/projectFile.test.ts`，预期往返和错误用例全部通过；建议提交 `feat: add versioned local project files`。

### B3. 打通矩形、中文和可重开画布（P-02、P-05、P-08、P-09）

**文件：** `index.html`、`src/main.tsx`、`src/App.tsx`、`src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/ui/Toolbar.tsx`、`src/ui/FileMenu.tsx`、`src/styles.css`、`tests/e2e/personal-core.spec.ts`。

1. 先写浏览器失败场景：点「矩形」并拖出；点「文字」输入 `帧数与预算`；选中矩形后拖动、缩放；项目下载后在全新上下文用文件输入打开；双击文字继续改写并再次保存。核对两个保存文件，而不只截图比对。
2. 界面接到核心；指针移动只改预览，完成手势才提交正式数据；无变化不提交。集中处理屏幕坐标与场景坐标转换、渲染回环和监听器清理；更新图元时尽量保留选择。文本结束编辑后提交，输入法组合过程中不响应画布快捷键。打开成功才替换内容并清空旧历史。
3. 执行 `npm.cmd run test:e2e -- personal-core.spec.ts`、`npm.cmd run test:unit`、`npm.cmd run typecheck`、`npm.cmd run build`；按 B 门手测真实中文并演示命令批次。预期实际重开后仍能编辑，非法批次不动任何对象。建议提交 `feat: complete editable local canvas loop`。

## C：补齐比赛题面与项目扩展

### C1. 新增直线、椭圆、画笔和箭头（P-01、P-04、P-08）

**文件：** `src/core/scene.ts`、`src/core/geometry.ts`、`src/editor/FabricSurface.ts`、`src/ui/Toolbar.tsx`、`src/project/projectFile.ts`、`tests/unit/geometry.test.ts`、`tests/unit/projectFile.test.ts`、`tests/e2e/drawing-tools.spec.ts`。

1. 先测反向拖动、零长度不提交、箭头保留有向端点、每笔单独保存、重开后可选择。矩形/椭圆的边界由起止点规范化；直线和箭头保留方向；自由笔迹保存项目定义的局部点或路径数据，不保存 Fabric 对象或原样 SVG 片段。
2. 工具与渲染同批补齐；临时预览不进入项目。按住移动时保持可见反馈，松手提交一次。给线、箭头和笔迹实际点选容差，避免只能点中数学线中心；新类型一并纳入文件编解码测试。
3. 运行 `npm.cmd run test:unit` 和 `npm.cmd run test:e2e -- drawing-tools.spec.ts`，预期全部图形可画、可选、可重开。建议提交 `feat: add vector drawing tools`。

### C2. 编辑、样式、剪贴板与快捷键（P-02、P-03、P-04、P-06、P-08、P-09）

**文件：** `src/core/commands.ts`、`src/core/history.ts`、`src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/ui/PropertiesPanel.tsx`、`src/ui/Toolbar.tsx`、`src/ui/shortcuts.ts`、`tests/unit/commands.test.ts`、`tests/e2e/object-editing.spec.ts`。

1. 先写失败用例：缩放、旋转各记一步；多选移动后各对象的场景几何正确；粘贴的 ID 全新且副本独立；不同对象的样式控件与适用属性匹配；输入中快捷键不会触发画布。另测复制/删除可走受控批次入口。
2. 完成缩放/旋转手柄、框选或 Shift 加选、适用样式面板、撤销/重做按钮和快捷键。多选移动时把组合临时变换还原为每个对象的场景几何后一次提交，不保存引擎临时组。复制粘贴使用应用内快照；偏移后赋新 ID 并选中副本。文字编辑时不拦截文本的删除和撤销。
3. 执行 `npm.cmd run test:unit -- tests/unit/commands.test.ts tests/unit/history.test.ts` 和 `npm.cmd run test:e2e -- object-editing.spec.ts`，再按验收清单手测中文输入和字体。建议提交 `feat: add object styling and editing controls`。

### C3. 导出选中 SVG（P-07）

**文件：** `src/export/selectionSvg.ts`、`src/ui/FileMenu.tsx`、`tests/unit/selectionSvg.test.ts`、`tests/e2e/selection-export.spec.ts`。

1. 先写失败用例：不给选区则禁用；A、B 被选、C 未选时仅有 A/B；在 50% 与 200% 导出几何一致；旋转、描边与箭头完整包进输出边界，中文 `&` 经过 XML 解析后维持原文。单测验证框选图元集合和边界合并，浏览器测试实际下载并解析 SVG。
2. 用选定对象在新渲染表面重建导出，不临时删除真实画布上的未选对象。计算包含变换和描边的安全边界，按绘制顺序输出；不纳入参考背景、控制点或画布视口。若 Fabric 的边界与 PPT 表现不满足验收，只调整输出实现，不更改项目模型或丢弃可编辑文件能力。
3. 执行 `npm.cmd run test:unit -- tests/unit/selectionSvg.test.ts`、`npm.cmd run test:e2e -- selection-export.spec.ts`，再试在目标 PPT 插入。建议提交 `feat: export selected objects as svg`；提交不代表 PPT 已验收，结果单独记录。

## D：收齐可复现的交付证据

### D1. 写使用文档、原创示例与实际验证记录（P-10）

**文件：** `README.md`、`STRUCTURE.md`、`examples/personal-mode/frames-and-budget.canvas.json`、`doc/plans/personal-mode/validation-results.md`；`tests/e2e/engine-spike.spec.ts`、`spike.html`、`spike/fabric-smoke.ts` 在正式测试覆盖对应能力后退出交付，证据保留在 A 批记录及提交中。

1. 给例子准备原创、没有外部论文数据的「帧数与预算」对照图，包含基本形状、中文标注和箭头；必须用实际应用生成的项目文件保存。录制/演示顺序：空白页画图 → 编辑与撤销 → 保存 → 新会话重开修改 → 选区 SVG，别让提前准备的截图替代功能。是否录制那条最终参赛视频留给后续交付阶段。
2. 补 README 的技术版本、启动、使用、测试、第三方资源与 AI 使用分工；注明 Personal Mode 的可用功能和未交付的 Agent Mode。同步 `STRUCTURE.md` 的实际源码、示例和测试目录。
3. 从干净副本按 [验收命令](validation.md) 完整执行并记录结果；确认正式构建仍不引用 Spike，测试覆盖关键小样约束。按 `P-01`～`P-10` 填结果，不存在环境或未通过则标明；参赛者实际操作至少一次。建议提交 `docs: document and verify personal mode delivery`。

**已审核的开工顺序：** 先执行 A，拿到证据后再决定是否进入 B。未经评审确认不启动后续批次，不把 Agent Mode 混入本计划。
