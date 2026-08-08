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
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";
import * as FileSystem from "expo-file-system";
import { BACKEND_URL } from "../config";

export default function VoiceScreen({ navigation }) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("Say \"Night\" or tap the microphone to begin.");
  const [assistantReply, setAssistantReply] = useState("");
  
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Animation refs for pulsing soundwave effect
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;

  // Pulse animation loops
  useEffect(() => {
    if (isListening) {
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
              toValue: 2.2,
              duration: 1800,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim2, {
              toValue: 1.0,
              duration: 1800,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ])
      ).start();
    } else {
      pulseAnim1.setValue(1);
      pulseAnim2.setValue(1);
    }
  }, [isListening]);

  // Initialize audio configuration and clean up resources on unmount
  useEffect(() => {
    const initAudio = async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });
      } catch (err) {
        console.log("Error initializing audio mode:", err);
      }
    };
    initAudio();

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = async () => {
    Speech.stop();
  };

  const startRecording = async () => {
    try {
      // Stop any active speech output
      Speech.stop();

      // Request microphone permissions
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setTranscript("Microphone permission is required to talk to Night.");
        return;
      }

      setIsListening(true);
      setTranscript("Listening...");
      setAssistantReply("");

      // Start recording
      await recorder.prepareToRecordAsync();
      await recorder.record();
    } catch (err) {
      console.error("Failed to start recording:", err);
      setIsListening(false);
      setTranscript("Failed to access microphone. Please try again.");
    }
  };

  const stopRecording = async () => {
    if (!recorder.isRecording) return;

    setIsListening(false);
    setIsProcessing(true);
    setTranscript("Processing audio...");

    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        setTranscript("No audio captured.");
        setIsProcessing(false);
        return;
      }

      // Upload and process audio file
      await processAudioFile(uri);
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setTranscript("Failed to stop recording. Please try again.");
      setIsProcessing(false);
    }
  };

  const processAudioFile = async (uri) => {
    try {
      const formData = new FormData();
      const fileUriParts = uri.split("/");
      const fileName = fileUriParts[fileUriParts.length - 1];

      // Detect correct mime type
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

      // Construct application context
      const contextObj = {
        local_time: new Date().toString(),
        current_screen: "VoiceScreen",
      };
      formData.append("context", JSON.stringify(contextObj));

      // POST file to backend
      const response = await fetch(`${BACKEND_URL}/api/v1/process-audio`, {
        method: "POST",
        body: formData,
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      setTranscript(data.query || "No speech detected.");
      setAssistantReply(data.reply || "No response received.");

      // Synthesize sound playback
      if (data.audio_base64) {
        await playBase64Audio(data.audio_base64);
      } else {
        // Fallback to Native Speech
        Speech.speak(data.reply, {
          pitch: 1.0,
          rate: 1.0,
        });
      }
    } catch (err) {
      console.error("Audio processing failed:", err);
      setTranscript("Connection failure.");
      setAssistantReply("I could not reach the backend. Please check that the server is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  const playBase64Audio = async (base64String) => {
    try {
      const tempFile = `${FileSystem.cacheDirectory}response.mp3`;
      await FileSystem.writeAsStringAsync(tempFile, base64String, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const player = createAudioPlayer({ uri: tempFile });
      player.play();

      const subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) {
          player.release();
          subscription.remove();
        }
      });


    } catch (err) {
      console.error("Failed to play synthesized audio:", err);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
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
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>ONLINE</Text>
        </View>
      </View>

      {/* Main HUD Display */}
      <ScrollView contentContainerStyle={styles.hudContainer}>
        <View style={styles.visualizerContainer}>
          {isListening && (
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
            onPress={toggleListening}
            disabled={isProcessing}
            style={[
              styles.micButton,
              isListening ? styles.micActive : isProcessing ? styles.micProcessing : styles.micInactive,
            ]}
          >
            <View style={styles.micInner}>
              <Text style={styles.micIconText}>
                {isProcessing ? "⏳" : "🎤"}
              </Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.listeningText}>
            {isListening ? "LISTENING" : isProcessing ? "PROCESSING" : "STANDBY"}
          </Text>
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
    color: "#FFFFFF",
    fontWeight: "bold",
    letterSpacing: 1,
  },
  hudContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  visualizerContainer: {
    height: 300,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 20,
  },
  pulseRing: {
    position: "absolute",
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#6366F1",
  },
  micButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#6366F1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  micInactive: {
    backgroundColor: "#6366F1",
  },
  micActive: {
    backgroundColor: "#06B6D4",
  },
  micProcessing: {
    backgroundColor: "#EAB308",
  },
  micInner: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: "#0D0E15",
    justifyContent: "center",
    alignItems: "center",
  },
  micIconText: {
    fontSize: 48,
  },
  listeningText: {
    color: "#A5B4FC",
    fontWeight: "bold",
    fontSize: 12,
    letterSpacing: 3,
    marginTop: 25,
  },
  feedContainer: {
    width: "100%",
    gap: 16,
  },
  glassCard: {
    width: "100%",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  assistantCard: {
    borderColor: "rgba(99, 102, 241, 0.2)",
    backgroundColor: "rgba(99, 102, 241, 0.03)",
  },
  cardHeader: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "bold",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  assistantHeader: {
    fontSize: 10,
    color: "#6366F1",
    fontWeight: "bold",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  cardText: {
    fontSize: 15,
    color: "#E5E7EB",
    lineHeight: 22,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.05)",
    paddingVertical: 14,
    backgroundColor: "#0B0C10",
  },
  navButton: {
    alignItems: "center",
    padding: 8,
  },
  navButtonIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  navButtonText: {
    fontSize: 10,
    color: "#9CA3AF",
    fontWeight: "600",
  },
});

