# 月历、待办、日记与专注条的设计参考

2026-10-14 阅读公开源码和官方说明，并查看 shadcn/ui、DayFlow 的官方演示。以下按现有 Obsidian 插件实现，只吸收布局与交互方式，没有引入 React/Svelte 或复制参考项目源码。

| 参考 | 已核实的设计 | 本轮使用方式 |
| --- | --- | --- |
| [Obsidian Calendar UI](https://github.com/liamcain/obsidian-calendar-ui) 的 [Nav](https://github.com/liamcain/obsidian-calendar-ui/blob/master/src/components/Nav.svelte) 和 [Day](https://github.com/liamcain/obsidian-calendar-ui/blob/master/src/components/Day.svelte) | 同一行月份导航，日期与点标记，原生主题 CSS 变量 | 月历导航收紧，周数与农历为辅助信息，原生字体及主题继续继承 |
| [shadcn/ui 官方日历](https://ui.shadcn.com/docs/components/base/calendar) | 月年选择器、日期格可调尺寸、选中状态清晰 | 年月与前后翻页集中，舒适/紧凑密度仍可设置 |
| [Time Ruler Timer](https://github.com/j-palindrome/obsidian-time-ruler/blob/master/src/components/Timer.tsx) | 横向计时条，背景进度，控件随状态显示 | 单行专注条，时钟与操作不更换 DOM，按需显示错误及结束确认 |
| [Super Productivity Focus Mode](https://github.com/super-productivity/super-productivity/wiki/4.15-Timers-and-Focus-Mode) | 任务与专注共享状态，准备与运行阶段操作不同 | 默认开始番茄专注，已有活动会话保持当前模式，多个页面控制同一计时器 |
| [DayFlow 官方演示](https://calendar.dayflow.studio/demo) | 集中视图切换，详情与日历分工 | 列表、四象限和时间线统一入口、选中状态与操作密度 |

日记部分是结合当前截图形成的设计：日期头部与操作合并，正文减少标题留白与装饰，保留原生 Markdown 渲染。四象限始终保留两列；任务筛选与重复任务逻辑复用现有实现。

实际番茄记录不直接写入日记正文。侧栏计时条与完整计时器共享原有本地记录；暂停、主动结束、跨日和大日历实际用时仍由现有计时模型处理。

## 1.5.2 计时页的层级

日历与计时改为互切后，计时页可提供更大的时钟与进度环。阶段及事项置于上部，主操作位于时钟下方，次要操作集中在角落；控制正常面板高度，为下方待办保留空间。原来的单行条继续用于日记与周期清单，复用同一计时状态。界面采用主题变量，不新增字体或 UI 框架。
