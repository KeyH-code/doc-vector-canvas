# 文档画布测试样例

- `wide.pptx`、`standard.pptx`：各三页，含中文排版、母版、嵌入 PNG、普通表格、柱状图、旋转组合和隐藏页。脚本生成的真实 OOXML 文档，不含用户数据。
- `external.pptx`：嵌图关系指向保留测试域名 `example.invalid`，只用来确认拒绝外部资源。
- `macro.pptx`：主文档声明为宏启用类型，**不含宏代码**，用来确认改文件名不能绕过格式检查。
- `duplicate-link.pptx`、`missing-image.pptx`、`utf16.pptx`：分别含重复关系 ID、缺失的内嵌图片部件、当前渲染库不支持的 UTF-16 页面。它们不应发布为有缺损的项目。
- `reordered.pptx`：原稿列表顺序是 3、2、1，底稿和只读文字都应按该列表，而不是按部件文件名顺序出现。

从仓库根目录用现有 Python 依赖重新生成：`python spikes/pptx-renderer/make_fixtures.py tests/fixtures/documents`。PDF 测试的 `pdfFixture.ts` 在测试进程内生成另一套样例。
