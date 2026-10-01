# ThoughtSpace 日历与日记 1.3.0

独立的 Obsidian 桌面日历插件，把日历、日记和 Markdown 任务放到同一工作流。本次公开完整源码和最新安装包，核心功能不依赖 ThoughtSpace 白板。

## 下载和安装

推荐下载 **`thoughtspace-calendar-1.3.0.zip`**，解压到仓库 `.obsidian/plugins/thoughtspace-calendar/`，在第三方插件中启用“ThoughtSpace 日历与日记”。保留原有 `data.json`，更新后重新加载插件。

完整 ZIP 携带 `native/ThoughtSpaceCalendarBridge.app`；只有三个根目录运行文件不包含苹果日历桥接程序。目录结构和可执行权限必须保留。

## 大日历

- 主工作区月视图和周视图，完整六周日期与当日详情。
- 全天区域、24 小时时间格、重叠日程分列。
- 本地 Markdown 定时任务进入周时间格，点击直达原文行。
- 点击周视图空白格预填新日程时间。
- 窄分栏按页签宽度适配；刷新保留周视图滚动，重载恢复日期与月/周模式。

## 日记与任务

- 独立侧栏日历、日记与周期清单；周/月/季/年笔记入口。
- 农历、节气、节日、休班标记和年历；调休数据收录至 2026 年。
- 新日记按年月归档，复用旧日记；旧文件整理先备份，同名目标跳过。
- 当天新建笔记链接、快速收集笔记、Obsidian 原生 Markdown 编辑。
- 列表、固定 2×2 四象限、任务拖动和时间线。
- 日期/时间/优先级设置、标签筛选、搜索、排序、分组、来源行跳转和撤销。
- 使用 Obsidian 主题和正文字体；样式限制在插件容器中。

## 苹果日历联动（实验）

macOS 14+，Apple Silicon / Intel。通过系统 EventKit 读取选择的日历，并创建/修改日程；支持标题、时间、全天、日历、地点与完整备注。

需要主动点击连接并允许系统读写权限。只读日历只能查看；重复日程只修改当前场次。保存前检查版本，发生冲突时保留草稿。外部修改在刷新、窗口回到前台或可见页面定时刷新后更新，账户云同步由苹果日历负责。

**真实系统授权、真实日程读写往返与账户云同步仍待验证。** 当前测试使用输入校验、状态查询和内存日程夹具，没有创建真实测试日程。桥接应用为 ad-hoc 签名，未做 Apple Developer ID 公证。

此版本不包含删除日程、苹果提醒事项、重复规则编辑和 Markdown 任务自动转苹果日程。

## 流畅性与保护

共享任务索引及增量文件更新；日程查询限制可见范围、缓存和合并并发请求；过期异步结果不会覆盖当前界面。任务原文、设置与日程保存采用并发检查和排队，结果不确定的日程写入不自动重试。

## 验证

- 干净目录构建通过，公开运行文件与原验证版本 SHA256 一致。
- 176 项自动化测试通过，0 失败。
- 15 项隔离浏览器交互检查通过，使用合成数据。
- 原开发版本另有 20 项原生 Obsidian 检查通过，日程编辑使用内存夹具。
- 长期内存表现及 Windows/Linux 原生界面尚未验证。

仓库另附中英文 README、使用指南、苹果日历设置与故障排查、开发/测试文档、公开验证报告、CI 和问题反馈模板。

[详细介绍](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar#readme) · [苹果日历指南](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/main/docs/APPLE-CALENDAR.md) · [公开验证记录](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/main/qa/RELEASE-VERIFY-1.3.0.json)

## 更新兼容

Obsidian 桌面清单最低版本 1.6.0，移动端未支持。与 ThoughtSpace 白板同时使用时需白板 0.94.0+。首次启用独立日历仅迁移旧日历相关设置，不改写旧配置，也不批量移动笔记。

许可证：MIT。`SHA256-1.3.0.json` 和 `FILES-1.3.0.txt` 用于核对安装包及运行文件。源码默认分支 `main`，发布标签 `v1.3.0`。
