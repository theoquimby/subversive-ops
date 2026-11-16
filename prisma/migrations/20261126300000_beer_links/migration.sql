-- Beer links: the keg ingredient becomes a real link on Beer, Square items link to the beer they
-- pour, and keg prices remember the brew or brewing recipe they came from.

-- AlterTable
ALTER TABLE "PriceRecord" ADD COLUMN     "brewBatchId" TEXT,
ADD COLUMN     "brewRecipeId" TEXT;

-- AlterTable
ALTER TABLE "SquareMapping" ADD COLUMN     "beerId" TEXT;

-- CreateIndex
CREATE INDEX "PriceRecord_brewBatchId_idx" ON "PriceRecord"("brewBatchId");

-- CreateIndex
CREATE INDEX "PriceRecord_brewRecipeId_idx" ON "PriceRecord"("brewRecipeId");

-- CreateIndex
CREATE INDEX "SquareMapping_beerId_idx" ON "SquareMapping"("beerId");

-- CreateIndex
CREATE INDEX "Beer_ingredientId_idx" ON "Beer"("ingredientId");

-- AddForeignKey
ALTER TABLE "PriceRecord" ADD CONSTRAINT "PriceRecord_brewBatchId_fkey" FOREIGN KEY ("brewBatchId") REFERENCES "BrewBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRecord" ADD CONSTRAINT "PriceRecord_brewRecipeId_fkey" FOREIGN KEY ("brewRecipeId") REFERENCES "BrewRecipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquareMapping" ADD CONSTRAINT "SquareMapping_beerId_fkey" FOREIGN KEY ("beerId") REFERENCES "Beer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Beer.ingredientId had no foreign key before, so it could point at an ingredient that was deleted.
-- The foreign key below can't be added while such a value exists: keep the old id in Beer.extra
-- ("missingIngredientId", nothing is lost) and clear the dangling pointer. Rows whose ingredient
-- exists are untouched.
UPDATE "Beer"
SET "extra" = CASE
      WHEN "extra" IS NULL OR jsonb_typeof("extra") = 'null' THEN jsonb_build_object('missingIngredientId', "ingredientId")
      WHEN jsonb_typeof("extra") = 'object' THEN "extra" || jsonb_build_object('missingIngredientId', "ingredientId")
      ELSE jsonb_build_object('extra', "extra", 'missingIngredientId', "ingredientId")
    END,
    "ingredientId" = NULL
WHERE "ingredientId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Ingredient" i WHERE i."id" = "Beer"."ingredientId");

-- AddForeignKey
ALTER TABLE "Beer" ADD CONSTRAINT "Beer_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===================================================================================================
-- Backfill (approved by the owner). Each statement only fills an empty link, never deletes a row and
-- never changes a value that is already set. Anything that doesn't match exactly one thing is left
-- alone and shows under Kegs → Setup → Needs a look. Safe to run again and on empty tables.
-- ===================================================================================================

-- 1. Beer → keg ingredient. A beer with no keg ingredient gets the ingredient named exactly
--    "<beer name> (keg)" (case-insensitive, spaces around the beer name ignored), only when exactly
--    one ingredient has that name, only one beer has that name, and no other beer links to it.
UPDATE "Beer" b
SET "ingredientId" = m."ingredientId"
FROM (
  SELECT b2."id" AS "beerId", MIN(i."id") AS "ingredientId", COUNT(*) AS n
  FROM "Beer" b2
  JOIN "Ingredient" i ON lower(i."name") = lower(btrim(b2."name") || ' (keg)')
  WHERE b2."ingredientId" IS NULL
  GROUP BY b2."id"
) m
WHERE b."id" = m."beerId"
  AND m.n = 1
  AND b."ingredientId" IS NULL
  AND (SELECT COUNT(*) FROM "Beer" b3 WHERE lower(btrim(b3."name")) = lower(btrim(b."name"))) = 1
  AND NOT EXISTS (SELECT 1 FROM "Beer" o WHERE o."ingredientId" = m."ingredientId");

-- 2. Square item → beer. A Square item with no beer gets one when its name (the part before " · ")
--    matches exactly one beer by today's name rules: compared loosely (lower case, *, ™ and ® dropped,
--    anything not a letter or digit as one space, trimmed) against each beer's name and the Square
--    names typed on Kegs → Setup. Two or more beers matching = left alone.
WITH beer_keys AS (
  SELECT b."id" AS "beerId", btrim(regexp_replace(regexp_replace(lower(b."name"), '[*™®]', '', 'g'), '[^a-z0-9]+', ' ', 'g')) AS k
  FROM "Beer" b
  UNION
  SELECT b."id", btrim(regexp_replace(regexp_replace(lower(s), '[*™®]', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
  FROM "Beer" b, unnest(b."squareNames") AS s
), items AS (
  SELECT m."squareId", btrim(regexp_replace(regexp_replace(lower(split_part(m."squareName", ' · ', 1)), '[*™®]', '', 'g'), '[^a-z0-9]+', ' ', 'g')) AS k
  FROM "SquareMapping" m
  WHERE m."beerId" IS NULL
), hits AS (
  SELECT it."squareId", MIN(bk."beerId") AS "beerId", COUNT(DISTINCT bk."beerId") AS n
  FROM items it
  JOIN beer_keys bk ON bk.k = it.k
  WHERE it.k <> ''
  GROUP BY it."squareId"
)
UPDATE "SquareMapping" m
SET "beerId" = h."beerId"
FROM hits h
WHERE m."squareId" = h."squareId"
  AND h.n = 1
  AND m."beerId" IS NULL;

-- 3. Brew → keg batch. A brew with no keg batch gets the keg batch with exactly the same code, only
--    when that keg batch is for the same beer (both set) and no other brew is linked to it.
UPDATE "BrewBatch" bb
SET "kegBatchId" = kb."id"
FROM "KegBatch" kb
WHERE bb."kegBatchId" IS NULL
  AND kb."code" = bb."code"
  AND kb."beerId" IS NOT NULL
  AND kb."beerId" = bb."beerId"
  AND NOT EXISTS (SELECT 1 FROM "BrewBatch" o WHERE o."kegBatchId" = kb."id");

-- 4. Gravity readings from OG/FG typed before readings were the source. Appends one reading to the
--    brew's readings list (nothing in it is changed or removed): an "og" reading from the OG when the
--    brew has no OG reading and its brew-day log doesn't give that OG, dated its brew day (else its
--    planned day, else the day it was made); an "fg" reading from the FG when it has no FG reading,
--    no reading already holds that gravity and the log doesn't give it, dated its packaging day (else
--    brew day, planned day, day made). Brews whose extra is not a JSON object are left alone. The app
--    applies the same rule to any brew it touches later (domain/brewGravity adoptCachedGravity).
UPDATE "BrewBatch" bb
SET "extra" = (CASE WHEN jsonb_typeof(bb."extra") = 'object' THEN bb."extra" ELSE '{}'::jsonb END)
  || jsonb_build_object('readings',
       (CASE WHEN jsonb_typeof(bb."extra" -> 'readings') = 'array' THEN bb."extra" -> 'readings' ELSE '[]'::jsonb END)
       || jsonb_build_array(jsonb_build_object(
            'on', to_char(COALESCE(bb."brewedOn", bb."plannedOn", bb."createdAt"::date), 'YYYY-MM-DD'),
            'sg', bb."og"::float8,
            'kind', 'og',
            'note', 'OG typed before readings were kept')))
WHERE bb."og" IS NOT NULL
  AND (bb."extra" IS NULL OR jsonb_typeof(bb."extra") IN ('object', 'null'))
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(bb."extra" -> 'readings') = 'array' THEN bb."extra" -> 'readings' ELSE '[]'::jsonb END) r
    WHERE r ->> 'kind' = 'og'
  )
  -- Not when the brew-day log already gives this OG (boil OG, else knock-out): the log stays its source.
  AND NOT COALESCE(CASE
        WHEN jsonb_typeof(bb."brewLog" #> '{values,boil,ogSg}') = 'number' THEN abs((bb."brewLog" #>> '{values,boil,ogSg}')::float8 - bb."og"::float8) < 0.0005
        WHEN jsonb_typeof(bb."brewLog" #> '{values,boil,koSg}') = 'number' THEN abs((bb."brewLog" #>> '{values,boil,koSg}')::float8 - bb."og"::float8) < 0.0005
      END, false);

UPDATE "BrewBatch" bb
SET "extra" = (CASE WHEN jsonb_typeof(bb."extra") = 'object' THEN bb."extra" ELSE '{}'::jsonb END)
  || jsonb_build_object('readings',
       (CASE WHEN jsonb_typeof(bb."extra" -> 'readings') = 'array' THEN bb."extra" -> 'readings' ELSE '[]'::jsonb END)
       || jsonb_build_array(jsonb_build_object(
            'on', to_char(COALESCE(bb."packagedOn", bb."brewedOn", bb."plannedOn", bb."createdAt"::date), 'YYYY-MM-DD'),
            'sg', bb."fg"::float8,
            'kind', 'fg',
            'note', 'FG typed before readings were kept')))
WHERE bb."fg" IS NOT NULL
  AND (bb."extra" IS NULL OR jsonb_typeof(bb."extra") IN ('object', 'null'))
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(bb."extra" -> 'readings') = 'array' THEN bb."extra" -> 'readings' ELSE '[]'::jsonb END) r
    WHERE r ->> 'kind' = 'fg'
       OR CASE WHEN jsonb_typeof(r -> 'sg') = 'number' THEN abs((r ->> 'sg')::float8 - bb."fg"::float8) < 0.0005 ELSE false END
  )
  -- Not when the brew-day log already gives this FG (packaging FG): the log stays its source.
  AND NOT COALESCE(CASE
        WHEN jsonb_typeof(bb."brewLog" #> '{values,package,fgSg}') = 'number' THEN abs((bb."brewLog" #>> '{values,package,fgSg}')::float8 - bb."fg"::float8) < 0.0005
      END, false);
