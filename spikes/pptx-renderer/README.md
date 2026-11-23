# M3 PPTX 渲染选型（一次性试验）

判定问题：同一份含中文、母版、表格、图片、图表和隐藏页的 `.pptx`，浏览器能否离线生成尺寸、页序正确的静态 PNG，而且主要内容与 PowerPoint 相符？本试验与正式应用入口无关。

## 复现

从仓库根目录运行。已使用现有 Windows PowerPoint、Edge、Python 的 `python-pptx`、Pillow、Playwright 和 PyMuPDF；不运行安装脚本。仅需下载已固定版本和 SHA-512 的 npm 文件，不上传样例。

```powershell
$out = '.cache/pptx-selection'
python spikes/pptx-renderer/make_fixtures.py "$out/fixtures"
& .\spikes\pptx-renderer\render-office.ps1 -FixtureDir "$out/fixtures" -OutputDir "$out/office"
python spikes/pptx-renderer/fetch-bundles.py "$out/vendor"
python spikes/pptx-renderer/render-browser.py "$out/fixtures" "$out/vendor/preview/dist/pptx-preview.umd.js" "$out/browser"
python spikes/pptx-renderer/render-webppt.py "$out/fixtures" "$out/vendor" "$out/webppt"
python spikes/pptx-renderer/compare.py "$out"
```

PowerPoint 脚本要求试验开始时没有打开 PowerPoint，只读打开两份自行生成且没有外部关系的样例。`external.pptx` 只进入离线、阻断外部访问的浏览器试验，不交给 Office；`example.invalid` 是故意不可用的测试地址。

查看 `.cache/pptx-selection/comparison-wide.png` 和 `comparison-standard.png`。每张图从左至右是 PowerPoint、`@web-ppt/core`、`pptx-preview`，第三行是源文稿隐藏页。

## Verdict: PARTIAL

- `@web-ppt/core` 已在两份小样通过离线 PNG 生成、原尺寸/页序、母版、主要内容和隐藏页验证；中文可读，但不是无差异转换。导出实现使用 `slideToPng`，不是截图。
- PowerPoint `Slide.Export` 是可信基准；经默认 PDF 转换会少一页。`pptx-preview` 在两种比例均漏掉母版条，不推荐。
- 外链测试证明需在生产环境额外隔离并拒绝，不能把库的 `strictResources` 当作网络访问控制。后续仍要验证包资源上限、真实项目保存/重开和更多版式。

正式决策与限制见[文档画布验证记录](../../doc/plans/personal-mode/document-canvas/results.md#m3--pptx-渲染选型试验)。
