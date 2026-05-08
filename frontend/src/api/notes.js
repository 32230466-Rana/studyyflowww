import axiosClient from './axiosClient';

export function createNote({ title, description, file, textContent }) {
  const formData = new FormData();

  formData.append('title', title);

  if (description?.trim()) {
    formData.append('description', description.trim());
  }

  if (file) {
    formData.append('file', file);
  }

  if (textContent?.trim()) {
    formData.append('text_content', textContent.trim());
  }

  return axiosClient.post('/notes', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function summarizeNote(noteId, mode) {
  const noteRes = await axiosClient.get(`/notes/${noteId}`);
  const text = noteRes.data?.content || noteRes.data?.text || "";

  const response = await fetch("http://127.0.0.1:8002/conversation", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      human_input: text,
    }),
  });

  const data = await response.json();

  return {
    data: {
      summary: data.output,
    },
  };
}
