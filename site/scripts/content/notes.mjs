const term = (term, meaning, line, aliases = []) => ({ term, aliases, meaning, line });

export const notesBody = {
  overview: 'nanoGPT is a small, readable GPT you can train and sample. model.py is the transformer; train.py fits it by predicting the next token; sample.py draws text from the result. A config file and configurator.py swap in a specific experiment, such as the character-level Shakespeare run.',
  clusters: [
    { name: 'The model', summary: 'The GPT definition: embeddings, causal blocks, the next-token loss, and sampling.', files: ['model.py'] },
    { name: 'Training', summary: 'The optimization loop, plus a short benchmark of the same step.', files: ['train.py', 'bench.py'] },
    { name: 'Sampling', summary: 'Drawing text from a checkpoint or from a published GPT-2.', files: ['sample.py'] },
    { name: 'Settings', summary: 'Globals that name an experiment, and the snippet that applies them.', files: ['configurator.py', 'config/train_shakespeare_char.py', 'config/train_gpt2.py', 'config/finetune_shakespeare.py', 'config/eval_gpt2.py', 'config/eval_gpt2_medium.py', 'config/eval_gpt2_large.py', 'config/eval_gpt2_xl.py'] },
    { name: 'Data', summary: 'Scripts and notes that turn text into the binary token streams training reads.', files: ['data/shakespeare_char/prepare.py', 'data/shakespeare_char/readme.md', 'data/shakespeare/prepare.py', 'data/shakespeare/readme.md', 'data/openwebtext/prepare.py', 'data/openwebtext/readme.md'] },
    { name: 'Notes', summary: 'The project introduction, plus notebooks that estimate size and scaling.', files: ['README.md', 'scaling_laws.ipynb', 'transformer_sizing.ipynb'] }
  ],
  readingPath: [
    { file: 'model.py', why: 'The transformer itself: attention, the stack, the loss, and how new tokens are drawn.' },
    { file: 'data/shakespeare_char/prepare.py', why: 'See how text becomes the integer ids the small Shakespeare run trains on.' },
    { file: 'train.py', why: 'Follow one optimization step, from a window of ids to an updated model.' },
    { file: 'sample.py', why: 'Turn a trained model back into text, one sampled id at a time.' },
    { file: 'config/train_shakespeare_char.py', why: 'The small Shakespeare settings the README tells you to run.' },
    { file: 'configurator.py', why: 'How that config file and command-line flags replace train.py defaults.' }
  ],
  files: {
    'model.py': {
      purpose: 'Defines the GPT: causal attention, the block stack, the next-token loss, and sampling.',
      role: 'model definition',
      terms: [
        term('block_size', 'How many tokens one sequence may hold. The position table, the causal mask, and training windows all use this length.', 110),
        term('vocab_size', 'How many distinct token ids the model can name. The default 50304 pads GPT-2\'s 50257 up to a multiple of 64.', 111),
        term('n_layer', 'How many identical transformer blocks are stacked.', 112),
        term('n_head', 'How many attention heads run inside each block.', 113),
        term('n_embd', 'The width of each token\'s vector, shared by the embeddings, the blocks, and the output head.', 114),
        term('dropout', 'The probability of zeroing a value during training. Evaluation turns this off.', 115),
        term('bias', 'Whether linear layers and layer norms learn an additive shift. Off is a bit faster.', 116),
        term('wte', 'The token embedding table: one learned vector per vocabulary id.', 127, ['tok_emb']),
        term('wpe', 'The position embedding table: one learned vector per position in the context.', 128, ['pos_emb']),
        term('lm_head', 'The linear map from a token vector to one score per vocabulary id. It shares weights with wte.', 133),
        term('logits', 'Raw scores over the vocabulary, before softmax. Cross-entropy compares them with the target ids.', 186)
      ]
    },
    'train.py': {
      purpose: 'Trains a GPT on next-token loss and writes checkpoints.',
      role: 'training loop',
      terms: [
        term('init_from', 'Where the weights come from: scratch, a checkpoint in the output directory, or a GPT-2 name.', 41),
        term('dataset', 'Which prepared folder under data/ supplies train.bin, val.bin, and maybe meta.pkl.', 47),
        term('gradient_accumulation_steps', 'How many micro-batches are summed before AdamW steps, to imitate a larger batch.', 48),
        term('learning_rate', 'The peak step size for AdamW, before warmup and cosine decay.', 58),
        term('max_iters', 'How many optimizer steps to take before the script stops.', 59),
        term('dtype', 'The floating-point type used on the GPU: float32, bfloat16, or float16.', 73)
      ]
    },
    'sample.py': {
      purpose: 'Loads a checkpoint or GPT-2 and prints sampled text.',
      role: 'sampling script',
      terms: [
        term('max_new_tokens', 'How many new ids to append to the prompt in each sample.', 16),
        term('temperature', 'Divides the last-position scores before softmax. Below 1 makes the distribution sharper.', 17),
        term('top_k', 'How many of the most likely ids stay eligible. The rest are given probability zero.', 18),
        term('num_samples', 'How many independent continuations to draw and print.', 15)
      ]
    },
    'configurator.py': {
      purpose: 'Overrides a script\'s globals from a config file or flags.',
      role: 'settings override',
      terms: []
    },
    'bench.py': {
      purpose: 'Times a few training steps and estimates GPU utilization.',
      role: 'benchmark',
      terms: [
        term('real_data', 'When true, time real OpenWebText windows. When false, reuse one random batch so disk is out of the clock.', 15)
      ]
    },
    'config/train_shakespeare_char.py': {
      purpose: 'Sets the small character-level Shakespeare run.',
      role: 'experiment config',
      terms: []
    },
    'config/train_gpt2.py': {
      purpose: 'Sets the 124M GPT-2 run on OpenWebText.',
      role: 'experiment config',
      terms: []
    },
    'config/finetune_shakespeare.py': {
      purpose: 'Fine-tunes GPT-2 XL on tokenized Shakespeare for a few steps.',
      role: 'experiment config',
      terms: []
    },
    'config/eval_gpt2.py': {
      purpose: 'Scores base GPT-2 and then exits.',
      role: 'experiment config',
      terms: []
    },
    'config/eval_gpt2_medium.py': {
      purpose: 'Scores GPT-2 medium and then exits.',
      role: 'experiment config',
      terms: []
    },
    'config/eval_gpt2_large.py': {
      purpose: 'Scores GPT-2 large and then exits.',
      role: 'experiment config',
      terms: []
    },
    'config/eval_gpt2_xl.py': {
      purpose: 'Scores GPT-2 XL and then exits.',
      role: 'experiment config',
      terms: []
    },
    'data/shakespeare_char/prepare.py': {
      purpose: 'Downloads Tiny Shakespeare and encodes one character per token.',
      role: 'data preparation',
      terms: [
        term('stoi', 'Map from a character to its integer id, built from the sorted alphabet of this file.', 30),
        term('itos', 'Map from an integer id back to its character. The inverse of stoi.', 31)
      ]
    },
    'data/shakespeare/prepare.py': {
      purpose: 'Encodes Tiny Shakespeare with the GPT-2 tokenizer.',
      role: 'data preparation',
      terms: []
    },
    'data/openwebtext/prepare.py': {
      purpose: 'Tokenizes OpenWebText into train and validation binaries.',
      role: 'data preparation',
      terms: []
    },
    'data/shakespeare_char/readme.md': {
      purpose: 'Records the character-level Shakespeare token counts.',
      role: 'dataset note',
      terms: []
    },
    'data/shakespeare/readme.md': {
      purpose: 'Records the GPT-2-token Shakespeare counts.',
      role: 'dataset note',
      terms: []
    },
    'data/openwebtext/readme.md': {
      purpose: 'Records OpenWebText binary sizes and token counts.',
      role: 'dataset note',
      terms: []
    },
    'README.md': {
      purpose: 'Introduces nanoGPT and the Shakespeare quick start.',
      role: 'project introduction',
      terms: []
    },
    'scaling_laws.ipynb': {
      purpose: 'Sketches loss versus compute in the style of Chinchilla.',
      role: 'sizing notes',
      terms: []
    },
    'transformer_sizing.ipynb': {
      purpose: 'Estimates a transformer\'s parameters, FLOPs, and memory.',
      role: 'sizing notes',
      terms: []
    }
  }
};

export const course = {
  id: 'nanogpt',
  title: 'Transformers through nanoGPT',
  kicker: 'Learning path',
  summary: 'Six files, in the order that makes a GPT legible: the model, the integers it trains on, the training step, sampling, the small Shakespeare config, and the few lines that apply that config.',
  intro: [
    'A transformer language model reads a sequence of token ids and scores what the next id should be. nanoGPT is Andrej Karpathy\'s short, complete version of that idea: one model file, one training script, and one sampling script.',
    'You will not install PyTorch or train anything here. Each lesson is the same side-by-side reading Yamori shows in the editor. Pseudocode on one side, the real Python on the other, and a click on a step highlights the lines it stands for.',
    'The path starts at the math, not at main. model.py is the GPT. The character-level Shakespeare prepare script shows what an id actually is. train.py is one optimization step. sample.py turns ids back into text. The last two files are how the README\'s small run replaces the GPT-2-sized defaults.'
  ],
  learn: [
    'Causal attention: each position may look at earlier positions, not later ones, through queries, keys, and values.',
    'How token vectors and position vectors enter a stack of residual blocks, and why the input table and the output head share weights.',
    'Next-token cross-entropy: the training target at each position is the following id.',
    'What a step does: a learning rate that warms up and then cosines down, accumulated micro-batches, and a checkpoint.',
    'Sampling with temperature and top-k, feeding each new id back into the context.',
    'How a config file actually reaches those globals: configurator.py is executed, not imported.'
  ],
  steps: [
    { file: 'model.py', title: 'The GPT', lesson: 'What the network computes, from a token id to a distribution over the next id.' },
    { file: 'data/shakespeare_char/prepare.py', title: 'Characters become ids', lesson: 'The smallest dataset: one character is one token, saved as binaries plus a codec.' },
    { file: 'train.py', title: 'One training step', lesson: 'How those ids become a loss, and how AdamW changes the weights.' },
    { file: 'sample.py', title: 'Text out the other side', lesson: 'Load the checkpoint, encode a prompt with the same codec, and print samples.' },
    { file: 'config/train_shakespeare_char.py', title: 'The small run', lesson: 'The settings the README uses: a 6-layer model, context 256, Shakespeare characters.' },
    { file: 'configurator.py', title: 'How a config lands', lesson: 'The few lines that execute that file into train.py\'s globals, or apply a --key=value flag.' }
  ]
};
