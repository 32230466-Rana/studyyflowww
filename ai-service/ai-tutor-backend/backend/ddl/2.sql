CREATE TABLE chapters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id INT,
    chapter_title VARCHAR(255),
    content TEXT,
    chapter_hash VARCHAR(255) UNIQUE,
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    INDEX idx_chapters_document_id (document_id)
);
