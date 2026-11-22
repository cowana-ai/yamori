import { section, view } from './section.mjs';

const logic = view(
  'Fit a GPT by predicting the next token',
  'Load token windows, score the following ids, and step AdamW, saving checkpoints from the master process.',
  [
    section('Start from GPT-2 sized defaults', 32, 78, [
      { text: 'Write checkpoints to **out**.', start: 35, end: 35 },
      { text: 'Score the model every 2000 steps, using 200 batches.', start: 36, end: 38 },
      { text: 'Log every step.', start: 37, end: 37 },
      { text: 'Exit after the first score if eval_only is set.', start: 39, end: 39 },
      { text: 'Otherwise always save a checkpoint after a score.', start: 40, end: 40 },
      { text: 'Start **init_from** scratch, or resume, or a GPT-2 name.', start: 41, end: 41 },
      { text: 'Leave the Weights & Biases log off unless asked.', start: 43, end: 45 },
      { text: 'Read the **dataset** named openwebtext.', start: 47, end: 47 },
      { text: 'Accumulate 5 times 8 micro-batches.', start: 48, end: 48 },
      { text: 'Each micro-batch has 12 sequences of **block_size** 1024.', start: 49, end: 50 },
      { text: 'Use 12 layers, 12 heads, and width 768.', start: 52, end: 54 },
      { text: 'Use dropout 0 for pretraining.', start: 55, end: 55 },
      { text: 'Leave linear and layer-norm bias off.', start: 56, end: 56 },
      { text: 'Start **learning_rate** at 6e-4.', start: 58, end: 58 },
      { text: 'Train for **max_iters** of 600000 steps.', start: 59, end: 59 },
      { text: 'Decay weights by 1e-1.', start: 60, end: 60 },
      { text: 'Use Adam moments 0.9 and 0.95.', start: 61, end: 62 },
      { text: 'Clip gradients at 1, unless clipping is disabled.', start: 63, end: 63 },
      { text: 'Warm up for 2000 steps.', start: 66, end: 66 },
      { text: 'Decay the rate until step 600000.', start: 67, end: 67 },
      { text: 'Do not decay below 6e-5, about learning_rate/10.', start: 68, end: 68 },
      { text: 'Talk to other GPUs with the nccl backend.', start: 70, end: 70 },
      { text: 'Train on cuda, in bfloat16 when the GPU supports it, else float16.', start: 72, end: 73 },
      { text: 'Compile the model when PyTorch can.', start: 74, end: 74 },
      '',
      { text: 'Remember every simple setting for the log.', start: 76, end: 76 },
      { text: 'Run configurator.py, which executes a config file and applies flags.', start: 77, end: 77 },
      { text: 'Keep the settings that remain.', start: 78, end: 78 },
      { text: '# Insight: The script you pass, such as config/train_shakespeare_char.py, runs inside this process and replaces these defaults.', start: 77, end: 77 },
      { text: '# Context: Executing that file is intentional. It is not an import. Names like **block_size** are globals of this script.', start: 77, end: 78 }
    ]),
    section('Use one GPU, or share the step across many', 81, 112, [
      { text: 'If RANK is set, this is a distributed run.', start: 82, end: 82 },
      { text: 'Join the process group.', start: 84, end: 84 },
      { text: 'Read this process\'s rank, local GPU, and world size.', start: 85, end: 87 },
      { text: 'Pin this process to its own cuda device.', start: 88, end: 89 },
      { text: 'Let rank 0 be the master. It logs and saves.', start: 90, end: 90 },
      { text: 'Offset the seed by the rank.', start: 91, end: 91 },
      { text: 'Require the accumulation steps to divide by the world size.', start: 94, end: 94 },
      { text: 'Give each process an equal share of those steps.', start: 95, end: 95 },
      { text: 'Otherwise one process is the master, with seed offset 0.', start: 97, end: 100 },
      '',
      { text: 'Count tokens per step: accumulation, times world size, times batch, times **block_size**.', start: 101, end: 101 },
      { text: 'Print that count.', start: 102, end: 102 },
      { text: 'Create the output directory on the master.', start: 104, end: 105 },
      { text: 'Seed PyTorch from 1337 plus the offset.', start: 106, end: 106 },
      { text: 'Allow tf32 matrix multiplies.', start: 107, end: 108 },
      { text: 'Treat the device as cuda only when its name contains cuda.', start: 109, end: 109 },
      { text: 'Pick the matching floating-point type.', start: 111, end: 111 },
      { text: 'On cuda, run the forward in autocast. On cpu, do not.', start: 112, end: 112 },
      { text: '# Insight: Splitting accumulation keeps the global batch the same while each GPU holds a smaller piece.', start: 92, end: 95 }
    ]),
    section('Read a window of ids and the ids that follow', 114, 131, [
      { text: 'Point at data/<dataset>/.', start: 115, end: 115 },
      { text: 'Memory-map train.bin or val.bin as uint16.', start: 119, end: 122 },
      { text: 'Draw random starts that still leave room for **block_size**.', start: 123, end: 123 },
      { text: 'Stack **block_size** ids from each start as the input.', start: 124, end: 124 },
      { text: 'Stack the next **block_size** ids as the targets.', start: 125, end: 125 },
      { text: 'Cast those ids to int64.', start: 124, end: 125 },
      { text: 'On cuda, pin the batch and copy it without blocking.', start: 126, end: 128 },
      { text: 'Otherwise copy it to the device.', start: 130, end: 130 },
      { text: 'Return the input and the targets.', start: 131, end: 131 },
      { text: '# Why: The target window is the input window shifted by one. Position t is trained to name the id at t+1.', start: 124, end: 125 },
      { text: '# Insight: The map is reopened every batch. The source does this to avoid a memory leak in long runs.', start: 117, end: 122 }
    ]),
    section('Take the vocabulary from the dataset, if it saved one', 133, 144, [
      { text: 'Start at step 0.', start: 134, end: 134 },
      { text: 'Treat 1e9 as a stand-in for the best validation loss.', start: 135, end: 135 },
      { text: 'Look for meta.pkl beside the binaries.', start: 138, end: 140 },
      { text: 'If it exists, read it and keep **vocab_size**.', start: 141, end: 143 },
      { text: 'Print the size that was found.', start: 144, end: 144 },
      { text: '# Context: The character-level prepare script writes this file. OpenWebText\'s prepare script does not, so training then falls back to the GPT-2 vocabulary.', start: 137, end: 143 }
    ]),
    section('Build a new model, resume, or load GPT-2', 146, 193, [
      { text: 'Start the model args from the settings above.', start: 147, end: 148 },
      { text: 'If starting from scratch:', start: 149, end: 149 },
      { text: '    Use the dataset vocabulary, or 50304 when there is none.', start: 153, end: 155 },
      { text: '    Build a new GPT.', start: 156, end: 157 },
      { text: 'If resuming:', start: 158, end: 158 },
      { text: '    Load ckpt.pt from the output directory onto the device.', start: 161, end: 162 },
      { text: '    Copy depth, heads, width, context, bias, and vocabulary from the checkpoint.', start: 166, end: 167 },
      { text: '    Build that GPT and load its weights.', start: 169, end: 178 },
      { text: '    Strip a _orig_mod. prefix torch.compile sometimes leaves on names.', start: 174, end: 177 },
      { text: '    Restore the step count and the best validation loss.', start: 179, end: 180 },
      { text: 'If the name starts with gpt2:', start: 181, end: 181 },
      { text: '    Load that OpenAI checkpoint, overriding dropout.', start: 184, end: 185 },
      { text: '    Read the resulting sizes back into the args.', start: 187, end: 188 },
      { text: 'If the requested context is shorter than the model\'s, crop it.', start: 190, end: 192 },
      { text: 'Move the model to the device.', start: 193, end: 193 },
      { text: '# Insight: Resume must match the checkpoint\'s shape. Dropout and other settings may still come from the command line.', start: 164, end: 167 }
    ]),
    section('Scale gradients, compile, and wrap extra GPUs', 195, 212, [
      { text: 'Enable the gradient scaler only for float16.', start: 196, end: 196 },
      { text: 'Build AdamW from the model\'s decay groups.', start: 199, end: 199 },
      { text: 'If resuming, load the optimizer state too.', start: 200, end: 201 },
      { text: 'Drop the checkpoint from memory.', start: 202, end: 202 },
      { text: 'If compile is on, compile the model. This can take about a minute.', start: 205, end: 208 },
      { text: 'If this is distributed, wrap the model so gradients sync.', start: 211, end: 212 },
      { text: '# Context: bfloat16 does not need the scaler. float16 does, because its range underflows on small gradients.', start: 195, end: 196 }
    ]),
    section('Score both splits without changing weights', 214, 228, [
      { text: 'Switch the model to eval.', start: 218, end: 218 },
      { text: 'For train and for val, average **eval_iters** batches.', start: 219, end: 225 },
      { text: 'Run each batch under the same autocast as training.', start: 223, end: 224 },
      { text: 'Record the loss as a plain number.', start: 225, end: 225 },
      { text: 'Switch the model back to train.', start: 227, end: 227 },
      { text: 'Return both averages.', start: 228, end: 228 },
      { text: '# Insight: eval turns dropout off, and no_grad keeps this measurement from creating a graph or stepping the weights.', start: 215, end: 227 }
    ]),
    section('Warm the learning rate, then cosine down', 230, 242, [
      { text: 'During warmup, grow the rate linearly with the step.', start: 233, end: 234 },
      { text: 'The first step is **learning_rate** over warmup_iters + 1.', start: 234, end: 234 },
      { text: 'After the decay horizon, stay at **min_lr**.', start: 236, end: 237 },
      { text: 'In between, follow a cosine from 1 down to 0.', start: 239, end: 241 },
      { text: 'Use the halfway mix: $c = 0.5 \\cdot (1 + \\cos(\\pi r))$.', start: 241, end: 241 },
      { text: 'Return **min_lr** plus that fraction of the gap up to **learning_rate**.', start: 242, end: 242 },
      { text: '# Why: A small rate at step 0 avoids a wild first update. The cosine then spends more time at the lower rates than a straight line would.', start: 232, end: 242 }
    ]),
    section('Open an optional run log', 244, 247, [
      { text: 'If logging is on and this is the master, import wandb.', start: 245, end: 246 },
      { text: 'Start a run named from the settings.', start: 247, end: 247 },
      { text: '# Context: Other ranks stay quiet. The master is the only process that records the curve.', start: 245, end: 247 }
    ]),
    section('Set the rate, score, and save a checkpoint', 249, 288, [
      { text: 'Fetch one training batch, and start the clock.', start: 250, end: 251 },
      { text: 'Keep the unwrapped model for checkpoints and the speed estimate.', start: 253, end: 254 },
      { text: 'Set every parameter group to this step\'s learning rate.', start: 258, end: 260 },
      { text: 'On each score interval, and only on the master:', start: 263, end: 263 },
      { text: '    Measure train and validation loss.', start: 264, end: 265 },
      { text: '    Print both.', start: 265, end: 265 },
      { text: '    Optionally send the losses, the rate, and the utilization times 100 to the log.', start: 266, end: 273 },
      { text: '    If validation improved, or saving is forced, remember the new best.', start: 274, end: 275 },
      { text: '    After step 0, save the weights, optimizer, args, step, best loss, and config.', start: 276, end: 286 },
      { text: '    Write them to ckpt.pt in the output directory.', start: 285, end: 286 },
      { text: 'If this is step 0 and eval_only is set, stop.', start: 287, end: 288 },
      { text: '# Insight: Step 0 can score a freshly built model, but it does not write a checkpoint yet.', start: 274, end: 276 }
    ]),
    section('Accumulate gradients, clip, and step', 290, 314, [
      { text: 'For each micro-batch:', start: 292, end: 292 },
      { text: '    On a distributed run, sync gradients only on the last micro-batch.', start: 293, end: 298 },
      { text: '    Score the current batch under autocast.', start: 299, end: 300 },
      { text: '    Divide the loss by the number of micro-batches.', start: 301, end: 301 },
      { text: '    Fetch the next batch while this one finishes.', start: 303, end: 303 },
      { text: '    Scale the loss and run backward.', start: 305, end: 305 },
      { text: 'If gradient clipping is on:', start: 307, end: 307 },
      { text: '    Unscale, then clip the global norm at **grad_clip**.', start: 308, end: 309 },
      { text: 'Step AdamW and update the scaler.', start: 311, end: 312 },
      { text: 'Drop the gradients.', start: 314, end: 314 },
      { text: '# Why: Dividing the loss makes the accumulated gradient match one big batch, instead of summing several full-size ones.', start: 301, end: 301 },
      { text: '# Insight: The next batch is requested before backward, so the copy can overlap the GPU work.', start: 302, end: 305 }
    ]),
    section('Time the step, then stop at the horizon', 316, 336, [
      { text: 'Measure how long the step took.', start: 317, end: 319 },
      { text: 'On log intervals, and only on the master:', start: 320, end: 320 },
      { text: '    Undo the loss division, so the printed loss matches a full batch.', start: 323, end: 323 },
      { text: '    After 5 steps, estimate utilization for this process\'s sequences.', start: 324, end: 325 },
      { text: '    Smooth it as 0.9 of the old estimate plus 0.1 of the new one.', start: 326, end: 326 },
      { text: '    Print the loss, the milliseconds (times 1000), and the percent utilization (times 100).', start: 327, end: 327 },
      { text: 'Advance the global step and this process\'s step.', start: 328, end: 329 },
      { text: 'Stop once the step passes **max_iters**.', start: 332, end: 333 },
      { text: 'If this was distributed, leave the process group.', start: 335, end: 336 },
      { text: '# Insight: Reading the loss back to the CPU synchronizes the GPU. That is why the clock includes more than the matmul.', start: 321, end: 323 }
    ])
  ]
);

const overview = view(
  'Fit a GPT by predicting the next token',
  'A config may replace the GPT-2 defaults, then each step lowers next-token cross-entropy and the master process saves checkpoints.',
  [
    section('Defaults describe a GPT-2 run, until a config replaces them', 32, 78, [
      { text: 'Assume OpenWebText, context 1024, 12 layers, 12 heads, width 768, and 600000 steps.', start: 47, end: 59 },
      { text: 'Accumulate 5 times 8 micro-batches of 12 sequences.', start: 48, end: 49 },
      { text: 'Start the learning rate at 6e-4, warm up for 2000 steps, and decay to 6e-5.', start: 58, end: 68 },
      { text: 'Use Adam moments 0.9 and 0.95, and weight decay 1e-1.', start: 60, end: 62 },
      { text: 'Run configurator.py so a config file or flags can replace any of these.', start: 77, end: 77 },
      { text: '# Insight: That run executes the config. It is how the Shakespeare experiment takes over this file.', start: 77, end: 77 }
    ]),
    section('One process or many GPUs share one global batch', 81, 112, [
      { text: 'A distributed launch splits the accumulation steps and lets rank 0 log and save.', start: 82, end: 95 },
      { text: 'Seed from 1337, and run the forward in autocast on cuda.', start: 106, end: 112 },
      { text: '# Insight: Each GPU sees fewer micro-batches, but the tokens per step stay the same.', start: 92, end: 101 }
    ]),
    section('Batches are token windows and the following ids', 114, 144, [
      { text: 'Memory-map the dataset binaries and take **block_size** ids, then the next **block_size** as targets.', start: 119, end: 125 },
      { text: 'If meta.pkl exists, use its vocabulary. Otherwise remember a best loss of 1e9 as a placeholder.', start: 135, end: 143 },
      { text: '# Why: The target at each position is the next id, so the loss is next-token prediction.', start: 124, end: 125 }
    ]),
    section('The model is new, resumed, or a published GPT-2', 146, 212, [
      { text: 'From scratch, use the dataset vocabulary or 50304.', start: 153, end: 157 },
      { text: 'From a checkpoint, restore weights, the optimizer, and the step.', start: 161, end: 201 },
      { text: 'From a gpt2 name, load those weights.', start: 184, end: 185 },
      { text: 'Crop the context if this run wants a shorter one, then compile if asked.', start: 190, end: 208 }
    ]),
    section('Each step lowers the loss, then may save', 214, 336, [
      { text: 'Warm the learning rate, then follow a cosine down using the 0.5 mix.', start: 233, end: 242 },
      { text: 'On score intervals the master measures loss with dropout off and writes ckpt.pt.', start: 263, end: 286 },
      { text: 'Micro-batches divide the loss, sync gradients only at the end, clip, and step AdamW.', start: 292, end: 314 },
      { text: 'After 5 steps, smooth a utilization estimate with weights 0.9 and 0.1.', start: 324, end: 326 },
      { text: 'Print milliseconds times 1000 and percent times 100, then stop after **max_iters**.', start: 327, end: 333 },
      { text: '# Insight: The saved file holds weights, optimizer state, and the config, so sample.py and a later resume can continue.', start: 277, end: 286 }
    ])
  ]
);

export const train = { logic, overview };
