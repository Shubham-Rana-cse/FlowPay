// Seed data per Phase 1 decisions: 1 merchant, 2 API keys, 1 MerchantSettings.
// Deliberately no orders/payments — those belong to Phase 2+.
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcrypt";
import { randomUUID, randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const merchant = await prisma.merchant.upsert({
    where: { email: "demo@merchant.test" },
    update: {},
    create: {
      businessName: "Demo Merchant Pvt Ltd",
      email: "demo@merchant.test",
      passwordHash,
      settings: {
        create: {
          autoCapture: true,
          defaultCurrency: "INR",
          webhookSecret: randomBytes(32).toString("hex"),
          timezone: "Asia/Kolkata",
        },
      },
    },
  });

  const rawKey1 = `sk_test_${randomUUID().replace(/-/g, "")}`;
  const rawKey2 = `sk_test_${randomUUID().replace(/-/g, "")}`;

  await prisma.apiKey.createMany({
    data: [
      {
        merchantId: merchant.id,
        keyHash: await bcrypt.hash(rawKey1, 10),
        label: "Default key",
        isActive: true,
      },
      {
        merchantId: merchant.id,
        keyHash: await bcrypt.hash(rawKey2, 10),
        label: "Secondary key",
        isActive: true,
      },
    ],
  });

  console.log("Seeded merchant:", merchant.email);
  console.log("Login password: password123");
  console.log("Raw API keys (shown once, save them):");
  console.log("  Key 1:", rawKey1);
  console.log("  Key 2:", rawKey2);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
