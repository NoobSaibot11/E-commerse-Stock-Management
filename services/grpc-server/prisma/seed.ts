import { prisma } from "../src/db.js";

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
  console.log(`🌱 Seeded ${products.length} products`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
