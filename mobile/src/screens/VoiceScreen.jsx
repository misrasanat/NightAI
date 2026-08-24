import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  Easing,
  ScrollView,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system/legacy";
import { BACKEND_URL } from "../config";
let ExpoSpeechRecognitionModule = null;
let useSpeechRecognitionEvent = () => {};

try {
  const speechMod = require("expo-speech-recognition");
  if (speechMod && speechMod.ExpoSpeechRecognitionModule) {
    ExpoSpeechRecognitionModule = speechMod.ExpoSpeechRecognitionModule;
  }
  if (speechMod && speechMod.useSpeechRecognitionEvent) {
    useSpeechRecognitionEvent = speechMod.useSpeechRecognitionEvent;
  }
} catch (e) {
  console.log("ExpoSpeechRecognition native module not bundled in current runtime.");
}

const ACK_PHRASES = [
  "On it!",
  "Gotcha, give me a sec...",
  "Right on it!",
  "Working on that...",
  "Got it!",
  "Processing that now...",
  "Sure thing, one second...",
  "All over it!",
];

const EngineState = {
  STATE_1_PASSIVE: "STATE_1_PASSIVE",           // Listening 24/7 for "Night" / "Hey Night" (On-Device Local)
  STATE_2_COLLECTING: "STATE_2_COLLECTING",       // Active command collection
  STATE_3_ACK: "STATE_3_ACK",                     // Instant verbal ACK ("On it!", "Gotcha")
  STATE_4_DELIVERING: "STATE_4_DELIVERING",       // Delivering assistant response
  STATE_5_RESETTING: "STATE_5_RESETTING",         // Reset & return to State 1
};

export default function VoiceScreen({ navigation }) {
  const [engineState, setEngineState] = useState(EngineState.STATE_1_PASSIVE);
  const [transcript, setTranscript] = useState("Listening for 'Night'...");
  const [assistantReply, setAssistantReply] = useState("");
  const [statusLabel, setStatusLabel] = useState("LISTENING FOR 'NIGHT'");

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const engineStateRef = useRef(engineState);
  const stateTimerRef = useRef(null);
  const pendingResponseRef = useRef(null);
  const isProcessingApiCallRef = useRef(false); // Prevent concurrent API calls
  const lastApiCallTimeRef = useRef(0); // Track last API call timestamp

  const isNativeSpeechAvailable = !!(ExpoSpeechRecognitionModule && ExpoSpeechRecognitionModule.start);

  useEffect(() => {
    engineStateRef.current = engineState;
  }, [engineState]);

  // On-Device Speech Recognition Event Listener (Apple Native SFSpeechRecognizer)
  try {
    useSpeechRecognitionEvent("result", (event) => {
      if (engineStateRef.current !== EngineState.STATE_1_PASSIVE) return;
      const lastResult = event?.results?.[event.results.length - 1];
      if (lastResult && lastResult.transcript) {
        const text = lastResult.transcript.toLowerCase();
        console.log("Local On-Device Speech:", text);
        if (text.includes("night") || text.includes("knight") || text.includes("nite")) {
          try {
            ExpoSpeechRecognitionModule.stop();
          } catch (e) {}
          enterState2_Collecting();
        }
      }
    });

    useSpeechRecognitionEvent("error", (event) => {
      if (engineStateRef.current === EngineState.STATE_1_PASSIVE) {
        setTimeout(enterState1_Passive, 1000);
      }
    });
  } catch (e) {}

  // Animation refs for pulsing soundwave effect
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const isPulsing =
      engineState === EngineState.STATE_1_PASSIVE ||
      engineState === EngineState.STATE_2_COLLECTING;

    if (isPulsing) {
      Animated.loop(
        Animated.parallel([
          Animated.sequence([
            Animated.timing(pulseAnim1, {
              toValue: 1.6,
              duration: 1200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim1, {
              toValue: 1.0,
              duration: 1200,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(pulseAnim2, {
              toValue: 2.0,
              duration: 1200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim2, {
              toValue: 1.0,
              duration: 1200,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ])
      ).start();
    } else {
      pulseAnim1.setValue(1.0);
      pulseAnim2.setValue(1.0);
    }
  }, [engineState]);

  // Start 5-State Machine on Mount
  useEffect(() => {
    let mounted = true;
    const startMachine = async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setTranscript("Microphone permission is required.");
        return;
      }
      if (mounted) {
        enterState1_Passive();
      }
    };

    startMachine();

    return () => {
      mounted = false;
      clearStateTimer();
      Speech.stop();
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {}
    };
  }, []);

  const clearStateTimer = () => {
    if (stateTimerRef.current) {
      clearTimeout(stateTimerRef.current);
      stateTimerRef.current = null;
    }
  };

  // =========================================================================
  // STATE 1: PASSIVE WAKE-WORD LISTENER (100% Pure Apple On-Device SFSpeechRecognizer)
  // =========================================================================
  const enterState1_Passive = async () => {
    clearStateTimer();
    setEngineState(EngineState.STATE_1_PASSIVE);
    setStatusLabel("👂 LISTENING FOR 'NIGHT'");
    setTranscript("Say 'Night' or 'Hey Night' to activate...");

    console.log("🟢 STATE 1: Passive wake-word listening active");

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        playThroughEarpiece: false,
      });

      Speech.stop();

      // Check if native Siri speech recognizer is available
      if (isNativeSpeechAvailable) {
        console.log("📱 Using native iOS SFSpeechRecognizer for wake-word");
        const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (result.granted) {
          ExpoSpeechRecognitionModule.start({
            lang: "en-US",
            interimResults: true,
            requiresOnDeviceRecognition: true,
          });
          return;
        } else {
          console.log("⚠️ Speech recognition permission denied, falling back to Vosk");
        }
      } else {
        console.log("📡 Native speech unavailable, using Vosk backend for wake-word");
      }

      // Hands-Free Audio Listener (0 Gemini API calls - Uses Local Mac Vosk Engine)
      await recorder.prepareToRecordAsync();
      await recorder.record();

      stateTimerRef.current = setTimeout(processState1_LocalWakeWordSample, 3500);
    } catch (err) {
      console.log("State 1 Error:", err);
      stateTimerRef.current = setTimeout(enterState1_Passive, 2000);
    }
  };

  const processState1_LocalWakeWordSample = async () => {
    try {
      if (engineStateRef.current !== EngineState.STATE_1_PASSIVE) return;

      if (!recorder.isRecording) {
        enterState1_Passive();
        return;
      }

      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        enterState1_Passive();
        return;
      }

      // Local Silence Filter: Skip tiny files (<1KB) locally to save bandwidth
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || fileInfo.size < 1000) {
        setTimeout(enterState1_Passive, 400);
        return;
      }

      // POST to Local Vosk Wake-Word Endpoint (0 Gemini API calls!)
      console.log("📡 Sending to local Vosk wake-word endpoint (no Gemini API)");
      const data = await uploadAudioToWakeWordEndpoint(uri);

      if (!data || data.wake_word_detected === false) {
        // No wake word spoken -> Continue listening hands-free
        console.log("❌ No wake word detected, transcript:", data?.transcript || "none");
        setTimeout(enterState1_Passive, 400);
        return;
      }

      // 0-GEMINI HANDS-FREE WAKE WORD DETECTED!
      console.log("✅✅✅ WAKE WORD DETECTED! Transcript:", data.transcript);
      console.log("🚀 Transitioning to State 2 (Command Collection)");
      setTranscript(data.transcript || "Hey Night");

      // Go to State 2 to collect command
      enterState2_Collecting();
    } catch (err) {
      console.log("Local Wake-Word Processing Error:", err);
      setTimeout(enterState1_Passive, 2000);
    }
  };

  const uploadAudioToWakeWordEndpoint = async (uri) => {
    try {
      const formData = new FormData();
      const fileUriParts = uri.split("/");
      const fileName = fileUriParts[fileUriParts.length - 1];

      let mimeType = "audio/m4a";
      if (fileName.endsWith(".wav")) mimeType = "audio/wav";
      else if (fileName.endsWith(".caf")) mimeType = "audio/caf";
      else if (fileName.endsWith(".mp4")) mimeType = "audio/mp4";
      else if (fileName.endsWith(".mp3")) mimeType = "audio/mp3";

      formData.append("audio", {
        uri: uri,
        name: fileName,
        type: mimeType,
      });

      const response = await fetch(`${BACKEND_URL}/api/v1/detect-wake-word`, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.log("Wake-Word Endpoint Error:", err);
      return null;
    }
  };

  // =========================================================================
  // STATE 2: ACTIVE COMMAND COLLECTION
  // =========================================================================
  const enterState2_Collecting = async () => {
    clearStateTimer();
    setEngineState(EngineState.STATE_2_COLLECTING);
    setStatusLabel("🎤 SAY YOUR COMMAND NOW");
    setTranscript("👂 I'm listening - speak your command...");
    setAssistantReply("");

    console.log("🎤 STATE 2: Wake word detected! Entering command collection mode");

    try {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {}

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        playThroughEarpiece: false,
      });

      // Speak "Yes?" and ONLY start recording AFTER speech completes to prevent audio overlap
      Speech.speak("Yes?", {
        pitch: 1.0,
        rate: 1.1,
        volume: 1.0,
        onDone: startRecordingUserCommand,
        onStopped: startRecordingUserCommand,
      });

      // Safety timeout if Speech.speak onDone doesn't fire
      stateTimerRef.current = setTimeout(() => {
        if (engineStateRef.current === EngineState.STATE_2_COLLECTING && !recorder.isRecording) {
          startRecordingUserCommand();
        }
      }, 1200);
    } catch (err) {
      console.log("State 2 Error:", err);
      enterState5_Resetting();
    }
  };

  const startRecordingUserCommand = async () => {
    try {
      if (engineStateRef.current !== EngineState.STATE_2_COLLECTING) return;
      if (recorder.isRecording) return;

      await recorder.prepareToRecordAsync();
      await recorder.record();

      console.log("🔴 Recording started - speak your command now!");

      // Collect user command for 3 seconds (reduced from 4.5s for faster response)
      stateTimerRef.current = setTimeout(async () => {
        if (engineStateRef.current !== EngineState.STATE_2_COLLECTING) return;
        console.log("⏱️ Recording time expired, processing command...");
        await processState2_Command();
      }, 3000);
    } catch (e) {
      console.log("Error starting command recording:", e);
      enterState5_Resetting();
    }
  };

  const processState2_Command = async () => {
    try {
      if (!recorder.isRecording) {
        enterState5_Resetting();
        return;
      }

      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        enterState5_Resetting();
        return;
      }

      // Check audio file size locally before sending 1 single request
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || fileInfo.size < 1500) {
        // No command spoken (silent) -> Reset cleanly without making API call
        enterState5_Resetting();
        return;
      }

      // SAFEGUARD: Prevent concurrent API calls (critical for avoiding quota spam)
      if (isProcessingApiCallRef.current) {
        console.log("⚠️ API call already in progress, skipping duplicate");
        enterState5_Resetting();
        return;
      }

      // SAFEGUARD: Rate limit - minimum 2 seconds between Gemini API calls
      const now = Date.now();
      const timeSinceLastCall = now - lastApiCallTimeRef.current;
      if (timeSinceLastCall < 2000) {
        console.log(`⚠️ Rate limit: Only ${timeSinceLastCall}ms since last call, skipping`);
        enterState5_Resetting();
        return;
      }

      isProcessingApiCallRef.current = true;
      lastApiCallTimeRef.current = now;
      console.log("✅ Sending audio to Gemini API...");

      const data = await uploadAudioToBackend(uri);

      // Always clear the processing flag after API call completes
      isProcessingApiCallRef.current = false;

      if (data && data.query) {
        setTranscript(data.query);
      }

      // Check if Gemini returned silence/unclear markers
      const transcript = data?.query || "";
      const isSilence = transcript.includes("[SILENCE]") ||
                       transcript.includes("[UNCLEAR]") ||
                       transcript.includes("[INAUDIBLE]") ||
                       transcript.trim().length === 0;

      if (isSilence) {
        console.log("🔇 No clear speech detected, resetting...");
        setTranscript("I didn't catch that. Try again?");
        setTimeout(enterState5_Resetting, 1500);
        return;
      }

      if (data && data.reply && data.reply.trim().length > 0) {
        pendingResponseRef.current = data;
        enterState3_Ack(data);
      } else {
        enterState5_Resetting();
      }
    } catch (err) {
      console.log("State 2 Processing Error:", err);
      isProcessingApiCallRef.current = false; // Clear flag on error
      enterState5_Resetting();
    }
  };

  // =========================================================================
  // STATE 3: INSTANT VERBAL ACKNOWLEDGEMENT
  // =========================================================================
  const enterState3_Ack = async (responseData) => {
    clearStateTimer();
    setEngineState(EngineState.STATE_3_ACK);
    setStatusLabel("PROCESSING...");

    const randomAck = ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)];
    setAssistantReply(randomAck);

    try {
      Speech.speak(randomAck, {
        pitch: 1.0,
        rate: 1.1,
        volume: 1.0,
        onDone: () => enterState4_Delivering(responseData),
        onStopped: () => enterState4_Delivering(responseData),
      });

      stateTimerRef.current = setTimeout(() => {
        if (engineStateRef.current === EngineState.STATE_3_ACK) {
          enterState4_Delivering(responseData);
        }
      }, 2000);
    } catch (err) {
      console.log("State 3 ACK Error:", err);
      enterState4_Delivering(responseData);
    }
  };

  // =========================================================================
  // STATE 4: DELIVER RESPONSE
  // =========================================================================
  const enterState4_Delivering = async (responseData) => {
    clearStateTimer();
    setEngineState(EngineState.STATE_4_DELIVERING);
    setStatusLabel("NIGHTAI RESPONDING");

    const replyText = responseData?.reply || "Done.";
    setAssistantReply(replyText);

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        playThroughEarpiece: false,
      });

      if (responseData?.audio_base64) {
        await playBase64Audio(responseData.audio_base64);
      } else {
        Speech.speak(replyText, {
          pitch: 1.0,
          rate: 1.0,
          volume: 1.0,
          onDone: () => enterState5_Resetting(),
          onStopped: () => enterState5_Resetting(),
        });

        stateTimerRef.current = setTimeout(() => {
          if (engineStateRef.current === EngineState.STATE_4_DELIVERING) {
            enterState5_Resetting();
          }
        }, 8000);
      }
    } catch (err) {
      console.log("State 4 Error:", err);
      enterState5_Resetting();
    }
  };

  // =========================================================================
  // STATE 5: RESET & RETURN TO STATE 1
  // =========================================================================
  const enterState5_Resetting = async () => {
    clearStateTimer();
    setEngineState(EngineState.STATE_5_RESETTING);
    setStatusLabel("RESETTING...");
    pendingResponseRef.current = null;

    try {
      Speech.stop();
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {}

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        playThroughEarpiece: false,
      });
    } catch (err) {
      console.log("State 5 Reset Error:", err);
    }

    stateTimerRef.current = setTimeout(() => {
      enterState1_Passive();
    }, 1000);
  };

  // =========================================================================
  // HELPER: Upload Audio to Backend (USES GEMINI API - MUST BE RATE LIMITED)
  // =========================================================================
  const uploadAudioToBackend = async (uri) => {
    const startTime = Date.now();
    try {
      const formData = new FormData();
      const fileUriParts = uri.split("/");
      const fileName = fileUriParts[fileUriParts.length - 1];

      let mimeType = "audio/m4a";
      if (fileName.endsWith(".wav")) mimeType = "audio/wav";
      else if (fileName.endsWith(".caf")) mimeType = "audio/caf";
      else if (fileName.endsWith(".mp4")) mimeType = "audio/mp4";
      else if (fileName.endsWith(".mp3")) mimeType = "audio/mp3";

      formData.append("audio", {
        uri: uri,
        name: fileName,
        type: mimeType,
      });

      const contextObj = {
        local_time: new Date().toString(),
        current_screen: "VoiceScreen",
      };
      formData.append("context", JSON.stringify(contextObj));

      console.log(`🚀 GEMINI API CALL: Uploading ${fileName} to /api/v1/process-audio`);

      const response = await fetch(`${BACKEND_URL}/api/v1/process-audio`, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      const duration = Date.now() - startTime;
      console.log(`✅ GEMINI API RESPONSE: ${response.status} (${duration}ms)`);

      if (!response.ok) {
        console.error(`❌ API Error: ${response.status} ${response.statusText}`);
        return null;
      }
      return await response.json();
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`❌ Upload Audio Error after ${duration}ms:`, err);
      return null;
    }
  };

  const playBase64Audio = async (base64String) => {
    try {
      const tempFile = `${FileSystem.cacheDirectory}response.mp3`;
      await FileSystem.writeAsStringAsync(tempFile, base64String, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const player = createAudioPlayer({ uri: tempFile });
      player.volume = 1.0;
      player.play();

      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          player.release();
          subscription.remove();
          enterState5_Resetting();
        }
      });
    } catch (err) {
      console.error("Failed to play synthesized audio:", err);
      enterState5_Resetting();
    }
  };

  // Manual Trigger Button
  const handleManualMicPress = () => {
    if (engineState === EngineState.STATE_1_PASSIVE) {
      enterState2_Collecting();
    } else {
      enterState5_Resetting();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>NightAI</Text>
          <Text style={styles.appSubtitle}>PERSONAL OPERATING SYSTEM</Text>
        </View>
        <View style={styles.statusIndicator}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  engineState === EngineState.STATE_1_PASSIVE
                    ? "#10B981"
                    : engineState === EngineState.STATE_2_COLLECTING
                    ? "#EF4444"
                    : "#6366F1",
              },
            ]}
          />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>

      {/* Main HUD Display */}
      <ScrollView contentContainerStyle={styles.hudContainer}>
        <View style={styles.visualizerContainer}>
          {(engineState === EngineState.STATE_1_PASSIVE ||
            engineState === EngineState.STATE_2_COLLECTING) && (
            <>
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseAnim2 }], opacity: 0.15 },
                ]}
              />
              <Animated.View
                style={[
                  styles.pulseRing,
                  { transform: [{ scale: pulseAnim1 }], opacity: 0.3 },
                ]}
              />
            </>
          )}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleManualMicPress}
            style={[
              styles.micButton,
              engineState === EngineState.STATE_2_COLLECTING
                ? styles.micActive
                : engineState === EngineState.STATE_3_ACK ||
                  engineState === EngineState.STATE_4_DELIVERING
                ? styles.micProcessing
                : styles.micInactive,
            ]}
          >
            <View style={styles.micInner}>
              <Text style={styles.micIconText}>
                {engineState === EngineState.STATE_3_ACK ||
                engineState === EngineState.STATE_4_DELIVERING
                  ? "⏳"
                  : "🎤"}
              </Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.listeningText}>{statusLabel}</Text>
        </View>

        <View style={styles.feedContainer}>
          <View style={styles.glassCard}>
            <Text style={styles.cardHeader}>YOU</Text>
            <Text style={styles.cardText}>{transcript}</Text>
          </View>

          {assistantReply !== "" && (
            <View style={[styles.glassCard, styles.assistantCard]}>
              <Text style={styles.assistantHeader}>NIGHT</Text>
              <Text style={styles.cardText}>{assistantReply}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          onPress={() => navigation.navigate("Settings")}
          style={styles.navButton}
        >
          <Text style={styles.navButtonIcon}>⚙️</Text>
          <Text style={styles.navButtonText}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navButton}>
          <Text style={styles.navButtonIcon}>🧩</Text>
          <Text style={styles.navButtonText}>Agents</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D0E15",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 10,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  appSubtitle: {
    fontSize: 9,
    color: "#6366F1",
    fontWeight: "600",
    letterSpacing: 1.5,
    marginTop: 2,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.2)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
    marginRight: 6,
  },
  statusText: {
    fontSize: 10,
    color: "#E5E7EB",
    fontWeight: "600",
    letterSpacing: 1,
  },
  hudContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 20,
  },
  visualizerContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 20,
    height: 200,
    width: 200,
  },
  pulseRing: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#6366F1",
  },
  micButton: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    elevation: 8,
    shadowColor: "#6366F1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  micInactive: {
    backgroundColor: "#4F46E5",
  },
  micActive: {
    backgroundColor: "#EF4444",
  },
  micProcessing: {
    backgroundColor: "#F59E0B",
  },
  micInner: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(13, 14, 21, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  micIconText: {
    fontSize: 32,
  },
  listeningText: {
    marginTop: 24,
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 2,
  },
  feedContainer: {
    width: "100%",
    marginTop: 20,
  },
  glassCard: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  assistantCard: {
    borderColor: "rgba(99, 102, 241, 0.3)",
    backgroundColor: "rgba(99, 102, 241, 0.05)",
  },
  cardHeader: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6B7280",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  assistantHeader: {
    fontSize: 10,
    fontWeight: "800",
    color: "#6366F1",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  cardText: {
    fontSize: 15,
    color: "#E5E7EB",
    lineHeight: 22,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
    backgroundColor: "#0D0E15",
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navButtonIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  navButtonText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "600",
  },
});
