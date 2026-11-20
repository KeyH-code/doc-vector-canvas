# 项目结构

| 位置 | 用途与允许内容 | 命名示例 |
| --- | --- | --- |
| 项目根目录 | 维护产品入口、项目结构与比赛要求。README 随实现补齐使用和启动说明，赛事规则单独维护。 | `README.md`、`STRUCTURE.md`、`competition_rules.md` |
| `doc/research/` | 记录竞品观察、技术调研、参考来源和待验证问题。调研建议不等同于已批准的开发方案。 | `personal-mode-research.md` |
| `doc/plans/` | 按阶段存放开发计划、需求范围和验收标准。计划注明待审、实施中或已验收，不把计划当作进度证据。 | `personal-mode/2026-11-20-personal-mode.md`、`personal-mode/requirements.md`、`personal-mode/validation.md` |
| `spike.html`、`spike/` | Personal Mode A 批的可运行技术小样，不是正式应用入口；正式测试覆盖其验证项后可移除。 | `spike/fabric-smoke.ts` |
| `src/core/`、`src/project/` | 无页面依赖的图元、命令、撤销历史和项目文件规则。浏览器交互与渲染不放入核心。 | `src/core/commands.ts`、`src/project/projectSession.ts` |
| `tests/unit/` | 核心规则测试和无页面的保存、重开用例。 | `projectFlow.test.ts` |
| `tests/e2e/` | 实际浏览器交互测试；当前只验证 A 批小样。 | `engine-spike.spec.ts` |

根目录的 `package.json`、锁文件和 `*.config.ts` 提供本地启动及测试配置；当前没有正式应用入口 `index.html`。新增实现、示例或测试目录时，在这里补充实际用途、允许内容和命名约定。
