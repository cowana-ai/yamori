import { section } from './section.mjs';

function flowSection(file, title, start, end, rows) {
  return { file, ...section(title, start, end, rows) };
}

export const flows = {
  block_size: {
    summary: 'block_size is how many tokens a sequence may hold. A config sets it, configurator.py writes it into the training script, and the model uses it for the position table, the causal mask, the forward check, and the crop while sampling.',
    caveats: 'Other configs set their own block_size. This trace follows the character-level Shakespeare value into the model.',
    sections: [
      flowSection('config/train_shakespeare_char.py', 'Choose a short context for characters', 19, 19, [
        { text: 'Set **block_size** to 256.', start: 19, end: 19 },
        { text: '# Context: Each training row is at most 256 characters, because this dataset is one character per token.', start: 19, end: 19 }
      ]),
      flowSection('configurator.py', 'Run the config into the caller\'s globals', 20, 47, [
        { text: 'Treat an argument without an equals sign as a config path.', start: 21, end: 24 },
        { text: 'Print that file, then run it in this global scope.', start: 25, end: 28 },
        { text: 'Or take a --key=value flag, parse the value, and store it if the name and type already exist.', start: 31, end: 45 },
        { text: '# Insight: train.py executes this file, so an assignment to block_size here is train.py\'s block_size.', start: 28, end: 28 }
      ]),
      flowSection('train.py', 'Cut each batch to that many ids', 123, 125, [
        { text: 'Draw starts that still leave room for **block_size**.', start: 123, end: 123 },
        { text: 'Take **block_size** ids as the input.', start: 124, end: 124 },
        { text: 'Take the next **block_size** ids as the targets.', start: 125, end: 125 }
      ]),
      flowSection('train.py', 'Pass that length into the model', 147, 148, [
        { text: 'Pass **block_size** into the GPT config.', start: 147, end: 148 }
      ]),
      flowSection('train.py', 'Crop a longer checkpoint down', 189, 192, [
        { text: 'If a loaded model allows a longer context, crop it down to this length.', start: 190, end: 192 },
        { text: '# Insight: Resume and GPT-2 checkpoints are built for 1024. The Shakespeare run crops that table to 256.', start: 189, end: 192 }
      ]),
      flowSection('model.py', 'Remember the default context', 110, 110, [
        { text: 'Remember **block_size**, defaulting to 1024.', start: 110, end: 110 }
      ]),
      flowSection('model.py', 'Size the position table', 128, 128, [
        { text: 'Make the position embedding table one row per position in **block_size**.', start: 128, end: 128 }
      ]),
      flowSection('model.py', 'Mask scores beyond the context', 49, 50, [
        { text: 'When Flash Attention is missing, store a lower-triangular mask of shape **block_size** by **block_size**.', start: 49, end: 50 }
      ]),
      flowSection('model.py', 'Reject a longer forward', 173, 173, [
        { text: 'Stop if the sequence is longer than **block_size**.', start: 173, end: 173 }
      ]),
      flowSection('model.py', 'Crop a pretrained context', 195, 204, [
        { text: 'Remember the shorter length.', start: 200, end: 200 },
        { text: 'Cut the position table, and the causal mask if it exists.', start: 201, end: 204 }
      ]),
      flowSection('model.py', 'Keep only the latest tokens while sampling', 312, 314, [
        { text: 'If the growing context exceeds **block_size**, drop everything but the last **block_size** ids.', start: 314, end: 314 },
        { text: '# Insight: Sampling does not grow past the trained context. Older ids fall off the left.', start: 313, end: 314 }
      ])
    ]
  },
  logits: {
    summary: 'logits are the raw scores over the vocabulary. The forward pass either scores every position and turns that into a loss, or scores only the last position for sampling. Training reads the loss. generate turns the last scores into one new id.',
    caveats: 'sample.py never names logits. It calls generate, which consumes them inside the model.',
    sections: [
      flowSection('model.py', 'Score every position, or only the last', 184, 193, [
        { text: 'If targets were passed, score every position with the output head.', start: 186, end: 186 },
        { text: 'Measure cross-entropy of those **logits** against the targets.', start: 187, end: 187 },
        { text: 'Otherwise score only the last position, and leave the loss empty.', start: 190, end: 191 },
        { text: 'Return the scores and the loss.', start: 193, end: 193 },
        { text: '# Insight: The training return carries a score at every time step. The sampling return carries one step.', start: 184, end: 191 }
      ]),
      flowSection('train.py', 'The update uses the loss, not the scores', 222, 225, [
        { text: 'Unpack **logits** and the loss from the model.', start: 224, end: 224 },
        { text: 'Keep the loss for the average.', start: 225, end: 225 },
        { text: '# Insight: The scores are computed, then ignored here. The number that is logged is the loss.', start: 224, end: 225 }
      ]),
      flowSection('train.py', 'A training step does the same unpack', 299, 305, [
        { text: 'Score the micro-batch.', start: 300, end: 300 },
        { text: 'Divide the loss by the number of micro-batches, then go backward.', start: 301, end: 305 },
        { text: '# Insight: logits is bound and never read. The gradient flows from the loss.', start: 300, end: 301 }
      ]),
      flowSection('model.py', 'Turn the last scores into one id', 316, 326, [
        { text: 'Take the **logits** at the final position.', start: 316, end: 318 },
        { text: 'Divide by the temperature.', start: 318, end: 318 },
        { text: 'Optionally keep only the top-k scores and set the rest to negative infinity.', start: 320, end: 322 },
        { text: 'Softmax, then draw one id.', start: 324, end: 326 }
      ]),
      flowSection('sample.py', 'Sampling never sees the scores', 86, 88, [
        { text: 'Call generate with the prompt, the temperature, and the top-k.', start: 87, end: 87 },
        { text: 'Decode the ids it returns.', start: 88, end: 88 },
        { text: '# Insight: The scores stay inside generate. This file only prints text.', start: 87, end: 88 }
      ])
    ]
  }
};
