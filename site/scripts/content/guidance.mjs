/** Pregenerated learner guidance — merged into course.json at author time. */

export const platform = {
  name: 'Yamori Learn',
  format: 'Self-paced · browser only · about 90 minutes',
  audience: 'Curious beginners who learn best by reading real code',
  prerequisites: [
    'You can skim Python without running it.',
    'You do not need PyTorch, a GPU, or prior transformer coursework.'
  ],
  studyGuide: [
    {
      title: 'Lessons open in Logic',
      body: 'Each file opens on the step-by-step reading, with a short source range on every step.'
    },
    {
      title: 'Click to connect story and source',
      body: 'Select a numbered block (or a line of Python). The other pane lights up so you always know where the idea lives.'
    },
    {
      title: 'Overview is the short pass',
      body: 'Switch to Overview for fewer blocks and the shape of the file. Toggle any time.'
    },
    {
      title: 'Follow the lessons in order',
      body: 'The path is deliberate: data, model, training, sampling, then how the small Shakespeare run is configured.'
    }
  ]
};

/** Keys must match course step `file` paths. */
export const steps = {
  'data/shakespeare_char/prepare.py': {
    minutes: 12,
    objectives: [
      'See where Tiny Shakespeare lives on disk after this script runs.',
      'Understand why one character maps to one integer id here.',
      'Name the files train.py will open later.'
    ],
    primer: 'No training yet — just housekeeping: download, encode, write binaries.',
    takeaway: 'Training data is not "text files"; it is packed integers plus a small codec.',
    checks: [
      'What is stored in train.bin versus meta.pkl?',
      'Why build stoi and itos before writing bytes?'
    ]
  },
  'model.py': {
    minutes: 20,
    objectives: [
      'Follow one token id from embedding to next-token scores.',
      'See where attention blocks sit in the stack.',
      'Separate training loss from sampling.'
    ],
    primer: 'This is the densest lesson. Take one block at a time.',
    takeaway: 'A GPT here is embeddings, repeated blocks, and a shared table that both reads tokens and writes scores.',
    checks: [
      'What does block_size limit?',
      'Where do logits get compared to the next id?'
    ]
  },
  'train.py': {
    minutes: 18,
    objectives: [
      'Trace one optimizer step from batch to weight update.',
      'See where loss is computed and backprop starts.',
      'Notice what gets saved as a checkpoint.'
    ],
    primer: 'Imagine the binaries from lesson 1 feeding this loop — you are only reading one pass.',
    takeaway: 'Training is repeated: sample windows, predict next ids, nudge weights, occasionally save.',
    checks: [
      'What does gradient accumulation change about batch size?',
      'When does the learning rate schedule matter?'
    ]
  },
  'sample.py': {
    minutes: 12,
    objectives: [
      'Load weights and run the model in eval mode.',
      'See how temperature and top_k change randomness.',
      'Watch ids decode back to characters.'
    ],
    primer: 'You are running the model backwards — from prompt ids to printed text.',
    takeaway: 'Sampling reuses the same codec as training; each new id is fed back as context.',
    checks: [
      'Why divide by temperature before softmax?',
      'What happens after each sampled id?'
    ]
  },
  'config/train_shakespeare_char.py': {
    minutes: 10,
    objectives: [
      'List the hyperparameters that shrink GPT-2 defaults.',
      'Connect dataset path to lesson 1.',
      'See how a README command names this file.'
    ],
    primer: 'A config file is just variable assignments — no magic syntax.',
    takeaway: 'The small run is mostly smaller width, depth, and context plus the char dataset path.',
    checks: [
      'Which settings make this "character Shakespeare" instead of GPT-2 scale?',
      'Where is the dataset path set?'
    ]
  },
  'configurator.py': {
    minutes: 8,
    objectives: [
      'See how a config file executes into train.py globals.',
      'Read one command-line override path.',
      'Understand why this is exec, not import.'
    ],
    primer: 'Short file, big payoff — this is how experiments swap without editing train.py.',
    takeaway: 'Running with a config path replaces defaults by executing Python in train\'s namespace.',
    checks: [
      'What happens when you pass config/train_shakespeare_char.py?',
      'How could a --key=value flag override one variable?'
    ]
  }
};