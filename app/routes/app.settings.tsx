import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

// Default condition multipliers
const DEFAULT_MULTIPLIERS = {
  NM: 0.70,
  LP: 0.55,
  MP: 0.40,
  HP: 0.25,
  DMG: 0.10,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Get or create settings
  let settings = await db.tradeInSettings.findFirst();

  if (!settings) {
    settings = await db.tradeInSettings.create({
      data: {
        minimumSubmissionValue: 500, // £5 minimum
        storeCreditBonusPercent: 10,
        cashPayoutPercent: 100, // 100% = full trade-in value
        conditionMultiplierNM: DEFAULT_MULTIPLIERS.NM,
        conditionMultiplierLP: DEFAULT_MULTIPLIERS.LP,
        conditionMultiplierMP: DEFAULT_MULTIPLIERS.MP,
        conditionMultiplierHP: DEFAULT_MULTIPLIERS.HP,
        conditionMultiplierDMG: DEFAULT_MULTIPLIERS.DMG,
        requiresApprovalAbove: 5000, // £50+ requires approval
        autoApproveBelow: 2000, // Auto-approve under £20
        shippingLabelEnabled: true,
        notifyOnSubmission: true,
        notifyOnReceived: true,
        notifyOnGraded: true,
      },
    });
  }

  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "updateGeneral": {
      const settings = await db.tradeInSettings.findFirst();
      if (!settings) return { error: "Settings not found" };

      await db.tradeInSettings.update({
        where: { id: settings.id },
        data: {
          minimumSubmissionValue: Math.round(parseFloat(formData.get("minimumSubmissionValue") as string || "5") * 100),
          requiresApprovalAbove: Math.round(parseFloat(formData.get("requiresApprovalAbove") as string || "50") * 100),
          autoApproveBelow: Math.round(parseFloat(formData.get("autoApproveBelow") as string || "20") * 100),
        },
      });

      return { success: true, action: "generalUpdated" };
    }

    case "updatePayouts": {
      const settings = await db.tradeInSettings.findFirst();
      if (!settings) return { error: "Settings not found" };

      await db.tradeInSettings.update({
        where: { id: settings.id },
        data: {
          storeCreditBonusPercent: parseInt(formData.get("storeCreditBonusPercent") as string || "10"),
          cashPayoutPercent: parseInt(formData.get("cashPayoutPercent") as string || "100"),
        },
      });

      return { success: true, action: "payoutsUpdated" };
    }

    case "updateConditions": {
      const settings = await db.tradeInSettings.findFirst();
      if (!settings) return { error: "Settings not found" };

      await db.tradeInSettings.update({
        where: { id: settings.id },
        data: {
          conditionMultiplierNM: parseFloat(formData.get("conditionMultiplierNM") as string || "0.70"),
          conditionMultiplierLP: parseFloat(formData.get("conditionMultiplierLP") as string || "0.55"),
          conditionMultiplierMP: parseFloat(formData.get("conditionMultiplierMP") as string || "0.40"),
          conditionMultiplierHP: parseFloat(formData.get("conditionMultiplierHP") as string || "0.25"),
          conditionMultiplierDMG: parseFloat(formData.get("conditionMultiplierDMG") as string || "0.10"),
        },
      });

      return { success: true, action: "conditionsUpdated" };
    }

    case "updateNotifications": {
      const settings = await db.tradeInSettings.findFirst();
      if (!settings) return { error: "Settings not found" };

      await db.tradeInSettings.update({
        where: { id: settings.id },
        data: {
          notifyOnSubmission: formData.get("notifyOnSubmission") === "on",
          notifyOnReceived: formData.get("notifyOnReceived") === "on",
          notifyOnGraded: formData.get("notifyOnGraded") === "on",
          shippingLabelEnabled: formData.get("shippingLabelEnabled") === "on",
        },
      });

      return { success: true, action: "notificationsUpdated" };
    }

    case "resetDefaults": {
      const settings = await db.tradeInSettings.findFirst();
      if (!settings) return { error: "Settings not found" };

      await db.tradeInSettings.update({
        where: { id: settings.id },
        data: {
          conditionMultiplierNM: DEFAULT_MULTIPLIERS.NM,
          conditionMultiplierLP: DEFAULT_MULTIPLIERS.LP,
          conditionMultiplierMP: DEFAULT_MULTIPLIERS.MP,
          conditionMultiplierHP: DEFAULT_MULTIPLIERS.HP,
          conditionMultiplierDMG: DEFAULT_MULTIPLIERS.DMG,
        },
      });

      return { success: true, action: "defaultsReset" };
    }

    default:
      return { error: "Unknown action" };
  }
};

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      const messages: Record<string, string> = {
        generalUpdated: "General settings saved",
        payoutsUpdated: "Payout settings saved",
        conditionsUpdated: "Condition multipliers saved",
        notificationsUpdated: "Notification settings saved",
        defaultsReset: "Reset to default multipliers",
      };
      shopify.toast.show(messages[fetcher.data.action] || "Settings saved");
    }
  }, [fetcher.data, shopify]);

  const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;

  return (
    <s-page heading="Trade-In Settings">
      {/* General Settings */}
      <s-section heading="General Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="updateGeneral" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Minimum Submission Value (£)"
              name="minimumSubmissionValue"
              type="number"
              step="0.01"
              defaultValue={(settings.minimumSubmissionValue / 100).toFixed(2)}
              helpText="Customers must meet this minimum value to submit a trade-in"
            />
            <s-text-field
              label="Requires Approval Above (£)"
              name="requiresApprovalAbove"
              type="number"
              step="0.01"
              defaultValue={(settings.requiresApprovalAbove / 100).toFixed(2)}
              helpText="Trade-ins above this value require manual approval before payout"
            />
            <s-text-field
              label="Auto-Approve Below (£)"
              name="autoApproveBelow"
              type="number"
              step="0.01"
              defaultValue={(settings.autoApproveBelow / 100).toFixed(2)}
              helpText="Trade-ins below this value are auto-approved after grading"
            />
            <s-button type="submit" loading={isLoading}>
              Save General Settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Payout Settings */}
      <s-section heading="Payout Settings">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="updatePayouts" />
          <s-stack direction="block" gap="base">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>
                Configure how customers are paid for their trade-ins. Store credit
                bonus encourages customers to take credit instead of cash.
              </s-paragraph>
            </s-box>
            <s-text-field
              label="Store Credit Bonus (%)"
              name="storeCreditBonusPercent"
              type="number"
              min="0"
              max="50"
              defaultValue={settings.storeCreditBonusPercent.toString()}
              helpText="Extra percentage added when customer chooses store credit (e.g., 10% bonus)"
            />
            <s-text-field
              label="Cash Payout Rate (%)"
              name="cashPayoutPercent"
              type="number"
              min="50"
              max="100"
              defaultValue={settings.cashPayoutPercent.toString()}
              helpText="Percentage of trade-in value paid out as cash (100% = full value)"
            />
            <s-button type="submit" loading={isLoading}>
              Save Payout Settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Condition Multipliers */}
      <s-section heading="Condition Multipliers">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="updateConditions" />
          <s-stack direction="block" gap="base">
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-paragraph>
                Set the percentage of market value paid for each card condition.
                For example, 0.70 = 70% of market price for NM condition.
              </s-paragraph>
            </s-box>
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Near Mint (NM)"
                name="conditionMultiplierNM"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={settings.conditionMultiplierNM.toString()}
                helpText={formatPercent(settings.conditionMultiplierNM)}
              />
              <s-text-field
                label="Lightly Played (LP)"
                name="conditionMultiplierLP"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={settings.conditionMultiplierLP.toString()}
                helpText={formatPercent(settings.conditionMultiplierLP)}
              />
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-text-field
                label="Moderately Played (MP)"
                name="conditionMultiplierMP"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={settings.conditionMultiplierMP.toString()}
                helpText={formatPercent(settings.conditionMultiplierMP)}
              />
              <s-text-field
                label="Heavily Played (HP)"
                name="conditionMultiplierHP"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={settings.conditionMultiplierHP.toString()}
                helpText={formatPercent(settings.conditionMultiplierHP)}
              />
            </s-stack>
            <s-text-field
              label="Damaged (DMG)"
              name="conditionMultiplierDMG"
              type="number"
              step="0.01"
              min="0"
              max="1"
              defaultValue={settings.conditionMultiplierDMG.toString()}
              helpText={formatPercent(settings.conditionMultiplierDMG)}
              style={{ maxWidth: "200px" }}
            />
            <s-stack direction="inline" gap="base">
              <s-button type="submit" loading={isLoading}>
                Save Condition Multipliers
              </s-button>
              <fetcher.Form method="post" style={{ display: "inline" }}>
                <input type="hidden" name="intent" value="resetDefaults" />
                <s-button variant="tertiary" type="submit">
                  Reset to Defaults
                </s-button>
              </fetcher.Form>
            </s-stack>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* Notifications */}
      <s-section heading="Notifications & Shipping">
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="updateNotifications" />
          <s-stack direction="block" gap="base">
            <s-checkbox
              name="notifyOnSubmission"
              defaultChecked={settings.notifyOnSubmission}
            >
              Notify me when a new trade-in is submitted
            </s-checkbox>
            <s-checkbox
              name="notifyOnReceived"
              defaultChecked={settings.notifyOnReceived}
            >
              Notify me when a trade-in package is received
            </s-checkbox>
            <s-checkbox
              name="notifyOnGraded"
              defaultChecked={settings.notifyOnGraded}
            >
              Notify me when grading is complete (for approval)
            </s-checkbox>
            <s-divider />
            <s-checkbox
              name="shippingLabelEnabled"
              defaultChecked={settings.shippingLabelEnabled}
            >
              Enable prepaid shipping labels for customers
            </s-checkbox>
            <s-button type="submit" loading={isLoading}>
              Save Notification Settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      {/* API Status Sidebar */}
      <s-section slot="aside" heading="API Connection">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="tight">
            <s-badge tone="success">Connected</s-badge>
            <s-text>Price API</s-text>
          </s-stack>
          <s-paragraph>
            Your app is connected to the external price API for fetching
            current market prices.
          </s-paragraph>
          <s-text tone="subdued">
            API: p5cfufhj0e.execute-api.us-east-1.amazonaws.com
          </s-text>
        </s-stack>
      </s-section>

      {/* Condition Guide Sidebar */}
      <s-section slot="aside" heading="Condition Guide">
        <s-stack direction="block" gap="tight">
          <s-text><strong>NM (Near Mint):</strong> Almost perfect condition</s-text>
          <s-text><strong>LP (Lightly Played):</strong> Minor wear, fully playable</s-text>
          <s-text><strong>MP (Moderately Played):</strong> Noticeable wear</s-text>
          <s-text><strong>HP (Heavily Played):</strong> Significant wear</s-text>
          <s-text><strong>DMG (Damaged):</strong> Major damage, creases, tears</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
