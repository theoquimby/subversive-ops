-- Supplier products made by the brewing-ingredient linker on 2026-11-16 used 453.592 g a pound and
-- 3785.41 ml a gallon, while recipe maths uses the exact 453.59237 and 3785.411784, so 750 lb read as
-- 750.0006 packs and was rounded up to 751. Correct only those products (sku BM-…) and only the exact
-- old values; nothing else changes. Safe to run again.
UPDATE "SupplierProduct" SET "packQtyBase" = 453.59237 WHERE "sku" LIKE 'BM-%' AND "packQtyBase" = 453.592;
UPDATE "SupplierProduct" SET "packQtyBase" = 3785.411784 WHERE "sku" LIKE 'BM-%' AND "packQtyBase" = 3785.41;
