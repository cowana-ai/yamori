import { section, view } from './section.mjs';

const logic = view(
  'Turn Tiny Shakespeare into character ids',
  'Download the play text if needed, map each character to an integer, and write train and validation binaries.',
  [
    section('Download the text if it is not here yet', 12, 17, [
      { text: 'Look for input.txt next to this script.', start: 13, end: 14 },
      { text: 'If it is missing, download the Tiny Shakespeare file.', start: 15, end: 16 },
      { text: 'Write that download to input.txt.', start: 16, end: 17 },
      { text: '# Context: The file is the same tiny corpus char-rnn used. One download is enough; later runs reuse input.txt.', start: 15, end: 17 }
    ]),
    section('Let the characters themselves be the vocabulary', 19, 35, [
      { text: 'Read the whole file as one string.', start: 19, end: 20 },
      { text: 'Print how many characters that is.', start: 21, end: 21 },
      { text: 'Sort the distinct characters. That list is the vocabulary.', start: 24, end: 25 },
      { text: 'Print them, and print **vocab_size**.', start: 26, end: 27 },
      { text: 'Map each character to its index. Call that **stoi**.', start: 30, end: 30 },
      { text: 'Map each index back to its character. Call that **itos**.', start: 31, end: 31 },
      { text: 'Encoding walks the string and replaces each character.', start: 32, end: 33 },
      { text: 'Decoding joins the characters for those ids.', start: 34, end: 35 },
      { text: '# Insight: There is no byte-pair merge here. A token is one character, so the model\'s vocabulary is the alphabet, about 65 symbols in this text.', start: 23, end: 33 },
      { text: '# Context: stoi and itos are inverses. sample.py reads both from meta.pkl so it can prompt and print in letters, not ids.', start: 30, end: 35 }
    ]),
    section('Save a 90/10 split as uint16 binaries', 37, 61, [
      { text: 'Put the first 90% of the characters in train.', start: 38, end: 39 },
      { text: 'Put the last 10% in validation.', start: 40, end: 40 },
      { text: 'The cut is at 0.9 of the length.', start: 39, end: 40 },
      { text: 'Encode both strings to id lists.', start: 43, end: 44 },
      { text: 'Print both lengths.', start: 45, end: 46 },
      { text: 'Store the ids as uint16.', start: 49, end: 50 },
      { text: 'Write train.bin and val.bin next to this script.', start: 51, end: 52 },
      { text: 'Save **vocab_size**, **itos**, and **stoi** in meta.pkl.', start: 55, end: 61 },
      { text: '# Why: uint16 is enough for a 65-character alphabet and matches the dtype train.py memory-maps.', start: 49, end: 52 },
      { text: '# Insight: The split is a single cut in document order, not a shuffle. The validation tail is later text from the same file.', start: 38, end: 40 }
    ])
  ]
);

const overview = view(
  'Turn Tiny Shakespeare into character ids',
  'Download the plays, treat each character as a token, and write the binaries and the codec training will read.',
  [
    section('Get the text and build a character codec', 12, 35, [
      { text: 'Download Tiny Shakespeare and write it to input.txt if it is not already there.', start: 13, end: 17 },
      { text: 'The sorted set of characters is the vocabulary. **stoi** and **itos** translate both ways.', start: 24, end: 35 },
      { text: '# Insight: One character is one token. That is the whole difference from the GPT-2 tokenizer.', start: 29, end: 33 }
    ]),
    section('Write train.bin, val.bin, and meta.pkl', 37, 61, [
      { text: 'Cut the text at 0.9. Encode both sides as uint16.', start: 39, end: 50 },
      { text: 'Save the binaries and a meta.pkl that holds the vocabulary and both maps.', start: 51, end: 61 },
      { text: '# Insight: train.py reads the bins. sample.py reads meta.pkl so letters survive the round trip.', start: 51, end: 61 }
    ])
  ]
);

export const prepareChar = { logic, overview };
