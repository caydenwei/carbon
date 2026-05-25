-- Make stateProvince optional on `location` to match the validator change.
-- Many countries (UK, IE, JP, most EU, SG) have no state concept, so this
-- column must accept NULL. The `company` and `address` tables already allow
-- NULL — only `location` had the NOT NULL constraint.

ALTER TABLE "location" ALTER COLUMN "stateProvince" DROP NOT NULL;
