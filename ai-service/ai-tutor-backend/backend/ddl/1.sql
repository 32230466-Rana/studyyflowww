CREATE TABLE documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255),
    author VARCHAR(255),
    file_type VARCHAR(50),
    document_hash VARCHAR(255) UNIQUE,
    meta JSON,
    INDEX idx_documents_id (id)
);
