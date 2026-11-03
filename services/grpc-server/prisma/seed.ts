import { prisma } from "../src/db.js";
import { hashPassword } from "../src/auth/password.js";

// Local development accounts. Override the passwords with SEED_ADMIN_PASSWORD
// and SEED_CUSTOMER_PASSWORD; never seed these defaults into a real deployment.
const users = [
  {
    email: "admin@example.com",
    password: process.env.SEED_ADMIN_PASSWORD ?? "admin-dev-password",
    role: "ADMIN" as const,
  },
  {
    email: "customer@example.com",
    password: process.env.SEED_CUSTOMER_PASSWORD ?? "customer-dev-password",
    role: "CUSTOMER" as const,
  },
];

// Upserting by SKU keeps the seed safe to run more than once.
const products = [
  {
    sku: "KB-WMK-001",
    name: "Wireless Mechanical Keyboard",
    price: "129.99",
    stock: 15,
    description: "Hot-swappable RGB keyboard with tactile switches.",
  },
  {
    sku: "MS-EGM-001",
    name: "Ergonomic Gaming Mouse",
    price: "79.99",
    stock: 42,
    description: "Ultra-lightweight wireless mouse with 26K DPI sensor.",
  },
  {
    sku: "MN-4KU-034",
    name: "4K UltraWide Monitor",
    price: "499.99",
    stock: 8,
    description: "34-inch curved monitor with 144Hz refresh rate.",
  },
  {
    sku: "HP-NCH-001",
    name: "Noise-Canceling Headphones",
    price: "249.99",
    stock: 20,
    description: "Over-ear bluetooth headphones with high-res audio.",
  },
];

async function main() {
  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: product,
    });
  }
  for (const { email, password, role } of users) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, role, passwordHash: await hashPassword(password) },
    });
  }
  console.log(`🌱 Seeded ${products.length} products and ${users.length} users`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
