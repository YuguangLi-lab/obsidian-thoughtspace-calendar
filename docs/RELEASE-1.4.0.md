# ThoughtSpace 日历与日记 1.4.0

把任务排期、日程和笔记连接起来：从列表或四象限拖任务到大日历，在周时间格调整时间，再从同一条当日时间线打开任务原文或日程笔记。

## 本版变化

- **任务拖入日历**：支持侧栏列表、四象限和大日历“待安排”；月格改计划日，周时间格安排具体时间。
- **移动与调整结束**：任务和可写苹果日程支持拖动，周视图底部手柄修改结束，指针按 15 分钟吸附。
- **精确排期**：任务时钟入口支持按分钟输入，不强制把输入值吸附到刻度。
- **统一当日时间线**：定时任务与苹果日程按开始时间排列，全天、当日待办、已完成和待安排分开收纳。
- **日程关联笔记**：新建笔记或用原生模糊搜索关联已有笔记，通过 `thoughtspace-calendar-events` 原生列表属性保存关系。
- **可选 Tasks 联动**：启用 Tasks 7.2+ 后，重复任务勾选调用其官方 API，保留重复规则、返回顺序和安全撤销。
- **交互保护**：拖动期间推迟刷新，取消恢复原状态；原文过期、日程版本冲突时停止覆盖。

## 使用边界

Markdown 任务仍写回原笔记，不自动复制为苹果日程。已完成任务不能拖动安排；独立截止日只作提醒。任务时间限当日，最晚结束为 23:59。

跨日苹果事件仅起始日片段可拖动改期，末日片段可调整结束。只读日程禁止修改，全天事件不通过拖入小时格隐式转换。重复苹果日程只修改当前场次。

笔记关联保存在本地属性，不上传正文或仓库路径；新笔记中的日程时间是创建时快照。普通任务保留原完成逻辑，Tasks 自定义复选状态和完成后删除等暂不支持的 API 结果会提示到原文处理。

## 更新安装

下载版本以 [Releases 页面](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/releases) 实际附件为准；本文是版本说明，不表示 1.4.0 已在 GitHub 发布。

完整安装包解压到 `.obsidian/plugins/thoughtspace-calendar/`，保留原有 `data.json`，更新后重新加载插件。苹果联动必须保留完整 `native/ThoughtSpaceCalendarBridge.app` 结构和权限。

## 验证说明

构建、自动化及界面验证结果见 [1.4.0 公开记录](../qa/RELEASE-VERIFY-1.4.0.json)。新增回归覆盖任务安排、拖动令牌、日程完整字段及版本保护、笔记属性、重复任务与多行撤销。

本轮没有对真实苹果日程执行写入测试。真实系统授权、读写往返、账户云同步、长期内存表现和 Windows/Linux 原生界面仍需专门验证。macOS 桥接依赖 macOS 14+，支持 Apple Silicon / Intel，为 ad-hoc 签名，未做 Apple Developer ID 公证。

[使用指南](USAGE.md) · [苹果日历指南](APPLE-CALENDAR.md) · [完整功能说明](../FEATURES-1.4.0.md) · [Tasks 官方 API](https://github.com/obsidian-tasks-group/obsidian-tasks/blob/main/docs/Advanced/Tasks%20Api.md)
