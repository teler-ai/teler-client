import Foundation
import Observation
import TelerKit

/// A file picked to attach, copied where the app can read it while it uploads.
public struct PickedFile: Sendable, Hashable {
    public let url: URL
    public let name: String
    public let size: Int64
    public let contentType: String?

    public init(url: URL, name: String, size: Int64, contentType: String?) {
        self.url = url
        self.name = name
        self.size = size
        self.contentType = contentType
    }
}

/// A file on its way into the member's next question.
public struct Attachment: Identifiable, Sendable, Equatable {
    public enum State: Sendable, Equatable {
        /// Sending the file's parts.
        case uploading(Double)
        /// Teler is reading the file; a percentage when the processor knows.
        case processing(Double?)
        case ready
        case failed(Failure)
    }

    public enum Failure: Sendable, Equatable {
        case refused(UploadRules.Refusal)
        /// The member's storage is full.
        case quota
        /// Teler couldn't read it: unsupported, damaged, protected or encrypted.
        case unreadable(String?)
        /// An archive with files Teler needs a choice for, which is made on the web.
        case needsChoice
        case problem(Problem)
    }

    public let id: UUID
    public let name: String
    public let size: Int64
    public internal(set) var state: State
    var documents: [UploadedDocument] = []
    let file: PickedFile

    public var isImage: Bool { UploadRules.kind(of: name) == .image }
}

extension Attachment.Failure: Error {}

/// The files attached to the member's next question: each uploads into the
/// chat's folder in parts, as the web uploads them, then waits while Teler
/// processes it. The question can go once every file is ready.
@MainActor @Observable
public final class AttachmentTray {
    public private(set) var items: [Attachment] = []
    private var tasks: [UUID: Task<Void, Never>] = [:]
    private let client: TelerAPIClient
    private let chat: ChatID
    private var organization: OrganizationID?
    /// How long to wait between status checks while Teler processes a file.
    var pollInterval = Duration.seconds(3)
    /// Deletes the app's copy of a file once it's no longer needed: uploaded,
    /// refused or removed.
    public var discard: (PickedFile) -> Void = { _ in }

    public init(client: TelerAPIClient, chat: ChatID) {
        self.client = client
        self.chat = chat
    }

    /// Files are still uploading or being processed.
    public var isBusy: Bool {
        items.contains { item in
            switch item.state {
            case .uploading, .processing: true
            case .ready, .failed: false
            }
        }
    }

    public var hasFailures: Bool {
        items.contains { if case .failed = $0.state { true } else { false } }
    }

    /// What the next turn sends for the ready files.
    public var turn: TurnAttachments {
        var turn = TurnAttachments()
        for item in items where item.state == .ready {
            for document in item.documents { turn.add(document, shownAs: item.name) }
        }
        return turn
    }

    public func add(_ file: PickedFile) {
        let refusal = UploadRules.refusal(name: file.name, size: file.size)
        let item = Attachment(
            id: UUID(), name: file.name, size: file.size,
            state: refusal.map { .failed(.refused($0)) } ?? .uploading(0), file: file)
        items.append(item)
        if refusal == nil { start(item) } else { discard(file) }
    }

    public func retry(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }), case .failed(let failure) = item.state else { return }
        if case .refused = failure { return }
        update(id) { $0.state = .uploading(0) }
        start(item)
    }

    /// Takes a file off the question, stopping its upload.
    public func remove(_ id: UUID) {
        tasks[id]?.cancel()
        tasks[id] = nil
        if let item = items.first(where: { $0.id == id }) { discard(item.file) }
        items.removeAll { $0.id == id }
    }

    /// After the question went: the files now belong to that message.
    public func clear() {
        items.removeAll()
    }

    /// Waits until no file is uploading or being processed.
    public func settle() async {
        for task in tasks.values { await task.value }
    }

    private func start(_ item: Attachment) {
        tasks[item.id] = Task { [weak self] in
            await self?.upload(item)
            self?.tasks[item.id] = nil
        }
    }

    private func update(_ id: UUID, _ change: (inout Attachment) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }

    private func upload(_ item: Attachment) async {
        do {
            if organization == nil { organization = try await client.activeOrganization() }
            guard let organization else { throw Problem.noOrganization }
            let plan = try await startUpload(item, in: organization)
            let heartbeat = Task { [client] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(20))
                    if !Task.isCancelled { try? await client.heartbeat(plan.jobID) }
                }
            }
            do {
                try await sendParts(item, plan)
                heartbeat.cancel()
            } catch {
                heartbeat.cancel()
                if error is CancellationError { try? await client.cancelUpload(plan.jobID) }
                throw error
            }
            try await client.completeUpload(plan.jobID)
            update(item.id) { $0.state = .processing(nil) }
            try await waitForDocuments(item, job: plan.jobID)
        } catch is CancellationError {
            return
        } catch let failure as Attachment.Failure {
            update(item.id) { $0.state = .failed(failure) }
        } catch TelerAPIError.http(413, _, _) {
            update(item.id) { $0.state = .failed(.quota) }
        } catch TelerAPIError.http(400, "FORMAT_UNSUPPORTED"?, _) {
            update(item.id) { $0.state = .failed(.refused(.unsupported)) }
        } catch {
            update(item.id) { $0.state = .failed(.problem(Problem(error))) }
        }
    }

    /// Starts the upload. A file with the same name already in the chat keeps
    /// both, as "name (2).csv", and setup still in progress is waited out.
    private func startUpload(_ item: Attachment, in organization: OrganizationID) async throws -> UploadPlan {
        var name = Self.safeName(item.name)
        var copy = 1
        for attempt in 0..<6 {
            do {
                return try await client.startUpload(
                    name: name, size: item.size, contentType: item.file.contentType, chat: chat,
                    organization: organization, requestID: "ios-\(item.id.uuidString.lowercased())-\(attempt)")
            } catch TelerAPIError.http(409, "PATH_CONFLICT"?, _) {
                copy += 1
                name = Self.numbered(Self.safeName(item.name), copy)
            } catch TelerAPIError.http(409, "UPLOAD_SETUP_IN_PROGRESS"?, let wait) {
                try await Task.sleep(for: wait ?? .seconds(2))
            }
        }
        throw Attachment.Failure.problem(.other)
    }

    private func sendParts(_ item: Attachment, _ plan: UploadPlan) async throws {
        let handle = try FileHandle(forReadingFrom: item.file.url)
        defer { try? handle.close() }
        for part in 1...plan.partCount {
            try Task.checkCancellation()
            try handle.seek(toOffset: UInt64(part - 1) * UInt64(plan.partSize))
            let data = try handle.read(upToCount: plan.partSize) ?? Data()
            try await withRetries { [client] in try await client.uploadPart(data, number: part, of: plan.jobID) }
            update(item.id) { $0.state = .uploading(Double(part) / Double(plan.partCount)) }
        }
    }

    /// Like the web, a part is tried again after a busy or failed server, up to three times.
    private func withRetries(_ attempt: () async throws -> Void) async throws {
        for tries in 1...4 {
            do {
                return try await attempt()
            } catch TelerAPIError.http(let status, let code, let wait)
                where tries < 4 && (status == 429 || status >= 500 || code == "PART_BUSY" || code == "PART_LEASE_LOST")
            {
                try await Task.sleep(for: wait ?? .milliseconds(250 * tries))
            } catch TelerAPIError.network where tries < 4 {
                try await Task.sleep(for: .seconds(tries))
            }
        }
    }

    private func waitForDocuments(_ item: Attachment, job: String) async throws {
        while true {
            let status = try await client.uploadStatus(job)
            switch status.state {
            case .completed, .partialSuccess:
                guard !status.documentIDs.isEmpty else { throw Attachment.Failure.unreadable(status.errorCode) }
                var documents: [UploadedDocument] = []
                for id in status.documentIDs { documents.append(try await client.uploadedDocument(id)) }
                update(item.id) {
                    $0.documents = documents
                    $0.state = .ready
                }
                discard(item.file)
                return
            case .failed:
                throw status.errorCode == "quota_exceeded" ? Attachment.Failure.quota : .unreadable(status.errorCode)
            case .awaitingInput:
                throw Attachment.Failure.needsChoice
            case .uploading, .queued, .processing:
                update(item.id) { $0.state = .processing(status.percentage) }
                try await Task.sleep(for: pollInterval)
            }
        }
    }

    /// A name the server takes: no path separators or control characters,
    /// no surrounding spaces, at most 200 characters.
    static func safeName(_ name: String) -> String {
        let cleaned = String(
            name.unicodeScalars.map { scalar -> Character in
                "/\\:".unicodeScalars.contains(scalar) || CharacterSet.controlCharacters.contains(scalar)
                    ? "-" : Character(scalar)
            }
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "file" : String(cleaned.suffix(200))
    }

    /// "orders.csv" becomes "orders (2).csv"; "data.tar.gz" becomes "data (2).tar.gz".
    static func numbered(_ name: String, _ copy: Int) -> String {
        let pathExtension = (name as NSString).pathExtension
        let suffix =
            name.lowercased().hasSuffix(".tar.gz") ? String(name.suffix(7))
            : pathExtension.isEmpty ? "" : "." + pathExtension
        let stem = String(name.dropLast(suffix.count))
        return "\(stem) (\(copy))\(suffix)"
    }
}
