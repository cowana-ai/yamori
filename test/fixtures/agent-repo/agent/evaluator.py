from agent.prompts import EVAL_PROMPT


def evaluate(goal, results):
    score = grade(results)
    return {"goal": goal, "ok": score > 0.5, "prompt": EVAL_PROMPT}


def grade(results):
    return len([r for r in results if r]) / max(1, len(results))
