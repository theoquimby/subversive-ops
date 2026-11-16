-- Data only: most kitchen suppliers are ordered "when stock runs low", not every delivery.
-- Driscoll, Kilcoyne and See & Be stay "regular" (an order for every delivery).
UPDATE "Supplier"
SET "orderCadence" = 'as_needed'
WHERE "department" = 'kitchen'
  AND "orderCadence" = 'regular'
  AND "name" NOT ILIKE '%driscoll%'
  AND "name" NOT ILIKE '%kilcoyne%'
  AND "name" NOT ILIKE '%see%be%';

-- Show the one-time note on Ordering listing which suppliers changed (dismissed with "Got it").
INSERT INTO "Setting" ("key", "value")
SELECT 'ordering.cadenceNotice', 'show'
WHERE EXISTS (SELECT 1 FROM "Supplier" WHERE "department" = 'kitchen' AND "orderCadence" = 'as_needed')
ON CONFLICT ("key") DO NOTHING;
