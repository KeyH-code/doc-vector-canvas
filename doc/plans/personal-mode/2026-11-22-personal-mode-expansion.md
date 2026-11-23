# Personal Mode 画布扩展实施计划（C3 后、D 前）

> **执行要求：** 原 E0–E8 计划已批准并分批执行；参赛者已审核通过 E5a–E5c 和 E6–E8 的对应增量，授权先单独提交补充计划，再用 `executing-plans` 开始 E5a–E5c。扩展三、D 和实际 Agent 接入不在本批实施范围内。

> **2026-11-23 范围调整：** E6 已验收并提交；取消 E7，成品表格走 E6 的图片路径。E8 下列改动仅移除对 E7 的依赖；后续开发等参赛者另行说明，不因本次文档提交启动。

> **后续规划：** 参赛者将 PDF/PPTX 支持纳入 Personal Mode，并授权开始[文档画布实施计划](2026-11-23-personal-mode-document-canvas.md)第一批。先实现并验收文档画布，再将 E8 按页验证，仍不接模型或实际 Agent。

**目标：** 把固定尺寸的矢量画布扩展为可导航、可组织、可建立显式关系的图示编辑器，并证明后续程序能复用同一份图元、连接和命令数据。

**架构：** 世界坐标中的项目场景、窗口中的观看视图、Fabric 的临时绘制分离。图元、连接与本地图片资源由核心持有；React 负责可见状态与操作，Fabric 负责显示与手势，UI 与程序编辑共用核心命令及历史。新版本读取既有项目，选区导出和撤销仍以正式场景为准。

**技术栈：** 沿用锁文件：React `19.3.1`、Fabric `7.4.0`、TypeScript `5.9.3`、Vite `8.3.8`、Vitest `5.1.1`、Playwright `1.65.1`。Windows、Node `22.19.0` 为现有验收基线。桌面浏览器、离线本地项目，不新增后端或模型依赖。

---

## 1. 开工基线与执行约定

- 基线：`feat/personal-mode` 的 `684add4`（C3）与 `155bc8b`（扩展一）已验收。E3–E5 已有[开发验证记录](canvas-expansion/results.md)，实现尚未提交；本次授权先提交补充计划，再在现有 E3–E5 工作区上继续开发，不把计划确认当作代码验收或提交授权。实现的提交、合并或推送另行确认。
- 以本批[需求](canvas-expansion/requirements.md)和[验收清单](canvas-expansion/validation.md)为准。本扩展是 [Personal Mode 总计划](2026-11-20-personal-mode.md)进入 D 的前置，C3 验收记录保持不变。原需求对对象面板、吸附和自动连线的限制，只放开这次明确约定的部分。
- 当前切入点：`src/core/connections.ts` 按目标 ID 和局部位置解析直线/箭头端点；`src/editor/FabricSurface.ts` 已有视口、候选预览和端点拖动；`src/project/projectFile.ts` 读 v1/v2、写 v2；`src/export/selectionSvg.ts` 已在独立渲染表面解析并导出选区。补充批复用这几条路径，不另建历史、存档或导出管线。
- 按下列分批顺序；每个任务先补失败测试、确认失败是缺少行为而非环境问题、最小实现、重跑。每批验收给出可试用页面、测试结果和待手测项；用户确认后继续下一批。A 批小样、B/C 既有用例保留；仅在新旧语义确实发生变化时更新期望并补等价覆盖，不丢弃旧项目证据。

| 小批 | 任务 | 交付及审核停点 |
| --- | --- | --- |
| **扩展一：无限画布与对象目录** | E0–E2 | v1 项目仍可读；视图能移动、缩放、调整工作区；从目录能选中、定位和检查对象。 |
| **扩展二：新增图形与显式连接** | E3–E5 | 新图形可像原有对象一样操作；先验证矩形/椭圆，再覆盖新图形；关系随变换、重开和撤销保持。 |
| **扩展二补充：线型与全元素吸附** | E5a–E5c | 「线条」「箭头」各有三种线型；旧折线可从选择模式继续延伸；已实现的所有元素均可被吸附，图片外框在 E6 接入。 |
| **扩展三：图片与程序验证** | E6、E8（E7 取消） | 离线保存重开图片，成品表格可作为图片素材使用；没有模型也能读取新线型和显式关系、受限编辑并整体撤销。 |

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

## 4. 扩展二补充：线型与全元素吸附

不改 E3–E5 的既有测试证据；补充批在现有实现之上开发，验收时同时复核 E3–E5。图片外框吸附由 E6 交付，E8 统一验证。

### E5a · 线条/箭头分组与可续画折线（E-15、E-16）

**文件：** 新建 `src/core/linePaths.ts`、`tests/unit/linePaths.test.ts`、`tests/e2e/line-tools.spec.ts`；修改 `src/core/scene.ts`、`src/core/commands.ts`、`src/core/connections.ts`、`src/editor/FabricSurface.ts`、`src/editor/fabricObjects.ts`、`src/editor/useEditor.ts`、`src/ui/Toolbar.tsx`、`src/ui/ObjectNavigator.tsx`、`src/ui/PropertiesPanel.tsx`、`src/project/projectFile.ts`、`src/export/selectionSvg.ts`；扩展 `tests/unit/projectFile.test.ts`。

1. 先写失败用例：原直线/箭头的手势与旧 v2 存档不变；新建三段折线、选旧折线续画、实际保存重开再续画，全程同一 ID；折线箭头只有最后一段末端有箭头。取消预览不入历史，撤销最后一次续画只少一段，并恢复旧箭尖与绑定。
2. 工具栏用「线条」「箭头」两个分组。折线先拖出第一段，再点击末端开始续画，移动鼠标预览下一段，点击落点确认；可切回选择再选中原折线，从末端继续。区分端点的点击续画和拖动改接，提供提示与 `Esc` 取消未确认预览。每段保存稳定的段标识，追加不重排前段；只允许非零长度的新段。末端已绑定时，续画预览明确提示原末端关系将随新末端更新；确认后只有新末端在吸附目标上才绑定，取消不改变原关系。
3. 运行 `npm.cmd run test:unit -- tests/unit/linePaths.test.ts tests/unit/projectFile.test.ts`、`npm.cmd run test:e2e -- line-tools.spec.ts drawing-tools.spec.ts connector-editing.spec.ts selection-export.spec.ts`，要求旧手势与新续画同时通过。

### E5b · 平滑手绘曲线与曲线箭头（E-15、E-17）

**文件：** 修改 `src/core/linePaths.ts`、`src/core/scene.ts`、`src/editor/FabricSurface.ts`、`src/editor/fabricObjects.ts`、`src/ui/Toolbar.tsx`、`src/ui/ObjectNavigator.tsx`、`src/project/projectFile.ts`、`src/export/selectionSvg.ts`；扩展 `tests/unit/linePaths.test.ts`、`tests/e2e/line-tools.spec.ts`、`tests/e2e/selection-export.spec.ts`。

1. 先测带抖动的 S 形及反向弧线：平滑后固定首末点，保留主要弯向，不产生明显越界或回绕；短拖、重复采样点不生成坏路径。浏览器验证同一路径在保存重开前后可编辑，箭头沿末端切线，曲线及箭尖的粗描边不裁切。
2. 按住拖出方向，松手生成平滑矢量曲线。用世界坐标去重、简化并拟合连续曲线（例如分段三次 Bézier）；屏幕像素只用于交互采样和容差，不参与重开后的二次拟合。保存最终可编辑的矢量路径，画布、端点吸附和 SVG 使用同一条曲线；接线时只调整端部所需几何，不重新平滑整条轨迹。
3. 重跑 E5a 命令并检查下载 SVG 含曲线指令而非截图或采样折线；增加不同缩放下导出同一对象的比对。

### E5c · 全元素作为吸附目标（E-07–E-10、E-18）

**文件：** 修改 `src/core/connections.ts`、`src/core/linePaths.ts`、`src/core/commands.ts`、`src/core/scene.ts`、`src/editor/FabricSurface.ts`、`src/editor/fabricObjects.ts`、`src/ui/ConnectionsPanel.tsx`、`src/ui/PropertiesPanel.tsx`、`src/project/projectFile.ts`、`src/export/selectionSvg.ts`；扩展 `tests/unit/connections.test.ts`、`tests/unit/commands.test.ts`、`tests/unit/projectFile.test.ts`、`tests/e2e/connector-editing.spec.ts`、`tests/e2e/selection-export.spec.ts`。

1. 先测文字外框、笔迹路径、三类线型路径的任意位置；用「图形 ← 主线 ← 分支」验证跨线随动、移除主线保留分支、仅导出分支、复制选中整链与仅复制分支。测试自引用、循环依赖、失效路径段和越权删除整批拒绝；旧 v1/v2 自由线不会自动增加关系。
2. 按对象类型提供局部锚点：闭合图形用既有轮廓规则，文字用随其移动、缩放、旋转及排版更新的外框，笔迹和线条/箭头用可见路径的稳定段标识及段内参数（不吸附到箭尖装饰的两翼）。图片外框在 E6 实装。延用固定屏幕距离、最近优先、同距取上层和显式确认规则；中间折点不是新增绑定端点。连线互接按依赖顺序解析，禁止自引用和让几何互相依赖的闭环；由普通图形和多根箭头组成的环形流程仍允许。画布、侧栏、文件和导出共用关系，不逐帧写入派生几何。
3. 运行 `npm.cmd run test:unit -- tests/unit/linePaths.test.ts tests/unit/connections.test.ts tests/unit/commands.test.ts tests/unit/projectFile.test.ts`、`npm.cmd run test:e2e -- line-tools.spec.ts connector-editing.spec.ts selection-export.spec.ts`，再跑全量检查。**补充批停点：** 验收旧折线续画、曲线平滑、从线身引分支、随动/删除/撤销/重开；图片外框吸附在 E6 验收。

## 5. 扩展三：图片与程序验证

### E6 · 本地图片与离线资源（E-11、E-12、E-18）

**文件：** 新建 `src/project/imageImport.ts`、`src/core/imageAssets.ts`、`tests/unit/imageAssets.test.ts`、`tests/e2e/canvas-media.spec.ts`；修改 `src/core/scene.ts`、`src/core/commands.ts`、`src/core/history.ts`、`src/project/projectFile.ts`、`src/editor/useEditor.ts`、`src/editor/FabricSurface.ts`、`src/editor/fabricObjects.ts`、`src/ui/Toolbar.tsx`、`src/ui/ObjectNavigator.tsx`、`src/ui/PropertiesPanel.tsx`、`src/export/selectionSvg.ts`。

1. 红测：用真实小型 PNG/JPG 选文件，先放入画布，能移动、缩放、旋转、复制、撤销；下载项目后新会话关闭网络也能打开并看到图片。伪后缀、不可解码、超过限额、非法/缺失资源引用都不进入当前场景；异步导入未结束就切项目不能写入新项目。
2. 独立管理本地光栅资源，图元按稳定资源 ID 引用，同一资源可由多个对象复用。项目内嵌图片原始数据及类型；通过字节签名和可解码性检查，不信任后缀、不读取外链。审核稿限额建议为单图 `10 MiB`、单图解码上限 `1600 万像素`、项目图片原始数据合计 `40 MiB`；超限给明确说明。导入一次提交；删除、复制与历史保持引用一致，不把临时对象 URL 或二进制副本写进每个历史项。导出 SVG 用内嵌图片，只包含被选图片，不输出网络地址。
3. 在浏览器真正下载，给新会话先加载本地应用，再切到离线状态、打开文件并继续改图；不把需要首次加载应用的静态站点当成离线启动功能。将混合图示 SVG 插入目标 Windows PowerPoint，确认透明背景及图片可见。运行 `npm.cmd run test:unit -- tests/unit/imageAssets.test.ts tests/unit/projectFile.test.ts`、`npm.cmd run test:e2e -- canvas-media.spec.ts selection-export.spec.ts`。
4. 接入 E5c 的外框吸附，PNG 透明区不改变外框。以真实导入图片验证移动、旋转、离线重开后的端点随动，以及删图保线、撤销复接；在 `canvas-media.spec.ts` 增加对应场景。

### E7 · 轻量可编辑表格（已取消，未开工）

表格在 Excel 等工具中制作，另存为 PNG 或 JPG 后通过 E6「图片」导入。复用图片的摆放、外框吸附、离线存档和 SVG 内嵌能力。保留 E7 编号用于追溯，不开发独立表格图元、单元格编辑、Excel 文件导入或表格剪贴板解析；图片中的表格在 SVG 里仍是位图，程序不读取其中的单元格。将来若有结构化读表需求，另行规划。

### E8 · Agent 前置合同与扩展回归（E-13、E-14、E-18）

**顺序更新：** 文档画布验收后执行本节；增加其 [DV-08 按页结构化关系](document-canvas/validation.md) 验证，按「页 ID + 对象 ID」读取和授权，不改锁定底稿或未授权页。以下单画布回归仍保留。

**文件：** 新建 `src/core/sceneGraph.ts`、`tests/unit/sceneGraph.test.ts`、`tests/e2e/canvas-expansion-flow.spec.ts`、`doc/plans/personal-mode/canvas-expansion/results.md`；修改 `src/core/commands.ts` 及必要的正式接线，不新增正式 Agent 页面或接口服务。

1. 用「输入 → 处理 → 输出」和额外未选对象写核心测试：按 ID 查询对象和显式关系，区分两端/方向；凡仅有相交或贴边均无关系。按范围改「处理」的位置和一条获授权箭头的样式，未授权对象的数据不变，绑定端自然跟随；一次撤销恢复。测试未知 ID、越权、非法锚点与受限删除触发的跨对象副作用；失败时场景、撤销与重做都不变。
2. 提供**仅本地、无需模型**的结构化读入口；复用已有受限批次写入口，不给程序开一条绕过场景校验的写通道。区分「被命令写入的对象」与「随关系重新计算、但记录没被改写的对象」。读取时能区分直线、折线、曲线及箭头，并从真实路径区分「接到一条线」与「接到那条线的宿主」；关系由场景推导，不从截图猜测、不另存图数据库。
3. 正式页面走一次最小闭环：远处放图元、在侧栏定位、续画折线、连接到本地图片（示例使用 Excel 导出的表格 PNG）、从一条曲线引出分支；保存后在新会话离线打开并继续改，选择一部分导出 SVG、插入 PowerPoint。保留旧 v1 和 C3 校验，不以自动化代替真实字体、输入法和 PowerPoint 视觉核对。
4. 执行 `npm.cmd run test:unit`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run test:e2e`。记录提交、环境、实际命令、通过数、失败或未测项到 `results.md`；准备一份测试用扩展示例供审阅，但**不代替 D 的正式原创示例和干净副本验收**。

## 6. 交付检查和停点

- **兼容性门：** 用 C3 真实 v1 下载件证明能打开、编辑、再保存 v2；读入失败不触动会话。与 A/B/C 的等价回归全部通过，扩展后的项目仍无需服务器或网络资源。
- **关系门：** 以浏览器实际绘制验证连接，在数据层读取同一结构；变换与撤销不漂移，选择和导出不会更改其他图元或改写历史。
- **范围门：** 本计划原批次不承担 PDF/PPTX 导入；新能力由[文档画布计划](2026-11-23-personal-mode-document-canvas.md)单独交付。原选区 SVG 插入 PowerPoint 与新 `.pptx` 导入导出分别验证。不做模型调用、Agent 对话、自动布线、完整电子表格、远程素材、协作。
- 扩展三验收通过后，报告扩展验收与遗留项，等待明确批准再进入 **D：正式示例、文档与干净环境交付验收**。D 通过后再单独规划 Agent Mode。
