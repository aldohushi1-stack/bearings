import json
from dataclasses import dataclass

def parse(text):
    return json.loads(text)

def _private():
    pass

class Report:
    def render(self):
        return ""

async def stream():
    pass
