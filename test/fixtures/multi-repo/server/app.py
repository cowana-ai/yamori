from agents.email.run import triage_loop
from agents.sales.pipeline import score_leads


def handle_request(path):
    if path == "/email":
        return triage_loop()
    if path == "/sales":
        return score_leads()


def main():
    handle_request("/email")


if __name__ == "__main__":
    main()
