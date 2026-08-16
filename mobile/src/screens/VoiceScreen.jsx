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
import * as FileSystem from "expo-file-system";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { BACKEND_URL } from "../config";

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

  useEffect(() => {
    engineStateRef.current = engineState;
  }, [engineState]);

  // On-Device Speech Recognition Event Listener (Apple Native SFSpeechRecognizer)
  useSpeechRecognitionEvent("result", (event) => {
    if (engineStateRef.current !== EngineState.STATE_1_PASSIVE) return;
    const lastResult = event.results[event.results.length - 1];
    if (lastResult && lastResult.transcript) {
      const text = lastResult.transcript.toLowerCase();
      console.log("Local On-Device Speech:", text);
      if (text.includes("night") || text.includes("knight") || text.includes("nite")) {
        // ON-DEVICE WAKE WORD DETECTED! 0 KB NETWORK DATA, 0 GEMINI API CALLS!
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch (e) {}
        enterState2_Collecting();
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (engineStateRef.current === EngineState.STATE_1_PASSIVE) {
      // If local speech recognizer encounters a quiet pause, restart it smoothly
      setTimeout(enterState1_Passive, 1000);
    }
  });

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
  // STATE 1: PASSIVE WAKE-WORD LISTENER (Apple On-Device Local SFSpeechRecognizer)
  // =========================================================================
  const enterState1_Passive = async () => {
    clearStateTimer();
    setEngineState(EngineState.STATE_1_PASSIVE);
    setStatusLabel("LISTENING FOR 'NIGHT' (LOCAL)");
    setTranscript("Listening for 'Night'...");

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        playThroughEarpiece: false,
      });

      Speech.stop();

      // Request and start Apple Native On-Device Speech Recognition
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (result.granted) {
        ExpoSpeechRecognitionModule.start({
          lang: "en-US",
          interimResults: true,
          requiresOnDeviceRecognition: true, // 100% OFFLINE ON-DEVICE! 0 NETWORK CALLS!
        });
      } else {
        // Fallback to local audio recorder sampling if permission not granted
        await recorder.prepareToRecordAsync();
        await recorder.record();
        stateTimerRef.current = setTimeout(processState1_FallbackSample, 5000);
      }
    } catch (err) {
      console.log("State 1 Local Recognizer Error, using fallback:", err);
      try {
        await recorder.prepareToRecordAsync();
        await recorder.record();
        stateTimerRef.current = setTimeout(processState1_FallbackSample, 5000);
      } catch (e) {
        stateTimerRef.current = setTimeout(enterState1_Passive, 2000);
      }
    }
  };

  const processState1_FallbackSample = async () => {
    try {
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
      const fileInfo = await FileSystem.getInfoAsync(uri);
      if (!fileInfo.exists || fileInfo.size < 10000) {
        setTimeout(enterState1_Passive, 1000);
        return;
      }
      const data = await uploadAudioToBackend(uri);
      if (!data || data.wake_word_detected === false || !data.query) {
        setTimeout(enterState1_Passive, 1000);
        return;
      }
      setTranscript(data.query);
      if (data.reply && data.reply.trim().length > 0) {
        pendingResponseRef.current = data;
        enterState3_Ack(data);
      } else {
        enterState2_Collecting();
      }
    } catch (err) {
      setTimeout(enterState1_Passive, 2000);
    }
  };

  // =========================================================================
  // STATE 2: ACTIVE COMMAND COLLECTION
  // =========================================================================
  const enterState2_Collecting = async () => {
    clearStateTimer();
    setEngineState(EngineState.STATE_2_COLLECTING);
    setStatusLabel("SAY YOUR COMMAND...");
    setTranscript("Listening for command...");
    setAssistantReply("Yes? I'm listening...");

    try {
      // Stop local wake-word speech recognizer to record high-quality command audio
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {}

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        playThroughEarpiece: false,
      });

      Speech.speak("Yes?", { pitch: 1.0, rate: 1.1, volume: 1.0 });

      await recorder.prepareToRecordAsync();
      await recorder.record();

      // Collect user command for 4.5 seconds
      stateTimerRef.current = setTimeout(async () => {
        if (engineStateRef.current !== EngineState.STATE_2_COLLECTING) return;
        await processState2_Command();
      }, 4500);
    } catch (err) {
      console.log("State 2 Error:", err);
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

      const data = await uploadAudioToBackend(uri);
      if (data && data.query) {
        setTranscript(data.query);
      }

      if (data && data.reply) {
        pendingResponseRef.current = data;
        enterState3_Ack(data);
      } else {
        enterState5_Resetting();
      }
    } catch (err) {
      console.log("State 2 Processing Error:", err);
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
  // HELPER: Upload Audio to Backend
  // =========================================================================
  const uploadAudioToBackend = async (uri) => {
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

      const response = await fetch(`${BACKEND_URL}/api/v1/process-audio`, {
        method: "POST",
        body: formData,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.log("Upload Audio Error:", err);
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
