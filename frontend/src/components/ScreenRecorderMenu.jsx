import { useEffect, useRef, useState } from "react";

export default function ScreenRecorderMenu() {
  const menuRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const startRecording = async () => {
    try {
      setVideoUrl("");
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      let mediaRecorder;

      if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp9",
        });
      } else if (MediaRecorder.isTypeSupported("video/webm")) {
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: "video/webm",
        });
      } else {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: "video/webm",
        });

        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setRecording(false);

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setRecording(true);
      setOpen(false);
    } catch (error) {
      console.error("Screen recording failed:", error);
      setRecording(false);
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }

    setRecording(false);
  };

  const downloadRecording = () => {
    if (!videoUrl) return;

    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `studyflow-recording-${Date.now()}.webm`;
    link.click();
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{
          border: "1px solid #d1d5db",
          background: "#ffffff",
          color: "#111827",
          borderRadius: "12px",
          padding: "10px 14px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        🎥 Recorder
      </button>

      {recording && (
        <button
          type="button"
          onClick={stopRecording}
          style={{
            border: "none",
            background: "#ef4444",
            color: "#ffffff",
            borderRadius: "12px",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Stop
        </button>
      )}

      {videoUrl && (
        <button
          type="button"
          onClick={downloadRecording}
          style={{
            border: "none",
            background: "#10b981",
            color: "#ffffff",
            borderRadius: "12px",
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Download
        </button>
      )}

      {open && (
        <div
          style={{
            position: "absolute",
            top: "48px",
            right: 0,
            width: "240px",
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "16px",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.16)",
            padding: "12px",
            zIndex: 50,
          }}
        >
          <button
            type="button"
            onClick={startRecording}
            disabled={recording}
            style={{
              width: "100%",
              border: "none",
              background: recording ? "#9ca3af" : "#4f46e5",
              color: "#ffffff",
              borderRadius: "12px",
              padding: "10px 12px",
              fontWeight: 700,
              cursor: recording ? "not-allowed" : "pointer",
            }}
          >
            Start Screen Recording
          </button>

          <p
            style={{
              margin: "10px 0 0",
              fontSize: "12px",
              color: "#6b7280",
              lineHeight: 1.5,
            }}
          >
            Choose a screen, window, or tab. Stop recording when finished.
          </p>
        </div>
      )}
    </div>
  );
}