// Blog copy shown after each pseudocode block. Not part of Yamori's
// explanation schema. `digest` is a restatement in prose. `next` says what
// the following block, or the following lesson, is about to do.
const note = (digest, next) => ({ digest, next });

const prepareLogic = [
  note(
    'This block is only about getting the raw text onto disk. If input.txt is already beside the script, nothing is downloaded. If it is missing, the script fetches the same tiny Shakespeare file character-level demos have used for years and saves it as plain text. There is no model here yet, and no numbers. Just a file of letters.',
    'Next the file becomes a vocabulary. You will see the alphabet of this text sorted, then two maps: character to integer, and integer back to character. That pair is the whole tokenizer.'
  ),
  note(
    'A token here is one character. The script reads the play, lists every distinct character, and sorts that list so the ids stay stable. stoi turns a letter into its place in that list. itos turns the place back into a letter. Encoding is a walk along the string. Decoding is joining those letters again. About 65 symbols cover this file, including space and punctuation.',
    'Next those ids get written in the form the trainer expects. The text is cut once, near the end, and both pieces are stored as small integers plus a pickle that remembers the alphabet.'
  ),
  note(
    'Training does not read the play. It reads two binary files. The first 90% of the characters become train.bin, the last 10% become val.bin, and every id is stored as a 16-bit integer, which is plenty for an alphabet of 65. meta.pkl sits beside them and holds vocab_size, stoi, and itos, so a later script can turn ids back into letters. The split is a single cut, not a shuffle, so validation is later text from the same file.',
    'The next lesson leaves the data behind and opens model.py. That file is the network: how a row of character ids becomes a score for the next character. Expect embeddings, a stack of blocks, and a loss. It is the densest lesson on the path.'
  )
];

const prepareOverview = [
  note(
    'The character dataset is a download plus a homemade alphabet. Tiny Shakespeare lands in input.txt, the set of characters in that file is the vocabulary, and two dictionaries translate both directions. One character is one token. That is the entire difference from a GPT-2 tokenizer.',
    'Next the script cuts the text and writes the files train.py and sample.py actually open: two binaries of ids, and a small pickle that remembers how to turn those ids back into letters.'
  ),
  note(
    'The cut is at nine tenths of the string. Both sides are encoded and saved as uint16. meta.pkl keeps the vocabulary and both maps. train.py will memory-map the binaries. sample.py will load the pickle so a prompt can be letters on the way in and letters on the way out.',
    'Next lesson is model.py, the GPT itself. You will see how those integer ids become vectors, pass through a stack of blocks that may only look left, and come out as a score for the next id.'
  )
];

export const blog = {
  'data/shakespeare_char/prepare.py': { logic: prepareLogic, overview: prepareOverview },
  'data/shakespeare/prepare.py': {
    logic: [
      note(
        'This is the other Shakespeare prepare script. It wants the same play text, but it will not invent an alphabet. If input.txt is missing it downloads the file. If the file is already there, it moves on. The interesting choice is still ahead: which tokenizer to use.',
        'Next the text is cut at 90%, then encoded with the GPT-2 tokenizer. The ids you get are word-pieces, not characters, and there is no meta.pkl beside the binaries.'
      ),
      note(
        'The split is the same blunt cut as the character script: head for training, tail for validation. Encoding uses tiktoken\'s GPT-2 encoding and skips special tokens, so you get ordinary piece ids packed as uint16. Because no codec file is written, anything that decodes these bins later is expected to assume GPT-2. That matches this tokenizer and would be wrong for the character dataset.',
        'This file is off the guided path. The course uses the character prepare script, then the model. Come back here when you want the same plays as GPT-2 pieces instead of letters.'
      )
    ],
    overview: [
      note(
        'Same plays, different tokens. The script downloads Tiny Shakespeare if needed, holds out the last tenth of the characters, and encodes both sides with the GPT-2 tokenizer instead of a character alphabet. The binaries are uint16 piece ids. No meta.pkl is written, so anything that decodes them later is expected to assume GPT-2.',
        'The guided path uses the character version of this dataset instead. The next lesson there is model.py, where those ids, character or piece, enter the network.'
      )
    ]
  },
  'data/openwebtext/prepare.py': {
    logic: [
      note(
        'OpenWebText is the large web corpus the default GPT-2-sized run expects. This block only fetches it and peels off a tiny validation slice, half a thousandth of the documents, shuffled with a fixed seed. Eight worker processes are named for the later mapping step. The download itself is large. Only the main process does it.',
        'Next each document is turned into GPT-2 ids, and an end-of-text marker is glued on so the model can learn where one document stops and the next begins.'
      ),
      note(
        'A document is encoded with the ordinary GPT-2 tokenizer, then the id 50256 is appended. That id is the end-of-text token. The code appends it. A comment in the source wonders whether it should have been prepended instead. What is stored is the encoded text plus that trailing marker, and the length, for both splits, using the same eight workers.',
        'Next those lists of ids are written into two big binary files. train.py will memory-map them. It will never open the original documents.'
      ),
      note(
        'Each split becomes one memory-mapped array of uint16. 50256 fits in 16 bits, so the dtype is safe. The write walks the documents in 1024 shards so the map is filled in contiguous chunks, then flushed. From here the corpus is just a long tape of token ids with end-of-text markers sprinkled at document boundaries.',
        'This is the dataset behind the big GPT-2 config, not the first lesson. The guided path starts with character Shakespeare, then model.py.'
      )
    ],
    overview: [
      note(
        'This is the full-scale data script. It downloads OpenWebText, holds out a tiny shuffled validation set, encodes documents with the GPT-2 tokenizer, appends the end-of-text id 50256, and writes each split as a uint16 binary in 1024 shards. Those bins are what a default train.py run reads.',
        'The guided course uses the small character dataset first. When you want the 124M-style run, this file is the data half and config/train_gpt2.py is the settings half.'
      )
    ]
  },
  'model.py': {
    logic: [
      note(
        'Seven numbers describe the whole network. block_size is how many tokens fit in one sequence. vocab_size is how many distinct ids exist. n_layer, n_head, and n_embd are depth, heads, and width. dropout and bias are the two training switches. The defaults are a small GPT-2: context 1024, vocabulary padded from 50257 up to 50304, twelve layers, twelve heads, width 768.',
        'Next is attention, the part people mean when they say transformer. You will see a token build a query, a key, and a value, then be forbidden from looking at anything later in the sequence.'
      ),
      note(
        'Causal attention is a lookup that can only see the past. Each token is projected into query, key, and value together, three times the width, then split across heads. Scores are a dot product, scaled down by the square root of the head width so softmax does not saturate, and future positions are masked with negative infinity, or handed to Flash Attention with is_causal. The weighted values are mixed and projected back. A token never reads a later token. That is the entire constraint.',
        'Next is the other half of a block, the feed-forward layer. It does not look at other positions at all. It widens one token\'s vector, bends it, and squeezes it back.'
      ),
      note(
        'After attention has mixed information across time, each token is still just a vector. This layer expands that vector to four times the width, applies GELU, which lets positive values through and shrinks negative ones, then projects back and drops out. Positions do not talk to each other here. Attention already did that.',
        'Next is the small layer-norm that sits in front of both sublayers. It rescales each token\'s channels so the later math sees a steady spread, with an optional learned shift.'
      ),
      note(
        'LayerNorm here is a per-token rescaling of the last dimension. A learned weight stretches each channel. A learned bias, if bias is on, shifts it. Epsilon is 1e-5 so a token whose channels are almost constant does not divide by zero. The point is to hand attention and the feed-forward layer a vector with a predictable scale.',
        'Next those pieces are wired into one block. You will see the two norms, the attention, the feed-forward, and the two additions that put each sublayer\'s output back onto the stream it came from.'
      ),
      note(
        'A block does not replace its input. It adds a change. The stream is normalized and attended, and that result is added back. It is normalized again and passed through the wide layer, and that result is added back too. Those additions are the residual connections. The original token vector stays on the skip path while each sublayer contributes a delta.',
        'Next the blocks are stacked into the actual GPT module. You will see token vectors and position vectors added together, the stack run, and the output table tied to the input table so they share one set of weights.'
      ),
      note(
        'This is the module train.py constructs. Token ids and position ids each pick a row from a learned table, those rows are added, and the sum runs through every block, then a final norm. The output head is a linear map from width to vocabulary, and its weight is the same object as the token table. Matrices start near 0.02, and the residual projections are shrunk further as the stack gets deeper, so the residual path does not explode. The parameter count is just the sum of the tensors, printed in millions.',
        'Next is the forward pass that either trains or predicts. With targets, every position is scored and compared with the following id. Without targets, only the last position is scored, which is all sampling needs.'
      ),
      note(
        'Forward has two jobs and they share the same trunk. Embeddings plus the stack produce a vector per position. If targets were passed in, those vectors become logits for every position and cross-entropy compares them with the next id. That is the training loss. If there are no targets, only the last position is mapped to logits, because the next sample only needs a distribution at the end of the context.',
        'Next is a small utility you will not hit on the first training run. It crops a pretrained model whose context is longer than the one you want to keep.'
      ),
      note(
        'GPT-2 was trained with a context of 1024. If you want a shorter block_size, the position table and the causal mask are larger than you need. This method cuts both down to the new length. It does not retrain anything. It just throws away positions the smaller model will never use.',
        'Next is how a published GPT-2 checkpoint actually enters this class. The names in OpenAI\'s weight file do not match the names in this module, so the copy is a manual translation.'
      ),
      note(
        'from_pretrained builds a fresh GPT of the right size, downloads the matching OpenAI weights, and copies tensors across by hand. Some layers are transposed because OpenAI stored them in a different orientation. The token table and the output head share weights here, so one copied tensor fills both roles. Dropout is forced off for a model you are only loading, not training from scratch. After this, the module holds GPT-2\'s numbers under nanoGPT\'s names.',
        'Next is a detail of the optimizer, not the architecture. AdamW should decay the big matrices and leave the layer-norm scales and biases alone.'
      ),
      note(
        'Weight decay is a pull toward zero on parameters that are matrices. The layer-norm weights, the biases, and the other one-dimensional vectors are grouped separately and decayed with zero. That split is what configure_optimizers returns. It is easy to miss because it is not part of the forward pass, but it changes which numbers the optimizer is willing to shrink.',
        'Next is a tiny FLOP estimate used when someone wants to know how busy the GPU is. It counts the matmuls in a forward and a backward and ignores the cheaper elementwise work.'
      ),
      note(
        'estimate_mfu is a back-of-the-envelope utilization. It counts the multiplies in the attention and the feed-forward for one token, doubles them for the backward pass, scales by tokens per second, and divides by the GPU\'s promised FLOPs. The number is a ratio, not a timer. It tells you whether the step is in the neighborhood of the hardware\'s peak.',
        'The last block of this file is sampling. You will see one new id drawn from the last position\'s scores, appended to the context, and the whole forward pass run again. There is no cache of past attention.'
      ),
      note(
        'generate is a loop. The context is cropped to block_size, the model scores the last position, those scores are divided by temperature, and optionally only the top-k ids are allowed to win. A multinomial draw picks one id, it is appended, and the loop repeats. Every new id is fed back in. Attention is recomputed from scratch each time. This is the function sample.py calls when it wants text.',
        'The next lesson is train.py. The model you just read will be asked, over and over, to name the next id in a window, and the loss from that guess is what moves the weights. Expect one optimization step, not a theory lecture.'
      )
    ],
    overview: [
      note(
        'The architecture is seven numbers: how long a sequence may be, how many ids exist, how many blocks, how many heads, how wide each vector is, how hard to drop out, and whether layers get a bias. The defaults match a small GPT-2, with the vocabulary padded from 50257 up to a multiple of 64.',
        'Next is one block, described as a whole. Attention may only look left, then a small feed-forward mix follows, and both results are added back onto the stream.'
      ),
      note(
        'A block is a residual sandwich. Layer-norm, then causal attention, added back. Layer-norm, then a widen-GELU-squeeze, added back. Attention scores are a scaled dot product and a softmax, with the future hidden. Nothing in the block is allowed to read a later token. That is what "causal" means in this file.',
        'Next the blocks are stacked. Token ids and positions become vectors, the stack runs, and a shared table both reads tokens and writes next-token scores.'
      ),
      note(
        'The GPT module adds a token vector to a position vector, runs every block, and maps the result to a score per vocabulary id. The input table and the output head share weights. If targets are present, cross-entropy compares each position with the following id. If they are not, only the last position is scored. The loss is "name the next id." Sampling only needs that last score.',
        'Next is the sampler that lives at the bottom of this same file. One id is drawn and pushed back into the context, and the model runs again.'
      ),
      note(
        'Sampling crops the context to block_size, divides the last-position scores by a temperature, optionally keeps only the top-k ids, draws one id, and appends it. That new id is just more context on the next pass. There is no key-value cache, so attention starts over every time a token is added.',
        'Next, still in this file, is the loader that copies a published GPT-2 checkpoint into these class names. The shapes match. The names do not, so the copy is explicit.'
      ),
      note(
        'from_pretrained knows the OpenAI GPT-2 sizes, downloads those weights, and copies them tensor by tensor, transposing the ones OpenAI stored the other way. After it returns, this module is GPT-2 under nanoGPT\'s attribute names. Dropout is set to zero because you are loading a finished model.',
        'The last overview block is bookkeeping: which parameters weight decay is allowed to touch, and a rough estimate of how fast the GPU is going.'
      ),
      note(
        'Weight decay hits matrices and skips the layer-norm scales and biases. The speed estimate counts the expensive matmuls in a forward and backward, compares them with a tokens-per-second measurement, and reports a fraction of the GPU\'s peak. Neither of these changes the loss. They change how the optimizer treats parameters, and how you read a benchmark.',
        'The next lesson is train.py. You will watch one window of ids become a loss, and that loss become a single AdamW update.'
      )
    ]
  },
  'train.py': {
    logic: [
      note(
        'Before any loop, train.py is a pile of globals: where the weights come from, which dataset folder to read, how big a batch is, the learning-rate schedule, how often to evaluate and save, and which dtype to use on the GPU. The numbers you see are a GPT-2-scale run. They are not what the small Shakespeare lesson uses. A later file replaces them.',
        'Next is how one process becomes many GPUs. You will see a world size, a rank, and a gradient-accumulation count that together pretend to be one large batch.'
      ),
      note(
        'Distributed training here is optional. If the world size is 1, this is a normal single-process script. If it is more, each process owns a slice of the data and a copy of the model, and gradients are averaged. gradient_accumulation_steps lets a small micro-batch stand in for a large one: several forwards add up before AdamW steps once. The effective batch is micro-batch times accumulation times the number of processes.',
        'Next is the actual training example. A window of token ids is read from the binary you prepared, and the target at each position is the id that follows it.'
      ),
      note(
        'get_batch memory-maps train.bin or val.bin and picks random start positions. Each example is block_size ids, and the target is that same window shifted by one. The model sees x and is scored against y. Nothing in this function knows about letters. It only knows integer ids already on disk.',
        'Next the script asks whether the dataset left a vocabulary size behind. Character data did, in meta.pkl. A GPT-2 run often did not, and then the model\'s default vocabulary stays.'
      ),
      note(
        'If meta.pkl exists, its vocab_size overrides the default. That is how a 65-character model does not accidentally build a 50,304-wide output table. If the pickle is missing, the script keeps the GPT-2-sized vocabulary it started with. This is a few lines, and they are the bridge from the prepare script to the module you just read.',
        'Next the weights are created or loaded. Scratch builds a new GPT. Resume reads a checkpoint. A gpt2 name downloads a public model. You will see all three branches.'
      ),
      note(
        'init_from has three doors. scratch constructs GPT(GPTConfig(...)) with the globals above. resume loads a checkpoint from the output directory and rebuilds the module from the args that were saved with it. A name starting with gpt2 calls the from_pretrained path inside model.py. After this branch, model is a module on the chosen device, in train mode, ready to take a loss.',
        'Next the script wraps that module for speed and for extra GPUs: gradient scaling for float16, torch.compile if you asked, and DistributedDataParallel if more than one process is running.'
      ),
      note(
        'float16 training needs a GradScaler so small gradients do not underflow. bfloat16 and float32 do not. torch.compile, if enabled, replaces the module with a compiled one. If several processes are alive, DDP wraps the model so the backward pass averages gradients. The raw module is kept under a separate name because saving a checkpoint should store the unwrapped weights.',
        'Next is evaluation. Every so often the script scores train and val without stepping the optimizer, so you can see whether the loss is actually falling.'
      ),
      note(
        'estimate_loss flips the model to eval, averages the loss over many batches of each split, then flips back to train. Dropout is off during the measurement, which is the point of eval. No optimizer step happens here. The two numbers, train and val, are what the log line and the "is this the best checkpoint" test use.',
        'Next is the learning-rate schedule as a pure function. Early steps warm up from nearly zero. Later steps follow a cosine down toward a floor. The loop has not started yet.'
      ),
      note(
        'get_lr is a formula of the step index. During warmup it climbs linearly from a small fraction of the peak toward the peak. After warmup it cosine-decays from the peak down to min_lr, and then it sits on that floor. The function does not change any weights. The training loop calls it and writes the number into AdamW.',
        'Next is optional logging to a run tracker. It is off for the small Shakespeare config. The block only matters if you turned it on.'
      ),
      note(
        'If wandb is enabled, the script opens a run so later loss numbers have somewhere to go. If it is disabled, this block is a no-op. The small character config leaves it off, so you can ignore it on a first read and not miss the training step.',
        'Next the loop finally starts. Each iteration sets the learning rate, optionally scores both splits, and sometimes writes a checkpoint when validation improves.'
      ),
      note(
        'The top of the loop is bookkeeping around the step. The learning rate for this iteration is written onto every parameter group. On the evaluation interval, both splits are scored and the master process may save ckpt.pt, including the model args, the weights, and the optimizer, when val loss is the best so far. The forward that produces the training loss is the same forward you read in model.py.',
        'Next is the part that actually changes weights: several micro-batches can add their gradients, the gradient is clipped, and AdamW takes one step.'
      ),
      note(
        'A micro-batch is one forward and backward. If accumulation is greater than one, those gradients sum, and AdamW waits until the last micro-batch. The summed gradient is clipped so a single wild batch cannot kick the weights too far. Then the scaler steps the optimizer and the gradients are zeroed. One "iter" in the log is one of those optimizer updates, not one forward.',
        'The last block times that update and decides whether to stop. You will see tokens per second and, on the master process, the loop ending at max_iters. After that, the next lesson is sample.py, which loads the checkpoint this loop just wrote.'
      ),
      note(
        'After the optimizer step, the script times how long it took and estimates tokens per second. That rate is what the earlier FLOP estimate would use. When the iteration count hits max_iters, the loop ends. On a normal small run the files in the output directory are the model you will sample from. Nothing here prints Shakespeare. It only writes weights.',
        'The next lesson is sample.py. It loads this checkpoint, or a public GPT-2, encodes a prompt with the same alphabet the data used, and prints text. Expect temperature and top-k, then a decode.'
      )
    ],
    overview: [
      note(
        'train.py opens as a list of GPT-2-sized defaults: dataset, batch, context, learning rate, and how often to score and save. Those defaults are a starting point. A config file, executed later, replaces the ones it cares about. The small Shakespeare run is that replacement. It is not these numbers.',
        'Next is the batch arithmetic. One process or many GPUs, plus a few accumulated micro-batches, stand in for a single large batch.'
      ),
      note(
        'The global batch is a product. Each process holds a micro-batch, several micro-batches can accumulate before one optimizer step, and several processes can share the step. With one GPU and one accumulation step, the product collapses and you just have a normal batch. That is the laptop case.',
        'Next is what a batch contains. A random window of ids from the binary, and the ids that follow them, one position to the right.'
      ),
      note(
        'Training examples are slices of the uint16 file. x is block_size ids. y is the next id at every position. If the prepare script saved a vocabulary size, it overrides the model default so a character model stays small. The network is asked, at every position, to name the following id.',
        'Next the weights appear. They are either brand new, loaded from a checkpoint in the output folder, or copied from a published GPT-2.'
      ),
      note(
        'scratch builds a new GPT from the config. resume rebuilds one from ckpt.pt. A gpt2 name downloads that public model. Compile and, when needed, a multi-GPU wrapper sit on top. After this branch the module can take a loss. The unwrapped module is what a checkpoint should store.',
        'The last overview block is the loop itself. The loss is measured, the learning rate moves, gradients accumulate, and a checkpoint is written when validation improves.'
      ),
      note(
        'Each iteration can score train and val without updating weights, set a learning rate that warmed up and is now cosine-decaying, run one or more forwards and backwards, clip the gradient, and step AdamW. A checkpoint is the model, its config, and the optimizer, saved when val loss is the best so far. That file is what sampling will load.',
        'The next lesson is sample.py. The checkpoint becomes text: a prompt goes in as ids, new ids are drawn, and the same codec prints them as characters.'
      )
    ]
  },
  'sample.py': {
    logic: [
      note(
        'Sampling starts as another list of globals. Resume from a checkpoint unless a GPT-2 name is given. Draw ten continuations of 500 new ids, at temperature 0.8, keeping the 200 most likely ids. The seed is 1337. Then configurator.py runs, so a flag or a config path can retarget the output directory before any weights load. Temperature below 1 makes the distribution a bit sharper. 0.8 is only mildly sharp.',
        'Next the weights are actually loaded. A checkpoint is rebuilt from the args saved in ckpt.pt. A gpt2 name takes the public model instead. Dropout is turned off either way.'
      ),
      note(
        'Resume reads ckpt.pt, rebuilds the GPT from the saved model args, and loads the tensors, stripping a compile prefix off the names if torch.compile had wrapped the module. A gpt2 name calls from_pretrained with dropout 0. Then the module is set to eval and moved to the device. Eval matters: dropout left on would change the distribution every call. Compile stays off unless you ask.',
        'Next the script has to speak the same language as the training data. You will see it look for meta.pkl and, if it finds the character maps, use those. Otherwise it assumes GPT-2 pieces.'
      ),
      note(
        'A character checkpoint is only meaningful with the alphabet that built it. If the checkpoint names a dataset and that folder has meta.pkl, encode and decode use stoi and itos. Otherwise the script loads the GPT-2 tokenizer. Mixing them, character ids decoded as word-pieces or the reverse, prints nonsense. The pickle from the first lesson is what keeps letters matched.',
        'The last block turns a prompt into ids, asks the model for new ones, and prints the decoded text. You will see an optional FILE: prefix, then a loop of generate and print.'
      ),
      note(
        'The prompt is a string, or the contents of a file if it starts with FILE:. It is encoded with whichever codec the previous block chose and shaped as a single batch. generate, which you read at the bottom of model.py, appends new ids inside the model. This script does not sample itself. It turns gradients off, calls generate with the temperature and top-k from the top of the file, decodes the finished row, and prints a divider between samples.',
        'The next lesson is the small Shakespeare config. It is a list of assignments, not a program: the output directory, the character dataset, a 6-layer model, and a short training schedule. After that, configurator.py shows how those assignments actually overwrite train.py.'
      )
    ],
    overview: [
      note(
        'The knobs are concrete. Ten samples, 500 new ids each, temperature 0.8, top 200 ids kept. The seed is fixed. configurator.py then runs, which is how a flag like an output directory reaches this script before it opens a checkpoint. Temperature below 1 only sharpens the next-id distribution a little.',
        'Next the checkpoint and the alphabet are loaded together. The weights and the codec have to be the pair that training used.'
      ),
      note(
        'Resume rebuilds the module from ckpt.pt. A gpt2 name loads that public model with dropout off. A character run reads stoi and itos from meta.pkl. Anything else uses the GPT-2 tokenizer. The codec has to be the one that built the ids. Mixing a character model with the GPT-2 tokenizer is how you get garbage text from a fine model.',
        'Next a prompt is encoded, the model draws new ids, and each sample is decoded and printed. generate does the drawing. This script does the printing.'
      ),
      note(
        'A prompt that starts with FILE: is read from a path. Otherwise the string is encoded as one batch. Generation runs without gradients. Each sample is decoded and printed with a divider. The new ids were appended inside model.generate. This file only asks for them and shows the letters.',
        'The next lesson is config/train_shakespeare_char.py, the small run the README tells you to start with. It shrinks the model, points at the character data, and sets a few thousand steps. The lesson after that is the few lines that execute that file into train.py.'
      )
    ]
  },
  'config/train_shakespeare_char.py': {
    logic: [
      note(
        'This file is the cozy run. It writes to out-shakespeare-char, trains on shakespeare_char, and shrinks the network to 6 layers, 6 heads, and width 384, with a context of 256 characters and a batch of 64. Dropout is 0.2. The learning rate is 1e-3 for 5000 steps, decaying to 1e-4, with a short warmup. Checkpoints are kept only when validation improves. None of this runs by itself. It is a list of assignments waiting to be executed inside train.py.',
        'The last lesson is configurator.py. You will see the argument loop that treats this path as code to run, so these names replace train.py\'s GPT-2-sized defaults, and a --key=value flag can override a single one of them.'
      )
    ],
    overview: [
      note(
        'The README\'s first run is this file. Character Shakespeare, context 256, a 6-layer model of width 384, dropout 0.2, learning rate 1e-3 for 5000 steps decaying to 1e-4. It scores often and saves a checkpoint only when validation improves. It is much smaller than the 12-layer default sitting at the top of train.py.',
        'Next, and last on the path, is configurator.py. It is the reason this file works: train.py executes it, so these assignments land on train.py\'s own globals.'
      )
    ]
  },
  'configurator.py': {
    logic: [
      note(
        'configurator.py is not imported. train.py and sample.py execute it, so its writes land in their global variables. An argument without an equals sign is a path. The file is printed and then run in that same global scope, which is how config/train_shakespeare_char.py replaces the defaults. An argument with an equals sign must look like --key=value. The key has to already exist, the value is parsed as a Python literal when it can be, and the type has to match the old value. A typo is an error, not a new setting. literal_eval reads numbers and bools. It does not run arbitrary code. The config file does.',
        'That is the end of the guided path. You have seen characters become ids, ids become a GPT, one training step, sampling back to text, the small Shakespeare settings, and the few lines that install those settings. The library still has the larger GPT-2 configs and the OpenWebText prepare script if you want the same pattern at full size.'
      )
    ],
    overview: [
      note(
        'A config path is executed, not imported, so its assignments hit the caller\'s globals. A --key=value flag overwrites one existing name and refuses a key or a type that is not already there. That is the whole mechanism behind the README command that points train.py at the small Shakespeare file.',
        'This is the last lesson on the path. The story you just walked is data, model, one training step, sampling, the small config, and this loader. Larger configs in the library are the same idea with different numbers.'
      )
    ]
  },
  'config/train_gpt2.py': {
    logic: [
      note(
        'This is the large run, not the laptop one. The model stays at train.py\'s 12-layer, width-768 default. What changes is the batch and the schedule: context 1024, a micro-batch of 12, accumulation across steps and GPUs aimed at about half a million tokens per update, and 600,000 steps of decay. Logging is turned on under the name gpt2-124M. It assumes the OpenWebText binaries exist.',
        'This file is off the guided path. The path uses the character config, then configurator.py, which is the thing that would execute these assignments the same way.'
      )
    ],
    overview: [
      note(
        'Same mechanism as the small config, with different numbers. The 12-layer, width-768 defaults stay in place. What this file changes is the batch, the 600,000-step learning-rate schedule, and a run log named gpt2-124M. The comment above the batch math multiplies batch, context, accumulation, and GPU count, and lands near half a million tokens per step.',
        'The guided path uses the character config, not this one. This file is the full-size sibling, and configurator.py would execute it into train.py the same way it executes the small Shakespeare file.'
      )
    ]
  },
  'config/finetune_shakespeare.py': {
    logic: [
      note(
        'This config does not train from scratch. init_from is gpt2-xl, the dataset is the GPT-2-token Shakespeare set, and the run stops after 20 steps at a flat learning rate of 3e-5. The batch is 1, accumulated 32 times, because the extra-large model is the thing that does not fit. Twenty steps is a sketch of fine-tuning, enough to see the loss move, not a finished adaptation.',
        'This is off the guided path. The path\'s config trains a tiny model from scratch on characters. The loader that would apply this file is still configurator.py.'
      )
    ],
    overview: [
      note(
        'A short fine-tune of GPT-2 XL on tokenized Shakespeare. The public extra-large weights are loaded, the learning rate stays flat at 3e-5, and the run stops after 20 optimizer steps. It is a demonstration of starting from a published model, not a full training run, and the tiny batch is there because the extra-large network is the thing that barely fits.',
        'The guided lessons use the from-scratch character config instead. Both files are applied the same way, by executing them inside train.py.'
      )
    ]
  },
  'bench.py': {
    logic: [
      note(
        'bench.py is a stopwatch, not a trainer. The settings are fixed: a 12-layer GPT-2-sized model, a chosen batch and context, and a dtype. Nothing here reads the Shakespeare config. The point of the file is to time the same kind of step train.py takes, with the disk and the options held still.',
        'Next the script decides what the step will chew on. Either real OpenWebText windows, or one random batch reused so the disk is not part of the clock.'
      ),
      note(
        'real_data switches the input. When it is on, batches come from the OpenWebText binaries, the same windows train.py would see. When it is off, one random batch of ids is built and reused, so you are timing the GPU and not the filesystem. The benchmark is only honest about the thing you meant to include.',
        'Next a model and an optimizer are built. Twelve layers, AdamW, the same shapes as a small GPT-2. No checkpoint is loaded and none is saved.'
      ),
      note(
        'The module is a fresh GPT of GPT-2 size, moved to the GPU, optionally compiled. AdamW is constructed with a fixed learning rate. There is no warmup and no decay, because the benchmark does not care whether the loss improves. It cares how long a step takes.',
        'Next is an optional profiler. It is off unless you ask. When it is on, a few steps are traced for a later chrome or tensorboard view. The timed loop comes after that.'
      ),
      note(
        'The profiler, if enabled, runs a handful of steps and writes a trace. It is not part of the measurement you came for. It is a side door for looking at kernels. Leave it off and the script falls through to the clock.',
        'The last block burns a few steps so compilation and caches settle, then times a measured loop and prints tokens per second. That number is the whole output of this file.'
      ),
      note(
        'A short burn-in lets torch.compile and the allocator finish their one-time work. The timed loop then runs a fixed count of steps and divides tokens by seconds. What you get is a rate for this shape and this dtype on this GPU. It is the same matmul-heavy step as training, without the dataset story and without a saved model.',
        'bench.py is not on the guided path. The path\'s training lesson is train.py, which does this step for real and writes a checkpoint.'
      )
    ],
    overview: [
      note(
        'A few timed steps of a GPT-2-sized model. The settings are fixed, the data is either real OpenWebText or one reused random batch, and the result is a tokens-per-second number. No checkpoint is saved and the learning rate does not decay. It is a stopwatch around the same update train.py performs.',
        'The guided path\'s version of this step is train.py, where the same forward and backward also produce a checkpoint you can sample from.'
      )
    ]
  }
};

function evalBlog(label) {
  const digest = `This file does not train. It sets a modest batch, asks for a few hundred scored batches, turns eval_only on, and names the public ${label} weights. train.py will load that model, measure a loss, and exit before any optimizer step. The number you get is a score, not a checkpoint.`;
  const next = 'That is the whole file. It is off the guided path. The path\'s configs are the small character run and the loader that executes it.';
  return { logic: [note(digest, next)], overview: [note(digest, next)] };
}

blog['config/eval_gpt2.py'] = evalBlog('GPT-2 (124M)');
blog['config/eval_gpt2_medium.py'] = evalBlog('GPT-2 medium (350M)');
blog['config/eval_gpt2_large.py'] = evalBlog('GPT-2 large (774M)');
blog['config/eval_gpt2_xl.py'] = evalBlog('GPT-2 XL (1558M)');
