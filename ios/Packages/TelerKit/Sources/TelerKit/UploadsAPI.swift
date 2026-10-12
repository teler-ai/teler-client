import Foundation

/// The files Teler accepts and how large each may be, as the web checks them
/// before an upload (`packages/contracts/src/upload-preflight.ts`).
public enum UploadRules {
    public enum Kind: Sendable, Hashable {
        case data
        case document
        case image
        case archive
    }

    static let mebibyte: Int64 = 1024 * 1024
    static let gibibyte: Int64 = 1024 * mebibyte

    /// The kind of file a name is, or nil when Teler doesn't take it.
    public static func kind(of name: String) -> Kind? {
        let lowered = name.lowercased()
        if lowered.hasSuffix(".tar.gz") { return .archive }
        switch (lowered as NSString).pathExtension {
        case "csv", "tsv", "json", "jsonl", "ndjson", "parquet", "xlsx", "xlsm", "fit", "gpx", "tcx", "kml":
            return .data
        case "pdf", "docx", "txt", "md", "rtf", "html", "htm": return .document
        case "jpg", "jpeg", "png", "webp": return .image
        case "zip", "kmz", "tgz": return .archive
        default: return nil
        }
    }

    public static func limit(for kind: Kind) -> Int64 {
        switch kind {
        case .document, .image: 50 * mebibyte
        case .data, .archive: 10 * gibibyte
        }
    }

    public enum Refusal: Sendable, Hashable {
        /// Old Excel files: save them as .xlsx.
        case legacyExcel
        case unsupported
        case empty
        case tooLarge(limit: Int64)
    }

    /// Why a file can't be uploaded, or nil when it can.
    public static func refusal(name: String, size: Int64) -> Refusal? {
        if (name.lowercased() as NSString).pathExtension == "xls" { return .legacyExcel }
        guard let kind = kind(of: name) else { return .unsupported }
        if size <= 0 { return .empty }
        let limit = limit(for: kind)
        return size > limit ? .tooLarge(limit: limit) : nil
    }
}

/// An upload the server has prepared: the file goes up in parts of `partSize` bytes.
public struct UploadPlan: Sendable, Hashable {
    public let jobID: String
    public let partSize: Int
    public let partCount: Int
}

/// Where an upload stands once its parts are sent: queued, then processed
/// into one or more documents (`packages/contracts/src/file-processing.ts`).
public struct UploadStatus: Sendable, Hashable {
    public enum State: String, Sendable, Hashable {
        case uploading, queued, processing
        /// An archive with files Teler needs a choice for; that's made on the web.
        case awaitingInput = "awaiting_input"
        case completed
        case partialSuccess = "partial_success"
        case failed
    }

    public let state: State
    /// Such as `unsupported_format`, `corrupt_file`, `encrypted_file` or `quota_exceeded`.
    public let errorCode: String?
    /// How far processing is, from 0 to 100, when the processor knows.
    public let percentage: Double?
    /// The documents it made.
    public let documentIDs: [String]

    public var isFinished: Bool { [.completed, .partialSuccess, .failed].contains(state) }
}

/// A document an upload made, and how a turn points Teler at it: a ready
/// table by its reference, any other file by its path.
public struct UploadedDocument: Sendable, Hashable {
    public let id: String
    public let name: String
    public let isImage: Bool
    /// A ready table's reference, such as `personal.orders_csv`.
    public let tableReference: String?
    /// The file's path, such as `/personal/chats/chat_…/orders.csv`.
    public let path: String
}

/// What a turn sends about its attachments: which tables and files Teler may
/// read, and the chips the message shows.
public struct TurnAttachments: Sendable, Hashable {
    public var tables: [String] = []
    public var files: [String] = []
    public var references: [FileReference] = []

    public init() {}

    public var isEmpty: Bool { references.isEmpty }

    public mutating func add(_ document: UploadedDocument, shownAs name: String) {
        if let table = document.tableReference { tables.append(table) } else { files.append(document.path) }
        references.append(FileReference(documentId: document.id, name: name, preview: document.isImage ? "image" : "file"))
    }
}

public struct FileReference: Sendable, Hashable, Encodable {
    public var type = "file_reference"
    public let documentId: String
    public let name: String
    /// `image` or `file`.
    public let preview: String
}

extension TelerAPIClient {
    /// Prepares an upload into the chat's own folder, as the web does. The
    /// same `requestID` for the same file is a retry, not a second upload.
    public func startUpload(
        name: String, size: Int64, contentType: String?, chat: ChatID, organization: OrganizationID,
        requestID: String
    ) async throws -> UploadPlan {
        struct Body: Encodable {
            let clientRequestId: String
            let organizationId: String
            let filename: String
            let sizeBytes: Int64
            let destinationPath: String
            let scope = "personal"
            let contentType: String
        }
        struct Plan: Decodable {
            let jobId: String
            let partSizeBytes: Int
            let partCount: Int
        }
        let body = try Self.encode(
            Body(
                clientRequestId: requestID, organizationId: organization.rawValue, filename: name, sizeBytes: size,
                destinationPath: "/personal/chats/\(chat.rawValue)",
                contentType: contentType ?? "application/octet-stream"))
        let plan = try await json(Plan.self, .post, "/api/uploads", body: body)
        guard plan.partSizeBytes > 0, plan.partCount > 0 else { throw TelerAPIError.invalidResponse }
        return UploadPlan(jobID: try Self.pathComponent(plan.jobId), partSize: plan.partSizeBytes, partCount: plan.partCount)
    }

    /// Sends part `number`, counted from 1, as raw bytes.
    public func uploadPart(_ data: Data, number: Int, of job: String) async throws {
        _ = try await send(
            .put, "/api/uploads/\(try Self.pathComponent(job))/parts/\(number)",
            headers: ["Content-Type": "application/octet-stream"], body: data
        ).collectBody(limit: Self.maximumErrorBody)
    }

    /// Tells the server the upload is still alive; it gives up after two minutes without one.
    public func heartbeat(_ job: String) async throws {
        _ = try await send(.post, "/api/uploads/\(try Self.pathComponent(job))/heartbeat")
            .collectBody(limit: Self.maximumErrorBody)
    }

    public func completeUpload(_ job: String) async throws {
        _ = try await send(.post, "/api/uploads/\(try Self.pathComponent(job))/complete", body: Data("{}".utf8))
            .collectBody(limit: Self.maximumErrorBody)
    }

    public func cancelUpload(_ job: String) async throws {
        _ = try await send(.delete, "/api/uploads/\(try Self.pathComponent(job))")
            .collectBody(limit: Self.maximumErrorBody)
    }

    public func uploadStatus(_ job: String) async throws -> UploadStatus {
        let status = try await json(JSONValue.self, .get, "/api/uploads/\(try Self.pathComponent(job))")
        guard let state = status["status"]?.stringValue.flatMap(UploadStatus.State.init(rawValue:)) else {
            throw TelerAPIError.invalidResponse
        }
        let documents = (status["outputs"]?.arrayValue ?? []).compactMap { output -> String? in
            guard output["status"]?.stringValue == "completed" else { return nil }
            return output["documentId"]?.stringValue
        }
        return UploadStatus(
            state: state, errorCode: status["errorCode"]?.stringValue,
            percentage: status["processing"]?["percentage"]?.doubleValue, documentIDs: documents)
    }

    public func uploadedDocument(_ id: String) async throws -> UploadedDocument {
        let document = try await json(JSONValue.self, .get, "/api/documents/\(try Self.pathComponent(id))")
        guard let name = document["name"]?.stringValue, let scope = document["scope"]?.stringValue,
            let path = document["path"]?.stringValue
        else { throw TelerAPIError.invalidResponse }
        let table = document["table"]
        let ready = table?["ingestStatus"]?.stringValue == "ready"
        let lowered = name.lowercased()
        let image = document["type"]?.stringValue == "image"
            && [".jpg", ".jpeg", ".png", ".webp"].contains { lowered.hasSuffix($0) }
        return UploadedDocument(
            id: id, name: name, isImage: image, tableReference: ready ? table?["sourceRef"]?.stringValue : nil,
            path: "/\(scope)/\(path.drop { $0 == "/" })")
    }
}
