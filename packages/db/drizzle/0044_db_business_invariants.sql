CREATE OR REPLACE FUNCTION photostream_validate_media_category_album()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM categories AS c
    WHERE c.id = NEW.category_id
      AND c.album_id = NEW.album_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'media category must belong to the same album';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_category_album_invariant
AFTER INSERT OR UPDATE OF album_id, category_id ON "media"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION photostream_validate_media_category_album();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_validate_bib_option_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dimension = 'class' AND NOT EXISTS (
    SELECT 1
    FROM bib_attribute_options AS parent
    WHERE parent.id = NEW.parent_grade_option_id
      AND parent.album_id = NEW.album_id
      AND parent.dimension = 'grade'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'class option parent must be a grade option in the same album';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bib_attribute_option_parent_invariant
AFTER INSERT OR UPDATE OF album_id, dimension, parent_grade_option_id ON "bib_attribute_options"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION photostream_validate_bib_option_parent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_validate_media_bib_tag_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  class_parent_grade_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM media AS m
    WHERE m.id = NEW.media_id
      AND m.album_id = NEW.album_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'bib tag media must belong to the same album';
  END IF;

  IF NEW.grade_option_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM bib_attribute_options AS grade
    WHERE grade.id = NEW.grade_option_id
      AND grade.album_id = NEW.album_id
      AND grade.dimension = 'grade'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'bib tag grade option must belong to the same album and grade dimension';
  END IF;

  IF NEW.class_option_id IS NOT NULL THEN
    SELECT class.parent_grade_option_id
    INTO class_parent_grade_id
    FROM bib_attribute_options AS class
    WHERE class.id = NEW.class_option_id
      AND class.album_id = NEW.album_id
      AND class.dimension = 'class';

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'bib tag class option must belong to the same album and class dimension';
    END IF;

    IF NEW.grade_option_id IS NULL OR class_parent_grade_id IS DISTINCT FROM NEW.grade_option_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'bib tag class option must belong to the selected grade option';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER media_bib_tag_links_invariant
AFTER INSERT OR UPDATE OF album_id, media_id, grade_option_id, class_option_id ON "media_bib_tags"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION photostream_validate_media_bib_tag_links();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION photostream_validate_legacy_bib_mapping_option()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM bib_attribute_options AS option
    WHERE option.id = NEW.output_option_id
      AND option.album_id = NEW.album_id
      AND option.dimension = NEW.dimension
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'legacy bib mapping output option must belong to the same album and dimension';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER legacy_bib_mapping_option_invariant
AFTER INSERT OR UPDATE OF album_id, dimension, output_option_id ON "bib_attribute_mappings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION photostream_validate_legacy_bib_mapping_option();
