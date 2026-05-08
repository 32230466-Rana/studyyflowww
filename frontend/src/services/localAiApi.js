const API_BASE_URL = "http://127.0.0.1:8000/api/local-ai";

function getAuthHeaders(json = false) {
    const token =
        localStorage.getItem("token") ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("access_token");

    const headers = {
        Accept: "application/json",
    };

    if (json) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}

export async function summarizeText(inputText) {
    const response = await fetch(`${API_BASE_URL}/summary/text`, {
        method: "POST",
        headers: getAuthHeaders(true),
        credentials: "include",
        body: JSON.stringify({
            text: inputText,
            title: "Quick Summary",
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
    formData.append("title", `Summary of ${file.name}`);

    const response = await fetch(`${API_BASE_URL}/summary/file`, {
        method: "POST",
        headers: getAuthHeaders(false),
        credentials: "include",
        body: formData,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || "Failed to summarize file");
    }

    return data;
}