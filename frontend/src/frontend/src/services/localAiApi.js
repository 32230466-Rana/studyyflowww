const API_BASE_URL = "http://127.0.0.1:8000/api/local-ai";

export async function summarizeText(inputText) {
  const response = await fetch(`${API_BASE_URL}/summary/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text: inputText,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || data.error || "Failed to summarize text");
  }

  return data;
}

export async function summarizeFile(file) {
  const formData = new FormData();
  formData.append("uploaded_file", file);

  const response = await fetch(`${API_BASE_URL}/summary/file`, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || data.error || "Failed to summarize file");
  }

  return data;
}