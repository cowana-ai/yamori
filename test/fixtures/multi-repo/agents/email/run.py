from shared.llm import complete
from agents.email.inbox import fetch_unread, reply


def triage_loop():
    for message in fetch_unread():
        answer = complete("Reply to: " + message)
        reply(message, answer)


if __name__ == "__main__":
    triage_loop()
