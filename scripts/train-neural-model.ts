#!/usr/bin/env npx tsx
/**
 * Neural Model Training Script
 *
 * Usage:
 *   npx tsx scripts/train-neural-model.ts [options]
 *
 * Options:
 *   --epochs <number>      Number of training epochs (default: 100)
 *   --batch-size <number>  Batch size (default: 32)
 *   --learning-rate <num>  Learning rate (default: 0.001)
 *   --export-only          Only export training data, don't train
 *   --output <path>        Output path for model (default: ./models/neural)
 *   --verbose              Verbose logging
 */

import * as tf from "@tensorflow/tfjs-node";
import * as fs from "fs";
import * as path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  epochs: 100,
  batchSize: 32,
  learningRate: 0.001,
  exportOnly: false,
  outputPath: "./models/neural",
  verbose: false,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case "--epochs":
      options.epochs = parseInt(args[++i], 10);
      break;
    case "--batch-size":
      options.batchSize = parseInt(args[++i], 10);
      break;
    case "--learning-rate":
      options.learningRate = parseFloat(args[++i]);
      break;
    case "--export-only":
      options.exportOnly = true;
      break;
    case "--output":
      options.outputPath = args[++i];
      break;
    case "--verbose":
      options.verbose = true;
      break;
    case "--help":
      console.log(`
Neural Model Training Script

Usage: npx tsx scripts/train-neural-model.ts [options]

Options:
  --epochs <number>      Number of training epochs (default: 100)
  --batch-size <number>  Batch size (default: 32)
  --learning-rate <num>  Learning rate (default: 0.001)
  --export-only          Only export training data, don't train
  --output <path>        Output path for model (default: ./models/neural)
  --verbose              Verbose logging
  --help                 Show this help message
      `);
      process.exit(0);
  }
}

console.log("=".repeat(60));
console.log("Neural Model Training Script");
console.log("=".repeat(60));
console.log(`TensorFlow.js version: ${tf.version.tfjs}`);
console.log(`Backend: ${tf.getBackend()}`);
console.log(`Options:`, JSON.stringify(options, null, 2));
console.log("=".repeat(60));

async function main() {
  try {
    // Step 1: Load training data module
    console.log("\n[Step 1] Loading training data module...");
    const trainingModule = await import("../app/lib/neural/training.server");

    // Step 2: Export training data
    console.log("\n[Step 2] Exporting training data...");
    const dataset = await trainingModule.exportTrainingData({
      minHistoryDays: 14,
    });

    console.log(`  Training examples: ${dataset.train.length}`);
    console.log(`  Validation examples: ${dataset.validation.length}`);
    console.log(`  Test examples: ${dataset.test.length}`);
    console.log(`  Time range: ${dataset.metadata.dateRange.start} to ${dataset.metadata.dateRange.end}`);

    // Show label distribution
    console.log("\n  Label distribution:");
    const labelCounts: Record<string, number> = {};
    for (const example of dataset.train) {
      const dealIdx = example.labels.dealType.indexOf(1);
      const label = dealIdx >= 0 ? String(dealIdx) : "unknown";
      labelCounts[label] = (labelCounts[label] || 0) + 1;
    }
    for (const [label, count] of Object.entries(labelCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${label}: ${count} (${((count / dataset.train.length) * 100).toFixed(1)}%)`);
    }

    if (options.exportOnly) {
      // Save training data to file
      const exportPath = path.join(options.outputPath, "training-data.json");
      fs.mkdirSync(path.dirname(exportPath), { recursive: true });
      fs.writeFileSync(exportPath, JSON.stringify(dataset, null, 2));
      console.log(`\n  Exported training data to: ${exportPath}`);
      process.exit(0);
    }

    // Step 3: Balance and augment data
    console.log("\n[Step 3] Balancing and augmenting data...");
    let trainExamples = trainingModule.balanceClasses(dataset.train);
    trainExamples = trainingModule.augmentTrainingData(trainExamples, 2);
    console.log(`  After augmentation: ${trainExamples.length} examples`);

    // Step 4: Convert to tensor format
    console.log("\n[Step 4] Converting to tensor format...");
    const tensorData = trainingModule.toTensorFormat({
      ...dataset,
      train: trainExamples,
    });

    // Create tensors
    const xTrain = tf.tensor3d(tensorData.xTrain);
    const xVal = tf.tensor3d(tensorData.xVal);
    const yTrainDealType = tf.tensor2d(tensorData.yTrainDealType);
    const yTrainConfidence = tf.tensor1d(tensorData.yTrainConfidence);
    const yTrainReturn = tf.tensor1d(tensorData.yTrainReturn);
    const yTrainRisk = tf.tensor2d(tensorData.yTrainRisk);
    const yValDealType = tf.tensor2d(tensorData.yValDealType);
    const yValConfidence = tf.tensor1d(tensorData.yValConfidence);
    const yValReturn = tf.tensor1d(tensorData.yValReturn);
    const yValRisk = tf.tensor2d(tensorData.yValRisk);

    console.log(`  Training tensor shape: [${xTrain.shape}]`);
    console.log(`  Validation tensor shape: [${xVal.shape}]`);

    // Step 5: Load model service and train
    console.log("\n[Step 5] Loading neural model...");
    const modelModule = await import("../app/lib/neural/model.server");
    const modelService = modelModule.getModelService();
    await modelService.load();
    console.log(`  Model version: ${modelService.getVersion()}`);

    // Step 6: Train the model
    console.log("\n[Step 6] Training model...");
    console.log(`  Epochs: ${options.epochs}`);
    console.log(`  Batch size: ${options.batchSize}`);
    console.log(`  Learning rate: ${options.learningRate}`);
    console.log("");

    const trainingResult = await modelService.train(
      tensorData.xTrain,
      {
        dealType: tensorData.yTrainDealType,
        confidence: tensorData.yTrainConfidence,
        expectedReturn: tensorData.yTrainReturn,
        riskLevel: tensorData.yTrainRisk,
      },
      tensorData.xVal,
      {
        dealType: tensorData.yValDealType,
        confidence: tensorData.yValConfidence,
        expectedReturn: tensorData.yValReturn,
        riskLevel: tensorData.yValRisk,
      },
      {
        epochs: options.epochs,
        batchSize: options.batchSize,
        learningRate: options.learningRate,
        patience: 10,
      }
    );

    console.log("\n[Training Complete]");
    console.log(`  Duration: ${(trainingResult.trainingDuration / 1000).toFixed(1)}s`);
    console.log(`  Final loss: ${trainingResult.finalLoss.toFixed(4)}`);
    console.log(`  Deal type accuracy: ${(trainingResult.metrics.dealTypeAccuracy * 100).toFixed(1)}%`);
    console.log(`  Return MAE: ${trainingResult.metrics.returnMae.toFixed(4)}`);
    console.log(`  Risk F1 Score: ${trainingResult.metrics.riskF1Score.toFixed(4)}`);

    // Step 7: Save the model
    console.log("\n[Step 7] Saving model...");
    fs.mkdirSync(options.outputPath, { recursive: true });
    await modelService.save(options.outputPath);
    console.log(`  Model saved to: ${options.outputPath}`);

    // Step 8: Verify the saved model
    console.log("\n[Step 8] Verifying saved model...");
    const files = fs.readdirSync(options.outputPath);
    console.log(`  Saved files: ${files.join(", ")}`);

    // Cleanup tensors
    xTrain.dispose();
    xVal.dispose();
    yTrainDealType.dispose();
    yTrainConfidence.dispose();
    yTrainReturn.dispose();
    yTrainRisk.dispose();
    yValDealType.dispose();
    yValConfidence.dispose();
    yValReturn.dispose();
    yValRisk.dispose();

    console.log("\n" + "=".repeat(60));
    console.log("Training complete!");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\nError during training:", error);
    process.exit(1);
  }
}

main();
