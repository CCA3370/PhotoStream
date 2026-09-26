DO $$
DECLARE
  bad_mapping uuid;
BEGIN
  SELECT m.id
  INTO bad_mapping
  FROM "bib_attribute_mappings" m
  LEFT JOIN "bib_attribute_mapping_ranges" r ON r."mapping_id" = m."id"
  GROUP BY m."id", m."width"
  HAVING
    count(r."id") <> 1
    OR count(r."id") FILTER (
      WHERE r."start_value" = r."end_value"
        AND r."start_value" ~ '^[0-9]+$'
        AND char_length(r."start_value") = m."width"
        AND char_length(r."end_value") = m."width"
    ) <> 1
  LIMIT 1;

  IF bad_mapping IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib mapping % cannot be compacted: each mapping must contain exactly one exact numeric value matching its width', bad_mapping;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_mapping uuid;
BEGIN
  SELECT m."id"
  INTO bad_mapping
  FROM "bib_attribute_mappings" m
  JOIN "bib_attribute_options" o ON o."id" = m."output_option_id"
  WHERE m."album_id" IS DISTINCT FROM o."album_id"
     OR m."dimension" IS DISTINCT FROM o."dimension"
  LIMIT 1;

  IF bad_mapping IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib mapping % points to an option in another album or dimension', bad_mapping;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_album uuid;
  bad_dimension text;
BEGIN
  SELECT m."album_id", m."dimension"::text
  INTO bad_album, bad_dimension
  FROM "bib_attribute_mappings" m
  GROUP BY m."album_id", m."dimension"
  HAVING min(m."start_position") <> max(m."start_position")
      OR min(m."width") <> max(m."width")
  LIMIT 1;

  IF bad_album IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib mappings for album % dimension % cannot be compacted: start position and width must be uniform', bad_album, bad_dimension;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_option uuid;
BEGIN
  SELECT m."output_option_id"
  INTO bad_option
  FROM "bib_attribute_mappings" m
  GROUP BY m."album_id", m."dimension", m."output_option_id"
  HAVING count(*) <> 1
  LIMIT 1;

  IF bad_option IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib option % cannot be compacted: an option must map from exactly one value', bad_option;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_option uuid;
BEGIN
  SELECT o."id"
  INTO bad_option
  FROM "bib_attribute_options" o
  WHERE o."enabled"
    AND EXISTS (
      SELECT 1
      FROM "bib_attribute_mappings" m
      WHERE m."album_id" = o."album_id"
        AND m."dimension" = o."dimension"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "bib_attribute_mappings" m
      WHERE m."album_id" = o."album_id"
        AND m."dimension" = o."dimension"
        AND m."output_option_id" = o."id"
    )
  LIMIT 1;

  IF bad_option IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib option % cannot be compacted without changing behavior: it is enabled but unmapped', bad_option;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_option uuid;
BEGIN
  SELECT o."id"
  INTO bad_option
  FROM "bib_attribute_mappings" m
  JOIN "bib_attribute_options" o ON o."id" = m."output_option_id"
  WHERE m."dimension" = 'class'
    AND (
      o."parent_grade_option_id" IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM "bib_attribute_mappings" gm
        WHERE gm."album_id" = m."album_id"
          AND gm."dimension" = 'grade'
          AND gm."output_option_id" = o."parent_grade_option_id"
      )
    )
  LIMIT 1;

  IF bad_option IS NOT NULL THEN
    RAISE EXCEPTION 'legacy class option % cannot be compacted: its parent grade is not mapped', bad_option;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_option uuid;
BEGIN
  WITH exact AS (
    SELECT
      m."id" AS mapping_id,
      m."album_id",
      m."dimension",
      m."output_option_id",
      r."start_value"::bigint AS encoded_value
    FROM "bib_attribute_mappings" m
    JOIN "bib_attribute_mapping_ranges" r ON r."mapping_id" = m."id"
  )
  SELECT e1."output_option_id"
  INTO bad_option
  FROM exact e1
  JOIN exact e2
    ON e1."album_id" = e2."album_id"
   AND e1."dimension" = e2."dimension"
   AND e1."encoded_value" = e2."encoded_value"
   AND e1."mapping_id"::text < e2."mapping_id"::text
  JOIN "bib_attribute_options" o1 ON o1."id" = e1."output_option_id"
  JOIN "bib_attribute_options" o2 ON o2."id" = e2."output_option_id"
  WHERE e1."dimension" = 'grade'
     OR o1."parent_grade_option_id" IS NOT DISTINCT FROM o2."parent_grade_option_id"
  LIMIT 1;

  IF bad_option IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib option % cannot be compacted: the same encoded value maps to multiple options in one scope', bad_option;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  bad_option uuid;
BEGIN
  WITH exact AS (
    SELECT
      m."album_id",
      m."dimension",
      m."output_option_id",
      r."start_value"::bigint AS encoded_value
    FROM "bib_attribute_mappings" m
    JOIN "bib_attribute_mapping_ranges" r ON r."mapping_id" = m."id"
  ),
  first_values AS (
    SELECT "album_id", "dimension", min(encoded_value) AS first_value
    FROM exact
    GROUP BY "album_id", "dimension"
  )
  SELECT e."output_option_id"
  INTO bad_option
  FROM exact e
  JOIN first_values f
    ON f."album_id" = e."album_id"
   AND f."dimension" = e."dimension"
  WHERE e.encoded_value - f.first_value > 10000
  LIMIT 1;

  IF bad_option IS NOT NULL THEN
    RAISE EXCEPTION 'legacy bib option % cannot be compacted: required ordinal exceeds 10000', bad_option;
  END IF;
END $$;
--> statement-breakpoint
WITH compact_rules AS (
  SELECT
    m."album_id",
    m."dimension",
    min(m."start_position") AS start_position,
    min(m."width") AS width,
    min(r."start_value"::bigint) AS first_value
  FROM "bib_attribute_mappings" m
  JOIN "bib_attribute_mapping_ranges" r ON r."mapping_id" = m."id"
  GROUP BY m."album_id", m."dimension"
)
INSERT INTO "bib_attribute_rules" (
  "id",
  "album_id",
  "dimension",
  "start_position",
  "width",
  "first_value"
)
SELECT
  uuidv7(),
  c."album_id",
  c."dimension",
  c.start_position,
  c.width,
  c.first_value
FROM compact_rules c
ON CONFLICT ("album_id", "dimension") DO UPDATE SET
  "start_position" = EXCLUDED."start_position",
  "width" = EXCLUDED."width",
  "first_value" = EXCLUDED."first_value",
  "updated_at" = now();
--> statement-breakpoint
WITH exact AS (
  SELECT
    m."album_id",
    m."dimension",
    m."output_option_id",
    r."start_value"::bigint AS encoded_value
  FROM "bib_attribute_mappings" m
  JOIN "bib_attribute_mapping_ranges" r ON r."mapping_id" = m."id"
),
first_values AS (
  SELECT "album_id", "dimension", min(encoded_value) AS first_value
  FROM exact
  GROUP BY "album_id", "dimension"
),
option_ordinals AS (
  SELECT
    e."output_option_id",
    (e.encoded_value - f.first_value)::integer AS ordinal
  FROM exact e
  JOIN first_values f
    ON f."album_id" = e."album_id"
   AND f."dimension" = e."dimension"
)
UPDATE "bib_attribute_options" o
SET "ordinal" = v.ordinal
FROM option_ordinals v
WHERE o."id" = v."output_option_id";
