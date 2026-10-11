/// Merges streamed parts into a message the same way the web app does.
///
/// Each stream event carries only what is new: optionally a suffix of the last
/// part (more `text`, or a `report` suffix with an empty title), then whole new
/// parts. Investigation plans are replaced in place by newer revisions.
public enum ContentMerge {
    public static func append(_ next: [ContentField], to previous: [ContentField])
        -> [ContentField]
    {
        guard let first = next.first else { return previous }
        guard let last = previous.last else { return latestPlans(next) }
        var merged = previous
        switch (last, first) {
        case (.text(let existing), .text(let suffix)):
            merged[merged.count - 1] = .text(existing + suffix)
            merged.append(contentsOf: next.dropFirst())
        case (.report(let title, let existing), .report("", let suffix)):
            merged[merged.count - 1] = .report(title: title, markdown: existing + suffix)
            merged.append(contentsOf: next.dropFirst())
        default:
            merged.append(contentsOf: next)
        }
        return latestPlans(merged)
    }

    /// Keeps one part per investigation plan, at its first position, holding
    /// the highest revision seen. Stored messages need this too, because every
    /// plan revision is kept as its own part.
    public static func latestPlans(_ fields: [ContentField]) -> [ContentField] {
        var indexByPlan: [String: Int] = [:]
        var result: [ContentField] = []
        result.reserveCapacity(fields.count)
        for field in fields {
            guard case .investigationPlan(let plan) = field else {
                result.append(field)
                continue
            }
            if let index = indexByPlan[plan.planID] {
                if case .investigationPlan(let current) = result[index],
                    plan.revision > current.revision
                {
                    result[index] = field
                }
            } else {
                indexByPlan[plan.planID] = result.count
                result.append(field)
            }
        }
        return result
    }
}
