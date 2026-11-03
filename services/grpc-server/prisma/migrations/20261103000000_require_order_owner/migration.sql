-- Orders placed before login existed have no owner. They were only ever
-- demo data, so remove them (their order_items cascade).
DELETE FROM "orders" WHERE "user_id" IS NULL;

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "user_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
