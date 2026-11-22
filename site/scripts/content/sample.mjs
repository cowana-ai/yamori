import { section, view } from './section.mjs';

const logic = view(
  'Draw text from a trained GPT',
  'Load a checkpoint or a published GPT-2, encode a prompt, and print several sampled continuations.',
  [
    section('Choose how to sample, then apply overrides', 11, 32, [
      { text: 'Resume from a checkpoint, unless a GPT-2 name is given.', start: 12, end: 12 },
      { text: 'Read that checkpoint from **out**.', start: 13, end: 13 },
      { text: 'Start the prompt at a newline.', start: 14, end: 14 },
      { text: 'Draw **num_samples** of 10 continuations.', start: 15, end: 15 },
      { text: 'Each continuation adds **max_new_tokens** of 500 ids.', start: 16, end: 16 },
      { text: 'Use temperature 0.8.', start: 17, end: 17 },
      { text: 'Keep only the **top_k** of 200 most likely ids.', start: 18, end: 18 },
      { text: 'Seed both CPU and cuda from 1337.', start: 19, end: 27 },
      { text: 'Run on cuda, in bfloat16 when the GPU supports it, else float16.', start: 20, end: 21 },
      { text: 'Leave compile off.', start: 22, end: 22 },
      { text: 'Run configurator.py, which executes a config file and applies flags.', start: 23, end: 23 },
      { text: 'Allow tf32 matrix multiplies.', start: 28, end: 29 },
      { text: 'On cuda, sample under autocast. On cpu, do not.', start: 30, end: 32 },
      { text: '# Context: Temperature below 1 makes the next-id distribution sharper. 0.8 is only mildly sharp.', start: 17, end: 17 },
      { text: '# Insight: The same configurator train.py uses can point this script at out-shakespeare-char.', start: 23, end: 23 }
    ]),
    section('Load a checkpoint, or a published GPT-2', 34, 54, [
      { text: 'If resuming:', start: 35, end: 35 },
      { text: '    Load ckpt.pt onto the device.', start: 37, end: 38 },
      { text: '    Rebuild the GPT from the saved model args.', start: 39, end: 40 },
      { text: '    Strip a _orig_mod. prefix on weight names, then load them.', start: 41, end: 46 },
      { text: 'If the name starts with gpt2:', start: 47, end: 47 },
      { text: '    Load that OpenAI model with dropout 0.', start: 49, end: 49 },
      { text: 'Switch to eval, and move to the device.', start: 51, end: 52 },
      { text: 'Compile only if asked.', start: 53, end: 54 },
      { text: '# Insight: eval turns dropout off. Sampling with dropout still on would change the distribution every call.', start: 51, end: 51 }
    ]),
    section('Turn text into ids the same way training did', 56, 74, [
      { text: 'If the checkpoint names a dataset and that dataset has meta.pkl:', start: 58, end: 60 },
      { text: '    Read **stoi** and **itos**.', start: 66, end: 66 },
      { text: '    Encode by mapping each character through **stoi**.', start: 67, end: 67 },
      { text: '    Decode by mapping each id through **itos** and joining.', start: 68, end: 68 },
      { text: 'Otherwise assume GPT-2 encodings.', start: 69, end: 72 },
      { text: 'Encode with the gpt2 tokenizer, allowing the end-of-text marker.', start: 73, end: 73 },
      { text: 'Decode ids back to text with that same tokenizer.', start: 74, end: 74 },
      { text: '# Insight: A character-level checkpoint must not be decoded as GPT-2 pieces. meta.pkl is what keeps the alphabet matched.', start: 58, end: 68 },
      { text: '# Context: stoi maps a character to its integer. itos maps that integer back. prepare.py wrote both.', start: 66, end: 68 }
    ]),
    section('Encode the prompt and print samples', 76, 89, [
      { text: 'If the prompt starts with FILE:, read that file as the prompt.', start: 77, end: 79 },
      { text: 'Drop the five-character FILE: prefix to get the path.', start: 78, end: 78 },
      { text: 'Encode the prompt and shape it as one batch on the device.', start: 80, end: 81 },
      { text: 'Without tracking gradients, and under autocast:', start: 84, end: 85 },
      { text: '    For each sample, generate new ids at this temperature and top-k.', start: 86, end: 87 },
      { text: '    Decode the first row and print it.', start: 88, end: 88 },
      { text: '    Print a divider.', start: 89, end: 89 },
      { text: '# Insight: generate appends ids inside the model. This script only decodes the finished row.', start: 87, end: 88 }
    ])
  ]
);

const overview = view(
  'Draw text from a trained GPT',
  'Load the model training saved, encode a short prompt with the matching alphabet, and print sampled continuations.',
  [
    section('Sampling knobs, then any override', 11, 32, [
      { text: 'Draw 10 samples of 500 new ids, at temperature 0.8, keeping the top 200.', start: 15, end: 18 },
      { text: 'Seed from 1337 and run configurator.py so flags can retarget the checkpoint.', start: 19, end: 27 },
      { text: '# Insight: Executing the configurator is how --out_dir=out-shakespeare-char reaches this script.', start: 23, end: 23 }
    ]),
    section('Restore weights and the matching codec', 34, 74, [
      { text: 'Resume loads ckpt.pt. A gpt2 name loads that public model with dropout 0.', start: 37, end: 49 },
      { text: 'A character model uses **stoi** and **itos** from meta.pkl.', start: 66, end: 68 },
      { text: 'Otherwise use the gpt2 tokenizer.', start: 72, end: 74 },
      { text: '# Insight: The codec has to be the one that built the ids. Mixing them produces nonsense.', start: 65, end: 74 }
    ]),
    section('Prompt, then print each sample', 76, 89, [
      { text: 'A FILE: prefix means read the prompt from a path, dropping those 5 characters.', start: 77, end: 79 },
      { text: 'Generate without gradients, decode, and print.', start: 84, end: 89 }
    ])
  ]
);

export const sample = { logic, overview };
