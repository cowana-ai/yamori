"""A tiny ML example. Open this file and choose Yamori: Read as Pseudocode."""
import math
import random


def train_classifier(epochs=300, learning_rate=0.4):
    rng = random.Random(42)
    samples = []
    for _ in range(200):
        x1, x2 = rng.uniform(-2, 2), rng.uniform(-2, 2)
        samples.append(([x1, x2], int(x1 + x2 > 0)))
    rng.shuffle(samples)
    training, testing = samples[:160], samples[160:]
    weights, bias = [0.0, 0.0], 0.0

    def probability(features):
        score = sum(x * w for x, w in zip(features, weights)) + bias
        return 1 / (1 + math.exp(-score))

    for _ in range(epochs):
        gradient, bias_gradient = [0.0, 0.0], 0.0
        for features, label in training:
            error = probability(features) - label
            for j in range(2):
                gradient[j] += error * features[j]
            bias_gradient += error
        for j in range(2):
            weights[j] -= learning_rate * gradient[j] / len(training)
        bias -= learning_rate * bias_gradient / len(training)

    correct = sum((probability(features) >= 0.5) == label for features, label in testing)
    return weights, bias, correct / len(testing)


if __name__ == "__main__":
    weights, bias, accuracy = train_classifier()
    print(f"Weights: {weights}; bias: {bias:.3f}; accuracy: {accuracy:.1%}")
