# Personal Mode 文档画布实施计划：PDF 与 PPTX

> **执行要求：** 参赛者已确认底稿、裁切规则并批准开始开发。使用 `executing-plans` 和 `test-driven-development`，按批实现与验收。先交 M0–M2；PPTX 的系统组件和第二批实施等后续确认。本文提交、实现提交和推送分别确认。

> **当前进度：** M0–M2（含 PDF 左栏调整）已验收并提交。M3 的 PPTX 导入与离线重开、M4 的 PPTX 导出均已验收，获准本地提交。下一项是 E8 的按页读取、受限编辑与回归验证；尚未开始。详见[验证记录](document-canvas/results.md#m4--pptx-导出)。

**目标：** 从「打开项目」导入 PDF/PPTX，每页成为带独立编辑层的画布；保存项目可离线重开，导出原格式的整份、当前页或指定页码范围。

**架构：** 文档由原始页面信息、锁定底稿和每页既有场景组成。画布允许抓手进入页外，项目保存完整编辑层，文档导出按原页边框裁切。原文档格式的读取、渲染和导出分别用适配器处理，保留现有场景及关系模型。

**技术栈：** 沿用当前 React、Fabric、TypeScript、Vite、Vitest、Playwright 与 Windows 桌面浏览器基线。PDF 用 PDF.js 预览、pdf-lib 写出；PPTX 用 `@web-ppt/core` 生成静态底稿、PptxGenJS 写出，不增加云服务，也不要求安装本地转换组件。

关联：[需求](document-canvas/requirements.md) · [验收清单](document-canvas/validation.md) · [原画布扩展与 E8](2026-11-22-personal-mode-expansion.md)。

## 1. 基线、顺序和停点

- 基线：`feat/personal-mode` 的 `c06fcd4` 记录取消 E7；`5837e77` 已交付本地图片。E8 尚未开始。文档扩展技术上复用 E0–E6；E8 在本批验收后增加按页关系验证，之后再决定是否进入 D。现有单画布、v1/v2 读入、图片吸附、按选区导出 SVG 的语义保持不变。
- **第一批 M0–M2：** 多页底座与 PDF 闭环，先交真实 PDF 测试件验收。**第二批 M3–M4：** PPTX 渲染试验、路线确认后再做正式打开和导出，交真实 PPTX 验收。**最后：** 复用 E8 计划验证按页读与受限编辑，不接 Agent；D 另行批准。
- **依赖决策：** M0 可用合成的多页项目件推进，不必等 PPTX 渲染选型。M3 先比较已有 Windows PowerPoint、本地转换器或浏览器方案能达到的保真度与部署要求。若必须安装组件、引入本地服务，或纯浏览器方案达不到样例要求，先提交证据和取舍给参赛者决定；未获批准不安装、不上传文档、不把「先手动转 PDF」当作已支持直接打开 `.pptx`。
- 每项先写红测，运行确认失败原因是功能缺失，再最小实现、复跑。按[验收清单](document-canvas/validation.md)归档可打开的测试件和真实导出文件，证据落入 `doc/plans/personal-mode/document-canvas/results.md`；不以测试截图替代位图/原页的导出检查。

## 2. 第一批：多页底座与 PDF

### M0 · 多页项目、切页和兼容（DC-01～DC-04）

**文件：** 新建 `src/core/document.ts`、`src/ui/PageNavigator.tsx`、`tests/unit/documentProject.test.ts`、`tests/e2e/document-pages.spec.ts`；修改 `src/project/projectFile.ts`、`src/project/projectSession.ts`、`src/core/history.ts`、`src/editor/useEditor.ts`、`src/editor/FabricSurface.ts`、`src/ui/FileMenu.tsx`、`src/App.tsx`。

1. 红测两页不同尺寸的项目件：第 1 页新增，第 2 页新增，再回第 1 页；两页对象与选区不串，页外图元完整重开；翻页、缩放、平移、底稿显隐都不进历史。测试撤销/重做跨页时界面定位受影响页面，防止看不见改了哪页；用真实 v1/v2 旧项目回归，旧 v2 输出按当前口径保留。
2. 增加文档文件版本 `v3`（仅文档项目启用），每页稳定 ID、顺序、尺寸、原页映射、底稿引用和一份复用现有规则的场景。使用同一应用级历史，一次操作只修改其所在页；视口/选区是会话状态，导入的新项目不继承旧历史。底稿只渲染不进入对象目录，显隐不写入项目。项目文件独立携带重开所需资源；PDF 原文件按文档存一次，PPT 不要求保存原始演示文稿。文档资源预算独立于 E6 的用户插入图片预算。
3. 命令：`npm.cmd run test:unit -- tests/unit/documentProject.test.ts tests/unit/projectFile.test.ts`、`npm.cmd run test:e2e -- document-pages.spec.ts personal-core.spec.ts canvas-viewport.spec.ts`；预期多页与旧单页同时通过。

### M1 · PDF 导入、预览和离线重开（DC-01～DC-04、DC-07）

**文件：** 新建 `src/project/documentImport.ts`、`src/document/pdfImport.ts`、`tests/fixtures/documents/`、`tests/e2e/pdf-document.spec.ts`；修改 `src/project/projectFile.ts`、`src/editor/useEditor.ts`、`src/editor/FabricSurface.ts`、`src/ui/FileMenu.tsx`，验证后再更新 `package.json` 和锁文件。

1. 红测通过正式文件入口导入真实 PDF：至少覆盖 A4、横版、裁切框非零原点、旋转页、一页含中文文本和一页扫描图；按页切换并对照页角标记。另试损坏、加密、超限和导入中切项目；失败/取消保留旧项目和历史。
2. 使用本地打包的预览引擎/资源，不发网络请求，不执行文档自带脚本或加载外链。归一页面可见框、旋转和排版坐标，再给编辑层使用固定页内坐标；预览按当前页和缩略图按需渲染，不一次生成全书高清位图。按页提取可得的原文文本，扫描页明确无文本层；不做 OCR。用真实样例确定文档字节、分页和预览缓存上限，先拒绝明显超限数据再解码。
3. 命令：`npm.cmd run test:e2e -- pdf-document.spec.ts document-pages.spec.ts`；预期 PDF 下载项目在新会话先加载应用、断网后，不靠原 PDF 路径重开，图元和底稿仍对齐。

### M2 · 原页裁切、导出预览和 PDF 写出（DC-05～DC-07）

**文件：** 新建 `src/export/documentExport.ts`、`src/export/pdfDocument.ts`、`src/ui/DocumentExportDialog.tsx`、`tests/unit/documentExport.test.ts`；扩展 `tests/e2e/pdf-document.spec.ts`，修改 `src/ui/FileMenu.tsx`、`src/editor/useEditor.ts`。

1. 红测页框 `0,0 → 100,100`：完全页外的不导出；从 `(80,50)` 指向 `(130,50)` 的箭头只见页内 `(80,50) → (100,50)`，页边不造新箭尖。加入厚描边、旋转、图片和曲线，验证裁切依据实际输出而非对象中心或浏览器截图。整份、当前页、范围保持原顺序、混合尺寸和空白页；拒绝非法范围，不损坏现有项目。
2. 建立统一导出页面清单：按稳定页 ID 取快照、解析绑定后判断可见范围；对复杂几何难以精确计数时给保守提示，不谎报「完全在页内」。预览与输出共用裁切口径；未选页、完全页外对象、手柄以及视口都不进入成品。给 PDF 原页叠加页内编辑层，优先保留现有文本层可检索、可复制，不把原 PDF 整页截图；不保证数字签名、交互表单、附件或链接行为保留，按首版边界提示。项目状态、历史和原文件不变。
3. 命令：`npm.cmd run test:unit -- tests/unit/documentExport.test.ts`、`npm.cmd run test:e2e -- pdf-document.spec.ts selection-export.spec.ts`。用独立 PDF 查看器核对页数、尺寸、中文底稿文字检索及跨边箭头。**第一批停点：** 参赛者亲试「打开多页 PDF → 画一个跨边对象、一个页外草稿 → 导出当前页 → 离线重开项目」。

## 3. 第二批：PPTX 静态底稿与写出

### M3 · 渲染试验与 PPTX 导入（DC-01～DC-04、DC-08）

**文件：** 试验矩阵写入 `doc/plans/personal-mode/document-canvas/results.md`；新建 `src/document/pptxImport.ts`、`tests/e2e/pptx-document.spec.ts`，补 `tests/fixtures/documents/`；确认渲染路线后再确定系统集成位置和更新 `package.json`、锁文件或本地组件文档。

**选型结果（已确认）：** 两种比例各三页均用已有 PowerPoint 生成原生 PNG 基准。采用 `@web-ppt/core` `0.8.0` 纯浏览器首次导入，项目内嵌每页 PNG，PowerPoint 仅用于对照验收。库保留样例的母版、页序和隐藏页；柱形图的比例保留，但刻度与排版不是像素级一致。默认 PowerPoint 转 PDF 会漏隐藏页，不作为正式导入链路。

1. 先验真实 `.pptx`：宽屏、4:3 分别成稿；包含中文、母版、嵌入图片、图表、普通表格和静态复杂元素。逐页比较页数、尺寸和可辨识布局；记录缺字体、动画/视频未保留等限制及所需环境。宏、外链、文件损坏、渲染缺页、转换取消或超时均有明确提示，不发布半成品。
2. 验收同意后，将选定引擎接入「打开 PPTX」。预览为各页锁定图片，不拆母版、SmartArt 或单元格；打开项目保存各页底图和编辑层，不需要原 `.pptx` 或渲染组件才能再次打开项目。演示稿原生文本提取独立于渲染，先评估，不能提取的页明确标记不支持；不把 OCR 作为 M3 门槛。
3. 命令：`npm.cmd run test:e2e -- pptx-document.spec.ts document-pages.spec.ts`；在目标 PowerPoint 与应用中对照测试件。测试用预渲染文件只可补自动化，不可替代真实 `.pptx` 入口验收。

### M4 · PPTX 导出与交接（DC-05、DC-06、DC-08）

**文件：** 新建 `src/export/pptxDocument.ts`、`tests/unit/pptxExport.test.ts`；扩展 `tests/e2e/pptx-document.spec.ts`；复用 `src/export/documentExport.ts` 和 `src/ui/DocumentExportDialog.tsx`。

1. 红测导出整份和单页 `.pptx`：页面顺序及大小正确，完全在页外的草稿不进入文稿，跨边笔迹/箭头/图片只保留页内可见部分。分别核对普通文字/基本形状/直线等原生对象和复杂图元的显示效果。试用实际 PowerPoint，不以 ZIP 解包成功当作兼容性证明。
2. 新建文稿，以原幻灯片的**静态底图**填充每页。页内新增的简单对象优先导出为 PowerPoint 可单独选中的对象；若复杂或跨边对象无法用原生元素可靠裁切，则按已验证的矢量格式或透明位图叠加，只带上页内可见部分，必要时提示降级。设计必须避免为页外草稿自动扩页、改版式或生成额外幻灯片；同一 `.pptx` 仍使用原稿统一页面尺寸。导出的 `.pptx` 不承担恢复项目和关系的职责。
3. 命令：`npm.cmd run test:unit`、`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd run test:e2e`；实际在 Windows PowerPoint 打开单页和整份文件，检查原生对象可选中、跨边裁切。**第二批停点：** 参赛者验收两种格式；之后才按原计划接续 E8 的按页结构化读取、授权编辑与撤销，再等批准进入 D。
