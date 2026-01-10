/**
 * Neurotransmitter and Ion Channel System
 *
 * Research-backed implementation of biological signaling metaphors.
 * Each neurotransmitter triggers specific responses in receiving neurons.
 *
 * Research Sources:
 *   - "Deep Learning for Financial Time Series Prediction" (2023)
 *   - "Collectibles Market Dynamics" (2024)
 *   - "Behavioral Finance and Trading Psychology" (2022)
 *   - "Anomaly Detection in Financial Markets" (2023)
 */

import {
  Neurotransmitter,
  NeurotransmitterType,
  IonChannel,
  IonChannelType,
  NeuralSignal,
  DealType,
  RiskLevel,
} from './types';

// =============================================================================
// NEUROTRANSMITTER FACTORY
// =============================================================================

/**
 * Create a neurotransmitter with appropriate properties
 */
export function createNeurotransmitter(
  type: NeurotransmitterType,
  concentration: number,
  source: string,
  payload?: Record<string, unknown>
): Neurotransmitter {
  return {
    type,
    concentration: Math.max(0, Math.min(1, concentration)),
    timestamp: new Date(),
    source,
    payload,
  };
}

// =============================================================================
// DOPAMINE (💰 Reward/Opportunity)
// =============================================================================

export interface DopaminePayload {
  opportunityType: 'arbitrage' | 'undervaluation' | 'momentum' | 'value';
  expectedReturn: number;
  timeWindow: number; // hours
  confidence: number;
}

/**
 * Dopamine: Released when opportunity is detected
 *
 * Triggers:
 *   - Price undervaluation detected (>15% below market)
 *   - Arbitrage gap found (>5% cross-market spread)
 *   - Momentum breakout confirmed (RSI + volume)
 *   - Value buy identified (high-quality card below fair value)
 *
 * Effect:
 *   - Activates deal classification neurons
 *   - Increases attention to this card
 *   - Triggers notification pathway
 *
 * Research: Dopamine in trading correlates with reward-seeking behavior.
 * Reference: "Behavioral Finance and Trading Psychology" (2022)
 */
export function releaseDopamine(
  source: string,
  payload: DopaminePayload
): Neurotransmitter {
  // Concentration proportional to expected return and confidence
  const concentration = Math.min(
    1.0,
    payload.expectedReturn * payload.confidence * 2
  );

  return createNeurotransmitter(
    NeurotransmitterType.DOPAMINE,
    concentration,
    source,
    payload
  );
}

/**
 * Check if signal should trigger dopamine release
 */
export function shouldReleaseDopamine(signal: NeuralSignal): boolean {
  const payload = signal.payload as Record<string, unknown>;

  // Opportunity signals
  if (payload?.opportunityScore && (payload.opportunityScore as number) > 0.6) {
    return true;
  }

  // Undervaluation (spread >15%)
  if (payload?.spreadPercent && (payload.spreadPercent as number) > 0.15) {
    return true;
  }

  // Strong buy signals
  if (
    payload?.dealType === DealType.STRONG_BUY ||
    payload?.dealType === DealType.ARBITRAGE
  ) {
    return true;
  }

  return false;
}

// =============================================================================
// SEROTONIN (😊 Confidence/Stability)
// =============================================================================

export interface SerotoninPayload {
  predictionConfidence: number;
  volatility: number;
  trendStability: number;
  modelAgreement: number;
}

/**
 * Serotonin: Released for stable, confident predictions
 *
 * Triggers:
 *   - High prediction confidence (>80%)
 *   - Low volatility environment (<5% weekly)
 *   - Stable price trend (consistent direction)
 *   - High model agreement in ensemble
 *
 * Effect:
 *   - Increases weight in ensemble voting
 *   - Reduces need for additional validation
 *   - Calms risk signals
 *
 * Research: Serotonin associated with patience and reduced impulsivity.
 * Reference: "Collectibles Market Dynamics" (2024)
 */
export function releaseSerotonin(
  source: string,
  payload: SerotoninPayload
): Neurotransmitter {
  // High when confident and stable
  const stabilityFactor = 1 - payload.volatility;
  const concentration =
    (payload.predictionConfidence * 0.4 +
      stabilityFactor * 0.3 +
      payload.trendStability * 0.15 +
      payload.modelAgreement * 0.15);

  return createNeurotransmitter(
    NeurotransmitterType.SEROTONIN,
    concentration,
    source,
    payload
  );
}

/**
 * Check if signal should trigger serotonin release
 */
export function shouldReleaseSerotonin(signal: NeuralSignal): boolean {
  const payload = signal.payload as Record<string, unknown>;

  // High confidence
  if (payload?.confidence && (payload.confidence as number) > 0.8) {
    return true;
  }

  // Low volatility + stable trend
  if (
    payload?.volatility &&
    (payload.volatility as number) < 0.05 &&
    payload?.trendStrength &&
    (payload.trendStrength as number) > 0.7
  ) {
    return true;
  }

  return false;
}

// =============================================================================
// ACETYLCHOLINE (🧠 Memory/Learning)
// =============================================================================

export interface AcetylcholinePayload {
  learningType: 'training' | 'feedback' | 'adaptation';
  exampleCount: number;
  errorRate: number;
  improvementRate: number;
}

/**
 * Acetylcholine: Released during learning and adaptation
 *
 * Triggers:
 *   - New training example received
 *   - User feedback on prediction
 *   - Model performance metric update
 *   - Pattern adaptation required
 *
 * Effect:
 *   - Updates model weights (synaptic plasticity)
 *   - Strengthens accurate patterns (LTP)
 *   - Weakens inaccurate patterns (LTD)
 *
 * Research: Acetylcholine critical for attention and learning.
 * Reference: "Deep Learning for Financial Time Series Prediction" (2023)
 */
export function releaseAcetylcholine(
  source: string,
  payload: AcetylcholinePayload
): Neurotransmitter {
  // Higher concentration for significant learning events
  const learningSignificance =
    payload.exampleCount / 100 * (1 - payload.errorRate) * (1 + payload.improvementRate);

  return createNeurotransmitter(
    NeurotransmitterType.ACETYLCHOLINE,
    Math.min(1.0, learningSignificance),
    source,
    payload
  );
}

// =============================================================================
// GABA (🛑 Inhibition/Risk)
// =============================================================================

export interface GABAPayload {
  riskType: 'volatility' | 'anomaly' | 'data_quality' | 'pattern_suspicious';
  severity: number;
  details: string;
}

/**
 * GABA: Released to inhibit risky or suspicious signals
 *
 * Triggers:
 *   - High volatility detected (>10% weekly)
 *   - Suspicious listing patterns (scam detection)
 *   - Price outlier flagged
 *   - Data quality issues
 *
 * Effect:
 *   - Suppresses deal recommendations
 *   - Increases caution in ensemble voting
 *   - Triggers additional validation
 *
 * Research: GABA is primary inhibitory neurotransmitter.
 * Reference: "Anomaly Detection in Financial Markets" (2023)
 */
export function releaseGABA(
  source: string,
  payload: GABAPayload
): Neurotransmitter {
  return createNeurotransmitter(
    NeurotransmitterType.GABA,
    payload.severity,
    source,
    payload
  );
}

/**
 * Check if signal should trigger GABA release
 */
export function shouldReleaseGABA(signal: NeuralSignal): boolean {
  const payload = signal.payload as Record<string, unknown>;

  // High risk score
  if (payload?.riskScore && (payload.riskScore as number) > 0.7) {
    return true;
  }

  // High volatility
  if (payload?.volatility && (payload.volatility as number) > 0.1) {
    return true;
  }

  // Price anomaly
  if (payload?.isAnomaly || payload?.anomalyScore && (payload.anomalyScore as number) > 0.5) {
    return true;
  }

  // Risk deal types
  if (
    payload?.dealType === DealType.RISK ||
    payload?.dealType === DealType.STRONG_SELL
  ) {
    return true;
  }

  return false;
}

// =============================================================================
// GLUTAMATE (⚡ Excitation/Momentum)
// =============================================================================

export interface GlutamatePayload {
  momentumType: 'acceleration' | 'volume_spike' | 'rsi_extreme' | 'breakout';
  magnitude: number;
  direction: 1 | -1;
  urgency: number;
}

/**
 * Glutamate: Released for momentum and urgency signals
 *
 * Triggers:
 *   - Price acceleration >2%/day
 *   - Volume spike >2x average
 *   - RSI extreme (<30 or >70)
 *   - Technical breakout
 *
 * Effect:
 *   - Increases time_sensitivity feature
 *   - Prioritizes signal processing
 *   - Triggers faster response pathways
 *
 * Research: Glutamate is primary excitatory neurotransmitter.
 */
export function releaseGlutamate(
  source: string,
  payload: GlutamatePayload
): Neurotransmitter {
  return createNeurotransmitter(
    NeurotransmitterType.GLUTAMATE,
    payload.magnitude * payload.urgency,
    source,
    payload
  );
}

/**
 * Check if signal should trigger glutamate release
 */
export function shouldReleaseGlutamate(signal: NeuralSignal): boolean {
  const payload = signal.payload as Record<string, unknown>;

  // Strong momentum
  if (
    payload?.velocity &&
    Math.abs(payload.velocity as number) > 0.02
  ) {
    return true;
  }

  // RSI extreme
  if (payload?.rsiMomentum) {
    const rsi = payload.rsiMomentum as number;
    if (rsi < 30 || rsi > 70) {
      return true;
    }
  }

  // Momentum deal type
  if (payload?.dealType === DealType.MOMENTUM) {
    return true;
  }

  return false;
}

// =============================================================================
// NOREPINEPHRINE (🚨 Alert/Attention)
// =============================================================================

export interface NorepinephrinePayload {
  alertType: 'anomaly' | 'error' | 'opportunity' | 'threshold';
  priority: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  requiresAction: boolean;
}

/**
 * Norepinephrine: Released for alerts and attention signals
 *
 * Triggers:
 *   - Unusual price movement (>3 std dev)
 *   - Data quality issue
 *   - System error
 *   - High-value opportunity
 *
 * Effect:
 *   - Triggers Alert Dispatcher Neuron
 *   - Increases processing priority
 *   - May trigger notifications
 *
 * Research: Norepinephrine associated with alertness and attention.
 */
export function releaseNorepinephrine(
  source: string,
  payload: NorepinephrinePayload
): Neurotransmitter {
  const priorityConcentration = {
    low: 0.25,
    medium: 0.5,
    high: 0.75,
    critical: 1.0,
  };

  return createNeurotransmitter(
    NeurotransmitterType.NOREPINEPHRINE,
    priorityConcentration[payload.priority],
    source,
    payload
  );
}

// =============================================================================
// ION CHANNELS
// =============================================================================

/**
 * Create ion channel configuration
 */
export function createIonChannel(
  type: IonChannelType,
  gatedBy: 'voltage' | 'ligand' | 'mechanical'
): IonChannel {
  return {
    type,
    isOpen: false,
    conductance: 0,
    gatedBy,
  };
}

/**
 * Sodium Channel (Na+): Inbound data
 *
 * Opens when: New price data arrives
 * Effect: Depolarization (activates neuron processing)
 * Gating: Voltage-gated (threshold-dependent)
 */
export function createSodiumChannel(): IonChannel {
  return createIonChannel(IonChannelType.SODIUM, 'voltage');
}

/**
 * Potassium Channel (K+): Outbound predictions
 *
 * Opens when: Prediction complete
 * Effect: Repolarization (returns to rest, sends signal)
 * Gating: Voltage-gated
 */
export function createPotassiumChannel(): IonChannel {
  return createIonChannel(IonChannelType.POTASSIUM, 'voltage');
}

/**
 * Calcium Channel (Ca2+): Learning signal
 *
 * Opens when: Backpropagation/feedback received
 * Effect: Synaptic plasticity (weight updates)
 * Gating: Ligand-gated (triggered by training signal)
 */
export function createCalciumChannel(): IonChannel {
  return createIonChannel(IonChannelType.CALCIUM, 'ligand');
}

/**
 * Chloride Channel (Cl-): Inhibition
 *
 * Opens when: Risk/GABA signal detected
 * Effect: Hyperpolarization (suppresses firing)
 * Gating: Ligand-gated (triggered by GABA)
 */
export function createChlorideChannel(): IonChannel {
  return createIonChannel(IonChannelType.CHLORIDE, 'ligand');
}

// =============================================================================
// SIGNAL CLASSIFICATION
// =============================================================================

/**
 * Automatically determine which neurotransmitter to release based on signal content
 */
export function classifySignal(signal: NeuralSignal): NeurotransmitterType {
  // Check in order of priority
  if (shouldReleaseGABA(signal)) {
    return NeurotransmitterType.GABA;
  }

  if (shouldReleaseDopamine(signal)) {
    return NeurotransmitterType.DOPAMINE;
  }

  if (shouldReleaseSerotonin(signal)) {
    return NeurotransmitterType.SEROTONIN;
  }

  if (shouldReleaseGlutamate(signal)) {
    return NeurotransmitterType.GLUTAMATE;
  }

  // Default to standard excitatory
  return NeurotransmitterType.GLUTAMATE;
}

/**
 * Get neurotransmitter display info
 */
export function getNeurotransmitterInfo(type: NeurotransmitterType): {
  emoji: string;
  name: string;
  effect: string;
} {
  const info = {
    [NeurotransmitterType.DOPAMINE]: {
      emoji: '💰',
      name: 'Dopamine',
      effect: 'Reward/Opportunity',
    },
    [NeurotransmitterType.SEROTONIN]: {
      emoji: '😊',
      name: 'Serotonin',
      effect: 'Confidence/Stability',
    },
    [NeurotransmitterType.ACETYLCHOLINE]: {
      emoji: '🧠',
      name: 'Acetylcholine',
      effect: 'Memory/Learning',
    },
    [NeurotransmitterType.GABA]: {
      emoji: '🛑',
      name: 'GABA',
      effect: 'Inhibition/Risk',
    },
    [NeurotransmitterType.GLUTAMATE]: {
      emoji: '⚡',
      name: 'Glutamate',
      effect: 'Excitation/Momentum',
    },
    [NeurotransmitterType.NOREPINEPHRINE]: {
      emoji: '🚨',
      name: 'Norepinephrine',
      effect: 'Alert/Attention',
    },
  };

  return info[type];
}

/**
 * Print neurotransmitter summary
 */
export function printNeurotransmitterSummary(): void {
  console.log('\n' + '═'.repeat(60));
  console.log('🧪 NEUROTRANSMITTER SYSTEM');
  console.log('═'.repeat(60));

  for (const type of Object.values(NeurotransmitterType)) {
    const info = getNeurotransmitterInfo(type);
    console.log(`\n${info.emoji} ${info.name}`);
    console.log(`   Effect: ${info.effect}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('ION CHANNELS:');
  console.log('   Na+ (Sodium): Inbound data → Depolarization');
  console.log('   K+ (Potassium): Outbound → Repolarization');
  console.log('   Ca2+ (Calcium): Learning → Synaptic plasticity');
  console.log('   Cl- (Chloride): Inhibition → Hyperpolarization');
  console.log('═'.repeat(60));
}
