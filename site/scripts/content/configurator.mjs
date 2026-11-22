import { section, view } from './section.mjs';

const logic = view(
  'Replace a script\'s settings from the command line',
  'Run inside train.py or sample.py and override their globals from a config file or --key=value flags.',
  [
    section('Run a config file, or override one global', 20, 47, [
      { text: 'Look at each argument after the script name.', start: 20, end: 20 },
      { text: 'If the argument has no equals sign:', start: 21, end: 21 },
      { text: '    Refuse a flag that forgot its value.', start: 23, end: 23 },
      { text: '    Print the config file.', start: 25, end: 27 },
      { text: '    Run that file in this same global scope.', start: 28, end: 28 },
      { text: 'Otherwise:', start: 29, end: 29 },
      { text: '    Require a --key=value flag.', start: 31, end: 31 },
      { text: '    Split off the key, and drop the two dashes.', start: 32, end: 33 },
      { text: '    If that key is not already a global, fail.', start: 34, end: 47 },
      { text: '    Parse the value as a literal when it is a bool, number, or other Python literal.', start: 36, end: 37 },
      { text: '    If parsing fails, keep the raw string.', start: 38, end: 40 },
      { text: '    Require the new type to match the old one.', start: 42, end: 42 },
      { text: '    Print the override and store it on globals.', start: 44, end: 45 },
      { text: '# Why: Running the file here, instead of importing it, lets its assignments hit train.py\'s own variables.', start: 28, end: 28 },
      { text: '# Insight: --block_size=256 works only because block_size already exists. A typo is an error, not a new setting.', start: 34, end: 47 },
      { text: '# Context: literal_eval reads Python values such as True, 64, or 1e-3. It does not execute arbitrary code. The config file does.', start: 20, end: 37 }
    ])
  ]
);

const overview = view(
  'Replace a script\'s settings from the command line',
  'Executed by train.py and sample.py so a config file or flags overwrite their global settings.',
  [
    section('A path is executed; a flag overwrites one name', 20, 47, [
      { text: 'An argument without = is a config file. Print it, then run it in the caller\'s globals.', start: 21, end: 28 },
      { text: 'A --key=value flag parses the value and stores it, but only if the key and its type already exist.', start: 31, end: 45 },
      { text: '# Insight: This is why config/train_shakespeare_char.py can replace train.py\'s defaults without being imported.', start: 28, end: 28 }
    ])
  ]
);

export const configurator = { logic, overview };
