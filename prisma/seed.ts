import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Create sample card prices (Pokemon TCG examples)
  const cardPrices = await Promise.all([
    prisma.cardPrice.create({
      data: {
        cardName: "Charizard",
        setName: "Base Set",
        setCode: "BS",
        rarity: "Holo Rare",
        variant: "Holo",
        priceNM: 35000, // $350.00
        priceLP: 28000,
        priceMP: 20000,
        priceHP: 12000,
        priceDMG: 5000,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Pikachu",
        setName: "Base Set",
        setCode: "BS",
        rarity: "Common",
        priceNM: 1500, // $15.00
        priceLP: 1200,
        priceMP: 800,
        priceHP: 400,
        priceDMG: 100,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Blastoise",
        setName: "Base Set",
        setCode: "BS",
        rarity: "Holo Rare",
        variant: "Holo",
        priceNM: 15000, // $150.00
        priceLP: 12000,
        priceMP: 8000,
        priceHP: 5000,
        priceDMG: 2000,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Venusaur",
        setName: "Base Set",
        setCode: "BS",
        rarity: "Holo Rare",
        variant: "Holo",
        priceNM: 12000, // $120.00
        priceLP: 9500,
        priceMP: 6500,
        priceHP: 4000,
        priceDMG: 1500,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Mewtwo",
        setName: "Base Set",
        setCode: "BS",
        rarity: "Holo Rare",
        variant: "Holo",
        priceNM: 8000, // $80.00
        priceLP: 6500,
        priceMP: 4500,
        priceHP: 2500,
        priceDMG: 1000,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Charizard VMAX",
        setName: "Shining Fates",
        setCode: "SHF",
        rarity: "Secret Rare",
        variant: "Shiny",
        priceNM: 25000, // $250.00
        priceLP: 20000,
        priceMP: 15000,
        priceHP: 8000,
        priceDMG: 3000,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Umbreon VMAX",
        setName: "Evolving Skies",
        setCode: "EVS",
        rarity: "Secret Rare",
        variant: "Alternate Art",
        priceNM: 45000, // $450.00
        priceLP: 38000,
        priceMP: 28000,
        priceHP: 18000,
        priceDMG: 8000,
      },
    }),
    prisma.cardPrice.create({
      data: {
        cardName: "Lugia V",
        setName: "Silver Tempest",
        setCode: "SIT",
        rarity: "Secret Rare",
        variant: "Alternate Art",
        priceNM: 18000, // $180.00
        priceLP: 15000,
        priceMP: 11000,
        priceHP: 7000,
        priceDMG: 3000,
      },
    }),
  ]);

  console.log(`✅ Created ${cardPrices.length} card prices`);

  // Create sample customers
  const customer1 = await prisma.customer.create({
    data: {
      email: "john.doe@example.com",
      firstName: "John",
      lastName: "Doe",
      phone: "+61 400 123 456",
    },
  });

  const customer2 = await prisma.customer.create({
    data: {
      email: "jane.smith@example.com",
      firstName: "Jane",
      lastName: "Smith",
      phone: "+61 400 789 012",
    },
  });

  console.log("✅ Created 2 customers");

  // Create sample submissions with items
  const submission1 = await prisma.tradeInSubmission.create({
    data: {
      submissionNumber: "TI-2024-001",
      customerId: customer1.id,
      status: "RECEIVED",
      payoutType: "STORE_CREDIT",
      quotedTotal: 47500, // $475.00
      shippingMethod: "PREPAID",
      trackingNumber: "AP123456789AU",
      submittedAt: new Date("2024-11-25"),
      receivedAt: new Date("2024-11-28"),
      items: {
        create: [
          {
            cardPriceId: cardPrices[0].id, // Charizard
            cardName: "Charizard",
            setName: "Base Set",
            setCode: "BS",
            variant: "Holo",
            quantity: 1,
            conditionClaimed: "LP",
            quotedPrice: 28000,
          },
          {
            cardPriceId: cardPrices[4].id, // Mewtwo
            cardName: "Mewtwo",
            setName: "Base Set",
            setCode: "BS",
            variant: "Holo",
            quantity: 2,
            conditionClaimed: "NM",
            quotedPrice: 16000,
          },
          {
            cardPriceId: cardPrices[1].id, // Pikachu
            cardName: "Pikachu",
            setName: "Base Set",
            setCode: "BS",
            quantity: 5,
            conditionClaimed: "MP",
            quotedPrice: 3500,
          },
        ],
      },
      notes: {
        create: [
          {
            authorType: "SYSTEM",
            message: "Submission created",
          },
          {
            authorType: "SYSTEM",
            message: "Package received at warehouse",
          },
        ],
      },
    },
  });

  const submission2 = await prisma.tradeInSubmission.create({
    data: {
      submissionNumber: "TI-2024-002",
      customerId: customer2.id,
      status: "GRADING",
      payoutType: "BANK",
      quotedTotal: 63000, // $630.00
      shippingMethod: "SELF_SHIP",
      trackingNumber: "AU987654321",
      submittedAt: new Date("2024-11-27"),
      receivedAt: new Date("2024-11-30"),
      items: {
        create: [
          {
            cardPriceId: cardPrices[6].id, // Umbreon VMAX
            cardName: "Umbreon VMAX",
            setName: "Evolving Skies",
            setCode: "EVS",
            variant: "Alternate Art",
            quantity: 1,
            conditionClaimed: "NM",
            quotedPrice: 45000,
          },
          {
            cardPriceId: cardPrices[7].id, // Lugia V
            cardName: "Lugia V",
            setName: "Silver Tempest",
            setCode: "SIT",
            variant: "Alternate Art",
            quantity: 1,
            conditionClaimed: "NM",
            quotedPrice: 18000,
          },
        ],
      },
      notes: {
        create: [
          {
            authorType: "SYSTEM",
            message: "Submission created",
          },
          {
            authorType: "CUSTOMER",
            message: "Cards are double sleeved and top-loaded",
          },
          {
            authorType: "SYSTEM",
            message: "Package received, starting grading",
          },
        ],
      },
    },
  });

  const submission3 = await prisma.tradeInSubmission.create({
    data: {
      submissionNumber: "TI-2024-003",
      customerId: customer1.id,
      status: "SUBMITTED",
      payoutType: "STORE_CREDIT",
      quotedTotal: 25000, // $250.00
      shippingMethod: "PREPAID",
      submittedAt: new Date("2024-11-30"),
      items: {
        create: [
          {
            cardPriceId: cardPrices[5].id, // Charizard VMAX
            cardName: "Charizard VMAX",
            setName: "Shining Fates",
            setCode: "SHF",
            variant: "Shiny",
            quantity: 1,
            conditionClaimed: "NM",
            quotedPrice: 25000,
          },
        ],
      },
      notes: {
        create: [
          {
            authorType: "SYSTEM",
            message: "Submission created",
          },
        ],
      },
    },
  });

  console.log("✅ Created 3 trade-in submissions");

  // Create a completed submission with payout
  const submission4 = await prisma.tradeInSubmission.create({
    data: {
      submissionNumber: "TI-2024-000",
      customerId: customer2.id,
      status: "COMPLETED",
      payoutType: "STORE_CREDIT",
      quotedTotal: 15000,
      finalTotal: 14000, // Slightly adjusted
      bonusAmount: 1400, // 10% bonus
      shippingMethod: "PREPAID",
      trackingNumber: "AP111222333AU",
      submittedAt: new Date("2024-11-15"),
      receivedAt: new Date("2024-11-18"),
      gradedAt: new Date("2024-11-19"),
      approvedAt: new Date("2024-11-19"),
      completedAt: new Date("2024-11-20"),
      items: {
        create: [
          {
            cardPriceId: cardPrices[2].id, // Blastoise
            cardName: "Blastoise",
            setName: "Base Set",
            setCode: "BS",
            variant: "Holo",
            quantity: 1,
            conditionClaimed: "NM",
            conditionActual: "LP", // Downgraded
            quotedPrice: 15000,
            finalPrice: 12000,
            adjustmentReason: "Minor whitening on edges",
            status: "ADJUSTED",
          },
        ],
      },
      notes: {
        create: [
          {
            authorType: "SYSTEM",
            message: "Submission created",
          },
          {
            authorType: "MERCHANT",
            message: "Card has minor edge wear, adjusting to LP",
            isInternal: false,
          },
          {
            authorType: "SYSTEM",
            message: "Customer accepted adjusted offer",
          },
          {
            authorType: "SYSTEM",
            message: "Store credit issued",
          },
        ],
      },
    },
  });

  // Create payout for completed submission
  await prisma.payout.create({
    data: {
      submissionId: submission4.id,
      customerId: customer2.id,
      type: "STORE_CREDIT",
      amount: 14000,
      bonusAmount: 1400,
      totalAmount: 15400, // $154.00 total
      status: "COMPLETED",
      giftCardCode: "XXXX-XXXX-XXXX-1234",
      processedAt: new Date("2024-11-20"),
    },
  });

  console.log("✅ Created completed submission with payout");

  console.log("\n🎉 Seed completed successfully!");
  console.log("\nSummary:");
  console.log(`- ${cardPrices.length} card prices`);
  console.log("- 2 customers");
  console.log("- 4 trade-in submissions (various statuses)");
  console.log("- 1 completed payout");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
