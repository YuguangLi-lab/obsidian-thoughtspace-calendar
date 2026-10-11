# 1.4.4 · Tasks 连续操作与时间线优化

本版聚焦重复任务连续操作、轻量刷新和任务界面。无需迁移日记或任务；从 1.4.3 升级时保留原有 `data.json` 和笔记即可。

## 修复连续操作中断

同一笔记快速勾选多条重复任务时，第一项生成下一次任务会改变后续行号与文件索引版本。此前后续点击可能提示“任务原文已变化”或“任务版本已变化”；现在会核对本插件成功写入后的原文，为已排队且未被替换的其他任务重新定位。

- 列表、四象限、时间线均支持连续完成不同重复任务。
- 同名、同内容的不同任务仍按来源位置区分。
- 同一任务重复点击不会误完成刚生成的下一次无日期任务。
- 外部修改、读取失败和过期索引继续保留冲突检查。
- 撤销上次操作会同时恢复该次完成及生成的任务区间，不撤销前面已经成功的其他操作。

## 时间线编辑与流畅性

- 分钟计时器只更新时间、进行中状态和当前位置，保留任务卡片、键盘焦点与已展开内容。
- 点击卡片顶部时间，直接编辑日期、精确分钟和优先级；保存后保留重复规则和块引用。
- 正确处理开始／结束边界，跨午夜后隐藏上一天的当前时间标记。

## 界面调整

正文、来源与时间分层排列；卡片底部显示来源笔记名称，长名称自动省略。统一来源图标、时长标签、间距与边框，兼容 Obsidian 字体和深浅色主题。窄侧栏仍保持固定 2×2 四象限。

[任务列表预览](https://raw.githubusercontent.com/YuguangLi-lab/obsidian-thoughtspace-calendar/v1.4.4/docs/images/tasks.png) · [四象限预览](https://raw.githubusercontent.com/YuguangLi-lab/obsidian-thoughtspace-calendar/v1.4.4/docs/images/quadrants.png) · [时间线预览](https://raw.githubusercontent.com/YuguangLi-lab/obsidian-thoughtspace-calendar/v1.4.4/docs/images/timeline.png)

## 验证结果

| 检查 | 通过数量 |
| --- | ---: |
| 单元测试 | 280 |
| 安装官方 Tasks 8.5.0 后的真实联动检查 | 57 |
| 原生日历工作流 | 36 |
| 浏览器交互 | 30 |
| 深浅色与宽窄任务布局组合 | 12 |
| 官方 Tasks API 契约 | 19 |

列表、四象限和时间线分别连续勾选 6 项重复任务，再撤销最后一项，全部通过。101 篇原测试库笔记内容哈希不变，临时笔记、Tasks 设置和工作区已恢复。

[完整验证报告](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/v1.4.4/qa/RELEASE-VERIFY-1.4.4.json) · [测试方法](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/v1.4.4/docs/TESTING.md)

## 下载与升级

1. 推荐下载 **`thoughtspace-calendar-1.4.4.zip`**，这是含原生苹果日历桥接程序、使用文档与验证报告的完整安装包。GitHub 自动生成的 Source code 压缩包不是推荐安装包。
2. 将内容放到仓库 `.obsidian/plugins/thoughtspace-calendar/`，确保 `manifest.json` 直接位于此目录。
3. 保留原有 `data.json`、个人设置及笔记，重新加载插件。
4. 如需苹果日历，保留完整 `native/ThoughtSpaceCalendarBridge.app` 及可执行权限。

Release 同时提供 `main.js`、`styles.css`、`manifest.json`，以及 `SHA256-1.4.4.json` 和 `FILES-1.4.4.txt`。三个单独运行文件不包含苹果日历原生桥接程序；完整 ZIP 可使用 SHA256 清单校验。

## 兼容与已知边界

- Obsidian 桌面版，清单最低要求 1.6.0；重复任务需要 Tasks 7.2+，本版实测 8.5.0。
- 重复规则已结束、自定义复选状态或完成后删除等情况，仍需在原笔记通过 Tasks 操作。
- 苹果日历需 macOS 14+，仍为实验功能；本版未读取或写入真实苹果日程。
- 短时测试不代表长期无内存泄漏；Windows/Linux 原生界面和移动端未在本版验证。

[中文详细介绍](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/tree/v1.4.4#readme) · [使用指南](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/blob/v1.4.4/docs/USAGE.md) · [问题反馈](https://github.com/YuguangLi-lab/obsidian-thoughtspace-calendar/issues)
