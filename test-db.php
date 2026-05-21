<?php

try {
    $pdo = new PDO(
        "mysql:host=127.0.0.1;port=3306;dbname=studyflow;charset=utf8mb4",
        "root",
        "",
        [
            PDO::ATTR_TIMEOUT => 3,
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]
    );

    echo "DB OK" . PHP_EOL;
} catch (Throwable $e) {
    echo "DB ERROR: " . $e->getMessage() . PHP_EOL;
}
