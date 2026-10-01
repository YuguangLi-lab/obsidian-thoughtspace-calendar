# 开发与发布

## 构建

建议 Node.js 22+。根目录运行：

```sh
npm ci
npm run build
npm test
```

`build` 先运行 TypeScript 检查，再用 esbuild 打包为 Obsidian 加载的 CommonJS `main.js`，随后生成限定作用域的 `styles.css`。Obsidian 模块保持外部依赖；无需将 node_modules 放进插件目录。

原生接口源码在 `native/CalendarBridge.swift`。macOS 上安装 Xcode Command Line Tools 后运行：

```sh
npm run build:native
```

分别编译 arm64 与 x86_64，目标 macOS 14，再合并和 ad-hoc 签名。修改桥接程序后，重新执行自动化检查和打包。构建清理应用包的 Finder 装饰与隐藏标记，保留系统隔离等安全属性。

## 模块入口

| 模块 | 职责 |
| --- | --- |
| `src/main.ts` | 独立插件入口、设置、命令、日记与共享任务索引 |
| `src/journal-view.ts` | 侧栏日历和日记清单 |
| `src/chinese-calendar.ts` | 农历、节气、节日与休班数据适配 |
| `src/task-planner.ts` | 文件级任务索引、事件监听、更新与撤销 |
| `src/task-planner-model.ts` | 任务元数据、筛选排序、原文并发校验 |
| `src/task-planner-view.ts` | 列表和固定四象限交互 |
| `src/day-timeline-view.ts` | 时间线展示 |
| `src/large-calendar-view.ts` | 大日历月/周视图与日程交互 |
| `src/calendar-model.ts` | 日历模型、日期与重叠布局 |
| `src/apple-calendar.ts` | 范围缓存、并发查询和日程保存客户端 |
| `src/native-calendar-transport.ts` | JSON 标准输入/输出与进程生命周期 |
| `native/CalendarBridge.swift` | EventKit 授权、查询、版本检查和保存 |
| `scripts/install.mjs` | 备份、校验、保护用户文件与安装回滚 |
| `scripts/package.mjs` | 发布 ZIP、签名验证和 SHA256 清单 |

`src/` 中保留部分从 ThoughtSpace 共用的模型模块；实际运行入口是独立日历，不需要启用白板插件。

## 界面验证

```sh
npx playwright install chromium
npm run test:browser
```

默认使用 Playwright Chromium。可通过 `CHROME_EXECUTABLE` 指定本地 Chrome 路径；`QA_DEPENDENCIES` 可指定独立的测试依赖目录。结果和截图生成于 `qa/large-calendar-output/`，不提交到 Git。

这是隔离浏览器中的 Obsidian API 替身和内存日程，不是实际苹果日历读写验收。GitHub Actions 使用 macOS 运行构建、原生输入检查、安装保护和该界面检查，不调用真实日历授权或写操作。

## 打包与安装

```sh
npm run package
node scripts/install.mjs '/path/to/your/vault'
```

打包在临时目录进行，保留可执行权限，不把扩展属性塞入 ZIP。发布包只携带最新运行文件、必要文档、公开验证报告和完整桥接应用。

安装脚本要求仓库已有有效的 `.obsidian/community-plugins.json`。备份位于仓库根目录的 `ThoughtSpace-plugin-backups/`，保留插件设置等个人文件。安装后重新加载插件。

## 提交要求

- 缺陷修复补充能复现问题的回归用例。
- 涉及 Markdown 写入时检查块引用、注释、代码围栏、换行和文件变化冲突。
- 涉及异步界面时检查关闭页面、切换日期、重载和重复入口。
- 不提交真实笔记、`data.json`、工作区布局、日志或账号授权信息。
- UI 截图采用合成数据，并标明测试环境。

GitHub Release 发布完整 ZIP、三个运行文件、SHA256 清单和文件清单。需要苹果日历的用户应下载完整 ZIP。创建发布标签前必须检查工作区、版本一致性和运行包签名。
