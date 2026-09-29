WITH candidates AS (
  SELECT
    id,
    album_id,
    replace(shortcut, 'Ctrl+', 'Alt+') AS replacement
  FROM categories
  WHERE shortcut ~ '^Ctrl\+[0-9]$'
),
resolved AS (
  SELECT
    candidate.id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM categories AS other
        WHERE other.album_id = candidate.album_id
          AND other.id <> candidate.id
          AND other.shortcut = candidate.replacement
      ) THEN NULL
      ELSE candidate.replacement
    END AS shortcut
  FROM candidates AS candidate
)
UPDATE categories AS category
SET shortcut = resolved.shortcut
FROM resolved
WHERE category.id = resolved.id;
