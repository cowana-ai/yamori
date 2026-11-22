import { section, view } from './section.mjs';

const shakespeare = {
  logic: view(
    'Encode Tiny Shakespeare with the GPT-2 tokenizer',
    'Download the plays, split them, and write GPT-2 token ids for a small fine-tune.',
    [
      section('Download the text if it is missing', 6, 11, [
        { text: 'Look for input.txt next to this script.', start: 7, end: 8 },
        { text: 'If it is missing, download Tiny Shakespeare.', start: 9, end: 10 },
        { text: 'Write that text to input.txt.', start: 10, end: 11 }
      ]),
      section('Hold out the last tenth, then encode', 13, 30, [
        { text: 'Read the file.', start: 13, end: 14 },
        { text: 'Cut at 0.9 of the characters.', start: 15, end: 17 },
        { text: 'Keep the head as train and the tail as validation.', start: 16, end: 17 },
        { text: 'Load the gpt2 tokenizer.', start: 20, end: 20 },
        { text: 'Encode both splits, ignoring special tokens.', start: 21, end: 22 },
        { text: 'Print how many tokens each split holds.', start: 23, end: 24 },
        { text: 'Store the ids as uint16.', start: 27, end: 28 },
        { text: 'Write train.bin and val.bin next to this script.', start: 29, end: 30 },
        { text: '# Insight: There is no meta.pkl. sample.py will assume GPT-2 encodings, which matches this tokenizer.', start: 20, end: 30 },
        { text: '# Context: encode_ordinary skips special tokens such as the end-of-text marker. The character-level prepare script does not use this tokenizer at all.', start: 21, end: 22 }
      ])
    ]
  ),
  overview: view(
    'Encode Tiny Shakespeare with the GPT-2 tokenizer',
    'The same plays as the character dataset, packed as GPT-2 tokens instead of single characters.',
    [
      section('Download, split, encode, and save', 6, 30, [
        { text: 'Download Tiny Shakespeare and write input.txt when it is missing.', start: 7, end: 11 },
        { text: 'Cut at 0.9, encode both sides with the gpt2 tokenizer, and save uint16 bins.', start: 16, end: 30 },
        { text: '# Insight: No codec file is written. Decoding later assumes GPT-2.', start: 20, end: 30 }
      ])
    ]
  )
};

const openwebtext = {
  logic: view(
    'Pack OpenWebText into token binaries',
    'Download OpenWebText, encode it with the GPT-2 tokenizer, and write one memory-mapped binary per split.',
    [
      section('Download the corpus and hold out a tiny validation set', 10, 27, [
        { text: 'Use 8 worker processes to load and to map.', start: 12, end: 17 },
        { text: 'Load the gpt2 tokenizer.', start: 19, end: 19 },
        { text: 'When run as a script, download the openwebtext dataset.', start: 21, end: 23 },
        { text: 'Hold out a test fraction of 0.0005, shuffled with seed 2357.', start: 26, end: 26 },
        { text: 'Rename that holdout to val.', start: 27, end: 27 },
        { text: '# Context: The source notes this download is large, on the order of the Hugging Face cache for the whole corpus. Only the main process does it.', start: 21, end: 23 }
      ]),
      section('Append an end-of-text id to every document', 42, 56, [
        { text: 'Encode each document\'s text, ignoring special tokens.', start: 44, end: 44 },
        { text: 'Append the end-of-text id. For gpt2 that id is 50256.', start: 45, end: 45 },
        { text: 'Keep the ids and their length.', start: 47, end: 48 },
        { text: 'Map that function over both splits with the same 8 workers.', start: 51, end: 56 },
        { text: '# Inferred: The comment wonders whether the end-of-text id should be prepended instead. The code appends it.', start: 46, end: 46 }
      ]),
      section('Write each split into a uint16 binary', 58, 74, [
        { text: 'Sum the document lengths as uint64.', start: 60, end: 60 },
        { text: 'Open a memory map named for the split, in write mode.', start: 61, end: 63 },
        { text: 'Store tokens as uint16, which fits because 50256 is below 2**16.', start: 62, end: 63 },
        { text: 'Write the ids in 1024 contiguous shards.', start: 64, end: 73 },
        { text: 'Flush the map.', start: 74, end: 74 },
        { text: '# Insight: train.py memory-maps these same bins. It does not read the original documents.', start: 63, end: 74 }
      ])
    ]
  ),
  overview: view(
    'Pack OpenWebText into token binaries',
    'Download OpenWebText, mark document boundaries, and write the binaries a full GPT-2 run trains on.',
    [
      section('Download, mark documents, and save bins', 10, 74, [
        { text: 'Download openwebtext with 8 workers and hold out a fraction 0.0005 with seed 2357.', start: 12, end: 27 },
        { text: 'Encode with the gpt2 tokenizer and append end-of-text id 50256.', start: 44, end: 45 },
        { text: 'Write each split as uint16, below 2**16, in 1024 shards.', start: 62, end: 73 },
        { text: '# Insight: This is the dataset the default train.py settings expect.', start: 23, end: 63 }
      ])
    ]
  )
};

function configView(title, summary, start, end, rows, overviewRows) {
  return {
    logic: view(title, summary, [section(title, start, end, rows)]),
    overview: view(title, summary, [section(title, start, end, overviewRows || rows)])
  };
}

const trainShakespeare = configView(
  'A laptop-sized Shakespeare GPT',
  'Settings for a 6-layer character model on Tiny Shakespeare, the run the README suggests first.',
  4, 37,
  [
    { text: 'Write this run to out-shakespeare-char.', start: 4, end: 4 },
    { text: 'Score every 250 steps, using 200 batches.', start: 5, end: 6 },
    { text: 'Log every 10 steps.', start: 7, end: 7 },
    { text: 'Save a checkpoint only when validation improves.', start: 10, end: 10 },
    { text: 'Leave the run log off.', start: 12, end: 12 },
    { text: 'Name the log shakespeare-char and the run mini-gpt, if you turn it on.', start: 13, end: 14 },
    { text: 'Train on the shakespeare_char dataset.', start: 16, end: 16 },
    { text: 'Use one micro-batch step, a batch of 64, and context 256.', start: 17, end: 19 },
    { text: 'Use 6 layers, 6 heads, and width 384.', start: 22, end: 24 },
    { text: 'Drop out with probability 0.2.', start: 25, end: 25 },
    { text: 'Learn at 1e-3 for 5000 steps.', start: 27, end: 28 },
    { text: 'Decay the rate over those same 5000 steps, down to 1e-4.', start: 29, end: 30 },
    { text: 'Use a second Adam moment of 0.99.', start: 31, end: 31 },
    { text: 'Warm up for 100 steps.', start: 33, end: 33 },
    { text: '# Insight: These assignments replace train.py globals only because configurator.py executes this file.', start: 4, end: 33 },
    { text: '# Context: Context 256 is 256 characters, not 256 GPT-2 pieces. The model is much smaller than the 12-layer default.', start: 19, end: 24 }
  ],
  [
    { text: 'Train shakespeare_char with context 256, batch 64, one accumulation step, and a 6-layer model of width 384.', start: 16, end: 24 },
    { text: 'Drop out at 0.2, learn at 1e-3 for 5000 steps, and decay to 1e-4.', start: 25, end: 30 },
    { text: 'Score every 250 steps with 200 batches, log every 10 steps, and save only when validation improves.', start: 5, end: 10 },
    { text: 'Use Adam\'s second moment 0.99 and warm up for 100 steps.', start: 31, end: 33 },
    { text: '# Insight: This is the small run: one GPU, a few minutes, character-level Shakespeare.', start: 19, end: 28 }
  ]
);

const trainGpt2 = configView(
  'The GPT-2 OpenWebText run',
  'Settings that train a 124M GPT on OpenWebText with a large token batch.',
  6, 25,
  [
    { text: 'Turn the run log on, under the name gpt2-124M.', start: 6, end: 8 },
    { text: 'Use batch 12 and context 1024.', start: 11, end: 12 },
    { text: 'Accumulate 5 times 8 micro-batches.', start: 13, end: 13 },
    { text: 'Train and decay the learning rate for 600000 steps.', start: 16, end: 17 },
    { text: 'Score every 1000 steps, using 200 batches.', start: 20, end: 21 },
    { text: 'Log every 10 steps.', start: 22, end: 22 },
    { text: 'Decay weights by 1e-1.', start: 25, end: 25 },
    { text: '# Context: The comment above the batch math says 12 times 1024 times 5 times 8 GPUs is about half a million tokens per step.', start: 9, end: 13 },
    { text: '# Insight: This file does not shrink the model. It keeps train.py\'s 12-layer, width-768 GPT and changes the schedule and the batch.', start: 11, end: 17 }
  ]
);

const finetune = configView(
  'Fine-tune GPT-2 XL on Shakespeare',
  'A short fine-tune of the largest GPT-2 on the tokenized Shakespeare set.',
  3, 25,
  [
    { text: 'Write to out-shakespeare.', start: 3, end: 3 },
    { text: 'Score every 5 steps, using 40 batches.', start: 4, end: 5 },
    { text: 'Leave the run log off.', start: 6, end: 6 },
    { text: 'Name that log shakespeare if you enable it.', start: 7, end: 7 },
    { text: 'Stamp the run name with the current time.', start: 8, end: 8 },
    { text: 'Train on the shakespeare dataset.', start: 10, end: 10 },
    { text: 'Start from gpt2-xl weights.', start: 11, end: 11 },
    { text: 'Save only when validation improves.', start: 14, end: 14 },
    { text: 'Use batch 1 and accumulate 32 micro-batches.', start: 19, end: 20 },
    { text: 'Stop after 20 steps.', start: 21, end: 21 },
    { text: 'Learn at a flat 3e-5. Do not decay the rate.', start: 24, end: 25 },
    { text: '# Insight: init_from gpt2-xl tells train.py to load the 1558M public model before these few steps.', start: 11, end: 11 },
    { text: '# Context: Twenty steps is a sketch of fine-tuning, not a full training run. The rate stays constant because decay_lr is false.', start: 21, end: 25 }
  ]
);

function evalConfig(name, initFrom, summary) {
  return configView(
    name,
    summary,
    4, 8,
    [
      { text: 'Use a batch of 8.', start: 4, end: 4 },
      { text: 'Score 500 batches, enough for a steadier estimate.', start: 5, end: 5 },
      { text: 'Stop after that first score.', start: 6, end: 6 },
      { text: 'Leave the run log off.', start: 7, end: 7 },
      { text: `Start from the ${initFrom} weights.`, start: 8, end: 8 },
      { text: '# Insight: eval_only makes train.py measure loss and exit. It does not take an optimizer step.', start: 6, end: 8 }
    ]
  );
}

const evalGpt2 = evalConfig('Score the base GPT-2', 'gpt2', 'Load GPT-2 (124M) and exit after one validation-style score.');
const evalMedium = evalConfig('Score GPT-2 medium', 'gpt2-medium', 'Load GPT-2 medium (350M) and exit after one score.');
const evalLarge = evalConfig('Score GPT-2 large', 'gpt2-large', 'Load GPT-2 large (774M) and exit after one score.');
const evalXl = evalConfig('Score GPT-2 XL', 'gpt2-xl', 'Load GPT-2 XL (1558M) and exit after one score.');

const bench = {
  logic: view(
    'Time a short GPT training loop',
    'Run a few forward and backward steps on a 12-layer GPT and report milliseconds and estimated utilization.',
    [
      section('Fixed bench settings', 12, 32, [
        { text: 'Use batch 12 and context 1024.', start: 12, end: 13 },
        { text: 'Leave bias off, and read real data unless told otherwise.', start: 14, end: 15 },
        { text: 'Seed from 1337.', start: 16, end: 25 },
        { text: 'Run on cuda, in bfloat16 when the GPU supports it, else float16.', start: 17, end: 18 },
        { text: 'Compile the model.', start: 19, end: 19 },
        { text: 'Skip the profiler unless profile is set.', start: 20, end: 20 },
        { text: 'Run configurator.py, which executes overrides.', start: 21, end: 21 },
        { text: 'Allow tf32, and use autocast on cuda.', start: 26, end: 30 },
        { text: '# Insight: This file is a shorter train.py. It does not save checkpoints or decay the learning rate.', start: 12, end: 21 }
      ]),
      section('Real tokens, or a random stand-in', 33, 48, [
        { text: 'If real data is on, memory-map OpenWebText train.bin.', start: 34, end: 36 },
        { text: 'Draw windows of **block_size** and the following ids, and move them to the device.', start: 39, end: 42 },
        { text: 'Otherwise fill the batch with random ids below 50304.', start: 46, end: 47 },
        { text: 'Reuse that same random batch every step.', start: 48, end: 48 },
        { text: '# Why: Random ids remove the disk read, so the timing is closer to pure model math.', start: 45, end: 48 }
      ]),
      section('Build a 12-layer GPT and an AdamW', 50, 64, [
        { text: 'Use 12 layers, 12 heads, and width 768.', start: 53, end: 53 },
        { text: 'Turn dropout off, which is 0, so the timing does not jitter.', start: 54, end: 54 },
        { text: 'Build the GPT and move it to the device.', start: 57, end: 58 },
        { text: 'Use AdamW with weight decay 1e-2, learning rate 1e-4, and moments 0.9 and 0.95.', start: 60, end: 60 },
        { text: 'Compile when asked.', start: 62, end: 64 }
      ]),
      section('Optional profiler trace', 66, 94, [
        { text: 'Wait 5 steps, warm up for 5, then record 5.', start: 70, end: 71 },
        { text: 'Profile CPU and CUDA, and write a trace under bench_log.', start: 72, end: 75 },
        { text: 'For each of those steps, score a batch, fetch another, zero gradients, go backward, and step.', start: 83, end: 90 },
        { text: 'Print the step and the loss.', start: 92, end: 92 },
        { text: 'Tell the profiler the step finished.', start: 94, end: 94 },
        { text: '# Insight: The trace is for the PyTorch profiler UI. The simple loop below is the one that prints utilization.', start: 70, end: 75 }
      ]),
      section('Time a burn-in, then a measured loop', 96, 117, [
        { text: 'Synchronize cuda so the clock starts clean.', start: 99, end: 99 },
        { text: 'First run 10 steps and ignore their time. Then run 20.', start: 100, end: 100 },
        { text: 'Each step scores, prefetches, zeros gradients, goes backward, and steps.', start: 103, end: 109 },
        { text: 'Print the loss.', start: 111, end: 111 },
        { text: 'Synchronize again and estimate utilization.', start: 112, end: 115 },
        { text: 'On the measured stage, print milliseconds, times 1000, and the percent, times 100.', start: 116, end: 117 },
        { text: '# Why: The first 10 steps pay for compile and caches. The next 20 are the number the print trusts.', start: 100, end: 116 }
      ])
    ]
  ),
  overview: view(
    'Time a short GPT training loop',
    'A stripped training loop that reports step time and a rough utilization for a 12-layer GPT.',
    [
      section('Bench a few steps of a GPT-2 sized model', 12, 117, [
        { text: 'Use batch 12, context 1024, 12 layers, 12 heads, and width 768.', start: 12, end: 53 },
        { text: 'Run configurator.py, then either memory-map real tokens or draw random ids below 50304.', start: 21, end: 47 },
        { text: 'Step AdamW at learning rate 1e-4 and weight decay 1e-2, with moments 0.9 and 0.95.', start: 60, end: 60 },
        { text: 'Optionally profile 5 plus 5 plus 5 steps and write a trace to bench_log.', start: 70, end: 75 },
        { text: 'Seed from 1337. Otherwise burn in for 10 steps, time 20, and print milliseconds times 1000 and percent times 100.', start: 16, end: 117 },
        { text: '# Insight: Nothing is saved. The point is the clock.', start: 96, end: 117 }
      ])
    ]
  )
};

export const shorts = {
  'data/shakespeare/prepare.py': shakespeare,
  'data/openwebtext/prepare.py': openwebtext,
  'config/train_shakespeare_char.py': trainShakespeare,
  'config/train_gpt2.py': trainGpt2,
  'config/finetune_shakespeare.py': finetune,
  'config/eval_gpt2.py': evalGpt2,
  'config/eval_gpt2_medium.py': evalMedium,
  'config/eval_gpt2_large.py': evalLarge,
  'config/eval_gpt2_xl.py': evalXl,
  'bench.py': bench
};
