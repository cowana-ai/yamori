from shared.llm import complete
from agents.sales.crm import load_leads, save_score


def score_leads():
    for lead in load_leads():
        save_score(lead, complete("Score: " + lead))


if __name__ == "__main__":
    score_leads()
