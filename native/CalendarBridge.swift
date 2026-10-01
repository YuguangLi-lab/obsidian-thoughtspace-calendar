import Foundation
import EventKit
import CryptoKit

struct BridgeError: Error {
    let code: String
    let message: String
}

struct EventDraft: Codable {
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let calendarId: String
    let location: String
    let notes: String
    let eventId: String?
    let originalStart: String?
    let revision: String?
}

struct Request: Decodable {
    let action: String
    let start: String?
    let end: String?
    let calendarIds: [String]?
    let draft: EventDraft?
    let eventId: String?
    let originalStart: String?
}

func fail(_ code: String, _ message: String) -> BridgeError {
    BridgeError(code: code, message: message)
}

func instant(_ value: String?) throws -> Date {
    guard let value, value.count <= 40 else { throw fail("invalid_date", "日期格式无效") }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    guard let date, date.timeIntervalSince1970 >= 0, date.timeIntervalSince1970 < 7_258_118_400 else {
        throw fail("invalid_date", "日期需在 1970–2199 年之间")
    }
    return date
}

let outputFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
func iso(_ date: Date) -> String {
    return outputFormatter.string(from: date)
}

func interval(_ start: String?, _ end: String?, maximum: TimeInterval) throws -> (Date, Date) {
    let a = try instant(start), b = try instant(end)
    guard b > a, b.timeIntervalSince(a) <= maximum else {
        throw fail("invalid_interval", "结束时间必须晚于开始时间，范围不能过长")
    }
    return (a, b)
}

func validate(_ draft: EventDraft) throws -> (Date, Date) {
    guard !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          draft.title.count <= 500, !draft.calendarId.isEmpty,
          draft.calendarId.count <= 1024,
          draft.location.count <= 2000, draft.notes.count <= 100_000 else {
        throw fail("invalid_event", "请填写标题和日历，并检查文本长度")
    }
    if draft.eventId != nil {
        guard let id = draft.eventId, !id.isEmpty, id.count <= 2048,
              let revision = draft.revision, revision.count == 64 else {
            throw fail("invalid_revision", "缺少原日程的版本信息，请刷新后重试")
        }
        _ = try instant(draft.originalStart)
    }
    return try interval(draft.start, draft.end, maximum: 366 * 86400)
}

func status() -> String {
    let authorization = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch authorization {
        case .fullAccess: return "authorized"
        case .writeOnly: return "write_only"
        case .notDetermined: return "not_determined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default: return "denied"
        }
    }
    switch authorization {
    case .authorized: return "authorized"
    case .notDetermined: return "not_determined"
    case .restricted: return "restricted"
    default: return "denied"
    }
}

func color(_ calendar: EKCalendar) -> String {
    guard let color = calendar.cgColor,
          let rgb = color.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
          let components = rgb.components, components.count >= 3 else { return "#447c83" }
    return String(format: "#%02x%02x%02x", Int(components[0] * 255), Int(components[1] * 255), Int(components[2] * 255))
}

func eventRevision(_ event: EKEvent) -> String {
    let values: [String] = [event.title ?? "", iso(event.startDate), iso(event.endDate),
        event.isAllDay ? "1" : "0", event.calendar.calendarIdentifier,
        event.location ?? "", event.notes ?? "", event.lastModifiedDate.map(iso) ?? ""]
    let data = try! JSONEncoder().encode(values)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func eventJSON(_ event: EKEvent, includeNotes: Bool = true) -> [String: Any] {
    ["id": event.eventIdentifier ?? "", "calendarId": event.calendar.calendarIdentifier,
     "title": event.title ?? "无标题日程", "start": iso(event.startDate), "end": iso(event.endDate),
     "allDay": event.isAllDay, "location": event.location ?? "", "notes": includeNotes ? (event.notes ?? "") : "",
     "revision": eventRevision(event), "recurring": event.hasRecurrenceRules,
     "editable": event.calendar.allowsContentModifications, "color": color(event.calendar)]
}

func occurrence(_ store: EKEventStore, _ id: String?, _ start: String?) throws -> EKEvent {
    guard let id, !id.isEmpty, id.count <= 2048 else { throw fail("invalid_event", "日程标识无效") }
    let original = try instant(start)
    let matches = store.events(matching: store.predicateForEvents(
        withStart: original.addingTimeInterval(-1), end: original.addingTimeInterval(1), calendars: store.calendars(for: .event)))
    guard let event = matches.first(where: {
        $0.eventIdentifier == id && abs($0.startDate.timeIntervalSince(original)) < 0.001
    }) else { throw fail("event_missing", "该日程已移动或删除，请刷新后重新打开") }
    return event
}

func handle(_ request: Request) throws -> [String: Any] {
    if request.action == "status" { return ["authorization": status()] }
    // Pure validation is available for QA without touching the user's calendars.
    if request.action == "validate" {
        guard let draft = request.draft else { throw fail("invalid_event", "缺少日程") }
        let (a, b) = try validate(draft)
        return ["valid": true, "start": iso(a), "end": iso(b)]
    }
    if request.action == "validate_range" {
        let (a, b) = try interval(request.start, request.end, maximum: 62 * 86400)
        return ["valid": true, "start": iso(a), "end": iso(b)]
    }
    guard ["request", "calendars", "events", "event", "save"].contains(request.action) else {
        throw fail("invalid_action", "不支持此操作")
    }
    let store = EKEventStore()
    if request.action == "request" {
        var finished = false
        var errorMessage: String?
        let callback: (Bool, Error?) -> Void = { _, error in
            DispatchQueue.main.async {
                errorMessage = error?.localizedDescription
                finished = true
            }
        }
        if #available(macOS 14.0, *) { store.requestFullAccessToEvents(completion: callback) }
        else { store.requestAccess(to: .event, completion: callback) }
        let deadline = Date().addingTimeInterval(150)
        while !finished && Date() < deadline {
            _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        guard finished else { throw fail("authorization_timeout", "授权尚未完成，请回到设置重试") }
        if let errorMessage { throw fail("authorization_failed", errorMessage) }
        return ["authorization": status()]
    }
    guard status() == "authorized" else { throw fail("permission_required", "请先授权读取和修改苹果日历") }
    let calendars = store.calendars(for: .event)
    if request.action == "calendars" {
        return ["calendars": calendars.map {
            ["id": $0.calendarIdentifier, "title": $0.title, "color": color($0),
             "editable": $0.allowsContentModifications, "source": $0.source.title] as [String: Any]
        }, "defaultCalendarId": store.defaultCalendarForNewEvents?.calendarIdentifier ?? ""]
    }
    if request.action == "event" {
        return ["event": eventJSON(try occurrence(store, request.eventId, request.originalStart))]
    }
    if request.action == "events" {
        let (a, b) = try interval(request.start, request.end, maximum: 62 * 86400)
        guard let ids = request.calendarIds, ids.count <= 200 else { throw fail("invalid_calendars", "请选择显示的日历") }
        // Empty selection means no events, never a wildcard for all calendars.
        let selected = calendars.filter { ids.contains($0.calendarIdentifier) }
        if selected.isEmpty { return ["events": [], "truncated": false] }
        let events = store.events(matching: store.predicateForEvents(withStart: a, end: b, calendars: selected))
            .sorted { $0.startDate < $1.startDate }
        return ["events": events.prefix(2000).map { eventJSON($0, includeNotes: false) }, "truncated": events.count > 2000]
    }
    guard let draft = request.draft else { throw fail("invalid_event", "缺少日程") }
    let (a, b) = try validate(draft)
    guard let calendar = calendars.first(where: { $0.calendarIdentifier == draft.calendarId }),
          calendar.allowsContentModifications else { throw fail("read_only", "目标日历不存在或不可编辑") }
    let event: EKEvent
    if let id = draft.eventId {
        // event(withIdentifier:) can return the first occurrence of a series.
        // Match both identifier and occurrence start instead.
        let found = try occurrence(store, id, draft.originalStart)
        guard found.calendar.allowsContentModifications else { throw fail("read_only", "此日历不可编辑") }
        guard eventRevision(found) == draft.revision else {
            throw fail("conflict", "日程已在苹果日历中更新，请刷新后重新编辑")
        }
        event = found
    } else { event = EKEvent(eventStore: store) }
    event.calendar = calendar
    event.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
    event.isAllDay = draft.allDay
    event.startDate = a
    event.endDate = b
    event.location = draft.location
    event.notes = draft.notes
    if event.timeZone == nil && !draft.allDay { event.timeZone = .current }
    // Never rewrite a complete recurring series from this editor.
    try store.save(event, span: .thisEvent, commit: true)
    return ["event": eventJSON(event)]
}

do {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard data.count <= 1_048_576 else { throw fail("request_too_large", "请求过大") }
    let request = try JSONDecoder().decode(Request.self, from: data)
    let result = try handle(request)
    let output = try JSONSerialization.data(withJSONObject: ["ok": true, "data": result], options: [.sortedKeys])
    FileHandle.standardOutput.write(output)
} catch {
    let known = error as? BridgeError
    let output: [String: Any] = ["ok": false, "error": ["code": known?.code ?? "native_error", "message": known?.message ?? error.localizedDescription]]
    if let data = try? JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data)
    }
    exit(1)
}
