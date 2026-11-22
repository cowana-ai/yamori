import { section, view } from './section.mjs';

const logic = view(
  'A GPT that predicts the next token',
  'Turn token ids into next-token scores, using stacked blocks that may look only at earlier tokens.',
  [
    section('Choose the model\'s sizes', 109, 116, [
      { text: 'Record how the GPT is sized.', start: 109, end: 109 },
      { text: 'Allow sequences of **block_size** tokens, default 1024.', start: 110, end: 110 },
      { text: 'Use a vocabulary of **vocab_size** ids, default 50304.', start: 111, end: 111 },
      { text: 'Pad GPT-2\'s 50257 ids up to a multiple of 64.', start: 111, end: 111 },
      { text: 'Stack **n_layer** blocks, default twelve.', start: 112, end: 112 },
      { text: 'Give each block **n_head** attention heads, default twelve.', start: 113, end: 113 },
      { text: 'Give each token a vector of width **n_embd**, default 768.', start: 114, end: 114 },
      { text: 'Drop out with probability **dropout**. The default is 0.', start: 115, end: 115 },
      { text: 'Keep a **bias** on linears and layer norms when asked.', start: 116, end: 116 },
      { text: '# Context: These seven numbers are the whole architecture. Training and sampling pass the same config in.', start: 109, end: 116 }
    ]),
    section('Let each token look only left', 29, 76, [
      { text: 'Build one causal self-attention layer.', start: 31, end: 32 },
      { text: 'Require the width to divide evenly by the head count.', start: 33, end: 33 },
      { text: 'Project each token into query, key, and value together.', start: 35, end: 35 },
      { text: 'That projection is 3 times the embedding width.', start: 35, end: 35 },
      { text: 'Project the mixed heads back to the embedding width.', start: 37, end: 37 },
      { text: 'Drop out the attention weights and the residual output.', start: 39, end: 43 },
      '',
      { text: 'Prefer Flash Attention when this PyTorch provides it.', start: 45, end: 45 },
      { text: 'Otherwise warn, and store a lower-triangular mask of ones.', start: 46, end: 50 },
      { text: 'The mask is **block_size** by **block_size**.', start: 49, end: 50 },
      '',
      { text: 'Read the batch size, the length, and the width.', start: 53, end: 53 },
      { text: 'Split the projection into query, key, and value.', start: 56, end: 56 },
      { text: 'Reshape each as batch, heads, time, then head width.', start: 57, end: 59 },
      { text: 'That reshape swaps axes -2 and -1, so time stays beside the head width.', start: 57, end: 59 },
      '',
      { text: 'If Flash Attention is available:', start: 62, end: 62 },
      { text: '    Score queries against keys with a causal mask.', start: 64, end: 64 },
      { text: '    Drop out attention while the module is training.', start: 64, end: 64 },
      { text: 'Otherwise:', start: 65, end: 65 },
      { text: '    Score every query against every earlier and current key.', start: 67, end: 67 },
      { text: '    Scale by $1/\\sqrt{d}$, where $d$ is the head width.', start: 67, end: 67 },
      { text: '    Hide future positions with negative infinity.', start: 68, end: 68 },
      { text: '    Turn the scores into weights with softmax.', start: 69, end: 69 },
      { text: '    Drop out those weights.', start: 70, end: 70 },
      { text: '    Mix the values by the weights.', start: 71, end: 71 },
      '',
      { text: 'Lay the head outputs back side by side.', start: 72, end: 72 },
      { text: 'Project that mix, drop out, and return it.', start: 75, end: 76 },
      { text: '# Why: Dividing by the square root of the head width keeps the dots from growing with that width, so softmax does not saturate.', start: 67, end: 67 },
      { text: '# Insight: A token never reads a later token. The triangular mask, or is_causal, is what enforces it.', start: 48, end: 68 }
    ]),
    section('Widen the vector, then squash it', 78, 92, [
      { text: 'Build the feed-forward layer inside a block.', start: 80, end: 81 },
      { text: 'Expand each token to 4 times the embedding width.', start: 82, end: 82 },
      { text: 'Apply GELU.', start: 83, end: 83 },
      { text: 'Project back to the embedding width.', start: 84, end: 84 },
      { text: 'Drop out.', start: 85, end: 85 },
      '',
      { text: 'On each token, expand, apply GELU, project back, and drop out.', start: 88, end: 91 },
      { text: 'Return that vector.', start: 92, end: 92 },
      { text: '# Context: This mix never looks at other positions. Attention already gathered them. GELU is a smooth gate: it passes positive values and shrinks negative ones.', start: 83, end: 90 }
    ]),
    section('Normalize, with an optional shift', 18, 27, [
      { text: 'Learn a scale for every channel.', start: 23, end: 23 },
      { text: 'Learn a shift too, unless bias is off.', start: 24, end: 24 },
      { text: 'Normalize the last dimension.', start: 27, end: 27 },
      { text: 'Use epsilon 1e-5 so the variance cannot be zero.', start: 27, end: 27 },
      { text: '# Context: Layer norm makes each token\'s channels have a steady spread before attention or the feed-forward mix. The optional bias is the shift.', start: 18, end: 27 }
    ]),
    section('Add each sublayer back onto the stream', 94, 106, [
      { text: 'In each block, normalize, then attend, then normalize, then mix.', start: 96, end: 101 },
      { text: 'Add the attention output back onto the input.', start: 104, end: 104 },
      { text: 'Add the feed-forward output back onto that.', start: 105, end: 105 },
      { text: 'Return the sum.', start: 106, end: 106 },
      { text: '# Insight: The adds are residual connections. The block changes the stream by a delta instead of replacing it.', start: 104, end: 105 },
      { text: '# Context: The first norm feeds attention. The second feeds the widen-and-squash layer. Each sublayer sees a normalized copy, and the original stream stays on the skip path.', start: 98, end: 105 }
    ]),
    section('Stack embeddings, blocks, and a tied word head', 118, 168, [
      { text: 'Require a vocabulary size and a block size.', start: 122, end: 123 },
      { text: 'Keep the config.', start: 124, end: 124 },
      { text: 'Look up a vector per token id. Call that table **wte**.', start: 127, end: 127 },
      { text: 'Look up a vector per position. Call that table **wpe**.', start: 128, end: 128 },
      { text: 'Drop out the sum of those two.', start: 129, end: 129 },
      { text: 'Stack **n_layer** identical blocks.', start: 130, end: 130 },
      { text: 'Normalize once more at the end of the stack.', start: 131, end: 131 },
      { text: 'Map the final vector to one score per vocabulary id.', start: 133, end: 133 },
      { text: 'Call that map **lm_head**. Give it no bias.', start: 133, end: 133 },
      '',
      { text: 'Tie **wte** to **lm_head**. They share one matrix.', start: 138, end: 138 },
      { text: '# Why: The same vectors that read token ids also score them. One table means fewer free parameters, and the input and output stay in one geometry.', start: 138, end: 138 },
      '',
      { text: 'Draw every linear and embedding matrix from a normal.', start: 141, end: 141 },
      { text: 'Use mean 0 and standard deviation 0.02.', start: 164, end: 168 },
      { text: 'Zero each linear bias.', start: 165, end: 166 },
      { text: 'Shrink residual projections by the square root of 2 times the depth.', start: 143, end: 145 },
      { text: '# Context: The source applies the GPT-2 residual scale so a deep stack of adds does not start huge.', start: 142, end: 145 },
      '',
      { text: 'Sum the parameters.', start: 157, end: 157 },
      { text: 'When asked, subtract the position table.', start: 158, end: 159 },
      { text: 'Keep the token table, because the output head uses it.', start: 154, end: 155 },
      { text: 'Print the count in millions, dividing by 1e6.', start: 148, end: 148 },
      { text: '# Insight: Position vectors are not shared, so they are the ones left out of the non-embedding count.', start: 150, end: 160 }
    ]),
    section('Turn ids into scores, and a loss if targets arrived', 170, 193, [
      { text: 'Read the device, the batch, and the length.', start: 171, end: 172 },
      { text: 'Reject a sequence longer than **block_size**.', start: 173, end: 173 },
      { text: 'Number the positions from 0 up to the length.', start: 174, end: 174 },
      '',
      { text: 'Look up each token id and each position.', start: 177, end: 178 },
      { text: 'Add those vectors, then drop out.', start: 179, end: 179 },
      { text: 'Run every block.', start: 180, end: 181 },
      { text: 'Normalize the stack output.', start: 182, end: 182 },
      '',
      { text: 'If targets were passed:', start: 184, end: 184 },
      { text: '    Score every position over the vocabulary.', start: 186, end: 186 },
      { text: '    Measure cross-entropy against the targets.', start: 187, end: 187 },
      { text: '    Ignore a target of -1.', start: 187, end: 187 },
      { text: 'Otherwise:', start: 188, end: 188 },
      { text: '    Score only the last position.', start: 190, end: 190 },
      { text: '    Leave the loss empty.', start: 191, end: 191 },
      { text: 'Return the scores and the loss.', start: 193, end: 193 },
      { text: '# Insight: Training needs a score at every position. Sampling only needs the next token, so the head skips the earlier positions.', start: 184, end: 191 },
      { text: '# Context: Cross-entropy here is the average negative log probability of the correct next id.', start: 187, end: 187 }
    ]),
    section('Shrink a pretrained context', 195, 204, [
      { text: 'Refuse a context longer than the one already built.', start: 199, end: 199 },
      { text: 'Remember the shorter **block_size**.', start: 200, end: 200 },
      { text: 'Cut the position table down to it.', start: 201, end: 201 },
      { text: 'If a causal mask is stored, cut that too.', start: 202, end: 204 },
      { text: '# Context: A GPT-2 checkpoint is built for 1024 positions. A smaller run can crop that table instead of retraining it.', start: 196, end: 201 }
    ]),
    section('Copy OpenAI GPT-2 weights in', 206, 261, [
      { text: 'Accept only gpt2, gpt2-medium, gpt2-large, or gpt2-xl.', start: 208, end: 208 },
      { text: 'Allow a dropout override, and nothing else.', start: 211, end: 211 },
      { text: 'Load the matching Hugging Face GPT-2.', start: 212, end: 213 },
      '',
      { text: 'gpt2 uses 12 layers, 12 heads, and width 768. That is the 124M model.', start: 217, end: 217 },
      { text: 'gpt2-medium uses 24 layers, 16 heads, and width 1024. That is the 350M model.', start: 218, end: 218 },
      { text: 'gpt2-large uses 36 layers, 20 heads, and width 1280. That is the 774M model.', start: 219, end: 219 },
      { text: 'gpt2-xl uses 48 layers, 25 heads, and width 1600. That is the 1558M model.', start: 220, end: 220 },
      { text: 'Force vocabulary 50257, context 1024, and bias on.', start: 222, end: 225 },
      { text: 'If dropout was overridden, print it and use that rate.', start: 227, end: 229 },
      '',
      { text: 'Build a fresh GPT in that shape.', start: 231, end: 232 },
      { text: 'Drop the attention mask buffers. They are not parameters.', start: 235, end: 235 },
      { text: 'Drop the same buffers on the Hugging Face model.', start: 243, end: 244 },
      { text: 'Require the remaining names to match one for one.', start: 248, end: 248 },
      '',
      { text: 'For the attention and feed-forward matrices, transpose.', start: 245, end: 254 },
      { text: 'Copy every other tensor straight across.', start: 255, end: 259 },
      { text: 'Return the filled model.', start: 261, end: 261 },
      { text: '# Why: The OpenAI checkpoint stored those matrices as Conv1D, which is transposed relative to a Linear. The copy flips them.', start: 246, end: 254 },
      { text: '# Insight: This downloads the public GPT-2 checkpoint, then copies weights. It does not retrain them.', start: 212, end: 238 }
    ]),
    section('Decay matrices, not shifts', 263, 287, [
      { text: 'Keep parameters that still receive gradients.', start: 265, end: 267 },
      { text: 'Decay every tensor with 2 or more dimensions.', start: 270, end: 270 },
      { text: 'Leave biases and layer-norm scales undecayed, at decay 0.', start: 271, end: 274 },
      { text: 'Print how many tensors and parameters fall in each group.', start: 276, end: 279 },
      { text: 'Use AdamW.', start: 284, end: 284 },
      { text: 'Fuse the AdamW kernel when it exists and the device is cuda.', start: 281, end: 285 },
      { text: 'Return that optimizer.', start: 287, end: 287 },
      { text: '# Why: Decay pulls large weight matrices toward zero. Biases and norm scales are few numbers; decaying them tends to fight the normalization.', start: 268, end: 274 }
    ]),
    section('Estimate how hard the GPU is working', 289, 303, [
      { text: 'Count the parameters.', start: 293, end: 293 },
      { text: 'Let the head width be the embedding divided by the head count.', start: 295, end: 295 },
      { text: 'Estimate flops per token as 6 times the parameter count.', start: 296, end: 296 },
      { text: 'Add 12 times layers, times heads, times head width, times **block_size**.', start: 296, end: 296 },
      { text: 'Scale by **block_size** again for a forward and backward pass.', start: 297, end: 297 },
      { text: 'Scale by how many sequences this step ran.', start: 298, end: 298 },
      { text: 'Divide by the elapsed seconds.', start: 300, end: 300 },
      { text: 'Compare with 312e12, which the comment calls 312 TFLOPS, an A100 bfloat16 peak.', start: 301, end: 302 },
      { text: 'Return that fraction.', start: 303, end: 303 },
      { text: '# Context: The 6N term is the usual matmul cost of a forward and backward pass. The extra term pays for attention scores, which grow with the context length. The source points at the PaLM paper\'s appendix for this estimate.', start: 291, end: 296 }
    ]),
    section('Sample the next id, then feed it back', 305, 330, [
      { text: 'Repeat for each new token you still owe.', start: 312, end: 312 },
      { text: 'If the context is longer than **block_size**, keep only the last **block_size** ids.', start: 314, end: 314 },
      { text: 'Score that context.', start: 316, end: 316 },
      { text: 'Keep the last position and divide by the temperature.', start: 318, end: 318 },
      { text: 'If a top-k was given:', start: 320, end: 320 },
      { text: '    Find the k largest scores.', start: 321, end: 321 },
      { text: '    Set every smaller score to negative infinity.', start: 322, end: 322 },
      { text: 'Turn the scores into probabilities.', start: 324, end: 324 },
      { text: 'Draw one id.', start: 326, end: 326 },
      { text: 'Append it, and repeat.', start: 328, end: 328 },
      { text: 'Return the full id sequence.', start: 330, end: 330 },
      { text: '# Insight: Each new id is appended, and attention runs again over the whole crop. This function does not keep a key-value cache.', start: 314, end: 328 },
      { text: '# Context: Temperature below 1 sharpens the distribution. top-k sets every id outside the k most likely to probability zero before the draw.', start: 318, end: 326 }
    ])
  ]
);

const overview = view(
  'A GPT that predicts the next token',
  'A stack of causal blocks turns token ids into next-token scores, and can draw new ids one at a time.',
  [
    section('Size the GPT with seven numbers', 109, 116, [
      { text: 'Choose the context length, vocabulary, depth, heads, width, dropout, and whether biases are on.', start: 110, end: 116 },
      { text: 'The defaults match a small GPT-2: context 1024, vocabulary 50304, twelve layers, twelve heads, width 768.', start: 110, end: 114 },
      { text: '# Insight: GPT-2\'s real vocabulary is 50257 ids, padded to a multiple of 64.', start: 111, end: 111 }
    ]),
    section('Each block may look only left, then mixes', 18, 106, [
      { text: 'Normalize with epsilon 1e-5, let every token attend to earlier tokens, and add that back.', start: 27, end: 104 },
      { text: 'The query, key, and value projection is 3 times the width.', start: 35, end: 35 },
      { text: 'Then widen by 4, apply GELU, project back, and add that back too.', start: 82, end: 105 },
      { text: 'Attention scores are a scaled dot product, then softmax. Future positions stay hidden.', start: 67, end: 69 },
      { text: '# Insight: Nothing in a block may read a later token. That is what makes the model causal.', start: 48, end: 68 }
    ]),
    section('Embed ids, run the stack, score the next token', 118, 193, [
      { text: 'Add a token vector and a position vector, then run every block.', start: 127, end: 181 },
      { text: 'Tie the token table to the output head.', start: 138, end: 138 },
      { text: 'Start matrices at standard deviation 0.02, and shrink residual projections further.', start: 143, end: 168 },
      { text: 'Report the parameter count in millions, dividing by 1e6.', start: 148, end: 148 },
      { text: 'With targets, score every position and take cross-entropy.', start: 186, end: 187 },
      { text: 'Without targets, score only the last position.', start: 190, end: 191 },
      { text: '# Insight: The loss trains the model to name the next id. Sampling only needs that last score.', start: 184, end: 191 }
    ]),
    section('Draw one id and append it', 305, 330, [
      { text: 'Crop the context to **block_size**, score it, divide by temperature, optionally keep the top-k, and sample.', start: 314, end: 326 },
      { text: 'Append the id and repeat.', start: 328, end: 328 },
      { text: '# Insight: The new id goes back into the context. Attention is recomputed; there is no cache.', start: 314, end: 328 }
    ]),
    section('GPT-2 weights can be copied in', 206, 261, [
      { text: 'gpt2 is 12 layers, 12 heads, width 768 (124M). Medium is 24, 16, 1024 (350M).', start: 217, end: 218 },
      { text: 'Large is 36, 20, 1280 (774M). XL is 48, 25, 1600 (1558M).', start: 219, end: 220 },
      { text: 'Force vocabulary 50257 and context 1024.', start: 223, end: 224 },
      { text: 'Transpose the Conv1D matrices, then copy the rest.', start: 250, end: 259 },
      { text: '# Insight: This loads an existing checkpoint. It does not train one.', start: 212, end: 238 }
    ]),
    section('Decay matrices, and estimate speed', 263, 303, [
      { text: 'AdamW decays tensors of 2 or more dimensions, not biases or norm scales.', start: 270, end: 274 },
      { text: 'A flop estimate, 6 times the parameter count plus an attention term, is compared with 312e12.', start: 296, end: 302 },
      { text: '# Context: 312e12 stands for an A100 bfloat16 peak. The fraction is a rough utilization, not a benchmark guarantee.', start: 301, end: 302 }
    ])
  ]
);

export const model = { logic, overview };
