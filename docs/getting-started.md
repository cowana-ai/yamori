# Getting started

[← Yamori](../README.md) · [Getting started](getting-started.md) · [Reading](reading.md) · [Project guide](project-guide.md) · [Tests](tests.md) · [Models & speed](models.md) · [Agents](agents.md) · [Development](development.md)

## Install

Yamori is an early preview. Its public extension ID is **`cowana-ai.yamori`**.

1. Open a code file in Cursor or VS Code.
2. Click the **Yamori gecko icon** at the top right of the script, or **Yamori** in the bottom status bar.
3. The first time, **Set up Yamori** shows which AI is on your computer and one button for each:
   **Use Claude** / **Use ChatGPT** when it's ready, otherwise **Sign in** or **Install**.
   Once it's ready, the file you clicked opens.
4. Choose **Overview** or **Logic** in the reading panel, or open **Project guide** to see where to start.

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cowana-ai.yamori),
or search for **Yamori** by **Yamori** (`cowana-ai`) in VS Code’s Extensions panel.
For Cursor, Yamori is published on [Open VSX](https://open-vsx.org/extension/cowana-ai/yamori). New versions may take time to appear through Cursor’s extension search.
For manual installation, download a VSIX from [GitHub Releases](https://github.com/cowana-ai/yamori/releases),
then choose **Extensions → … → Install from VSIX**. If you previously installed
the local `chingis-local.yamori` preview, disable that extension before using
`cowana-ai.yamori` to avoid duplicate commands. The public publisher ID has its
own extension storage; the old preview’s stored explanations remain in its old folder.

The toolbar uses the Yamori samurai logo; the bottom button uses a compact gecko
mark that follows the editor’s text color. Both buttons follow the active script automatically, starting no AI request until
you click. Each file opens its own explanation tab; clicking again reuses it.
The bottom button names its target file on hover and appears after startup,
without first running a command. It hides when no local source editor is active.
The Command Palette action **Yamori: Read as Pseudocode** is still available.
Use **⌘⌥P** on macOS or
**Ctrl+Alt+P** elsewhere. Select a range first to explain only those lines.
After updating an installed version, run **Developer: Reload Window**.

Try the included [demo.py](../examples/demo.py), a small logistic-regression example.
Right-click a folder and choose **Yamori: Read a Folder or Project** to select
multiple files. Files are prepared sequentially without opening a stack of tabs. Use **Yamori: Switch Files** or **Switch file…** to open a prepared explanation. Completed results remain cached
if you stop.

On the first install, Yamori opens **Set up Yamori** if no AI is ready yet, and
otherwise shows a one-time **Open current file** action. The gecko in the editor
toolbar adapts to light/dark themes, and **Yamori** stays available in the status bar.

Yamori also works in **Restricted Mode** and with standalone local files; you
do not need to trust a project to see the gecko icon or explain its source.
In Restricted Mode, Yamori ignores workspace-controlled CLI paths and refinement
settings, skips project language-service definition lookups, and uses your user-level
CLI installation through isolated, tool-disabled sessions outside the project.
Custom behavior whose definition is unavailable stays explicitly unknown. VS Code's
workspace trust setting stays unchanged; Yamori does not run project code there
(see [Run a function with its tests](tests.md) for trusted folders).

### Set up an AI

Yamori uses an AI you already have: **Claude** (through Claude Code) or **ChatGPT**
(through Codex), with that tool's own sign-in and your plan's limits. It never asks
for an API key and never copies your tokens.

**Set up Yamori** opens by itself the first time you click the gecko without a ready
AI (or run **Yamori: Set Up AI**, or **AI ▾ → Set up AI…** in a reading tab). For each
AI it checks, without any model request, whether it is installed and signed in
(`claude auth status`, `codex login status`), then offers one button:

| What it finds | Button | What happens |
| --- | --- | --- |
| Installed and signed in | **Use Claude** / **Use ChatGPT** | Saved as your AI; the file you clicked opens. |
| Installed, signed out | **Sign in to Claude** / **Sign in with ChatGPT** | A terminal opens the tool's browser sign-in. When it finishes, or when you come back to VS Code, Yamori checks again and continues by itself. |
| Not installed | **Install Claude Code** / **Install Codex** | A visible terminal runs Anthropic's official installer, or `npm install -g @openai/codex` (Homebrew if npm is missing), then the sign-in. If a step fails, the terminal stays open with its messages. |

It finds the CLIs where people already have them:
- **Claude Desktop** downloads its own copy of Claude Code; Yamori uses it and its
  sign-in, so a separate install isn't needed.
- **The ChatGPT desktop app** and the Codex app include Codex.
- Command-line installs on `PATH`, `~/.local/bin`, Homebrew and npm.

If both are ready, the one you chose is marked **In use**. If your chosen AI stops
working (signed out, uninstalled), opening a file shows the setup screen again, and it
suggests the other AI when that one is ready. Errors caused by sign-in or a missing
CLI show a **Set up AI** button in the reading tab. Optional executable paths are
under **Settings → Yamori** if detection cannot find your CLI. Selecting a model only
chooses the model; it does not sign you in. See Anthropic's
[setup guide](https://code.claude.com/docs/en/setup) and OpenAI's
[Codex CLI](https://github.com/openai/codex) for details.

On Windows, Yamori detects native installs in `%USERPROFILE%\\.local\\bin`,
executables on `PATH`, and standard npm launchers in `%APPDATA%\\npm`, including
paths with spaces. npm launchers are resolved to their package entry point and
run without a command shell. Supported Claude versions use safe mode to preserve
authentication and network settings while excluding customizations; older versions
retain the isolated fallback. Update Claude Code if your older installation needs
user settings to authenticate.
