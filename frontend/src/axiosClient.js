import axios from "axios";

const axiosClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api",
    withCredentials: true,
    headers: {
        Accept: "application/json",
    },
});

axiosClient.interceptors.request.use((config) => {
    const token =
        localStorage.getItem("ACCESS_TOKEN") ||
        localStorage.getItem("token") ||
        localStorage.getItem("auth_token");

    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    if (config.data instanceof FormData) {
        delete config.headers["Content-Type"];
    } else {
        config.headers["Content-Type"] = "application/json";
    }

    return config;
});

export default axiosClient;