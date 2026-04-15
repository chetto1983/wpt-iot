-- Phase 38: flip target_host to nullable, clear the 'localhost' sentinel
-- sacchi's row (192.168.0.10) is preserved — only the literal 'localhost' sentinel is NULLed.
ALTER TABLE plc_config
  ALTER COLUMN target_host DROP NOT NULL,
  ALTER COLUMN target_host DROP DEFAULT;

UPDATE plc_config
  SET target_host = NULL
  WHERE target_host = 'localhost';
