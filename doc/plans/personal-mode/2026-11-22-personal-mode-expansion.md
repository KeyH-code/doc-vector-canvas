# Personal Mode 画布扩展实施计划（C3 后、D 前）

> **执行要求：** 2026-11-22 参赛者批准本计划，先提交计划，再按 `executing-plans` 开始扩展一。每批通过参赛者验收后才继续；本批不进入 D 或接入 Agent Mode。

**目标：** 把固定尺寸的矢量画布扩展为可导航、可组织、可建立显式关系的图示编辑器，并证明后续程序能复用同一份图元、连接和命令数据。

**架构：** 世界坐标中的项目场景、窗口中的观看视图、Fabric 的临时绘制分离。图元、连接与本地图片资源由核心持有；React 负责可见状态与操作，Fabric 负责显示与手势，UI 与程序编辑共用核心命令及历史。新版本读取既有项目，选区导出和撤销仍以正式场景为准。

**技术栈：** 沿用锁文件：React `19.3.1`、Fabric `7.4.0`、TypeScript `5.9.3`、Vite `8.3.8`、Vitest `5.1.1`、Playwright `1.65.1`。Windows、Node `22.19.0` 为现有验收基线。桌面浏览器、离线本地项目，不新增后端或模型依赖。

---

## 1. 开工基线与执行约定

- 基线：`feat/personal-mode` 的 `684add4`（C3 选区 SVG 导出，用户已验收）。正式开工前确认工作区与目标分支，保留该提交作为回归基线。此次授权先提交计划；后续实现的提交、合并或推送另行确认。
- 以本批[需求](canvas-expansion/requirements.md)和[验收清单](canvas-expansion/validation.md)为准。本扩展是 [Personal Mode 总计划](2026-11-20-personal-mode.md)进入 D 的前置，C3 验收记录保持不变。原需求对对象面板、吸附和自动连线的限制，只放开这次明确约定的部分。
- 当前切入点：`src/core/scene.ts` 和 `src/core/commands.ts` 已承担对象校验和受限批次，`src/project/projectFile.ts` 只读写 v1；`src/editor/FabricSurface.ts` 的固定纸面尺寸限制绘制和移动，`src/editor/useEditor.ts` 还依赖纸面边界计算粘贴偏移；`src/App.tsx` 的对象列表只显示、不操作；`src/export/selectionSvg.ts` 已从独立渲染表面导出选区。
- 按下列分批顺序；每个任务先补失败测试、确认失败是缺少行为而非环境问题、最小实现、重跑。每批验收给出可试用页面、测试结果和待手测项；用户确认后继续下一批。A 批小样、B/C 既有用例保留；仅在新旧语义确实发生变化时更新期望并补等价覆盖，不丢弃旧项目证据。

| 小批 | 任务 | 交付及审核停点 |
| --- | --- | --- |
| **扩展一：无限画布与对象目录** | E0–E2 | v1 项目仍可读；视图能移动、缩放、调整工作区；从目录能选中、定位和检查对象。 |
| **扩展二：新增图形与显式连接** | E3–E5 | 新图形可像原有对象一样操作；先验证矩形/椭圆，再覆盖新图形；关系随变换、重开和撤销保持。 |
| **扩展三：图片、表格与程序验证** | E6–E8 | 离线保存重开媒体；没有模型也能读关系、受限编辑并整体撤销；连同 C3 回归一并交给用户审核。 |

## 2. 扩展一：无限画布与对象目录

### E0 · 建立项目格式兼容基线（E-01、E-12）

**文件：** 修改 `src/project/projectFile.ts`、`src/project/projectSession.ts`、`tests/unit/projectFile.test.ts`、`tests/unit/projectFlow.test.ts`；新建 `tests/fixtures/projects/personal-v1.json`；同步 `tests/e2e/personal-core.spec.ts` 中正式页面新存档的版本断言。

1. 先从 `684add4` 的正式实现取一份实际保存的 v1 项目，包含原有图元、虚线和多行中文。若未留存下载件，可在该提交的隔离副本重跑下载测试获取，不手写冒充实际产物。写测试：打开后对象 ID、层叠顺序、文字和样式逐项相同；再保存输出 v2；坏 JSON / 未知版本 / 失效项目仍不会替换当前项目或历史。验证旧读写器无法满足 v2 输出。
2. 在核心外建立显式的 v1 读入与 v2 写出路径。v1 继续按其原格式校验，不允许用旧版本号夹带新字段；关系与资源分别在后续任务加入 v2 校验。同批审核用的早期 v2 无关系、无资源仍按空值处理。**用户不需重绘旧项目；用新版保存后，不要求旧版程序能打开新文件。**
3. 保持项目 JSON 只保存场景（含后续关系与资源），不保存编辑选区、历史、主题或当前观看位置。运行 `npm.cmd run test:unit -- tests/unit/projectFile.test.ts tests/unit/projectFlow.test.ts`，要求通过；再跑 `npm.cmd run test:e2e -- personal-core.spec.ts`，验证 Personal Mode 实际下载重开。

### E1 · 可导航的观看窗口（E-02、E-03）

**文件：** 新建 `src/editor/viewport.ts`、`src/ui/ViewportControls.tsx`、`tests/unit/viewport.test.ts`、`tests/e2e/canvas-viewport.spec.ts`；修改 `src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/App.tsx`、`src/ui/shortcuts.ts`、`src/styles.css`。

1. 写坐标测试：屏幕与世界坐标往返，缩放锚点不漂，容器改宽后保留世界中心；以点 `(240, 120)` 为缩放锚时，改变比例前后该点对应同一世界坐标。浏览器先测：拖过旧纸面边界后可以创建与点选对象；打开文件和相同选区的 SVG 不受视图位置影响。
2. 视图由世界中心和缩放决定，按真实画布容器计算像素变换；移除固定纸面裁剪、创建与拖动的位置限制、粘贴的纸面边界假设。保留非有限坐标拒绝与合理数值保护，不建无限大的位图。提供抓手、缩放、回到内容；调整工作区与侧栏宽度、收起侧栏、全屏。全屏不可用时保留普通视图，不伪报成功。空间键抓手不得抢占输入框或文字输入法，原有画布编辑快捷键保持。
3. 验证：在旧纸面左右上下都能画，路径不裁断；拖动的是视图而非对象；缩放、拖动分隔栏、全屏开合、选区定位不进历史、不产生未保存提示。既有 `personal-core.spec.ts` 中“纸外拖动”的固定纸面断言改为**用视图导航重新找回并选中**，而非删用例。运行 `npm.cmd run test:unit -- tests/unit/viewport.test.ts` 和 `npm.cmd run test:e2e -- canvas-viewport.spec.ts personal-core.spec.ts`。

### E2 · 可操作的分组对象目录（E-04、E-05）

**文件：** 新建 `src/ui/ObjectNavigator.tsx`、`tests/e2e/object-navigator.spec.ts`；修改 `src/App.tsx`、`src/styles.css`、`src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/ui/PropertiesPanel.tsx`。

1. 测试用「三矩形、一直线、一箭头」的混合场景：展开不改选择；选中矩形分组只匹配三个矩形；展开后 `Shift` 增减某个条目；画布框选和撤销删除能同步回侧栏；定位视口之外的对象后可点选它。
2. 用核心 ID 实现同一套单选/多选入口，侧栏与画布不维护两份选区。分组展开键与整组选中分开；同类条目按当前绘制顺序，保留稳定对象标识。提供显式「定位」操作；侧栏内独立滚动，列表过长不将底栏挤出。单选显示世界坐标、适用尺寸与样式；无适用属性不杜撰信息，多选只提示数量。本阶段连接区域不显示几何接触，关系功能留到 E4。
3. 运行 `npm.cmd run test:e2e -- object-navigator.spec.ts object-editing.spec.ts`；在 `1280×800` 和 `1440×900` 的亮暗主题检查作用范围、折叠、滚动、底栏。**扩展一停点：** 请用户试「在画面外画 → 从左栏定位 → 按类或 Shift 选中」后确认。

## 3. 扩展二：新增图形与显式连接

### E3 · 正方形、菱形和星形（E-06）

**文件：** 修改 `src/core/scene.ts`、`src/core/geometry.ts`、`src/core/commands.ts`、`src/project/projectFile.ts`、`src/editor/fabricObjects.ts`、`src/editor/FabricSurface.ts`、`src/ui/Toolbar.tsx`、`src/ui/Icon.tsx`、`src/ui/ObjectNavigator.tsx`、`src/ui/PropertiesPanel.tsx`、`src/export/selectionSvg.ts`；扩展 `tests/unit/geometry.test.ts`、`tests/unit/projectFile.test.ts`、`tests/e2e/drawing-tools.spec.ts`、`tests/e2e/selection-export.spec.ts`。

1. 红测：反向拖放和零面积；正方形保持正方；菱形与五角星的顶点顺序和几何可重建；命中、缩放/旋转、属性、撤销、保存重开与选区 SVG 支持新类型。
2. 在「其他图形」里新增图元，不复制一套样式、画布或导出管线。正方形创建和缩放保持等宽高；菱形与五角星用规范化顶点生成，变换后不改变顶点身份，供锚点引用。图形继续走统一选择、命令、文件校验、历史和对象目录。
3. 运行几何/项目单测与绘图、SVG 浏览器用例。检查星形尖角不会因厚描边裁切；导出生成矢量，不把图形改成位图。

### E4 · 矩形和椭圆的可选吸附与连接（E-07、E-08、E-09）

**文件：** 新建 `src/core/connections.ts`、`tests/unit/connections.test.ts`、`tests/e2e/connector-editing.spec.ts`；修改 `src/core/scene.ts`、`src/core/commands.ts`、`src/core/history.ts`、`src/project/projectFile.ts`、`src/editor/FabricSurface.ts`、`src/editor/useEditor.ts`、`src/ui/Toolbar.tsx`、`src/ui/PropertiesPanel.tsx`、`src/export/selectionSvg.ts`；扩展 `tests/unit/commands.test.ts`、`tests/unit/projectFile.test.ts`。

1. **核心先测：** 同一端点可自由放置或绑定；一条线两端分别连接 A、B；改 A 的位置、尺度、角度，解析端点仍落在原边界位置；移动 B 或撤销时同理。无效目标/非有限参数/不存在的边/不支持的类型导致整批不提交。旧文件中的自由线不会因重开而自动获得关系。
2. 定义连接合同：继续保留直线/箭头的基本几何；两端可分别拥有显式绑定，绑定包含目标稳定 ID 与其**局部边界位置**。矩形可用边标识和沿边比例，椭圆可用周向参数；旋转、缩放由同一几何函数解析世界位置。以绑定解析结果为显示与导出的依据，**不把每个沿边像素保存为锚点，也不为跟随而逐帧改写项目**。
3. **交互先测：** 自由模式可在闭合图形内部画线；开启吸附后只有在线头或线尾靠近轮廓时显示候选，放下才建立关系。以固定屏幕像素距离判断，缩放时吸附手感一致；候选有多个时先取最近点，同距离按绘制层叠顺序稳定择取。拖动已连接端点可改接或拖离解除，关闭吸附只影响下一次编辑，不删除已经建立的关系。
4. 推荐明确手势：整条未绑定线可照常移动或变换；已绑定线提供独立端点手柄，首版不允许整条绑定线拖动偷偷断开，也不加自动寻路。只有有向箭头展示入/出，直线展示连接对象，不臆造方向语义。左栏检查主体可定位连接的对端；穿越/贴边却未吸附的线不显示在「连接」中。
5. 接通保存、命令、撤销与导出。拖动目标节点，连接只派生更新，整次变换记一步；删除目标先计算该端最后的世界坐标，将该端解除为自由端，保留线、另一端与线 ID，整次操作一起撤销。受限删除如需更新未授权的连接记录则整批拒绝。导出按真实端点绘制，仅带选中的线和图形，不顺带输出未选宿主。
6. 运行 `npm.cmd run test:unit -- tests/unit/connections.test.ts tests/unit/commands.test.ts tests/unit/projectFile.test.ts` 与 `npm.cmd run test:e2e -- connector-editing.spec.ts selection-export.spec.ts`，要求实际拖拽与纯核心证据都通过，再扩大宿主类型。

### E5 · 新图形吸附、复制与多选关系（E-09、E-10）

**文件：** 修改 `src/core/connections.ts`、`src/core/geometry.ts`、`src/core/commands.ts`、`src/editor/useEditor.ts`、`src/editor/FabricSurface.ts`、`src/export/selectionSvg.ts`；扩展 `tests/unit/connections.test.ts`、`tests/unit/commands.test.ts`、`tests/e2e/connector-editing.spec.ts`、`tests/e2e/selection-export.spec.ts`。

1. 红测正方形、菱形、星形在放大后旋转仍能贴真实轮廓，尤其是星形的凹边；多选移动宿主及连线不会重复变换绑定端。覆盖新建、连接、撤销、重开、SVG 选区的同关系验证。
2. 多边形用稳定边标识和沿边比例，与矩形共用线段投影，吸附的是**实际轮廓**而不是包围框。复制时同时复制线与宿主才将该端绑定映射到新 ID；只复制线时未复制的宿主不被暗中连接，该端转为自由端；只复制宿主不自动复制未选中的线。撤销恢复原来的完整选择内容和关系数据，不要求恢复 UI 选区。
3. 胶合测试通过后，手测「连接两个图形 → 旋转/缩放其中一个 → 检查侧栏 → 删除再撤销 → 保存重开 → 只导出箭头」。**扩展二停点：** 请用户确认自由绘制没有受限、端点吸附不抢操作、关系表示符合预期。

## 4. 扩展三：图片、表格与程序验证

### E6 · 本地图片与离线资源（E-11、E-12）

**文件：** 新建 `src/project/imageImport.ts`、`src/core/imageAssets.ts`、`tests/unit/imageAssets.test.ts`、`tests/e2e/canvas-media.spec.ts`；修改 `src/core/scene.ts`、`src/core/commands.ts`、`src/core/history.ts`、`src/project/projectFile.ts`、`src/editor/useEditor.ts`、`src/editor/FabricSurface.ts`、`src/editor/fabricObjects.ts`、`src/ui/Toolbar.tsx`、`src/ui/ObjectNavigator.tsx`、`src/ui/PropertiesPanel.tsx`、`src/export/selectionSvg.ts`。

1. 红测：用真实小型 PNG/JPG 选文件，先放入画布，能移动、缩放、旋转、复制、撤销；下载项目后新会话关闭网络也能打开并看到图片。伪后缀、不可解码、超过限额、非法/缺失资源引用都不进入当前场景；异步导入未结束就切项目不能写入新项目。
2. 独立管理本地光栅资源，图元按稳定资源 ID 引用，同一资源可由多个对象复用。项目内嵌图片原始数据及类型；通过字节签名和可解码性检查，不信任后缀、不读取外链。审核稿限额建议为单图 `10 MiB`、单图解码上限 `1600 万像素`、项目图片原始数据合计 `40 MiB`；超限给明确说明。导入一次提交；删除、复制与历史保持引用一致，不把临时对象 URL 或二进制副本写进每个历史项。导出 SVG 用内嵌图片，只包含被选图片，不输出网络地址。
3. 在浏览器真正下载，给新会话先加载本地应用，再切到离线状态、打开文件并继续改图；不把需要首次加载应用的静态站点当成离线启动功能。将混合图示 SVG 插入目标 Windows PowerPoint，确认透明背景及图片可见。运行 `npm.cmd run test:unit -- tests/unit/imageAssets.test.ts tests/unit/projectFile.test.ts`、`npm.cmd run test:e2e -- canvas-media.spec.ts selection-export.spec.ts`。

### E7 · 轻量可编辑表格（E-11、E-12）

**文件：** 新建 `src/core/table.ts`、`src/ui/TableEditor.tsx`、`tests/unit/table.test.ts`；修改 `src/core/scene.ts`、`src/core/commands.ts`、`src/project/projectFile.ts`、`src/editor/fabricObjects.ts`、`src/editor/FabricSurface.ts`、`src/ui/Toolbar.tsx`、`src/ui/ObjectNavigator.tsx`、`src/ui/PropertiesPanel.tsx`、`src/export/selectionSvg.ts`、`tests/e2e/canvas-media.spec.ts`。

1. 红测创建表格、编辑指定单元格、增删行列、保留中文与多行内容、一次表格操作一次撤销。验证坏表格维度、非矩形数据和不可接受的输入不改状态；文件重开后仍能编辑单元格；导出 SVG 中表格保持线条与文字，而非截图。
2. 表格作为一个独立图元，可选中、移动、缩放、复制；表格编辑时文字输入、删除和撤销快捷键不误触画布。默认 `3×3`，建议最多 `30×20`，不能删到零行零列；正式容量在内容裁切和性能验证后锁定。用同一场景数据生成画布展示和 SVG；不使用 `foreignObject`，不导入 Excel，不做公式、合并单元格。首版图片和表格可与连接并存，暂不承诺它们作为吸附宿主。
3. 多浏览器检查表格中文、内容边界、轮廓与表格复制后的独立性；目标 PowerPoint 插入混合 SVG 核对文字和网格。运行 `npm.cmd run test:unit -- tests/unit/table.test.ts tests/unit/projectFile.test.ts` 与 `npm.cmd run test:e2e -- canvas-media.spec.ts selection-export.spec.ts`。

### E8 · Agent 前置合同与扩展回归（E-13、E-14）

**文件：** 新建 `src/core/sceneGraph.ts`、`tests/unit/sceneGraph.test.ts`、`tests/e2e/canvas-expansion-flow.spec.ts`、`doc/plans/personal-mode/canvas-expansion/results.md`；修改 `src/core/commands.ts` 及必要的正式接线，不新增正式 Agent 页面或接口服务。

1. 用「输入 → 处理 → 输出」和额外未选对象写核心测试：按 ID 查询对象和显式关系，区分两端/方向；凡仅有相交或贴边均无关系。按范围改「处理」的位置和一条获授权箭头的样式，未授权对象的数据不变，绑定端自然跟随；一次撤销恢复。测试未知 ID、越权、非法锚点与受限删除触发的跨对象副作用；失败时场景、撤销与重做都不变。
2. 提供**仅本地、无需模型**的结构化读入口；复用已有受限批次写入口，不给程序开一条绕过场景校验的写通道。区分「被命令写入的对象」与「随关系重新计算、但记录没被改写的对象」。关系输出由场景推导，不从截图 OCR 猜关系、不另存一份会过期的图数据库。
3. 正式页面走一次最小闭环：远处放图元、在侧栏分组定位、作连接、加入本地图片和可编辑表格、保存、在新会话离线打开并继续改、选择一部分导出 SVG、插入 PowerPoint。保留旧 v1 和 C3 校验，不以自动化代替真实字体、输入法和 PowerPoint 视觉核对。
4. 执行 `npm.cmd run test:unit`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run test:e2e`。记录提交、环境、实际命令、通过数、失败或未测项到 `results.md`；准备一份测试用扩展示例供审阅，但**不代替 D 的正式原创示例和干净副本验收**。

## 5. 交付检查和停点

- **兼容性门：** 用 C3 真实 v1 下载件证明能打开、编辑、再保存 v2；读入失败不触动会话。与 A/B/C 的等价回归全部通过，扩展后的项目仍无需服务器或网络资源。
- **关系门：** 以浏览器实际绘制验证连接，在数据层读取同一结构；变换与撤销不漂移，选择和导出不会更改其他图元或改写历史。
- **范围门：** 不做模型调用、Agent 对话、PDF/PPTX 文档导入、自动布线、完整电子表格、远程素材、协作。PowerPoint 只验证 SVG 插入，不是产品内的 PPTX 导入能力。
- 扩展三验收通过后，报告扩展验收与遗留项，等待明确批准再进入 **D：正式示例、文档与干净环境交付验收**。D 通过后再单独规划 Agent Mode。
