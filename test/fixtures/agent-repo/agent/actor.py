from agent.tools import call_tool


def act(steps):
    return [run_step(step) for step in steps]


def run_step(step):
    return call_tool("search", step)
