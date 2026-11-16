"""Yamori test runner: run one unit test and record how one function ran.

Usage: python trace.py REQUEST.json RESULT.json

The request names the project root, the test (file and name) and the function
to watch (file, name, first and last line). The result holds the test outcome
and, for up to a few calls of that function, its arguments, each executed line
with the variables that changed, and its return value or exception. Values are
summarised as short text; file-like values get a kind (image, document, data,
...) that Yamori shows as an emoji with a sentence of guidance.

Yamori only starts this when the user presses Run in a trusted workspace. It
runs the project's own test code with the project's own interpreter.
"""
import importlib
import importlib.util
import inspect
import io
import json
import os
import reprlib
import sys
import time
import traceback
import unittest

MAX_CALLS, MAX_STEPS, MAX_VARS, MAX_TEXT = 3, 300, 30, 160

class _OrderedRepr(reprlib.Repr):
    # reprlib sorts dict keys; Python dicts keep insertion order, and the reader
    # should see the dict the program actually built.
    def repr_dict(self, value, level):
        if not value:
            return "{}"
        if level <= 0:
            return "{...}"
        items = []
        for index, key in enumerate(value):
            if index >= self.maxdict:
                items.append("...")
                break
            items.append("%s: %s" % (self.repr1(key, level - 1), self.repr1(value[key], level - 1)))
        return "{%s}" % ", ".join(items)


_repr = _OrderedRepr()
_repr.maxstring, _repr.maxother, _repr.maxlist, _repr.maxtuple, _repr.maxdict, _repr.maxset = MAX_TEXT, MAX_TEXT, 6, 6, 6, 6


def short(text, limit=MAX_TEXT):
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def safe_repr(value):
    try:
        return short(_repr.repr(value))
    except Exception as error:  # A broken __repr__ must not stop the run.
        return "<%s (repr failed: %s)>" % (type(value).__name__, type(error).__name__)


EXTENSIONS = {
    "image": "png jpg jpeg gif bmp webp tif tiff heic svg",
    "document": "pdf doc docx txt md rtf odt html htm ppt pptx epub",
    "data": "csv tsv xls xlsx json jsonl parquet feather xml yaml yml sqlite db",
    "audio": "wav mp3 flac ogg m4a aac",
    "video": "mp4 mov avi mkv webm",
    "archive": "zip tar gz tgz bz2 xz 7z rar",
}
KIND_BY_EXTENSION = {"." + ext: kind for kind, names in EXTENSIONS.items() for ext in names.split()}


def human_size(size):
    for unit in ("bytes", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return ("%d %s" % (size, unit)) if unit == "bytes" else ("%.1f %s" % (size, unit))
        size /= 1024.0


def describe(name, value):
    """A short, safe description of a value for the notebook cell."""
    out = {"name": name, "repr": safe_repr(value), "type": type(value).__name__}
    kind, detail = None, ""
    try:
        if isinstance(value, (str, os.PathLike)):
            text = value if isinstance(value, str) else os.fspath(value)
            if 0 < len(text) < 500 and "\n" not in text:
                kind = KIND_BY_EXTENSION.get(os.path.splitext(text)[1].lower())
                if kind is None and os.path.splitext(text)[1] and os.path.isfile(text):
                    kind = "file"
                if kind:
                    parts = [os.path.basename(text) or text]
                    if os.path.isfile(text):
                        parts.append(human_size(os.path.getsize(text)))
                        if kind == "image":
                            try:
                                from PIL import Image  # Optional: only if the project has Pillow.
                                with Image.open(text) as image:
                                    parts.append("%d×%d %s" % (image.size[0], image.size[1], image.format or ""))
                            except Exception:
                                pass
                    else:
                        parts.append("not found on disk")
                    detail = " · ".join(part.strip() for part in parts if part)
        elif isinstance(value, (bytes, bytearray, memoryview)):
            kind, detail = "bytes", human_size(len(value))
        elif isinstance(value, io.IOBase):
            kind, detail = "stream", "%s · %s" % (os.path.basename(str(getattr(value, "name", "") or "")) or "unnamed", getattr(value, "mode", "") or "open")
        elif type(value).__module__.startswith("PIL.") and hasattr(value, "size") and hasattr(value, "mode"):
            kind, detail = "pil", "%d×%d %s" % (value.size[0], value.size[1], value.mode)
        elif hasattr(value, "shape") and hasattr(value, "columns"):
            kind, detail = "table", "%d rows × %d columns" % (value.shape[0], value.shape[1])
        elif hasattr(value, "shape") and hasattr(value, "dtype") and not isinstance(value, type):
            kind, detail = "array", "shape %s · %s" % (tuple(value.shape), value.dtype)
        elif isinstance(value, (list, tuple, set, frozenset, dict)):
            out["size"] = len(value)
    except Exception:
        kind = None
    if kind:
        out["kind"], out["detail"] = kind, short(detail)
    return out


def last_line(text):
    lines = [line for line in str(text or "").strip().splitlines() if line.strip()]
    return short(lines[-1], 400) if lines else ""


def argument_names(code):
    count = code.co_argcount + code.co_kwonlyargcount
    count += 1 if code.co_flags & inspect.CO_VARARGS else 0
    count += 1 if code.co_flags & inspect.CO_VARKEYWORDS else 0
    return code.co_varnames[:count]


def snapshot(variables):
    names = [name for name in variables if not name.startswith("__")][:MAX_VARS]
    return {name: safe_repr(variables[name]) for name in names}


class Recorder:
    """Follows calls of one function and records each executed line."""

    def __init__(self, target):
        self.file = os.path.realpath(target["file"])
        self.name = target["function"]
        self.first, self.last = int(target["line"]), int(target["end"])
        self.calls, self.files = [], {}

    def is_target(self, code):
        if code.co_name != self.name:
            return False
        real = self.files.get(code.co_filename)
        if real is None:
            real = self.files[code.co_filename] = os.path.realpath(code.co_filename)
        # Decorators can move co_firstlineno a few lines above the def.
        return real == self.file and self.first - 10 <= code.co_firstlineno <= self.last

    def trace(self, frame, event, arg):
        if event != "call" or len(self.calls) >= MAX_CALLS or not self.is_target(frame.f_code):
            return None
        call = {"inputs": [describe(name, frame.f_locals.get(name)) for name in argument_names(frame.f_code)], "steps": [], "output": None, "error": None}
        self.calls.append(call)
        state = {"previous": snapshot(frame.f_locals)}

        def changed(variables):
            current = snapshot(variables)
            names = [name for name in current if state["previous"].get(name) != current[name]]
            state["previous"] = current
            return [describe(name, variables[name]) for name in names]

        def local(frame, event, arg):
            if event == "line":
                # Changes seen now were made by the line that just ran.
                if call["steps"]:
                    call["steps"][-1]["changed"] = changed(frame.f_locals)
                if len(call["steps"]) < MAX_STEPS:
                    call["steps"].append({"line": frame.f_lineno, "changed": []})
                else:
                    call["truncated"] = True
            elif event == "return":
                if call["steps"]:
                    call["steps"][-1]["changed"] = changed(frame.f_locals)
                if call["error"] is None:
                    call["output"] = describe("return", arg)
            elif event == "exception":
                error_type, error, _ = arg
                call["error"] = {"type": error_type.__name__, "message": short(error)}
            return local

        return local


def import_test_module(root, test_file):
    relative = os.path.relpath(test_file, root)
    parts = os.path.splitext(relative)[0].split(os.sep)
    packaged = all(os.path.isfile(os.path.join(root, *parts[:index], "__init__.py")) for index in range(1, len(parts)))
    if packaged and not relative.startswith(".."):
        return importlib.import_module(".".join(parts))
    name = "_yamori_test_" + parts[-1]
    spec = importlib.util.spec_from_file_location(name, test_file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def run_with_pytest(test_file, test_name, recorder):
    import pytest

    class Plugin:
        def __init__(self):
            self.outcome, self.message = "error", "The test did not run."

        @pytest.hookimpl(hookwrapper=True)
        def pytest_runtest_call(self, item):
            sys.settrace(recorder.trace)
            try:
                yield
            finally:
                sys.settrace(None)

        def pytest_runtest_logreport(self, report):
            if report.when == "call" or report.failed:
                self.outcome = "passed" if report.passed else "failed" if report.when == "call" else "error"
                self.message = "" if report.passed else last_line(getattr(report, "longreprtext", ""))

    plugin = Plugin()
    pytest.main([test_file + "::" + test_name, "-q", "-p", "no:cacheprovider", "--no-header", "-x"], plugins=[plugin])
    return plugin.outcome, plugin.message, "pytest"


def run_plain(root, test_file, test_name, recorder):
    module = import_test_module(root, test_file)
    if "::" in test_name:
        class_name, method = test_name.split("::", 1)
        owner = getattr(module, class_name)
        if isinstance(owner, type) and issubclass(owner, unittest.TestCase):
            suite = unittest.defaultTestLoader.loadTestsFromName(class_name + "." + method, module)
            result = unittest.TestResult()
            sys.settrace(recorder.trace)
            try:
                suite.run(result)
            finally:
                sys.settrace(None)
            problems = result.failures + result.errors
            if not problems:
                return "passed", "", "unittest"
            kind = "failed" if result.failures else "error"
            return kind, last_line(problems[0][1]), "unittest"
        instance = owner()
        test = getattr(instance, method)
        setup = getattr(instance, "setup_method", None)
        if setup:
            setup(test)
    else:
        test = getattr(module, test_name)
    parameters = [p for p in inspect.signature(test).parameters.values() if p.default is inspect.Parameter.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    if parameters:
        return "error", "This test needs pytest fixtures (%s). Install pytest in the project's environment to run it." % ", ".join(p.name for p in parameters), "plain"
    sys.settrace(recorder.trace)
    try:
        test()
    except AssertionError as error:
        return "failed", short("AssertionError: %s" % error if str(error) else "AssertionError", 400), "plain"
    except Exception as error:
        return "error", short("%s: %s" % (type(error).__name__, error), 400), "plain"
    finally:
        sys.settrace(None)
    return "passed", "", "plain"


def main():
    request_path, result_path = sys.argv[1], sys.argv[2]
    with open(request_path, encoding="utf-8") as handle:
        request = json.load(handle)
    root = os.path.realpath(request["root"])
    test_file = os.path.realpath(request["testFile"])
    for path in (os.path.dirname(test_file), os.path.join(root, "src"), root):
        if os.path.isdir(path) and path not in sys.path:
            sys.path.insert(0, path)
    os.chdir(root)
    recorder = Recorder(request["target"])
    started = time.perf_counter()
    try:
        try:
            import pytest  # noqa: F401  (only to choose the runner)
            outcome, message, runner = run_with_pytest(test_file, request["testName"], recorder)
        except ImportError:
            outcome, message, runner = run_plain(root, test_file, request["testName"], recorder)
    except Exception as error:
        outcome, message, runner = "error", short("%s: %s" % (type(error).__name__, error), 400), "plain"
        traceback.print_exc()
    result = {
        "outcome": outcome, "message": message, "runner": runner,
        "durationMs": round((time.perf_counter() - started) * 1000, 1),
        "python": sys.version.split()[0], "calls": recorder.calls,
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, default=str)


if __name__ == "__main__":
    main()
