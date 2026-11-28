from agent.prompts import PLAN_PROMPT


def plan(goal):
    prompt = build_prompt(goal)
    return split_steps(prompt)


def build_prompt(goal):
    return PLAN_PROMPT.format(goal=goal)


def split_steps(text):
    return [line for line in text.split("\n") if line.strip()]
