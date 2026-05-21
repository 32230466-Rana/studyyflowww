import axios from "axios";

const axiosClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api",
    timeout: 30000,
    withCredentials: false,
    headers: {
        Accept: "application/json",
    },
});

axiosClient.interceptors.request.use(
    (config) => {
        const token =
            localStorage.getItem("authToken") ||
            localStorage.getItem("token") ||
            localStorage.getItem("access_token");

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        if (config.data instanceof FormData) {
            delete config.headers["Content-Type"];
        } else {
            config.headers["Content-Type"] = "application/json";
        }

        console.log("REQUEST:", {
            url: config.url,
            method: config.method,
            hasToken: Boolean(token),
            tokenStart: token ? token.slice(0, 10) : null,
        });

        return config;
    },
    (error) => Promise.reject(error)
);

axiosClient.interceptors.response.use(
    (response) => response,
    (error) => {
        console.log("API ERROR:", {
            status: error.response?.status,
            url: error.config?.url,
            method: error.config?.method,
            data: error.response?.data,
            authHeader: error.config?.headers?.Authorization,
        });

        return Promise.reject(error);
    }
);

export default axiosClient;