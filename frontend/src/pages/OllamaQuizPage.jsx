import { useEffect } from "react";

export default function OllamaQuizPage() {
  useEffect(() => {
    window.location.href = "http://localhost:8504";
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "22px",
        fontWeight: "700",
      }}
    >
      Opening Quiz Generator...
    </div>
  );
}