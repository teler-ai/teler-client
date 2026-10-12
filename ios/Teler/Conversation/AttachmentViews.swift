import PhotosUI
import SwiftUI
import TelerFeatures
import TelerKit
import UniformTypeIdentifiers

/// One file in the composer: waiting to upload, uploading, being read by
/// Teler, ready, or failed with why.
struct AttachmentChip: Identifiable, Equatable {
    enum Status: Equatable {
        case waiting
        case uploading(Double)
        case processing(Double?)
        case ready
        case failed(String, retryable: Bool)
    }

    let id: UUID
    let name: String
    let size: Int64
    let isImage: Bool
    let status: Status

    init(id: UUID, name: String, size: Int64, isImage: Bool, status: Status) {
        self.id = id
        self.name = name
        self.size = size
        self.isImage = isImage
        self.status = status
    }

    init(_ attachment: Attachment) {
        let status: Status =
            switch attachment.state {
            case .uploading(let fraction): .uploading(fraction)
            case .processing(let percentage): .processing(percentage)
            case .ready: .ready
            case .failed(let failure): .failed(Self.message(failure), retryable: Self.isRetryable(failure))
            }
        self.init(id: attachment.id, name: attachment.name, size: attachment.size, isImage: attachment.isImage, status: status)
    }

    private static func isRetryable(_ failure: Attachment.Failure) -> Bool {
        switch failure {
        case .refused, .needsChoice, .quota: false
        case .unreadable(let code): code == "upload_expired" || code == "upload_interrupted"
        case .problem: true
        }
    }

    static func message(_ failure: Attachment.Failure) -> String {
        switch failure {
        case .refused(.legacyExcel): String(localized: "Save it as .xlsx: Teler doesn't read old .xls files.")
        case .refused(.unsupported): String(localized: "Teler can't read this kind of file.")
        case .refused(.empty): String(localized: "This file is empty.")
        case .refused(.tooLarge(let limit)):
            String(localized: "Larger than \(limit.formatted(.byteCount(style: .file))).")
        case .quota: String(localized: "Your storage is full. Free up space in Data on the web.")
        case .needsChoice: String(localized: "Some files in this archive need a choice on the web.")
        case .unreadable(let code):
            switch code {
            case "unsupported_format", "non_tabular": String(localized: "Teler can't read this kind of file.")
            case "corrupt_file": String(localized: "The file looks damaged.")
            case "encrypted_file", "protected_file": String(localized: "The file is password-protected.")
            case "upload_expired", "upload_interrupted": String(localized: "The upload stopped. Try again.")
            default: String(localized: "Teler couldn't read this file.")
            }
        case .problem(let problem): problem.message
        }
    }
}

/// The composer's files, side by side, each removable.
struct AttachmentChips: View {
    let chips: [AttachmentChip]
    let remove: (UUID) -> Void
    var retry: (UUID) -> Void = { _ in }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(chips) { chip in
                    chipView(chip)
                }
            }
            .padding(.horizontal, 12)
        }
        .scrollIndicators(.hidden)
    }

    private func chipView(_ chip: AttachmentChip) -> some View {
        HStack(spacing: 8) {
            icon(chip).frame(width: 22, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(chip.name)
                    .font(.footnote.weight(.semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(detail(chip))
                    .font(.caption)
                    .foregroundStyle(isFailed(chip) ? Palette.destructiveInk : Palette.mutedForeground)
                    .lineLimit(2)
            }
            .frame(maxWidth: 190, alignment: .leading)
            if case .failed(_, true) = chip.status {
                Button("Retry") { retry(chip.id) }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.glass)
            }
            Button {
                remove(chip.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Palette.mutedForeground)
                    .frame(width: 28, height: 28)
                    .background(Palette.fill, in: .circle)
            }
            .frame(width: 44, height: 44)
            .accessibilityLabel(isWorking(chip) ? "Cancel upload of \(chip.name)" : "Remove \(chip.name)")
        }
        .foregroundStyle(Palette.foreground)
        .padding(.leading, 10)
        .frame(minHeight: 48)
        .background(Palette.card, in: .rect(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14).strokeBorder(isFailed(chip) ? Palette.destructiveInk : Palette.border))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func icon(_ chip: AttachmentChip) -> some View {
        switch chip.status {
        case .uploading(let fraction):
            ProgressView(value: fraction).progressViewStyle(.circular).tint(Palette.primaryInk)
        case .processing:
            ProgressView().controlSize(.small)
        case .failed:
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.destructiveInk)
        case .waiting, .ready:
            Image(systemName: chip.isImage ? "photo" : "doc").foregroundStyle(Palette.mutedForeground)
        }
    }

    private func detail(_ chip: AttachmentChip) -> String {
        switch chip.status {
        case .waiting, .ready: chip.size.formatted(.byteCount(style: .file))
        case .uploading(let fraction):
            String(localized: "Uploading · \(fraction.formatted(.percent.precision(.fractionLength(0))))")
        case .processing(let percentage?):
            String(localized: "Reading · \((percentage / 100).formatted(.percent.precision(.fractionLength(0))))")
        case .processing(nil): String(localized: "Reading…")
        case .failed(let message, _): message
        }
    }

    private func isFailed(_ chip: AttachmentChip) -> Bool {
        if case .failed = chip.status { true } else { false }
    }

    private func isWorking(_ chip: AttachmentChip) -> Bool {
        switch chip.status {
        case .uploading, .processing: true
        default: false
        }
    }
}

/// "Add to your question": Files, Photos or Camera, as three large targets.
struct AttachSheet: View {
    let add: ([PickedFile]) -> Void
    @State private var importsFiles = false
    @State private var photo: PhotosPickerItem?
    @State private var takesPhoto = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    tile("Files", systemImage: "folder") { importsFiles = true }
                    PhotosPicker(selection: $photo, matching: .images, photoLibrary: .shared()) {
                        AttachTileLabel(title: "Photos", systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(.plain)
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        tile("Camera", systemImage: "camera") { takesPhoto = true }
                    }
                }
                Text("Data files, documents and images. Documents and images up to 50 MB, data files up to 10 GB.")
                    .font(.footnote)
                    .foregroundStyle(Palette.mutedForeground)
                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("Add to your question")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark", role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.height(280)])
        .fileImporter(isPresented: $importsFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            finish(urls.compactMap(PickedFiles.copy))
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let file = PickedFiles.photo(data) {
                    finish([file])
                }
            }
        }
        .fullScreenCover(isPresented: $takesPhoto) {
            CameraPicker { image in
                if let data = image.jpegData(compressionQuality: 0.9), let file = PickedFiles.photo(data) { finish([file]) }
            }
            .ignoresSafeArea()
        }
    }

    private func finish(_ files: [PickedFile]) {
        add(files)
        dismiss()
    }

    private func tile(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { AttachTileLabel(title: title, systemImage: systemImage) }
            .buttonStyle(.plain)
    }
}

/// One of the attachment sheet's three large targets.
private struct AttachTileLabel: View {
    nonisolated let title: String
    nonisolated let systemImage: String

    /// Nonisolated so the photo picker's label can make it.
    nonisolated init(title: String, systemImage: String) {
        self.title = title
        self.systemImage = systemImage
    }

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage).font(.title2)
            Text(LocalizedStringKey(title)).font(.subheadline.weight(.semibold))
        }
        .foregroundStyle(Palette.foreground)
        .frame(maxWidth: .infinity, minHeight: 88)
        .background(Palette.card, in: .rect(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Palette.border))
        .contentShape(.rect(cornerRadius: 16))
    }
}

/// Picked files, copied into the app's temporary folder so they can be read
/// for as long as the upload takes.
enum PickedFiles {
    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("attachments", isDirectory: true)
    }

    /// Deletes the app's copy of a picked file; files elsewhere are left alone.
    static func discard(_ file: PickedFile) {
        let copy = file.url.deletingLastPathComponent()
        guard copy.deletingLastPathComponent().standardizedFileURL == folder.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: copy)
    }

    static func copy(_ url: URL) -> PickedFile? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let folder = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let destination = folder.appendingPathComponent(url.lastPathComponent)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: url, to: destination)
        } catch {
            return nil
        }
        let values = try? destination.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
        return PickedFile(
            url: destination, name: url.lastPathComponent, size: Int64(values?.fileSize ?? 0),
            contentType: values?.contentType?.preferredMIMEType)
    }

    /// A photo, as a JPEG, since Teler reads JPEG, PNG and WebP but not HEIC.
    static func photo(_ data: Data) -> PickedFile? {
        guard let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.9) else { return nil }
        let folder = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let name = "Photo \(formatter.string(from: .now)).jpg"
        let destination = folder.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try jpeg.write(to: destination)
        } catch {
            return nil
        }
        return PickedFile(url: destination, name: name, size: Int64(jpeg.count), contentType: "image/jpeg")
    }
}

/// The system camera, for one photo.
struct CameraPicker: UIViewControllerRepresentable {
    let take: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage { parent.take(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
