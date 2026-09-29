ALTER TABLE "categories" ADD COLUMN "shortcut" varchar(32);
--> statement-breakpoint
CREATE UNIQUE INDEX "categories_album_shortcut_unique" ON "categories" USING btree ("album_id", "shortcut");
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY album_id ORDER BY sort_order, id) AS ordinal
  FROM categories
)
UPDATE categories AS category
SET shortcut = CASE
  WHEN ranked.ordinal BETWEEN 1 AND 9 THEN 'Ctrl+' || ranked.ordinal::text
  WHEN ranked.ordinal = 10 THEN 'Ctrl+0'
  ELSE NULL
END
FROM ranked
WHERE category.id = ranked.id;
