# Run a function with its tests

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

## Run a function with its tests

Reading pseudocode tells you what a function does; seeing it run with real values
shows its inputs and outputs. In a mapped project, Yamori links unit tests to the
functions they call: Python `test_*` functions and `test_*` methods of `Test*`
classes, and JS/TS `it(…)` and `test(…)` calls. A block whose functions have tests
shows **Run with a test: ▸ test_first_loop**.

**A real run (Python, trusted folders).** Yamori runs that one test with your
project's interpreter and records how the function ran:
- the arguments it received (**In**)
- every executed line, with the variables that line changed (**Steps**); ◀ ▶ or the
  arrow keys step through, and the current step's pseudocode line is highlighted
- the return value or exception (**Out** or **Raises**), plus the test's own
  result (passed, failed with its message, or error)

If the function runs several times, **Call 1 / 2 / 3** picks one. The interpreter is
`yamori.pythonPath` if set, otherwise the Python extension's interpreter for the
project, then a `.venv`, then `python3`. pytest runs the test when installed;
otherwise plain `test_*` functions and `unittest` cases run directly, and a test that
needs pytest fixtures says so. Runs stop after 60 seconds, and each records at most
3 calls and 300 steps.

This runs your project's code on your machine. Yamori asks before the first run in
each folder (**Run**, **Always run tests in this folder**, or **Simulate with AI
instead**) and never runs anything in Restricted Mode.

**An AI simulation, when a real run isn't possible.** In Restricted Mode, for
JS/TS tests, or on request (**Simulate with AI**), your selected AI traces the
function on the test's inputs without running anything. The cell is dashed and
labelled **Simulated by AI, not a real run**, with any caveats; steps are limited
to the function's own lines. On a small Python function, Claude and Codex both
reproduced the real run's exact steps, but simulated values can be wrong.

**Files, images and data as emoji.** Values that stand for files or media get an
emoji, and hovering explains what they are:

| Emoji | Value | Hover example |
| --- | --- | --- |
| 🖼️ | image path or image in memory | size, width × height, and "A path to an image file. Code usually opens it to read its pixels; the path itself is just text." |
| 📄 | document path or open file | file name, size |
| 📊 | data file, or a table in memory | rows × columns |
| 🎵 🎬 🗜️ 📁 | audio, video, archive, other file | file name, size |
| 📦 | bytes | length |
| 🔢 | array or tensor | shape and dtype |

Real runs check the file on disk (missing files say "not found on disk"); simulated
values are recognised from their text.
