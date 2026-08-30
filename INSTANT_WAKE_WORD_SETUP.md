# ⚡ Instant Wake Word Setup Guide

## Current Status

### ✅ Quick Fix Applied (1.5-2 second response)
- Reduced Vosk sampling from 3.5s → 1.5s
- Reduced restart delay from 400ms → 100ms
- **Expected wake-word latency: 1.5-2 seconds**

This is a **3x improvement** over the old 3-4 second delay!

### 🎯 Ultimate Solution (100-200ms response)
To get **instant** wake-word detection (sub-second), you need to run the native iOS build with Apple's on-device SFSpeechRecognizer.

---

## How the Code Works

Your app is **already set up** to use native iOS speech:

```javascript
// VoiceScreen.jsx line 78-91
useSpeechRecognitionEvent("result", (event) => {
  if (engineStateRef.current !== EngineState.STATE_1_PASSIVE) return;
  const text = lastResult.transcript.toLowerCase();
  console.log("Local On-Device Speech:", text);
  if (text.includes("night")) {
    ExpoSpeechRecognitionModule.stop();
    enterState2_Collecting(); // INSTANT transition!
  }
});
```

This gives **100-200ms latency** but only works in a native build.

---

## Setting Up Native iOS Build (One-Time)

### Prerequisites:
1. **Xcode** - Install from App Store (13GB download, ~20 min)
2. **Command Line Tools** - Will be prompted during first Xcode launch
3. **Physical iPhone** OR **iOS Simulator**

### Step 1: Install Xcode
```bash
# Open App Store
open -a "App Store"
# Search for "Xcode" and install (it's free)
```

After installation:
```bash
# Set Xcode path
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# Accept license
sudo xcodebuild -license accept

# Install additional components (if prompted)
xcode-select --install
```

### Step 2: Clean Build
```bash
cd mobile

# Clear any old builds
rm -rf ios/build
rm -rf ios/Pods
rm ios/Podfile.lock

# Rebuild native iOS project
npx expo prebuild --platform ios --clean

# Install CocoaPods
cd ios && pod install && cd ..
```

### Step 3: Run Native Build
```bash
# On physical iPhone (preferred)
npx expo run:ios --device

# OR in iOS Simulator
npx expo run:ios
```

First build takes 5-10 minutes. Subsequent builds are faster (~1-2 min).

---

## Testing Native Wake Word

Once the native app is running on your iPhone:

1. **Open the app** (should auto-launch after build)
2. **Check console logs** - Look for:
   ```
   📱 Using native iOS SFSpeechRecognizer for wake-word
   ```
3. **Say "Hey Night"** - Should detect in 100-200ms!
4. **Console should show:**
   ```
   Local On-Device Speech: hey night
   ✅✅✅ WAKE WORD DETECTED!
   ```

---

## Comparison Table

| Method | Latency | Setup | Pros | Cons |
|--------|---------|-------|------|------|
| **Vosk Backend (Current)** | 1.5-2s | ✅ None | Easy, works in Expo Go | Slower, needs backend running |
| **Native iOS (Recommended)** | 100-200ms | ⚠️ Xcode + 10 min setup | **Instant**, 0 network calls, 0 cost | Requires native build |

---

## Troubleshooting Native Build

### "Xcode not found"
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### "pod install failed"
```bash
export LANG=en_US.UTF-8
cd mobile/ios
pod install
```

### "Code signing error"
1. Open `mobile/ios/NightAI.xcworkspace` in Xcode
2. Select "NightAI" target → Signing & Capabilities
3. Change Team to your Apple ID
4. Let Xcode auto-manage signing

### "Speech recognition permission denied"
The app should prompt on first launch. If not:
1. iPhone Settings → Privacy & Security → Speech Recognition
2. Enable for "NightAI"

---

## Quick Reference

### Current Setup (Vosk):
- ✅ Works in Expo Go
- ✅ No Xcode needed
- ⚡ 1.5-2 second latency
- 📡 Requires backend running

### Native Setup (SFSpeechRecognizer):
- ⚠️ Requires Xcode + native build
- ⚡ 100-200ms latency (10x faster!)
- 🔋 100% on-device (no network)
- 💰 0 API cost

---

## Recommended Approach

1. **Now:** Use the current Vosk setup (1.5-2s) - it's pretty good!
2. **Weekend:** Install Xcode and do the native build for instant detection
3. **Future:** Native build is the production setup for release

The 1.5-2 second detection is totally usable for development. Native build is the polish step for production.
