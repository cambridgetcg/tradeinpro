import { useState } from "react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Checkbox,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Box,
  RangeSlider,
  InlineGrid,
  Modal,
  Select,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getOrCreateSettings,
  updateSettings,
  parseReturnAddress,
  validateSettings,
  type ReturnAddress,
  type TradeInSettingsInput,
} from "../lib/settings.server";
import {
  getCTASettings,
  saveCTASettingsAndSync,
  DEFAULT_CTA_SETTINGS,
  type CTASettings,
} from "../lib/cta-settings.server";
import { formatPrice } from "../lib/constants";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  console.log("[app.settings loader] Starting settings load");

  try {
    const { session } = await authenticate.admin(request);
    console.log("[app.settings loader] Auth OK, shop:", session?.shop);
    const settings = await getOrCreateSettings(session.shop);
    const ctaSettings = await getCTASettings(session.shop);
    console.log("[app.settings loader] Settings loaded, id:", settings?.id);

    return {
      settings: {
        ...settings,
        returnAddress: parseReturnAddress(settings.returnAddress),
      },
      ctaSettings,
      royalMailConfigured: !!process.env.ROYAL_MAIL_API_KEY,
    };
  } catch (error) {
    console.error("[app.settings loader] Error:", error instanceof Error ? error.message : error);
    throw error;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveCTASettings") {
    const { admin } = await authenticate.admin(request);
    const { saveCTASettingsAndSync } = await import("../lib/cta-settings.server");

    const ctaInput = {
      ctaTitle: (formData.get("ctaTitle") as string) || null,
      ctaDescription: (formData.get("ctaDescription") as string) || null,
      ctaButtonText: (formData.get("ctaButtonText") as string) || null,
      ctaButtonLink: (formData.get("ctaButtonLink") as string) || null,
      ctaShowFeatures: formData.get("ctaShowFeatures") === "true",
      ctaFeature1Title: (formData.get("ctaFeature1Title") as string) || null,
      ctaFeature1Desc: (formData.get("ctaFeature1Desc") as string) || null,
      ctaFeature2Title: (formData.get("ctaFeature2Title") as string) || null,
      ctaFeature2Desc: (formData.get("ctaFeature2Desc") as string) || null,
      ctaFeature3Title: (formData.get("ctaFeature3Title") as string) || null,
      ctaFeature3Desc: (formData.get("ctaFeature3Desc") as string) || null,
    };

    const result = await saveCTASettingsAndSync(session.shop, admin, ctaInput);

    if (!result.syncSuccess) {
      return {
        success: true,
        message: "CTA settings saved locally, but sync to theme failed",
        warnings: result.syncErrors
      };
    }

    return { success: true, message: "CTA settings saved and synced to theme" };
  }

  if (intent === "saveSettings") {
    const input: TradeInSettingsInput = {
      // Pricing
      conditionMultiplierNM: parseFloat(formData.get("conditionMultiplierNM") as string) || undefined,
      conditionMultiplierLP: parseFloat(formData.get("conditionMultiplierLP") as string) || undefined,
      conditionMultiplierMP: parseFloat(formData.get("conditionMultiplierMP") as string) || undefined,
      conditionMultiplierHP: parseFloat(formData.get("conditionMultiplierHP") as string) || undefined,
      conditionMultiplierDMG: parseFloat(formData.get("conditionMultiplierDMG") as string) || undefined,
      storeCreditBonusPercent: parseInt(formData.get("storeCreditBonusPercent") as string) || undefined,
      cashPayoutPercent: parseInt(formData.get("cashPayoutPercent") as string) || undefined,

      // Thresholds (convert from pounds to pence)
      minimumSubmissionValue: Math.round(parseFloat(formData.get("minimumSubmissionValue") as string) * 100) || undefined,
      requiresApprovalAbove: Math.round(parseFloat(formData.get("requiresApprovalAbove") as string) * 100) || undefined,
      autoApproveBelow: Math.round(parseFloat(formData.get("autoApproveBelow") as string) * 100) || undefined,
      maxItemsPerSubmission: parseInt(formData.get("maxItemsPerSubmission") as string) || undefined,

      // Shipping
      freeShippingMinimum: Math.round(parseFloat(formData.get("freeShippingMinimum") as string) * 100) || undefined,
      shippingLabelEnabled: formData.get("shippingLabelEnabled") === "true",
      royalMailEnabled: formData.get("royalMailEnabled") === "true",
      royalMailService: (formData.get("royalMailService") as string) || undefined,

      // Notifications
      notifyOnSubmission: formData.get("notifyOnSubmission") === "true",
      notifyOnReceived: formData.get("notifyOnReceived") === "true",
      notifyOnGraded: formData.get("notifyOnGraded") === "true",

      // Content
      termsAndConditions: (formData.get("termsAndConditions") as string) || null,
      gradingGuideUrl: (formData.get("gradingGuideUrl") as string) || null,
    };

    // Parse return address if provided
    const addressName = formData.get("returnAddress.name") as string;
    if (addressName) {
      input.returnAddress = {
        name: addressName,
        company: (formData.get("returnAddress.company") as string) || undefined,
        address1: formData.get("returnAddress.address1") as string,
        address2: (formData.get("returnAddress.address2") as string) || undefined,
        city: formData.get("returnAddress.city") as string,
        province: (formData.get("returnAddress.province") as string) || undefined,
        postalCode: formData.get("returnAddress.postalCode") as string,
        country: formData.get("returnAddress.country") as string,
        phone: (formData.get("returnAddress.phone") as string) || undefined,
      };
    }

    const result = await updateSettings(session.shop, input);

    if (!result.success) {
      return { success: false, errors: result.errors };
    }

    return { success: true, message: "Settings saved successfully" };
  }

  return { success: false, errors: { form: "Unknown action" } };
};

export default function Settings() {
  const { settings, ctaSettings, royalMailConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Local form state
  const [formState, setFormState] = useState({
    // Pricing
    conditionMultiplierNM: settings.conditionMultiplierNM,
    conditionMultiplierLP: settings.conditionMultiplierLP,
    conditionMultiplierMP: settings.conditionMultiplierMP,
    conditionMultiplierHP: settings.conditionMultiplierHP,
    conditionMultiplierDMG: settings.conditionMultiplierDMG,
    storeCreditBonusPercent: settings.storeCreditBonusPercent,
    cashPayoutPercent: settings.cashPayoutPercent,

    // Thresholds (display in pounds)
    minimumSubmissionValue: settings.minimumSubmissionValue / 100,
    requiresApprovalAbove: settings.requiresApprovalAbove / 100,
    autoApproveBelow: settings.autoApproveBelow / 100,
    maxItemsPerSubmission: settings.maxItemsPerSubmission,

    // Shipping
    freeShippingMinimum: settings.freeShippingMinimum / 100,
    shippingLabelEnabled: settings.shippingLabelEnabled,
    returnAddress: settings.returnAddress as ReturnAddress | null,
    royalMailEnabled: settings.royalMailEnabled,
    royalMailService: settings.royalMailService,

    // Notifications
    notifyOnSubmission: settings.notifyOnSubmission,
    notifyOnReceived: settings.notifyOnReceived,
    notifyOnGraded: settings.notifyOnGraded,

    // Content
    termsAndConditions: settings.termsAndConditions || "",
    gradingGuideUrl: settings.gradingGuideUrl || "",
  });

  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<ReturnAddress | null>(
    formState.returnAddress
  );

  // CTA form state
  const [ctaState, setCtaState] = useState({
    ctaTitle: ctaSettings.ctaTitle || "",
    ctaDescription: ctaSettings.ctaDescription || "",
    ctaButtonText: ctaSettings.ctaButtonText || "",
    ctaButtonLink: ctaSettings.ctaButtonLink || "",
    ctaShowFeatures: ctaSettings.ctaShowFeatures,
    ctaFeature1Title: ctaSettings.ctaFeature1Title || "",
    ctaFeature1Desc: ctaSettings.ctaFeature1Desc || "",
    ctaFeature2Title: ctaSettings.ctaFeature2Title || "",
    ctaFeature2Desc: ctaSettings.ctaFeature2Desc || "",
    ctaFeature3Title: ctaSettings.ctaFeature3Title || "",
    ctaFeature3Desc: ctaSettings.ctaFeature3Desc || "",
  });

  const handleSave = () => {
    const formData = new FormData();
    formData.set("intent", "saveSettings");

    // Pricing
    formData.set("conditionMultiplierNM", formState.conditionMultiplierNM.toString());
    formData.set("conditionMultiplierLP", formState.conditionMultiplierLP.toString());
    formData.set("conditionMultiplierMP", formState.conditionMultiplierMP.toString());
    formData.set("conditionMultiplierHP", formState.conditionMultiplierHP.toString());
    formData.set("conditionMultiplierDMG", formState.conditionMultiplierDMG.toString());
    formData.set("storeCreditBonusPercent", formState.storeCreditBonusPercent.toString());
    formData.set("cashPayoutPercent", formState.cashPayoutPercent.toString());

    // Thresholds
    formData.set("minimumSubmissionValue", formState.minimumSubmissionValue.toString());
    formData.set("requiresApprovalAbove", formState.requiresApprovalAbove.toString());
    formData.set("autoApproveBelow", formState.autoApproveBelow.toString());
    formData.set("maxItemsPerSubmission", formState.maxItemsPerSubmission.toString());

    // Shipping
    formData.set("freeShippingMinimum", formState.freeShippingMinimum.toString());
    formData.set("shippingLabelEnabled", formState.shippingLabelEnabled.toString());
    formData.set("royalMailEnabled", formState.royalMailEnabled.toString());
    formData.set("royalMailService", formState.royalMailService);

    // Return address
    if (formState.returnAddress) {
      formData.set("returnAddress.name", formState.returnAddress.name);
      formData.set("returnAddress.company", formState.returnAddress.company || "");
      formData.set("returnAddress.address1", formState.returnAddress.address1);
      formData.set("returnAddress.address2", formState.returnAddress.address2 || "");
      formData.set("returnAddress.city", formState.returnAddress.city);
      formData.set("returnAddress.province", formState.returnAddress.province || "");
      formData.set("returnAddress.postalCode", formState.returnAddress.postalCode);
      formData.set("returnAddress.country", formState.returnAddress.country);
      formData.set("returnAddress.phone", formState.returnAddress.phone || "");
    }

    // Notifications
    formData.set("notifyOnSubmission", formState.notifyOnSubmission.toString());
    formData.set("notifyOnReceived", formState.notifyOnReceived.toString());
    formData.set("notifyOnGraded", formState.notifyOnGraded.toString());

    // Content
    formData.set("termsAndConditions", formState.termsAndConditions);
    formData.set("gradingGuideUrl", formState.gradingGuideUrl);

    submit(formData, { method: "post" });
  };

  const handleAddressSave = () => {
    if (editingAddress) {
      setFormState({ ...formState, returnAddress: editingAddress });
    }
    setAddressModalOpen(false);
  };

  const handleSaveCTA = () => {
    const formData = new FormData();
    formData.set("intent", "saveCTASettings");
    formData.set("ctaTitle", ctaState.ctaTitle);
    formData.set("ctaDescription", ctaState.ctaDescription);
    formData.set("ctaButtonText", ctaState.ctaButtonText);
    formData.set("ctaButtonLink", ctaState.ctaButtonLink);
    formData.set("ctaShowFeatures", ctaState.ctaShowFeatures.toString());
    formData.set("ctaFeature1Title", ctaState.ctaFeature1Title);
    formData.set("ctaFeature1Desc", ctaState.ctaFeature1Desc);
    formData.set("ctaFeature2Title", ctaState.ctaFeature2Title);
    formData.set("ctaFeature2Desc", ctaState.ctaFeature2Desc);
    formData.set("ctaFeature3Title", ctaState.ctaFeature3Title);
    formData.set("ctaFeature3Desc", ctaState.ctaFeature3Desc);
    submit(formData, { method: "post" });
  };

  const errors = actionData && !actionData.success ? actionData.errors || {} : {};

  return (
    <Page
      title="Settings"
      primaryAction={{
        content: isSubmitting ? "Saving..." : "Save",
        onAction: handleSave,
        loading: isSubmitting,
      }}
    >
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              Settings saved successfully
            </Banner>
          </Layout.Section>
        )}

        {Object.keys(errors).length > 0 && (
          <Layout.Section>
            <Banner tone="critical">
              <p>Please fix the following errors:</p>
              <ul>
                {Object.entries(errors).map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            </Banner>
          </Layout.Section>
        )}

        {/* Pricing Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Pricing
              </Text>
              <Text as="p" tone="subdued">
                Configure condition multipliers and payout bonuses
              </Text>

              <Divider />

              <Text as="h3" variant="headingSm">
                Condition Multipliers
              </Text>
              <Text as="p" tone="subdued">
                Percentage of trade-in value offered for each card condition
              </Text>

              <BlockStack gap="400">
                <InlineGrid columns={2} gap="400">
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Near Mint (NM): {Math.round(formState.conditionMultiplierNM * 100)}%
                    </Text>
                    <RangeSlider
                      label=""
                      value={formState.conditionMultiplierNM * 100}
                      min={10}
                      max={100}
                      step={5}
                      onChange={(value) =>
                        setFormState({
                          ...formState,
                          conditionMultiplierNM: (value as number) / 100,
                        })
                      }
                      suffix={
                        <Text as="span" tone="subdued">
                          {formatPrice(1000 * formState.conditionMultiplierNM)} per {formatPrice(1000)}
                        </Text>
                      }
                    />
                  </div>
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Lightly Played (LP): {Math.round(formState.conditionMultiplierLP * 100)}%
                    </Text>
                    <RangeSlider
                      label=""
                      value={formState.conditionMultiplierLP * 100}
                      min={10}
                      max={100}
                      step={5}
                      onChange={(value) =>
                        setFormState({
                          ...formState,
                          conditionMultiplierLP: (value as number) / 100,
                        })
                      }
                      suffix={
                        <Text as="span" tone="subdued">
                          {formatPrice(1000 * formState.conditionMultiplierLP)} per {formatPrice(1000)}
                        </Text>
                      }
                    />
                  </div>
                </InlineGrid>

                <InlineGrid columns={2} gap="400">
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Moderately Played (MP): {Math.round(formState.conditionMultiplierMP * 100)}%
                    </Text>
                    <RangeSlider
                      label=""
                      value={formState.conditionMultiplierMP * 100}
                      min={10}
                      max={100}
                      step={5}
                      onChange={(value) =>
                        setFormState({
                          ...formState,
                          conditionMultiplierMP: (value as number) / 100,
                        })
                      }
                      suffix={
                        <Text as="span" tone="subdued">
                          {formatPrice(1000 * formState.conditionMultiplierMP)} per {formatPrice(1000)}
                        </Text>
                      }
                    />
                  </div>
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Heavily Played (HP): {Math.round(formState.conditionMultiplierHP * 100)}%
                    </Text>
                    <RangeSlider
                      label=""
                      value={formState.conditionMultiplierHP * 100}
                      min={5}
                      max={100}
                      step={5}
                      onChange={(value) =>
                        setFormState({
                          ...formState,
                          conditionMultiplierHP: (value as number) / 100,
                        })
                      }
                      suffix={
                        <Text as="span" tone="subdued">
                          {formatPrice(1000 * formState.conditionMultiplierHP)} per {formatPrice(1000)}
                        </Text>
                      }
                    />
                  </div>
                </InlineGrid>

                <InlineGrid columns={2} gap="400">
                  <div>
                    <Text as="p" variant="bodySm" fontWeight="medium">
                      Damaged (DMG): {Math.round(formState.conditionMultiplierDMG * 100)}%
                    </Text>
                    <RangeSlider
                      label=""
                      value={formState.conditionMultiplierDMG * 100}
                      min={5}
                      max={100}
                      step={5}
                      onChange={(value) =>
                        setFormState({
                          ...formState,
                          conditionMultiplierDMG: (value as number) / 100,
                        })
                      }
                      suffix={
                        <Text as="span" tone="subdued">
                          {formatPrice(1000 * formState.conditionMultiplierDMG)} per {formatPrice(1000)}
                        </Text>
                      }
                    />
                  </div>
                  <div />
                </InlineGrid>
              </BlockStack>

              <Divider />

              <Text as="h3" variant="headingSm">
                Payout Settings
              </Text>

              <InlineGrid columns={2} gap="400">
                <div>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Store Credit Bonus: {formState.storeCreditBonusPercent}%
                  </Text>
                  <RangeSlider
                    label=""
                    value={formState.storeCreditBonusPercent}
                    min={0}
                    max={50}
                    step={5}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        storeCreditBonusPercent: value as number,
                      })
                    }
                    suffix={
                      <Text as="span" tone="subdued">
                        +{formatPrice(1000 * (formState.storeCreditBonusPercent / 100))} per {formatPrice(1000)}
                      </Text>
                    }
                  />
                </div>
                <div>
                  <Text as="p" variant="bodySm" fontWeight="medium">
                    Cash Payout Rate: {formState.cashPayoutPercent}%
                  </Text>
                  <RangeSlider
                    label=""
                    value={formState.cashPayoutPercent}
                    min={50}
                    max={100}
                    step={5}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        cashPayoutPercent: value as number,
                      })
                    }
                    suffix={
                      <Text as="span" tone="subdued">
                        {formatPrice(1000 * (formState.cashPayoutPercent / 100))} per {formatPrice(1000)}
                      </Text>
                    }
                  />
                </div>
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Thresholds Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Thresholds
              </Text>
              <Text as="p" tone="subdued">
                Configure submission limits and approval thresholds
              </Text>

              <Divider />

              <FormLayout>
                <FormLayout.Group>
                  <TextField
                    label="Minimum Submission Value"
                    type="number"
                    value={formState.minimumSubmissionValue.toString()}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        minimumSubmissionValue: parseFloat(value) || 0,
                      })
                    }
                    prefix="£"
                    helpText="Minimum total value required for a submission"
                    autoComplete="off"
                    error={errors.minimumSubmissionValue}
                  />
                  <TextField
                    label="Max Items Per Submission"
                    type="number"
                    value={formState.maxItemsPerSubmission.toString()}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        maxItemsPerSubmission: parseInt(value) || 1,
                      })
                    }
                    helpText="Maximum number of cards in a single submission"
                    autoComplete="off"
                    error={errors.maxItemsPerSubmission}
                  />
                </FormLayout.Group>
                <FormLayout.Group>
                  <TextField
                    label="Auto-Approve Below"
                    type="number"
                    value={formState.autoApproveBelow.toString()}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        autoApproveBelow: parseFloat(value) || 0,
                      })
                    }
                    prefix="£"
                    helpText="Submissions below this value are auto-approved after grading"
                    autoComplete="off"
                    error={errors.autoApproveBelow}
                  />
                  <TextField
                    label="Requires Approval Above"
                    type="number"
                    value={formState.requiresApprovalAbove.toString()}
                    onChange={(value) =>
                      setFormState({
                        ...formState,
                        requiresApprovalAbove: parseFloat(value) || 0,
                      })
                    }
                    prefix="£"
                    helpText="Submissions above this value require manual approval"
                    autoComplete="off"
                    error={errors.requiresApprovalAbove}
                  />
                </FormLayout.Group>
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Shipping Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Shipping
              </Text>
              <Text as="p" tone="subdued">
                Configure shipping labels and return address
              </Text>

              <Divider />

              <FormLayout>
                <Checkbox
                  label="Enable prepaid shipping labels"
                  checked={formState.shippingLabelEnabled}
                  onChange={(checked) =>
                    setFormState({ ...formState, shippingLabelEnabled: checked })
                  }
                  helpText="Allow customers to print prepaid shipping labels"
                />

                <TextField
                  label="Free Shipping Above"
                  type="number"
                  value={formState.freeShippingMinimum.toString()}
                  onChange={(value) =>
                    setFormState({
                      ...formState,
                      freeShippingMinimum: parseFloat(value) || 0,
                    })
                  }
                  prefix="£"
                  helpText="Submissions above this value qualify for free prepaid shipping"
                  autoComplete="off"
                />
              </FormLayout>

              <Divider />

              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Royal Mail Integration
                </Text>
                {royalMailConfigured ? (
                  <Badge tone="success">API Key Configured</Badge>
                ) : (
                  <Badge tone="warning">API Key Not Set</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued">
                Generate prepaid shipping labels via Royal Mail Click &amp; Drop
              </Text>

              <FormLayout>
                <Checkbox
                  label="Enable Royal Mail labels"
                  checked={formState.royalMailEnabled}
                  onChange={(checked) =>
                    setFormState({ ...formState, royalMailEnabled: checked })
                  }
                  helpText="When enabled, customers qualifying for free shipping can get prepaid Royal Mail labels"
                  disabled={!royalMailConfigured}
                />

                <Select
                  label="Royal Mail Service"
                  options={[
                    { label: "Tracked 48 (2-3 days)", value: "TPN" },
                    { label: "Tracked 24 (Next day)", value: "TPS" },
                  ]}
                  value={formState.royalMailService}
                  onChange={(value) =>
                    setFormState({ ...formState, royalMailService: value })
                  }
                  disabled={!formState.royalMailEnabled}
                  helpText="Shipping service used for prepaid labels"
                />
              </FormLayout>

              {!royalMailConfigured && (
                <Banner tone="info">
                  <p>
                    To enable Royal Mail integration, add your Click &amp; Drop API key
                    to the environment variable <code>ROYAL_MAIL_API_KEY</code>.
                    Get your API key from the{" "}
                    <a
                      href="https://auth.parcel.royalmail.com/account/login"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Royal Mail Click &amp; Drop dashboard
                    </a>
                    .
                  </p>
                </Banner>
              )}

              <Divider />

              <Text as="h3" variant="headingSm">
                Return Address
              </Text>

              {formState.returnAddress ? (
                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <InlineStack align="space-between">
                    <BlockStack gap="100">
                      <Text as="p" fontWeight="semibold">
                        {formState.returnAddress.name}
                      </Text>
                      {formState.returnAddress.company && (
                        <Text as="p">{formState.returnAddress.company}</Text>
                      )}
                      <Text as="p">{formState.returnAddress.address1}</Text>
                      {formState.returnAddress.address2 && (
                        <Text as="p">{formState.returnAddress.address2}</Text>
                      )}
                      <Text as="p">
                        {formState.returnAddress.city}
                        {formState.returnAddress.province && `, ${formState.returnAddress.province}`}{" "}
                        {formState.returnAddress.postalCode}
                      </Text>
                      <Text as="p">{formState.returnAddress.country}</Text>
                    </BlockStack>
                    <Button
                      onClick={() => {
                        setEditingAddress(formState.returnAddress);
                        setAddressModalOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </InlineStack>
                </Box>
              ) : (
                <Button
                  onClick={() => {
                    setEditingAddress({
                      name: "",
                      address1: "",
                      city: "",
                      postalCode: "",
                      country: "GB",
                    });
                    setAddressModalOpen(true);
                  }}
                >
                  Add Return Address
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Notifications Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Notifications
              </Text>
              <Text as="p" tone="subdued">
                Configure email notifications for trade-in events
              </Text>

              <Divider />

              <FormLayout>
                <Checkbox
                  label="Notify me on new submissions"
                  checked={formState.notifyOnSubmission}
                  onChange={(checked) =>
                    setFormState({ ...formState, notifyOnSubmission: checked })
                  }
                  helpText="Receive an email when a customer submits a trade-in"
                />
                <Checkbox
                  label="Notify customer when package received"
                  checked={formState.notifyOnReceived}
                  onChange={(checked) =>
                    setFormState({ ...formState, notifyOnReceived: checked })
                  }
                  helpText="Send email to customer when their package is received"
                />
                <Checkbox
                  label="Notify customer when grading complete"
                  checked={formState.notifyOnGraded}
                  onChange={(checked) =>
                    setFormState({ ...formState, notifyOnGraded: checked })
                  }
                  helpText="Send email to customer with grading results"
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* CTA Block Settings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Trade-In CTA Block
                  </Text>
                  <Text as="p" tone="subdued">
                    Customize the promotional banner shown on your storefront
                  </Text>
                </BlockStack>
                <Button onClick={handleSaveCTA} loading={isSubmitting}>
                  Save CTA
                </Button>
              </InlineStack>

              <Divider />

              <FormLayout>
                <TextField
                  label="Title"
                  value={ctaState.ctaTitle}
                  onChange={(value) => setCtaState({ ...ctaState, ctaTitle: value })}
                  placeholder="Trade In Your Cards"
                  helpText="Main headline for the CTA block"
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={ctaState.ctaDescription}
                  onChange={(value) => setCtaState({ ...ctaState, ctaDescription: value })}
                  placeholder="Turn your trading cards into cash or store credit"
                  helpText="Supporting text below the title"
                  autoComplete="off"
                />
                <FormLayout.Group>
                  <TextField
                    label="Button Text"
                    value={ctaState.ctaButtonText}
                    onChange={(value) => setCtaState({ ...ctaState, ctaButtonText: value })}
                    placeholder="Start Trade-In"
                    autoComplete="off"
                  />
                  <TextField
                    label="Button Link"
                    value={ctaState.ctaButtonLink}
                    onChange={(value) => setCtaState({ ...ctaState, ctaButtonLink: value })}
                    placeholder="/pages/trade-in"
                    helpText="URL to your trade-in page"
                    autoComplete="off"
                  />
                </FormLayout.Group>
              </FormLayout>

              <Divider />

              <Checkbox
                label="Show feature highlights"
                checked={ctaState.ctaShowFeatures}
                onChange={(checked) => setCtaState({ ...ctaState, ctaShowFeatures: checked })}
                helpText="Display 3 feature highlights below the CTA button"
              />

              {ctaState.ctaShowFeatures && (
                <BlockStack gap="400">
                  <Text as="h3" variant="headingSm">
                    Feature Highlights
                  </Text>
                  <InlineGrid columns={3} gap="400">
                    <BlockStack gap="200">
                      <TextField
                        label="Feature 1 Title"
                        value={ctaState.ctaFeature1Title}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature1Title: value })}
                        placeholder="Fast Payouts"
                        autoComplete="off"
                      />
                      <TextField
                        label="Feature 1 Description"
                        value={ctaState.ctaFeature1Desc}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature1Desc: value })}
                        placeholder="Get paid within 48 hours"
                        autoComplete="off"
                      />
                    </BlockStack>
                    <BlockStack gap="200">
                      <TextField
                        label="Feature 2 Title"
                        value={ctaState.ctaFeature2Title}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature2Title: value })}
                        placeholder="10% Bonus"
                        autoComplete="off"
                      />
                      <TextField
                        label="Feature 2 Description"
                        value={ctaState.ctaFeature2Desc}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature2Desc: value })}
                        placeholder="Extra 10% for store credit"
                        autoComplete="off"
                      />
                    </BlockStack>
                    <BlockStack gap="200">
                      <TextField
                        label="Feature 3 Title"
                        value={ctaState.ctaFeature3Title}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature3Title: value })}
                        placeholder="Free Shipping"
                        autoComplete="off"
                      />
                      <TextField
                        label="Feature 3 Description"
                        value={ctaState.ctaFeature3Desc}
                        onChange={(value) => setCtaState({ ...ctaState, ctaFeature3Desc: value })}
                        placeholder="On orders over £50"
                        autoComplete="off"
                      />
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Content Section */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Content
              </Text>
              <Text as="p" tone="subdued">
                Customize terms and grading guide
              </Text>

              <Divider />

              <FormLayout>
                <TextField
                  label="Grading Guide URL"
                  type="url"
                  value={formState.gradingGuideUrl}
                  onChange={(value) =>
                    setFormState({ ...formState, gradingGuideUrl: value })
                  }
                  placeholder="https://example.com/grading-guide"
                  helpText="Link to your card grading guide (shown to customers)"
                  autoComplete="off"
                  error={errors.gradingGuideUrl}
                />

                <TextField
                  label="Terms and Conditions"
                  value={formState.termsAndConditions}
                  onChange={(value) =>
                    setFormState({ ...formState, termsAndConditions: value })
                  }
                  multiline={8}
                  helpText="Terms customers must accept when submitting trade-ins"
                  autoComplete="off"
                  error={errors.termsAndConditions}
                  showCharacterCount
                  maxLength={10000}
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Return Address Modal */}
      <Modal
        open={addressModalOpen}
        onClose={() => setAddressModalOpen(false)}
        title="Return Address"
        primaryAction={{
          content: "Save Address",
          onAction: handleAddressSave,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setAddressModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Name"
              value={editingAddress?.name || ""}
              onChange={(value) =>
                setEditingAddress({ ...editingAddress!, name: value })
              }
              autoComplete="name"
              requiredIndicator
            />
            <TextField
              label="Company (optional)"
              value={editingAddress?.company || ""}
              onChange={(value) =>
                setEditingAddress({ ...editingAddress!, company: value })
              }
              autoComplete="organization"
            />
            <TextField
              label="Address Line 1"
              value={editingAddress?.address1 || ""}
              onChange={(value) =>
                setEditingAddress({ ...editingAddress!, address1: value })
              }
              autoComplete="address-line1"
              requiredIndicator
            />
            <TextField
              label="Address Line 2 (optional)"
              value={editingAddress?.address2 || ""}
              onChange={(value) =>
                setEditingAddress({ ...editingAddress!, address2: value })
              }
              autoComplete="address-line2"
            />
            <FormLayout.Group>
              <TextField
                label="City"
                value={editingAddress?.city || ""}
                onChange={(value) =>
                  setEditingAddress({ ...editingAddress!, city: value })
                }
                autoComplete="address-level2"
                requiredIndicator
              />
              <TextField
                label="County/Province (optional)"
                value={editingAddress?.province || ""}
                onChange={(value) =>
                  setEditingAddress({ ...editingAddress!, province: value })
                }
                autoComplete="address-level1"
              />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField
                label="Postal Code"
                value={editingAddress?.postalCode || ""}
                onChange={(value) =>
                  setEditingAddress({ ...editingAddress!, postalCode: value })
                }
                autoComplete="postal-code"
                requiredIndicator
              />
              <TextField
                label="Country Code"
                value={editingAddress?.country || ""}
                onChange={(value) =>
                  setEditingAddress({
                    ...editingAddress!,
                    country: value.toUpperCase(),
                  })
                }
                placeholder="GB"
                helpText="2-letter ISO code (e.g., GB, US)"
                autoComplete="country"
                requiredIndicator
              />
            </FormLayout.Group>
            <TextField
              label="Phone (optional)"
              value={editingAddress?.phone || ""}
              onChange={(value) =>
                setEditingAddress({ ...editingAddress!, phone: value })
              }
              autoComplete="tel"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
