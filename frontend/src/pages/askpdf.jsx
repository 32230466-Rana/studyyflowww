import React, { useRef, useState } from "react";
import axios from "axios";
import ChatMessage, { TypingIndicator } from "../components/ChatMessage";

export default function Askpdf() {
  const fileInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedPdf, setUploadedPdf] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Please upload a PDF file only.");
      return;
    }

    setError("");
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please choose a PDF first.");
      return;
    }

    try {
      setUploading(true);
      setError("");

      const formData = new FormData();
      formData.append("pdf", selectedFile);

      const response = await axios.post(
        "http://127.0.0.1:8000/api/ask-pdf/upload",
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        }
      );

      setUploadedPdf(response.data.pdf);
      setMessages([
        {
          role: "system",
          content: `PDF uploaded successfully: ${response.data.pdf.original_name}`,
        },
      ]);
    } catch (err) {
      setError(
        err?.response?.data?.message || "Failed to upload and process PDF."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    if (asking) return;

    if (!uploadedPdf) {
      setError("Please upload a PDF first.");
      return;
    }

    const currentQuestion = question.trim();

    if (!currentQuestion) {
      setError("Please write a question first.");
      return;
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: currentQuestion },
    ]);

    setQuestion("");
    setAsking(true);
    setError("");

    try {
      const response = await axios.post(
        "http://127.0.0.1:8000/api/ask-pdf/ask",
        {
          pdf_id: uploadedPdf.id,
          question: currentQuestion,
        }
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.data.answer,
        },
      ]);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to generate answer.");
    } finally {
      setAsking(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!asking) {
        handleAsk();
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 md:px-8">
      <div className="mx-auto flex max-w-6xl gap-6">
        <aside className="hidden w-72 rounded-2xl bg-white p-4 shadow md:block">
          <h2 className="mb-4 text-lg font-semibold text-gray-800">Ask PDF</h2>

          <button
            type="button"
            onClick={handleChooseFile}
            className="mb-3 w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Choose PDF
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />

          {selectedFile && (
            <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              <span className="block font-medium">Selected file:</span>
              <span className="break-all">{selectedFile.name}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !selectedFile}
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload & Process"}
          </button>

          {uploadedPdf && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              Ready: {uploadedPdf.original_name}
            </div>
          )}
        </aside>

        <main className="flex min-h-[80vh] flex-1 flex-col rounded-2xl bg-white shadow">
          <div className="border-b px-5 py-4">
            <h1 className="text-xl font-semibold text-gray-900">Chat with PDF</h1>
            <p className="mt-1 text-sm text-gray-500">
              Upload a PDF, then ask questions about its content.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-gray-400">
                <div>
                  <p className="text-lg font-medium">
                    Ask a question about this note/PDF and I’ll answer using its content.
                  </p>
                  <p className="mt-2 text-sm">Upload a PDF to get started.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`max-w-3xl rounded-2xl px-4 py-3 text-sm leading-6 ${
                      message.role === "user"
                        ? "ml-auto bg-black text-white"
                        : message.role === "assistant"
                        ? "bg-gray-100 text-gray-900"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {message.content}
                  </div>
                ))}

                {asking && (
                  <div className="max-w-3xl rounded-2xl bg-gray-100 px-4 py-3 text-sm text-gray-600">
                    Generating answer...
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t px-5 py-4">
            {error && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {!uploadedPdf && (
              <div className="mb-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
                Please upload a PDF first.
              </div>
            )}

            <div className="flex items-end gap-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                placeholder="Ask something about your PDF..."
                disabled={!uploadedPdf || asking}
                className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
              />

              <button
                type="button"
                onClick={handleAsk}
                disabled={!uploadedPdf || asking || !question.trim()}
                className="rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {asking ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}