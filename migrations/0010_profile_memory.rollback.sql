DELETE FROM counselle.workspace_changes
WHERE object_type IN ('profile', 'document', 'memory');

DROP TABLE counselle.memories;
DROP TABLE counselle.documents;
DROP TABLE counselle.profiles;
