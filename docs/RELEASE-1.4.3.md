# 1.4.3 · Tasks 重复任务联动与任务界面

## 从 1.3.0 升级

本次发布整合此前 1.4.x 的本地迭代：

- 在列表、四象限、时间线和大日历完成 Tasks 重复任务，由 Tasks 的公开 API 生成下一次任务；支持 Emoji 与 Dataview 字段。
- 将任务拖入月历/周时间格安排日期和时间；支持精确分钟输入、移动和调整结束时间。
- 当日详情合并定时任务与苹果日程，提供待安排区；日程可新建关联笔记或关联已有笔记。
- 保护任务块引用、重复规则、原文独立修改及安全撤销；阻止陈旧界面误完成下一轮无日期重复任务。
- 合并重复刷新，恢复列表焦点；本轮进一步修复时间线焦点丢失、同名任务焦点跳错、四象限归类后焦点丢失。
- 美化任务列表和四象限，强化信息层次、紧凑日期和时间入口，兼容浅色/深色及窄侧栏，四象限始终保持 2×2。

## 验证

270 项自动化测试、41 项安装 Tasks 后的原生联动检查、36 项原生日历工作流检查、30 项浏览器交互检查及 12 组任务布局检查通过。官方 Tasks 8.5.0 API 的 19 项契约检查通过。原有 101 篇测试库笔记内容校验一致，本轮临时笔记已清理。

## 安装与边界

下载完整 `thoughtspace-calendar-1.4.3.zip`，解压到 `.obsidian/plugins/thoughtspace-calendar/`，保留原有 `data.json`，然后重新加载插件。苹果日历需保留完整 `native/ThoughtSpaceCalendarBridge.app`。常规三个运行文件也作为附件提供。

重复任务需要启用 Tasks 7.2+；本轮实测 8.5.0。重复规则结束、自定义复选状态及完成后删除等情况仍需在原文通过 Tasks 操作。苹果日历为实验功能，本轮未操作真实苹果日程；短时测试不代表长期内存稳定性。

[详细使用指南](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/main/docs/USAGE.md) · [验证报告](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/main/qa/RELEASE-VERIFY-1.4.3.json)
