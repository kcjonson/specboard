-- Add system_prompt column to projects for per-project AI instructions
ALTER TABLE projects ADD COLUMN system_prompt TEXT DEFAULT NULL;
