import React, { useState } from "react";
import axiosClient from "../api/axiosClient";

const LinkSummaryPage = () => {
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [summary, setSummary] = useState(null);

    const handleGenerateSummary = async (e) => {
        e.preventDefault();
        if (!url) {
            setError("Please enter a URL");
            return;
        }

        setLoading(true);
        setError("");
        setSummary(null);

        try {
            const response = await axiosClient.post("/ai/link-summary", {
                url,
            });
            setSummary(response.data);
        } catch (err) {
            console.error("Error fetching link summary:", err);
            setError(
                err.response?.data?.message ||
                    "Failed to generate summary. Please try again."
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-6 text-indigo-700">
                Link Summary
            </h1>
            <p className="text-gray-600 mb-8">
                Paste any article or webpage URL below to get a concise
                AI-generated summary.
            </p>

            <form onSubmit={handleGenerateSummary} className="mb-10">
                <div className="flex flex-col md:flex-row gap-4">
                    <input
                        type="url"
                        placeholder="https://example.com/article"
                        className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className={`px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors ${
                            loading ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                    >
                        {loading ? "Processing..." : "Generate Summary"}
                    </button>
                </div>
                {error && (
                    <p className="mt-3 text-red-600 font-medium">{error}</p>
                )}
            </form>

            {loading && (
                <div className="flex flex-col items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                    <p className="text-gray-500">
                        Reading webpage and extracting key points...
                    </p>
                </div>
            )}

            {summary && (
                <div className="bg-white rounded-xl shadow-md p-8 animate-fade-in border border-gray-100">
                    <h2 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">
                        Summary Result
                    </h2>
                    <div className="prose max-w-none text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {summary.summary}
                    </div>
                    <div className="mt-6 flex gap-4 text-sm text-gray-400 border-t pt-4">
                        <span>Time: {summary.processing_time_seconds}s</span>
                        {summary.transcript_source && (
                            <span>
                                Source used:{" "}
                                <span className="font-semibold text-gray-500">
                                    {summary.transcript_source}
                                </span>
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LinkSummaryPage;
