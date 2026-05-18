import axiosClient from "../api/axiosClient";
export async function getAiConversations(noteId = null) {
  const params = {};

  if (noteId) {
    params.note_id = noteId;
  }

  const response = await axiosClient.get("/ai/conversations", { params });
  return response.data;
}

export async function createAiConversation({ title = "New chat", note_id = null } = {}) {
  const response = await axiosClient.post("/ai/conversations", {
    title,
    note_id,
  });

  return response.data;
}

export async function getAiConversation(uuid) {
  const response = await axiosClient.get(`/ai/conversations/${uuid}`);
  return response.data;
}

export async function getAiConversationMessages(uuid, page = 1) {
  const response = await axiosClient.get(`/ai/conversations/${uuid}/messages`, {
    params: { page },
  });

  return response.data;
}

export async function saveAiConversationMessage(uuid, { role, content, metadata = null }) {
  const response = await axiosClient.post(`/ai/conversations/${uuid}/messages`, {
    role,
    content,
    metadata,
  });

  return response.data;
}

export async function updateAiConversationSummary(uuid, summary) {
  const response = await axiosClient.patch(`/ai/conversations/${uuid}/summary`, {
    summary,
  });

  return response.data;
}

export async function deleteAiConversation(uuid) {
  const response = await axiosClient.delete(`/ai/conversations/${uuid}`);
  return response.data;
}