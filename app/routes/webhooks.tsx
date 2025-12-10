/**
 * Shopify Webhooks Handler
 *
 * POST /webhooks
 *
 * Handles incoming webhooks from Shopify:
 * - customers/update - Sync customer email/name changes
 * - customers/delete - GDPR compliance, anonymize data
 * - app/uninstalled - Clean up shop-specific settings
 */

import type { ActionFunctionArgs } from "react-router";
import crypto from "crypto";
import prisma from "../db.server";

// ============================================================================
// Webhook Verification
// ============================================================================

/**
 * Verify Shopify webhook HMAC signature
 */
function verifyWebhookSignature(body: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) {
    console.warn("Webhook missing HMAC header");
    return false;
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET not configured");
    return false;
  }

  const calculatedHmac = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmacHeader),
      Buffer.from(calculatedHmac)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Action Handler
// ============================================================================

export async function action({ request }: ActionFunctionArgs) {
  // Only allow POST
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Get headers
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  // Read body
  const body = await request.text();

  // Verify signature
  if (!verifyWebhookSignature(body, hmac)) {
    console.warn(`Webhook signature verification failed for ${topic}`);
    return new Response("Unauthorized", { status: 401 });
  }

  // Parse payload
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error("Invalid JSON in webhook body");
    return new Response("Bad Request", { status: 400 });
  }

  console.log(`📨 Webhook received: ${topic} from ${shop} (${webhookId})`);

  try {
    // Route to appropriate handler
    switch (topic) {
      case "customers/create":
        await handleCustomerCreate(payload);
        break;

      case "customers/update":
        await handleCustomerUpdate(payload);
        break;

      case "customers/delete":
        await handleCustomerDelete(payload);
        break;

      case "app/uninstalled":
        await handleAppUninstalled(shop!);
        break;

      case "shop/redact":
        await handleShopRedact(shop!, payload);
        break;

      case "customers/redact":
        await handleCustomerRedact(payload);
        break;

      case "customers/data_request":
        await handleCustomerDataRequest(payload);
        break;

      default:
        console.log(`Unhandled webhook topic: ${topic}`);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(`Webhook error (${topic}):`, error);
    // Return 200 to prevent retries for non-transient errors
    return new Response("OK", { status: 200 });
  }
}

// ============================================================================
// Webhook Handlers
// ============================================================================

/**
 * Handle customer create - link guest submissions when a new account is created
 * This is important for linking previous guest trade-in submissions
 */
async function handleCustomerCreate(payload: any): Promise<void> {
  const shopifyId = String(payload.id);
  const email = payload.email?.toLowerCase();
  const firstName = payload.first_name;
  const lastName = payload.last_name;
  const phone = payload.phone;

  if (!email) {
    console.log(`New customer ${shopifyId} has no email, skipping`);
    return;
  }

  // Check if there's an existing guest customer with this email
  const guestCustomer = await prisma.customer.findFirst({
    where: {
      email: email,
      shopifyCustomerId: null, // Guest customer (no Shopify link)
    },
    include: {
      _count: { select: { submissions: true } },
    },
  });

  if (guestCustomer) {
    // Link the guest customer to this new Shopify account
    await prisma.customer.update({
      where: { id: guestCustomer.id },
      data: {
        shopifyCustomerId: shopifyId,
        firstName: firstName || guestCustomer.firstName,
        lastName: lastName || guestCustomer.lastName,
        phone: phone || guestCustomer.phone,
      },
    });
    console.log(`Guest customer ${guestCustomer.id} with ${guestCustomer._count.submissions} submissions linked to new Shopify account ${shopifyId}`);
  } else {
    // Check if there's already a customer with this Shopify ID (shouldn't happen but be safe)
    const existingCustomer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: shopifyId },
    });

    if (!existingCustomer) {
      // Create a new customer record
      await prisma.customer.create({
        data: {
          shopifyCustomerId: shopifyId,
          email: email,
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
        },
      });
      console.log(`Created new customer for Shopify account ${shopifyId}`);
    } else {
      console.log(`Customer for Shopify account ${shopifyId} already exists`);
    }
  }
}

/**
 * Handle customer update - sync email and name changes
 * Also handles account merging when a guest creates an account with same email
 */
async function handleCustomerUpdate(payload: any): Promise<void> {
  const shopifyId = String(payload.id);
  const email = payload.email?.toLowerCase();
  const firstName = payload.first_name;
  const lastName = payload.last_name;
  const phone = payload.phone;

  // Find customer by Shopify ID
  let customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: shopifyId },
  });

  if (customer) {
    // Existing linked customer - just update their data
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(email && { email }),
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(phone !== undefined && { phone }),
      },
    });
    console.log(`Customer ${shopifyId} updated`);
  } else if (email) {
    // No customer with this Shopify ID - check if there's a guest customer with this email
    // This handles the case where a guest created submissions then later created an account
    const guestCustomer = await prisma.customer.findFirst({
      where: {
        email: email,
        shopifyCustomerId: null, // Guest customer (no Shopify link)
      },
    });

    if (guestCustomer) {
      // Link the guest customer to this Shopify account
      customer = await prisma.customer.update({
        where: { id: guestCustomer.id },
        data: {
          shopifyCustomerId: shopifyId,
          ...(firstName !== undefined && { firstName: firstName || guestCustomer.firstName }),
          ...(lastName !== undefined && { lastName: lastName || guestCustomer.lastName }),
          ...(phone !== undefined && { phone }),
        },
      });
      console.log(`Guest customer ${guestCustomer.id} linked to Shopify account ${shopifyId}`);
    } else {
      // Create a new customer record linked to this Shopify account
      customer = await prisma.customer.create({
        data: {
          shopifyCustomerId: shopifyId,
          email: email,
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
        },
      });
      console.log(`Created new customer for Shopify account ${shopifyId}`);
    }
  } else {
    console.log(`Customer ${shopifyId} not found and no email provided, skipping`);
  }
}

/**
 * Handle customer delete - GDPR compliance
 * Anonymize customer data while preserving submission history
 */
async function handleCustomerDelete(payload: any): Promise<void> {
  const shopifyId = String(payload.id);

  // Find customer
  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: shopifyId },
  });

  if (!customer) {
    console.log(`Customer ${shopifyId} not found, skipping delete`);
    return;
  }

  // Anonymize customer data (preserve for submission records)
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      email: `deleted-${shopifyId}@anonymized.local`,
      firstName: "Deleted",
      lastName: "Customer",
      phone: null,
      shopifyCustomerId: null, // Unlink from Shopify
    },
  });

  // Delete sensitive payout methods
  await prisma.payoutMethod.deleteMany({
    where: { customerId: customer.id },
  });

  console.log(`Customer ${shopifyId} anonymized (GDPR compliance)`);
}

/**
 * Handle app uninstall - clean up shop-specific data
 */
async function handleAppUninstalled(shop: string): Promise<void> {
  // Delete shop-specific settings
  await prisma.tradeInSettings.deleteMany({
    where: { shop },
  });

  // Delete sessions for this shop
  await prisma.session.deleteMany({
    where: { shop },
  });

  console.log(`App uninstalled from ${shop}, cleaned up settings`);
}

/**
 * Handle shop redact - GDPR shop data erasure request
 * Called 48 hours after app is uninstalled
 */
async function handleShopRedact(shop: string, payload: any): Promise<void> {
  // App data should already be cleaned up on uninstall
  // This is a confirmation that we can do final cleanup

  console.log(`Shop redact request for ${shop}`);

  // Ensure settings are deleted
  await prisma.tradeInSettings.deleteMany({
    where: { shop },
  });

  // Sessions should already be deleted
  await prisma.session.deleteMany({
    where: { shop },
  });
}

/**
 * Handle customer redact - GDPR customer data erasure request
 */
async function handleCustomerRedact(payload: any): Promise<void> {
  const shop = payload.shop_domain;
  const customerId = String(payload.customer?.id);

  if (!customerId) {
    console.log("No customer ID in redact request");
    return;
  }

  // Find and anonymize customer
  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: customerId },
  });

  if (!customer) {
    console.log(`Customer ${customerId} not found for redact`);
    return;
  }

  // Full anonymization
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      email: `redacted-${customerId}@anonymized.local`,
      firstName: "Redacted",
      lastName: "Customer",
      phone: null,
      shopifyCustomerId: null,
    },
  });

  // Delete all payout methods
  await prisma.payoutMethod.deleteMany({
    where: { customerId: customer.id },
  });

  // Anonymize submission notes from this customer
  await prisma.submissionNote.updateMany({
    where: {
      submission: { customerId: customer.id },
      authorType: "CUSTOMER",
    },
    data: {
      authorName: "Redacted Customer",
    },
  });

  console.log(`Customer ${customerId} redacted (GDPR erasure)`);
}

/**
 * Handle customer data request - GDPR data portability
 * Log the request; actual data export handled separately
 */
async function handleCustomerDataRequest(payload: any): Promise<void> {
  const shop = payload.shop_domain;
  const customerId = String(payload.customer?.id);
  const ordersRequested = payload.orders_requested || [];

  console.log(`Customer data request from ${shop} for customer ${customerId}`);
  console.log(`Orders requested: ${ordersRequested.length}`);

  // In production, this would trigger a data export process
  // For now, we log the request

  // Find customer data
  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId: customerId },
    include: {
      submissions: {
        include: {
          items: true,
          notes: {
            where: { isInternal: false },
          },
        },
      },
      payouts: true,
    },
  });

  if (customer) {
    console.log(`Found ${customer.submissions.length} submissions for data export`);
    // In production: Generate and email data export
  }
}

// ============================================================================
// Loader (GET not supported)
// ============================================================================

export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
