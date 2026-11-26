from agent.planner import plan
from agent.actor import act
from agent.evaluator import evaluate


def run_agent(goal):
    steps = plan(goal)
    results = act(steps)
    return evaluate(goal, results)


if __name__ == "__main__":
    print(run_agent("summarize the inbox"))
