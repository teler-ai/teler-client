# Teler for iOS

A native SwiftUI client for Teler, iOS 26 and later. It talks to Teler's
public HTTP API like the CLI does.

You sign in with your Teler email and password (and two-factor code, if your
account uses one), or explore sample chats offline. Chats, streamed answers,
investigation plans and reports are native; message parts the app cannot show
yet are marked and link to the same chat on the web.

## Build

On a Mac with Xcode 26 or later and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```bash
ios/scripts/build.sh          # generate the project and build for the simulator
ios/scripts/build.sh --run    # also launch it in a simulator and save a screenshot
open ios/Teler.xcodeproj      # after a build, to work in Xcode
```

The networking and parsing package builds anywhere Swift 6 runs:

```bash
swift test --package-path ios/Packages/TelerKit
```
